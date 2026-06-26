import type {
  DamageType,
  MapItem,
  MapReport,
  MapReportGroup,
  MapSingleReport,
} from "@/lib/report-schema";

const EARTH_RADIUS_METERS = 6_371_000;
const GROUP_DISTANCE_METERS = 15;

const damageSeverityRank: Record<DamageType, number> = {
  cracks: 0,
  moderate: 1,
  severe: 2,
  collapse: 3,
};

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceInMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLng = toRadians(b.longitude - a.longitude);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

function getWorstDamageType(reports: MapReport[]) {
  return reports.reduce<DamageType>(
    (worst, report) =>
      damageSeverityRank[report.damageType] > damageSeverityRank[worst]
        ? report.damageType
        : worst,
    reports[0]?.damageType ?? "cracks",
  );
}

function toSingleReport(report: MapReport): MapSingleReport {
  return {
    kind: "single",
    reportCount: 1,
    ...report,
  };
}

function toGroupReport(reports: MapReport[]): MapReportGroup {
  const sorted = [...reports].sort((a, b) => {
    const createdAtDiff =
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (createdAtDiff !== 0) return createdAtDiff;
    return a.id.localeCompare(b.id);
  });
  const latitude =
    reports.reduce((sum, report) => sum + report.latitude, 0) / reports.length;
  const longitude =
    reports.reduce((sum, report) => sum + report.longitude, 0) / reports.length;
  const representative = sorted[0];
  const reportIds = sorted.map((report) => report.id).sort();

  return {
    kind: "group",
    id: `group:${reportIds.join(":")}`,
    latitude,
    longitude,
    damageType: getWorstDamageType(reports),
    needsHelp: reports.some((report) => report.needsHelp),
    createdAt: representative.createdAt,
    verifiedBySatellite: reports.some((report) => report.verifiedBySatellite),
    reportCount: reports.length,
    buildingName: representative.buildingName,
    address: representative.address,
    state: representative.state,
    city: representative.city,
    reportIds,
    reports: sorted,
  };
}

export function groupMapReports(reports: MapReport[]): MapItem[] {
  if (reports.length < 2) return reports.map(toSingleReport);

  const visited = new Array(reports.length).fill(false);
  const groups: MapItem[] = [];

  for (let index = 0; index < reports.length; index += 1) {
    if (visited[index]) continue;

    const queue = [index];
    const component: MapReport[] = [];
    visited[index] = true;

    while (queue.length) {
      const currentIndex = queue.shift()!;
      const current = reports[currentIndex];
      component.push(current);

      for (let neighborIndex = 0; neighborIndex < reports.length; neighborIndex += 1) {
        if (visited[neighborIndex]) continue;
        const neighbor = reports[neighborIndex];
        if (
          distanceInMeters(current, neighbor) >= GROUP_DISTANCE_METERS
        ) {
          continue;
        }
        visited[neighborIndex] = true;
        queue.push(neighborIndex);
      }
    }

    groups.push(
      component.length === 1
        ? toSingleReport(component[0])
        : toGroupReport(component),
    );
  }

  return groups.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}
