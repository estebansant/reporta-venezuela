import { describe, expect, it } from "vitest";

import {
  buildDescription,
  inferState,
  mapDamageLevel,
  normalizeSourceBuilding,
  selectImageUrls,
  type SourceBuilding,
} from "./import-terremoto-source";

const sourceBuilding: SourceBuilding = {
  id: "source-1",
  name: "Residencias El Molino",
  address: "Avenida Guaicaipuro, Caraballeda 1165, La Guaira, Venezuela",
  city: "Caraballeda",
  zone: "Caribe",
  lat: 10.6122196,
  lng: -66.8437053,
  damage_level: "total",
  status: "en_revision",
  main_photo_url: "https://example.com/main.jpeg",
  media_urls: [
    "https://example.com/main.jpeg",
    "https://example.com/2.jpg",
    "https://example.com/3.png",
    "https://example.com/4.jpeg",
    "https://example.com/5.png",
    "https://example.com/6.png",
  ],
  notes: "Daño visible en fachada.",
  general_source: "Vecinos",
  last_updated_at: "2026-06-26T17:01:59.396+00:00",
  created_at: "2026-06-25T09:20:00.568327+00:00",
};

describe("mapDamageLevel", () => {
  it("maps source damage levels to local damage types", () => {
    expect(mapDamageLevel("parcial").damageType).toBe("moderate");
    expect(mapDamageLevel("severo").damageType).toBe("severe");
    expect(mapDamageLevel("total").damageType).toBe("collapse");
  });

  it("falls back to moderate for unknown damage levels", () => {
    expect(mapDamageLevel("seguro")).toMatchObject({ damageType: "moderate" });
  });
});

describe("selectImageUrls", () => {
  it("keeps main photo first, dedupes, and limits to five images", () => {
    const result = selectImageUrls(sourceBuilding);
    expect(result.imageUrls).toEqual([
      "https://example.com/main.jpeg",
      "https://example.com/2.jpg",
      "https://example.com/3.png",
      "https://example.com/4.jpeg",
      "https://example.com/5.png",
    ]);
    expect(result.discardedImageCount).toBe(1);
  });
});

describe("normalizeSourceBuilding", () => {
  it("normalizes a source row into a local report payload", () => {
    expect(normalizeSourceBuilding(sourceBuilding)).toMatchObject({
      sourceId: "source-1",
      buildingName: "Residencias El Molino",
      state: "La Guaira",
      damageType: "collapse",
      imageUrls: expect.any(Array),
    });
  });

  it("keeps rows without coordinates so the CLI can geocode them", () => {
    expect(normalizeSourceBuilding({ ...sourceBuilding, lat: null })).toMatchObject({
      sourceId: "source-1",
      latitude: null,
    });
  });
});

describe("description and location helpers", () => {
  it("does not include sensitive source fields or sensitive note lines", () => {
    const description = buildDescription(
      {
        ...sourceBuilding,
        notes: "Fachada con daños.\nPersonas atrapadas: Nombre Apellido",
      },
      "collapse",
    );
    expect(description).toContain("Fachada con daños.");
    expect(description).not.toContain("Nombre Apellido");
  });

  it("infers state from city hints", () => {
    expect(inferState({ address: "", city: "Caracas", zone: "" })).toBe(
      "Distrito Capital",
    );
  });
});
