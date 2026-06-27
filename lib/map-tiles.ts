export interface MapTilesManifest {
  generated_at: string;
  reports: {
    geojson: string;
    pmtiles: string;
  };
  zones: {
    geojson: string;
    pmtiles: string;
  };
}

export const MAP_TILES_MANIFEST_KEY = "tiles/manifest.json";

export function mapTilesPath(key: string) {
  return `/tiles/${key.replace(/^tiles\//, "")}`;
}
