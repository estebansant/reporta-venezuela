import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { progress, runWrangler, type ImportEnv } from "./import-wrangler";
import type { BuildingCandidate } from "../lib/match-building";

const execFileAsync = promisify(execFile);

// [south, west, north, east] — Overpass bbox convention
const AOIS: Record<string, { bbox: [number, number, number, number]; label: string }> = {
  yaracuy:        { bbox: [10.0, -69.0, 10.7, -68.4], label: "Yaracuy" },
  lara:           { bbox: [9.9,  -70.0, 10.5, -69.0], label: "Lara / Barquisimeto" },
  falcon:         { bbox: [10.5, -68.5, 11.4, -67.8], label: "Falcón" },
  tucacas:        { bbox: [10.7, -68.4, 11.0, -68.0], label: "Tucacas" },
  "catia-la-mar": { bbox: [10.5, -67.1, 10.7, -66.8], label: "Catia La Mar" },
};

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_TIMEOUT_MS = 120_000;

interface OsmNode { lat: number; lon: number }
interface OsmWay {
  type: "way";
  id: number;
  geometry?: OsmNode[];
  tags?: Record<string, string>;
}
interface OsmRelationMember {
  type: string;
  role: string;
  geometry?: OsmNode[];
}
interface OsmRelation {
  type: "relation";
  id: number;
  members?: OsmRelationMember[];
  tags?: Record<string, string>;
}
type OsmElement = OsmWay | OsmRelation;
interface OsmResponse { elements: OsmElement[] }

type Coord = [number, number];
type Ring = Coord[];

function ringFromNodes(nodes: OsmNode[]): Ring | null {
  if (nodes.length < 4) return null;
  return nodes.map((n): Coord => [n.lon, n.lat]);
}

function ringCentroid(ring: Ring): { lat: number; lng: number } {
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of ring) {
    sumLng += lng;
    sumLat += lat;
  }
  return { lat: sumLat / ring.length, lng: sumLng / ring.length };
}

function osmToGeoJson(data: OsmResponse): {
  features: object[];
  candidates: BuildingCandidate[];
} {
  const features: object[] = [];
  const candidates: BuildingCandidate[] = [];

  for (const el of data.elements) {
    if (el.type === "way" && el.geometry && el.geometry.length >= 4) {
      const ring = ringFromNodes(el.geometry);
      if (!ring) continue;
      const id = `osm:way:${el.id}`;
      const { lat, lng } = ringCentroid(ring);
      features.push({
        type: "Feature",
        id,
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { building_id: id, source: "osm", centroid_lat: lat, centroid_lng: lng, name: el.tags?.name ?? null },
      });
      candidates.push({ building_id: id, building_source: "osm", centroid_lat: lat, centroid_lng: lng });
    } else if (el.type === "relation" && el.members) {
      const outers: Ring[] = [];
      const inners: Ring[] = [];
      for (const m of el.members) {
        if (m.type !== "way" || !m.geometry) continue;
        const ring = ringFromNodes(m.geometry);
        if (!ring) continue;
        if (m.role === "outer") outers.push(ring);
        else if (m.role === "inner") inners.push(ring);
      }
      if (!outers.length) continue;
      const id = `osm:relation:${el.id}`;
      const { lat, lng } = ringCentroid(outers[0]);
      features.push({
        type: "Feature",
        id,
        geometry: { type: "Polygon", coordinates: [outers[0], ...inners] },
        properties: { building_id: id, source: "osm", centroid_lat: lat, centroid_lng: lng, name: el.tags?.name ?? null },
      });
      candidates.push({ building_id: id, building_source: "osm", centroid_lat: lat, centroid_lng: lng });
    }
  }

  return { features, candidates };
}

async function fetchBuildings(bbox: [number, number, number, number]): Promise<OsmResponse> {
  const [south, west, north, east] = bbox;
  const query = `[out:json][timeout:110][bbox:${south},${west},${north},${east}];(way["building"];relation["building"]["type"="multipolygon"];);out geom;`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Overpass error ${response.status}: ${text.slice(0, 300)}`);
    }
    return response.json() as Promise<OsmResponse>;
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(): { aoi: string; env: ImportEnv } {
  const argv = process.argv.slice(2);
  let aoiName: string | undefined;
  let env: ImportEnv = "local";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--aoi" && argv[i + 1]) {
      aoiName = argv[++i];
    } else if (argv[i]?.startsWith("--aoi=")) {
      aoiName = argv[i].slice("--aoi=".length);
    } else if (argv[i] === "--env" && argv[i + 1]) {
      env = argv[++i] as ImportEnv;
    } else if (argv[i]?.startsWith("--env=")) {
      env = argv[i].slice("--env=".length) as ImportEnv;
    }
  }
  if (!aoiName || !AOIS[aoiName]) {
    const keys = Object.keys(AOIS).join(", ");
    throw new Error(`--aoi requerido. Opciones: ${keys}`);
  }
  if (!["local", "preview", "production"].includes(env)) {
    throw new Error("--env debe ser local, preview o production.");
  }
  return { aoi: aoiName, env };
}

async function getMapTilesBucket(env: ImportEnv): Promise<{ bucketName: string; r2Args: string[] }> {
  const raw = await readFile("wrangler.jsonc", "utf8");
  const json = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
  const config = JSON.parse(json) as {
    r2_buckets?: { binding?: string; bucket_name: string }[];
    env?: Record<string, { r2_buckets?: { binding?: string; bucket_name: string }[] }>;
  };
  const scoped = env === "local" ? config : config.env?.[env];
  const bucketName = scoped?.r2_buckets?.find((b) => b.binding === "MAP_TILES")?.bucket_name;
  if (!bucketName) throw new Error(`No se encontró bucket MAP_TILES para env=${env}.`);
  const r2Args = env === "local" ? ["r2", "object"] : ["r2", "object", "--env", env];
  return { bucketName, r2Args };
}

async function runTippecanoe(input: string, output: string) {
  await execFileAsync(
    "tippecanoe",
    [
      "-o", output,
      "--force",
      "--minimum-zoom=14",
      "--maximum-zoom=18",
      "--drop-densest-as-needed",
      "--layer=buildings",
      input,
    ],
    { maxBuffer: 100 * 1024 * 1024 },
  );
}

async function putR2(
  bucketName: string,
  r2Args: string[],
  env: ImportEnv,
  key: string,
  file: string,
) {
  const args = [
    ...r2Args,
    "put",
    `${bucketName}/${key}`,
    "--file", file,
    "--content-type", "application/vnd.pmtiles",
    "--cache-control", "public, max-age=31536000, immutable",
  ];
  if (env === "local") args.push("--local");
  else args.push("--remote", "--force");
  progress(`R2: subiendo ${key}`);
  await runWrangler(args);
}

async function main() {
  const { aoi, env } = parseArgs();
  const config = AOIS[aoi]!;
  progress(`AOI: ${config.label} (${aoi}), env: ${env}`);

  const { bucketName, r2Args } = await getMapTilesBucket(env);
  const dir = await mkdtemp(path.join(tmpdir(), "terremoto-buildings-"));

  try {
    progress("Descargando edificios desde Overpass API…");
    const osmData = await fetchBuildings(config.bbox);
    progress(`${osmData.elements.length} elementos OSM recibidos`);

    const { features, candidates } = osmToGeoJson(osmData);
    progress(`${features.length} edificios → GeoJSON (${candidates.length} candidatos de matching)`);

    const geojsonPath = path.join(dir, "buildings.geojson");
    const pmtilesPath = path.join(dir, "buildings.pmtiles");
    await writeFile(geojsonPath, JSON.stringify({ type: "FeatureCollection", features }));

    progress("Generando PMTiles con tippecanoe…");
    await runTippecanoe(geojsonPath, pmtilesPath);

    await putR2(bucketName, r2Args, env, "tiles/buildings.pmtiles", pmtilesPath);
    progress("Listo. Huellas disponibles en /tiles/buildings.pmtiles");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
