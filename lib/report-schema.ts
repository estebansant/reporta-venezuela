import { z } from "zod";
import { isValidPhoneNumber } from "libphonenumber-js/min";

export const damageTypes = ["cracks", "moderate", "severe", "collapse"] as const;

export const reportInputSchema = z
  .object({
    buildingName: z.string().trim().min(2).max(120),
    address: z.string().trim().min(5).max(240),
    state: z.string().trim().min(2).max(80),
    city: z.string().trim().min(2).max(120),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    damageType: z.enum(damageTypes),
    needsHelp: z
      .union([z.literal("true"), z.literal("false"), z.boolean()])
      .transform((value) => value === true || value === "true"),
    description: z.string().trim().min(10).max(2000),
    contactName: z.string().trim().max(100).optional().default(""),
    contactPhone: z
      .string()
      .trim()
      .max(40)
      .refine(
        (value) => value === "" || isValidPhoneNumber(value),
        "Introduce un teléfono válido con su código de país.",
      )
      .optional()
      .default(""),
    contactEmail: z
      .union([z.literal(""), z.string().trim().email().max(160)])
      .optional()
      .default(""),
    contactConsent: z
      .union([z.literal("true"), z.literal("false"), z.boolean()])
      .transform((value) => value === true || value === "true"),
    turnstileToken: z.string().min(1),
  })
  .superRefine((value, context) => {
    const hasContact = Boolean(
      value.contactName || value.contactPhone || value.contactEmail,
    );
    if (hasContact && !value.contactConsent) {
      context.addIssue({
        code: "custom",
        path: ["contactConsent"],
        message: "Debes autorizar la publicación de los datos de contacto.",
      });
    }
  });

export const reportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  search: z.string().trim().max(120).optional(),
  state: z.string().trim().max(80).optional(),
  damageType: z.enum(damageTypes).optional(),
  north: z.coerce.number().min(-90).max(90).optional(),
  south: z.coerce.number().min(-90).max(90).optional(),
  east: z.coerce.number().min(-180).max(180).optional(),
  west: z.coerce.number().min(-180).max(180).optional(),
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
  images: ReportImage[];
}
