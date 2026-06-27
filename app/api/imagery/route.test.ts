import { describe, expect, it, vi } from "vitest";

type MockSceneRow = {
  scene_id: string;
  provider: string;
  license: string | null;
  phase: string | null;
  datetime: string | null;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  r2_key: string;
  resolution_m: number | null;
};

const mocks = vi.hoisted(() => ({
  sql: "",
  bindings: [] as (string | number)[],
  failWith: null as Error | null,
  results: [
    {
      scene_id: "msaig-catia-post-01",
      provider: "ms-ai-for-good",
      license: "CC BY 4.0",
      phase: "post",
      datetime: "2026-06-26T10:00:00.000Z",
      min_lat: 10.3,
      max_lat: 10.9,
      min_lng: -67.5,
      max_lng: -66.8,
      r2_key: "imagery/msaig-catia-post-01/ms-ai-for-good.tif",
      resolution_m: 0.5,
    },
  ] as MockSceneRow[],
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
              all: async () => {
                if (mocks.failWith) {
                  const error = mocks.failWith;
                  mocks.failWith = null;
                  throw error;
                }
                return { results: mocks.results };
              },
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

describe("/api/imagery", () => {
  it("returns scenes for the requested viewport with correct cache headers", async () => {
    mocks.failWith = null;

    const response = await GET(
      new Request(
        "https://example.com/api/imagery?north=11&south=10&east=-66&west=-67",
      ),
    );
    const body = (await response.json()) as { scenes: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=600, stale-while-revalidate=1200",
    );
    expect(mocks.sql).toContain("FROM imagery_scenes");
    expect(mocks.sql).toContain("max_lat >= ?");
    expect(mocks.sql).toContain("ORDER BY datetime DESC");
    expect(mocks.sql).toContain("LIMIT ?");
    expect(mocks.bindings).toEqual([10, 11, -67, -66, 20]);
    expect(body.scenes[0]).toMatchObject({
      sceneId: "msaig-catia-post-01",
      provider: "ms-ai-for-good",
      phase: "post",
      r2Key: "imagery/msaig-catia-post-01/ms-ai-for-good.tif",
      resolutionM: 0.5,
      bbox: [-67.5, 10.3, -66.8, 10.9],
    });
  });

  it("filters by phase when provided", async () => {
    mocks.failWith = null;

    await GET(
      new Request(
        "https://example.com/api/imagery?north=11&south=10&east=-66&west=-67&phase=pre",
      ),
    );

    expect(mocks.sql).toContain("phase = ?");
    expect(mocks.bindings).toContain("pre");
  });

  it("returns empty scenes when imagery_scenes table does not exist", async () => {
    mocks.failWith = new Error(
      "D1_ERROR: no such table: imagery_scenes",
    );

    const response = await GET(
      new Request("https://example.com/api/imagery?north=11&south=10&east=-66&west=-67"),
    );
    const body = (await response.json()) as { scenes: unknown[] };

    expect(response.status).toBe(200);
    expect(body.scenes).toHaveLength(0);
  });

  it("rejects invalid query params", async () => {
    mocks.failWith = null;

    const response = await GET(
      new Request("https://example.com/api/imagery?north=invalid"),
    );

    expect(response.status).toBe(400);
  });
});
