import { describe, expect, it } from "vitest";

import { distanceInMeters, groupMapReports } from "./map-report-groups";
import type { MapReport } from "./report-schema";

function buildReport(
  id: string,
  latitude: number,
  longitude: number,
  overrides: Partial<MapReport> = {},
): MapReport {
  return {
    id,
    buildingName: `Building ${id}`,
    address: `Address ${id}`,
    state: "Distrito Capital",
    city: "Caracas",
    latitude,
    longitude,
    damageType: "moderate",
    needsHelp: false,
    createdAt: "2026-06-26T12:00:00.000Z",
    verifiedBySatellite: false,
    verifiedChipUrl: null,
    ...overrides,
  };
}

describe("distanceInMeters", () => {
  it("uses geodesic distance in meters", () => {
    const distance = distanceInMeters(
      { latitude: 10.5, longitude: -66.9 },
      { latitude: 10.500089, longitude: -66.9 },
    );

    expect(distance).toBeGreaterThan(9);
    expect(distance).toBeLessThan(10.5);
  });
});

describe("groupMapReports", () => {
  it("groups connected reports within 15 meters", () => {
    const result = groupMapReports([
      buildReport("a", 10.5, -66.9, { createdAt: "2026-06-26T10:00:00.000Z" }),
      buildReport("b", 10.500089, -66.9, {
        createdAt: "2026-06-26T11:00:00.000Z",
        damageType: "collapse",
        needsHelp: true,
      }),
      buildReport("c", 10.500178, -66.9, {
        createdAt: "2026-06-26T12:00:00.000Z",
      }),
      buildReport("d", 10.501, -66.9, { createdAt: "2026-06-26T09:00:00.000Z" }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      kind: "group",
      reportCount: 3,
      damageType: "collapse",
      needsHelp: true,
      buildingName: "Building c",
    });
    expect(result[1]).toMatchObject({
      kind: "single",
      id: "d",
      reportCount: 1,
    });
  });

  it("keeps reports separate beyond the grouping radius", () => {
    const result = groupMapReports([
      buildReport("a", 10.5, -66.9),
      buildReport("b", 10.5003, -66.9),
    ]);

    expect(result).toHaveLength(2);
    expect(result.every((item) => item.kind === "single")).toBe(true);
  });
});
