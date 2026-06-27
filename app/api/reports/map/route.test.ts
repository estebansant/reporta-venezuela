import { describe, expect, it, vi } from "vitest";

type MockMapRow = {
  id: string;
  building_name: string;
  address: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  damage_type: string;
  needs_help: number;
  created_at: string;
  verified_by_satellite: number;
  chip_image_id: string | null;
};

const mocks = vi.hoisted(() => ({
  sql: "",
  sqls: [] as string[],
  bindings: [] as (string | number)[],
  failFirstQueryWith: null as Error | null,
  results: [
    {
      id: "report-1",
      building_name: "Edificio Las Acacias",
      address: "Avenida Sucre, Caracas",
      state: "Distrito Capital",
      city: "Caracas",
      latitude: 10.5,
      longitude: -66.9,
      damage_type: "severe",
      needs_help: 1,
      created_at: "2026-06-26T12:00:00.000Z",
      verified_by_satellite: 1,
      chip_image_id: "img-1",
    },
  ] as MockMapRow[],
}));

vi.mock("@/lib/cloudflare", () => ({
  getCloudflareEnv: async () => ({
    DB: {
      prepare(sql: string) {
        mocks.sql = sql;
        mocks.sqls.push(sql);
        return {
          bind(...bindings: (string | number)[]) {
            mocks.bindings = bindings;
            return {
              all: async () => {
                if (mocks.failFirstQueryWith) {
                  const error = mocks.failFirstQueryWith;
                  mocks.failFirstQueryWith = null;
                  throw error;
                }
                if (sql.includes("0 AS verified_by_satellite")) {
                  return {
                    results: mocks.results.map((row) => ({
                      ...row,
                      verified_by_satellite: 0,
                      chip_image_id: null,
                    })),
                  };
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
      { error: "Demasiadas solicitudes. Inténtalo de nuevo en unos minutos." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    ),
}));

vi.mock("@/lib/report-schema", async () => {
  return await import("../../../../lib/report-schema");
});

import { GET } from "./route";

describe("/api/reports/map", () => {
  it("falls back to a legacy query when satellite columns are missing", async () => {
    mocks.sqls = [];
    mocks.failFirstQueryWith = new Error(
      "D1_ERROR: no such column: r.verified_by_satellite",
    );

    const response = await GET(
      new Request("https://example.com/api/reports/map?north=11&south=10&east=-66&west=-67"),
    );
    const body = (await response.json()) as { reports: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(mocks.sqls).toHaveLength(2);
    expect(mocks.sqls[0]).toContain("r.verified_by_satellite");
    expect(mocks.sqls[1]).not.toContain("LEFT JOIN report_images i");
    expect(mocks.sqls[1]).toContain("0 AS verified_by_satellite");
    expect(body.reports[0]).toMatchObject({
      kind: "single",
      verifiedBySatellite: false,
      verifiedChipUrl: null,
    });
  });

  it("returns cacheable minimal map reports for the requested viewport", async () => {
    mocks.sqls = [];
    mocks.failFirstQueryWith = null;
    const response = await GET(
      new Request(
        "https://example.com/api/reports/map?north=11&south=10&east=-66&west=-67&state=Distrito%20Capital&damageType=severe&damageType=collapse&search=Acacias",
      ),
    );
    const body = (await response.json()) as { reports: unknown[] };
    const report = body.reports[0] as Record<string, unknown>;

    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
    );
    expect(mocks.sql).toContain("FROM reports r");
    expect(mocks.sql).toContain("LEFT JOIN report_images i");
    expect(mocks.sql).toContain("status = 'published'");
    expect(mocks.sql).toContain("latitude BETWEEN ? AND ?");
    expect(mocks.sql).toContain("damage_type IN (?,?)");
    expect(mocks.sql).toContain("LIMIT ?");
    expect(mocks.bindings).toEqual([
      "%Acacias%",
      "%Acacias%",
      "%Acacias%",
      "Distrito Capital",
      "severe",
      "collapse",
      10,
      11,
      -67,
      -66,
      1000,
    ]);
    expect(report).toMatchObject({
      kind: "single",
      id: "report-1",
      buildingName: "Edificio Las Acacias",
      address: "Avenida Sucre, Caracas",
      state: "Distrito Capital",
      city: "Caracas",
      latitude: 10.5,
      longitude: -66.9,
      damageType: "severe",
      needsHelp: true,
      createdAt: "2026-06-26T12:00:00.000Z",
      verifiedBySatellite: true,
      verifiedChipUrl: "/media/reports/report-1/img-1.webp",
    });
    expect(report).not.toHaveProperty("images");
    expect(report).not.toHaveProperty("description");
    expect(report).not.toHaveProperty("contactPhone");
  });

  it("groups nearby reports into a single map incident", async () => {
    mocks.sqls = [];
    mocks.failFirstQueryWith = null;
    mocks.results = [
      {
        id: "report-a",
        building_name: "Torre A",
        address: "Centro",
        state: "Distrito Capital",
        city: "Caracas",
        latitude: 10.5,
        longitude: -66.9,
        damage_type: "moderate",
        needs_help: 0,
        created_at: "2026-06-26T10:00:00.000Z",
        verified_by_satellite: 0,
        chip_image_id: null,
      },
      {
        id: "report-b",
        building_name: "Torre B",
        address: "Centro",
        state: "Distrito Capital",
        city: "Caracas",
        latitude: 10.500089,
        longitude: -66.9,
        damage_type: "collapse",
        needs_help: 1,
        created_at: "2026-06-26T11:00:00.000Z",
        verified_by_satellite: 1,
        chip_image_id: "chip-b",
      },
      {
        id: "report-c",
        building_name: "Torre C",
        address: "Centro",
        state: "Distrito Capital",
        city: "Caracas",
        latitude: 10.500178,
        longitude: -66.9,
        damage_type: "severe",
        needs_help: 0,
        created_at: "2026-06-26T12:00:00.000Z",
        verified_by_satellite: 0,
        chip_image_id: null,
      },
      {
        id: "report-d",
        building_name: "Torre D",
        address: "Lejos",
        state: "Distrito Capital",
        city: "Caracas",
        latitude: 10.501,
        longitude: -66.9,
        damage_type: "cracks",
        needs_help: 0,
        created_at: "2026-06-26T09:00:00.000Z",
        verified_by_satellite: 0,
        chip_image_id: null,
      },
    ];

    const response = await GET(
      new Request("https://example.com/api/reports/map?north=11&south=10&east=-66&west=-67"),
    );
    const body = (await response.json()) as {
      reports: Array<Record<string, unknown>>;
    };

    expect(body.reports).toHaveLength(2);
    expect(body.reports[0]).toMatchObject({
      kind: "group",
      reportCount: 3,
      damageType: "collapse",
      needsHelp: true,
      verifiedBySatellite: true,
      buildingName: "Torre C",
    });
    expect(body.reports[1]).toMatchObject({
      kind: "single",
      id: "report-d",
      reportCount: 1,
    });
    expect(body.reports[0].reports).toHaveLength(3);
  });
});
