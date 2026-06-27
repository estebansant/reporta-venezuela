import Supercluster from "supercluster";

import type {
  DamageType,
  MapItem,
  MapReport,
  MapReportGroup,
  MapSingleReport,
} from "@/lib/report-schema";

export type ClusterBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

type ReportClusterProperties = {
  report?: MapReport;
  reportCount: number;
  damageType: DamageType;
  needsHelp: boolean;
  verifiedBySatellite: boolean;
  createdAt: string;
};

type ReportPoint = GeoJSON.Feature<
  GeoJSON.Point,
  ReportClusterProperties & { report: MapReport }
>;

const damageSeverityRank: Record<DamageType, number> = {
  cracks: 0,
  moderate: 1,
  severe: 2,
  collapse: 3,
};

function toSingleReport(report: MapReport): MapSingleReport {
  return {
    kind: "single",
    reportCount: 1,
    ...report,
  };
}

function getWorstDamageType(left: DamageType, right: DamageType) {
  return damageSeverityRank[right] > damageSeverityRank[left] ? right : left;
}

function pointFromReport(report: MapReport): ReportPoint {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [report.longitude, report.latitude],
    },
    properties: {
      report,
      reportCount: 1,
      damageType: report.damageType,
      needsHelp: report.needsHelp,
      verifiedBySatellite: report.verifiedBySatellite,
      createdAt: report.createdAt,
    },
  };
}

function mapClusterProperties(
  accumulated: ReportClusterProperties,
  props: ReportClusterProperties,
) {
  accumulated.reportCount += props.reportCount;
  accumulated.damageType = getWorstDamageType(
    accumulated.damageType,
    props.damageType,
  );
  accumulated.needsHelp = accumulated.needsHelp || props.needsHelp;
  accumulated.verifiedBySatellite =
    accumulated.verifiedBySatellite || props.verifiedBySatellite;
  if (new Date(props.createdAt).getTime() > new Date(accumulated.createdAt).getTime()) {
    accumulated.createdAt = props.createdAt;
  }
}

function reduceClusterProperties(
  accumulated: ReportClusterProperties,
  props: ReportClusterProperties,
) {
  mapClusterProperties(accumulated, props);
}

function hasReport(
  feature: GeoJSON.Feature<GeoJSON.Point, ReportClusterProperties>,
): feature is ReportPoint {
  return Boolean(feature.properties.report);
}

function buildGroup(
  id: string,
  latitude: number,
  longitude: number,
  props: ReportClusterProperties,
  reports: MapReport[],
): MapReportGroup {
  const sorted = [...reports].sort((a, b) => {
    const createdAtDiff =
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (createdAtDiff !== 0) return createdAtDiff;
    return a.id.localeCompare(b.id);
  });
  const representative = sorted[0];
  return {
    kind: "group",
    id,
    latitude,
    longitude,
    damageType: props.damageType,
    needsHelp: props.needsHelp,
    createdAt: representative.createdAt,
    verifiedBySatellite: props.verifiedBySatellite,
    reportCount: props.reportCount,
    buildingName: representative.buildingName,
    address: representative.address,
    state: representative.state,
    city: representative.city,
    reportIds: sorted.map((report) => report.id),
    reports: sorted,
  };
}

export function clusterMapReports({
  reports,
  bounds,
  zoom,
}: {
  reports: MapReport[];
  bounds: ClusterBounds | null;
  zoom: number;
}): MapItem[] {
  if (reports.length < 2) return reports.map(toSingleReport);

  const index = new Supercluster<
    ReportClusterProperties,
    ReportClusterProperties
  >({
    radius: 52,
    maxZoom: 16,
    minPoints: 2,
    map: (props) => ({
      reportCount: props.reportCount,
      damageType: props.damageType,
      needsHelp: props.needsHelp,
      verifiedBySatellite: props.verifiedBySatellite,
      createdAt: props.createdAt,
    }),
    reduce: reduceClusterProperties,
  });
  index.load(reports.map(pointFromReport));

  const bbox: [number, number, number, number] = bounds
    ? [bounds.west, bounds.south, bounds.east, bounds.north]
    : [-180, -90, 180, 90];
  const features = index.getClusters(bbox, Math.round(zoom));

  return features
    .map((feature): MapItem => {
      const [longitude, latitude] = feature.geometry.coordinates;
      const props = feature.properties;
      if (!("cluster" in props) || !props.cluster) {
        return toSingleReport((props as ReportClusterProperties & { report: MapReport }).report);
      }
      const leaves = index
        .getLeaves(props.cluster_id, props.point_count, 0)
        .filter(hasReport)
        .map((leaf) => leaf.properties.report);
      return buildGroup(
        `cluster:${props.cluster_id}`,
        latitude,
        longitude,
        {
          reportCount: props.reportCount,
          damageType: props.damageType,
          needsHelp: props.needsHelp,
          verifiedBySatellite: props.verifiedBySatellite,
          createdAt: props.createdAt,
        },
        leaves,
      );
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}
