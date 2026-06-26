import type { DamageType } from "./report-schema";

export const SOURCE_NAME = "terremotovenezuela.com";
export const SOURCE_BASE_URL = "https://terremotovenezuela.com";
export const MAX_IMPORT_IMAGES = 5;

export interface SourceBuilding {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  zone: string | null;
  lat: number | null;
  lng: number | null;
  damage_level: string | null;
  status: string | null;
  main_photo_url: string | null;
  media_urls: unknown;
  notes: string | null;
  general_source: string | null;
  last_updated_at: string | null;
  created_at: string | null;
}

export interface NormalizedImportReport {
  sourceName: typeof SOURCE_NAME;
  sourceId: string;
  sourceUrl: string;
  sourceUpdatedAt: string;
  buildingName: string;
  address: string;
  state: string;
  city: string;
  zone: string;
  latitude: number | null;
  longitude: number | null;
  damageType: DamageType;
  description: string;
  imageUrls: string[];
  discardedImageCount: number;
  warnings: string[];
}

const VENEZUELAN_STATES = [
  "Amazonas",
  "Anzoátegui",
  "Apure",
  "Aragua",
  "Barinas",
  "Bolívar",
  "Carabobo",
  "Cojedes",
  "Delta Amacuro",
  "Distrito Capital",
  "Falcón",
  "Guárico",
  "La Guaira",
  "Lara",
  "Mérida",
  "Miranda",
  "Monagas",
  "Nueva Esparta",
  "Portuguesa",
  "Sucre",
  "Táchira",
  "Trujillo",
  "Yaracuy",
  "Zulia",
] as const;

const CITY_STATE_HINTS = new Map<string, string>([
  ["caraballeda", "La Guaira"],
  ["caracas", "Distrito Capital"],
  ["la guaira", "La Guaira"],
  ["los teques", "Miranda"],
  ["guarenas", "Miranda"],
  ["guatire", "Miranda"],
  ["valencia", "Carabobo"],
  ["maracay", "Aragua"],
  ["barquisimeto", "Lara"],
  ["mérida", "Mérida"],
  ["merida", "Mérida"],
  ["cumaná", "Sucre"],
  ["cumana", "Sucre"],
  ["san cristóbal", "Táchira"],
  ["san cristobal", "Táchira"],
  ["maracaibo", "Zulia"],
]);

export function mapDamageLevel(level: string | null | undefined): {
  damageType: DamageType;
  warning?: string;
} {
  if (level === "parcial") return { damageType: "moderate" };
  if (level === "severo") return { damageType: "severe" };
  if (level === "total") return { damageType: "collapse" };
  return {
    damageType: "moderate",
    warning: `Nivel de daño desconocido "${level ?? ""}", usando moderate.`,
  };
}

function cleanText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function normalizeForMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-VE");
}

export function inferState(building: Pick<SourceBuilding, "address" | "city" | "zone">) {
  const haystack = normalizeForMatch(
    [building.address, building.city, building.zone].filter(Boolean).join(" "),
  );
  for (const state of VENEZUELAN_STATES) {
    if (haystack.includes(normalizeForMatch(state))) return state;
  }
  const city = normalizeForMatch(building.city ?? "");
  return CITY_STATE_HINTS.get(city) ?? "No especificado";
}

export function selectImageUrls(building: Pick<SourceBuilding, "main_photo_url" | "media_urls">) {
  const ordered = [
    building.main_photo_url,
    ...(Array.isArray(building.media_urls) ? building.media_urls : []),
  ];
  const unique = ordered.filter((url): url is string => {
    return typeof url === "string" && /^https?:\/\//i.test(url);
  });
  const deduped = [...new Set(unique)];
  return {
    imageUrls: deduped.slice(0, MAX_IMPORT_IMAGES),
    discardedImageCount: Math.max(0, deduped.length - MAX_IMPORT_IMAGES),
  };
}

export function sanitizeDescriptionNotes(notes: string | null | undefined) {
  const sensitivePattern =
    /\b(atrapad|desaparecid|fallecid|herid|victima|víctima|nombre|contacto|telefono|teléfono)\b/i;
  return (notes ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !sensitivePattern.test(line))
    .join("\n")
    .trim();
}

export function buildDescription(building: SourceBuilding, damageType: DamageType) {
  const safeNotes = sanitizeDescriptionNotes(building.notes);
  if (safeNotes.length >= 10) return truncate(safeNotes, 2000);

  const damageLabel: Record<DamageType, string> = {
    cracks: "grietas o fisuras",
    moderate: "daño moderado",
    severe: "daño severo",
    collapse: "colapso o daño crítico",
  };
  const location = [cleanText(building.zone), cleanText(building.city)]
    .filter(Boolean)
    .join(", ");
  return truncate(
    `Reporte importado desde terremotovenezuela.com con ${damageLabel[damageType]}${
      location ? ` en ${location}` : ""
    }. Fuente: ${SOURCE_BASE_URL}/edificio/${building.id}`,
    2000,
  );
}

export function normalizeSourceBuilding(
  building: SourceBuilding,
): NormalizedImportReport | { skipped: true; reason: string; sourceId: string } {
  const warnings: string[] = [];
  const buildingName = truncate(cleanText(building.name) || "Edificio sin nombre", 120);
  const address = truncate(cleanText(building.address), 240);
  const city = truncate(cleanText(building.city) || "No especificado", 120);
  const zone = truncate(cleanText(building.zone), 120);
  const sourceUpdatedAt =
    building.last_updated_at || building.created_at || new Date(0).toISOString();

  if (!building.id) return { skipped: true, reason: "No tiene id fuente.", sourceId: "" };
  if (!address || address.length < 5) {
    return { skipped: true, reason: "No tiene dirección válida.", sourceId: building.id };
  }
  const mapped = mapDamageLevel(building.damage_level);
  if (mapped.warning) warnings.push(mapped.warning);
  const { imageUrls, discardedImageCount } = selectImageUrls(building);
  if (imageUrls.length === 0) {
    return { skipped: true, reason: "No tiene fotos importables.", sourceId: building.id };
  }
  const state = inferState(building);
  if (state === "No especificado") {
    warnings.push("No se pudo inferir estado desde la fuente.");
  }

  return {
    sourceName: SOURCE_NAME,
    sourceId: building.id,
    sourceUrl: `${SOURCE_BASE_URL}/edificio/${building.id}`,
    sourceUpdatedAt,
    buildingName,
    address,
    state,
    city,
    zone,
    latitude: typeof building.lat === "number" ? building.lat : null,
    longitude: typeof building.lng === "number" ? building.lng : null,
    damageType: mapped.damageType,
    description: buildDescription(building, mapped.damageType),
    imageUrls,
    discardedImageCount,
    warnings,
  };
}
