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
import { REPORT_CREATED_EVENT } from "@/components/site-shell-header";
import type { DamageType, MapItem, PublicReport } from "@/lib/report-schema";

export function DamageApp() {
  const [reports, setReports] = useState<PublicReport[]>([]);
  const [mapReports, setMapReports] = useState<MapItem[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [damageTypes, setDamageTypes] = useState<DamageType[]>([]);
  const [verifiedBySatelliteOnly, setVerifiedBySatelliteOnly] = useState(false);
  const [state, setState] = useState("all");
  const [bounds, setBounds] = useState("");
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
      const response = await fetch(`/api/reports?${params}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("No se pudieron cargar los reportes.");
      const result = (await response.json()) as {
        reports: PublicReport[];
        pagination: {
          total: number;
          totalPages: number;
        };
      };
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
    if (!bounds) return;
    const params = new URLSearchParams();
    if (deferredSearch) params.set("search", deferredSearch);
    damageTypes.forEach((type) => params.append("damageType", type));
    if (verifiedBySatelliteOnly) params.set("verifiedBySatellite", "true");
    if (state !== "all") params.set("state", state);
    if (bounds) {
      new URLSearchParams(bounds).forEach((value, key) =>
        params.set(key, value)
      );
    }
    setMapLoading(true);
    try {
      const response = await fetch(`/api/reports/map?${params}`, {
        headers: { Accept: "application/json" },
        signal,
      });
      if (!response.ok) throw new Error("No se pudieron cargar los reportes.");
      const result = (await response.json()) as { reports: MapItem[] };
      if (signal?.aborted) return;
      setMapReports(result.reports);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        return;
      }
      // Map pins are best-effort; the directory surfaces load errors instead.
    } finally {
      if (!signal?.aborted) setMapLoading(false);
    }
  }, [bounds, damageTypes, deferredSearch, state, verifiedBySatelliteOnly]);

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
    setReports((current) =>
      current.map((item) => (item.id === report.id ? report : item))
    );
    void loadMapReports();
  }, [loadMapReports]);

  const handleBoundsChange = useCallback((nextBounds: string) => {
    setBounds(nextBounds);
  }, []);

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
        onBoundsChange={handleBoundsChange}
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
