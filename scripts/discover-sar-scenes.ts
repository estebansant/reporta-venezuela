/**
 * Phase 1 — SAR Open Data discovery (read-only, no DB writes).
 *
 * Both Umbra and ICEYE Open Data are public, no-sign-request, date-partitioned
 * S3 buckets. This tool lists keys within the relevant date windows, fetches
 * only those item JSONs, keeps the ones whose footprint intersects a Venezuela
 * AOI bbox, splits them into "pre" (before the quake) and "post" (after) windows,
 * pairs overlapping pre/post footprints, and writes a manifest the ingest tier
 * (Phase 2) consumes.
 *
 * Gate: if there are no usable POST scenes, SAR coverage of the quake does not
 * exist in these open datasets (yet) and the downstream phases do not apply.
 *
 *   npx tsx scripts/discover-sar-scenes.ts \
 *     --bbox -70,9.5,-66,11 --pre-from 2026-01-01 \
 *     --out sar-scenes.manifest.json
 */
import { writeFile } from "node:fs/promises";

import { fetchWithTimeout, progress } from "./import-wrangler";

type Bbox = [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
type Provider = "umbra" | "iceye";

interface ProviderConfig {
  provider: Provider;
  bucketUrl: string; // public HTTPS S3 endpoint root
  // S3 key prefixes to list, given a [start,end] month range (YYYY-MM strings).
  monthPrefixes: (months: string[]) => string[];
  // Extract YYYY-MM-DD from an item key, or null if the key is not an item.
  keyToDate: (key: string) => string | null;
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  umbra: {
    provider: "umbra",
    bucketUrl: "https://s3.us-west-2.amazonaws.com/umbra-open-data-catalog",
    // stac/<YYYY>/<YYYY-MM>/<YYYY-MM-DD>/<uuid>/<uuid>.json
    monthPrefixes: (months) =>
      months.map((m) => `stac/${m.slice(0, 4)}/${m}/`),
    keyToDate: (key) => {
      if (key.endsWith("/catalog.json")) return null;
      if (!key.endsWith(".json")) return null;
      const match = key.match(/\/(\d{4}-\d{2}-\d{2})\//);
      return match?.[1] ?? null;
    },
  },
  iceye: {
    provider: "iceye",
    bucketUrl: "https://s3.us-west-2.amazonaws.com/iceye-open-data-catalog",
    // stac-items/<YYYY>/<MM>/ICEYE_..._<YYYYMMDD>T...Z_...json
    monthPrefixes: (months) =>
      months.map((m) => `stac-items/${m.slice(0, 4)}/${m.slice(5, 7)}/`),
    keyToDate: (key) => {
      if (!key.endsWith(".json")) return null;
      const match = key.match(/_(\d{4})(\d{2})(\d{2})T/);
      if (!match) return null;
      return `${match[1]}-${match[2]}-${match[3]}`;
    },
  },
};

// Default AOI: affected central Venezuela (Aragua/Carabobo/coast), overridable.
const DEFAULT_BBOX: Bbox = [-70, 9.5, -66, 11];
const DEFAULT_PRE_FROM = "2026-01-01"; // lower bound so "pre" stays bounded & recent
const DEFAULT_PRE_BEFORE = "2026-06-23"; // pre = [preFrom, preBefore)
const DEFAULT_POST_FROM = "2026-06-24"; // post = [postFrom, today]
const FETCH_CONCURRENCY = 10;

interface CliOptions {
  bbox: Bbox;
  preFrom: string; // YYYY-MM-DD
  preBefore: string; // YYYY-MM-DD
  postFrom: string; // YYYY-MM-DD
  postUntil: string; // YYYY-MM-DD (defaults to today)
  out: string;
  providers: Provider[];
}

function parseArgs(argv: string[]): CliOptions {
  if (argv[0] === "--") argv = argv.slice(1);
  const today = new Date().toISOString().slice(0, 10);
  const options: CliOptions = {
    bbox: DEFAULT_BBOX,
    preFrom: DEFAULT_PRE_FROM,
    preBefore: DEFAULT_PRE_BEFORE,
    postFrom: DEFAULT_POST_FROM,
    postUntil: today,
    out: "sar-scenes.manifest.json",
    providers: ["umbra", "iceye"],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Falta valor para ${arg}.`);
      index += 1;
      return value;
    };

    if (arg === "--") continue;
    else if (arg === "--bbox") {
      const parts = next().split(",").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error("--bbox debe ser minLng,minLat,maxLng,maxLat.");
      }
      options.bbox = parts as Bbox;
    } else if (arg === "--pre-from") options.preFrom = next();
    else if (arg === "--pre-before") options.preBefore = next();
    else if (arg === "--post-from") options.postFrom = next();
    else if (arg === "--post-until") options.postUntil = next();
    else if (arg === "--out") options.out = next();
    else if (arg === "--provider") {
      const value = next();
      if (value !== "umbra" && value !== "iceye") {
        throw new Error("--provider debe ser umbra o iceye.");
      }
      options.providers = [value];
    } else throw new Error(`Argumento desconocido: ${arg}`);
  }

  return options;
}

// All YYYY-MM strings spanning [from, until] inclusive.
function monthsBetween(from: string, until: string): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(until.slice(0, 4));
  const endMonth = Number(until.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

// ---------------------------------------------------------------------------
// Minimal STAC item shape (only the fields we read).
// ---------------------------------------------------------------------------

interface StacAsset {
  href: string;
  type?: string;
  roles?: string[];
  title?: string;
}
interface StacItem {
  id?: string;
  bbox?: number[];
  geometry?: unknown;
  properties?: Record<string, unknown>;
  assets?: Record<string, StacAsset>;
}

function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function normalizeBbox(raw: number[] | undefined): Bbox | null {
  if (!raw) return null;
  if (raw.length === 4) return [raw[0], raw[1], raw[2], raw[3]];
  if (raw.length === 6) return [raw[0], raw[1], raw[3], raw[4]];
  return null;
}

function itemDatetime(item: StacItem): string | null {
  const props = item.properties ?? {};
  return (
    (props.datetime as string | undefined) ??
    (props.start_datetime as string | undefined) ??
    (props["end_datetime"] as string | undefined) ??
    null
  );
}

// Pick the GEC / geocoded Cloud-Optimized GeoTIFF asset for display + clipping.
function pickCogAsset(item: StacItem): StacAsset | null {
  const assets = Object.entries(item.assets ?? {});
  const isTiff = (a: StacAsset) =>
    /\.tiff?($|\?)/i.test(a.href) || /tiff|geotiff/i.test(a.type ?? "");
  const score = (key: string, a: StacAsset) => {
    const haystack = `${key} ${a.title ?? ""} ${(a.roles ?? []).join(" ")}`.toLowerCase();
    let value = 0;
    if (haystack.includes("gec")) value += 4; // geocoded, flattened — best for overlay
    if (haystack.includes("geo")) value += 2;
    if ((a.roles ?? []).includes("data")) value += 2;
    if (haystack.includes("visual") || haystack.includes("preview")) value += 1;
    if (/slc|cphd|sicd/.test(haystack)) value -= 4; // complex, not directly displayable
    return value;
  };
  const tiffs = assets.filter(([, a]) => isTiff(a));
  if (!tiffs.length) return null;
  tiffs.sort((a, b) => score(b[0], b[1]) - score(a[0], a[1]));
  return tiffs[0][1];
}

// ---------------------------------------------------------------------------
// S3 ListObjectsV2 (XML) — paginated key listing under a prefix.
// ---------------------------------------------------------------------------

async function listKeys(bucketUrl: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const url = new URL(bucketUrl);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", "1000");
    if (token) url.searchParams.set("continuation-token", token);
    const response = await fetchWithTimeout(url.toString(), {
      headers: { Accept: "application/xml" },
    });
    if (!response.ok) {
      progress(`  list ${prefix} respondió ${response.status}`);
      break;
    }
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(match[1]);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    token = truncated && next ? next[1] : undefined;
  } while (token);
  return keys;
}

async function fetchItem(url: string): Promise<StacItem | null> {
  try {
    const response = await fetchWithTimeout(url, {
      headers: { Accept: "application/json, application/geo+json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as StacItem;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

interface SceneRef {
  provider: Provider;
  sceneId: string;
  phase: "pre" | "post";
  acquiredAt: string | null;
  bbox: Bbox;
  footprint: unknown;
  cogUrl: string;
  sourceUrl: string;
}

interface ProviderStats {
  keysListed: number;
  inWindow: number;
  fetched: number;
  intersecting: number;
  matchedPre: number;
  matchedPost: number;
  skippedNoCog: number;
}

function classify(date: string, options: CliOptions): "pre" | "post" | null {
  if (date >= options.postFrom && date <= options.postUntil) return "post";
  if (date >= options.preFrom && date < options.preBefore) return "pre";
  return null;
}

async function crawlProvider(
  config: ProviderConfig,
  options: CliOptions,
  stats: ProviderStats,
): Promise<SceneRef[]> {
  const scenes: SceneRef[] = [];
  const months = monthsBetween(options.preFrom, options.postUntil);
  const prefixes = config.monthPrefixes(months);

  // 1) List keys for the relevant months and keep only in-window item JSONs.
  const candidates: { key: string; date: string; phase: "pre" | "post" }[] = [];
  for (const prefix of prefixes) {
    const keys = await listKeys(config.bucketUrl, prefix);
    stats.keysListed += keys.length;
    for (const key of keys) {
      const date = config.keyToDate(key);
      if (!date) continue;
      const phase = classify(date, options);
      if (!phase) continue;
      candidates.push({ key, date, phase });
    }
  }
  stats.inWindow = candidates.length;
  progress(`  ${config.provider}: ${candidates.length} items en ventana temporal.`);

  // 2) Fetch only the in-window items and keep those intersecting the AOI.
  for (let i = 0; i < candidates.length; i += FETCH_CONCURRENCY) {
    const slice = candidates.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (c) => {
        const url = `${config.bucketUrl}/${c.key}`;
        return { c, url, item: await fetchItem(url) };
      }),
    );
    for (const { c, url, item } of results) {
      stats.fetched += 1;
      if (!item) continue;
      const bbox = normalizeBbox(item.bbox);
      if (!bbox || !bboxesIntersect(bbox, options.bbox)) continue;
      stats.intersecting += 1;
      const asset = pickCogAsset(item);
      if (!asset) {
        stats.skippedNoCog += 1;
        continue;
      }
      if (c.phase === "pre") stats.matchedPre += 1;
      else stats.matchedPost += 1;
      scenes.push({
        provider: config.provider,
        sceneId: item.id ?? c.key,
        phase: c.phase,
        acquiredAt: itemDatetime(item) ?? `${c.date}T00:00:00Z`,
        bbox,
        footprint: item.geometry ?? null,
        cogUrl: new URL(asset.href, url).toString(),
        sourceUrl: url,
      });
    }
  }

  return scenes;
}

// Pair pre/post scenes by overlapping footprints.
interface ScenePair {
  pairKey: string;
  bbox: Bbox;
  pre: SceneRef | null;
  post: SceneRef;
}

function pairScenes(scenes: SceneRef[]): ScenePair[] {
  const pre = scenes.filter((s) => s.phase === "pre");
  const post = scenes.filter((s) => s.phase === "post");
  return post.map((postScene, index) => {
    const candidates = pre
      .filter((p) => bboxesIntersect(p.bbox, postScene.bbox))
      .sort((a, b) => {
        const sameA = a.provider === postScene.provider ? 0 : 1;
        const sameB = b.provider === postScene.provider ? 0 : 1;
        if (sameA !== sameB) return sameA - sameB;
        return (b.acquiredAt ?? "").localeCompare(a.acquiredAt ?? ""); // most recent pre
      });
    return {
      pairKey: `${postScene.provider}:${postScene.sceneId}:${index}`,
      bbox: postScene.bbox,
      pre: candidates[0] ?? null,
      post: postScene,
    };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  progress(
    `Discovery SAR | bbox=${options.bbox.join(",")} | pre=[${options.preFrom},${options.preBefore}) | post=[${options.postFrom},${options.postUntil}]`,
  );

  const allScenes: SceneRef[] = [];
  const providerStats: Record<string, ProviderStats> = {};

  for (const provider of options.providers) {
    const stats: ProviderStats = {
      keysListed: 0,
      inWindow: 0,
      fetched: 0,
      intersecting: 0,
      matchedPre: 0,
      matchedPost: 0,
      skippedNoCog: 0,
    };
    providerStats[provider] = stats;
    progress(`Proveedor ${provider}: listando ${PROVIDERS[provider].bucketUrl}`);
    const scenes = await crawlProvider(PROVIDERS[provider], options, stats);
    allScenes.push(...scenes);
    progress(
      `  ${provider}: ${stats.intersecting} en AOI -> ${stats.matchedPre} pre / ${stats.matchedPost} post.`,
    );
  }

  const pairs = pairScenes(allScenes);
  const postCount = allScenes.filter((s) => s.phase === "post").length;
  const pairsWithPre = pairs.filter((p) => p.pre).length;

  const manifest = {
    generatedAt: new Date().toISOString(),
    aoiBbox: options.bbox,
    windows: {
      preFrom: options.preFrom,
      preBefore: options.preBefore,
      postFrom: options.postFrom,
      postUntil: options.postUntil,
    },
    providers: providerStats,
    summary: {
      scenes: allScenes.length,
      pre: allScenes.length - postCount,
      post: postCount,
      pairs: pairs.length,
      pairsWithPre,
    },
    pairs,
    scenes: allScenes,
  };

  await writeFile(options.out, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        out: options.out,
        ...manifest.summary,
        gate:
          postCount === 0
            ? "SIN COBERTURA POST-SISMO: las fases 2-3 (ingesta/overlay SAR) no aplican todavía."
            : `${postCount} escena(s) post-sismo (${pairsWithPre} con par pre).`,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
