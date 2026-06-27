import { haversineMeters } from "./import-satellite";
import type { DamageType } from "./report-schema";

export const TRIAGE_SOURCE = "triage-grid";

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface DamageSignal extends BBox {
  sourceName: string;
  sourceId: string;
  score: number;
  damageCategory: string;
}

export interface ReportPoint {
  latitude: number;
  longitude: number;
  damageType: DamageType;
  status?: string | null;
}

export interface ImagerySceneCoverage extends BBox {
  sceneId: string;
  r2Key: string;
  provider: string;
  phase: string | null;
  datetime: string | null;
  resolutionM: number | null;
}

export interface TriageCell extends BBox {
  centroidLat: number;
  centroidLng: number;
}

export interface TriageBreakdown {
  optical: number;
  sar: number;
  shake: number;
  reports: number;
  buildingSignal: boolean;
}

export interface TriageCandidate extends TriageCell {
  score: number;
  sourceId: string;
  suggestedDamageType: DamageType;
  note: string;
  vhrSceneId: string | null;
  vhrR2Key: string | null;
  breakdown: TriageBreakdown;
}

const METERS_PER_DEGREE_LAT = 111_320;
const DAMAGE_WEIGHTS: Record<DamageType, number> = {
  cracks: 0.35,
  moderate: 0.55,
  severe: 0.8,
  collapse: 1,
};

export function bboxIntersects(a: BBox, b: BBox) {
  return a.maxLat >= b.minLat && a.minLat <= b.maxLat && a.maxLng >= b.minLng && a.minLng <= b.maxLng;
}

export function bboxContainsPoint(bbox: BBox, latitude: number, longitude: number) {
  return latitude >= bbox.minLat && latitude <= bbox.maxLat && longitude >= bbox.minLng && longitude <= bbox.maxLng;
}

export function makeGrid(bbox: BBox, cellMeters: number): TriageCell[] {
  const latStep = cellMeters / METERS_PER_DEGREE_LAT;
  const midLatRad = (((bbox.minLat + bbox.maxLat) / 2) * Math.PI) / 180;
  const lngStep = cellMeters / (METERS_PER_DEGREE_LAT * Math.max(0.1, Math.cos(midLatRad)));
  const cells: TriageCell[] = [];

  for (let minLat = bbox.minLat; minLat < bbox.maxLat; minLat += latStep) {
    const maxLat = Math.min(bbox.maxLat, minLat + latStep);
    for (let minLng = bbox.minLng; minLng < bbox.maxLng; minLng += lngStep) {
      const maxLng = Math.min(bbox.maxLng, minLng + lngStep);
      cells.push({
        minLat,
        maxLat,
        minLng,
        maxLng,
        centroidLat: (minLat + maxLat) / 2,
        centroidLng: (minLng + maxLng) / 2,
      });
    }
  }

  return cells;
}

export function maxSignalScore(cell: BBox, signals: DamageSignal[], sourceNames: Set<string>) {
  let max = 0;
  for (const signal of signals) {
    if (!sourceNames.has(signal.sourceName) || !bboxIntersects(cell, signal)) continue;
    max = Math.max(max, clamp01(signal.score));
  }
  return max;
}

export function reportAgreementScore(cell: TriageCell, reports: ReportPoint[], radiusMeters: number) {
  let max = 0;
  for (const report of reports) {
    if (report.status && report.status !== "published") continue;
    const distance = haversineMeters(cell.centroidLat, cell.centroidLng, report.latitude, report.longitude);
    if (distance > radiusMeters) continue;
    const proximity = 1 - distance / radiusMeters;
    max = Math.max(max, DAMAGE_WEIGHTS[report.damageType] * proximity);
  }
  return clamp01(max);
}

export function bestCoveringVhr(cell: TriageCell, scenes: ImagerySceneCoverage[]) {
  let best: ImagerySceneCoverage | null = null;
  for (const scene of scenes) {
    if (scene.phase !== "post" || !bboxContainsPoint(scene, cell.centroidLat, cell.centroidLng)) continue;
    if (!best) {
      best = scene;
      continue;
    }
    const bestRes = best.resolutionM ?? Number.POSITIVE_INFINITY;
    const sceneRes = scene.resolutionM ?? Number.POSITIVE_INFINITY;
    if (sceneRes < bestRes || (sceneRes === bestRes && String(scene.datetime) > String(best.datetime))) {
      best = scene;
    }
  }
  return best;
}

export function buildTriageCandidates(args: {
  bbox: BBox;
  cellMeters: number;
  damageSignals: DamageSignal[];
  reports: ReportPoint[];
  scenes: ImagerySceneCoverage[];
  minScore: number;
  limit: number;
  requireBuildingSignal: boolean;
  reportRadiusMeters: number;
}) {
  const opticalSources = new Set(["sentinel2-change"]);
  const sarSources = new Set(["aria-dpm", "sentinel1-coherence"]);
  const shakeSources = new Set(["usgs-shakemap", "gdacs"]);
  const cells = makeGrid(args.bbox, args.cellMeters);
  const candidates: TriageCandidate[] = [];

  for (const cell of cells) {
    const optical = maxSignalScore(cell, args.damageSignals, opticalSources);
    const sar = maxSignalScore(cell, args.damageSignals, sarSources);
    const shake = maxSignalScore(cell, args.damageSignals, shakeSources);
    const reports = reportAgreementScore(cell, args.reports, args.reportRadiusMeters);
    const vhr = bestCoveringVhr(cell, args.scenes);
    const buildingSignal = reports > 0 || vhr !== null;
    if (args.requireBuildingSignal && !buildingSignal) continue;

    const score = clamp01(0.3 * Math.max(sar, optical) + 0.25 * sar + 0.2 * optical + 0.15 * shake + 0.1 * reports);
    if (score < args.minScore) continue;

    candidates.push({
      ...cell,
      score,
      sourceId: `${roundCoord(cell.centroidLat)}:${roundCoord(cell.centroidLng)}:${args.cellMeters}`,
      suggestedDamageType: score >= 0.82 ? "collapse" : score >= 0.65 ? "severe" : "moderate",
      vhrSceneId: vhr?.sceneId ?? null,
      vhrR2Key: vhr?.r2Key ?? null,
      breakdown: { optical, sar, shake, reports, buildingSignal },
      note: `Triage ${Math.round(score * 100)}% | opt=${fmt(optical)} sar=${fmt(sar)} shake=${fmt(shake)} rep=${fmt(reports)}${vhr ? ` | VHR=${vhr.sceneId}` : ""}`,
    });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, args.limit);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function fmt(value: number) {
  return value.toFixed(2);
}

function roundCoord(value: number) {
  return value.toFixed(5);
}
