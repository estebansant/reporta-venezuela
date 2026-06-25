import { describe, expect, it } from "vitest";

import { reportInputSchema, reportQuerySchema } from "./report-schema";

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

  it("rejects oversized page sizes", () => {
    expect(reportQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });
});
