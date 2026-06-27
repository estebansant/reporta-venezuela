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
  createdAtMs: number;
};

type ReportPoint = GeoJSON.Feature<
  GeoJSON.Point,
  ReportClusterProperties & { report: MapReport }
>;

export type MapReportClusterIndex = {
  reports: MapReport[];
  index: Supercluster<ReportClusterProperties, ReportClusterProperties> | null;
};

const damageSeverityRank: Record<DamageType, number> = {
  cracks: 0,
  moderate: 1,
  severe: 2,
  collapse: 3,
};

const CLUSTER_RADIUS_PX = 64;
const CLUSTER_MAX_ZOOM = 15;

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
      createdAtMs: new Date(report.createdAt).getTime(),
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
  if (props.createdAtMs > accumulated.createdAtMs) {
    accumulated.createdAt = props.createdAt;
    accumulated.createdAtMs = props.createdAtMs;
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

export function buildMapReportClusterIndex(
  reports: MapReport[],
): MapReportClusterIndex {
  if (reports.length < 2) return { reports, index: null };
  const index = new Supercluster<
    ReportClusterProperties,
    ReportClusterProperties
  >({
    radius: CLUSTER_RADIUS_PX,
    maxZoom: CLUSTER_MAX_ZOOM,
    minPoints: 2,
    map: (props) => ({
      reportCount: props.reportCount,
      damageType: props.damageType,
      needsHelp: props.needsHelp,
      verifiedBySatellite: props.verifiedBySatellite,
      createdAt: props.createdAt,
      createdAtMs: props.createdAtMs,
    }),
    reduce: reduceClusterProperties,
  });
  index.load(reports.map(pointFromReport));
  return { reports, index };
}

export function getMapReportClusters({
  clusterIndex,
  bounds,
  zoom,
}: {
  clusterIndex: MapReportClusterIndex;
  bounds: ClusterBounds | null;
  zoom: number;
}): MapItem[] {
  const index = clusterIndex.index;
  if (!index) return clusterIndex.reports.map(toSingleReport);
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
          createdAtMs: props.createdAtMs,
        },
        leaves,
      );
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
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
  return getMapReportClusters({
    clusterIndex: buildMapReportClusterIndex(reports),
    bounds,
    zoom,
  });
}
