# 05 · Capa de descubrimiento medium-res → apunta a dónde pedir VHR

> Depende de: `03` (intersección con footprints). Alimenta: `02` (dónde capturar VHR), `06` (cola).
> Leer antes: `scripts/detect-change-sentinel2.ts`, `lib/change-detection.ts`,
> `scripts/discover-sar-scenes.ts`, `scripts/fetch-aria-dpm.ts`, migración `0009`.

## Objetivo
Usar imagen medium-res (Sentinel-2 ya construido + SAR) para rankear hotspots de daño probable y
**dirigir** hacia dónde adquirir VHR y dónde debe mirar el revisor humano — especialmente zonas con
reporte rezagado. NO afirma daño por edificio desde 30 m; produce candidatos, no verdades.

## Estado de partida
- **Óptico Sentinel-2: HECHO.** `detect-change-sentinel2.ts` corre pre/post (pre ≤ 2026-06-23,
  post ≥ 2026-06-25), score por celda 500 m, escribe `damage_zones` (`source='sentinel2-change'`).
  npm script `detect:sentinel2` ya existe.
- **SAR: gated.** Memoria "SAR open data: no Venezuela coverage" → el open-data SAR (Umbra/ICEYE)
  no cubre Venezuela aún. La fuente SAR real hoy es **ARIA DPM** (tier `sar` ya implementado vía
  `fetch-aria-dpm.ts` → `import:satellite:sar`).

## Pasos

### 1. Operacionalizar Sentinel-2 (documentar, ya funciona)
- Documentar corrida estándar pre/post y escritura a `damage_zones`.
- Asegurar que `detect:sentinel2 --write` se ejecuta periódicamente (manual o cron junto al export
  de la tarea `04`).

### 2. SAR — ARIA DPM como fuente actual
- Flujo vigente: `pnpm fetch:aria-dpm` → `pnpm import:satellite:sar --dpm-url <file.tif> --write`
  (genera celdas en `damage_zones`, `source='aria-dpm'`).
- Re-chequear cobertura open-data SAR periódicamente: `npm run discover:sar` (genera
  `sar-scenes.manifest.json`; el campo `gate` avisa si no hay cobertura POST).

### 3. SAR coherencia Sentinel-1 — LISTO-PARA-ACTIVAR (no implementar hasta haber cobertura)
Especificar (sin construir) el pipeline análogo al de Sentinel-2, para activarlo cuando
`discover:sar` deje de estar `gated`:
- `lib/sentinel1-stac.ts` — STAC Sentinel-1/OPERA RTC (clonar estructura de `sentinel2-stac.ts`).
- `lib/sar-coherence.ts` — lectura VV/VH, `coherence_loss = 1 - |coh|`, score por celda.
- `scripts/detect-change-sentinel1.ts` — clon de `detect-change-sentinel2.ts`, usa pares de
  `sar-scenes.manifest.json`, escribe `damage_zones` (`source='sentinel1-coherence'`).
- tier `sentinel1` en `import-satellite.ts` + npm `detect:sentinel1`.

### 4. Grid de triage que fusiona señales
Crear `scripts/build-triage-grid.ts`:
- celdas **100–250 m** sobre los AOIs.
- `score = fusión(` ΔSAR/coherencia (ARIA-DPM o S1) `,` anomalía óptica pre/post (S2) `,`
  intensidad de sacudida (USGS ShakeMap, ya en `damage_zones`) `,`
  acuerdo con reportes cercanos `)`.
- intersectar con footprints (tarea `03`) para acotar a celdas con edificios.
- top-celdas → insertar en `satellite_candidates` (tabla ya existe, migración `0009`,
  `status='pending'`, `score`, `note` con desglose de señales). Donde exista escena VHR
  (`imagery_scenes`, tarea `02`) cubriendo la celda, enlazarla en el candidato.

## Verificación
1. `pnpm detect:sentinel2 --write` (o ARIA) sobre un AOI → zonas en `damage_zones`.
2. `pnpm tsx scripts/build-triage-grid.ts --aoi <x>` → candidatos rankeados en
   `/api/satellite/candidates` (status pending, ordenados por score).
3. Confirmar que cada candidato enlaza su escena VHR cuando existe.
4. `npm run discover:sar` documentado como gate para activar el paso 3.
