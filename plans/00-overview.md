# 00 · Overview e índice del plan satelital

Plan ejecutable derivado de `satellites-research-report.md`. Cada archivo `plans/NN-*.md` es una
tarea autocontenida, pensada para correrse en una sola ventana de contexto de Claude Code.

## Estado actual del repo (junio 2026)

**Hecho y operativo — NO re-implementar:**
- STAC Sentinel-2: `lib/sentinel2-stac.ts` (Element84 Earth Search, sin auth).
- Change-detection óptico NDVI/NDBI/SSIM: `lib/change-detection.ts`.
- `scripts/detect-change-sentinel2.ts` (grid 500 m, escribe `damage_zones` source `sentinel2-change`).
- Import tiers en `scripts/import-satellite.ts`: `ems`, `ems-local`, `ems-zones`, `zones-local`,
  `candidates`, `usgs`, `gdacs`, `sar` (ARIA-DPM), `maxar` (parcial).
- Tabla `damage_zones` (migración `0008`), tabla `satellite_candidates` (`0009`, soporta chips).
- API `/api/zones` con filtro bbox + fallback Copernicus local.
- Legend source-aware + toggle: `components/damage-app/map/DamageMapWithZonesToggle.tsx`,
  render de zonas (contornos USGS anidados / polígonos sólidos) en `components/damage-map.tsx`.
- Badge "Verificado por imagen satelital" en progreso en `components/damage-map.tsx`.

**Fuera de alcance (decisión del usuario):** más overlays de categorías de daño (Copernicus/USGS ya
funcionan). El foco es **imagen satelital del terreno donde se distingan edificios** (raster VHR).

**Gaps a construir:** servir/renderizar COG VHR, ingestar imágenes VHR pre/post, huellas de
edificios, offload de lecturas D1→R2, grid de triage que dirija la captura VHR, y la consola admin
de evidencia pre/post a nivel edificio.

## Stack confirmado
Next 16.2.9 · React 19 · opennextjs-cloudflare (Workers) · D1 binding `DB` · R2 binding
`REPORT_IMAGES` · Leaflet + react-leaflet · deps `geotiff` y `sharp` · `zod` · vitest
(`@cloudflare/vitest-pool-workers`). SQL D1 en crudo (sin ORM).

> AGENTS.md: este Next.js tiene breaking changes. **Antes de escribir código de rutas/Next, leer la
> guía relevante en `node_modules/next/dist/docs/`.** No asumir APIs de memoria.

## Decisiones fijas
1. **DB:** quedarse en **D1**; mover lecturas pesadas del mapa a **R2** (PMTiles/COG). NO migrar a
   Postgres/Turso. NO shardear D1 (límite de lecturas es por cuenta).
2. **Foco:** raster VHR donde se ven edificios + footprints + verificación humana por edificio.

## Mapa fases del reporte → tareas
- Fase 1 (integrar evento + aliviar D1) → `01`, `02`, `03`, `04`.
- Fase 2 (triage free-imagery) → `05` (Sentinel-2 hecho; SAR gated).
- Fase 3 (workstation de evidencia) → `06`.

## Orden de ejecución / dependencias
```
00 (índice)
01  COG raster foundation        ← habilitador clave
├─ 02  Ingesta VHR               (depende de 01)
├─ 03  Building footprints       (independiente; se ve mejor sobre 01/02)
└─ 04  D1 read offload           (independiente)
05  Triage discovery             (usa 03 para intersección; alimenta 02/06)
06  Admin evidence workstation   (usa 01, 02, 03)
```
`02`, `03`, `04` pueden ir en paralelo tras `01`.

## Convenciones compartidas (todas las tareas las respetan)
- **Proyección:** geometría vector en **EPSG:4326**; raster COG en su CRS nativo; Leaflet muestra
  en EPSG:3857 (lo maneja el cliente). No inventar escalas nuevas.
- **Claves R2:**
  - COG de imágenes: `imagery/{scene_id}/{asset}.tif`
  - Tiles vector: `tiles/{layer}.pmtiles` (p.ej. `tiles/buildings.pmtiles`, `tiles/reports.pmtiles`)
- **Fuentes:** `source_name` coherente con los valores existentes en `damage_zones`
  (`copernicus-ems-area`, `usgs-shakemap`, `gdacs`, `aria-dpm`, `sentinel2-change`). Para imagen VHR
  usar `maxar-open-data`, `openaerialmap`, `ms-ai-for-good`. Legend source-aware: NO hardcodear
  Copernicus (ver memoria "Damage zones unified legend").
- **APIs nuevas:** replicar cache headers de las existentes (`public, max-age=…, s-maxage=…,
  stale-while-revalidate=…`).
- **Estilos:** solo utilidades/tokens de `app/globals.css`. No crear estilos nuevos fuera de ahí.
- **Migraciones:** índice secuencial a partir de `0012_` en `migrations/`. Aplicar local con
  `pnpm db:migrate:local`; remoto con `db:migrate:preview` / `db:migrate:production`.
- **Tests:** modelar sobre `app/api/reports/map/route.test.ts`; correr `pnpm test`.

## Archivos críticos de referencia
- `wrangler.jsonc` — bindings D1/R2 por env (local/preview/production).
- `app/media/[...key]/route.ts` — patrón de servido R2 (ETag/304/cache immutable) → modelo para COG.
- `app/api/reports/map/route.ts`, `app/api/zones/route.ts` — endpoints read-heavy a aliviar.
- `scripts/import-satellite.ts`, `scripts/fetch-aria-dpm.ts`, `scripts/detect-change-sentinel2.ts`,
  `scripts/discover-sar-scenes.ts` — patrones de ingesta/descubrimiento a clonar.
- `lib/sentinel2-stac.ts`, `lib/change-detection.ts` — STAC + scoring reutilizables.
- `lib/map-report-groups.ts` — agrupado de pins a 15 m (preservar en cualquier offload).
- `migrations/` — secuencia 0001→0011.
- `app/globals.css` — única fuente de estilos.
