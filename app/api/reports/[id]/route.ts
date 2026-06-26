import {
  checkRateLimit,
  jsonHeaders,
  rateLimitResponse,
} from "@/lib/api-protection";
import { getCloudflareEnv } from "@/lib/cloudflare";
import { getReportById } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext<"/api/reports/[id]">,
) {
  const rateLimit = checkRateLimit(request, {
    namespace: "reports-id:get",
    limit: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfter);

  const { id } = await context.params;
  const { DB } = await getCloudflareEnv();
  const report = await getReportById(DB, id);
  if (!report) {
    return Response.json(
      { error: "Reporte no encontrado." },
      { status: 404, headers: jsonHeaders({ "Cache-Control": "no-store" }) },
    );
  }
  return Response.json(
    { report },
    {
      headers: jsonHeaders({
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      }),
    },
  );
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/reports/[id]">,
) {
  const rateLimit = checkRateLimit(request, {
    namespace: "reports-id:patch",
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfter);

  const body = (await request.json().catch(() => null)) as unknown;
  if (
    !body ||
    typeof body !== "object" ||
    !("needsHelp" in body) ||
    body.needsHelp !== false
  ) {
    return Response.json(
      { error: "Solo se puede indicar que la ubicación ya no necesita ayuda." },
      { status: 400, headers: jsonHeaders({ "Cache-Control": "no-store" }) },
    );
  }

  const { id } = await context.params;
  const { DB } = await getCloudflareEnv();
  const result = await DB.prepare(
    `UPDATE reports
     SET needs_help = 0, updated_at = ?
     WHERE id = ? AND status = 'published' AND needs_help = 1`,
  )
    .bind(new Date().toISOString(), id)
    .run();

  if (result.meta.changes === 0) {
    const existingReport = await getReportById(DB, id);
    if (!existingReport) {
      return Response.json(
        { error: "Reporte no encontrado." },
        { status: 404, headers: jsonHeaders({ "Cache-Control": "no-store" }) },
      );
    }
    return Response.json(
      { report: existingReport },
      { headers: jsonHeaders({ "Cache-Control": "no-store" }) },
    );
  }

  const report = await getReportById(DB, id);
  return Response.json(
    { report },
    { headers: jsonHeaders({ "Cache-Control": "no-store" }) },
  );
}
