"use client";

import { useCallback, useEffect } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";

import { BuildingsLayer } from "@/components/damage-app/map/BuildingsLayer";
import { CogOverlay } from "@/components/damage-app/map/CogOverlay";
import type { MapViewport } from "@/components/damage-app/types";

import { mapTilesPath, type MapTilesManifest } from "@/lib/map-tiles";
import type {
  DamageType,
  DamageZone,
  DamageZoneCategory,
  MapItem,
} from "@/lib/report-schema";

const selectedIcon = L.divIcon({
  className: "damage-marker damage-marker-selected",
  html: "<span></span>",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const SATELLITE_BLUE = "#2563eb";

const damageMarkerColors: Record<DamageType, string> = {
  cracks: "#8a6a24",
  moderate: "#b45309",
  severe: "#b53a24",
  collapse: "#7f1d1d",
};

const zoneColors: Record<DamageZoneCategory, string> = {
  low: "#8a6a24",
  moderate: "#b45309",
  high: "#b53a24",
  severe: "#7f1d1d",
};

const BOUNDS_PRECISION = 4;

function boundsToSearchParams(
  bounds: L.LatLngBounds,
  extra?: Record<string, string>
) {
  return new URLSearchParams({
    north: bounds.getNorth().toFixed(BOUNDS_PRECISION),
    south: bounds.getSouth().toFixed(BOUNDS_PRECISION),
    east: bounds.getEast().toFixed(BOUNDS_PRECISION),
    west: bounds.getWest().toFixed(BOUNDS_PRECISION),
    ...extra,
  });
}

// Exact lucide "satellite-dish" paths (24x24 viewBox), reused for the canvas pin.
const satelliteDishPaths = [
  new Path2D("M4 10a7.31 7.31 0 0 0 10 10Z"),
  new Path2D("m9 15 3-3"),
  new Path2D("M17 13a6 6 0 0 0-6-6"),
  new Path2D("M21 13A10 10 0 0 0 11 3"),
];

type ProjectedReport = {
  report: MapItem;
  point: L.Point;
  radius: number;
};

function createReportPopup(report: MapItem) {
  const container = document.createElement("div");

  if (report.needsHelp) {
    const help = document.createElement("strong");
    help.className = "map-needs-help";
    help.textContent = "Se necesita ayuda";
    container.append(help, document.createElement("br"));
  }

  const title = document.createElement("strong");
  if (report.kind === "group") {
    const label = document.createElement("strong");
    label.className = "map-group-count";
    label.textContent = `${report.reportCount} reportes activos`;
    container.append(label, document.createElement("br"));
    title.textContent = report.buildingName;
    container.append(title, document.createElement("br"), report.address);

    const list = document.createElement("ul");
    list.className = "map-group-list";
    report.reports.slice(0, 3).forEach((item) => {
      const entry = document.createElement("li");
      entry.textContent = `${item.buildingName} · ${item.damageType}`;
      list.append(entry);
    });
    if (report.reportCount > 3) {
      const overflow = document.createElement("li");
      overflow.textContent = `+${report.reportCount - 3} reportes más`;
      list.append(overflow);
    }
    container.append(document.createElement("br"), list);
    return container;
  }

  title.textContent = report.buildingName;
  container.append(title, document.createElement("br"), report.address);

  if (report.verifiedBySatellite) {
    const badge = document.createElement("span");
    badge.className = "map-satellite-verified";
    badge.textContent = "Verificado por imagen satelital";
    container.append(document.createElement("br"), badge);

    if (report.verifiedChipUrl) {
      const img = document.createElement("img");
      img.className = "map-popup-chip";
      img.src = report.verifiedChipUrl;
      img.loading = "lazy";
      img.alt = "Imagen satelital del edificio";
      container.append(img);
    }
  }

  return container;
}

function DamageReportsCanvasLayer({ reports }: { reports: MapItem[] }) {
  const map = useMap();

  useEffect(() => {
    if (!reports.length) return;

    const canvas = L.DomUtil.create(
      "canvas",
      "damage-reports-canvas leaflet-zoom-animated"
    ) as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    const pane = map.getPanes().overlayPane;
    const projected: ProjectedReport[] = [];
    let animationFrame = 0;
    let popup: L.Popup | null = null;

    if (!context) return;

    const ctx = context;

    pane.appendChild(canvas);

    function resizeCanvas() {
      const size = map.getSize();
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = size.x * pixelRatio;
      canvas.height = size.y * pixelRatio;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    // Satellite dish, drawn from the exact lucide "satellite-dish" vector paths.
    function drawAntennaGlyph(x: number, y: number) {
      const scale = 16 / 24; // fit the 24x24 art into ~16px
      ctx.save();
      ctx.translate(x - 12 * scale, y - 12 * scale);
      ctx.scale(scale, scale);
      ctx.strokeStyle = "#ffffff";
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 2 / scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.fill(satelliteDishPaths[0]); // solid dish bowl for legibility
      for (const path of satelliteDishPaths) ctx.stroke(path);
      ctx.restore();
    }

    function drawMarker(item: ProjectedReport) {
      const { report, point, radius } = item;
      const verified = report.verifiedBySatellite;
      const isGroup = report.kind === "group";
      const clusterRingWidth = isGroup ? 4 : 3;

      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = report.needsHelp
        ? "#991b1b"
        : verified
          ? SATELLITE_BLUE
          : damageMarkerColors[report.damageType];
      ctx.fill();
      ctx.lineWidth = clusterRingWidth;
      ctx.strokeStyle = report.needsHelp ? "#fff7ed" : "#ffffff";
      ctx.stroke();

      if (isGroup) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = report.needsHelp
          ? "rgb(153 27 27 / 0.22)"
          : "rgb(255 255 255 / 0.45)";
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = `${report.reportCount > 99 ? "800 11px" : "800 13px"} sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(report.reportCount), point.x, point.y + 0.5);
      } else if (report.needsHelp) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgb(153 27 27 / 0.2)";
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = "800 13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", point.x, point.y + 0.5);
        if (verified) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius + 8, 0, Math.PI * 2);
          ctx.strokeStyle = SATELLITE_BLUE;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      } else if (verified) {
        drawAntennaGlyph(point.x, point.y);
      } else {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
    }

    function redraw() {
      animationFrame = 0;
      const size = map.getSize();
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);
      ctx.clearRect(0, 0, size.x, size.y);
      projected.length = 0;

      for (const report of reports) {
        const point = map.latLngToContainerPoint([
          report.latitude,
          report.longitude,
        ]);
        const radius =
          report.kind === "group"
            ? Math.min(30, 17 + Math.log2(report.reportCount) * 3)
            : report.needsHelp
              ? 15
              : 12;

        if (
          point.x < -radius ||
          point.y < -radius ||
          point.x > size.x + radius ||
          point.y > size.y + radius
        ) {
          continue;
        }

        const item = { report, point, radius };
        projected.push(item);
        drawMarker(item);
      }
    }

    function scheduleRedraw() {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(redraw);
    }

    function findReportAt(point: L.Point) {
      for (let index = projected.length - 1; index >= 0; index -= 1) {
        const item = projected[index];
        const hitRadius = item.radius + 6;
        const dx = point.x - item.point.x;
        const dy = point.y - item.point.y;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) return item.report;
      }
      return null;
    }

    function handleClick(event: Event) {
      const mouseEvent = event as MouseEvent;
      const point = map.mouseEventToContainerPoint(mouseEvent);
      const report = findReportAt(point);
      if (!report) return;

      L.DomEvent.stop(mouseEvent);
      popup?.remove();
      popup = L.popup()
        .setLatLng([report.latitude, report.longitude])
        .setContent(createReportPopup(report))
        .openOn(map);
    }

    function handlePointerMove(event: Event) {
      const point = map.mouseEventToContainerPoint(event as MouseEvent);
      canvas.style.cursor = findReportAt(point) ? "pointer" : "";
    }

    resizeCanvas();
    redraw();
    map.on("move zoom resize", scheduleRedraw);
    L.DomEvent.on(canvas, "click", handleClick);
    L.DomEvent.on(canvas, "mousemove", handlePointerMove);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      map.off("move zoom resize", scheduleRedraw);
      L.DomEvent.off(canvas, "click", handleClick);
      L.DomEvent.off(canvas, "mousemove", handlePointerMove);
      popup?.remove();
      canvas.remove();
    };
  }, [map, reports]);

  return null;
}

// Render order: low → severe, so the most severe band ends up drawn on top.
const damageZoneRenderOrder: DamageZoneCategory[] = [
  "low",
  "moderate",
  "high",
  "severe",
];

type GeoRing = number[][];
type GeoPolygon = GeoRing[]; // [outerRing, ...holes]
type GeoJSONFeatureCollection = {
  type: "FeatureCollection";
  features?: Array<{
    type: "Feature";
    geometry?: unknown;
    properties?: Record<string, unknown>;
  }>;
};

// Close an open contour ring so it can be filled as an area (USGS MMI contours
// are closed rings already; this is a defensive no-op for them).
function closeRing(line: GeoRing): GeoRing | null {
  if (!Array.isArray(line) || line.length < 3) return null;
  const first = line[0];
  const last = line[line.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return line;
  return [...line, first];
}

// Normalize any zone geometry to fillable polygons. Copernicus/ARIA are already
// polygons; USGS ShakeMap intensity contours arrive as (closed) MultiLineStrings.
function geometryToPolygons(geometry: DamageZone["geometry"]): GeoPolygon[] {
  if (!geometry || typeof geometry !== "object") return [];
  const geom = geometry as { type?: string; coordinates?: unknown };
  switch (geom.type) {
    case "Polygon":
      return [geom.coordinates as GeoPolygon];
    case "MultiPolygon":
      return geom.coordinates as GeoPolygon[];
    case "LineString": {
      const ring = closeRing(geom.coordinates as GeoRing);
      return ring ? [[ring]] : [];
    }
    case "MultiLineString":
      return (geom.coordinates as GeoRing[])
        .map(closeRing)
        .filter((ring): ring is GeoRing => Boolean(ring))
        .map((ring) => [ring]);
    default:
      return [];
  }
}

function zoneFromFeature(
  feature: NonNullable<GeoJSONFeatureCollection["features"]>[number],
): DamageZone | null {
  const props = feature.properties;
  if (!props?.id || typeof props.id !== "string") return null;
  return {
    id: props.id,
    geometry: feature.geometry ?? null,
    damageCategory:
      typeof props.damageCategory === "string"
        ? (props.damageCategory as DamageZoneCategory)
        : typeof props.damage_category === "string"
          ? (props.damage_category as DamageZoneCategory)
          : "low",
    score: typeof props.score === "number" ? props.score : 0,
    sourceName:
      typeof props.sourceName === "string"
        ? props.sourceName
        : typeof props.source_name === "string"
          ? props.source_name
          : "unknown",
    acquiredAt:
      typeof props.acquiredAt === "string"
        ? props.acquiredAt
        : typeof props.acquired_at === "string"
          ? props.acquired_at
          : null,
  };
}

function ringIntersectsBounds(ring: GeoRing, bounds: L.LatLngBounds) {
  for (const [lng, lat] of ring) {
    if (bounds.contains([lat, lng])) return true;
  }
  return false;
}

function zoneIntersectsBounds(zone: DamageZone, bounds: L.LatLngBounds) {
  return geometryToPolygons(zone.geometry).some((polygon) =>
    polygon.some((ring) => ringIntersectsBounds(ring, bounds)),
  );
}

// Signed-area magnitude of a ring (shoelace), used to order nested contours
// outermost-first (largest area = lowest intensity = outer boundary).
function ringArea(ring: GeoRing): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(area / 2);
}

type Bbox = [number, number, number, number]; // [minX, minY, maxX, maxY]

function ringBbox(ring: GeoRing): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    outer[0] <= inner[0] &&
    outer[1] <= inner[1] &&
    outer[2] >= inner[2] &&
    outer[3] >= inner[3]
  );
}

// Ray-casting point-in-ring test, to decide true geometric nesting of contours
// (bbox overlap alone gives false positives for separate shaking lobes).
function pointInRing(point: number[], ring: GeoRing): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

interface ContourRing {
  ring: GeoRing;
  category: DamageZoneCategory;
  area: number;
  bbox: Bbox;
}

function DamageZonesLayer({
  onZoneSourcesChange,
}: {
  onZoneSourcesChange?: (sources: string[]) => void;
}) {
  const map = useMap();

  useEffect(() => {
    // Track the last reported set so we only notify the parent on real changes.
    let lastSignature = "";
    function reportSources(zones: DamageZone[]) {
      const sources = Array.from(
        new Set(zones.map((zone) => zone.sourceName))
      ).sort();
      const signature = sources.join("|");
      if (signature === lastSignature) return;
      lastSignature = signature;
      onZoneSourcesChange?.(sources);
    }

    if (!map.getPane("damage-zones")) {
      map.createPane("damage-zones");
    }
    const pane = map.getPane("damage-zones");
    if (pane) {
      pane.style.zIndex = "350";
      pane.style.pointerEvents = "none";
    }

    const layer = L.layerGroup().addTo(map);
    let aborted = false;
    let baselineZones: DamageZone[] | null = null;

    async function loadBaselineZones() {
      if (baselineZones) return baselineZones;
      const manifestResponse = await fetch("/tiles/manifest.json", {
        headers: { Accept: "application/json" },
      });
      if (!manifestResponse.ok) return null;
      const manifest = (await manifestResponse.json()) as MapTilesManifest;
      const zonesResponse = await fetch(mapTilesPath(manifest.zones.geojson), {
        headers: { Accept: "application/geo+json, application/json" },
      });
      if (!zonesResponse.ok) return null;
      const geojson = (await zonesResponse.json()) as GeoJSONFeatureCollection;
      baselineZones = (geojson.features ?? [])
        .map(zoneFromFeature)
        .filter((zone): zone is DamageZone => Boolean(zone));
      return baselineZones;
    }

    async function load() {
      const bounds = map.getBounds();
      const params = boundsToSearchParams(bounds, {
        limit: "500",
      });
      try {
        const baseline = await loadBaselineZones().catch(() => null);
        let zones: DamageZone[];
        if (baseline) {
          zones = baseline
            .filter((zone) => zoneIntersectsBounds(zone, bounds))
            .sort((a, b) => b.score - a.score)
            .slice(0, 500);
        } else {
          const response = await fetch(`/api/zones?${params}`);
          if (!response.ok || aborted) return;
          const data = (await response.json()) as { zones: DamageZone[] };
          zones = data.zones;
        }
        if (aborted) return;
        reportSources(zones);
        layer.clearLayers();

        // Two kinds of zones need different treatment:
        //  - Nested contour rings (USGS ShakeMap MMI): fill the annulus between
        //    each contour and the next one inward, so every enclosed band is
        //    painted by its grade and only the outermost ring stays a boundary.
        //  - Plain damage polygons (Copernicus EMS, ARIA): solid fill, merged
        //    per intensity so cross-source overlaps don't compound opacity.
        const contours: ContourRing[] = [];
        const polygonsByCategory = new Map<DamageZoneCategory, GeoPolygon[]>();
        for (const zone of zones) {
          const geometryType = (zone.geometry as { type?: string } | null)
            ?.type;
          const isContour =
            geometryType === "LineString" || geometryType === "MultiLineString";
          const polygons = geometryToPolygons(zone.geometry);
          if (!polygons.length) continue;
          if (isContour) {
            for (const polygon of polygons) {
              const ring = polygon[0];
              contours.push({
                ring,
                category: zone.damageCategory,
                area: ringArea(ring),
                bbox: ringBbox(ring),
              });
            }
          } else {
            const existing = polygonsByCategory.get(zone.damageCategory) ?? [];
            existing.push(...polygons);
            polygonsByCategory.set(zone.damageCategory, existing);
          }
        }

        // Build a containment tree: each contour's parent is the smallest
        // contour that strictly contains it. A contour is then filled over its
        // own area with its direct children punched out as holes, so every
        // enclosed band shows the grade it crosses into and bands never overlap.
        contours.sort((a, b) => a.area - b.area); // smallest first
        const childRings = new Map<ContourRing, GeoRing[]>();
        const topLevel: ContourRing[] = [];
        for (let i = 0; i < contours.length; i += 1) {
          const child = contours[i];
          let parent: ContourRing | null = null;
          for (let j = i + 1; j < contours.length; j += 1) {
            const candidate = contours[j]; // larger area than child
            if (
              bboxContains(candidate.bbox, child.bbox) &&
              pointInRing(child.ring[0], candidate.ring)
            ) {
              parent = candidate; // first (smallest) container wins
              break;
            }
          }
          if (parent) {
            const holes = childRings.get(parent) ?? [];
            holes.push(child.ring);
            childRings.set(parent, holes);
          } else {
            topLevel.push(child);
          }
        }

        // Draw outermost (largest) first so inner bands paint on top.
        for (let i = contours.length - 1; i >= 0; i -= 1) {
          const contour = contours[i];
          const rings: GeoPolygon = [
            contour.ring,
            ...(childRings.get(contour) ?? []),
          ];
          L.geoJSON(
            {
              type: "Polygon",
              coordinates: rings as GeoJSON.Position[][],
            } as GeoJSON.Polygon,
            {
              interactive: false,
              pane: "damage-zones",
              style: {
                stroke: false,
                fillColor: zoneColors[contour.category],
                fillOpacity: 0.3,
                fillRule: "evenodd",
              },
            }
          ).addTo(layer);
        }

        // Outermost contours kept as the visible boundary of each shaken lobe.
        for (const boundary of topLevel) {
          L.geoJSON(
            {
              type: "Polygon",
              coordinates: [boundary.ring] as GeoJSON.Position[][],
            } as GeoJSON.Polygon,
            {
              interactive: false,
              pane: "damage-zones",
              style: {
                color: zoneColors[boundary.category],
                weight: 1.2,
                opacity: 0.55,
                fill: false,
              },
            }
          ).addTo(layer);
        }

        // Plain damage polygons, merged per intensity (severe drawn on top).
        for (const category of damageZoneRenderOrder) {
          const polygons = polygonsByCategory.get(category);
          if (!polygons?.length) continue;
          const color = zoneColors[category];
          L.geoJSON(
            {
              type: "MultiPolygon",
              coordinates: polygons as GeoJSON.Position[][][],
            } as GeoJSON.MultiPolygon,
            {
              interactive: false,
              pane: "damage-zones",
              style: {
                color,
                weight: 1,
                opacity: 0.2,
                fillColor: color,
                fillOpacity: 0.125,
                fillRule: "nonzero",
              },
            }
          ).addTo(layer);
        }
      } catch {
        // ignore network errors; zones are non-critical
      }
    }

    void load();
    map.on("moveend", load);

    return () => {
      aborted = true;
      map.off("moveend", load);
      layer.remove();
    };
  }, [map, onZoneSourcesChange]);

  return null;
}

function MapEvents({
  selecting,
  onSelect,
  onViewportChange,
}: {
  selecting: boolean;
  onSelect?: (latitude: number, longitude: number) => void;
  onViewportChange?: (viewport: MapViewport) => void;
}) {
  const reportViewport = useCallback((map: L.Map) => {
    const bounds = map.getBounds();
    onViewportChange?.({
      bounds: boundsToSearchParams(bounds).toString(),
      zoom: map.getZoom(),
    });
  }, [onViewportChange]);

  const map = useMapEvents({
    click(event) {
      if (selecting) onSelect?.(event.latlng.lat, event.latlng.lng);
    },
    moveend() {
      reportViewport(map);
    },
    zoomend() {
      reportViewport(map);
    },
  });

  useEffect(() => {
    reportViewport(map);
  }, [map, reportViewport]);
  return null;
}

function FlyToSelection({
  position,
}: {
  position?: { latitude: number; longitude: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.flyTo(
        [position.latitude, position.longitude],
        Math.max(map.getZoom(), 14)
      );
    }
  }, [map, position]);
  return null;
}

export function DamageMap({
  reports = [],
  selecting = false,
  selectedPosition,
  onSelect,
  onViewportChange,
  onZoneSourcesChange,
  showDamageZones = true,
  showBuildings = false,
  cogUrl,
  cogOpacity = 0.8,
}: {
  reports?: MapItem[];
  selecting?: boolean;
  selectedPosition?: { latitude: number; longitude: number } | null;
  onSelect?: (latitude: number, longitude: number) => void;
  onViewportChange?: (viewport: MapViewport) => void;
  onZoneSourcesChange?: (sources: string[]) => void;
  showDamageZones?: boolean;
  showBuildings?: boolean;
  cogUrl?: string;
  cogOpacity?: number;
}) {
  return (
    <MapContainer
      center={[10.5086, -66.8903]}
      zoom={12}
      scrollWheelZoom
      className="h-full w-full"
      aria-label="Mapa interactivo de Venezuela con reportes de daños"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapEvents
        selecting={selecting}
        onSelect={onSelect}
        onViewportChange={onViewportChange}
      />
      <FlyToSelection position={selectedPosition} />
      {showBuildings ? <BuildingsLayer url="/tiles/buildings.pmtiles" /> : null}
      {cogUrl ? <CogOverlay url={cogUrl} opacity={cogOpacity} /> : null}
      {showDamageZones ? (
        <DamageZonesLayer onZoneSourcesChange={onZoneSourcesChange} />
      ) : null}
      <DamageReportsCanvasLayer reports={reports} />
      {selectedPosition ? (
        <Marker
          position={[selectedPosition.latitude, selectedPosition.longitude]}
          icon={selectedIcon}
        >
          <Popup>Ubicación seleccionada</Popup>
        </Marker>
      ) : null}
    </MapContainer>
  );
}
