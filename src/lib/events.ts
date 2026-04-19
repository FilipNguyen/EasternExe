import "server-only";

import { braveSearch } from "@/lib/brave";

export interface EventResult {
  name: string;
  lat: number | null;
  lng: number | null;
  description: string;
  url: string | null;
  dates: string | null;
  category: string;
  thumbnail_url?: string;
  source_host?: string;
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const OVERPASS_QUERY = `
[out:json][timeout:25];
(
  node["amenity"="theatre"](around:RADIUS,LAT,LNG);
  node["amenity"="events_venue"](around:RADIUS,LAT,LNG);
  node["amenity"="concert_hall"](around:RADIUS,LAT,LNG);
  node["tourism"="museum"](around:RADIUS,LAT,LNG);
  node["leisure"="sports_centre"](around:RADIUS,LAT,LNG);
  way["amenity"="theatre"](around:RADIUS,LAT,LNG);
  way["amenity"="events_venue"](around:RADIUS,LAT,LNG);
  way["amenity"="concert_hall"](around:RADIUS,LAT,LNG);
  way["tourism"="museum"](around:RADIUS,LAT,LNG);
  way["leisure"="sports_centre"](around:RADIUS,LAT,LNG);
);
out center body qt;
`;

export async function queryOverpassEventVenues(
  lat: number,
  lng: number,
  radiusMeters = 5000
): Promise<EventResult[]> {
  const query = OVERPASS_QUERY
    .replace(/LAT/g, String(lat))
    .replace(/LNG/g, String(lng))
    .replace(/RADIUS/g, String(radiusMeters));

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) {
      console.warn(`Overpass error ${res.status}`);
      return [];
    }
    const json = (await res.json()) as {
      elements?: {
        type: string;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }[];
    };

    return (json.elements ?? [])
      .filter((el) => el.tags?.name)
      .map((el) => {
        const elLat = el.lat ?? el.center?.lat ?? null;
        const elLng = el.lon ?? el.center?.lon ?? null;
        const amenity = el.tags?.amenity ?? el.tags?.tourism ?? el.tags?.leisure ?? "other";
        let category = "other";
        if (amenity === "theatre" || amenity === "concert_hall") category = "sight";
        if (amenity === "events_venue" || amenity === "sports_centre") category = "nightlife";
        if (amenity === "museum") category = "sight";

        return {
          name: el.tags!.name!,
          lat: elLat,
          lng: elLng,
          description: el.tags?.description ?? el.tags?.["operator"] ?? "",
          url: el.tags?.website ?? el.tags?.["contact:website"] ?? null,
          dates: null,
          category,
        };
      });
  } catch (e) {
    console.warn("Overpass query failed:", e);
    return [];
  }
}

export async function searchWebEvents(
  destination: string
): Promise<EventResult[]> {
  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const queries = [
    `${destination} events ${monthYear}`,
    `${destination} pop-up ${monthYear}`,
    `${destination} festival ${monthYear}`,
  ];

  const allResults: EventResult[] = [];

  for (const q of queries) {
    const results = await braveSearch(q, 5);
    if (!results) continue;
    for (const r of results) {
      allResults.push({
        name: r.title,
        lat: null,
        lng: null,
        description: r.description,
        url: r.url,
        dates: monthYear,
        category: "other",
        thumbnail_url: r.thumbnail_url,
        source_host: r.source_host,
      });
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return allResults.filter((r) => {
    if (r.url && seen.has(r.url)) return false;
    if (r.url) seen.add(r.url);
    return true;
  });
}
