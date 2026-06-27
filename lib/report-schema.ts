import { z } from "zod";
import { isValidPhoneNumber } from "libphonenumber-js/min";

export const damageTypes = ["cracks", "moderate", "severe", "collapse"] as const;

const damageTypeFilterSchema = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value : [value];
  },
  z.array(z.enum(damageTypes)).max(damageTypes.length).optional(),
);

const optionalBooleanFilterSchema = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((value) => value === true || value === "true")
  .optional();

export const reportInputSchema = z
  .object({
    buildingName: z
      .string()
      .trim()
      .min(2, "Escribe el nombre del edificio o la estructura con al menos 2 caracteres.")
      .max(120, "El nombre del edificio o la estructura no puede superar los 120 caracteres."),
    address: z
      .string()
      .trim()
      .min(5, "Escribe una dirección más completa para poder ubicar el lugar.")
      .max(240, "La dirección es demasiado larga. Resume la referencia en menos de 240 caracteres."),
    state: z
      .string()
      .trim()
      .min(2, "Indica el estado donde ocurrió el daño.")
      .max(80, "El nombre del estado es demasiado largo."),
    city: z
      .string()
      .trim()
      .min(2, "Indica la ciudad o la zona donde ocurrió el daño.")
      .max(120, "El nombre de la ciudad o la zona es demasiado largo."),
    latitude: z.coerce
      .number({
        error: "Indica una latitud válida.",
      })
      .min(-90, "La latitud debe estar entre -90 y 90.")
      .max(90, "La latitud debe estar entre -90 y 90."),
    longitude: z.coerce
      .number({
        error: "Indica una longitud válida.",
      })
      .min(-180, "La longitud debe estar entre -180 y 180.")
      .max(180, "La longitud debe estar entre -180 y 180."),
    damageType: z.enum(damageTypes, {
      error: "Selecciona el tipo de daño que mejor describe la situación.",
    }),
    needsHelp: z
      .union([z.literal("true"), z.literal("false"), z.boolean()])
      .transform((value) => value === true || value === "true"),
    description: z
      .string()
      .trim()
      .min(10, "Describe con un poco más de detalle qué daño estás viendo.")
      .max(2000, "La descripción es demasiado larga. Resume la información en menos de 2000 caracteres."),
    contactName: z.string().trim().max(100).optional().default(""),
    contactPhone: z
      .string()
      .trim()
      .max(40, "El teléfono es demasiado largo.")
      .refine(
        (value) => value === "" || isValidPhoneNumber(value),
        "Escribe un teléfono válido con su código de país, por ejemplo +58...",
      )
      .optional()
      .default(""),
    contactEmail: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .email("Escribe un correo electrónico válido.")
          .max(160, "El correo electrónico es demasiado largo."),
      ])
      .optional()
      .default(""),
    contactConsent: z
      .union([z.literal("true"), z.literal("false"), z.boolean()])
      .transform((value) => value === true || value === "true"),
    turnstileToken: z
      .string()
      .min(1, "Confirma que eres una persona antes de enviar el reporte."),
  })
  .superRefine((value, context) => {
    const hasContact = Boolean(
      value.contactName || value.contactPhone || value.contactEmail,
    );
    if (hasContact && !value.contactConsent) {
      context.addIssue({
        code: "custom",
        path: ["contactConsent"],
        message:
          "Si vas a publicar datos de contacto, debes autorizar su publicación.",
      });
    }
  });

export const reportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  search: z.string().trim().max(120).optional(),
  state: z.string().trim().max(80).optional(),
  damageType: damageTypeFilterSchema,
  verifiedBySatellite: optionalBooleanFilterSchema,
  north: z.coerce.number().min(-90).max(90).optional(),
  south: z.coerce.number().min(-90).max(90).optional(),
  east: z.coerce.number().min(-180).max(180).optional(),
  west: z.coerce.number().min(-180).max(180).optional(),
});

export const mapReportQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  state: z.string().trim().max(80).optional(),
  damageType: damageTypeFilterSchema,
  verifiedBySatellite: optionalBooleanFilterSchema,
  since: z.string().datetime().optional(),
  north: z.coerce.number().min(-90).max(90).optional(),
  south: z.coerce.number().min(-90).max(90).optional(),
  east: z.coerce.number().min(-180).max(180).optional(),
  west: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(1000),
});

export const damageZoneCategories = [
  "low",
  "moderate",
  "high",
  "severe",
] as const;

// Human labels for the authoritative sources that feed the damage_zones layer.
// Used by the unified map legend to attribute whichever sources are in view.
export const damageZoneSourceLabels: Record<string, string> = {
  "copernicus-ems-area": "Copernicus EMS",
  "copernicus-ems": "Copernicus EMS",
  "usgs-shakemap": "USGS ShakeMap",
  gdacs: "GDACS",
  "aria-dpm": "ARIA (NASA/JPL)",
};

export function damageZoneSourceLabel(sourceName: string): string {
  return damageZoneSourceLabels[sourceName] ?? sourceName;
}

export const zoneQuerySchema = z.object({
  north: z.coerce.number().min(-90).max(90).optional(),
  south: z.coerce.number().min(-90).max(90).optional(),
  east: z.coerce.number().min(-180).max(180).optional(),
  west: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

export type ReportInput = z.infer<typeof reportInputSchema>;
export type DamageType = (typeof damageTypes)[number];

export interface ReportImage {
  id: string;
  url: string;
  width: number;
  height: number;
  position: number;
}

export interface PublicReport {
  id: string;
  buildingName: string;
  address: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  damageType: DamageType;
  needsHelp: boolean;
  description: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: string;
  verifiedBySatellite: boolean;
  images: ReportImage[];
}

export interface MapReport {
  id: string;
  buildingName: string;
  address: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  damageType: DamageType;
  needsHelp: boolean;
  createdAt: string;
  verifiedBySatellite: boolean;
  verifiedChipUrl: string | null;
}

export interface MapSingleReport extends MapReport {
  kind: "single";
  reportCount: 1;
}

export interface MapReportGroup {
  kind: "group";
  id: string;
  buildingName: string;
  address: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  damageType: DamageType;
  needsHelp: boolean;
  createdAt: string;
  verifiedBySatellite: boolean;
  reportCount: number;
  reportIds: string[];
  reports: MapReport[];
}

export type MapItem = MapSingleReport | MapReportGroup;

export type DamageZoneCategory = (typeof damageZoneCategories)[number];

export interface DamageZone {
  id: string;
  geometry: unknown;
  damageCategory: DamageZoneCategory;
  score: number;
  sourceName: string;
  acquiredAt: string | null;
}

export const imageryQuerySchema = z.object({
  north: z.coerce.number().min(-90).max(90).optional(),
  south: z.coerce.number().min(-90).max(90).optional(),
  east: z.coerce.number().min(-180).max(180).optional(),
  west: z.coerce.number().min(-180).max(180).optional(),
  phase: z.enum(["pre", "post"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface ImageryScene {
  sceneId: string;
  provider: string;
  phase: string | null;
  datetime: string | null;
  license: string | null;
  /** [minLng, minLat, maxLng, maxLat] in EPSG:4326 */
  bbox: [number, number, number, number];
  r2Key: string;
  resolutionM: number | null;
}
