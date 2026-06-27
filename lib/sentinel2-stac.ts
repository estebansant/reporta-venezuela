// Sentinel-2 L2A scene search and COG band reading via Element84 Earth Search (AWS).
// No authentication required — assets are on open S3.
// Docs: https://earth-search.aws.element84.com/v1

import { upsample2x, type BandWindow } from "./change-detection";

// ---------------------------------------------------------------------------
// Simplified UTM (WGS84) projection — accurate to <1 m near the central meridian,
// <20 m at zone edges. Sufficient for computing pixel windows in Sentinel-2 COGs.
// ---------------------------------------------------------------------------

const WGS84_A = 6_378_137.0;
const WGS84_E2 = 0.006_694_379_990_14;
const UTM_K0 = 0.9996;
const UTM_FALSE_EASTING = 500_000;

function utmZoneFromLon(lon: number): number {
  return Math.floor((lon + 180) / 6) + 1;
}

function utmCentralMeridian(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

/** Convert WGS84 (degrees) to UTM easting/northing (meters) for northern hemisphere. */
export function wgs84ToUtm(lat: number, lon: number): { easting: number; northing: number; zone: number } {
  const zone = utmZoneFromLon(lon);
  const lon0 = (utmCentralMeridian(zone) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const ePrime2 = WGS84_E2 / (1 - WGS84_E2);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ePrime2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lam - lon0);

  // Meridional arc M
  const e2 = WGS84_E2;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const M =
    WGS84_A *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));

  const easting =
    UTM_K0 *
      N *
      (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ePrime2) * A ** 5) / 120) +
    UTM_FALSE_EASTING;
  const northing =
    UTM_K0 *
    (M +
      N * Math.tan(phi) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ePrime2) * A ** 6) / 720));

  return { easting, northing, zone };
}

/** Convert UTM easting/northing (meters, northern hemisphere) back to WGS84 degrees. */
export function utmToWgs84(easting: number, northing: number, zone: number): { lat: number; lon: number } {
  const e2 = WGS84_E2;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const ePrime2 = e2 / (1 - e2);
  const lon0 = (utmCentralMeridian(zone) * Math.PI) / 180;

  const x = easting - UTM_FALSE_EASTING;
  const y = northing;

  // Footpoint latitude
  const M = y / UTM_K0;
  const mu =
    M /
    (WGS84_A * (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const N1 = WGS84_A / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = ePrime2 * Math.cos(phi1) ** 2;
  const R1 = (WGS84_A * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * UTM_K0);

  const lat =
    phi1 -
    ((N1 * Math.tan(phi1)) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ePrime2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ePrime2 - 3 * C1 ** 2) * D ** 6) / 720);
  const lon =
    lon0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ePrime2 + 24 * T1 ** 2) * D ** 5) / 120) /
      Math.cos(phi1);

  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** Compute UTM easting/northing bounding box for a WGS84 bbox. */
function bboxWgs84ToUtm(bbox: [number, number, number, number]): {
  xmin: number; ymin: number; xmax: number; ymax: number; zone: number;
} {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const midLon = (minLon + maxLon) / 2;
  const zone = utmZoneFromLon(midLon);
  const corners = [
    wgs84ToUtm(minLat, minLon),
    wgs84ToUtm(minLat, maxLon),
    wgs84ToUtm(maxLat, minLon),
    wgs84ToUtm(maxLat, maxLon),
  ];
  return {
    xmin: Math.min(...corners.map((c) => c.easting)),
    ymin: Math.min(...corners.map((c) => c.northing)),
    xmax: Math.max(...corners.map((c) => c.easting)),
    ymax: Math.max(...corners.map((c) => c.northing)),
    zone,
  };
}

const STAC_SEARCH = "https://earth-search.aws.element84.com/v1/search";
const COLLECTION = "sentinel-2-l2a";

export interface S2Scene {
  id: string;
  datetime: string;
  cloudCover: number;
  sceneBbox: [number, number, number, number] | null; // [minLng, minLat, maxLng, maxLat]
  assets: Record<string, string>;
}

export async function searchS2Scenes(
  bbox: [number, number, number, number],
  dateFrom: string,
  dateTo: string,
  maxCloudCover = 50, // generous default — filter client-side after checking coverage
): Promise<S2Scene[]> {
  const body = {
    collections: [COLLECTION],
    bbox,
    datetime: `${dateFrom}T00:00:00Z/${dateTo}T23:59:59Z`,
    sortby: "-properties.datetime",
    limit: 30,
  };

  const res = await fetch(STAC_SEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`STAC search failed ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { features?: unknown[] };
  return (data.features ?? [])
    .map((f) => {
      const feat = f as Record<string, unknown>;
      const props = (feat.properties ?? {}) as Record<string, unknown>;
      const rawAssets = (feat.assets ?? {}) as Record<string, { href?: string }>;
      const assets: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawAssets)) {
        if (v.href) assets[k] = v.href;
      }
      // Extract scene bbox from geometry or bbox field
      let sceneBbox: [number, number, number, number] | null = null;
      const rawBbox = feat.bbox;
      if (Array.isArray(rawBbox) && rawBbox.length >= 4) {
        sceneBbox = rawBbox.slice(0, 4) as [number, number, number, number];
      }
      return {
        id: feat.id as string,
        datetime: String(props.datetime ?? ""),
        cloudCover: Number(props["eo:cloud_cover"] ?? 100),
        sceneBbox,
        assets,
      };
    })
    .filter(
      (s) =>
        s.cloudCover <= maxCloudCover &&
        (s.assets.red || s.assets.B04) &&
        (s.assets.nir || s.assets.B08) &&
        (s.assets.swir16 || s.assets.B11),
    )
    .sort((a, b) => a.cloudCover - b.cloudCover); // clearest first
}

// Check whether a scene's bbox intersects a target bbox (minLng, minLat, maxLng, maxLat)
export function sceneCoversbbox(
  scene: S2Scene,
  target: [number, number, number, number],
): boolean {
  if (!scene.sceneBbox) return true; // unknown → try it
  const [sl, sb, sr, st] = scene.sceneBbox;
  const [tl, tb, tr, tt] = target;
  return sl < tr && sr > tl && sb < tt && st > tb;
}

// Element84 asset key alternatives for each band
function bandUrl(assets: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (assets[k]) return assets[k];
  }
  throw new Error(`No se encontró ninguna de las bandas: ${keys.join(", ")}`);
}

interface ReadResult {
  data: Float32Array;
  width: number;
  height: number;
  originX: number;
  originY: number;
  resX: number;
  resY: number;
}

async function readBandWindow(
  url: string,
  bboxWgs84: [number, number, number, number],
): Promise<ReadResult | null> {
  const { fromUrl } = await import("geotiff");
  const tiff = await fromUrl(url);
  const image = await tiff.getImage();
  // getOrigin/getResolution return values in the image's native CRS (UTM meters for Sentinel-2)
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution(); // resY is negative (top-down)
  const W = image.getWidth();
  const H = image.getHeight();

  // Convert WGS84 bbox to UTM (same CRS as the image)
  const utmBbox = bboxWgs84ToUtm(bboxWgs84);

  // Compute pixel window: col = (easting - originX) / resX
  const c0 = Math.max(0, Math.floor((utmBbox.xmin - originX) / resX));
  const c1 = Math.min(W, Math.ceil((utmBbox.xmax - originX) / resX));
  const r0 = Math.max(0, Math.floor((utmBbox.ymax - originY) / resY)); // resY < 0, top row first
  const r1 = Math.min(H, Math.ceil((utmBbox.ymin - originY) / resY));

  // Tile doesn't cover the requested area at all
  if (c1 <= c0 || r1 <= r0 || c0 >= W || r0 >= H) return null;

  const rasters = await image.readRasters({ window: [c0, r0, c1, r1], samples: [0] });
  const raw = rasters[0] as Uint16Array | Float32Array | Int16Array;

  return {
    data: Float32Array.from(raw as ArrayLike<number>),
    width: c1 - c0,
    height: r1 - r0,
    originX: originX + c0 * resX,
    originY: originY + r0 * resY,
    resX,
    resY,
  };
}

export type S2BandWindow = BandWindow & {
  originX: number;   // UTM easting of top-left pixel (meters)
  originY: number;   // UTM northing of top-left pixel (meters)
  resX: number;      // pixel width in meters (positive)
  resY: number;      // pixel height in meters (negative, top-down)
  utmZone: number;   // UTM zone number (needed for inverse projection)
};

// Read B04 (red, 10m), B08 (nir, 10m), B11 (swir, 20m→upsampled to 10m).
// Returns null if the scene tile doesn't cover the requested bbox.
export async function readS2BandWindow(
  scene: S2Scene,
  bbox: [number, number, number, number],
): Promise<S2BandWindow | null> {
  const redUrl = bandUrl(scene.assets, "red", "B04");
  const nirUrl = bandUrl(scene.assets, "nir", "B08", "nir08a", "B8A");
  const swirUrl = bandUrl(scene.assets, "swir16", "B11");

  const [redR, nirR, swirR] = await Promise.all([
    readBandWindow(redUrl, bbox),
    readBandWindow(nirUrl, bbox),
    readBandWindow(swirUrl, bbox),
  ]);

  if (!nirR || nirR.width < 10 || nirR.height < 10) return null;
  if (!redR || !swirR) return null;

  const { width, height } = nirR;

  // SWIR is 20m — upsample 2× to match NIR pixel grid
  const swirUp =
    swirR.width === width && swirR.height === height
      ? swirR.data
      : upsample2x(swirR.data, swirR.width, swirR.height).slice(0, width * height);

  // Red may differ by ±1px due to float math — clamp to NIR dimensions
  const red =
    redR.width === width && redR.height === height
      ? redR.data
      : redR.data.slice(0, width * height);

  const midLon = (bbox[0] + bbox[2]) / 2;
  const { zone: utmZone } = wgs84ToUtm((bbox[1] + bbox[3]) / 2, midLon);

  return {
    red,
    nir: nirR.data,
    swir: swirUp,
    width,
    height,
    originX: nirR.originX,
    originY: nirR.originY,
    resX: nirR.resX,
    resY: nirR.resY,
    utmZone,
  };
}
