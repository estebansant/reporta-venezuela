import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fromUrl } from "geotiff";
import sharp from "sharp";

import {
  AUTOTAG_BBOX_DEG,
  AUTOTAG_RADIUS_M,
  emsAreaFeatureToZone,
  gdacsFeatureToZone,
  haversineMeters,
  normalizeEmsFeature,
  normalizeEmsCandidateFeature,
  rasterToDamageZones,
  shakemapFeatureToZone,
  type DamageZoneRecord,
  type GeoJSONFeature,
  type NormalizedSatelliteCandidate,
  type NormalizedSatelliteReport,
} from "../lib/import-satellite";
import {
  d1ExecFile,
  d1Json,
  fetchWithTimeout,
  getWranglerTarget,
  progress,
  sqlNumber,
  sqlString,
  uploadImage,
  type ImportEnv,
  type StoredImage,
  type WranglerTarget,
} from "./import-wrangler";

type Tier =
  | "ems"
  | "ems-local"
  | "ems-zones"
  | "zones-local"
  | "candidates"
  | "maxar"
  | "sar"
  | "usgs"
  | "gdacs";

const CHIP_HALF_PX = 64;
const MAX_WEBP_BYTES = 20 * 1024 * 1024;
const DEFAULT_EXCLUDED_LOCAL_AOIS = new Set(["08"]);

interface CliOptions {
  tier: Tier;
  env: ImportEnv;
  dryRun: boolean;
  write: boolean;
  confirmProduction: boolean;
  event?: string;
  bbox?: [number, number, number, number];
  emsUrl?: string;
  zonesUrl?: string;
  dpmUrl?: string;
  gdacsUrl?: string;
  localProducts?: string;
  usgsUrl?: string;
  eventId?: string;
  preDate?: string;
  postDates: string[];
  maxarCog?: string;
  autoScoreThreshold: number;
  limit?: number;
}

interface Summary {
  tier: Tier;
  fetched: number;
  created: number;
  autoTagged: number;
  zones: number;
  chips: number;
  skipped: number;
  errors: number;
  warnings: string[];
}

function parseArgs(argv: string[]): CliOptions {
  if (argv[0] === "--") argv = argv.slice(1);
  const options: CliOptions = {
    tier: "ems",
    env: "local",
    dryRun: true,
    write: false,
    confirmProduction: false,
    postDates: ["2026-06-26", "2026-06-25"],
    autoScoreThreshold: 0.85,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Falta valor para ${arg}.`);
      }
      index += 1;
      return value;
    };

    if (arg === "--") {
      continue;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
      options.write = false;
    } else if (arg === "--write") {
      options.write = true;
      options.dryRun = false;
    } else if (arg === "--tier") {
      const tier = next();
      if (
        ![
          "ems",
          "ems-local",
          "ems-zones",
          "zones-local",
          "candidates",
          "maxar",
          "sar",
          "usgs",
          "gdacs",
        ].includes(tier)
      ) {
        throw new Error(
          "--tier debe ser ems, ems-local, ems-zones, zones-local, candidates, maxar, sar, usgs o gdacs.",
        );
      }
      options.tier = tier as Tier;
    } else if (arg === "--zones-url") {
      options.zonesUrl = next();
    } else if (arg === "--env") {
      const env = next();
      if (!["local", "preview", "production"].includes(env)) {
        throw new Error("--env debe ser local, preview o production.");
      }
      options.env = env as ImportEnv;
    } else if (arg === "--event") {
      options.event = next();
    } else if (arg === "--ems-url") {
      options.emsUrl = next();
    } else if (arg === "--dpm-url") {
      options.dpmUrl = next();
    } else if (arg === "--gdacs-url") {
      options.gdacsUrl = next();
    } else if (arg === "--local-products") {
      options.localProducts = next();
    } else if (arg === "--usgs-url") {
      options.usgsUrl = next();
    } else if (arg === "--event-id") {
      options.eventId = next();
    } else if (arg === "--pre-date") {
      options.preDate = next();
    } else if (arg === "--post-date") {
      options.postDates = next()
        .split(",")
        .map((date) => date.trim())
        .filter(Boolean);
    } else if (arg === "--auto-score-threshold") {
      const threshold = Number(next());
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error("--auto-score-threshold debe estar entre 0 y 1.");
      }
      options.autoScoreThreshold = threshold;
    } else if (arg === "--maxar-cog") {
      options.maxarCog = next();
    } else if (arg === "--bbox") {
      const parts = next().split(",").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error("--bbox debe ser minLng,minLat,maxLng,maxLat.");
      }
      options.bbox = parts as [number, number, number, number];
    } else if (arg === "--limit") {
      const limit = Number(next());
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error("--limit debe ser un entero positivo.");
      }
      options.limit = limit;
    } else if (arg === "--confirm-production") {
      options.confirmProduction = true;
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }

  if (options.env === "production" && options.write && !options.confirmProduction) {
    throw new Error("Para escribir en producción usa también --confirm-production.");
  }

  return options;
}

// Load a GeoJSON FeatureCollection from an http(s) URL or a local file path.
async function loadFeatures(src: string): Promise<GeoJSONFeature[]> {
  let text: string;
  if (/^https?:\/\//i.test(src)) {
    progress(`Descargando ${src}`);
    const response = await fetchWithTimeout(src, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`${src} respondió ${response.status}.`);
    text = await response.text();
  } else {
    progress(`Leyendo archivo local ${src}`);
    text = await readFile(src, "utf8");
  }
  const data = JSON.parse(text) as { features?: GeoJSONFeature[] };
  return data.features ?? [];
}

async function findFiles(root: string, suffix: string) {
  const found: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith(suffix)) found.push(fullPath);
    }
  }
  await walk(root);
  return found.sort();
}

async function loadLocalProductFeatures(
  root: string,
  suffix: string,
  summary?: Summary,
): Promise<{ file: string; features: GeoJSONFeature[] }[]> {
  const files = await findFiles(root, suffix);
  const products = [];
  for (const file of files) {
    const aoi = file.match(/_AOI([0-9]+)_/i)?.[1];
    if (aoi && DEFAULT_EXCLUDED_LOCAL_AOIS.has(aoi)) {
      summary?.warnings.push(`Ignorando producto local AOI${aoi}: ${file}`);
      continue;
    }
    products.push({ file, features: await loadFeatures(file) });
  }
  return products;
}

function activationFromLocalFile(file: string, fallback: string) {
  const name = path.basename(file);
  const aoiMatch = name.match(/^(EMSR[0-9]+)_AOI([0-9]+)/i);
  if (aoiMatch) return `${aoiMatch[1]}-AOI${aoiMatch[2]}`;
  const match = name.match(/^(EMSR[0-9]+)_/i);
  return match?.[1] ?? fallback;
}

// ---------------------------------------------------------------------------
// Tier A — Copernicus EMS (authoritative, auto-publish + 15 m auto-tag)
// ---------------------------------------------------------------------------

async function findNearbyUnverifiedReportId(
  target: WranglerTarget,
  lat: number,
  lng: number,
): Promise<string | null> {
  const dLat = AUTOTAG_BBOX_DEG;
  const dLng = AUTOTAG_BBOX_DEG / Math.cos((lat * Math.PI) / 180);
  const rows = await d1Json<{ id: string; latitude: number; longitude: number }>(
    target,
    `SELECT id, latitude, longitude FROM reports
     WHERE status = 'published' AND verified_by_satellite = 0
       AND latitude BETWEEN ${sqlNumber(lat - dLat)} AND ${sqlNumber(lat + dLat)}
       AND longitude BETWEEN ${sqlNumber(lng - dLng)} AND ${sqlNumber(lng + dLng)}`,
  );
  const hit = rows.find(
    (r) => haversineMeters(lat, lng, r.latitude, r.longitude) <= AUTOTAG_RADIUS_M,
  );
  return hit?.id ?? null;
}

async function emsReportExists(target: WranglerTarget, sourceId: string) {
  const rows = await d1Json<{ id: string }>(
    target,
    `SELECT id FROM reports WHERE verified_source = 'copernicus-ems'
       AND verified_source_id = ${sqlString(sourceId)} LIMIT 1`,
  );
  return rows.length > 0;
}

function insertReportSql(report: NormalizedSatelliteReport, now: string) {
  const id = randomUUID();
  return `INSERT INTO reports (
      id, building_name, address, state, city, latitude, longitude,
      damage_type, needs_help, description, contact_consent, status,
      created_at, updated_at, verified_by_satellite, verified_at,
      verified_source, verified_source_id, source_name, source_id, source_url
    ) VALUES (
      ${sqlString(id)}, ${sqlString(report.buildingName)}, ${sqlString(report.address)},
      ${sqlString(report.state)}, ${sqlString(report.city)}, ${sqlNumber(report.latitude)},
      ${sqlNumber(report.longitude)}, ${sqlString(report.damageType)}, 0,
      ${sqlString(report.description)}, 0, 'published', ${sqlString(now)}, ${sqlString(now)},
      1, ${sqlString(now)}, ${sqlString(report.verifiedSource)}, ${sqlString(report.verifiedSourceId)},
      ${sqlString(report.sourceName)}, ${sqlString(report.sourceId)}, ${sqlString(report.sourceUrl)}
    );`;
}

function autoTagSql(reportId: string, report: NormalizedSatelliteReport, now: string) {
  return `UPDATE reports SET verified_by_satellite = 1, verified_at = ${sqlString(now)},
      verified_source = ${sqlString(report.verifiedSource)},
      verified_source_id = ${sqlString(report.verifiedSourceId)}, updated_at = ${sqlString(now)}
    WHERE id = ${sqlString(reportId)};`;
}

function candidateUpsertSql(candidate: NormalizedSatelliteCandidate, now: string) {
  const id = randomUUID();
  return `INSERT INTO satellite_candidates (
      id, latitude, longitude, suggested_damage_type, score,
      source_name, source_id, state, city, note, status, created_at
    ) VALUES (
      ${sqlString(id)}, ${sqlNumber(candidate.latitude)}, ${sqlNumber(candidate.longitude)},
      ${sqlString(candidate.suggestedDamageType)}, ${
        candidate.score === null ? "NULL" : sqlNumber(candidate.score)
      }, ${sqlString(candidate.sourceName)}, ${sqlString(candidate.sourceId)},
      ${sqlString(candidate.state)}, ${sqlString(candidate.city)}, ${sqlString(candidate.note)},
      'pending', ${sqlString(now)}
    )
    ON CONFLICT(source_name, source_id) DO UPDATE SET
      latitude = excluded.latitude, longitude = excluded.longitude,
      suggested_damage_type = excluded.suggested_damage_type,
      score = excluded.score, state = excluded.state, city = excluded.city,
      note = excluded.note;`;
}

async function runEmsTier(
  target: WranglerTarget,
  options: CliOptions,
  summary: Summary,
) {
  const activationId = options.event ?? "EMS";
  const url = options.emsUrl;
  if (!url) {
    throw new Error(
      "Tier ems requiere --ems-url <GeoJSON de la activación Copernicus EMS>.",
    );
  }

  const features = await loadFeatures(url);
  summary.fetched = features.length;

  const statements: string[] = [];
  const now = new Date().toISOString();
  let processed = 0;

  for (let fi = 0; fi < features.length; fi += 1) {
    const feature = features[fi];
    if (options.limit && processed >= options.limit) break;
    const normalized = normalizeEmsFeature(feature, activationId, fi);
    if ("skipped" in normalized) {
      summary.skipped += 1;
      continue;
    }
    processed += 1;

    if (await emsReportExists(target, normalized.sourceId)) {
      summary.skipped += 1;
      continue;
    }

    const nearbyId = await findNearbyUnverifiedReportId(
      target,
      normalized.latitude,
      normalized.longitude,
    );
    if (nearbyId) {
      statements.push(autoTagSql(nearbyId, normalized, now));
      summary.autoTagged += 1;
    } else {
      statements.push(insertReportSql(normalized, now));
      summary.created += 1;
    }
  }

  if (options.dryRun) {
    progress(`EMS (dry-run): ${statements.length} sentencias preparadas.`);
    return;
  }
  if (statements.length) await d1ExecFile(target, statements.join("\n"));
}

async function runEmsLocalTier(
  target: WranglerTarget,
  options: CliOptions,
  summary: Summary,
) {
  const root = options.localProducts ?? "EMSR884_products";
  const products = await loadLocalProductFeatures(root, "builtUpA_v1.json", summary);
  const statements: string[] = [];
  const now = new Date().toISOString();
  let processed = 0;
  const seenReports = new Set<string>();
  const seenCandidates = new Set<string>();

  for (const product of products) {
    const activationId = options.event ?? activationFromLocalFile(product.file, "EMS");
    summary.fetched += product.features.length;
    for (let fi = 0; fi < product.features.length; fi += 1) {
      if (options.limit && processed >= options.limit) break;
      const feature = product.features[fi];
      processed += 1;

      const normalized = normalizeEmsFeature(feature, activationId, fi);
      if (!("skipped" in normalized)) {
        if (seenReports.has(normalized.sourceId)) {
          summary.skipped += 1;
          continue;
        }
        seenReports.add(normalized.sourceId);
        if (options.dryRun || !(await emsReportExists(target, normalized.sourceId))) {
          statements.push(insertReportSql(normalized, now));
          summary.created += 1;
        } else {
          summary.skipped += 1;
        }
        continue;
      }

      const candidate = normalizeEmsCandidateFeature(feature, activationId, fi);
      if ("skipped" in candidate) {
        summary.skipped += 1;
        continue;
      }
      const candidateKey = `${candidate.sourceName}:${candidate.sourceId}`;
      if (seenCandidates.has(candidateKey)) {
        summary.skipped += 1;
        continue;
      }
      seenCandidates.add(candidateKey);
      statements.push(candidateUpsertSql(candidate, now));
      summary.autoTagged += 1;
    }
  }

  if (options.dryRun) {
    progress(
      `EMS local (dry-run): ${summary.created} reportes y ${summary.autoTagged} candidatos preparados.`,
    );
    return;
  }
  if (statements.length) await d1ExecFile(target, statements.join("\n"));
}

async function runCandidatesTier(
  target: WranglerTarget,
  options: CliOptions,
  summary: Summary,
) {
  const root = options.localProducts ?? "EMSR884_products";
  const products = await loadLocalProductFeatures(root, "builtUpA_v1.json", summary);
  const statements: string[] = [];
  const now = new Date().toISOString();
  let processed = 0;
  const seenCandidates = new Set<string>();

  for (const product of products) {
    const activationId = options.event ?? activationFromLocalFile(product.file, "EMS");
    summary.fetched += product.features.length;
    for (let fi = 0; fi < product.features.length; fi += 1) {
      if (options.limit && processed >= options.limit) break;
      processed += 1;
      const candidate = normalizeEmsCandidateFeature(product.features[fi], activationId, fi);
      if ("skipped" in candidate) {
        summary.skipped += 1;
        continue;
      }
      const candidateKey = `${candidate.sourceName}:${candidate.sourceId}`;
      if (seenCandidates.has(candidateKey)) {
        summary.skipped += 1;
        continue;
      }
      seenCandidates.add(candidateKey);
      statements.push(candidateUpsertSql(candidate, now));
      summary.autoTagged += 1;
    }
  }

  if (options.dryRun) {
    progress(`Candidatos (dry-run): ${summary.autoTagged} candidatos preparados.`);
    return;
  }
  if (statements.length) await d1ExecFile(target, statements.join("\n"));
}

// ---------------------------------------------------------------------------
// Tier C — ARIA Damage Proxy Map -> damage_zones (zone-level only)
// ---------------------------------------------------------------------------

function zoneUpsertSql(zone: DamageZoneRecord, now: string) {
  return `INSERT INTO damage_zones (
      id, geometry, min_lat, max_lat, min_lng, max_lng, centroid_lat, centroid_lng,
      damage_category, score, source_name, source_id, acquired_at, created_at
    ) VALUES (
      ${sqlString(zone.id)}, ${sqlString(zone.geometry)}, ${sqlNumber(zone.minLat)},
      ${sqlNumber(zone.maxLat)}, ${sqlNumber(zone.minLng)}, ${sqlNumber(zone.maxLng)},
      ${sqlNumber(zone.centroidLat)}, ${sqlNumber(zone.centroidLng)},
      ${sqlString(zone.damageCategory)}, ${sqlNumber(zone.score)},
      ${sqlString(zone.sourceName)}, ${sqlString(zone.sourceId)},
      ${sqlString(zone.acquiredAt)}, ${sqlString(now)}
    )
    ON CONFLICT(source_name, source_id) DO UPDATE SET
      geometry = excluded.geometry, min_lat = excluded.min_lat, max_lat = excluded.max_lat,
      min_lng = excluded.min_lng, max_lng = excluded.max_lng,
      centroid_lat = excluded.centroid_lat, centroid_lng = excluded.centroid_lng,
      damage_category = excluded.damage_category, score = excluded.score,
      acquired_at = excluded.acquired_at;`;
}

async function runSarTier(
  target: WranglerTarget,
  options: CliOptions,
  summary: Summary,
) {
  const url = options.dpmUrl;
  if (!url) {
    throw new Error("Tier sar requiere --dpm-url <GeoTIFF de ARIA Damage Proxy Map>.");
  }
  const productId = options.event ?? path.basename(new URL(url).pathname);

  progress(`SAR: leyendo GeoTIFF ${url}`);
  const tiff = await fromUrl(url);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution();
  const rasters = await image.readRasters({ samples: [0] });
  const band = rasters[0] as Float32Array | Uint8Array | number[];
  const values = Float32Array.from(band as ArrayLike<number>);

  const zones = rasterToDamageZones({
    values,
    width,
    height,
    geoTransform: [originX, resX, 0, originY, 0, resY],
    productId,
    acquiredAt: null,
  });
  summary.zones = zones.length;

  if (options.dryRun) {
    progress(`SAR (dry-run): ${zones.length} zonas calculadas.`);
    return;
  }

  const now = new Date().toISOString();
  const statements = zones.map((zone) => zoneUpsertSql(zone, now));
  if (statements.length) await d1ExecFile(target, statements.join("\n"));
}

// ---------------------------------------------------------------------------
// Tier ems-zones — Copernicus EMS area polygons -> damage_zones overlay
// (affected regions colored by severity, like the EMSR884 area products)
// ---------------------------------------------------------------------------

async function runEmsZonesTier(
  target: WranglerTarget,
  options: CliOptions,
  summary: Summary,
) {
  const url = options.zonesUrl;
  if (!url) {
    throw new Error(
      "Tier ems-zones requiere --zones-url <GeoJSON de áreas de la activación EMS>.",
    );
  }
  const activationId = options.event ?? "EMS";

  const features = await loadFeatures(url);
  summary.fetched = features.length;

  const zones: DamageZoneRecord[] = [];
  for (let index = 0; index < features.length; index += 1) {
    const zone = emsAreaFeatureToZone(features[index], activationId, index);
    if (zone) zones.push(zone);
    else summary.skipped += 1;
  }
  summary.zones = zones.length;

  if (options.dryRun) {
    progress(`EMS zones (dry-run): ${zones.length} áreas preparadas.`);
    return;
  }
  const now = new Date().toISOString();
  const statements = zones.map((zone) => zoneUpsertSql(zone, now));
  if (statements.length) await d1ExecFile(target, statements.join("\n"));
}

async function runZonesLocalTier(
  target: WranglerTarget,
  options: CliOptions,
  summary: Summary,
) {
  const root = options.localProducts ?? "EMSR884_products";
  const products = await loadLocalProductFeatures(root, "builtUpA_v1.json", summary);
  const zones: DamageZoneRecord[] = [];
  const seenZones = new Set<string>();

  for (const product of products) {
    const activationId = options.event ?? activationFromLocalFile(product.file, "EMS");
    summary.fetched += product.features.length;
    for (let index = 0; index < product.features.length; index += 1) {
      const zone = emsAreaFeatureToZone(product.features[index], activationId, index);
      if (!zone) {
        summary.skipped += 1;
        continue;
      }
      const zoneKey = `${zone.sourceName}:${zone.sourceId}`;
      if (seenZones.has(zoneKey)) {
        summary.skipped += 1;
        continue;
      }
      seenZones.add(zoneKey);
      zones.push(zone);
    }
  }

  summary.zones = zones.length;
  if (options.dryRun) {
    progress(`Zonas locales (dry-run): ${zones.length} zonas preparadas.`);
    return;
  }
  const now = new Date().toISOString();
  const statements = zones.map((zone) => zoneUpsertSql(zone, now));
  if (statements.length) await d1ExecFile(target, statements.join("\n"));
}

function featuresFromUnknownGeoJson(data: unknown): GeoJSONFeature[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.features)) return record.features as GeoJSONFeature[];
  if (record.type === "Feature") return [record as GeoJSONFeature];
  return [];
}

async function loadGeoJson(src: string): Promise<unknown> {
  let text: string;
  if (/^https?:\/\//i.test(src)) {
    progress(`Descargando ${src}`);
    const response = await fetchWithTimeout(src, {
      headers: { Accept: "application/json, application/geo+json" },
    });
    if (!response.ok) throw new Error(`${src} respondió ${response.status}.`);
    text = await response.text();
  } else {
    progress(`Leyendo archivo local ${src}`);
    text = await readFile(src, "utf8");
  }
  return JSON.parse(text) as unknown;
}

function findUsgsShakeMapGeoJsonUrl(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const products = (event as { properties?: { products?: Record<string, unknown[]> } })
    .properties?.products;
  const shakemaps = products?.shakemap;
  const shakemap = Array.isArray(shakemaps) ? shakemaps[0] : null;
  const contents = (shakemap as { contents?: Record<string, { url?: string }> } | null)
    ?.contents;
  if (!contents) return null;
  const candidates = Object.entries(contents)
    .filter(([key, value]) => {
      const haystack = `${key} ${value.url ?? ""}`.toLowerCase();
      return (
        haystack.endsWith(".json") &&
        (haystack.includes("cont_mi") ||
          haystack.includes("mmi") ||
          haystack.includes("intensity") ||
          haystack.includes("shape"))
      );
    })
    .map(([, value]) => value.url)
    .filter((url): url is string => Boolean(url));
  return candidates[0] ?? null;
}

async function runUsgsTier(
  target: WranglerTarget,
  options: CliOptions,
  summary: Summary,
) {
  const eventId = options.eventId ?? options.event ?? "usgs-event";
  let src = options.usgsUrl;
  if (!src) {
    if (!options.eventId) {
      throw new Error("Tier usgs requiere --event-id <id> o --usgs-url <GeoJSON>.");
    }
    const detailUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(
      options.eventId,
    )}`;
    const detail = await loadGeoJson(detailUrl);
    src = findUsgsShakeMapGeoJsonUrl(detail) ?? undefined;
    if (!src) {
      summary.warnings.push(`USGS ${options.eventId}: sin GeoJSON ShakeMap usable.`);
      return;
    }
  }

  const data = await loadGeoJson(src);
  const features = featuresFromUnknownGeoJson(data);
  summary.fetched = features.length;
  const zones = features
    .map((feature, index) => shakemapFeatureToZone(feature, eventId, index))
    .filter((zone): zone is DamageZoneRecord => Boolean(zone));
  summary.zones = zones.length;
  summary.skipped = features.length - zones.length;

  if (options.dryRun) {
    progress(`USGS (dry-run): ${zones.length} zonas preparadas.`);
    return;
  }
  const now = new Date().toISOString();
  const statements = zones.map((zone) => zoneUpsertSql(zone, now));
  if (statements.length) await d1ExecFile(target, statements.join("\n"));
}

async function runGdacsTier(
  target: WranglerTarget,
  options: CliOptions,
  summary: Summary,
) {
  const src = options.gdacsUrl;
  if (!src) {
    throw new Error("Tier gdacs requiere --gdacs-url <GeoJSON de GDACS>.");
  }
  const eventId = options.eventId ?? options.event ?? "gdacs-event";
  const data = await loadGeoJson(src);
  const features = featuresFromUnknownGeoJson(data);
  summary.fetched = features.length;
  const zones = features
    .map((feature, index) => gdacsFeatureToZone(feature, eventId, index))
    .filter((zone): zone is DamageZoneRecord => Boolean(zone));
  summary.zones = zones.length;
  summary.skipped = features.length - zones.length;

  if (options.dryRun) {
    progress(`GDACS (dry-run): ${zones.length} zonas preparadas.`);
    return;
  }
  const now = new Date().toISOString();
  const statements = zones.map((zone) => zoneUpsertSql(zone, now));
  if (statements.length) await d1ExecFile(target, statements.join("\n"));
}

// ---------------------------------------------------------------------------
// Tier B — Maxar Open Data sub-meter chips for verified reports missing an image
// ---------------------------------------------------------------------------

async function clipChip(
  cogUrl: string,
  lat: number,
  lng: number,
  dir: string,
  imageId: string,
): Promise<{ path: string; width: number; height: number; size: number } | null> {
  const tiff = await fromUrl(cogUrl);
  const image = await tiff.getImage();
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution();
  const px = Math.round((lng - originX) / resX);
  const py = Math.round((lat - originY) / resY);
  const left = px - CHIP_HALF_PX;
  const top = py - CHIP_HALF_PX;
  const right = px + CHIP_HALF_PX;
  const bottom = py + CHIP_HALF_PX;
  if (
    left < 0 ||
    top < 0 ||
    right > image.getWidth() ||
    bottom > image.getHeight()
  ) {
    return null;
  }

  const data = (await image.readRasters({
    window: [left, top, right, bottom],
    samples: [0, 1, 2],
    interleave: true,
  })) as unknown as Uint8Array;
  const w = right - left;
  const h = bottom - top;

  const outputPath = path.join(dir, `${imageId}.webp`);
  const { width, height, size } = await sharp(Buffer.from(data), {
    raw: { width: w, height: h, channels: 3 },
  })
    .webp({ quality: 60 })
    .toFile(outputPath);
  if (!width || !height || size <= 0 || size > MAX_WEBP_BYTES) return null;
  return { path: outputPath, width, height, size };
}

async function runMaxarTier(
  target: WranglerTarget,
  options: CliOptions,
  summary: Summary,
) {
  const cogUrl = options.maxarCog;
  if (!cogUrl) {
    throw new Error(
      "Tier maxar requiere --maxar-cog <URL del COG post-evento de Maxar Open Data>.",
    );
  }
  const bbox = options.bbox;
  const bboxFilter = bbox
    ? `AND r.latitude BETWEEN ${sqlNumber(bbox[1])} AND ${sqlNumber(bbox[3])}
       AND r.longitude BETWEEN ${sqlNumber(bbox[0])} AND ${sqlNumber(bbox[2])}`
    : "";

  const targets = await d1Json<{ id: string; latitude: number; longitude: number }>(
    target,
    `SELECT r.id, r.latitude, r.longitude FROM reports r
     LEFT JOIN report_images i ON i.report_id = r.id
     WHERE r.status = 'published' AND r.verified_by_satellite = 1
       AND i.id IS NULL ${bboxFilter}
     LIMIT ${options.limit ?? 200}`,
  );
  summary.fetched = targets.length;

  if (options.dryRun) {
    progress(`Maxar (dry-run): ${targets.length} reportes verificados sin imagen.`);
    return;
  }

  const dir = await mkdtemp(path.join(tmpdir(), "terremoto-satellite-chips-"));
  const now = new Date().toISOString();
  try {
    for (const report of targets) {
      const imageId = randomUUID();
      const key = `reports/${report.id}/${imageId}.webp`;
      try {
        const chip = await clipChip(
          cogUrl,
          report.latitude,
          report.longitude,
          dir,
          imageId,
        );
        if (!chip) {
          summary.skipped += 1;
          continue;
        }
        const stored: StoredImage = {
          imageId,
          key,
          path: chip.path,
          sizeBytes: chip.size,
          width: chip.width,
          height: chip.height,
          position: 0,
        };
        await uploadImage(target, stored);
        await d1ExecFile(
          target,
          `INSERT INTO report_images (
            id, report_id, r2_key, mime_type, size_bytes, width, height, position, created_at
          ) VALUES (
            ${sqlString(imageId)}, ${sqlString(report.id)}, ${sqlString(key)}, 'image/webp',
            ${sqlNumber(chip.size)}, ${sqlNumber(chip.width)}, ${sqlNumber(chip.height)}, 0, ${sqlString(now)}
          );
          UPDATE reports SET verified_source = 'maxar-opendata', updated_at = ${sqlString(now)}
            WHERE id = ${sqlString(report.id)};`,
        );
        summary.chips += 1;
      } catch (error) {
        summary.errors += 1;
        summary.warnings.push(
          `${report.id}: ${error instanceof Error ? error.message : "error clip"}`,
        );
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary: Summary = {
    tier: options.tier,
    fetched: 0,
    created: 0,
    autoTagged: 0,
    zones: 0,
    chips: 0,
    skipped: 0,
    errors: 0,
    warnings: [],
  };

  const target = await getWranglerTarget(options.env);
  progress(`Tier ${options.tier} | env=${options.env} | ${options.dryRun ? "dry-run" : "write"}`);

  if (options.tier === "ems") await runEmsTier(target, options, summary);
  else if (options.tier === "ems-local")
    await runEmsLocalTier(target, options, summary);
  else if (options.tier === "ems-zones")
    await runEmsZonesTier(target, options, summary);
  else if (options.tier === "zones-local")
    await runZonesLocalTier(target, options, summary);
  else if (options.tier === "candidates")
    await runCandidatesTier(target, options, summary);
  else if (options.tier === "sar") await runSarTier(target, options, summary);
  else if (options.tier === "usgs") await runUsgsTier(target, options, summary);
  else if (options.tier === "gdacs") await runGdacsTier(target, options, summary);
  else await runMaxarTier(target, options, summary);

  console.log(
    JSON.stringify(
      { mode: options.dryRun ? "dry-run" : "write", env: options.env, summary },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
