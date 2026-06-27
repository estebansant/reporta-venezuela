# 06 · Consola de verificación (Fase 3)

> Depende de: `01` (COG), `02` (escenas VHR), `03` (footprints). Usa: `05` (cola de candidatos).
> Leer antes: `app/admin/*`, `app/api/satellite/candidates/[id]/route.ts`, badge en
> `components/damage-map.tsx`, migraciones `0007`/`0009`.

## Objetivo
Convertir el admin en una estación de evidencia: comparar imagen VHR pre vs post a nivel edificio,
ver linaje de fuentes, y asignar estados de verificación honestos. Es la diferencia entre "sitio de
reportes" y "dashboard de verificación de daños con supervisión humana".

## Pasos

### 1. Estados de moderación
Migración `0014_extend_report_status.sql`. Añadir un campo de revisión separado del `status`
actual (`published`/`hidden`) para no romper el flujo público — columna `review_status`:
```
reported | triaged_by_satellite | externally_corroborated |
verified_collapsed | verified_damaged | rejected_unclear
```
Default `reported`. Mantener `status` para visibilidad pública.

### 2. Tabla de linaje de evidencia
Misma migración o `0015_create_verification_evidence.sql`:
```sql
CREATE TABLE verification_evidence (
  id            TEXT PRIMARY KEY,
  report_id     TEXT NOT NULL,
  source_name   TEXT NOT NULL,   -- maxar-open-data | ms-ai-for-good | copernicus-ems | unosat | aria-dpm | sentinel2-change …
  source_id     TEXT,
  evidence_type TEXT,            -- vhr-image | external-product | sar-hotspot | optical-change
  chip_r2_key   TEXT,            -- recorte pre/post si aplica
  scene_id      TEXT,            -- FK lógica a imagery_scenes
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_verification_evidence_report ON verification_evidence (report_id);
```

### 3. Vista pre/post en el admin
- En `app/admin`, vista de detalle de reporte/candidato con **swipe o side-by-side** del COG VHR
  pre vs post (reutilizar `CogOverlay` de la tarea `01`, escenas de `/api/imagery` tarea `02`).
- Footprints encima (tarea `03`) para señalar el edificio del reporte.
- Panel lateral: linaje de evidencia (filas de `verification_evidence`) + acciones de moderación.

### 4. Acciones de moderación
- Extender el PATCH existente (`/api/satellite/candidates/[id]` y/o nuevo
  `/api/admin/reports/[id]`) para: asignar `review_status`, insertar fila en
  `verification_evidence`, y promover/sincronizar el flag `verified_by_satellite`
  (columnas de migración `0007`).
- **Disciplina de etiquetado:** si solo hay evidencia medium-res → permitir hasta
  `triaged_by_satellite` ("satellite-indicated hotspot"). Solo con VHR / EMS / UNOSAT / MS-AI for
  Good permitir `verified_collapsed`/`verified_damaged`. No afirmar colapso desde 30 m.

### 5. Reflejo en el mapa público
- El badge "Verificado por imagen satelital" (`components/damage-map.tsx`, ya en progreso) se
  muestra solo para `verified_*`. Asegurar que el dato del estado llega al endpoint del mapa /
  baseline PMTiles (tarea `04`).

## Verificación
1. Aplicar migraciones (`pnpm db:migrate:local`).
2. `pnpm dev` → entrar al admin, abrir un candidato de la cola (tarea `05`):
   - ver swipe pre/post VHR con footprint del edificio,
   - asignar `verified_damaged` → confirmar fila en `verification_evidence` y `review_status`.
3. Confirmar que el badge aparece en el mapa público para ese reporte.
4. `pnpm test` (acciones de moderación) y `pnpm build:cloudflare`.
