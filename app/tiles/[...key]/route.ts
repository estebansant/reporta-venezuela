import { jsonHeaders } from "@/lib/api-protection";
import { getCloudflareEnv } from "@/lib/cloudflare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TILES_CACHE_CONTROL = "public, max-age=300, s-maxage=600";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: jsonHeaders({ "Cache-Control": "no-store" }),
  });
}

function contentTypeForKey(key: string) {
  if (key.endsWith(".pmtiles")) return "application/vnd.pmtiles";
  if (key.endsWith(".geojson")) return "application/geo+json; charset=utf-8";
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function cacheControlForKey(key: string) {
  return key.endsWith("manifest.json")
    ? TILES_CACHE_CONTROL
    : IMMUTABLE_CACHE_CONTROL;
}

function parseRange(
  rangeHeader: string,
  totalSize: number,
): { offset: number; length: number; end: number } | null {
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;
  const start = Number.parseInt(match[1], 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : totalSize - 1;
  if (start > end || end >= totalSize || start < 0) return null;
  return { offset: start, length: end - start + 1, end };
}

async function handleTilesRequest(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  const { key: parts } = await context.params;
  const key = `tiles/${parts.join("/")}`;
  if (
    !/^tiles\/[a-zA-Z0-9_./-]+\.(?:json|geojson|pmtiles)$/i.test(key) ||
    key.includes("..")
  ) {
    return notFound();
  }

  const { MAP_TILES } = await getCloudflareEnv();
  const rangeHeader = request.headers.get("range");
  const contentType = contentTypeForKey(key);
  const cacheControl = cacheControlForKey(key);

  if (rangeHeader) {
    const head = await MAP_TILES.head(key);
    if (!head) return notFound();
    const range = parseRange(rangeHeader, head.size);
    if (!range) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: jsonHeaders({ "Content-Range": `bytes */${head.size}` }),
      });
    }

    const object = await MAP_TILES.get(key, {
      range: { offset: range.offset, length: range.length },
    });
    if (!object?.body) return notFound();

    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 206,
      headers: jsonHeaders({
        "Content-Type": contentType,
        "Content-Range": `bytes ${range.offset}-${range.end}/${head.size}`,
        "Content-Length": String(range.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl,
        ETag: head.httpEtag,
        "X-Content-Type-Options": "nosniff",
      }),
    });
  }

  const ifNoneMatch = request.headers.get("if-none-match");
  const object = await MAP_TILES.get(key, {
    onlyIf: ifNoneMatch
      ? { etagDoesNotMatch: ifNoneMatch.replaceAll('"', "") }
      : undefined,
  });
  if (!object) return notFound();
  if (!object.body) {
    return new Response(null, {
      status: 304,
      headers: jsonHeaders({ ETag: object.httpEtag, "Cache-Control": cacheControl }),
    });
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: jsonHeaders({
      "Content-Type": contentType,
      "Content-Length": String(object.size),
      "Accept-Ranges": "bytes",
      ETag: object.httpEtag,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    }),
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  return handleTilesRequest(request, context);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  return handleTilesRequest(request, context);
}
