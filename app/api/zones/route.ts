import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  checkRateLimit,
  jsonHeaders,
  rateLimitResponse,
} from "@/lib/api-protection";
import { getCloudflareEnv } from "@/lib/cloudflare";
import {
  emsAreaFeatureToZone,
  type DamageZoneRecord,
  type GeoJSONFeature,
} from "../../../lib/import-satellite";
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
  source_id: string;
  acquired_at: string | null;
}

let localCopernicusZonesCache: Promise<DamageZoneRecord[]> | null = null;

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
  return damageZoneRecordToResponse({
    id: row.id,
    geometry: row.geometry,
    damageCategory: row.damage_category,
    score: row.score,
    sourceName: row.source_name,
    acquiredAt: row.acquired_at,
  });
}

function damageZoneRecordToResponse(zone: {
  id: string;
  geometry: string;
  damageCategory: DamageZoneCategory;
  score: number;
  sourceName: string;
  acquiredAt: string | null;
}): DamageZone {
  let geometry: unknown = null;
  try {
    geometry = JSON.parse(zone.geometry);
  } catch {
    geometry = null;
  }
  return {
    id: zone.id,
    geometry,
    damageCategory: zone.damageCategory,
    score: zone.score,
    sourceName: zone.sourceName,
    acquiredAt: zone.acquiredAt,
  };
}

async function findBuiltUpProducts(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith("builtUpA_v1.json")) {
          found.push(fullPath);
        }
      }),
    );
  }
  await walk(root);
  return found.sort();
}

function activationFromLocalFile(file: string) {
  const name = path.basename(file);
  const aoiMatch = name.match(/^(EMSR[0-9]+)_AOI([0-9]+)/i);
  if (aoiMatch) return `${aoiMatch[1]}-AOI${aoiMatch[2]}`;
  return name.match(/^(EMSR[0-9]+)_/i)?.[1] ?? "EMS";
}

async function loadLocalCopernicusZones(): Promise<DamageZoneRecord[]> {
  const root = path.join(process.cwd(), "EMSR884_products");
  const files = await findBuiltUpProducts(root);
  const zones: DamageZoneRecord[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const data = JSON.parse(await readFile(file, "utf8")) as {
      features?: GeoJSONFeature[];
    };
    const activationId = activationFromLocalFile(file);
    for (let index = 0; index < (data.features ?? []).length; index += 1) {
      const zone = emsAreaFeatureToZone(data.features![index], activationId, index);
      if (!zone || seen.has(zone.id)) continue;
      seen.add(zone.id);
      zones.push(zone);
    }
  }

  return zones;
}

async function getLocalCopernicusZones(): Promise<DamageZoneRecord[]> {
  localCopernicusZonesCache ??= loadLocalCopernicusZones();
  return localCopernicusZonesCache;
}

function intersectsBounds(zone: DamageZoneRecord, query: z.infer<typeof zoneQuerySchema>) {
  if (
    query.north === undefined ||
    query.south === undefined ||
    query.east === undefined ||
    query.west === undefined
  ) {
    return true;
  }
  return (
    zone.maxLat >= query.south &&
    zone.minLat <= query.north &&
    zone.maxLng >= query.west &&
    zone.minLng <= query.east
  );
}

function shouldUseLocalCopernicusFallback(rows: DamageZoneRow[]) {
  if (!rows.length) return true;
  const copernicusRows = rows.filter((row) => row.source_name === "copernicus-ems-area");
  return (
    copernicusRows.length > 0 &&
    copernicusRows.every((row) => row.damage_category === "low")
  );
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
  let missingDamageZonesTable = false;
  try {
    result = await DB.prepare(
      `SELECT id, geometry, damage_category, score, source_name, source_id, acquired_at
       FROM damage_zones
       ${whereClause}
       ORDER BY score DESC
       LIMIT ?`,
    )
      .bind(...bindings, query.limit)
      .all<DamageZoneRow>();
  } catch (error) {
    if (!isMissingDamageZonesTable(error)) throw error;
    missingDamageZonesTable = true;
    result = { results: [] as DamageZoneRow[] };
  }

  const rows = result.results;
  if (!missingDamageZonesTable && shouldUseLocalCopernicusFallback(rows)) {
    const localZones = (await getLocalCopernicusZones())
      .filter((zone) => intersectsBounds(zone, query))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit);
    const byId = new Map<string, DamageZone>();
    for (const row of rows) byId.set(row.id, rowToZone(row));
    for (const zone of localZones) {
      byId.set(zone.id, damageZoneRecordToResponse(zone));
    }

    return Response.json(
      { zones: Array.from(byId.values()).slice(0, query.limit) },
      { headers: jsonHeaders({ "Cache-Control": ZONES_CACHE_CONTROL }) },
    );
  }

  return Response.json(
    { zones: rows.map(rowToZone) },
    { headers: jsonHeaders({ "Cache-Control": ZONES_CACHE_CONTROL }) },
  );
}
