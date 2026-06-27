# 04 · Sacar lecturas del mapa de D1 a R2

> Depende de: nada (independiente). Relacionada con: `01` (infra R2/PMTiles).
> Leer antes: `app/api/reports/map/route.ts`, `app/api/zones/route.ts`, `lib/map-report-groups.ts`,
> sección "What to do about D1" del reporte.

## Objetivo
Atacar el read-cap de D1 (5M filas/día, **a nivel cuenta**) moviendo las capas públicas de lectura
pesada a objetos estáticos en R2. D1 queda como base de escrituras/moderación. El problema medido es
read-amplification, no almacenamiento → **no shardear D1** (inútil, el límite es por cuenta).

## Hotspots de lectura
- `/api/reports/map` — hasta **1000 filas/carga** (`app/api/reports/map/route.ts`), + LEFT JOIN
  opcional a `report_images`.
- `/api/zones` — hasta **500 filas/carga** (`app/api/zones/route.ts`) + `JSON.parse` por geometría.

## Estrategia híbrida (baseline estático + delta fresco)
- **Baseline:** snapshot periódico de reports publicados + `damage_zones` → PMTiles en R2. El mapa
  carga esto primero (lectura R2, cero D1).
- **Delta:** D1 sirve solo los reportes recientes desde el último snapshot (query pequeña y
  acotada por `created_at >`), que el cliente fusiona con el baseline.
- Preservar el **agrupado a 15 m** (`lib/map-report-groups.ts`) tanto en el baseline pre-generado
  como en el merge cliente.

## Pasos

### 1. Script de export → PMTiles
Crear `scripts/export-map-tiles.ts`:
- query D1: todos los reports `status='published'` (campos del mapa) + todas las `damage_zones`.
- generar GeoJSON EPSG:4326 → PMTiles con `tippecanoe`:
  - `tiles/reports.pmtiles` (puntos; incluir campos usados por el cliente: damage_type, state,
    verified_by_satellite, created_at, chip_image_id).
  - `tiles/zones.pmtiles` (polígonos; incluir source_name, damage_category, score).
- subir a R2 (`MAP_TILES`).
- guardar un `tiles/manifest.json` con `generated_at` (corte para el delta).

### 2. Automatización
- npm script `"export:map-tiles": "tsx scripts/export-map-tiles.ts"`.
- correr tras cada `import:*`/`detect:*`. Opcional: cron de Cloudflare (Workers cron trigger) o
  ejecución manual programada. Documentar en el script.

### 3. Frontend lee baseline desde R2
- Cargar `tiles/reports.pmtiles` y `tiles/zones.pmtiles` vía la ruta de servido R2 (tarea `01`,
  `/imagery|/tiles/[...key]` con Range) usando `protomaps-leaflet`.
- Mantener `/api/reports/map` y `/api/zones` pero recortados al **delta** (`created_at >
  manifest.generated_at`), con límites pequeños. Conservar contrato de respuesta para no romper el
  cliente.
- Merge cliente: baseline (PMTiles) + delta (API) antes de agrupar a 15 m.

### 4. Mantener D1 para escrituras/admin
- POST de reports, moderación, `satellite_candidates`, `verification_evidence` (tarea `06`) siguen
  en D1. Sin cambios en el camino de escritura.

## Verificación
1. `pnpm export:map-tiles` → confirmar PMTiles en R2 y `manifest.json`.
2. `pnpm dev`: el mapa carga con paridad visual (mismos pins/zonas) sirviendo desde PMTiles + delta.
3. Crear un reporte nuevo → aparece vía delta sin re-exportar.
4. Panel Cloudflare D1: confirmar caída marcada de "rows read/day" tras desplegar.
5. `pnpm test` y `pnpm build:cloudflare`.

## Notas
- R2 es S3-compatible y PMTiles está diseñado para object storage tipo S3: encaje natural, sin
  egress charges. Probar el camino real de servido con archivos reales antes de comprometer del
  todo (el acceso tile eficiente depende de cómo el Worker sirve objetos grandes con Range).
