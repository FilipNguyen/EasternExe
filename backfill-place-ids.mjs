// Backfill google_place_id for places in a trip that were saved without one
// (from the ingest path) so the rich PlaceCard photos + ratings + editorial
// summary start rendering.
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs
  .readFileSync(".env.local", "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((a, l) => {
    const i = l.indexOf("=");
    if (i > 0) a[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    return a;
  }, {});

const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const TRIP_ID = process.argv[2];
if (!TRIP_ID) {
  console.error("Usage: node backfill-place-ids.mjs <tripId>");
  process.exit(1);
}
const KEY = env.GOOGLE_PLACES_API_KEY;

const { data: trip } = await sb
  .from("trips")
  .select("destination")
  .eq("id", TRIP_ID)
  .single();
const dest = trip?.destination ?? "";

const { data: missing } = await sb
  .from("places")
  .select("id,name,lat,lng")
  .eq("trip_id", TRIP_ID)
  .is("google_place_id", null);
console.log(`Missing place_id: ${missing?.length ?? 0}`);

async function findId(name, lat, lng) {
  const body = {
    textQuery: `${name} ${dest}`,
    maxResultCount: 1,
    languageCode: "en",
  };
  // Bias by circle near the stored lat/lng if we have them
  if (typeof lat === "number" && typeof lng === "number") {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 3000 },
    };
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const top = json.places?.[0];
  return top
    ? {
        id: top.id,
        lat: top.location?.latitude,
        lng: top.location?.longitude,
      }
    : null;
}

let updated = 0;
let failed = 0;
for (const p of missing ?? []) {
  process.stdout.write(`  ${p.name.slice(0, 40)}… `);
  const hit = await findId(p.name, p.lat, p.lng);
  if (!hit?.id) {
    console.log("❌");
    failed++;
    continue;
  }
  const patch = { google_place_id: hit.id };
  // If current row had no coords, fill them in too
  if (p.lat == null && hit.lat != null) patch.lat = hit.lat;
  if (p.lng == null && hit.lng != null) patch.lng = hit.lng;
  const { error } = await sb.from("places").update(patch).eq("id", p.id);
  if (error) {
    console.log("db error:", error.message);
    failed++;
  } else {
    console.log(`✓ ${hit.id.slice(0, 18)}…`);
    updated++;
  }
  await new Promise((r) => setTimeout(r, 120));
}

console.log(`\nUpdated ${updated}, failed ${failed}`);
