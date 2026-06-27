# 02 · Ingesta de imágenes VHR (donde se ven edificios)

> Depende de: `01` (para visualizar). Alimenta: `06`.
> Leer antes: `scripts/fetch-aria-dpm.ts`, `scripts/import-satellite.ts`, `lib/sentinel2-stac.ts`.

## Objetivo
Adquirir imágenes de muy alta resolución (VHR) pre/post evento, convertirlas a COG, subirlas a R2 y
registrarlas en una tabla `imagery_scenes` para que el frontend (tarea `01`) y el admin (tarea `06`)
las puedan cargar.

## Fuentes (del reporte, feed oportunista por evento — no base garantizada)
- **Maxar / Vantor Open Data** — pre/post alta resolución, licencia CC BY-NC 4.0. Registry AWS
  (`spacenet`/`maxar-opendata`). `source_name = maxar-open-data`.
- **OpenAerialMap** (HOT) — imágenes satélite/dron de respuesta humanitaria. `source_name = openaerialmap`.
- **Microsoft AI for Good — Catia La Mar building damage** (HDX) — dataset actual del evento.
  `source_name = ms-ai-for-good`.

## Pasos

### 1. Migración `0012_create_imagery_scenes.sql`
Tabla con modelo STAC del reporte (espejo del estilo de `damage_zones`, migración 0008):
```sql
CREATE TABLE imagery_scenes (
  scene_id      TEXT PRIMARY KEY,
  collection    TEXT,
  provider      TEXT NOT NULL,          -- maxar-open-data | openaerialmap | ms-ai-for-good
  license       TEXT,
  phase         TEXT CHECK(phase IN ('pre','post')),
  datetime      TEXT,                   -- ISO8601 de captura
  min_lat REAL, max_lat REAL, min_lng REAL, max_lng REAL,
  cloud_cover   REAL,
  crs           TEXT,
  resolution_m  REAL,
  r2_key        TEXT NOT NULL,          -- imagery/{scene_id}/{asset}.tif
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_imagery_scenes_bbox ON imagery_scenes (min_lat, max_lat, min_lng, max_lng);
CREATE INDEX idx_imagery_scenes_phase ON imagery_scenes (phase, datetime);
```
Aplicar: `pnpm db:migrate:local`.

### 2. Script de descubrimiento/descarga
Crear `scripts/fetch-vhr-imagery.ts` modelando `scripts/fetch-aria-dpm.ts`:
- flag `--source maxar|oam|msaig`, `--bbox`, ventanas de fecha.
- crawl del STAC/registry S3 de la fuente → match Venezuela + fechas → descarga stream a disco.
- **Ventanas pre/post:** pre con `datetime <= 2026-06-23`; post con `datetime >= 2026-06-25`.
- imprime ruta local del GeoTIFF (stdout) + comando de import sugerido (stderr), como hace ARIA.

### 3. Conversión a COG + subida a R2
- Convertir a COG (overviews internos + tiling). Preferir `gdal_translate -of COG` si está
  disponible (documentar como dependencia externa en el script). Fallback: reproyectar/retilear con
  `geotiff` + `sharp`.
- Subir a `imagery/{scene_id}/{asset}.tif` en `MAP_TILES`
  (`wrangler r2 object put …` o binding desde el tier de import).

### 4. Tier de import `vhr`
- Añadir tier `vhr` a `scripts/import-satellite.ts` siguiendo el patrón de los tiers existentes:
  toma el COG local + metadatos → inserta fila en `imagery_scenes` → sube COG a R2.
- npm script en `package.json`: `"import:satellite:vhr": "tsx scripts/import-satellite.ts --tier vhr"`.

### 5. API `/api/imagery`
Crear `app/api/imagery/route.ts` (GET) modelando `app/api/zones/route.ts`:
- params: `north/south/east/west` (bbox), `phase` opcional.
- query a `imagery_scenes` filtrando por bbox (mismo patrón `max_lat >= ? AND min_lat <= ? …`).
- responde `{ scenes: [{ scene_id, phase, datetime, provider, license, bbox, r2_key, resolution_m }] }`.
- validar params con `zod`; cache headers como `/api/zones`.
- el frontend usa `r2_key` → `/imagery/{key}` (ruta de la tarea `01`).

### 6. Frontend: selector de escena
- En el control de capas, listar escenas VHR disponibles para el viewport (fetch `/api/imagery`),
  permitir elegir una escena pre y una post. Conecta con `CogOverlay` de la tarea `01`.

## Verificación
1. Ingerir el dataset **Catia La Mar (ms-ai-for-good)**:
   `pnpm fetch:vhr --source msaig` → `pnpm import:satellite:vhr …`.
2. Confirmar fila en `imagery_scenes` y COG en R2 (`wrangler r2 object get … --local`).
3. `pnpm dev`: la escena aparece en el selector y se renderiza sobre el mapa con edificios visibles.
4. `pnpm test` (añadir test de `/api/imagery` modelado sobre `route.test.ts`).
