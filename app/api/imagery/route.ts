import {
  checkRateLimit,
  jsonHeaders,
  rateLimitResponse,
} from "@/lib/api-protection";
import { getCloudflareEnv } from "@/lib/cloudflare";
import { imageryQuerySchema, type ImageryScene } from "@/lib/report-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGERY_CACHE_CONTROL =
  "public, max-age=300, s-maxage=600, stale-while-revalidate=1200";

interface ImagerySceneRow {
  scene_id: string;
  provider: string;
  license: string | null;
  phase: string | null;
  datetime: string | null;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  r2_key: string;
  resolution_m: number | null;
}

function rowToScene(row: ImagerySceneRow): ImageryScene {
  return {
    sceneId: row.scene_id,
    provider: row.provider,
    phase: row.phase,
    datetime: row.datetime,
    license: row.license,
    bbox: [row.min_lng, row.min_lat, row.max_lng, row.max_lat],
    r2Key: row.r2_key,
    resolutionM: row.resolution_m,
  };
}

function errorResponse(message: string, status: number, fields?: unknown) {
  return Response.json(
    { error: message, fields },
    { status, headers: jsonHeaders({ "Cache-Control": "no-store" }) },
  );
}

export async function GET(request: Request) {
  const rateLimit = checkRateLimit(request, {
    namespace: "imagery:get",
    limit: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfter);

  const url = new URL(request.url);
  const parsed = imageryQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) {
    return errorResponse("Filtros inválidos.", 400, parsed.error.flatten());
  }

  const { DB } = await getCloudflareEnv();
  const query = parsed.data;
  const filters: string[] = [];
  const bindings: (string | number)[] = [];

  if (
    query.north !== undefined &&
    query.south !== undefined &&
    query.east !== undefined &&
    query.west !== undefined
  ) {
    filters.push(
      "max_lat >= ? AND min_lat <= ? AND max_lng >= ? AND min_lng <= ?",
    );
    bindings.push(query.south, query.north, query.west, query.east);
  }

  if (query.phase) {
    filters.push("phase = ?");
    bindings.push(query.phase);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  let result;
  try {
    result = await DB.prepare(
      `SELECT scene_id, provider, license, phase, datetime,
              min_lat, max_lat, min_lng, max_lng, r2_key, resolution_m
       FROM imagery_scenes
       ${whereClause}
       ORDER BY datetime DESC
       LIMIT ?`,
    )
      .bind(...bindings, query.limit)
      .all<ImagerySceneRow>();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("no such table: imagery_scenes")
    ) {
      return Response.json(
        { scenes: [] as ImageryScene[] },
        { headers: jsonHeaders({ "Cache-Control": IMAGERY_CACHE_CONTROL }) },
      );
    }
    throw error;
  }

  return Response.json(
    { scenes: result.results.map(rowToScene) },
    { headers: jsonHeaders({ "Cache-Control": IMAGERY_CACHE_CONTROL }) },
  );
}
