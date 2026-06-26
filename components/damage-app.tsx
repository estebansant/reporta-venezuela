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
import type { DamageType, PublicReport } from "@/lib/report-schema";

// Map shows every report within the current viewport, so request a high cap
// instead of paginating the pins.
const MAP_PAGE_SIZE = 500;

export function DamageApp() {
  const [reports, setReports] = useState<PublicReport[]>([]);
  const [mapReports, setMapReports] = useState<PublicReport[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [damageType, setDamageType] = useState<"all" | DamageType>("all");
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
    if (damageType !== "all") params.set("damageType", damageType);
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
  }, [damageType, deferredSearch, page, pageSize, state]);

  useEffect(() => {
    const timeout = window.setTimeout(loadReports, 250);
    return () => window.clearTimeout(timeout);
  }, [loadReports]);

  // Map pins follow the viewport (bounds) plus the active filters.
  const loadMapReports = useCallback(async () => {
    const params = new URLSearchParams({
      page: "1",
      pageSize: String(MAP_PAGE_SIZE),
    });
    if (deferredSearch) params.set("search", deferredSearch);
    if (damageType !== "all") params.set("damageType", damageType);
    if (state !== "all") params.set("state", state);
    if (bounds) {
      new URLSearchParams(bounds).forEach((value, key) =>
        params.set(key, value)
      );
    }
    setMapLoading(true);
    try {
      const response = await fetch(`/api/reports?${params}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("No se pudieron cargar los reportes.");
      const result = (await response.json()) as { reports: PublicReport[] };
      setMapReports(result.reports);
    } catch {
      // Map pins are best-effort; the directory surfaces load errors instead.
    } finally {
      setMapLoading(false);
    }
  }, [bounds, damageType, deferredSearch, state]);

  useEffect(() => {
    const timeout = window.setTimeout(loadMapReports, 250);
    return () => window.clearTimeout(timeout);
  }, [loadMapReports]);

  const handleReportCreated = useCallback((report: PublicReport) => {
    setPage(1);
    setReports((current) => [
      report,
      ...current.filter((item) => item.id !== report.id),
    ]);
    setMapReports((current) => [
      report,
      ...current.filter((item) => item.id !== report.id),
    ]);
    setTotal((current) => current + 1);
  }, []);

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
    setMapReports((current) =>
      current.map((item) => (item.id === report.id ? report : item))
    );
  }, []);

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
    () => new Set(mapReports.map((report) => report.state)).size,
    [mapReports]
  );

  return (
    <main>
      <MissionStrip />
      <MapSection
        reports={mapReports}
        loading={mapLoading}
        affectedStates={affectedStates}
        onBoundsChange={handleBoundsChange}
        onCreated={handleReportCreated}
      />
      <DirectorySection
        reports={reports}
        search={search}
        state={state}
        damageType={damageType}
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
        onDamageTypeChange={(value) => {
          setPage(1);
          setDamageType(value);
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
