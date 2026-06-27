"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { leafletLayer, PolygonSymbolizer } from "protomaps-leaflet";

export function BuildingsLayer({ url }: { url: string }) {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane("buildings")) {
      map.createPane("buildings");
    }
    const pane = map.getPane("buildings")!;
    pane.style.zIndex = "320";
    pane.style.pointerEvents = "none";

    const layer = leafletLayer({
      url,
      paintRules: [
        {
          dataLayer: "buildings",
          minzoom: 14,
          symbolizer: new PolygonSymbolizer({
            fill: "#c8c0ad",
            opacity: 0.25,
            stroke: "#6b7280",
            width: 0.8,
          }),
        },
      ],
      labelRules: [],
    });

    layer.addTo(map);

    return () => {
      layer.remove();
    };
  }, [map, url]);

  return null;
}
