import { describe, expect, it } from "vitest";

import {
  normalizeVenezuelanCity,
  normalizeVenezuelanState,
} from "./venezuelan-locations";

describe("normalizeVenezuelanState", () => {
  it.each([
    ["Federal Dependencies", "Dependencias Federales"],
    ["Federal Dependencies of Venezuela", "Dependencias Federales"],
    [" federal dependencies ", "Dependencias Federales"],
  ])("translates %s", (state, expected) => {
    expect(normalizeVenezuelanState(state)).toBe(expected);
  });

  it("keeps Spanish state names unchanged", () => {
    expect(normalizeVenezuelanState("Distrito Capital")).toBe(
      "Distrito Capital",
    );
  });

  it("keeps unknown manually entered values unchanged", () => {
    expect(normalizeVenezuelanState("Mi estado")).toBe("Mi estado");
  });
});

describe("normalizeVenezuelanCity", () => {
  it("keeps Spanish city names unchanged", () => {
    expect(normalizeVenezuelanCity("Puerto La Cruz")).toBe("Puerto La Cruz");
  });

  it("keeps unknown manually entered values unchanged", () => {
    expect(normalizeVenezuelanCity("Mi ciudad")).toBe("Mi ciudad");
  });
});
