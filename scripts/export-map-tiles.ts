import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  d1Json,
  progress,
  runWrangler,
  type ImportEnv,
} from "./import-wrangler";
import type { MapTilesManifest } from "../lib/map-tiles";

const execFileAsync = promisify(execFile);

type Feature = {
  type: "Feature";
  id?: string;
  geometry: unknown;
  properties: Record<string, unknown>;
};

interface ReportsRow {
  id: string;
  building_name: string;
  address: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  damage_type: string;
  needs_help: number;
  created_at: string;
  verified_by_satellite: number;
  chip_image_id: string | null;
}

interface ZoneRow {
  id: string;
  geometry: string;
  damage_category: string;
  score: number;
  source_name: string;
  source_id: string;
  acquired_at: string | null;
}

interface ExportTarget {
  env: ImportEnv;
  dbName: string;
  bucketName: string;
  d1Args: string[];
  r2Args: string[];
}

function parseArgs() {
  const envArg = process.argv.find((arg) => arg.startsWith("--env="));
  const env = (envArg?.slice("--env=".length) ?? "local") as ImportEnv;
  if (!["local", "preview", "production"].includes(env)) {
    throw new Error("--env debe ser local, preview o production.");
  }
  return { env };
}

function stripJsonComments(input: string) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
}

async function getExportTarget(env: ImportEnv): Promise<ExportTarget> {
  const config = JSON.parse(
    stripJsonComments(await readFile("wrangler.jsonc", "utf8")),
  ) as {
    d1_databases?: { database_name: string }[];
    r2_buckets?: { binding?: string; bucket_name: string }[];
    env?: Record<
      string,
      {
        d1_databases?: { database_name: string }[];
        r2_buckets?: { binding?: string; bucket_name: string }[];
      }
    >;
  };
  const scoped = env === "local" ? config : config.env?.[env];
  const dbName = scoped?.d1_databases?.[0]?.database_name;
  const bucketName =
    scoped?.r2_buckets?.find((bucket) => bucket.binding === "MAP_TILES")
      ?.bucket_name ?? scoped?.r2_buckets?.[1]?.bucket_name;
  if (!dbName || !bucketName) {
    throw new Error(`No se encontró DB o bucket MAP_TILES para env=${env}.`);
  }

  return {
    env,
    dbName,
    bucketName,
    d1Args:
      env === "local"
        ? ["d1", "execute", dbName, "--local"]
        : ["d1", "execute", dbName, "--env", env, "--remote"],
    r2Args:
      env === "local" ? ["r2", "object"] : ["r2", "object", "--env", env],
  };
}

function featureCollection(features: Feature[]) {
  return {
    type: "FeatureCollection",
    features,
  };
}

function rowToReportFeature(row: ReportsRow): Feature {
  return {
    type: "Feature",
    id: row.id,
    geometry: {
      type: "Point",
      coordinates: [row.longitude, row.latitude],
    },
    properties: {
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
      verifiedBySatellite: row.verified_by_satellite === 1,
      verifiedChipUrl:
        row.verified_by_satellite === 1 && row.chip_image_id
          ? `/media/reports/${row.id}/${row.chip_image_id}.webp`
          : null,
      damage_type: row.damage_type,
      needs_help: row.needs_help,
      created_at: row.created_at,
      verified_by_satellite: row.verified_by_satellite,
      chip_image_id: row.chip_image_id,
    },
  };
}

function rowToZoneFeature(row: ZoneRow): Feature | null {
  let geometry: unknown;
  try {
    geometry = JSON.parse(row.geometry);
  } catch {
    return null;
  }
  return {
    type: "Feature",
    id: row.id,
    geometry,
    properties: {
      id: row.id,
      damageCategory: row.damage_category,
      score: row.score,
      sourceName: row.source_name,
      sourceId: row.source_id,
      acquiredAt: row.acquired_at,
      damage_category: row.damage_category,
      source_name: row.source_name,
      source_id: row.source_id,
      acquired_at: row.acquired_at,
    },
  };
}

async function runTippecanoe(input: string, output: string, layer: string) {
  await execFileAsync(
    "tippecanoe",
    [
      "-o",
      output,
      "--force",
      "--drop-densest-as-needed",
      "--extend-zooms-if-still-dropping",
      "--minimum-zoom=0",
      "--maximum-zoom=14",
      `--layer=${layer}`,
      input,
    ],
    { maxBuffer: 20 * 1024 * 1024 },
  );
}

async function putR2(
  target: ExportTarget,
  key: string,
  file: string,
  contentType: string,
  cacheControl: string,
) {
  const args = [
    ...target.r2Args,
    "put",
    `${target.bucketName}/${key}`,
    "--file",
    file,
    "--content-type",
    contentType,
    "--cache-control",
    cacheControl,
  ];
  if (target.env === "local") args.push("--local");
  else args.push("--remote", "--force");
  progress(`R2: subiendo ${key}`);
  await runWrangler(args);
}

async function main() {
  const { env } = parseArgs();
  const target = await getExportTarget(env);
  const dir = await mkdtemp(path.join(tmpdir(), "terremoto-map-tiles-"));
  try {
    progress(`Exportando capas públicas desde D1 (${env})...`);
    const [reports, zones] = await Promise.all([
      d1Json<ReportsRow>(
        target,
        `SELECT r.id, r.building_name, r.address, r.state, r.city, r.latitude,
          r.longitude, r.damage_type, r.needs_help, r.created_at,
          r.verified_by_satellite, i.id AS chip_image_id
         FROM reports r
         LEFT JOIN report_images i ON i.report_id = r.id AND i.position = 0
         WHERE r.status = 'published'
         ORDER BY r.created_at DESC`,
      ),
      d1Json<ZoneRow>(
        target,
        `SELECT id, geometry, damage_category, score, source_name, source_id, acquired_at
         FROM damage_zones
         ORDER BY score DESC`,
      ).catch((error) => {
        if (
          error instanceof Error &&
          error.message.toLowerCase().includes("no such table: damage_zones")
        ) {
          return [] as ZoneRow[];
        }
        throw error;
      }),
    ]);

    const generatedAt =
      reports[0]?.created_at && !Number.isNaN(Date.parse(reports[0].created_at))
        ? reports[0].created_at
        : new Date().toISOString();
    const reportsGeojson = path.join(dir, "reports.geojson");
    const zonesGeojson = path.join(dir, "zones.geojson");
    const reportsPmtiles = path.join(dir, "reports.pmtiles");
    const zonesPmtiles = path.join(dir, "zones.pmtiles");
    const manifestPath = path.join(dir, "manifest.json");

    await writeFile(
      reportsGeojson,
      JSON.stringify(featureCollection(reports.map(rowToReportFeature))),
    );
    await writeFile(
      zonesGeojson,
      JSON.stringify(featureCollection(zones.map(rowToZoneFeature).filter(Boolean) as Feature[])),
    );

    progress(`Generando PMTiles (${reports.length} reportes, ${zones.length} zonas)...`);
    await runTippecanoe(reportsGeojson, reportsPmtiles, "reports");
    await runTippecanoe(zonesGeojson, zonesPmtiles, "zones");

    const manifest: MapTilesManifest = {
      generated_at: generatedAt,
      reports: {
        geojson: "tiles/reports.geojson",
        pmtiles: "tiles/reports.pmtiles",
      },
      zones: {
        geojson: "tiles/zones.geojson",
        pmtiles: "tiles/zones.pmtiles",
      },
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    await putR2(target, "tiles/reports.geojson", reportsGeojson, "application/geo+json", "public, max-age=300, s-maxage=600");
    await putR2(target, "tiles/zones.geojson", zonesGeojson, "application/geo+json", "public, max-age=300, s-maxage=600");
    await putR2(target, "tiles/reports.pmtiles", reportsPmtiles, "application/vnd.pmtiles", "public, max-age=31536000, immutable");
    await putR2(target, "tiles/zones.pmtiles", zonesPmtiles, "application/vnd.pmtiles", "public, max-age=31536000, immutable");
    await putR2(target, "tiles/manifest.json", manifestPath, "application/json", "public, max-age=300, s-maxage=600");
    progress("Export listo. Ejecuta este script después de import:* o detect:* para renovar el baseline.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
