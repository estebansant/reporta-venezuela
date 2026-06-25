const venezuelanStateTranslations = new Map<string, string>([
  ["federal dependencies", "Dependencias Federales"],
  ["federal dependencies of venezuela", "Dependencias Federales"],
]);

const venezuelanCityTranslations = new Map<string, string>();

function translateKnownLocation(
  location: string,
  translations: ReadonlyMap<string, string>,
) {
  return translations.get(location.trim().toLocaleLowerCase("es-VE")) ?? location;
}

export function normalizeVenezuelanState(state: string) {
  return translateKnownLocation(state, venezuelanStateTranslations);
}

export function normalizeVenezuelanCity(city: string) {
  return translateKnownLocation(city, venezuelanCityTranslations);
}
