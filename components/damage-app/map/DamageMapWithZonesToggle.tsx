"use client";

import { useState, type CSSProperties } from "react";
import { Eye, EyeOff } from "lucide-react";

import { DamageMapClient } from "@/components/damage-app/map/DamageMapClient";
import { Button } from "@/components/ui/button";
import {
  damageZoneSourceLabel,
  type DamageZoneCategory,
  type MapItem,
} from "@/lib/report-schema";

const damageZoneLegendItems: {
  category: DamageZoneCategory;
  label: string;
  color: string;
}[] = [
  { category: "low", label: "Daño bajo", color: "#8a6a24" },
  { category: "moderate", label: "Daño moderado", color: "#b45309" },
  { category: "high", label: "Daño alto", color: "#b53a24" },
  { category: "severe", label: "Daño severo", color: "#7f1d1d" },
];

function DamageZonesLegend({ sources }: { sources: string[] }) {
  const sourceLabels = Array.from(new Set(sources.map(damageZoneSourceLabel)));

  return (
    <div
      className="map-legend damage-zone-legend"
      aria-label="Leyenda de zonas de daño"
    >
      <p>Zonas de daño</p>
      {damageZoneLegendItems.map((item) => (
        <div key={item.category}>
          <span
            className="damage-zone-swatch"
            style={{ "--zone-color": item.color } as CSSProperties}
            aria-hidden="true"
          />
          {item.label}
        </div>
      ))}
      <p
        style={{
          marginTop: "0.65rem",
          marginBottom: 0,
          color: "var(--muted-foreground)",
          fontSize: "12px",
        }}
      >
        {sourceLabels.length ? (
          <>
            <strong>Fuentes:</strong> {sourceLabels.join(" · ")}
          </>
        ) : (
          "Sin zonas en esta vista"
        )}
      </p>
    </div>
  );
}

export function DamageMapWithZonesToggle({
  reports,
  zoneSources,
  onBoundsChange,
  onZoneSourcesChange,
}: {
  reports: MapItem[];
  zoneSources: string[];
  onBoundsChange: (bounds: string) => void;
  onZoneSourcesChange: (sources: string[]) => void;
}) {
  const [showDamageZones, setShowDamageZones] = useState(true);

  return (
    <>
      <DamageMapClient
        reports={reports}
        onBoundsChange={onBoundsChange}
        onZoneSourcesChange={onZoneSourcesChange}
        showDamageZones={showDamageZones}
      />
      <div className="map-overlay-controls">
        <div className="map-overlay-stack">
          <Button
            type="button"
            variant={showDamageZones ? "secondary" : "outline"}
            size="sm"
            className="map-zones-toggle-button"
            onClick={() => setShowDamageZones((value) => !value)}
            aria-pressed={showDamageZones}
            aria-label={
              showDamageZones
                ? "Ocultar zonas de daño"
                : "Mostrar zonas de daño"
            }
          >
            {showDamageZones ? (
              <>
                <EyeOff />
                Ocultar zonas
              </>
            ) : (
              <>
                <Eye />
                Mostrar zonas
              </>
            )}
          </Button>
          {showDamageZones ? <DamageZonesLegend sources={zoneSources} /> : null}
        </div>
      </div>
    </>
  );
}
