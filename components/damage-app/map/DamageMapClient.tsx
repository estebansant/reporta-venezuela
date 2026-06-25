"use client";

import dynamic from "next/dynamic";

export const DamageMapClient = dynamic(
  () => import("@/components/damage-map").then((module) => module.DamageMap),
  {
    ssr: false,
    loading: () => <div className="map-loading">Cargando mapa…</div>,
  }
);
