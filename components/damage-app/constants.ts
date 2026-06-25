import type { Country } from "react-phone-number-input";

import type { DamageType } from "@/lib/report-schema";

export const navItems = [
  ["Mapa", "/"],
  ["Directorio", "/#directorio"],
] as const;

export const damageLabels: Record<DamageType, string> = {
  cracks: "Grietas / fisuras",
  moderate: "Daño moderado",
  severe: "Daño severo",
  collapse: "Colapso",
};

export const venezuelanStates = [
  "Amazonas",
  "Anzoátegui",
  "Apure",
  "Aragua",
  "Barinas",
  "Bolívar",
  "Carabobo",
  "Cojedes",
  "Delta Amacuro",
  "Dependencias Federales",
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

export const contactPhoneCountries: Country[] = [
  "VE",
  "CO",
  "BR",
  "US",
  "TT",
  "DO",
  "MX",
  "PE",
  "CL",
  "AR",
  "PY",
  "BO",
  "EC",
  "AI",
  "AG",
  "AW",
  "BS",
  "BB",
  "BQ",
  "KY",
  "CU",
  "CW",
  "DM",
  "GD",
  "GP",
  "HT",
  "JM",
  "MQ",
  "MS",
  "PR",
  "KN",
  "LC",
  "MF",
  "VC",
  "SX",
  "TC",
  "VG",
  "VI",
];

export const damageGuideItems = [
  {
    level: "1 · Leve",
    title: "Fisuras capilares",
    crackClass: "crack-one",
    copy: "Superficiales y delgadas. Documenta cualquier cambio.",
  },
  {
    level: "2 · Moderado",
    title: "Diagonales en esquinas",
    crackClass: "crack-two",
    copy: "Pueden indicar movimiento. Evita permanecer junto al muro.",
  },
  {
    level: "3 · Severo",
    title: "Horizontales en muros",
    crackClass: "crack-three",
    copy: "Aléjate y solicita una inspección urgente.",
  },
  {
    level: "4 · Crítico",
    title: "Patrón ramificado o X",
    crackClass: "crack-four",
    copy: "Evacúa de inmediato sin recuperar pertenencias.",
  },
] as const;
