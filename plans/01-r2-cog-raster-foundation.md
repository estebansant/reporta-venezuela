# 01 · Base: servir y renderizar COG sobre el mapa (HABILITADOR CLAVE)

> Depende de: nada. Habilita: `02`, `06`.
> Leer antes: `node_modules/next/dist/docs/` (rutas/route handlers), `app/media/[...key]/route.ts`.

## Objetivo
Poder colocar un GeoTIFF/COG georreferenciado de alta resolución sobre el mapa Leaflet, con control
de opacidad y orden de capas. Es la capacidad central de "imagen donde se ven edificios". Esta
tarea NO ingesta datos (eso es `02`); solo construye el transporte (R2 → API → Leaflet) y lo prueba
con un COG manual.

## Pasos

### 1. Binding R2 para imágenes de mapa
En `wrangler.jsonc`, añadir un bucket dedicado en los tres envs (local/preview/production), análogo
a `REPORT_IMAGES`:
- binding sugerido: `MAP_TILES`
- buckets: `terremoto-map-tiles-local`, `terremoto-map-tiles-preview`, `terremoto-map-tiles`
- Regenerar tipos: `pnpm cf-typegen`.

(Alternativa más simple: reutilizar `REPORT_IMAGES` con prefijo `imagery/`. Recomendado el bucket
separado por ciclo de vida/limpieza independiente.)

### 2. Ruta de servido del COG con HTTP Range
Crear `app/imagery/[...key]/route.ts` modelando `app/media/[...key]/route.ts`:
- `GET` lee la clave de R2 (`MAP_TILES.get(key, { range })`).
- **Soportar `Range`** (byte-range) para lectura cloud-native parcial del COG: leer header `Range`,
  pasar `{ range: { offset, length } }` a R2, responder `206 Partial Content` con `Content-Range`
  y `Accept-Ranges: bytes`. Si no hay Range, responder objeto completo.
- ETag/`If-None-Match` → `304` (igual que media route).
- Cache: `public, max-age=31536000, immutable` (los COG son inmutables por `scene_id`).
- `Content-Type: image/tiff`.

> Verificar en la guía de Next cómo se exponen los `Request`/`Response` y streaming en este runtime
> Workers antes de implementar el Range.

### 3. Capa raster en Leaflet
Instalar `georaster` + `georaster-layer-for-leaflet` (leen COG vía `geotiff`, ya presente):
- `pnpm add georaster georaster-layer-for-leaflet`
- Crear `components/damage-app/map/CogOverlay.tsx` (client component) que:
  - recibe `url` (`/imagery/{scene_id}/{asset}.tif`), `opacity`, `zIndex`.
  - usa `parseGeoraster(arrayBuffer)` + `new GeoRasterLayer({ georaster, opacity, resolution })`.
  - añade/limpia la capa en el `map` de react-leaflet vía `useMap()`.
- Orden de capas: el raster debe ir **debajo** de pins y zonas. Respetar el fix reciente
  "zone over pins" (commit `3992368`) — revisar cómo `damage-map.tsx` ordena panes y crear/usar un
  pane propio (`map.createPane('cogPane')` con `zIndex` bajo).

### 4. Control de UI
- Añadir al control de capas existente del mapa un toggle + slider de opacidad para el raster VHR,
  reutilizando el patrón del toggle de zonas (`DamageMapWithZonesToggle.tsx`).
- Estilos solo desde `app/globals.css`.

## Verificación
1. Subir manualmente un COG de prueba sobre Venezuela a R2 local:
   `wrangler r2 object put terremoto-map-tiles-local/imagery/test/cog.tif --file <archivo.tif> --local`
2. `pnpm dev`, activar la capa VHR, confirmar:
   - alineación geográfica correcta (cae sobre la zona esperada),
   - al hacer zoom se distinguen estructuras/edificios,
   - el slider de opacidad funciona y los pins quedan por encima.
3. Confirmar en Network que se hacen requests `206` con `Content-Range` (Range funcionando).
4. `pnpm build:cloudflare` compila sin errores.

## Notas
- Si `georaster-layer-for-leaflet` da problemas de performance con COG grandes, alternativa:
  pre-tilear a XYZ/PMTiles-raster y servir con `L.tileLayer`. Mantener `georaster` como camino
  primario para conservar un solo archivo por escena reutilizable en GIS.
