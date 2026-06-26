import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

import {
  normalizeSourceBuilding,
  SOURCE_NAME,
  type NormalizedImportReport,
  type SourceBuilding,
} from "../lib/import-terremoto-source";

const execFileAsync = promisify(execFile);

const SOURCE_SUPABASE_URL = "https://jckifxsdlnsvbztxydes.supabase.co";
const SOURCE_SUPABASE_KEY = "sb_publishable_i7iEDrCVZcSt0k3RGFrY4g_WrtZBB4w";
const PAGE_SIZE = 100;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
const MAX_WEBP_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1920;
const GEOCODE_DELAY_MS = 1_100;

type ImportEnv = "local" | "preview" | "production";

interface CliOptions {
  dryRun: boolean;
  write: boolean;
  env: ImportEnv;
  limit?: number;
  since?: string;
  sourceId?: string;
  sourceStatus?: string;
  confirmProduction: boolean;
  refreshExisting: boolean;
}

interface WranglerTarget {
  env: ImportEnv;
  dbName: string;
  bucketName: string;
  d1Args: string[];
  r2Args: string[];
}

interface StoredImage {
  imageId: string;
  key: string;
  path: string;
  sizeBytes: number;
  width: number;
  height: number;
  position: number;
}

interface Summary {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  imagesUploaded: number;
  imagesFailed: number;
  discardedImages: number;
  geocoded: number;
  warnings: string[];
}

type ReadyImportReport = NormalizedImportReport & {
  latitude: number;
  longitude: number;
};

const startedAt = Date.now();

function elapsedSeconds() {
  return Math.round((Date.now() - startedAt) / 1000);
}

function progress(message: string) {
  process.stderr.write(`[${elapsedSeconds()}s] ${message}\n`);
}

function resolveMediaUrl(url: string) {
  const match = url.match(/\/damage-media\/(.+?)(\?.*)?$/);
  if (!match) return url;
  return `https://terremotovenezuela.com/api/public/media/${match[1]}`;
}

function parseArgs(argv: string[]): CliOptions {
  if (argv[0] === "--") argv = argv.slice(1);
  const options: CliOptions = {
    dryRun: true,
    write: false,
    env: "local",
    confirmProduction: false,
    refreshExisting: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Falta valor para ${arg}.`);
      }
      index += 1;
      return value;
    };

    if (arg === "--dry-run") {
      options.dryRun = true;
      options.write = false;
    } else if (arg === "--write") {
      options.write = true;
      options.dryRun = false;
    } else if (arg === "--env") {
      const env = next();
      if (!["local", "preview", "production"].includes(env)) {
        throw new Error("--env debe ser local, preview o production.");
      }
      options.env = env as ImportEnv;
    } else if (arg === "--limit") {
      const limit = Number(next());
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error("--limit debe ser un entero positivo.");
      }
      options.limit = limit;
    } else if (arg === "--since") {
      const since = next();
      if (Number.isNaN(new Date(since).getTime())) {
        throw new Error("--since debe ser una fecha ISO válida.");
      }
      options.since = since;
    } else if (arg === "--source-id") {
      options.sourceId = next();
    } else if (arg === "--source-status") {
      options.sourceStatus = next();
    } else if (arg === "--confirm-production") {
      options.confirmProduction = true;
    } else if (arg === "--refresh-existing") {
      options.refreshExisting = true;
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }

  if (options.env === "production" && options.write && !options.confirmProduction) {
    throw new Error(
      "Para escribir en producción usa también --confirm-production.",
    );
  }

  return options;
}

function stripJsonComments(input: string) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
}

async function getWranglerTarget(env: ImportEnv): Promise<WranglerTarget> {
  const config = JSON.parse(
    stripJsonComments(await readFile("wrangler.jsonc", "utf8")),
  ) as {
    d1_databases?: { database_name: string }[];
    r2_buckets?: { bucket_name: string }[];
    env?: Record<
      string,
      {
        d1_databases?: { database_name: string }[];
        r2_buckets?: { bucket_name: string }[];
      }
    >;
  };

  const scoped = env === "local" ? config : config.env?.[env];
  const dbName = scoped?.d1_databases?.[0]?.database_name;
  const bucketName = scoped?.r2_buckets?.[0]?.bucket_name;
  if (!dbName || !bucketName) {
    throw new Error(`No se encontró configuración D1/R2 para env=${env}.`);
  }

  return {
    env,
    dbName,
    bucketName,
    d1Args:
      env === "local"
        ? ["d1", "execute", dbName, "--local"]
        : ["d1", "execute", dbName, "--env", env, "--remote"],
    r2Args:
      env === "local" ? ["r2", "object"] : ["r2", "object", "--env", env],
  };
}

async function runWrangler(args: string[], options: { inputFile?: string } = {}) {
  const { stdout, stderr } = await execFileAsync(
    "pnpm",
    ["exec", "wrangler", ...args],
    {
      env: {
        ...process.env,
        NO_COLOR: "1",
        WRANGLER_LOG_PATH: path.join(tmpdir(), "wrangler-import.log"),
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (stderr.trim() && !options.inputFile) {
    process.stderr.write(stderr);
  }
  return stdout;
}

async function d1Json<T = unknown>(target: WranglerTarget, sql: string): Promise<T[]> {
  const stdout = await runWrangler([
    ...target.d1Args,
    "--command",
    sql,
    "--json",
  ]);
  const parsed = JSON.parse(stdout) as unknown;
  const rows: T[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.results)) {
      for (const row of record.results) rows.push(row as T);
    }
    if (record.result) visit(record.result);
  };
  visit(parsed);
  return rows;
}

async function d1ExecFile(target: WranglerTarget, sql: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "terremoto-import-sql-"));
  const file = path.join(dir, "import.sql");
  try {
    await writeFile(file, sql);
    progress(`D1: escribiendo cambios en ${target.env}...`);
    await runWrangler([...target.d1Args, "--file", file, "--yes"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sqlString(value: string | null | undefined) {
  if (value === null || value === undefined) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumber(value: number) {
  if (!Number.isFinite(value)) throw new Error(`Número SQL inválido: ${value}`);
  return String(value);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseCoordinate(value: string | undefined, min: number, max: number) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max
    ? coordinate
    : null;
}

function geocodeCity(report: NormalizedImportReport) {
  if (/^distrito capital$/i.test(report.city)) return "Caracas";
  if (/^naiguat[áa]/i.test(report.city)) return "Naiguatá";
  return report.city;
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

async function geocodeReport(report: NormalizedImportReport) {
  const queries: URLSearchParams[] = [];
  const city = geocodeCity(report);
  const state = report.state === "No especificado" ? "" : report.state;
  const zone = report.zone;
  const freeformQueries = uniqueValues([
    `${report.buildingName}, ${report.address}, ${zone}, ${city}, ${state}, Venezuela`,
    `${report.address}, ${zone}, ${city}, ${state}, Venezuela`,
    `${zone}, ${city}, ${state}, Venezuela`,
    `${city}, ${state}, Venezuela`,
  ]);

  if (report.state !== "No especificado") {
    queries.push(
      new URLSearchParams({
        format: "jsonv2",
        limit: "1",
        countrycodes: "ve",
        addressdetails: "1",
        street: report.address,
        city,
        state: report.state,
        country: "Venezuela",
      }),
    );
  }
  for (const query of freeformQueries) {
    queries.push(
      new URLSearchParams({
        format: "jsonv2",
        limit: "1",
        countrycodes: "ve",
        addressdetails: "1",
        q: query,
      }),
    );
  }

  for (let index = 0; index < queries.length; index += 1) {
    if (index > 0) await sleep(GEOCODE_DELAY_MS);
    const params = queries[index];
    progress(
      `Geocoding ${report.sourceId} (${index + 1}/${queries.length}): ${
        params.get("q") ?? `${report.address}, ${report.city}`
      }`,
    );
    const response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?${params}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "terremoto-venezuela-import/0.1 (https://reportavenezuela.org)",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Nominatim respondió ${response.status}.`);
    }
    const results = (await response.json()) as { lat?: string; lon?: string }[];
    const first = results[0];
    const latitude = parseCoordinate(first?.lat, -90, 90);
    const longitude = parseCoordinate(first?.lon, -180, 180);
    if (latitude !== null && longitude !== null) {
      return { latitude, longitude };
    }
  }

  return null;
}

async function ensureCoordinates(
  report: NormalizedImportReport,
  summary: Summary,
): Promise<ReadyImportReport | { skipped: true; reason: string; sourceId: string }> {
  if (typeof report.latitude === "number" && typeof report.longitude === "number") {
    return report as ReadyImportReport;
  }

  await sleep(GEOCODE_DELAY_MS);
  const coordinates = await geocodeReport(report);
  if (!coordinates) {
    return {
      skipped: true,
      reason: "No tiene coordenadas y no se pudo geocodificar por dirección.",
      sourceId: report.sourceId,
    };
  }

  summary.geocoded += 1;
  return {
    ...report,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    warnings: [
      ...report.warnings,
      "Coordenadas obtenidas por geocoding desde la dirección.",
    ],
  };
}

async function fetchSourceBuildings(options: CliOptions): Promise<SourceBuilding[]> {
  const rows: SourceBuilding[] = [];
  let offset = 0;

  while (true) {
    const url = new URL("/rest/v1/buildings", SOURCE_SUPABASE_URL);
    url.searchParams.set("select", "*");
    url.searchParams.set("order", "last_updated_at.desc");
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    if (options.since) {
      url.searchParams.set("last_updated_at", `gte.${options.since}`);
    }
    if (options.sourceId) {
      url.searchParams.set("id", `eq.${options.sourceId}`);
    }
    if (options.sourceStatus) {
      url.searchParams.set("status", `eq.${options.sourceStatus}`);
    }

    const response = await fetchWithTimeout(url.toString(), {
      headers: {
        apikey: SOURCE_SUPABASE_KEY,
        Authorization: `Bearer ${SOURCE_SUPABASE_KEY}`,
      },
    });
    if (!response.ok) {
      throw new Error(
        `La fuente respondió ${response.status}: ${await response.text()}`,
      );
    }
    const page = (await response.json()) as SourceBuilding[];
    rows.push(...page);
    progress(`Fuente: ${rows.length} edificios leídos...`);
    if (options.limit && rows.length >= options.limit) {
      return rows.slice(0, options.limit);
    }
    if (page.length < PAGE_SIZE || options.sourceId) return rows;
    offset += PAGE_SIZE;
  }
}

async function getExistingReportId(target: WranglerTarget, sourceId: string) {
  const rows = await d1Json<{ id: string }>(
    target,
    `SELECT id FROM reports WHERE source_name = ${sqlString(
      SOURCE_NAME,
    )} AND source_id = ${sqlString(sourceId)} LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

async function getExistingImageKeys(target: WranglerTarget, reportId: string) {
  const rows = await d1Json<{ r2_key: string }>(
    target,
    `SELECT r2_key FROM report_images WHERE report_id = ${sqlString(reportId)}`,
  );
  return rows.map((row) => row.r2_key).filter(Boolean);
}

async function processImage(url: string, dir: string, imageId: string) {
  const downloadUrl = resolveMediaUrl(url);
  progress(`Imagen: descargando ${downloadUrl}`);
  const response = await fetchWithTimeout(downloadUrl);
  if (!response.ok) {
    throw new Error(`Imagen ${downloadUrl} respondió ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Media ${downloadUrl} no es imagen (${contentType || "sin content-type"}).`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_ORIGINAL_BYTES) {
    throw new Error(`Imagen ${downloadUrl} supera ${MAX_ORIGINAL_BYTES} bytes.`);
  }
  const input = Buffer.from(await response.arrayBuffer());
  if (input.byteLength > MAX_ORIGINAL_BYTES) {
    throw new Error(`Imagen ${downloadUrl} supera ${MAX_ORIGINAL_BYTES} bytes.`);
  }

  const outputPath = path.join(dir, `${imageId}.webp`);
  const pipeline = sharp(input, { failOn: "none" })
    .rotate()
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 60 });
  const { width, height, size } = await pipeline.toFile(outputPath);
  if (!width || !height || size <= 0 || size > MAX_WEBP_BYTES) {
    throw new Error(`WebP inválido para ${downloadUrl}.`);
  }
  progress(`Imagen: convertida a WebP ${width}x${height}, ${size} bytes`);
  return { outputPath, width, height, size };
}

async function uploadImage(target: WranglerTarget, image: StoredImage) {
  const args = [
    ...target.r2Args,
    "put",
    `${target.bucketName}/${image.key}`,
    "--file",
    image.path,
    "--content-type",
    "image/webp",
    "--cache-control",
    "public, max-age=31536000, immutable",
  ];
  if (target.env === "local") args.push("--local");
  else args.push("--remote", "--force");
  progress(`R2: subiendo ${image.key}`);
  await runWrangler(args);
}

async function deleteR2Object(target: WranglerTarget, key: string) {
  const args = [...target.r2Args, "delete", `${target.bucketName}/${key}`];
  if (target.env === "local") args.push("--local");
  else args.push("--remote", "--force");
  progress(`R2: eliminando imagen anterior ${key}`);
  await runWrangler(args);
}

async function prepareAndUploadImages(
  target: WranglerTarget,
  reportId: string,
  imageUrls: string[],
  summary: Summary,
  warnings: string[],
) {
  const dir = await mkdtemp(path.join(tmpdir(), "terremoto-import-images-"));
  const uploaded: StoredImage[] = [];
  try {
    for (let position = 0; position < imageUrls.length; position += 1) {
      const imageId = randomUUID();
      const key = `reports/${reportId}/${imageId}.webp`;
      try {
        const processed = await processImage(imageUrls[position], dir, imageId);
        const image: StoredImage = {
          imageId,
          key,
          path: processed.outputPath,
          sizeBytes: processed.size,
          width: processed.width,
          height: processed.height,
          position: uploaded.length,
        };
        await uploadImage(target, image);
        uploaded.push(image);
      } catch (error) {
        summary.imagesFailed += 1;
        warnings.push(
          error instanceof Error
            ? error.message
            : `No se pudo importar media ${imageUrls[position]}.`,
        );
      }
    }
    if (!uploaded.length) {
      throw new Error("Ninguna imagen válida pudo importarse.");
    }
    return uploaded;
  } catch (error) {
    for (const image of uploaded) {
      await deleteR2Object(target, image.key).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function reportSql(
  report: ReadyImportReport,
  reportId: string,
  images: StoredImage[],
  exists: boolean,
) {
  const now = new Date().toISOString();
  const reportValues = [
    sqlString(reportId),
    sqlString(report.buildingName),
    sqlString(report.address),
    sqlString(report.state),
    sqlString(report.city),
    sqlNumber(report.latitude),
    sqlNumber(report.longitude),
    sqlString(report.damageType),
    "0",
    sqlString(report.description),
    "NULL",
    "NULL",
    "NULL",
    "0",
    "'published'",
    sqlString(now),
    sqlString(now),
    sqlString(report.sourceName),
    sqlString(report.sourceId),
    sqlString(report.sourceUrl),
    sqlString(report.sourceUpdatedAt),
  ].join(", ");

  const statements = exists
    ? [
        `UPDATE reports SET
          building_name = ${sqlString(report.buildingName)},
          address = ${sqlString(report.address)},
          state = ${sqlString(report.state)},
          city = ${sqlString(report.city)},
          latitude = ${sqlNumber(report.latitude)},
          longitude = ${sqlNumber(report.longitude)},
          damage_type = ${sqlString(report.damageType)},
          needs_help = 0,
          description = ${sqlString(report.description)},
          contact_name = NULL,
          contact_phone = NULL,
          contact_email = NULL,
          contact_consent = 0,
          status = 'published',
          updated_at = ${sqlString(now)},
          source_url = ${sqlString(report.sourceUrl)},
          source_updated_at = ${sqlString(report.sourceUpdatedAt)}
        WHERE id = ${sqlString(reportId)};`,
        `DELETE FROM report_images WHERE report_id = ${sqlString(reportId)};`,
      ]
    : [
        `INSERT INTO reports (
          id, building_name, address, state, city, latitude, longitude,
          damage_type, needs_help, description, contact_name, contact_phone,
          contact_email, contact_consent, status, created_at, updated_at,
          source_name, source_id, source_url, source_updated_at
        ) VALUES (${reportValues});`,
      ];

  for (const image of images) {
    statements.push(
      `INSERT INTO report_images (
        id, report_id, r2_key, mime_type, size_bytes, width, height, position, created_at
      ) VALUES (
        ${sqlString(image.imageId)},
        ${sqlString(reportId)},
        ${sqlString(image.key)},
        'image/webp',
        ${sqlNumber(image.sizeBytes)},
        ${sqlNumber(image.width)},
        ${sqlNumber(image.height)},
        ${sqlNumber(image.position)},
        ${sqlString(now)}
      );`,
    );
  }

  return statements.join("\n");
}

async function importReport(
  target: WranglerTarget,
  report: ReadyImportReport,
  summary: Summary,
  options: CliOptions,
) {
  const existingId = await getExistingReportId(target, report.sourceId);
  if (existingId && !options.refreshExisting) {
    summary.skipped += 1;
    progress(`Importación: ya existe ${report.sourceId}; saltando.`);
    return;
  }
  const reportId = existingId ?? randomUUID();
  const existingKeys = existingId ? await getExistingImageKeys(target, reportId) : [];
  const imageWarnings: string[] = [];
  const uploaded = await prepareAndUploadImages(
    target,
    reportId,
    report.imageUrls,
    summary,
    imageWarnings,
  );
  summary.warnings.push(
    ...imageWarnings.map((warning) => `${report.sourceId}: ${warning}`),
  );

  try {
    await d1ExecFile(target, reportSql(report, reportId, uploaded, Boolean(existingId)));
  } catch (error) {
    for (const image of uploaded) {
      await deleteR2Object(target, image.key).catch(() => undefined);
    }
    throw error;
  }

  for (const key of existingKeys) {
    await deleteR2Object(target, key).catch(() => undefined);
  }

  summary.imagesUploaded += uploaded.length;
  if (existingId) summary.updated += 1;
  else summary.created += 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary: Summary = {
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    imagesUploaded: 0,
    imagesFailed: 0,
    discardedImages: 0,
    geocoded: 0,
    warnings: [],
  };

  progress("Inicio: leyendo fuente estructurada...");
  const sourceRows = await fetchSourceBuildings(options);
  summary.fetched = sourceRows.length;
  const normalized = [];
  const sourceItems = sourceRows.map(normalizeSourceBuilding);
  progress(`Normalización: ${sourceItems.length} edificios a procesar...`);
  let normalizedIndex = 0;
  for (const item of sourceItems) {
    normalizedIndex += 1;
    progress(`Normalización: ${normalizedIndex}/${sourceItems.length}`);
    if ("skipped" in item) normalized.push(item);
    else {
      try {
        normalized.push(await ensureCoordinates(item, summary));
      } catch (error) {
        normalized.push({
          skipped: true,
          reason:
            error instanceof Error
              ? `No se pudo geocodificar: ${error.message}`
              : "No se pudo geocodificar.",
          sourceId: item.sourceId,
        });
      }
    }
  }

  if (options.dryRun) {
    const target = await getWranglerTarget(options.env);
    for (const item of normalized) {
      if ("skipped" in item) {
        summary.skipped += 1;
        summary.warnings.push(`${item.sourceId || "sin-id"}: ${item.reason}`);
      }
      else {
        if (!options.refreshExisting && (await getExistingReportId(target, item.sourceId))) {
          summary.skipped += 1;
          summary.warnings.push(`${item.sourceId}: ya existe; se saltaría.`);
          continue;
        }
        summary.discardedImages += item.discardedImageCount;
        summary.warnings.push(...item.warnings.map((warning) => `${item.sourceId}: ${warning}`));
      }
    }
    console.log(JSON.stringify({ mode: "dry-run", summary }, null, 2));
    return;
  }

  const target = await getWranglerTarget(options.env);
  let importedIndex = 0;
  for (const item of normalized) {
    importedIndex += 1;
    if ("skipped" in item) {
      summary.skipped += 1;
      summary.warnings.push(`${item.sourceId || "sin-id"}: ${item.reason}`);
      progress(
        `Importación: saltado ${importedIndex}/${normalized.length} ${item.sourceId || "sin-id"} (${item.reason})`,
      );
      continue;
    }
    progress(
      `Importación: ${importedIndex}/${normalized.length} ${item.buildingName} (${item.imageUrls.length} fotos)`,
    );
    summary.discardedImages += item.discardedImageCount;
    summary.warnings.push(...item.warnings.map((warning) => `${item.sourceId}: ${warning}`));
    try {
      await importReport(target, item, summary, options);
    } catch (error) {
      summary.errors += 1;
      summary.warnings.push(
        `${item.sourceId}: ${
          error instanceof Error ? error.message : "Error desconocido"
        }`,
      );
    }
  }

  console.log(JSON.stringify({ mode: "write", env: options.env, summary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
