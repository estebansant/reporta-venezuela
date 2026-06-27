import { describe, expect, it } from "vitest";

import {
  bestCoveringVhr,
  buildTriageCandidates,
  makeGrid,
  reportAgreementScore,
  type DamageSignal,
  type ImagerySceneCoverage,
  type ReportPoint,
  type TriageCell,
} from "./triage-grid";

const cell: TriageCell = {
  minLng: -68.51,
  minLat: 10.19,
  maxLng: -68.49,
  maxLat: 10.21,
  centroidLat: 10.2,
  centroidLng: -68.5,
};

describe("triage grid", () => {
  it("creates 100-250m grid cells", () => {
    const cells = makeGrid({ minLng: -68.5, minLat: 10.2, maxLng: -68.496, maxLat: 10.204 }, 200);

    expect(cells.length).toBeGreaterThan(1);
    expect(cells[0].centroidLat).toBeGreaterThan(10.2);
    expect(cells[0].centroidLng).toBeGreaterThan(-68.5);
  });

  it("scores nearby reports by severity and distance", () => {
    const reports: ReportPoint[] = [
      { latitude: 10.2001, longitude: -68.5001, damageType: "collapse", status: "published" },
      { latitude: 10.3, longitude: -68.7, damageType: "collapse", status: "published" },
    ];

    expect(reportAgreementScore(cell, reports, 350)).toBeGreaterThan(0.9);
  });

  it("selects best post-event VHR scene covering cell", () => {
    const scenes: ImagerySceneCoverage[] = [
      {
        sceneId: "wide",
        provider: "local",
        phase: "post",
        datetime: "2026-06-26T00:00:00Z",
        r2Key: "wide.tif",
        resolutionM: 1,
        minLng: -69,
        minLat: 10,
        maxLng: -68,
        maxLat: 11,
      },
      {
        sceneId: "sharp",
        provider: "local",
        phase: "post",
        datetime: "2026-06-25T00:00:00Z",
        r2Key: "sharp.tif",
        resolutionM: 0.3,
        minLng: -69,
        minLat: 10,
        maxLng: -68,
        maxLat: 11,
      },
    ];

    expect(bestCoveringVhr(cell, scenes)?.sceneId).toBe("sharp");
  });

  it("builds ranked candidates with signal breakdown and VHR link", () => {
    const damageSignals: DamageSignal[] = [
      {
        sourceName: "sentinel2-change",
        sourceId: "s2",
        score: 0.8,
        damageCategory: "high",
        minLng: -68.6,
        minLat: 10.1,
        maxLng: -68.4,
        maxLat: 10.3,
      },
      {
        sourceName: "aria-dpm",
        sourceId: "sar",
        score: 0.9,
        damageCategory: "severe",
        minLng: -68.6,
        minLat: 10.1,
        maxLng: -68.4,
        maxLat: 10.3,
      },
    ];
    const scenes: ImagerySceneCoverage[] = [
      {
        sceneId: "vhr-post",
        provider: "local",
        phase: "post",
        datetime: "2026-06-26T00:00:00Z",
        r2Key: "vhr.tif",
        resolutionM: 0.5,
        minLng: -69,
        minLat: 10,
        maxLng: -68,
        maxLat: 11,
      },
    ];

    const candidates = buildTriageCandidates({
      bbox: { minLng: -68.51, minLat: 10.19, maxLng: -68.49, maxLat: 10.21 },
      cellMeters: 200,
      damageSignals,
      reports: [],
      scenes,
      minScore: 0.35,
      limit: 10,
      requireBuildingSignal: true,
      reportRadiusMeters: 350,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].vhrSceneId).toBe("vhr-post");
    expect(candidates[0].breakdown.sar).toBe(0.9);
  });
});
