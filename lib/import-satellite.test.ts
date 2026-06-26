import { describe, expect, it } from "vitest";

import {
  AUTOTAG_RADIUS_M,
  categorizeEmsArea,
  categorizeZoneScore,
  emsAreaFeatureToZone,
  haversineMeters,
  mapEmsGrade,
  normalizeEmsFeature,
  rasterToDamageZones,
  type GeoJSONFeature,
} from "./import-satellite";

describe("mapEmsGrade", () => {
  it("maps numeric EMS-98 grades", () => {
    expect(mapEmsGrade(5)).toEqual({ damageType: "collapse", keep: true });
    expect(mapEmsGrade(4)).toEqual({ damageType: "severe", keep: true });
    expect(mapEmsGrade(3)).toEqual({ damageType: "severe", keep: true });
    expect(mapEmsGrade(2)).toEqual({ damageType: "moderate", keep: true });
    expect(mapEmsGrade(1).keep).toBe(false);
  });

  it("maps Copernicus text labels", () => {
    expect(mapEmsGrade("Completely Destroyed")).toEqual({
      damageType: "collapse",
      keep: true,
    });
    expect(mapEmsGrade("Highly Damaged").damageType).toBe("severe");
    expect(mapEmsGrade("Moderately Damaged").damageType).toBe("moderate");
    expect(mapEmsGrade("Negligible to slight").keep).toBe(false);
    expect(mapEmsGrade("Possibly damaged").keep).toBe(false);
  });
});

describe("categorizeZoneScore", () => {
  it("bins by threshold", () => {
    expect(categorizeZoneScore(0.5)).toBe("low");
    expect(categorizeZoneScore(0.6)).toBe("moderate");
    expect(categorizeZoneScore(0.75)).toBe("high");
    expect(categorizeZoneScore(0.9)).toBe("severe");
  });
});

describe("haversineMeters auto-tag boundary", () => {
  const lat = 10.5;
  const lng = -68.0;
  // ~0.000135 deg latitude ≈ 15 m; build points just inside / outside.
  it("tags a point ~14 m away", () => {
    const d = haversineMeters(lat, lng, lat + 0.000125, lng);
    expect(d).toBeLessThanOrEqual(AUTOTAG_RADIUS_M);
  });
  it("does not tag a point ~16 m away", () => {
    const d = haversineMeters(lat, lng, lat + 0.000145, lng);
    expect(d).toBeGreaterThan(AUTOTAG_RADIUS_M);
  });
  it("accounts for longitude shrinking with latitude", () => {
    const dLng = 0.000135 / Math.cos((lat * Math.PI) / 180);
    const d = haversineMeters(lat, lng, lat, lng + dLng);
    expect(d).toBeGreaterThan(14);
    expect(d).toBeLessThan(16);
  });
});

describe("normalizeEmsFeature", () => {
  const feature: GeoJSONFeature = {
    type: "Feature",
    id: "42",
    geometry: { type: "Point", coordinates: [-68.0, 10.5] },
    properties: {
      grading: "Completely Destroyed",
      city: "Tucacas",
      notes: "Edificio colapsado. Hay heridos atrapados en el lugar.",
    },
  };

  it("normalizes an authoritative collapse feature", () => {
    const result = normalizeEmsFeature(feature, "EMSR999");
    expect("skipped" in result).toBe(false);
    if ("skipped" in result) return;
    expect(result.damageType).toBe("collapse");
    expect(result.sourceId).toBe("EMSR999:42");
    expect(result.verifiedSource).toBe("copernicus-ems");
    expect(result.latitude).toBe(10.5);
    expect(result.longitude).toBe(-68.0);
    // Source free-text is never passed through, so no casualty/PII can leak.
    expect(result.description.toLowerCase()).not.toContain("atrapados");
    expect(result.description.toLowerCase()).not.toContain("heridos");
    expect(result.description).toContain("Copernicus EMS");
  });

  it("skips low grades", () => {
    const low = normalizeEmsFeature(
      { ...feature, properties: { grading: "Negligible to slight" } },
      "EMSR999",
    );
    expect("skipped" in low).toBe(true);
  });
});

describe("EMS area zones", () => {
  it("maps grade to category + score", () => {
    expect(categorizeEmsArea("Completely Destroyed")).toEqual({
      damageCategory: "severe",
      score: 0.95,
    });
    expect(categorizeEmsArea("Moderately Damaged").damageCategory).toBe("moderate");
    expect(categorizeEmsArea("Negligible").damageCategory).toBe("low");
  });

  it("converts an area polygon feature to a zone, preserving geometry", () => {
    const feature: GeoJSONFeature = {
      type: "Feature",
      id: "A7",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-68.04, 10.45],
            [-67.98, 10.45],
            [-67.98, 10.49],
            [-68.04, 10.49],
            [-68.04, 10.45],
          ],
        ],
      },
      properties: { grading: "Highly Damaged" },
    };
    const zone = emsAreaFeatureToZone(feature, "EMSR884");
    expect(zone).not.toBeNull();
    expect(zone!.damageCategory).toBe("high");
    expect(zone!.sourceName).toBe("copernicus-ems-area");
    expect(zone!.sourceId).toBe("EMSR884:A7");
    expect(zone!.minLng).toBeCloseTo(-68.04);
    expect(zone!.maxLat).toBeCloseTo(10.49);
    expect(JSON.parse(zone!.geometry).type).toBe("Polygon");
  });
});

describe("rasterToDamageZones", () => {
  it("bins a raster into cell polygons above threshold", () => {
    // 4x4 raster, top-left quadrant hot (0.9), rest 0.1.
    const width = 4;
    const height = 4;
    const values = new Float32Array(width * height).fill(0.1);
    for (const idx of [0, 1, 4, 5]) values[idx] = 0.9;
    const zones = rasterToDamageZones({
      values,
      width,
      height,
      // origin (-68,10.5), 0.001 deg pixels, north-up (negative pixelH).
      geoTransform: [-68, 0.001, 0, 10.5, 0, -0.001],
      productId: "TEST",
      acquiredAt: "2026-06-25T00:00:00Z",
      cellMeters: 222, // ~2 pixels per cell
      minScore: 0.4,
    });
    expect(zones.length).toBeGreaterThan(0);
    const hot = zones.find((z) => z.score > 0.8);
    expect(hot).toBeDefined();
    expect(hot?.damageCategory).toBe("severe");
    expect(hot?.sourceId).toContain("TEST");
    // geometry parses to a valid GeoJSON polygon
    const geo = JSON.parse(hot!.geometry) as { type: string };
    expect(geo.type).toBe("Polygon");
  });
});
