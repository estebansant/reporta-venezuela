import { describe, expect, it } from "vitest";

import {
  mapReportQuerySchema,
  reportInputSchema,
  reportQuerySchema,
} from "./report-schema";

const validReport = {
  buildingName: "Edificio Las Acacias",
  address: "Avenida Sucre, Caracas",
  state: "Distrito Capital",
  city: "Caracas",
  latitude: "10.5",
  longitude: "-66.9",
  damageType: "severe",
  needsHelp: "false",
  description: "Grietas diagonales visibles en la fachada principal.",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  contactConsent: "false",
  turnstileToken: "token",
};

describe("reportInputSchema", () => {
  it("accepts a valid anonymous report", () => {
    expect(reportInputSchema.safeParse(validReport).success).toBe(true);
  });

  it("accepts a report marked as needing emergency help", () => {
    const result = reportInputSchema.safeParse({
      ...validReport,
      needsHelp: "true",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.needsHelp).toBe(true);
  });

  it("requires consent when contact information is public", () => {
    expect(
      reportInputSchema.safeParse({
        ...validReport,
        contactPhone: "+58 412 555 0000",
      }).success,
    ).toBe(false);
  });

  it("accepts a valid international phone number with consent", () => {
    expect(
      reportInputSchema.safeParse({
        ...validReport,
        contactPhone: "+584125550000",
        contactConsent: "true",
      }).success,
    ).toBe(true);
  });

  it("rejects a phone number without a valid country code", () => {
    expect(
      reportInputSchema.safeParse({
        ...validReport,
        contactPhone: "04125550000",
        contactConsent: "true",
      }).success,
    ).toBe(false);
  });

  it("rejects coordinates outside the globe", () => {
    expect(
      reportInputSchema.safeParse({ ...validReport, latitude: "100" }).success,
    ).toBe(false);
  });
});

describe("reportQuerySchema", () => {
  it("applies safe pagination defaults", () => {
    expect(reportQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 24 });
  });

  it("accepts the listing page size cap", () => {
    expect(reportQuerySchema.safeParse({ pageSize: "100" }).success).toBe(true);
  });

  it("rejects oversized page sizes", () => {
    expect(reportQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });

  it("normalizes one or more damage type filters", () => {
    expect(reportQuerySchema.parse({ damageType: "severe" }).damageType).toEqual([
      "severe",
    ]);
    expect(
      reportQuerySchema.parse({ damageType: ["severe", "collapse"] })
        .damageType,
    ).toEqual(["severe", "collapse"]);
  });

  it("normalizes the satellite verification filter", () => {
    expect(
      reportQuerySchema.parse({ verifiedBySatellite: "true" })
        .verifiedBySatellite,
    ).toBe(true);
    expect(
      reportQuerySchema.parse({ verifiedBySatellite: "false" })
        .verifiedBySatellite,
    ).toBe(false);
  });
});

describe("mapReportQuerySchema", () => {
  it("accepts viewport bounds without pagination", () => {
    const result = mapReportQuerySchema.safeParse({
      north: "11",
      south: "10",
      east: "-66",
      west: "-67",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        north: 11,
        south: 10,
        east: -66,
        west: -67,
        limit: 1000,
      });
      expect("page" in result.data).toBe(false);
      expect("pageSize" in result.data).toBe(false);
    }
  });

  it("rejects invalid viewport bounds", () => {
    expect(mapReportQuerySchema.safeParse({ north: "100" }).success).toBe(false);
    expect(mapReportQuerySchema.safeParse({ west: "-181" }).success).toBe(false);
  });

  it("accepts the satellite verification filter", () => {
    const result = mapReportQuerySchema.safeParse({
      verifiedBySatellite: "true",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.verifiedBySatellite).toBe(true);
  });
});
