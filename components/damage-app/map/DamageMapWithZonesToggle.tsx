"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Building2, Eye, EyeOff, Layers } from "lucide-react";

import type { MapViewport } from "@/components/damage-app/types";
import { DamageMapClient } from "@/components/damage-app/map/DamageMapClient";
import { Button } from "@/components/ui/button";
import {
  damageZoneSourceLabel,
  type DamageZoneCategory,
  type ImageryScene,
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

function sceneLabel(scene: ImageryScene): string {
  const phase = scene.phase === "pre" ? "Pre" : scene.phase === "post" ? "Post" : "?";
  const date = scene.datetime ? scene.datetime.slice(0, 10) : "s/f";
  const res = scene.resolutionM ? ` ${scene.resolutionM}m` : "";
  return `${phase} · ${date}${res}`;
}

export function DamageMapWithZonesToggle({
  reports,
  zoneSources,
  onViewportChange,
  onZoneSourcesChange,
  cogUrl,
}: {
  reports: MapItem[];
  zoneSources: string[];
  onViewportChange: (viewport: MapViewport) => void;
  onZoneSourcesChange: (sources: string[]) => void;
  cogUrl?: string;
}) {
  const [showDamageZones, setShowDamageZones] = useState(true);
  const [showBuildings, setShowBuildings] = useState(false);
  const [showVhr, setShowVhr] = useState(true);
  const [vhrOpacity, setVhrOpacity] = useState(0.8);

  // Bounds string from the map (format: north=X&south=X&east=X&west=X).
  const [bounds, setBounds] = useState<string>("");
  const [scenes, setScenes] = useState<ImageryScene[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>("");

  // Intercept bounds so we can fetch scenes for the current viewport.
  function handleViewportChange(nextViewport: MapViewport) {
    setBounds(nextViewport.bounds);
    onViewportChange(nextViewport);
  }

  useEffect(() => {
    if (!bounds) return;
    const controller = new AbortController();
    fetch(`/api/imagery?${bounds}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { scenes: ImageryScene[] } | null) => {
        if (!data) return;
        setScenes(data.scenes);
        // Auto-select the most recent post scene if nothing is chosen yet.
        if (!selectedSceneId) {
          const post = data.scenes.find((s) => s.phase === "post");
          if (post) setSelectedSceneId(post.sceneId);
        }
      })
      .catch(() => {});
    return () => controller.abort();
    // selectedSceneId intentionally omitted — only re-fetch on viewport change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);

  const selectedScene = scenes.find((s) => s.sceneId === selectedSceneId);
  // API-selected scene URL takes priority over the static cogUrl prop.
  const activeCogUrl =
    selectedScene ? `/${selectedScene.r2Key}` : cogUrl;
  const hasVhr = Boolean(activeCogUrl || scenes.length > 0);

  return (
    <>
      <DamageMapClient
        reports={reports}
        onViewportChange={handleViewportChange}
        onZoneSourcesChange={onZoneSourcesChange}
        showDamageZones={showDamageZones}
        showBuildings={showBuildings}
        cogUrl={hasVhr && showVhr ? activeCogUrl : undefined}
        cogOpacity={vhrOpacity}
      />
      <div className="map-overlay-controls">
        <div className="map-overlay-stack">
          {hasVhr ? (
            <>
              <Button
                type="button"
                variant={showVhr ? "secondary" : "outline"}
                size="sm"
                className="map-zones-toggle-button"
                onClick={() => setShowVhr((v) => !v)}
                aria-pressed={showVhr}
                aria-label={showVhr ? "Ocultar imagen VHR" : "Mostrar imagen VHR"}
              >
                {showVhr ? (
                  <>
                    <EyeOff />
                    Ocultar VHR
                  </>
                ) : (
                  <>
                    <Layers />
                    Imagen VHR
                  </>
                )}
              </Button>
              {showVhr ? (
                <>
                  {scenes.length > 0 ? (
                    <div className="vhr-scene-panel">
                      <span className="vhr-opacity-label">Escena VHR</span>
                      <select
                        className="vhr-scene-select"
                        value={selectedSceneId}
                        onChange={(e) => setSelectedSceneId(e.target.value)}
                        aria-label="Seleccionar escena VHR"
                      >
                        <option value="">— ninguna —</option>
                        {scenes.map((scene) => (
                          <option key={scene.sceneId} value={scene.sceneId}>
                            {sceneLabel(scene)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div className="vhr-opacity-panel">
                    <span className="vhr-opacity-label">Opacidad VHR</span>
                    <input
                      type="range"
                      className="vhr-opacity-slider"
                      min={0}
                      max={1}
                      step={0.05}
                      value={vhrOpacity}
                      onChange={(e) => setVhrOpacity(Number(e.target.value))}
                      aria-label="Opacidad de imagen VHR"
                    />
                  </div>
                </>
              ) : null}
            </>
          ) : null}
          <Button
            type="button"
            variant={showBuildings ? "secondary" : "outline"}
            size="sm"
            className="map-zones-toggle-button"
            onClick={() => setShowBuildings((v) => !v)}
            aria-pressed={showBuildings}
            aria-label={showBuildings ? "Ocultar huellas de edificios" : "Mostrar huellas de edificios"}
          >
            <Building2 />
            {showBuildings ? "Ocultar edificios" : "Edificios"}
          </Button>
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
