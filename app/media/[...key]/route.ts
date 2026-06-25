import { getCloudflareEnv } from "@/lib/cloudflare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext<"/media/[...key]">,
) {
  const { key: parts } = await context.params;
  const key = parts.join("/");
  if (
    !/^reports\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(key) ||
    key.includes("..")
  ) {
    return new Response("Not found", { status: 404 });
  }

  const { REPORT_IMAGES } = await getCloudflareEnv();
  const ifNoneMatch = request.headers.get("if-none-match");
  const object = await REPORT_IMAGES.get(key, {
    onlyIf: ifNoneMatch
      ? { etagDoesNotMatch: ifNoneMatch.replaceAll('"', "") }
      : undefined,
  });
  if (!object) return new Response("Not found", { status: 404 });
  if (!object.body) {
    return new Response(null, {
      status: 304,
      headers: { ETag: object.httpEtag },
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
