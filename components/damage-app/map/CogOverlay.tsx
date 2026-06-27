"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import type GeoRasterLayer from "georaster-layer-for-leaflet";

const COG_PANE = "cogPane";
// Below damage-zones (350) and overlayPane (400) — raster stays behind pins.
const COG_PANE_Z_INDEX = 200;

export function CogOverlay({ url, opacity }: { url: string; opacity: number }) {
  const map = useMap();
  const layerRef = useRef<GeoRasterLayer | null>(null);

  useEffect(() => {
    if (!map.getPane(COG_PANE)) {
      const pane = map.createPane(COG_PANE);
      pane.style.zIndex = String(COG_PANE_Z_INDEX);
      pane.style.pointerEvents = "none";
    }

    let cancelled = false;

    async function loadCog() {
      try {
        const [{ default: parseGeoraster }, { default: GeoRasterLayer }] =
          await Promise.all([
            import("georaster"),
            import("georaster-layer-for-leaflet"),
          ]);

        // parseGeoraster(url) issues HTTP Range requests — the /imagery route
        // handles Range headers so geotiff.js fetches only the needed tiles.
        const georaster = await parseGeoraster(url);
        if (cancelled) return;

        const layer = new GeoRasterLayer({
          georaster,
          opacity,
          pane: COG_PANE,
          resolution: 256,
        });

        if (!cancelled) {
          layer.addTo(map);
          layerRef.current = layer;
        }
      } catch {
        // COG overlay is non-critical; swallow errors silently.
      }
    }

    void loadCog();

    return () => {
      cancelled = true;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, url]); // url changes rebuild the layer from scratch

  useEffect(() => {
    layerRef.current?.setOpacity(opacity);
  }, [opacity]);

  return null;
}
