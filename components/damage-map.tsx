"use client";

import { useEffect } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";

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

const zoneCategoryLabels: Record<DamageZoneCategory, string> = {
  low: "bajo",
  moderate: "moderado",
  high: "alto",
  severe: "severo",
};

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
      "damage-reports-canvas leaflet-zoom-animated",
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

      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = report.needsHelp
        ? "#991b1b"
        : verified
          ? SATELLITE_BLUE
          : damageMarkerColors[report.damageType];
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = report.needsHelp ? "#fff7ed" : "#ffffff";
      ctx.stroke();

      if (isGroup) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "800 12px sans-serif";
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
          report.kind === "group" ? 18 : report.needsHelp ? 15 : 12;

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

function DamageZonesLayer() {
  const map = useMap();

  useEffect(() => {
    const layer = L.layerGroup().addTo(map);
    let aborted = false;

    async function load() {
      const bounds = map.getBounds();
      const params = new URLSearchParams({
        north: String(bounds.getNorth()),
        south: String(bounds.getSouth()),
        east: String(bounds.getEast()),
        west: String(bounds.getWest()),
        limit: "500",
      });
      try {
        const response = await fetch(`/api/zones?${params}`);
        if (!response.ok || aborted) return;
        const data = (await response.json()) as { zones: DamageZone[] };
        if (aborted) return;
        layer.clearLayers();
        for (const zone of data.zones) {
          if (!zone.geometry) continue;
          const color = zoneColors[zone.damageCategory];
          const shape = L.geoJSON(zone.geometry as GeoJSON.GeoJsonObject, {
            style: {
              color,
              weight: 1,
              opacity: 0.4,
              fillColor: color,
              fillOpacity: 0.25,
            },
          });
          shape.bindTooltip(
            `Zona de daño: ${zoneCategoryLabels[zone.damageCategory]}`,
            { sticky: true },
          );
          shape.addTo(layer);
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
  }, [map]);

  return null;
}

function MapEvents({
  selecting,
  onSelect,
  onBoundsChange,
}: {
  selecting: boolean;
  onSelect?: (latitude: number, longitude: number) => void;
  onBoundsChange?: (bounds: string) => void;
}) {
  const map = useMapEvents({
    click(event) {
      if (selecting) onSelect?.(event.latlng.lat, event.latlng.lng);
    },
    moveend() {
      const bounds = map.getBounds();
      onBoundsChange?.(
        new URLSearchParams({
          north: String(bounds.getNorth()),
          south: String(bounds.getSouth()),
          east: String(bounds.getEast()),
          west: String(bounds.getWest()),
        }).toString(),
      );
    },
  });

  useEffect(() => {
    const bounds = map.getBounds();
    onBoundsChange?.(
      new URLSearchParams({
        north: String(bounds.getNorth()),
        south: String(bounds.getSouth()),
        east: String(bounds.getEast()),
        west: String(bounds.getWest()),
      }).toString(),
    );
  }, [map, onBoundsChange]);
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
      map.flyTo([position.latitude, position.longitude], Math.max(map.getZoom(), 14));
    }
  }, [map, position]);
  return null;
}

export function DamageMap({
  reports = [],
  selecting = false,
  selectedPosition,
  onSelect,
  onBoundsChange,
}: {
  reports?: MapItem[];
  selecting?: boolean;
  selectedPosition?: { latitude: number; longitude: number } | null;
  onSelect?: (latitude: number, longitude: number) => void;
  onBoundsChange?: (bounds: string) => void;
}) {
  return (
    <MapContainer
      center={[10.3547, -67.1924]}
      zoom={10}
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
        onBoundsChange={onBoundsChange}
      />
      <FlyToSelection position={selectedPosition} />
      <DamageZonesLayer />
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
