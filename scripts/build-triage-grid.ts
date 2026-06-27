#!/usr/bin/env tsx
// Fuse medium-res damage signals into review candidates.
//
// Usage:
//   pnpm build:triage --aoi yaracuy
//   pnpm build:triage --aoi yaracuy --write
//   pnpm build:triage --bbox -69.0,10.0,-68.4,10.7 --write --env production --confirm-production

import { randomUUID } from "node:crypto";

import {
  TRIAGE_SOURCE,
  buildTriageCandidates,
  type BBox,
  type DamageSignal,
  type ImagerySceneCoverage,
  type ReportPoint,
  type TriageCandidate,
} from "../lib/triage-grid";
import {
  d1ExecFile,
  d1Json,
  getWranglerTarget,
  progress,
  sqlNumber,
  sqlString,
  type ImportEnv,
  type WranglerTarget,
} from "./import-wrangler";

const AOIS: Record<string, { bbox: BBox; label: string }> = {
  yaracuy: { bbox: { minLng: -69.0, minLat: 10.0, maxLng: -68.4, maxLat: 10.7 }, label: "Yaracuy" },
  lara: { bbox: { minLng: -70.0, minLat: 9.9, maxLng: -69.0, maxLat: 10.5 }, label: "Lara / Barquisimeto" },
  falcon: { bbox: { minLng: -68.5, minLat: 10.5, maxLng: -67.8, maxLat: 11.4 }, label: "Falcón" },
  tucacas: { bbox: { minLng: -68.4, minLat: 10.7, maxLng: -68.0, maxLat: 11.0 }, label: "Tucacas" },
  "catia-la-mar": { bbox: { minLng: -67.1, minLat: 10.5, maxLng: -66.8, maxLat: 10.7 }, label: "Catia La Mar" },
};

interface Options {
  env: ImportEnv;
  dryRun: boolean;
  write: boolean;
  confirmProduction: boolean;
  aoi?: string;
  bbox?: BBox;
  cellMeters: number;
  minScore: number;
  limit: number;
  reportRadiusMeters: number;
  requireBuildingSignal: boolean;
}

interface DamageZoneRow {
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  source_name: string;
  source_id: string;
  score: number;
  damage_category: string;
}

interface ReportRow {
  latitude: number;
  longitude: number;
  damage_type: ReportPoint["damageType"];
  status: string | null;
}

interface SceneRow {
  scene_id: string;
  r2_key: string;
  provider: string;
  phase: string | null;
  datetime: string | null;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  resolution_m: number | null;
}

function parseArgs(argv: string[]): Options {
  if (argv[0] === "--") argv = argv.slice(1);
  const opts: Options = {
    env: "local",
    dryRun: true,
    write: false,
    confirmProduction: false,
    cellMeters: 200,
    minScore: 0.35,
    limit: 300,
    reportRadiusMeters: 350,
    requireBuildingSignal: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Falta valor para ${arg}.`);
      i += 1;
      return value;
    };

    if (arg === "--dry-run") {
      opts.dryRun = true;
      opts.write = false;
    } else if (arg === "--write") {
      opts.write = true;
      opts.dryRun = false;
    } else if (arg === "--env") {
      const env = next();
      if (!["local", "preview", "production"].includes(env)) throw new Error("--env debe ser local, preview o production.");
      opts.env = env as ImportEnv;
    } else if (arg === "--confirm-production") {
      opts.confirmProduction = true;
    } else if (arg === "--aoi") {
      opts.aoi = next();
    } else if (arg === "--bbox") {
      const parts = next().split(",").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error("--bbox debe ser minLng,minLat,maxLng,maxLat.");
      }
      opts.bbox = { minLng: parts[0], minLat: parts[1], maxLng: parts[2], maxLat: parts[3] };
    } else if (arg === "--cell-meters") {
      opts.cellMeters = readNumber(next(), "--cell-meters", 100, 250);
    } else if (arg === "--min-score") {
      opts.minScore = readNumber(next(), "--min-score", 0, 1);
    } else if (arg === "--limit") {
      opts.limit = Math.round(readNumber(next(), "--limit", 1, 5000));
    } else if (arg === "--report-radius-meters") {
      opts.reportRadiusMeters = readNumber(next(), "--report-radius-meters", 1, 5000);
    } else if (arg === "--no-building-signal-gate") {
      opts.requireBuildingSignal = false;
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }

  if (!opts.aoi && !opts.bbox) {
    throw new Error(`Usa --aoi (${Object.keys(AOIS).join(", ")}) o --bbox minLng,minLat,maxLng,maxLat.`);
  }
  if (opts.aoi && !AOIS[opts.aoi]) throw new Error(`AOI desconocido. Opciones: ${Object.keys(AOIS).join(", ")}.`);
  if (opts.env === "production" && opts.write && !opts.confirmProduction) {
    throw new Error("Para escribir en producción usa también --confirm-production.");
  }
  return opts;
}

function readNumber(raw: string, name: string, min: number, max: number) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} debe estar entre ${min} y ${max}.`);
  return value;
}

function selectedBbox(opts: Options) {
  if (opts.bbox) return { bbox: opts.bbox, label: "bbox manual" };
  const aoi = AOIS[opts.aoi!];
  return { bbox: aoi.bbox, label: aoi.label };
}

async function loadInputs(target: WranglerTarget, bbox: BBox) {
  const zoneSql = `SELECT min_lat, max_lat, min_lng, max_lng, source_name, source_id, score, damage_category
    FROM damage_zones
    WHERE max_lat >= ${sqlNumber(bbox.minLat)}
      AND min_lat <= ${sqlNumber(bbox.maxLat)}
      AND max_lng >= ${sqlNumber(bbox.minLng)}
      AND min_lng <= ${sqlNumber(bbox.maxLng)}
      AND source_name IN ('sentinel2-change', 'aria-dpm', 'sentinel1-coherence', 'usgs-shakemap', 'gdacs')`;
  const reportsSql = `SELECT latitude, longitude, damage_type, status
    FROM reports
    WHERE latitude BETWEEN ${sqlNumber(bbox.minLat)} AND ${sqlNumber(bbox.maxLat)}
      AND longitude BETWEEN ${sqlNumber(bbox.minLng)} AND ${sqlNumber(bbox.maxLng)}
      AND status = 'published'`;
  const scenesSql = `SELECT scene_id, r2_key, provider, phase, datetime, min_lat, max_lat, min_lng, max_lng, resolution_m
    FROM imagery_scenes
    WHERE max_lat >= ${sqlNumber(bbox.minLat)}
      AND min_lat <= ${sqlNumber(bbox.maxLat)}
      AND max_lng >= ${sqlNumber(bbox.minLng)}
      AND min_lng <= ${sqlNumber(bbox.maxLng)}
      AND phase = 'post'`;

  const [zones, reports, scenes] = await Promise.all([
    d1Json<DamageZoneRow>(target, zoneSql),
    d1Json<ReportRow>(target, reportsSql),
    d1Json<SceneRow>(target, scenesSql).catch((error) => {
      if (error instanceof Error && error.message.toLowerCase().includes("no such table: imagery_scenes")) return [];
      throw error;
    }),
  ]);

  return {
    damageSignals: zones.map(
      (row): DamageSignal => ({
        minLat: row.min_lat,
        maxLat: row.max_lat,
        minLng: row.min_lng,
        maxLng: row.max_lng,
        sourceName: row.source_name,
        sourceId: row.source_id,
        score: row.score,
        damageCategory: row.damage_category,
      }),
    ),
    reports: reports.map(
      (row): ReportPoint => ({
        latitude: row.latitude,
        longitude: row.longitude,
        damageType: row.damage_type,
        status: row.status,
      }),
    ),
    scenes: scenes.map(
      (row): ImagerySceneCoverage => ({
        sceneId: row.scene_id,
        r2Key: row.r2_key,
        provider: row.provider,
        phase: row.phase,
        datetime: row.datetime,
        minLat: row.min_lat,
        maxLat: row.max_lat,
        minLng: row.min_lng,
        maxLng: row.max_lng,
        resolutionM: row.resolution_m,
      }),
    ),
  };
}

function candidateSql(candidate: TriageCandidate, now: string) {
  const id = randomUUID();
  return `INSERT INTO satellite_candidates (
      id, latitude, longitude, suggested_damage_type, score,
      chip_r2_key, vhr_scene_id, vhr_r2_key,
      source_name, source_id, state, city, note, status, created_at
    ) VALUES (
      ${sqlString(id)}, ${sqlNumber(candidate.centroidLat)}, ${sqlNumber(candidate.centroidLng)},
      ${sqlString(candidate.suggestedDamageType)}, ${sqlNumber(candidate.score)},
      NULL, ${sqlString(candidate.vhrSceneId)}, ${sqlString(candidate.vhrR2Key)},
      ${sqlString(TRIAGE_SOURCE)}, ${sqlString(candidate.sourceId)},
      NULL, NULL, ${sqlString(candidate.note)}, 'pending', ${sqlString(now)}
    )
    ON CONFLICT(source_name, source_id) DO UPDATE SET
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      suggested_damage_type = excluded.suggested_damage_type,
      score = excluded.score,
      vhr_scene_id = excluded.vhr_scene_id,
      vhr_r2_key = excluded.vhr_r2_key,
      note = excluded.note,
      status = CASE WHEN satellite_candidates.status = 'pending' THEN 'pending' ELSE satellite_candidates.status END;`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = await getWranglerTarget(opts.env);
  const { bbox, label } = selectedBbox(opts);

  progress(`Triage grid | env=${opts.env} | ${opts.dryRun ? "dry-run" : "write"} | ${label}`);
  progress(`bbox=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat} | cell=${opts.cellMeters}m`);

  const inputs = await loadInputs(target, bbox);
  progress(`Señales: zones=${inputs.damageSignals.length}, reports=${inputs.reports.length}, vhr=${inputs.scenes.length}`);

  const candidates = buildTriageCandidates({
    bbox,
    cellMeters: opts.cellMeters,
    damageSignals: inputs.damageSignals,
    reports: inputs.reports,
    scenes: inputs.scenes,
    minScore: opts.minScore,
    limit: opts.limit,
    requireBuildingSignal: opts.requireBuildingSignal,
    reportRadiusMeters: opts.reportRadiusMeters,
  });

  if (opts.dryRun) {
    console.log(JSON.stringify({ mode: "dry-run", candidates: candidates.slice(0, 20) }, null, 2));
    return;
  }

  const now = new Date().toISOString();
  if (candidates.length) await d1ExecFile(target, candidates.map((candidate) => candidateSql(candidate, now)).join("\n"));
  console.log(JSON.stringify({ mode: "write", candidates: candidates.length }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
