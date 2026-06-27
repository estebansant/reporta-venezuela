import {
  checkRateLimit,
  jsonHeaders,
  rateLimitResponse,
} from "@/lib/api-protection";
import { getCloudflareEnv } from "@/lib/cloudflare";
import {
  zoneQuerySchema,
  type DamageZone,
  type DamageZoneCategory,
} from "@/lib/report-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZONES_CACHE_CONTROL =
  "public, max-age=300, s-maxage=600, stale-while-revalidate=1200";

interface DamageZoneRow {
  id: string;
  geometry: string;
  damage_category: DamageZoneCategory;
  score: number;
  source_name: string;
  acquired_at: string | null;
}

function isMissingDamageZonesTable(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes("no such table: damage_zones");
}

function errorResponse(message: string, status: number, fields?: unknown) {
  return Response.json(
    { error: message, fields },
    { status, headers: jsonHeaders({ "Cache-Control": "no-store" }) },
  );
}

function rowToZone(row: DamageZoneRow): DamageZone {
  let geometry: unknown = null;
  try {
    geometry = JSON.parse(row.geometry);
  } catch {
    geometry = null;
  }
  return {
    id: row.id,
    geometry,
    damageCategory: row.damage_category,
    score: row.score,
    sourceName: row.source_name,
    acquiredAt: row.acquired_at,
  };
}

export async function GET(request: Request) {
  const rateLimit = checkRateLimit(request, {
    namespace: "zones:get",
    limit: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfter);

  const url = new URL(request.url);
  const parsed = zoneQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) {
    return errorResponse("Filtros inválidos.", 400, parsed.error.flatten());
  }

  const { DB } = await getCloudflareEnv();
  const query = parsed.data;
  const filters: string[] = [];
  const bindings: number[] = [];

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

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  let result;
  try {
    result = await DB.prepare(
      `SELECT id, geometry, damage_category, score, source_name, acquired_at
       FROM damage_zones
       ${whereClause}
       ORDER BY score DESC
       LIMIT ?`,
    )
      .bind(...bindings, query.limit)
      .all<DamageZoneRow>();
  } catch (error) {
    if (!isMissingDamageZonesTable(error)) throw error;
    result = { results: [] as DamageZoneRow[] };
  }

  return Response.json(
    { zones: result.results.map(rowToZone) },
    { headers: jsonHeaders({ "Cache-Control": ZONES_CACHE_CONTROL }) },
  );
}
