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

import type { PublicReport } from "@/lib/report-schema";

const markerIcon = L.divIcon({
  className: "damage-marker",
  html: "<span></span>",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const needsHelpMarkerIcon = L.divIcon({
  className: "damage-marker damage-marker-needs-help",
  html: "<span>!</span>",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const selectedIcon = L.divIcon({
  className: "damage-marker damage-marker-selected",
  html: "<span></span>",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

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
  reports?: PublicReport[];
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
      {reports.map((report) => (
        <Marker
          key={report.id}
          position={[report.latitude, report.longitude]}
          icon={report.needsHelp ? needsHelpMarkerIcon : markerIcon}
        >
          <Popup>
            {report.needsHelp ? (
              <>
                <strong className="map-needs-help">Se necesita ayuda</strong>
                <br />
              </>
            ) : null}
            <strong>{report.buildingName}</strong>
            <br />
            {report.address}
          </Popup>
        </Marker>
      ))}
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
