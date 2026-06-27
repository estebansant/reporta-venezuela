import {
  checkRateLimit,
  jsonHeaders,
  rateLimitResponse,
} from "@/lib/api-protection";
import { getCloudflareEnv } from "@/lib/cloudflare";
import { isAuthorizedAdmin } from "@/lib/satellite-admin";
import type { DamageType } from "@/lib/report-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_REVIEW_STATUSES = new Set([
  "reported",
  "triaged_by_satellite",
  "externally_corroborated",
  "verified_collapsed",
  "verified_damaged",
  "rejected_unclear",
]);

// Sources whose resolution warrants verified_collapsed / verified_damaged.
const VHR_SOURCES = new Set([
  "maxar-open-data",
  "ms-ai-for-good",
  "copernicus-ems",
  "copernicus-ems-area",
  "unosat",
]);

interface CandidateRow {
  id: string;
  latitude: number;
  longitude: number;
  suggested_damage_type: DamageType;
  chip_r2_key: string | null;
  chip_report_id: string | null;
  chip_image_id: string | null;
  chip_width: number | null;
  chip_height: number | null;
  chip_size_bytes: number | null;
  source_name: string;
  source_id: string;
  state: string | null;
  city: string | null;
  note: string | null;
  status: string;
}

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: jsonHeaders({ "Cache-Control": "no-store" }) },
  );
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/satellite/candidates/[id]">,
) {
  const rateLimit = checkRateLimit(request, {
    namespace: "satellite-candidates:patch",
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfter);

  const { DB, SATELLITE_ADMIN_SECRET } = await getCloudflareEnv();
  if (!isAuthorizedAdmin(request, SATELLITE_ADMIN_SECRET)) {
    return jsonError("No autorizado.", 401);
  }

  const body = (await request.json().catch(() => null)) as {
    action?: string;
    reviewStatus?: string;
    evidenceNote?: string;
  } | null;

  const action = body?.action;
  if (action !== "approve" && action !== "reject") {
    return jsonError("Acción inválida. Usa 'approve' o 'reject'.", 400);
  }

  const { id } = await context.params;
  const candidate = await DB.prepare(
    `SELECT id, latitude, longitude, suggested_damage_type, chip_r2_key,
      chip_report_id, chip_image_id, chip_width, chip_height, chip_size_bytes,
      source_name, source_id, state, city, note, status
     FROM satellite_candidates WHERE id = ?`,
  )
    .bind(id)
    .first<CandidateRow>();

  if (!candidate) return jsonError("Candidato no encontrado.", 404);
  if (candidate.status !== "pending") {
    return jsonError("El candidato ya fue revisado.", 409);
  }

  const now = new Date().toISOString();

  if (action === "reject") {
    await DB.prepare(
      `UPDATE satellite_candidates
       SET status = 'rejected', reviewed_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
      .bind(now, id)
      .run();
    return Response.json(
      { candidate: { id, status: "rejected" } },
      { headers: jsonHeaders({ "Cache-Control": "no-store" }) },
    );
  }

  // approve → publish a satellite-verified report
  const isVhr = VHR_SOURCES.has(candidate.source_name);
  const requestedStatus = body?.reviewStatus;
  const reviewStatus =
    requestedStatus && VALID_REVIEW_STATUSES.has(requestedStatus)
      ? requestedStatus
      : isVhr
        ? "triaged_by_satellite"
        : "triaged_by_satellite";

  const reportId = candidate.chip_report_id ?? crypto.randomUUID();
  const city = candidate.city?.trim() || "Zona afectada";
  const state = candidate.state?.trim() || "Venezuela";
  const address = `${city}, ${state}`.slice(0, 240);
  const buildingName = (
    candidate.note?.trim() || "Edificio detectado por satélite"
  ).slice(0, 120);
  const description =
    "Daño detectado mediante análisis de imagen satelital y confirmado en revisión manual.";

  const statements = [
    DB.prepare(
      `INSERT INTO reports (
        id, building_name, address, state, city, latitude, longitude,
        damage_type, needs_help, description, contact_consent, status,
        created_at, updated_at, verified_by_satellite, verified_at,
        verified_source, verified_source_id, source_name, source_id, source_url,
        review_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 'published', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      reportId,
      buildingName,
      address,
      state,
      city,
      candidate.latitude,
      candidate.longitude,
      candidate.suggested_damage_type,
      description,
      now,
      now,
      now,
      candidate.source_name,
      candidate.source_id,
      candidate.source_name,
      candidate.source_id,
      null,
      reviewStatus,
    ),
    DB.prepare(
      `UPDATE satellite_candidates
       SET status = 'approved', reviewed_at = ?
       WHERE id = ?`,
    ).bind(now, id),
  ];

  if (
    candidate.chip_r2_key &&
    candidate.chip_image_id &&
    candidate.chip_width &&
    candidate.chip_height &&
    candidate.chip_size_bytes
  ) {
    statements.push(
      DB.prepare(
        `INSERT INTO report_images (
          id, report_id, r2_key, mime_type, size_bytes, width, height, position, created_at
        ) VALUES (?, ?, ?, 'image/webp', ?, ?, ?, 0, ?)`,
      ).bind(
        candidate.chip_image_id,
        reportId,
        candidate.chip_r2_key,
        candidate.chip_size_bytes,
        candidate.chip_width,
        candidate.chip_height,
        now,
      ),
    );
  }

  await DB.batch(statements);

  // Insert evidence row — best-effort (table may not exist if migration 0015 is pending).
  const evidenceId = crypto.randomUUID();
  try {
    await DB.prepare(
      `INSERT INTO verification_evidence
         (id, report_id, source_name, source_id, evidence_type, chip_r2_key, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        evidenceId,
        reportId,
        candidate.source_name,
        candidate.source_id,
        "satellite-detection",
        candidate.chip_r2_key ?? null,
        body?.evidenceNote?.trim() || null,
        now,
      )
      .run();
  } catch {
    // Silently skip — migration 0015 not yet applied.
  }

  return Response.json(
    { candidate: { id, status: "approved", reportId, reviewStatus } },
    { headers: jsonHeaders({ "Cache-Control": "no-store" }) },
  );
}
