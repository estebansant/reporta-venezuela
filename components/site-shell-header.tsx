"use client";

import { SiteHeader } from "@/components/damage-app/navigation/SiteHeader";
import type { PublicReport } from "@/lib/report-schema";

export const REPORT_CREATED_EVENT = "damage-report-created";

export function SiteShellHeader() {
  function handleCreated(report: PublicReport) {
    window.dispatchEvent(
      new CustomEvent<PublicReport>(REPORT_CREATED_EVENT, { detail: report })
    );
  }

  return <SiteHeader onCreated={handleCreated} />;
}
