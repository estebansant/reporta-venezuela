import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function getCloudflareEnv() {
  const { env } = await getCloudflareContext({ async: true });
  return env as CloudflareEnv;
}
