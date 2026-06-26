import { jsonHeaders } from "@/lib/api-protection";
import { getCloudflareEnv } from "@/lib/cloudflare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

function notFoundResponse() {
  return new Response("Not found", {
    status: 404,
    headers: jsonHeaders({ "Cache-Control": "no-store" }),
  });
}

async function handleMediaRequest(
  request: Request,
  context: RouteContext<"/media/[...key]">,
) {
  const { key: parts } = await context.params;
  const key = parts.join("/");
  if (
    !/^reports\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(key) ||
    key.includes("..")
  ) {
    return notFoundResponse();
  }

  const { REPORT_IMAGES } = await getCloudflareEnv();
  const ifNoneMatch = request.headers.get("if-none-match");
  const object = await REPORT_IMAGES.get(key, {
    onlyIf: ifNoneMatch
      ? { etagDoesNotMatch: ifNoneMatch.replaceAll('"', "") }
      : undefined,
  });
  if (!object) return notFoundResponse();
  if (!object.body) {
    return new Response(null, {
      status: 304,
      headers: jsonHeaders({
        ETag: object.httpEtag,
        "Cache-Control": MEDIA_CACHE_CONTROL,
      }),
    });
  }

  const headers = jsonHeaders();
  // Set Content-Type explicitly instead of object.writeHttpMetadata(): the
  // latter throws under the local `next dev` R2 shim. All stored media is webp.
  headers.set(
    "Content-Type",
    object.httpMetadata?.contentType ?? "image/webp",
  );
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", MEDIA_CACHE_CONTROL);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

export async function GET(
  request: Request,
  context: RouteContext<"/media/[...key]">,
) {
  return handleMediaRequest(request, context);
}

export async function HEAD(
  request: Request,
  context: RouteContext<"/media/[...key]">,
) {
  return handleMediaRequest(request, context);
}
