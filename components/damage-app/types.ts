import type { DamageType, PublicReport } from "@/lib/report-schema";

export const emptyReportDraft = {
  buildingName: "",
  address: "",
  state: "",
  city: "",
  latitude: "",
  longitude: "",
  damageType: "severe" as DamageType,
  needsHelp: false,
  description: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  contactConsent: false,
};

export type ReportDraft = typeof emptyReportDraft;
export type ReportCreatedHandler = (report: PublicReport) => void;
export type MapViewport = {
  bounds: string;
  zoom: number;
};
