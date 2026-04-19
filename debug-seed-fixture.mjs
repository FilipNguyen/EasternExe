// Hand-craft rich demo data into trip_memory + participant_profiles + places
// so the knowledge graph has something to show while Z.ai is rate-limited.
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

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TRIP = process.argv[2];
if (!TRIP) {
  console.error("Usage: node debug-seed-fixture.mjs <tripId>");
  process.exit(1);
}

const { data: participants } = await sb
  .from("participants")
  .select("id,display_name")
  .eq("trip_id", TRIP);
const byName = {};
for (const p of participants ?? []) byName[p.display_name.toLowerCase()] = p.id;

// 1. trip_memory — reflects Tokyo planning
await sb.from("trip_memory").upsert(
  {
    trip_id: TRIP,
    destination: "Tokyo, Japan",
    constraints: [
      "Filip won't eat raw tuna or salmon",
      "Kenji has a peanut allergy",
      "Budget: roughly ¥15,000/day per person for meals",
      "Taro arrives 2 days before the group",
      "Trip dates: April 18–25, 2026 (8 nights)",
    ],
    group_preferences: [
      "Mix of food-focused days and cultural days",
      "At least one hot spring / onsen experience",
      "Walkable neighborhoods over taxi hopping",
      "Small authentic spots over tourist traps",
      "Some nightlife but not every night",
    ],
    priorities: [
      "Great food every day — this is the main draw",
      "Experience traditional + modern contrasts",
      "Keep everyone's energy sustainable (no packed days)",
    ],
    tensions: [
      "Filip wants Michelin splurges; Kenji prefers casual izakaya",
      "Taro wants early starts; Filip sleeps in",
    ],
    decisions_made: [
      "Staying at Park Hyatt Shinjuku (4 nights) + ryokan in Hakone (2 nights)",
      "Booked ANA flights NRT arrival April 18, HND departure April 25",
      "Day trip to Hakone confirmed for April 22",
      "Team Lab Planets tickets reserved for April 20 evening",
      "Tsukiji market breakfast first morning",
    ],
    open_questions: [
      "Which day to do the hot spring — Hakone or day trip to Kusatsu?",
      "Dinner April 23: Sushi Yuu omakase or Gyukatsu Motomura?",
      "Rent pocket wifi or eSIMs?",
      "Should we pre-book Shibuya Sky sunset slot?",
    ],
    updated_at: new Date().toISOString(),
  },
  { onConflict: "trip_id" }
);

// 2. participant_profiles — rich personality data
const profiles = [
  {
    participant_id: byName["filip"],
    personality:
      "Photography-obsessed foodie, night owl, curious about weird niche cultural stuff.",
    interests: ["street photography", "ramen", "jazz bars", "retro gaming"],
    budget_style: "mid-to-splurge on food, economy otherwise",
    travel_style: "wander and discover, hates rigid schedules",
    food_preferences: ["ramen", "izakaya", "tonkatsu", "Italian", "coffee"],
    dislikes: ["tourist-trap sushi", "crowded conveyor-belt places"],
    dealbreakers: ["raw tuna", "raw salmon", "overly crowded venues"],
    open_questions: ["Which jazz bars are actually good?"],
  },
  {
    participant_id: byName["taro"],
    personality:
      "Organized planner, early riser, historian at heart. Prefers cultural depth to nightlife.",
    interests: ["history", "architecture", "temples", "calligraphy"],
    budget_style: "frugal on food, will splurge on experiences",
    travel_style: "methodical, builds detailed itineraries",
    food_preferences: ["soba", "kaiseki", "vegetarian options", "tea houses"],
    dislikes: ["late-night bars", "chain restaurants"],
    dealbreakers: [],
    open_questions: [
      "Can we get into Kotosaga tea ceremony?",
      "Is Meiji Jingu worth a half day?",
    ],
  },
  {
    participant_id: byName["kenji"],
    personality:
      "Easy-going, extrovert, loves meeting locals. Peanut allergy is real and serious.",
    interests: ["craft beer", "sumo", "anime", "arcades"],
    budget_style: "mid-range, values per-yen",
    travel_style: "go with the flow",
    food_preferences: ["yakitori", "gyoza", "craft IPA", "curry"],
    dislikes: ["slow sit-down meals", "formal dress codes"],
    dealbreakers: ["peanuts (severe allergy)", "anything fried in peanut oil"],
    open_questions: ["Any good sumo viewing in April?"],
  },
].filter((p) => p.participant_id);

for (const p of profiles) {
  await sb
    .from("participant_profiles")
    .upsert({ ...p, updated_at: new Date().toISOString() }, { onConflict: "participant_id" });
}

// 3. places — a handful of geocoded Tokyo spots with assigned owners
const places = [
  {
    name: "Meiji Jingu",
    category: "sight",
    lat: 35.6764,
    lng: 139.6993,
    notes: "Shinto shrine in Yoyogi. Perfect morning spot; early = no crowds.",
    time_of_day: "morning",
    added_by: byName["taro"] ?? null,
    source: "ingest",
  },
  {
    name: "Tsukiji Outer Market",
    category: "food",
    lat: 35.6657,
    lng: 139.7701,
    notes: "Breakfast first morning. Tamagoyaki + uni on toast.",
    time_of_day: "morning",
    added_by: byName["filip"] ?? null,
    source: "ingest",
  },
  {
    name: "Gyukatsu Motomura Shibuya",
    category: "food",
    lat: 35.6598,
    lng: 139.7006,
    notes: "Ultra-popular beef cutlet spot. 4.8★ (14k reviews). Kenji's top pick.",
    time_of_day: "evening",
    added_by: byName["kenji"] ?? null,
    source: "ingest",
  },
  {
    name: "Sushi Yuu",
    category: "food",
    lat: 35.6581,
    lng: 139.7249,
    notes: "High-end omakase in Nishiazabu. Counter only. Filip excluded (allergy).",
    time_of_day: "evening",
    added_by: byName["taro"] ?? null,
    source: "ingest",
  },
  {
    name: "L'Effervescence",
    category: "food",
    lat: 35.6665,
    lng: 139.7217,
    notes: "2 Michelin star French-Japanese fusion. Splurge dinner, reserved Apr 24.",
    time_of_day: "evening",
    added_by: byName["filip"] ?? null,
    source: "ingest",
  },
  {
    name: "Shinjuku Gyoen National Garden",
    category: "nature",
    lat: 35.6852,
    lng: 139.71,
    notes: "Top sakura spot. Cherry blossoms should still be in bloom mid-April.",
    time_of_day: "afternoon",
    added_by: byName["taro"] ?? null,
    source: "ingest",
  },
  {
    name: "Golden Gai",
    category: "nightlife",
    lat: 35.6938,
    lng: 139.7045,
    notes: "6 alleys, 200 tiny bars. Late-night. Kenji's night.",
    time_of_day: "night",
    added_by: byName["kenji"] ?? null,
    source: "ingest",
  },
  {
    name: "Team Lab Planets",
    category: "sight",
    lat: 35.6497,
    lng: 139.7913,
    notes: "Immersive digital art. Tickets booked for April 20, 18:30.",
    time_of_day: "evening",
    added_by: byName["filip"] ?? null,
    source: "ingest",
  },
  {
    name: "Blue Note Tokyo",
    category: "nightlife",
    lat: 35.6614,
    lng: 139.7181,
    notes: "Jazz club. Check lineup closer to trip.",
    time_of_day: "night",
    added_by: byName["filip"] ?? null,
    source: "ingest",
  },
  {
    name: "Hakone Yuryo",
    category: "nature",
    lat: 35.2373,
    lng: 139.0502,
    notes: "Onsen day trip option. April 22 confirmed.",
    time_of_day: "afternoon",
    added_by: byName["taro"] ?? null,
    source: "ingest",
  },
  {
    name: "Shibuya Sky",
    category: "sight",
    lat: 35.6586,
    lng: 139.7022,
    notes: "Open-air rooftop at sunset. Pre-book recommended.",
    time_of_day: "evening",
    added_by: byName["kenji"] ?? null,
    source: "ingest",
  },
  {
    name: "Afuri Ebisu",
    category: "food",
    lat: 35.6458,
    lng: 139.7106,
    notes: "Yuzu shio ramen. Filip's ramen pilgrimage stop #1.",
    time_of_day: "afternoon",
    added_by: byName["filip"] ?? null,
    source: "ingest",
  },
];

// Wipe old fixture places for idempotence then insert fresh
await sb.from("places").delete().eq("trip_id", TRIP).eq("source", "ingest");
const toInsert = places.map((p) => ({ ...p, trip_id: TRIP, added_by_agent: false }));
const { error: placesErr } = await sb.from("places").insert(toInsert);
if (placesErr) console.error("places insert:", placesErr.message);

console.log("Fixture data seeded for", TRIP);
console.log("- trip_memory: 7 arrays filled");
console.log("- participant_profiles:", profiles.length);
console.log("- places:", toInsert.length);
