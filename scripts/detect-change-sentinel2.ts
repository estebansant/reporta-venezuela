#!/usr/bin/env tsx
// Pre/post change detection using Sentinel-2 L2A imagery.
// Fetches scenes from Element84 Earth Search (AWS STAC, no auth required).
// Writes grid-cell damage zones to damage_zones with source_name='sentinel2-change'.
//
// Usage:
//   pnpm detect:sentinel2                          # dry-run
//   pnpm detect:sentinel2 --write                  # write to local D1
//   pnpm detect:sentinel2 --write --env production --confirm-production
//   pnpm detect:sentinel2 --pre-scene <id> --post-scene <id>   # pin specific scenes

import { scoreCell } from "../lib/change-detection";
import { searchS2Scenes, readS2BandWindow, sceneCoversbbox, utmToWgs84, type S2Scene, type S2BandWindow } from "../lib/sentinel2-stac";
import { categorizeZoneScore, type DamageZoneRecord } from "../lib/import-satellite";
import {
  d1ExecFile,
  getWranglerTarget,
  progress,
  sqlNumber,
  sqlString,
  type ImportEnv,
} from "./import-wrangler";

// AOI: Yaracuy (epicentro) + Carabobo + Aragua + Miranda + La Guaira + Caracas
// Wider bbox to capture all MGRS 19P tiles covering the impact zone (10-11°N)
const BBOX: [number, number, number, number] = [-71, 9.5, -65, 12.0];
const PRE_FROM = "2026-05-01";
const PRE_TO = "2026-06-23";
const POST_FROM = "2026-06-25";
const POST_TO = "2026-08-01"; // 5-week window to guarantee at least one clear pass
const CELL_METERS = 500;
const MIN_SCORE = 0.45;
const SOURCE_NAME = "sentinel2-change";

interface Options {
  env: ImportEnv;
  dryRun: boolean;
  write: boolean;
  confirmProduction: boolean;
  preSceneId?: string;
  postSceneId?: string;
  maxPreCloud: number;
  maxPostCloud: number;
}

function parseArgs(argv: string[]): Options {
  if (argv[0] === "--") argv = argv.slice(1);
  const opts: Options = {
    env: "local",
    dryRun: true,
    write: false,
    confirmProduction: false,
    maxPreCloud: 30,
    maxPostCloud: 80, // tropical Venezuela — accept partially cloudy post-event scenes
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw new Error(`Falta valor para ${arg}.`);
      return argv[++i];
    };
    if (arg === "--dry-run") { opts.dryRun = true; opts.write = false; }
    else if (arg === "--write") { opts.write = true; opts.dryRun = false; }
    else if (arg === "--env") opts.env = next() as ImportEnv;
    else if (arg === "--pre-scene") opts.preSceneId = next();
    else if (arg === "--post-scene") opts.postSceneId = next();
    else if (arg === "--max-pre-cloud") opts.maxPreCloud = Number(next());
    else if (arg === "--max-post-cloud") opts.maxPostCloud = Number(next());
    else if (arg === "--confirm-production") opts.confirmProduction = true;
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (opts.env === "production" && opts.write && !opts.confirmProduction) {
    throw new Error("Para escribir en producción usa también --confirm-production.");
  }
  return opts;
}

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
      ${zone.acquiredAt ? sqlString(zone.acquiredAt) : "NULL"}, ${sqlString(now)}
    )
    ON CONFLICT(source_name, source_id) DO UPDATE SET
      geometry = excluded.geometry, min_lat = excluded.min_lat, max_lat = excluded.max_lat,
      min_lng = excluded.min_lng, max_lng = excluded.max_lng,
      centroid_lat = excluded.centroid_lat, centroid_lng = excluded.centroid_lng,
      damage_category = excluded.damage_category, score = excluded.score,
      acquired_at = excluded.acquired_at;`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = await getWranglerTarget(opts.env);

  progress(`Sentinel-2 change detection | env=${opts.env} | ${opts.dryRun ? "dry-run" : "write"}`);
  progress(`AOI bbox: ${BBOX.join(", ")}`);

  // Helper: try each scene in a list until one covers the bbox
  async function findCoveringBands(
    scenes: S2Scene[],
    label: string,
    pinnedId?: string,
  ): Promise<{ scene: S2Scene; bands: S2BandWindow }> {
    const ordered = pinnedId
      ? [scenes.find((s) => s.id === pinnedId) ?? scenes[0], ...scenes.filter((s) => s.id !== pinnedId)]
      : scenes;
    for (const scene of ordered) {
      if (!sceneCoversbbox(scene, BBOX)) {
        progress(`  ${scene.id}: bbox no cubre AOI, probando siguiente...`);
        continue;
      }
      progress(`  Leyendo ${scene.id} (nube: ${scene.cloudCover.toFixed(1)}%)...`);
      const bands = await readS2BandWindow(scene, BBOX);
      if (!bands) {
        progress(`  ${scene.id}: tile fuera de rango, probando siguiente...`);
        continue;
      }
      progress(`${label}: ${scene.id} | ${scene.datetime} | ${bands.width}×${bands.height} px`);
      return { scene, bands };
    }
    throw new Error(`Ninguna de las ${scenes.length} escenas ${label} cubre el AOI de Venezuela.`);
  }

  // --- 1. Find scenes ---
  progress(`Buscando escenas pre-evento (${PRE_FROM} → ${PRE_TO}, nube < ${opts.maxPreCloud}%)...`);
  const preScenes = await searchS2Scenes(BBOX, PRE_FROM, PRE_TO, opts.maxPreCloud);
  if (preScenes.length === 0) {
    throw new Error(`No hay escenas Sentinel-2 pre-evento con nubosidad < ${opts.maxPreCloud}%.`);
  }
  progress(`Encontradas ${preScenes.length} escenas pre-evento.`);

  progress(`Buscando escenas post-evento (${POST_FROM} → ${POST_TO}, nube < ${opts.maxPostCloud}%)...`);
  const postScenes = await searchS2Scenes(BBOX, POST_FROM, POST_TO, opts.maxPostCloud);
  if (postScenes.length === 0) {
    throw new Error(`No hay escenas Sentinel-2 post-evento con nubosidad < ${opts.maxPostCloud}%.`);
  }
  progress(`Encontradas ${postScenes.length} escenas post-evento.`);

  // --- 2. Read bands (try each scene until one covers the AOI) ---
  const { scene: preScene, bands: preBands } = await findCoveringBands(preScenes, "Pre-evento", opts.preSceneId);
  const { scene: postScene, bands: postBands } = await findCoveringBands(postScenes, "Post-evento", opts.postSceneId);

  // Align to smallest common dimensions
  const W = Math.min(preBands.width, postBands.width);
  const H = Math.min(preBands.height, postBands.height);

  // --- 3. Grid scoring ---
  const metersPerPixel = Math.abs(preBands.resX) * 111_320;
  const cellPx = Math.max(4, Math.round(CELL_METERS / metersPerPixel));
  progress(`Calculando scores | celda ${cellPx} px (≈ ${CELL_METERS} m)...`);

  const zones: DamageZoneRecord[] = [];
  const now = new Date().toISOString();
  let totalCells = 0;
  let keptCells = 0;

  for (let r0 = 0; r0 + cellPx <= H; r0 += cellPx) {
    for (let c0 = 0; c0 + cellPx <= W; c0 += cellPx) {
      const r1 = r0 + cellPx;
      const c1 = c0 + cellPx;
      totalCells++;

      const cell = scoreCell(preBands, postBands, r0, c0, r1, c1);
      if (cell.score < MIN_SCORE) continue;
      keptCells++;

      // UTM coordinates of cell corners (meters)
      const utmXmin = preBands.originX + c0 * preBands.resX;
      const utmXmax = preBands.originX + c1 * preBands.resX;
      const utmYmax = preBands.originY + r0 * preBands.resY; // resY negative, r0 is top
      const utmYmin = preBands.originY + r1 * preBands.resY;
      const zone = preBands.utmZone;

      // Convert cell corners from UTM to WGS84
      const sw = utmToWgs84(utmXmin, utmYmin, zone);
      const ne = utmToWgs84(utmXmax, utmYmax, zone);
      const minLat = sw.lat;
      const maxLat = ne.lat;
      const minLng = sw.lon;
      const maxLng = ne.lon;

      zones.push({
        id: `${SOURCE_NAME}:${preScene.id}:${postScene.id}:${r0}:${c0}`,
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
        damageCategory: categorizeZoneScore(cell.score),
        score: cell.score,
        sourceName: SOURCE_NAME,
        sourceId: `${preScene.id}:${postScene.id}:${r0}:${c0}`,
        acquiredAt: postScene.datetime,
      });
    }
  }

  progress(
    `${totalCells} celdas analizadas → ${keptCells} con score ≥ ${MIN_SCORE} → ${zones.filter((z) => z.damageCategory === "severe" || z.damageCategory === "high").length} high/severe`,
  );

  if (opts.dryRun) {
    const sample = zones
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((z) => ({
        score: z.score.toFixed(3),
        category: z.damageCategory,
        lat: z.centroidLat.toFixed(4),
        lng: z.centroidLng.toFixed(4),
      }));
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          preScene: preScene.id,
          postScene: postScene.id,
          totalCells,
          keptCells,
          zones: zones.length,
          topCells: sample,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (zones.length === 0) {
    progress("Sin zonas para escribir.");
    return;
  }

  progress(`Escribiendo ${zones.length} zonas en damage_zones...`);
  const statements = zones.map((z) => zoneUpsertSql(z, now));
  await d1ExecFile(target, statements.join("\n"));

  console.log(
    JSON.stringify(
      {
        mode: "write",
        env: opts.env,
        summary: {
          preScene: preScene.id,
          postScene: postScene.id,
          totalCells,
          zonesWritten: zones.length,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
