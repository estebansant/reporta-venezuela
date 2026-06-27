import { describe, expect, it, vi } from "vitest";

import {
  cachedJson,
  invalidateClientFetchCache,
  normalizeRequestKey,
} from "./client-fetch-cache";

describe("normalizeRequestKey", () => {
  it("sorts query params into a stable key", () => {
    const left = new URLSearchParams("b=2&a=1&a=0");
    const right = new URLSearchParams("a=0&a=1&b=2");

    expect(normalizeRequestKey("/api/reports", left)).toBe(
      normalizeRequestKey("/api/reports", right),
    );
  });
});

describe("cachedJson", () => {
  it("returns cached data for the same key", async () => {
    invalidateClientFetchCache();
    const load = vi.fn(async () => ({ value: 1 }));

    await expect(cachedJson("reports", 1_000, load)).resolves.toEqual({
      value: 1,
    });
    await expect(cachedJson("reports", 1_000, load)).resolves.toEqual({
      value: 1,
    });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent requests with one in-flight promise", async () => {
    invalidateClientFetchCache();
    const load = vi.fn(
      () =>
        new Promise<{ value: number }>((resolve) => {
          setTimeout(() => resolve({ value: 2 }), 1);
        }),
    );

    const [first, second] = await Promise.all([
      cachedJson("map", 1_000, load),
      cachedJson("map", 1_000, load),
    ]);

    expect(first).toEqual(second);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refetches expired entries", async () => {
    invalidateClientFetchCache();
    vi.useFakeTimers();
    const load = vi
      .fn()
      .mockResolvedValueOnce({ value: 1 })
      .mockResolvedValueOnce({ value: 2 });

    await expect(cachedJson("directory", 50, load)).resolves.toEqual({
      value: 1,
    });
    vi.advanceTimersByTime(51);
    await expect(cachedJson("directory", 50, load)).resolves.toEqual({
      value: 2,
    });

    expect(load).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("invalidates matching keys", async () => {
    invalidateClientFetchCache();
    const load = vi
      .fn()
      .mockResolvedValueOnce({ value: 1 })
      .mockResolvedValueOnce({ value: 2 });

    await cachedJson("/api/reports?page=1", 1_000, load);
    invalidateClientFetchCache((key) => key.startsWith("/api/reports"));
    await expect(cachedJson("/api/reports?page=1", 1_000, load)).resolves.toEqual(
      { value: 2 },
    );

    expect(load).toHaveBeenCalledTimes(2);
  });
});

