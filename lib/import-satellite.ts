import { inferState } from "./import-terremoto-source";
import type { DamageType } from "./report-schema";

export type VerifiedSource = "copernicus-ems" | "maxar-opendata" | "sar-dpm";

export const COPERNICUS_EMS_SOURCE: VerifiedSource = "copernicus-ems";
export const ARIA_DPM_SOURCE = "aria-dpm";

export const AUTOTAG_RADIUS_M = 15;
// ≈15 m of latitude in degrees. Longitude is padded by /cos(lat) at call sites.
export const AUTOTAG_BBOX_DEG = 0.000135;

export interface NormalizedSatelliteReport {
  sourceName: VerifiedSource;
  sourceId: string;
  sourceUrl: string;
  buildingName: string;
  address: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  damageType: DamageType;
  description: string;
  verifiedSource: VerifiedSource;
  verifiedSourceId: string;
}

export interface DamageZoneRecord {
  id: string;
  geometry: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  centroidLat: number;
  centroidLng: number;
  damageCategory: "low" | "moderate" | "high" | "severe";
  score: number;
  sourceName: string;
  sourceId: string;
  acquiredAt: string | null;
}

export interface GeoJSONFeature {
  type?: string;
  id?: string | number;
  geometry?: {
    type: string;
    coordinates: unknown;
  } | null;
  properties?: Record<string, unknown> | null;
}

/**
 * Map an EMS-98 damage grade (numeric 1..5 or a Copernicus text label) to the
 * app's existing DamageType. `keep === false` means the feature is below the
 * reporting threshold (grade 1 / negligible / possibly damaged) and should be
 * dropped.
 */
export function mapEmsGrade(grade: string | number | null | undefined): {
  damageType: DamageType;
  keep: boolean;
} {
  if (grade === null || grade === undefined) {
    return { damageType: "severe", keep: false };
  }

  if (typeof grade === "number" || /^[0-9]+$/.test(String(grade).trim())) {
    const n = Number(grade);
    if (n >= 5) return { damageType: "collapse", keep: true };
    if (n === 4 || n === 3) return { damageType: "severe", keep: true };
    if (n === 2) return { damageType: "moderate", keep: true };
    return { damageType: "moderate", keep: false }; // grade 1 / 0
  }

  const label = String(grade)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

  if (/(completely destroyed|destroyed|collapse|total)/.test(label)) {
    return { damageType: "collapse", keep: true };
  }
  if (/(highly|very heavy|heavily|grave|severe|severo)/.test(label)) {
    return { damageType: "severe", keep: true };
  }
  if (/(moderate|substantial|partial|parcial)/.test(label)) {
    return { damageType: "moderate", keep: true };
  }
  // negligible / slight / possibly damaged / not applicable / unknown
  return { damageType: "moderate", keep: false };
}

function readProperty(
  properties: Record<string, unknown> | null | undefined,
  keys: string[],
): string | undefined {
  if (!properties) return undefined;
  for (const key of Object.keys(properties)) {
    if (keys.includes(key.toLowerCase())) {
      const value = properties[key];
      if (value !== null && value !== undefined && String(value).trim()) {
        return String(value).trim();
      }
    }
  }
  return undefined;
}

function geometryCentroid(
  geometry: GeoJSONFeature["geometry"],
): { latitude: number; longitude: number } | null {
  if (!geometry) return null;
  const coords = geometry.coordinates;

  if (geometry.type === "Point" && Array.isArray(coords)) {
    const [lng, lat] = coords as number[];
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return { latitude: lat, longitude: lng };
    }
    return null;
  }

  // Flatten any nested ring/polygon/multipolygon coordinate arrays to points.
  const points: [number, number][] = [];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      points.push([value[0], value[1]]);
      return;
    }
    for (const inner of value) walk(inner);
  };
  walk(coords);
  if (!points.length) return null;

  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of points) {
    sumLng += lng;
    sumLat += lat;
  }
  return {
    latitude: sumLat / points.length,
    longitude: sumLng / points.length,
  };
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

export function normalizeEmsFeature(
  feature: GeoJSONFeature,
  activationId: string,
):
  | NormalizedSatelliteReport
  | { skipped: true; reason: string; sourceId: string } {
  const props = feature.properties ?? {};
  const rawFeatureId =
    readProperty(props, ["obj_id", "objectid", "fid", "id", "gid"]) ??
    (feature.id !== undefined ? String(feature.id) : undefined);
  const sourceId = `${activationId}:${rawFeatureId ?? "unknown"}`;

  const gradeRaw =
    readProperty(props, [
      "grading",
      "damage_gra",
      "dmg_src_id",
      "damage",
      "grade",
      "obj_dmg",
      "notation",
      "dmg",
    ]) ?? null;
  const mapped = mapEmsGrade(gradeRaw);
  if (!mapped.keep) {
    return {
      skipped: true,
      reason: `Grado de daño bajo el umbral ("${gradeRaw ?? "desconocido"}").`,
      sourceId,
    };
  }

  const centroid = geometryCentroid(feature.geometry);
  if (!centroid) {
    return { skipped: true, reason: "Sin geometría válida.", sourceId };
  }

  const city =
    readProperty(props, ["city", "place", "town", "municipality", "localidad"]) ??
    "";
  const addressProp = readProperty(props, ["address", "street", "direccion"]);
  const state =
    readProperty(props, ["state", "estado", "admin1", "province"]) ??
    inferState({ address: addressProp ?? null, city: city || null, zone: null });
  const buildingName = truncate(
    readProperty(props, ["name", "building", "label", "nombre"]) ??
      "Edificio detectado por satélite",
    120,
  );
  const address = truncate(
    addressProp ??
      ([city, state].filter(Boolean).join(", ") ||
        "Ubicación aproximada por imagen satelital"),
    240,
  );
  // EMS grading layers carry no useful per-building prose and may contain
  // casualty/PII text, so we never pass source free-text through: always use a
  // fixed, safe description.
  const description = `Daño verificado por imagen satelital (Copernicus EMS ${activationId}).`;

  return {
    sourceName: COPERNICUS_EMS_SOURCE,
    sourceId,
    sourceUrl: `https://rapidmapping.emergency.copernicus.eu/${activationId}`,
    buildingName,
    address: address.length >= 5 ? address : "Ubicación aproximada",
    state: state || "No especificado",
    city: truncate(city || "No especificado", 120),
    latitude: centroid.latitude,
    longitude: centroid.longitude,
    damageType: mapped.damageType,
    description,
    verifiedSource: COPERNICUS_EMS_SOURCE,
    verifiedSourceId: sourceId,
  };
}

function geometryBounds(
  geometry: GeoJSONFeature["geometry"],
): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  if (!geometry) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      const [lng, lat] = value as number[];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const inner of value) walk(inner);
  };
  walk(geometry.coordinates);
  if (!Number.isFinite(minLat)) return null;
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Map a Copernicus EMS area "damage grade" (numeric or text) to a zone
 * category + a 0..1 score, for the affected-region overlay.
 */
export function categorizeEmsArea(grade: string | number | null | undefined): {
  damageCategory: DamageZoneRecord["damageCategory"];
  score: number;
} {
  const mapped = mapEmsGrade(grade);
  if (!mapped.keep) return { damageCategory: "low", score: 0.45 };
  if (mapped.damageType === "collapse") return { damageCategory: "severe", score: 0.95 };
  if (mapped.damageType === "severe") return { damageCategory: "high", score: 0.8 };
  if (mapped.damageType === "moderate") return { damageCategory: "moderate", score: 0.6 };
  return { damageCategory: "low", score: 0.45 };
}

/**
 * Convert an EMS area polygon feature (observed event / grading area) into a
 * damage_zones record, preserving its geometry and coloring it by severity.
 */
export function emsAreaFeatureToZone(
  feature: GeoJSONFeature,
  activationId: string,
): DamageZoneRecord | null {
  if (!feature.geometry) return null;
  const bounds = geometryBounds(feature.geometry);
  const centroid = geometryCentroid(feature.geometry);
  if (!bounds || !centroid) return null;

  const props = feature.properties ?? {};
  const rawFeatureId =
    readProperty(props, ["obj_id", "objectid", "fid", "id", "gid", "area_id"]) ??
    (feature.id !== undefined ? String(feature.id) : "unknown");
  const gradeRaw =
    readProperty(props, [
      "grading",
      "damage_gra",
      "dmg_src_id",
      "damage",
      "grade",
      "obj_dmg",
      "severity",
      "notation",
      "dmg",
    ]) ?? null;
  const { damageCategory, score } = categorizeEmsArea(gradeRaw);

  return {
    id: `copernicus-ems-area:${activationId}:${rawFeatureId}`,
    geometry: JSON.stringify(feature.geometry),
    minLat: bounds.minLat,
    maxLat: bounds.maxLat,
    minLng: bounds.minLng,
    maxLng: bounds.maxLng,
    centroidLat: centroid.latitude,
    centroidLng: centroid.longitude,
    damageCategory,
    score,
    sourceName: "copernicus-ems-area",
    sourceId: `${activationId}:${rawFeatureId}`,
    acquiredAt: null,
  };
}

export function categorizeZoneScore(
  score: number,
): DamageZoneRecord["damageCategory"] {
  if (score >= 0.85) return "severe";
  if (score >= 0.7) return "high";
  if (score >= 0.55) return "moderate";
  return "low";
}

/**
 * Bin a single-band damage-proxy raster (values 0..1, e.g. an ARIA DPM GeoTIFF)
 * into grid-cell polygons. `geoTransform` is the GDAL affine
 * [originX, pixelW, 0, originY, 0, pixelH] with pixelH negative.
 */
export function rasterToDamageZones(args: {
  values: Float32Array | number[];
  width: number;
  height: number;
  geoTransform: [number, number, number, number, number, number];
  productId: string;
  acquiredAt: string | null;
  cellMeters?: number;
  minScore?: number;
}): DamageZoneRecord[] {
  const {
    values,
    width,
    height,
    geoTransform,
    productId,
    acquiredAt,
    cellMeters = 500,
    minScore = 0.4,
  } = args;

  const [originX, pixelW, , originY, , pixelH] = geoTransform;
  const metersPerPixel = Math.abs(pixelW) * 111_320;
  const cellPx = Math.max(1, Math.round(cellMeters / (metersPerPixel || 1)));

  const zones: DamageZoneRecord[] = [];
  const now = new Date().toISOString();

  for (let r0 = 0; r0 < height; r0 += cellPx) {
    for (let c0 = 0; c0 < width; c0 += cellPx) {
      const r1 = Math.min(r0 + cellPx, height);
      const c1 = Math.min(c0 + cellPx, width);
      let sum = 0;
      let count = 0;
      for (let r = r0; r < r1; r += 1) {
        for (let c = c0; c < c1; c += 1) {
          const v = values[r * width + c];
          if (Number.isFinite(v) && v > 0) {
            sum += v;
            count += 1;
          }
        }
      }
      if (count === 0) continue;
      const score = sum / count;
      if (score < minScore) continue;

      const lonMin = originX + c0 * pixelW;
      const lonMax = originX + c1 * pixelW;
      const latA = originY + r0 * pixelH;
      const latB = originY + r1 * pixelH;
      const minLat = Math.min(latA, latB);
      const maxLat = Math.max(latA, latB);
      const minLng = Math.min(lonMin, lonMax);
      const maxLng = Math.max(lonMin, lonMax);
      const clamped = Math.min(1, Math.max(0, score));

      zones.push({
        id: `${ARIA_DPM_SOURCE}:${productId}:${r0}:${c0}`,
        geometry: JSON.stringify({
          type: "Polygon",
          coordinates: [
            [
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat],
            ],
          ],
        }),
        minLat,
        maxLat,
        minLng,
        maxLng,
        centroidLat: (minLat + maxLat) / 2,
        centroidLng: (minLng + maxLng) / 2,
        damageCategory: categorizeZoneScore(clamped),
        score: clamped,
        sourceName: ARIA_DPM_SOURCE,
        sourceId: `${productId}:${r0}:${c0}`,
        acquiredAt: acquiredAt ?? now,
      });
    }
  }

  return zones;
}

export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
