import { getCloudflareEnv } from "@/lib/cloudflare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COG_CACHE_CONTROL = "public, max-age=31536000, immutable";

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

function parseRange(
  rangeHeader: string,
  totalSize: number,
): { offset: number; length: number; end: number } | null {
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
  if (start > end || end >= totalSize || start < 0) return null;
  return { offset: start, length: end - start + 1, end };
}

async function handleRequest(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  const { key: parts } = await context.params;
  // Prefix with "imagery/" — matches the R2 key namespace used when uploading.
  const key = `imagery/${parts.join("/")}`;

  if (!/^imagery\/[a-zA-Z0-9_./-]+\.tiff?$/i.test(key) || key.includes("..")) {
    return notFound();
  }

  const { MAP_TILES } = await getCloudflareEnv();
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    // HEAD first to learn total size for Content-Range response.
    const head = await MAP_TILES.head(key);
    if (!head) return notFound();

    const totalSize = head.size;
    const range = parseRange(rangeHeader, totalSize);

    if (!range) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${totalSize}` },
      });
    }

    const object = await MAP_TILES.get(key, {
      range: { offset: range.offset, length: range.length },
    });
    if (!object?.body) return notFound();

    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 206,
      headers: {
        "Content-Type": "image/tiff",
        "Content-Range": `bytes ${range.offset}-${range.end}/${totalSize}`,
        "Content-Length": String(range.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": COG_CACHE_CONTROL,
        "ETag": head.httpEtag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // Non-range request: ETag conditional + full object.
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
      headers: {
        ETag: object.httpEtag,
        "Cache-Control": COG_CACHE_CONTROL,
      },
    });
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: {
      "Content-Type": "image/tiff",
      "Content-Length": String(object.size),
      "Accept-Ranges": "bytes",
      "ETag": object.httpEtag,
      "Cache-Control": COG_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  return handleRequest(request, context);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  return handleRequest(request, context);
}
