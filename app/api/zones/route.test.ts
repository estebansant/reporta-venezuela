import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: "",
  bindings: [] as (string | number)[],
  results: [
    {
      id: "aria-dpm:TEST:0:0",
      geometry: JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [-68, 10.5],
            [-67.9, 10.5],
            [-67.9, 10.6],
            [-68, 10.6],
            [-68, 10.5],
          ],
        ],
      }),
      damage_category: "severe",
      score: 0.9,
      source_name: "aria-dpm",
      acquired_at: "2026-06-25T00:00:00.000Z",
    },
  ],
}));

vi.mock("@/lib/cloudflare", () => ({
  getCloudflareEnv: async () => ({
    DB: {
      prepare(sql: string) {
        mocks.sql = sql;
        return {
          bind(...bindings: (string | number)[]) {
            mocks.bindings = bindings;
            return {
              all: async () => ({ results: mocks.results }),
            };
          },
        };
      },
    },
  }),
}));

vi.mock("@/lib/api-protection", () => ({
  checkRateLimit: () => ({ allowed: true, retryAfter: 1 }),
  jsonHeaders: (init?: HeadersInit) => new Headers(init),
  rateLimitResponse: (retryAfter: number) =>
    Response.json(
      { error: "Demasiadas solicitudes." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    ),
}));

vi.mock("@/lib/report-schema", async () => {
  return await import("../../../lib/report-schema");
});

import { GET } from "./route";

describe("/api/zones", () => {
  it("filters by viewport bbox and parses geometry to GeoJSON", async () => {
    const response = await GET(
      new Request(
        "https://example.com/api/zones?north=11&south=10&east=-66&west=-68",
      ),
    );
    const body = (await response.json()) as {
      zones: { id: string; geometry: { type: string }; damageCategory: string }[];
    };

    expect(mocks.sql).toContain("FROM damage_zones");
    expect(mocks.sql).toContain("max_lat >= ? AND min_lat <= ?");
    // south, north, west, east, limit
    expect(mocks.bindings).toEqual([10, 11, -68, -66, 500]);

    const zone = body.zones[0];
    expect(zone.id).toBe("aria-dpm:TEST:0:0");
    expect(zone.damageCategory).toBe("severe");
    expect(zone.geometry.type).toBe("Polygon");
  });
});
