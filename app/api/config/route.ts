import { getCloudflareEnv } from "@/lib/cloudflare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = await getCloudflareEnv();
  return Response.json(
    {
      turnstileSiteKey:
        env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??
        "1x00000000000000000000AA",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
