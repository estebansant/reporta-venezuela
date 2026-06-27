import { describe, expect, it } from "vitest";

import { clusterMapReports } from "./map-report-clusters";
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

const bounds = {
  north: 10.6,
  south: 10.4,
  east: -66.8,
  west: -67,
};

describe("clusterMapReports", () => {
  it("clusters nearby reports at low zoom", () => {
    const result = clusterMapReports({
      reports: [
        buildReport("a", 10.5, -66.9),
        buildReport("b", 10.5002, -66.9002),
      ],
      bounds,
      zoom: 11,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "group", reportCount: 2 });
  });

  it("reveals individual reports at high zoom", () => {
    const result = clusterMapReports({
      reports: [
        buildReport("a", 10.5, -66.9),
        buildReport("b", 10.5002, -66.9002),
      ],
      bounds,
      zoom: 18,
    });

    expect(result).toHaveLength(2);
    expect(result.every((item) => item.kind === "single")).toBe(true);
  });

  it("aggregates report count and worst severity", () => {
    const result = clusterMapReports({
      reports: [
        buildReport("a", 10.5, -66.9, { damageType: "cracks" }),
        buildReport("b", 10.5002, -66.9002, { damageType: "collapse" }),
        buildReport("c", 10.5003, -66.9003, { damageType: "severe" }),
      ],
      bounds,
      zoom: 11,
    });

    expect(result[0]).toMatchObject({
      kind: "group",
      reportCount: 3,
      damageType: "collapse",
    });
  });

  it("aggregates help and satellite flags", () => {
    const result = clusterMapReports({
      reports: [
        buildReport("a", 10.5, -66.9, { needsHelp: true }),
        buildReport("b", 10.5002, -66.9002, {
          verifiedBySatellite: true,
        }),
      ],
      bounds,
      zoom: 11,
    });

    expect(result[0]).toMatchObject({
      kind: "group",
      needsHelp: true,
      verifiedBySatellite: true,
    });
  });
});

