type CacheEntry<T> = {
  data?: T;
  expiresAt: number;
  inFlight?: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();

export function normalizeRequestKey(path: string, params?: URLSearchParams) {
  if (!params) return path;
  const sorted = new URLSearchParams();
  Array.from(params.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyDiff = leftKey.localeCompare(rightKey);
      return keyDiff || leftValue.localeCompare(rightValue);
    })
    .forEach(([key, value]) => sorted.append(key, value));
  const query = sorted.toString();
  return query ? `${path}?${query}` : path;
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

export async function cachedJson<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  signal?: AbortSignal,
) {
  const now = Date.now();
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing?.data !== undefined && existing.expiresAt > now) {
    return existing.data;
  }
  if (existing?.inFlight) return abortable(existing.inFlight, signal);

  const entry: CacheEntry<T> = {
    expiresAt: now + ttlMs,
  };
  const inFlight = load()
    .then((data) => {
      entry.data = data;
      entry.expiresAt = Date.now() + ttlMs;
      return data;
    })
    .finally(() => {
      entry.inFlight = undefined;
    });
  entry.inFlight = inFlight;
  cache.set(key, entry);
  return abortable(inFlight, signal);
}

export function invalidateClientFetchCache(
  predicate?: (key: string) => boolean,
) {
  if (!predicate) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (predicate(key)) cache.delete(key);
  }
}

