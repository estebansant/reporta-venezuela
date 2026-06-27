# Mapa de Daños Venezuela | Reporta Venezuela

Plataforma independiente para el mapeo colaborativo de daños estructurales, asistencia en emergencias e integración de datos satelitales tras eventos sísmicos en Venezuela.

A civic, independent platform for crowdsourced structural damage mapping, emergency assistance, and satellite data integration following seismic events in Venezuela.

---

## 🇪🇸 Versión en Español

### 🎯 Objetivo

El **Mapa de Daños Venezuela** tiene como objetivo recopilar, validar y visualizar en tiempo real los reportes de daños estructurales e incidencias tras un terremoto en el país. Busca conectar de manera directa a los ciudadanos afectados con voluntarios, personal de rescate, medios de comunicación y organizaciones de ayuda humanitaria, ofreciendo una fuente de información estructurada y de acceso público en momentos de alta vulnerabilidad.

### 👁️ Visión

Convertirse en la infraestructura cívica digital de referencia para la gestión de la crisis después del terremoto del 24 de junio del 2026 en Venezuela. Aspiramos a consolidar un ecosistema abierto que combine el poder de la participación ciudadana con tecnología de análisis satelital, facilitando así una respuesta de emergencia coordinada, eficiente y basada en datos para la toma de decisiones críticas y los esfuerzos de reconstrucción.

### 🛠️ Estado de Implementación (Características Actuales)

La plataforma ha sido construida bajo exigentes principios de rendimiento, accesibilidad en dispositivos móviles y confiabilidad en entornos de red inestables.

1. **Mapa Interactivo de Daños:** Implementación interactiva en: https://reportavenezuela.org/ que geolocaliza reportes de daños (grietas, daño moderado, severo o colapso) agrupándolos de forma eficiente.
2. **Formulario de Reportes Ciudadanos:** Permite el envío de incidentes estructurados con coordenadas exactas, descripciones y datos de contacto (con consentimiento explícito). Protegido mediante **Cloudflare Turnstile** para evitar spam.
3. **Optimización de Imágenes Serverless:** Procesamiento y compresión en caliente de imágenes a formato **WebP** usando `@jsquash/webp` directamente en la capa serverless de Cloudflare, minimizando la carga en el cliente.
4. **Almacenamiento Escalable y Seguro:** El backend opera sobre la infraestructura de Cloudflare:
   - **Cloudflare D1:** Base de datos SQL serverless para almacenar reportes estructurados y zonas de daños.
   - **Cloudflare R2:** Almacenamiento de objetos optimizado para las fotografías de reportes (`reports/{reportId}/{imageId}.webp`).
5. **Directorio y Recursos de Ayuda:**
   - **Teléfonos de Emergencia:** Teléfonos que hemos logrado recopilar y verificar como operativos para varias ciudades en Venezuela.
   - **Centros de Acopio:** Link a página encargada de publicar ubicación de centros de acopio dentro y fuera de Venezuela.
   - **Personas Desaparecidas:** Enlace a páginas encargadas de reportar desapariciones de personas.
6. **Datos Satelitales:** Scripts de procesamiento que unifican datos satelitales y capas de daños provenientes de agencias internacionales como:
   - **Copernicus EMS** (Emergency Management Service).
   - **ARIA DPM** (Damage Proxy Map de la NASA/JPL).
   - **USGS Shakemap** y **GDACS** (Global Disaster Alert and Coordination System).
   - Visualización preliminar de **Zonas de Daño** (`damage_zones`) y **Candidatos de Daño Satelital** (`satellite_candidates`).

### 🗺️ Hoja de Ruta (En Desarrollo y Planes Futuros)

- **Desarrollo completo de sistema de categorizacion por datos satelital** Actualmente nos encontramos trabajando en una forma real y eficiente de procesar imágenes satelitales para constatar y verificar el estado de edificios, casas e infraestructuras en Venezuela.
- **Exportación de Datos Abiertos:** API y descargas públicas en formatos estándar (GeoJSON, CSV) para que organizaciones de rescate y ONGs utilicen los datos en sus propios sistemas de información geográfica (SIG).

---

## 🇬🇧 English Version

### 🎯 Objective

The **Venezuela Damage Map** (_Mapa de Daños Venezuela_) aims to collect, validate, and visualize in real time structural damage reports and incidents following an earthquake in the country. It seeks to directly connect affected citizens with volunteers, rescue personnel, media outlets, and humanitarian aid organizations, offering a structured, publicly accessible source of information during times of high vulnerability.

### 👁️ Vision

To become the benchmark digital civic infrastructure for crisis management following the June 24, 2026 earthquake in Venezuela. We aspire to consolidate an open ecosystem that combines the power of citizen participation with satellite analysis technology, thereby facilitating a coordinated, efficient, and data-driven emergency response for critical decision-making and reconstruction efforts.

### 🛠️ Implementation Status (Current Features)

The platform has been built under demanding principles of performance, accessibility on mobile devices, and reliability in unstable network environments.

1. **Interactive Damage Map:** Interactive implementation at: https://reportavenezuela.org/ that geolocalizes damage reports (cracks, moderate, severe, or collapse damage) grouping them efficiently.
2. **Citizen Reporting Form:** Allows the submission of structured incidents with exact coordinates, descriptions, and contact data (with explicit consent). Protected by **Cloudflare Turnstile** to prevent spam.
3. **Serverless Image Optimization:** Hot processing and compression of images to **WebP** format using `@jsquash/webp` directly in Cloudflare's serverless layer, minimizing client-side load.
4. **Scalable and Secure Storage:** The backend operates on Cloudflare's infrastructure:
   - **Cloudflare D1:** Serverless SQL database to store structured reports and damage zones.
   - **Cloudflare R2:** Object storage optimized for report photographs (`reports/{reportId}/{imageId}.webp`).
5. **Directory and Help Resources:**
   - **Emergency Contacts:** Phone numbers that we have managed to compile and verify as operational for several cities in Venezuela.
   - **Collection Centers:** Link to a page in charge of publishing the location of collection centers inside and outside Venezuela.
   - **Missing Persons:** Link to pages in charge of reporting missing persons.
6. **Satellite Data:** Processing scripts that unify satellite data and damage layers from international agencies such as:
   - **Copernicus EMS** (Emergency Management Service).
   - **ARIA DPM** (Damage Proxy Map of NASA/JPL).
   - **USGS Shakemap** and **GDACS** (Global Disaster Alert and Coordination System).
   - Preliminary visualization of **Damage Zones** (`damage_zones`) and **Satellite Damage Candidates** (`satellite_candidates`).

### 🗺️ Roadmap (In Development and Future Plans)

- **Full development of satellite data categorization system:** Currently we are working on a realistic and efficient way to process satellite images to verify the status of buildings, houses, and infrastructure in Venezuela.
- **Open Data Export:** Public API and downloads in standard formats (GeoJSON, CSV) so that rescue organizations and NGOs can use the data in their own geographic information systems (GIS).

---

## 💻 Desarrollo y Despliegue / Development & Deployment

### Requisitos / Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-cli/) (para interactuar con Cloudflare)

### Desarrollo Local / Local Setup

1. **Clonar e instalar dependencias / Clone & install:**

   ```bash
   pnpm install
   ```

2. **Variables de Entorno / Environment Variables:**
   Copia el archivo de ejemplo y configura tus variables locales:

   ```bash
   cp .dev.vars.example .dev.vars
   # Opcional / Optional: Edita .env.local para variables adicionales de Next.js
   ```

3. **Migración de Base de Datos Local / Run local migrations:**

   ```bash
   pnpm db:migrate:local
   ```

4. **Iniciar Servidor de Desarrollo / Run Dev Server:**

   ```bash
   pnpm dev
   ```

5. **Probar en entorno de simulación Cloudflare (`workerd`):**
   ```bash
   pnpm preview
   ```

### Scripts de Importación Satelital / Satellite Data Import Scripts

Puedes poblar tu entorno con datos geográficos y satelitales usando los comandos incluidos en `package.json`:

```bash
# Ingesta general / General ingest
pnpm import:source

# Importar zonas de Copernicus EMS / Import Copernicus EMS zones
pnpm import:satellite:ems-zones

# Importar candidatos satelitales locales / Import local satellite candidates
pnpm import:satellite:ems-local
```

### Despliegue en Cloudflare / Cloudflare Deployment

Asegúrate de configurar los valores `REPLACE_WITH_*` en `wrangler.jsonc` y de establecer las variables secretas de Turnstile (`TURNSTILE_SECRET`) en Cloudflare usando `wrangler secret put`.

- **Desplegar a Preview:**

  ```bash
  pnpm deploy:preview
  ```

- **Desplegar a Producción:**
  ```bash
  pnpm deploy
  ```
