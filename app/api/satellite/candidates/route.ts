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

interface CandidateRow {
  id: string;
  latitude: number;
  longitude: number;
  suggested_damage_type: DamageType;
  score: number | null;
  chip_r2_key: string | null;
  chip_pre_r2_key: string | null;
  source_name: string;
  source_id: string;
  state: string | null;
  city: string | null;
  note: string | null;
  created_at: string;
}

export async function GET(request: Request) {
  const rateLimit = checkRateLimit(request, {
    namespace: "satellite-candidates:get",
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfter);

  const { DB, SATELLITE_ADMIN_SECRET } = await getCloudflareEnv();
  if (!isAuthorizedAdmin(request, SATELLITE_ADMIN_SECRET)) {
    return Response.json(
      { error: "No autorizado." },
      { status: 401, headers: jsonHeaders({ "Cache-Control": "no-store" }) },
    );
  }

  const result = await DB.prepare(
    `SELECT id, latitude, longitude, suggested_damage_type, score,
      chip_r2_key, chip_pre_r2_key, source_name, source_id, state, city, note, created_at
     FROM satellite_candidates
     WHERE status = 'pending'
     ORDER BY score DESC, created_at DESC
     LIMIT 500`,
  ).all<CandidateRow>();

  const candidates = result.results.map((row: CandidateRow) => ({
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    suggestedDamageType: row.suggested_damage_type,
    score: row.score,
    sourceName: row.source_name,
    sourceId: row.source_id,
    state: row.state,
    city: row.city,
    note: row.note,
    createdAt: row.created_at,
    chipUrl: row.chip_r2_key ? `/media/${row.chip_r2_key}` : null,
    chipPreUrl: row.chip_pre_r2_key ? `/media/${row.chip_pre_r2_key}` : null,
  }));

  return Response.json(
    { candidates },
    { headers: jsonHeaders({ "Cache-Control": "no-store" }) },
  );
}
