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

type CliArgs =
  | { mode: "osm"; aoi: string; env: ImportEnv }
  | { mode: "msdamage"; gpkgs: string[]; env: ImportEnv };

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let aoiName: string | undefined;
  let source = "osm";
  const gpkgs: string[] = [];
  let env: ImportEnv = "local";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--aoi" && argv[i + 1]) {
      aoiName = argv[++i];
    } else if (argv[i]?.startsWith("--aoi=")) {
      aoiName = argv[i].slice("--aoi=".length);
    } else if (argv[i] === "--source" && argv[i + 1]) {
      source = argv[++i];
    } else if (argv[i]?.startsWith("--source=")) {
      source = argv[i].slice("--source=".length);
    } else if (argv[i] === "--gpkg" && argv[i + 1]) {
      gpkgs.push(argv[++i]);
    } else if (argv[i]?.startsWith("--gpkg=")) {
      gpkgs.push(argv[i].slice("--gpkg=".length));
    } else if (argv[i] === "--env" && argv[i + 1]) {
      env = argv[++i] as ImportEnv;
    } else if (argv[i]?.startsWith("--env=")) {
      env = argv[i].slice("--env=".length) as ImportEnv;
    }
  }
  if (!["local", "preview", "production"].includes(env)) {
    throw new Error("--env debe ser local, preview o production.");
  }
  if (source === "msdamage") {
    if (!gpkgs.length) {
      throw new Error("--source msdamage requiere al menos un --gpkg <ruta al .gpkg/.geojson>.");
    }
    return { mode: "msdamage", gpkgs, env };
  }
  if (!aoiName || !AOIS[aoiName]) {
    const keys = Object.keys(AOIS).join(", ");
    throw new Error(`--aoi requerido. Opciones: ${keys}`);
  }
  return { mode: "osm", aoi: aoiName, env };
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

async function runTippecanoe(input: string | string[], output: string) {
  const inputs = Array.isArray(input) ? input : [input];
  await execFileAsync(
    "tippecanoe",
    [
      "-o", output,
      "--force",
      "--minimum-zoom=14",
      "--maximum-zoom=18",
      "--drop-densest-as-needed",
      "--layer=buildings",
      ...inputs,
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

// ---------------------------------------------------------------------------
// Microsoft AI for Good — per-building damage footprints (GeoPackage)
// ---------------------------------------------------------------------------

interface OgrLayerInfo {
  name: string;
  geomCol: string;
  fields: string[];
}

async function inspectGpkg(gpkgPath: string): Promise<OgrLayerInfo> {
  const { stdout } = await execFileAsync(
    "ogrinfo",
    ["-so", "-json", gpkgPath],
    { maxBuffer: 50 * 1024 * 1024 },
  );
  const info = JSON.parse(stdout) as {
    layers: Array<{
      name: string;
      geometryFields?: Array<{ name: string }>;
      fields?: Array<{ name: string }>;
    }>;
  };
  const layer = info.layers?.[0];
  if (!layer) throw new Error("El gpkg no contiene capas.");
  return {
    name: layer.name,
    geomCol: layer.geometryFields?.[0]?.name ?? "geom",
    fields: (layer.fields ?? []).map((f) => f.name),
  };
}

// Reproject to EPSG:4326 and classify each footprint by its damage ratio,
// emitting a GeoJSON with `damage_class` (none|minimal|low|moderate|high|severe)
// that BuildingsLayer colors. Handles 0-1 and 0-100 damage scales. One GeoJSON
// per AOI; tippecanoe merges them into a single layer.
async function extractMsDamage(
  gpkgPath: string,
  outGeojson: string,
  aoi: string,
) {
  const layer = await inspectGpkg(gpkgPath);
  const damageField =
    ["damage_pct_0m", "damage_pct", "damage_ratio", "damage"].find((f) =>
      layer.fields.includes(f),
    ) ?? null;
  if (!damageField) {
    throw new Error(
      `No se encontró campo de daño en el gpkg. Campos: ${layer.fields.join(", ")}`,
    );
  }
  const idField = ["id", "fid", "building_id"].find((f) => layer.fields.includes(f));
  progress(`  Capa "${layer.name}", campo de daño "${damageField}"`);

  // Normalize to 0-1 so thresholds work whether the source is a ratio or percent.
  const ratio = `(CASE WHEN "${damageField}" > 1.0 THEN "${damageField}" / 100.0 ELSE "${damageField}" END)`;
  const damageClass =
    `CASE` +
    ` WHEN ${ratio} >= 0.8 THEN 'severe'` +
    ` WHEN ${ratio} >= 0.6 THEN 'high'` +
    ` WHEN ${ratio} >= 0.4 THEN 'moderate'` +
    ` WHEN ${ratio} >= 0.2 THEN 'low'` +
    ` WHEN ${ratio} > 0 THEN 'minimal'` +
    ` ELSE 'none' END`;
  // Namespace building_id by AOI so ids stay unique across merged datasets.
  const idSelect = idField ? `'${aoi}:' || "${idField}" AS building_id, ` : "";
  const sql =
    `SELECT "${layer.geomCol}", ${idSelect}'${aoi}' AS aoi, ${ratio} AS damage_pct, ` +
    `${damageClass} AS damage_class, 'ms-ai-for-good' AS source ` +
    `FROM "${layer.name}"`;

  await execFileAsync(
    "ogr2ogr",
    [
      "-f", "GeoJSON",
      "-t_srs", "EPSG:4326",
      "-dialect", "SQLite",
      "-sql", sql,
      outGeojson,
      gpkgPath,
    ],
    { maxBuffer: 500 * 1024 * 1024 },
  );
}

async function runOsm(aoi: string, env: ImportEnv) {
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

// Derive an AOI tag from a gpkg path (e.g. msaig-damage-la-guaira.gpkg → la-guaira).
function aoiFromPath(gpkgPath: string): string {
  const base = path.basename(gpkgPath).replace(/\.[^.]+$/, "");
  return base.replace(/^msaig-damage-/, "") || base;
}

async function runMsDamage(gpkgs: string[], env: ImportEnv) {
  progress(`Footprints de daño MS (${gpkgs.length} AOI): env: ${env}`);

  const { bucketName, r2Args } = await getMapTilesBucket(env);
  const dir = await mkdtemp(path.join(tmpdir(), "terremoto-damage-"));

  try {
    const pmtilesPath = path.join(dir, "buildings-damage.pmtiles");
    const geojsonPaths: string[] = [];

    progress("Reproyectando + clasificando daño con ogr2ogr…");
    for (let i = 0; i < gpkgs.length; i++) {
      const gpkg = gpkgs[i]!;
      const aoi = aoiFromPath(gpkg);
      progress(`[${i + 1}/${gpkgs.length}] ${aoi} (${gpkg})`);
      const out = path.join(dir, `damage-${aoi}.geojson`);
      await extractMsDamage(gpkg, out, aoi);
      geojsonPaths.push(out);
    }

    progress("Generando PMTiles con tippecanoe…");
    await runTippecanoe(geojsonPaths, pmtilesPath);

    await putR2(bucketName, r2Args, env, "tiles/buildings-damage.pmtiles", pmtilesPath);
    progress("Listo. Daño por edificio en /tiles/buildings-damage.pmtiles");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs();
  if (args.mode === "msdamage") {
    await runMsDamage(args.gpkgs, args.env);
  } else {
    await runOsm(args.aoi, args.env);
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
