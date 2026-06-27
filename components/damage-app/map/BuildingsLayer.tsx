"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { leafletLayer, PolygonSymbolizer } from "protomaps-leaflet";

// Per-building damage classes (Microsoft AI for Good footprints). Colors mirror
// the shared damage-zone palette in DamageMapWithZonesToggle so the legend stays
// consistent across sources.
const DAMAGE_COLORS: Record<string, string> = {
  severe: "#7f1d1d", // 80-100% — pérdida total
  high: "#b53a24", // 60-80% — daño severo
  moderate: "#b45309", // 40-60% — daño moderado
  low: "#8a6a24", // 20-40% — daño leve
  minimal: "#c8c0ad", // <20% — sin daño relevante
};

function damageFill(_z: number, f?: { props: Record<string, unknown> }): string {
  const cls = String(f?.props?.["damage_class"] ?? "none");
  return DAMAGE_COLORS[cls] ?? "#c8c0ad";
}

function damageOpacity(_z: number, f?: { props: Record<string, unknown> }): number {
  const cls = String(f?.props?.["damage_class"] ?? "none");
  // Damaged buildings read solid; undamaged ones stay faint context.
  return cls in DAMAGE_COLORS && cls !== "minimal" ? 0.7 : 0.18;
}

export function BuildingsLayer({
  url,
  colorByDamage = false,
}: {
  url: string;
  colorByDamage?: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    const paneName = colorByDamage ? "buildings-damage" : "buildings";
    if (!map.getPane(paneName)) {
      map.createPane(paneName);
    }
    const pane = map.getPane(paneName)!;
    pane.style.zIndex = colorByDamage ? "321" : "320";
    pane.style.pointerEvents = "none";

    const symbolizer = colorByDamage
      ? new PolygonSymbolizer({
          fill: damageFill,
          opacity: damageOpacity,
          stroke: "#3f1010",
          width: 0.4,
          perFeature: true,
        })
      : new PolygonSymbolizer({
          fill: "#c8c0ad",
          opacity: 0.25,
          stroke: "#6b7280",
          width: 0.8,
        });

    const layer = leafletLayer({
      url,
      pane: paneName,
      paintRules: [
        {
          dataLayer: "buildings",
          minzoom: 14,
          symbolizer,
        },
      ],
      labelRules: [],
    });

    layer.addTo(map);

    return () => {
      layer.remove();
    };
  }, [map, url, colorByDamage]);

  return null;
}
