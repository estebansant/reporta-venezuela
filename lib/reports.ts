import type { D1Database } from "@cloudflare/workers-types";

import type { DamageType, PublicReport } from "@/lib/report-schema";

interface ReportRow {
  id: string;
  building_name: string;
  address: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  damage_type: DamageType;
  needs_help: number;
  description: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  created_at: string;
  verified_by_satellite: number;
  image_id: string | null;
  image_width: number | null;
  image_height: number | null;
  image_position: number | null;
}

export function rowsToReports(rows: ReportRow[]): PublicReport[] {
  const reports = new Map<string, PublicReport>();
  for (const row of rows) {
    let report = reports.get(row.id);
    if (!report) {
      report = {
        id: row.id,
        buildingName: row.building_name,
        address: row.address,
        state: row.state,
        city: row.city,
        latitude: row.latitude,
        longitude: row.longitude,
        damageType: row.damage_type,
        needsHelp: row.needs_help === 1,
        description: row.description,
        contactName: row.contact_name,
        contactPhone: row.contact_phone,
        contactEmail: row.contact_email,
        createdAt: row.created_at,
        verifiedBySatellite: row.verified_by_satellite === 1,
        images: [],
      };
      reports.set(row.id, report);
    }
    if (row.image_id) {
      report.images.push({
        id: row.image_id,
        url: `/media/reports/${row.id}/${row.image_id}.webp`,
        width: row.image_width ?? 1,
        height: row.image_height ?? 1,
        position: row.image_position ?? 0,
      });
    }
  }
  return [...reports.values()];
}

export async function getReportById(db: D1Database, id: string) {
  const result = await db
    .prepare(
      `SELECT r.*, i.id AS image_id, i.width AS image_width,
        i.height AS image_height, i.position AS image_position
       FROM reports r
       LEFT JOIN report_images i ON i.report_id = r.id
       WHERE r.id = ? AND r.status = 'published'
       ORDER BY i.position ASC`,
    )
    .bind(id)
    .all<ReportRow>();
  return rowsToReports(result.results)[0] ?? null;
}
