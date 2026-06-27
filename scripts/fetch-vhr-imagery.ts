#!/usr/bin/env tsx
// Discovers and downloads VHR (Very High Resolution) imagery for the Venezuela
// earthquake (Jun 24 2026) from three opportunistic sources:
//   maxar  — Maxar Open Data (AWS S3 STAC, CC BY-NC 4.0)
//   oam    — OpenAerialMap / HOT (public API, no auth)
//   msaig  — Microsoft AI for Good / HDX (CKAN API)
//
// Usage:
//   pnpm fetch:vhr --source maxar [--bbox minLng,minLat,maxLng,maxLat]
//   pnpm fetch:vhr --source oam   [--bbox ...]
//   pnpm fetch:vhr --source msaig
//
// On success: prints local filename to stdout, import command to stderr.
// On failure: prints alternatives and exits 1.

import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Venezuela approximate bbox — widened to catch coastal+Caracas metro scenes.
const VEN_BBOX = { minLng: -73.3, minLat: 0.6, maxLng: -59.9, maxLat: 12.3 };
const VEN_TERMS = [
  "Venezuela",
  "VEN",
  "Yaracuy",
  "Caracas",
  "20260624",
  "20260625",
  "catia",
  "earthquake",
  "terremoto",
];

// Event date window
const PRE_BEFORE = "2026-06-24";
const POST_AFTER = "2026-06-24";

function progress(msg: string) {
  process.stderr.write(`[fetch-vhr] ${msg}\n`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function download(tifUrl: string, hint: string): Promise<string> {
  const filename =
    hint ||
    decodeURIComponent(new URL(tifUrl).pathname.split("/").pop() ?? "vhr-imagery.tif");
  progress(`Descargando ${tifUrl} → ${filename}`);
  const res = await fetch(tifUrl, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok || !res.body)
    throw new Error(`Descarga fallida: ${res.status} ${tifUrl}`);
  const contentLength = res.headers.get("content-length");
  if (contentLength)
    progress(`Tamaño: ${(Number(contentLength) / 1_048_576).toFixed(1)} MB`);
  await pipeline(
    Readable.fromWeb(res.body as import("stream/web").ReadableStream),
    createWriteStream(filename),
  );
  progress(`Descargado: ${filename}`);
  return filename;
}

// ---------------------------------------------------------------------------
// Maxar Open Data — S3 STAC catalog
// ---------------------------------------------------------------------------

async function fetchMaxar(bbox: typeof VEN_BBOX): Promise<string | null> {
  const MAXAR_S3 = "https://maxar-opendata.s3.amazonaws.com";
  progress("Maxar Open Data: listando eventos en S3...");

  let xml: string;
  try {
    xml = await fetchText(
      `${MAXAR_S3}/?list-type=2&prefix=events/&delimiter=/`,
    );
  } catch (err) {
    progress(`Maxar S3 no accesible: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  // Extract common prefixes (event directories) from S3 XML.
  const prefixes = [...xml.matchAll(/<Prefix>(events\/[^<]+\/)<\/Prefix>/g)].map(
    (m) => m[1],
  );

  const candidates = prefixes
    .map((prefix) => ({
      prefix,
      score: VEN_TERMS.filter((t) => prefix.toLowerCase().includes(t.toLowerCase()))
        .length,
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    progress("Maxar: no se encontraron eventos de Venezuela.");
    return null;
  }

  progress(`Maxar: ${candidates.length} directorios candidatos.`);

  for (const { prefix } of candidates) {
    progress(`Revisando ${prefix}`);
    try {
      const listing = await fetchText(
        `${MAXAR_S3}/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=200`,
      );
      const keys = [...listing.matchAll(/<Key>([^<]+\.tiff?)<\/Key>/gi)].map(
        (m) => m[1],
      );
      // Prefer post-event files
      const postKeys = keys.filter((k) =>
        k.toLowerCase().includes("post") ||
        k.includes("20260625") ||
        k.includes("20260626"),
      );
      const targetKey = (postKeys[0] ?? keys[0]);
      if (targetKey) {
        const url = `${MAXAR_S3}/${targetKey}`;
        const filename = `maxar-${targetKey.split("/").pop()}`;
        const local = await download(url, filename);
        const sceneId = targetKey.split("/").slice(1, -1).join("-") || "maxar-scene";
        printImportCmd(local, "maxar-open-data", "post", sceneId);
        return local;
      }
    } catch (err) {
      progress(`Error en ${prefix}: ${err instanceof Error ? err.message : err}`);
    }
  }

  progress("Maxar: directorios candidatos no contienen GeoTIFFs aún.");
  return null;
}

// ---------------------------------------------------------------------------
// OpenAerialMap — public REST API
// ---------------------------------------------------------------------------

interface OamMeta {
  results: Array<{
    _id: string;
    title: string;
    acquisition_start: string;
    acquisition_end: string;
    bbox: [number, number, number, number];
    download_path: string;
    properties?: { gsd?: number };
    license?: string;
  }>;
  meta: { found: number };
}

function bboxOverlaps(
  a: { minLng: number; minLat: number; maxLng: number; maxLat: number },
  b: [number, number, number, number],
): boolean {
  const [bMinLng, bMinLat, bMaxLng, bMaxLat] = b;
  return (
    a.maxLng >= bMinLng &&
    a.minLng <= bMaxLng &&
    a.maxLat >= bMinLat &&
    a.minLat <= bMaxLat
  );
}

async function fetchOam(bbox: typeof VEN_BBOX): Promise<string | null> {
  progress("OpenAerialMap: consultando API...");

  const bboxParam = `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
  const url =
    `https://api.openaerialmap.org/meta?bbox=${bboxParam}` +
    `&acquisition_from=${POST_AFTER}&limit=20&order_by=acquisition_end&sort=desc`;

  let data: OamMeta;
  try {
    data = await fetchJson<OamMeta>(url);
  } catch (err) {
    progress(`OAM API error: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  progress(`OAM: ${data.meta.found} imágenes encontradas en Venezuela.`);

  // Prefer the most recent with a direct download path.
  const tifResults = data.results.filter(
    (r) =>
      r.download_path &&
      (r.download_path.endsWith(".tif") || r.download_path.endsWith(".tiff")) &&
      bboxOverlaps(bbox, r.bbox),
  );

  if (!tifResults.length) {
    progress("OAM: ninguna imagen GeoTIFF descargable en Venezuela.");
    return null;
  }

  const result = tifResults[0];
  const filename = `oam-${result._id}.tif`;
  const local = await download(result.download_path, filename);
  const phase =
    result.acquisition_start < PRE_BEFORE ? "pre" : "post";
  printImportCmd(local, "openaerialmap", phase, result._id, {
    datetime: result.acquisition_start,
    resolutionM: result.properties?.gsd,
    license: result.license,
  });
  return local;
}

// ---------------------------------------------------------------------------
// MS AI for Good / HDX — CKAN API
// ---------------------------------------------------------------------------

interface HdxPackage {
  result: {
    id: string;
    title: string;
    resources: Array<{
      id: string;
      name: string;
      url: string;
      format: string;
    }>;
  };
}

const HDX_API = "https://data.humdata.org/api/3/action";

// Microsoft AI for Good per-event damage datasets on HDX (one per AOI).
// Add new AOIs here as Microsoft publishes them.
const MSAIG_DATASETS = [
  { slug: "venezuela-earthquakes-catia-la-mar", aoi: "catia-la-mar" },
  { slug: "venezuela-earthquakes-building-damage-assessment-in-la-guaira", aoi: "la-guaira" },
  { slug: "venezuela-earthquakes-building-damage-assessment-in-caraballeda", aoi: "caraballeda" },
];

type HdxResource = HdxPackage["result"]["resources"][number];

// Building-damage footprints come as a vector resource (GeoPackage / GeoJSON /
// zipped Shapefile). Score candidates so the actual footprints win over
// auxiliary vectors like the AOI/valid-area mask.
function pickVectorResource(resources: HdxResource[]): HdxResource | undefined {
  return resources
    .map((r) => {
      const fmt = r.format.toUpperCase();
      const url = r.url.toLowerCase();
      const name = (r.name ?? "").toLowerCase();
      const isVector =
        fmt === "GEOPACKAGE" || fmt === "GPKG" || fmt === "GEOJSON" || fmt === "SHP" ||
        url.endsWith(".gpkg") || url.endsWith(".geojson") ||
        (url.endsWith(".zip") && /shp|shape|footprint|damage|building/.test(url));
      if (!isVector) return null;
      let score = 0;
      if (/footprint|damage|building|prediction/.test(name)) score += 3;
      if (fmt === "GEOPACKAGE" || fmt === "GPKG" || url.endsWith(".gpkg")) score += 2;
      if (/mask|valid_area|aoi|extent/.test(name)) score -= 5; // auxiliary, not footprints
      return { r, score };
    })
    .filter((x): x is { r: HdxResource; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)[0]?.r;
}

async function fetchMsaig(): Promise<string | null> {
  progress("MS AI for Good / HDX: descargando datasets de daño por AOI...");

  const downloaded: string[] = [];

  for (const { slug, aoi } of MSAIG_DATASETS) {
    let pkg: HdxPackage;
    try {
      pkg = await fetchJson<HdxPackage>(`${HDX_API}/package_show?id=${slug}`);
    } catch (err) {
      progress(`HDX: ${aoi} (${slug}) no disponible: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const vec = pickVectorResource(pkg.result.resources);
    if (!vec) {
      progress(`HDX: ${aoi} sin recurso vector de footprints.`);
      continue;
    }
    const ext =
      vec.url.toLowerCase().endsWith(".geojson") ? "geojson"
      : vec.url.toLowerCase().endsWith(".zip") ? "zip"
      : "gpkg";
    const local = await download(vec.url, `msaig-damage-${aoi}.${ext}`);
    downloaded.push(local);
    progress(`HDX: ${aoi} ✓ (${pkg.result.title})`);
  }

  if (!downloaded.length) {
    progress("HDX: no se descargó ningún dataset de daño.");
    return null;
  }

  progress("");
  progress("Footprints de daño descargados. Genera PMTiles coloreados (todos los AOIs en una capa) con:");
  progress(`  pnpm extract:damage ${downloaded.map((f) => `--gpkg ${f}`).join(" ")}`);
  return downloaded.join(" ");
}

// ---------------------------------------------------------------------------
// CLI plumbing
// ---------------------------------------------------------------------------

function printImportCmd(
  localPath: string,
  provider: string,
  phase: string,
  sceneId: string,
  extra?: { datetime?: string; resolutionM?: number; license?: string },
) {
  const parts = [
    `pnpm import:satellite:vhr`,
    `--cog-path ${localPath}`,
    `--provider ${provider}`,
    `--phase ${phase}`,
    `--scene-id ${sceneId}`,
    `--write`,
  ];
  if (extra?.datetime) parts.push(`--datetime ${extra.datetime}`);
  if (extra?.resolutionM) parts.push(`--resolution-m ${extra.resolutionM}`);
  if (extra?.license) parts.push(`--license "${extra.license}"`);
  progress("");
  progress("Importa con:");
  progress(`  ${parts.join(" \\\n    ")}`);
  console.log(localPath);
}

function printAlternatives() {
  progress("");
  progress("Fuentes VHR para Venezuela:");
  progress("  Maxar Open Data:     https://maxar-opendata.s3.amazonaws.com/events/");
  progress("  OpenAerialMap:       https://openaerialmap.org/#/?zoom=8&lat=10.4&lng=-66.9");
  progress("  MS AI for Good/HDX:  https://data.humdata.org/organization/microsoft");
  progress("");
  progress("Con un .tif local:");
  progress(
    "  pnpm import:satellite:vhr --cog-path <archivo.tif> --provider <fuente> --phase post --write",
  );
}

function parseArgs(argv: string[]) {
  const opts = {
    source: "msaig" as "maxar" | "oam" | "msaig",
    bbox: VEN_BBOX,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source") {
      const v = argv[++i];
      if (v !== "maxar" && v !== "oam" && v !== "msaig")
        throw new Error(`--source debe ser maxar, oam o msaig.`);
      opts.source = v;
    } else if (arg === "--bbox") {
      const parts = argv[++i].split(",").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)))
        throw new Error("--bbox debe ser minLng,minLat,maxLng,maxLat.");
      opts.bbox = {
        minLng: parts[0],
        minLat: parts[1],
        maxLng: parts[2],
        maxLat: parts[3],
      };
    } else if (arg !== "--") {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  progress(`Fuente: ${opts.source}`);

  let result: string | null = null;

  if (opts.source === "maxar") result = await fetchMaxar(opts.bbox);
  else if (opts.source === "oam") result = await fetchOam(opts.bbox);
  else result = await fetchMsaig();

  if (!result) {
    printAlternatives();
    process.exit(1);
  }
}

main().catch((err) => {
  progress(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
