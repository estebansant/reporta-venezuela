export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NominatimResult = {
  lat?: string;
  lon?: string;
};

function getSearchParam(url: URL, key: string) {
  return url.searchParams.get(key)?.trim() ?? "";
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function parseCoordinate(value: string | undefined, min: number, max: number) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max
    ? coordinate
    : null;
}

async function searchNominatim(params: URLSearchParams) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "terremoto-venezuela/0.1 (https://terremoto-venezuela.pages.dev)",
      },
    },
  );

  if (!response.ok) {
    throw new Error("No fue posible buscar la dirección en el mapa.");
  }

  return (await response.json()) as NominatimResult[];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = getSearchParam(url, "address");
  const city = getSearchParam(url, "city");
  const state = getSearchParam(url, "state");

  if (address.length < 5 || city.length < 2 || state.length < 2) {
    return badRequest("Dirección, ciudad y estado son obligatorios.");
  }

  const structuredParams = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    countrycodes: "ve",
    addressdetails: "1",
    street: address,
    city,
    state,
    country: "Venezuela",
  });

  const freeformParams = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    countrycodes: "ve",
    addressdetails: "1",
    q: `${address}, ${city}, ${state}, Venezuela`,
  });

  let results: NominatimResult[];
  try {
    results = await searchNominatim(structuredParams);
    if (!results.length) {
      results = await searchNominatim(freeformParams);
    }
  } catch {
    return Response.json(
      { error: "No fue posible buscar la dirección en el mapa." },
      { status: 502 },
    );
  }

  const first = results[0];
  const latitude = parseCoordinate(first?.lat, -90, 90);
  const longitude = parseCoordinate(first?.lon, -180, 180);

  if (latitude === null || longitude === null) {
    return Response.json({ found: false });
  }

  return Response.json({ found: true, latitude, longitude });
}
