import {
  checkRateLimit,
  jsonHeaders,
  rateLimitResponse,
} from "@/lib/api-protection";
import { getCloudflareEnv } from "@/lib/cloudflare";
import {
  mapReportQuerySchema,
  type DamageType,
  type MapReport,
} from "@/lib/report-schema";
import { groupMapReports } from "../../../../lib/map-report-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAP_CACHE_CONTROL =
  "public, max-age=30, s-maxage=60, stale-while-revalidate=120";

interface MapReportRow {
  id: string;
  building_name: string;
  address: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  damage_type: DamageType;
  needs_help: number;
  created_at: string;
  verified_by_satellite: number;
  chip_image_id: string | null;
}

function isMissingSchemaError(error: unknown, fragments: string[]) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return fragments.some((fragment) => message.includes(fragment.toLowerCase()));
}

function errorResponse(message: string, status: number, fields?: unknown) {
  return Response.json(
    { error: message, fields },
    { status, headers: jsonHeaders({ "Cache-Control": "no-store" }) },
  );
}

function rowToMapReport(row: MapReportRow): MapReport {
  const verifiedBySatellite = row.verified_by_satellite === 1;
  return {
    id: row.id,
    buildingName: row.building_name,
    address: row.address,
    state: row.state,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    damageType: row.damage_type,
    needsHelp: row.needs_help === 1,
    createdAt: row.created_at,
    verifiedBySatellite,
    verifiedChipUrl:
      verifiedBySatellite && row.chip_image_id
        ? `/media/reports/${row.id}/${row.chip_image_id}.webp`
        : null,
  };
}

function searchParamsToQuery(searchParams: URLSearchParams) {
  const query: Record<string, string | string[]> = Object.fromEntries(
    searchParams.entries(),
  );
  const damageTypes = searchParams.getAll("damageType");
  if (damageTypes.length) query.damageType = damageTypes;
  return query;
}

export async function GET(request: Request) {
  const rateLimit = checkRateLimit(request, {
    namespace: "reports-map:get",
    limit: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfter);

  const url = new URL(request.url);
  const parsed = mapReportQuerySchema.safeParse(
    searchParamsToQuery(url.searchParams),
  );
  if (!parsed.success) {
    return errorResponse("Filtros inválidos.", 400, parsed.error.flatten());
  }

  const { DB } = await getCloudflareEnv();
  const filters = [`status = 'published'`];
  const bindings: (string | number)[] = [];
  const query = parsed.data;

  if (query.search) {
    filters.push("(building_name LIKE ? OR address LIKE ? OR city LIKE ?)");
    const term = `%${query.search}%`;
    bindings.push(term, term, term);
  }
  if (query.state) {
    filters.push("state = ?");
    bindings.push(query.state);
  }
  if (query.damageType?.length) {
    filters.push(
      `damage_type IN (${query.damageType.map(() => "?").join(",")})`,
    );
    bindings.push(...query.damageType);
  }
  if (query.verifiedBySatellite) {
    filters.push("verified_by_satellite = 1");
  }
  if (
    query.north !== undefined &&
    query.south !== undefined &&
    query.east !== undefined &&
    query.west !== undefined
  ) {
    filters.push("latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?");
    bindings.push(query.south, query.north, query.west, query.east);
  }

  let result;
  try {
    result = await DB.prepare(
      `SELECT r.id, r.building_name, r.address, r.state, r.city, r.latitude,
        r.longitude, r.damage_type, r.needs_help, r.created_at,
        r.verified_by_satellite, i.id AS chip_image_id
       FROM reports r
       LEFT JOIN report_images i ON i.report_id = r.id AND i.position = 0
       WHERE ${filters.join(" AND ")}
       ORDER BY r.created_at DESC
       LIMIT ?`,
    )
      .bind(...bindings, query.limit)
      .all<MapReportRow>();
  } catch (error) {
    const canFallback =
      !query.verifiedBySatellite &&
      isMissingSchemaError(error, [
        "no such column: r.verified_by_satellite",
        "no such column: verified_by_satellite",
      ]);

    if (!canFallback) throw error;

    result = await DB.prepare(
      `SELECT r.id, r.building_name, r.address, r.state, r.city, r.latitude,
        r.longitude, r.damage_type, r.needs_help, r.created_at,
        0 AS verified_by_satellite, NULL AS chip_image_id
       FROM reports r
       WHERE ${filters.join(" AND ")}
       ORDER BY r.created_at DESC
       LIMIT ?`,
    )
      .bind(...bindings, query.limit)
      .all<MapReportRow>();
  }

  return Response.json(
    { reports: groupMapReports(result.results.map(rowToMapReport)) },
    {
      headers: jsonHeaders({
        "Cache-Control": MAP_CACHE_CONTROL,
      }),
    },
  );
}
