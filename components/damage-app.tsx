"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import { DirectorySection } from "@/components/damage-app/sections/DirectorySection";
import { MapSection } from "@/components/damage-app/sections/MapSection";
import { MissionStrip } from "@/components/damage-app/sections/MissionStrip";
import type { MapViewport } from "@/components/damage-app/types";
import { REPORT_CREATED_EVENT } from "@/components/site-shell-header";
import {
  cachedJson,
  invalidateClientFetchCache,
  normalizeRequestKey,
} from "@/lib/client-fetch-cache";
import {
  buildMapReportClusterIndex,
  getMapReportClusters,
} from "@/lib/map-report-clusters";
import { mapTilesPath, type MapTilesManifest } from "@/lib/map-tiles";
import type {
  DamageType,
  MapItem,
  MapReport,
  PublicReport,
} from "@/lib/report-schema";

const BOUNDS_PRECISION = 4;
const MAP_DELTA_LIMIT = 200;
const STATIC_MAP_CACHE_TTL_MS = 5 * 60_000;
const MAP_DELTA_CACHE_TTL_MS = 45_000;
const DIRECTORY_CACHE_TTL_MS = 45_000;

type MapBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

type ReportsGeoJSON = {
  type: "FeatureCollection";
  features?: Array<{
    type: "Feature";
    geometry?: { type?: string; coordinates?: unknown };
    properties?: Partial<MapReport>;
  }>;
};

function compactBounds(bounds: string) {
  const source = new URLSearchParams(bounds);
  const compacted = new URLSearchParams();
  for (const key of ["north", "south", "east", "west"]) {
    const value = source.get(key);
    if (value === null) continue;
    compacted.set(key, Number(value).toFixed(BOUNDS_PRECISION));
  }
  return compacted.toString();
}

function parseBounds(bounds: string): MapBounds | null {
  const params = new URLSearchParams(bounds);
  const northParam = params.get("north");
  const southParam = params.get("south");
  const eastParam = params.get("east");
  const westParam = params.get("west");
  if (
    northParam === null ||
    southParam === null ||
    eastParam === null ||
    westParam === null
  ) {
    return null;
  }
  const north = Number(northParam);
  const south = Number(southParam);
  const east = Number(eastParam);
  const west = Number(westParam);
  if ([north, south, east, west].some((value) => !Number.isFinite(value))) {
    return null;
  }
  return { north, south, east, west };
}

function reportFromFeature(feature: NonNullable<ReportsGeoJSON["features"]>[number]) {
  const props = feature.properties;
  const coordinates = feature.geometry?.coordinates;
  if (
    !props?.id ||
    !Array.isArray(coordinates) ||
    typeof coordinates[0] !== "number" ||
    typeof coordinates[1] !== "number"
  ) {
    return null;
  }

  return {
    id: props.id,
    buildingName: props.buildingName ?? "",
    address: props.address ?? "",
    state: props.state ?? "",
    city: props.city ?? "",
    latitude:
      typeof props.latitude === "number" ? props.latitude : coordinates[1],
    longitude:
      typeof props.longitude === "number" ? props.longitude : coordinates[0],
    damageType: props.damageType ?? "cracks",
    needsHelp: Boolean(props.needsHelp),
    createdAt: props.createdAt ?? "",
    verifiedBySatellite: Boolean(props.verifiedBySatellite),
    verifiedChipUrl: props.verifiedChipUrl ?? null,
  } satisfies MapReport;
}

function flattenMapItems(items: MapItem[]): MapReport[] {
  return items.flatMap((item) => (item.kind === "group" ? item.reports : [item]));
}

function filterMapReports(
  reports: MapReport[],
  filters: {
    bounds: MapBounds | null;
    search: string;
    damageTypes: DamageType[];
    state: string;
    verifiedBySatelliteOnly: boolean;
  },
) {
  const search = filters.search.trim().toLowerCase();
  const damageTypes = filters.damageTypes.length
    ? new Set(filters.damageTypes)
    : null;

  return reports.filter((report) => {
    if (filters.bounds) {
      const { north, south, east, west } = filters.bounds;
      if (
        report.latitude < south ||
        report.latitude > north ||
        report.longitude < west ||
        report.longitude > east
      ) {
        return false;
      }
    }
    if (filters.state !== "all" && report.state !== filters.state) return false;
    if (damageTypes && !damageTypes.has(report.damageType)) return false;
    if (filters.verifiedBySatelliteOnly && !report.verifiedBySatellite) {
      return false;
    }
    if (search) {
      const haystack = `${report.buildingName} ${report.address} ${report.city}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export function DamageApp() {
  const [reports, setReports] = useState<PublicReport[]>([]);
  const [rawMapReports, setRawMapReports] = useState<MapReport[]>([]);
  const [mapManifest, setMapManifest] = useState<MapTilesManifest | null>(null);
  const [baselineMapReports, setBaselineMapReports] = useState<MapReport[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [damageTypes, setDamageTypes] = useState<DamageType[]>([]);
  const [verifiedBySatelliteOnly, setVerifiedBySatelliteOnly] = useState(false);
  const [state, setState] = useState("all");
  const [viewport, setViewport] = useState<MapViewport>({ bounds: "", zoom: 12 });
  const [zoneSources, setZoneSources] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [mapLoading, setMapLoading] = useState(true);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 767px)");
    const tablet = window.matchMedia(
      "(min-width: 768px) and (max-width: 1100px)"
    );

    function updatePageSize() {
      const nextPageSize = mobile.matches ? 25 : tablet.matches ? 54 : 80;
      setPageSize((current) => {
        if (current !== nextPageSize) setPage(1);
        return nextPageSize;
      });
    }

    updatePageSize();
    mobile.addEventListener("change", updatePageSize);
    tablet.addEventListener("change", updatePageSize);
    return () => {
      mobile.removeEventListener("change", updatePageSize);
      tablet.removeEventListener("change", updatePageSize);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadBaseline() {
      try {
        const manifest = await cachedJson(
          "/tiles/manifest.json",
          STATIC_MAP_CACHE_TTL_MS,
          async () => {
            const manifestResponse = await fetch("/tiles/manifest.json", {
              headers: { Accept: "application/json" },
            });
            if (!manifestResponse.ok) return null;
            return (await manifestResponse.json()) as MapTilesManifest;
          },
        );
        if (!manifest) return;
        const reportsPath = mapTilesPath(manifest.reports.geojson);
        const geojson = await cachedJson(
          reportsPath,
          STATIC_MAP_CACHE_TTL_MS,
          async () => {
            const reportsResponse = await fetch(reportsPath, {
              headers: { Accept: "application/geo+json, application/json" },
            });
            if (!reportsResponse.ok) return null;
            return (await reportsResponse.json()) as ReportsGeoJSON;
          },
        );
        if (!geojson) return;
        if (cancelled) return;
        setMapManifest(manifest);
        setBaselineMapReports(
          (geojson.features ?? [])
            .map(reportFromFeature)
            .filter((report): report is MapReport => Boolean(report)),
        );
      } catch {
        // Static baseline is an optimization. If it is absent, the D1 API path
        // still renders the map.
      }
    }
    void loadBaseline();
    return () => {
      cancelled = true;
    };
  }, []);

  // Directory ignores the map viewport on purpose: every report must be
  // reachable regardless of where the map is panned or zoomed.
  const loadReports = useCallback(async () => {
    if (pageSize === null) return;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (deferredSearch) params.set("search", deferredSearch);
    damageTypes.forEach((type) => params.append("damageType", type));
    if (verifiedBySatelliteOnly) params.set("verifiedBySatellite", "true");
    if (state !== "all") params.set("state", state);
    setLoading(true);
    try {
      const result = await cachedJson<{
        reports: PublicReport[];
        pagination: {
          total: number;
          totalPages: number;
        };
      }>(
        normalizeRequestKey("/api/reports", params),
        DIRECTORY_CACHE_TTL_MS,
        async () => {
          const response = await fetch(`/api/reports?${params}`, {
            headers: { Accept: "application/json" },
          });
          if (!response.ok) {
            throw new Error("No se pudieron cargar los reportes.");
          }
          return response.json();
        },
      );
      setReports(result.reports);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
      setLoadError("");
    } catch (caught) {
      setLoadError(
        caught instanceof Error ? caught.message : "Error de carga."
      );
    } finally {
      setLoading(false);
    }
  }, [damageTypes, deferredSearch, page, pageSize, state, verifiedBySatelliteOnly]);

  useEffect(() => {
    const timeout = window.setTimeout(loadReports, 250);
    return () => window.clearTimeout(timeout);
  }, [loadReports]);

  // Map pins follow the viewport (bounds) plus the active filters.
  const loadMapReports = useCallback(async (signal?: AbortSignal) => {
    if (!viewport.bounds) return;
    const params = new URLSearchParams();
    if (deferredSearch) params.set("search", deferredSearch);
    damageTypes.forEach((type) => params.append("damageType", type));
    if (verifiedBySatelliteOnly) params.set("verifiedBySatellite", "true");
    if (state !== "all") params.set("state", state);
    if (mapManifest) {
      params.set("since", mapManifest.generated_at);
      params.set("limit", String(MAP_DELTA_LIMIT));
    }
    const compactedBounds = compactBounds(viewport.bounds);
    if (compactedBounds) {
      new URLSearchParams(compactedBounds).forEach((value, key) =>
        params.set(key, value)
      );
    }
    setMapLoading(true);
    try {
      const result = await cachedJson<{ reports: MapItem[] }>(
        normalizeRequestKey("/api/reports/map", params),
        MAP_DELTA_CACHE_TTL_MS,
        async () => {
          const response = await fetch(`/api/reports/map?${params}`, {
            headers: { Accept: "application/json" },
          });
          if (!response.ok) {
            throw new Error("No se pudieron cargar los reportes.");
          }
          return response.json();
        },
        signal,
      );
      if (signal?.aborted) return;
      const deltaReports = flattenMapItems(result.reports);
      const baselineReports = mapManifest
        ? filterMapReports(baselineMapReports, {
            bounds: parseBounds(viewport.bounds),
            search: deferredSearch,
            damageTypes,
            state,
            verifiedBySatelliteOnly,
          })
        : [];
      const byId = new Map<string, MapReport>();
      for (const report of baselineReports) byId.set(report.id, report);
      for (const report of deltaReports) byId.set(report.id, report);
      setRawMapReports(Array.from(byId.values()));
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        return;
      }
      // Map pins are best-effort; the directory surfaces load errors instead.
    } finally {
      if (!signal?.aborted) setMapLoading(false);
    }
  }, [
    baselineMapReports,
    damageTypes,
    deferredSearch,
    mapManifest,
    state,
    viewport.bounds,
    verifiedBySatelliteOnly,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadMapReports(controller.signal);
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadMapReports]);

  const handleReportCreated = useCallback((report: PublicReport) => {
    invalidateClientFetchCache(
      (key) =>
        key.startsWith("/api/reports?") ||
        key.startsWith("/api/reports/map?"),
    );
    setPage(1);
    setReports((current) => [
      report,
      ...current.filter((item) => item.id !== report.id),
    ]);
    setTotal((current) => current + 1);
    void loadMapReports();
  }, [loadMapReports]);

  useEffect(() => {
    function handleGlobalReportCreated(event: Event) {
      handleReportCreated((event as CustomEvent<PublicReport>).detail);
    }

    window.addEventListener(REPORT_CREATED_EVENT, handleGlobalReportCreated);
    return () =>
      window.removeEventListener(
        REPORT_CREATED_EVENT,
        handleGlobalReportCreated
      );
  }, [handleReportCreated]);

  const handleHelpResolved = useCallback((report: PublicReport) => {
    invalidateClientFetchCache(
      (key) =>
        key.startsWith("/api/reports?") ||
        key.startsWith("/api/reports/map?"),
    );
    setReports((current) =>
      current.map((item) => (item.id === report.id ? report : item))
    );
    void loadMapReports();
  }, [loadMapReports]);

  const handleViewportChange = useCallback((nextViewport: MapViewport) => {
    const compactedBounds = compactBounds(nextViewport.bounds);
    setViewport((current) => {
      if (
        current.bounds === compactedBounds &&
        current.zoom === nextViewport.zoom
      ) {
        return current;
      }
      return { bounds: compactedBounds, zoom: nextViewport.zoom };
    });
  }, []);

  const parsedViewportBounds = useMemo(
    () => parseBounds(viewport.bounds),
    [viewport.bounds],
  );

  const mapReportClusterIndex = useMemo(
    () => buildMapReportClusterIndex(rawMapReports),
    [rawMapReports],
  );

  const mapReports = useMemo(
    () =>
      getMapReportClusters({
        clusterIndex: mapReportClusterIndex,
        bounds: parsedViewportBounds,
        zoom: viewport.zoom,
      }),
    [mapReportClusterIndex, parsedViewportBounds, viewport.zoom],
  );

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
    document
      .querySelector("#directorio")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const affectedStates = useMemo(
    () =>
      new Set(
        mapReports.flatMap((item) =>
          item.kind === "group"
            ? item.reports.map((report) => report.state)
            : [item.state]
        )
      ).size,
    [mapReports]
  );

  const visibleReportCount = useMemo(
    () => mapReports.reduce((sum, item) => sum + item.reportCount, 0),
    [mapReports]
  );

  return (
    <main>
      <MissionStrip />
      <MapSection
        reports={mapReports}
        loading={mapLoading}
        affectedStates={affectedStates}
        visibleReportCount={visibleReportCount}
        zoneSources={zoneSources}
        onViewportChange={handleViewportChange}
        onZoneSourcesChange={setZoneSources}
        onCreated={handleReportCreated}
      />
      <DirectorySection
        reports={reports}
        search={search}
        state={state}
        damageTypes={damageTypes}
        verifiedBySatelliteOnly={verifiedBySatelliteOnly}
        page={page}
        pageSize={pageSize ?? 25}
        total={total}
        totalPages={totalPages}
        loading={loading}
        loadError={loadError}
        onSearchChange={(value) => {
          setPage(1);
          setSearch(value);
        }}
        onStateChange={(value) => {
          setPage(1);
          setState(value);
        }}
        onDamageTypesChange={(value) => {
          setPage(1);
          setDamageTypes(value);
        }}
        onVerifiedBySatelliteOnlyChange={(value) => {
          setPage(1);
          setVerifiedBySatelliteOnly(value);
        }}
        onPageChange={handlePageChange}
        onRetry={loadReports}
        onCreated={handleReportCreated}
        onHelpResolved={handleHelpResolved}
      />
      {/* <DamageGuideSection onCreated={handleReportCreated} /> */}
    </main>
  );
}
