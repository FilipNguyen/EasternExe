// One-off: parse a big pasted list of place names + notes and save each to
// a trip via Google Places Text Search.
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

const TRIP_ID = "0e352b2e-5b20-4da6-9152-d1534a30dcd1";
const GOOGLE_KEY = env.GOOGLE_PLACES_API_KEY;
const BIAS_LOCATION = "London, UK";

const RAW = fs.readFileSync("bulk-places-input.txt", "utf8");

// --- parser -----------------------------------------------------------
// Entries are separated by blank line(s). Within a block:
//   line 1           = name
//   optional rating  = matches /^\d\.\d\(/
//   optional price   = contains £|$|₫|₩|€ or "££" etc.
//   optional category = starts with "· "
//   remaining line   = note (unless literal "Note")
const rawBlocks = RAW.split(/\n\s*\n/)
  .map((b) => b.trim())
  .filter((b) => b.length > 0);

const entries = [];
for (const block of rawBlocks) {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) continue;
  const name = lines[0];
  let rating = null;
  let category = null;
  const noteLines = [];
  for (const line of lines.slice(1)) {
    if (/^\d\.\d\s*\(/.test(line)) continue; // rating
    if (/^[£$₫₩€]/.test(line) || line === "££" || line === "£££") continue; // price
    if (line.startsWith("· ")) {
      category = line.slice(2).trim();
      continue;
    }
    if (line === "Note") continue; // placeholder
    // Otherwise it's an actual note
    noteLines.push(line);
  }
  const note = noteLines.join(" • ").slice(0, 400) || null;
  entries.push({ name, category, note });
}

console.log(`Parsed ${entries.length} entries`);

// --- category mapping ------------------------------------------------
function mapCategory(raw, note) {
  if (!raw && !note) return "food";
  const t = `${raw ?? ""} ${note ?? ""}`.toLowerCase();
  if (/\bbar(\b|ber)|cocktail|pub|wine|beer|jazz bar|nightlife/.test(t) &&
      !/sandwich|bakery|fast food/.test(t)) {
    if (/barber/.test(t)) return "other";
    return /cocktail|nightlife|pub/.test(t) ? "nightlife" : "drinks";
  }
  if (/coffee|tea|ice cream|matcha|boba/.test(t)) return "drinks";
  if (/park|garden|nature/.test(t)) return "nature";
  if (/shop|shopping|mall|supermarket/.test(t)) return "shopping";
  if (/barber|salon|spa/.test(t)) return "other";
  // default to food — most entries are restaurants / cafes / bakeries
  return "food";
}

// --- google places text search ---------------------------------------
async function geocode(name) {
  const body = {
    textQuery: `${name} ${BIAS_LOCATION}`,
    maxResultCount: 1,
    languageCode: "en",
  };
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.primaryTypeDisplayName",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn(`  [${res.status}] Places search failed for ${name}`);
    return null;
  }
  const json = await res.json();
  const top = json.places?.[0];
  if (!top) return null;
  return {
    google_place_id: top.id,
    lat: top.location?.latitude,
    lng: top.location?.longitude,
    resolved_name: top.displayName?.text,
    primary_type: top.primaryTypeDisplayName?.text,
  };
}

// --- existing places (de-dupe by name lowercase) ---------------------
const { data: existing } = await sb
  .from("places")
  .select("id,name")
  .eq("trip_id", TRIP_ID);
const haveByName = new Set(
  (existing ?? []).map((p) => p.name.toLowerCase().trim())
);
console.log(`Already in trip: ${haveByName.size} places`);

// --- main loop --------------------------------------------------------
let inserted = 0;
let skipped = 0;
let failed = 0;
const toInsert = [];
for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  const key = e.name.toLowerCase().trim();
  if (haveByName.has(key)) {
    skipped++;
    continue;
  }
  process.stdout.write(`[${i + 1}/${entries.length}] ${e.name.slice(0, 40)}… `);
  const geo = await geocode(e.name);
  if (!geo) {
    console.log("❌ no result");
    failed++;
    continue;
  }
  const category = mapCategory(e.category, e.note);
  toInsert.push({
    trip_id: TRIP_ID,
    name: geo.resolved_name || e.name,
    lat: geo.lat,
    lng: geo.lng,
    google_place_id: geo.google_place_id,
    category,
    status: "saved",
    added_by_agent: false,
    notes: e.note,
    source: "manual",
    time_of_day: "any",
  });
  haveByName.add(key);
  console.log(`✓ ${geo.lat?.toFixed(3)}, ${geo.lng?.toFixed(3)} · ${category}`);
  // Gentle pacing
  await new Promise((r) => setTimeout(r, 120));
}

// --- insert in batches of 20 -----------------------------------------
for (let i = 0; i < toInsert.length; i += 20) {
  const batch = toInsert.slice(i, i + 20);
  const { error } = await sb.from("places").insert(batch);
  if (error) {
    console.error(`batch ${i} insert failed:`, error.message);
  } else {
    inserted += batch.length;
  }
}

console.log(`\nDONE.`);
console.log(`Inserted:  ${inserted}`);
console.log(`Skipped:   ${skipped} (already in trip)`);
console.log(`Failed:    ${failed} (not found in Places)`);
