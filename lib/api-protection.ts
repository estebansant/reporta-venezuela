type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

const DEFAULT_IP = "unknown";
const MAX_BUCKETS = 2048;

export type RateLimitOptions = {
  namespace: string;
  limit: number;
  windowMs: number;
};

export function getClientIp(request: Request) {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    DEFAULT_IP
  );
}

export function checkRateLimit(request: Request, options: RateLimitOptions) {
  const now = Date.now();
  const ip = getClientIp(request);
  const key = `${options.namespace}:${ip}`;
  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + options.windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > MAX_BUCKETS) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now || buckets.size > MAX_BUCKETS) {
        buckets.delete(bucketKey);
      }
      if (buckets.size <= MAX_BUCKETS) break;
    }
  }

  const remaining = Math.max(0, options.limit - bucket.count);
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  return {
    allowed: bucket.count <= options.limit,
    ip,
    remaining,
    retryAfter,
    resetAt: bucket.resetAt,
  };
}

export function rateLimitResponse(retryAfter: number) {
  return Response.json(
    { error: "Demasiadas solicitudes. Inténtalo de nuevo en unos minutos." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    },
  );
}

export function jsonHeaders(init?: HeadersInit) {
  const headers = new Headers(init);
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}
