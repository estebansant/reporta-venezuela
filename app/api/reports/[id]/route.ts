import { getCloudflareEnv } from "@/lib/cloudflare";
import { getReportById } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/reports/[id]">,
) {
  const { id } = await context.params;
  const { DB } = await getCloudflareEnv();
  const report = await getReportById(DB, id);
  if (!report) {
    return Response.json({ error: "Reporte no encontrado." }, { status: 404 });
  }
  return Response.json({ report });
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/reports/[id]">,
) {
  const body = (await request.json().catch(() => null)) as unknown;
  if (
    !body ||
    typeof body !== "object" ||
    !("needsHelp" in body) ||
    body.needsHelp !== false
  ) {
    return Response.json(
      { error: "Solo se puede indicar que la ubicación ya no necesita ayuda." },
      { status: 400 },
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
      return Response.json({ error: "Reporte no encontrado." }, { status: 404 });
    }
    return Response.json({ report: existingReport });
  }

  const report = await getReportById(DB, id);
  return Response.json({ report });
}
