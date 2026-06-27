import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ImportEnv = "local" | "preview" | "production";

export interface WranglerTarget {
  env: ImportEnv;
  dbName: string;
  bucketName: string;
  d1Args: string[];
  r2Args: string[];
}

export interface StoredImage {
  imageId: string;
  key: string;
  path: string;
  sizeBytes: number;
  width: number;
  height: number;
  position: number;
}

const startedAt = Date.now();

export function progress(message: string) {
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  process.stderr.write(`[${elapsed}s] ${message}\n`);
}

function stripJsonComments(input: string) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
}

export async function getWranglerTarget(env: ImportEnv): Promise<WranglerTarget> {
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

export async function runWrangler(
  args: string[],
  options: { inputFile?: string } = {},
) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "pnpm",
      ["exec", "wrangler", ...args],
      {
        env: {
          ...process.env,
          NO_COLOR: "1",
          WRANGLER_LOG_PATH: path.join(tmpdir(), "wrangler-satellite.log"),
        },
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (stderr.trim() && !options.inputFile) {
      process.stderr.write(stderr);
    }
    return stdout;
  } catch (error) {
    const failed = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (failed.stdout?.trim()) process.stderr.write(`${failed.stdout}\n`);
    if (failed.stderr?.trim()) process.stderr.write(`${failed.stderr}\n`);
    throw new Error(failed.message ?? "Wrangler falló.");
  }
}

export async function d1Json<T = unknown>(
  target: WranglerTarget,
  sql: string,
): Promise<T[]> {
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

export async function d1ExecFile(target: WranglerTarget, sql: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "terremoto-satellite-sql-"));
  const file = path.join(dir, "import.sql");
  try {
    await writeFile(file, sql);
    progress(`D1: escribiendo cambios en ${target.env}...`);
    await runWrangler([...target.d1Args, "--file", file, "--yes"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function sqlString(value: string | null | undefined) {
  if (value === null || value === undefined) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

export function sqlNumber(value: number) {
  if (!Number.isFinite(value)) throw new Error(`Número SQL inválido: ${value}`);
  return String(value);
}

const FETCH_TIMEOUT_MS = 60_000;

export async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadImage(target: WranglerTarget, image: StoredImage) {
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

export async function deleteR2Object(target: WranglerTarget, key: string) {
  const args = [...target.r2Args, "delete", `${target.bucketName}/${key}`];
  if (target.env === "local") args.push("--local");
  else args.push("--remote", "--force");
  progress(`R2: eliminando ${key}`);
  await runWrangler(args);
}
