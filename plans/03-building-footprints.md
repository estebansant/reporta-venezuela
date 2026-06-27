# 03 · Huellas de edificios sobre la imagen

> Depende de: nada (se ve mejor sobre `01`/`02`). Alimenta: `05`, `06`.
> Leer antes: el tier `ems` de `scripts/import-satellite.ts` (patrón auto-tag a 15 m),
> `app/api/zones/route.ts`.

## Objetivo
Dibujar polígonos de edificios sobre el raster VHR para distinguir/identificar estructuras, y poder
ligar cada reporte a un edificio concreto preservando la lat/lng original (auditable).

## Fuentes
- **Overture buildings** — dataset global estable de footprints (Parquet/GeoParquet en S3/Azure).
- **HOT/OSM** — respuesta activa de mapeo Venezuela 2026 (mejor cobertura local en curso).

## AOIs prioritarios
Yaracuy, Lara/Barquisimeto, Falcón, Tucacas, Catia La Mar.

## Pasos

### 1. Script de extracción → PMTiles
Crear `scripts/extract-buildings.ts`:
- por AOI (bbox), descargar footprints de Overture (query GeoParquet por bbox) y/o HOT/OSM (Overpass
  o extracto regional).
- normalizar a GeoJSON FeatureCollection en **EPSG:4326** con `building_id` estable
  (id Overture/OSM), `source` (`overture`|`osm`), centroide.
- convertir a **PMTiles** con `tippecanoe` (documentar como dependencia externa) →
  `tiles/buildings.pmtiles`.
- subir a R2 (`MAP_TILES`, clave `tiles/buildings.pmtiles`).

### 2. Capa vector en Leaflet
- Instalar `protomaps-leaflet` (`pnpm add protomaps-leaflet`) para leer PMTiles desde R2.
- Crear `components/damage-app/map/BuildingsLayer.tsx`: capa de polígonos con borde sutil, sin
  relleno (o relleno mínimo), encima del raster VHR y debajo de pins/zonas.
- Servir el PMTiles vía la ruta `/imagery/[...key]` de la tarea `01` (acepta cualquier objeto de
  `MAP_TILES`) o una ruta `/tiles/[...key]` análoga con Range.
- Estilos solo desde `app/globals.css`.

> Alternativa si el volumen por AOI es bajo: endpoint `/api/buildings?bbox` que devuelve GeoJSON y
> render con `L.geoJSON`. PMTiles es preferible para no leer de D1 y escalar.

### 3. Matching reporte → edificio
- Reutilizar el patrón de auto-tag a 15 m que el tier `ems` ya usa para asociar geometrías a
  reports. Extraer esa lógica a `lib/match-building.ts` si está inline, para reutilizar.
- Migración `0013_add_report_building_ref.sql`: añadir `building_id TEXT` (y opcional
  `building_source TEXT`) a `reports`. Índice si se filtrará por edificio.
- Al crear/importar un reporte, intentar match con el footprint más cercano dentro de umbral;
  **preservar siempre `latitude`/`longitude` originales**.

## Verificación
1. Correr `pnpm tsx scripts/extract-buildings.ts --aoi catia-la-mar`, subir PMTiles a R2.
2. `pnpm dev`: footprints alineados sobre el COG VHR del AOI (tarea `02`).
3. Crear un reporte de prueba dentro de un edificio → confirmar `building_id` poblado y lat/lng
   original intacta.
4. `pnpm test` para la lógica de matching.
