import { haversineMeters, AUTOTAG_RADIUS_M } from "./import-satellite";

export interface BuildingCandidate {
  building_id: string;
  building_source: string;
  centroid_lat: number;
  centroid_lng: number;
}

export function matchBuilding(
  lat: number,
  lng: number,
  candidates: BuildingCandidate[],
  radiusM = AUTOTAG_RADIUS_M,
): BuildingCandidate | null {
  let best: BuildingCandidate | null = null;
  let bestDist = radiusM;
  for (const c of candidates) {
    const dist = haversineMeters(lat, lng, c.centroid_lat, c.centroid_lng);
    if (dist <= bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}
