interface CloudflareEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  REPORT_IMAGES: R2Bucket;
  MAP_TILES: R2Bucket;
  TURNSTILE_SECRET: string;
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: string;
  SATELLITE_ADMIN_SECRET?: string;
}
