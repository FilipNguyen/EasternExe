// Hand-craft rich demo data for the London trip so the dashboard has content
// in every tab (Brain, Plan, Places, To-do, Travel) without needing Z.ai.
//
// Usage:
//   node debug-seed-london.mjs <tripId>
//
// Reads SUPABASE_URL + SERVICE_ROLE_KEY from .env.local. Idempotent: wipes
// only the fixture's previously-inserted places (source='ingest') before
// re-inserting.
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
  console.error("Usage: node debug-seed-london.mjs <tripId>");
  process.exit(1);
}

const { data: participants } = await sb
  .from("participants")
  .select("id,display_name")
  .eq("trip_id", TRIP);
const byName = {};
for (const p of participants ?? []) byName[p.display_name.toLowerCase()] = p.id;

console.log("Participants found:", Object.keys(byName));

// 1. trip_memory — reflects London planning from the chat fixture
await sb.from("trip_memory").upsert(
  {
    trip_id: TRIP,
    destination: "London, United Kingdom",
    constraints: [
      "Arkady is pescatarian — no red meat, no poultry (fish + dairy + eggs ok)",
      "Arkady is mildly lactose-sensitive — can take a pill if needed",
      "Filip doesn't drink beer (wine, cocktails, whisky are fine)",
      "Budget: average dinner under £40pp except one splurge (~£100pp)",
      "Trip dates: April 14–21, 2026 (7 nights)",
      "Airbnb in Shoreditch/Spitalfields border — £1,900–2,200 for 7 nights",
    ],
    group_preferences: [
      "Mid-range dinners with one proper splurge night",
      "Shared breakfast ~2 mornings for comparing notes, otherwise flexible",
      "Walkable routes over tube-hopping",
      "Markets + cultural days alongside food",
      "Big group dinners on arrival, Thu, Fri, Mon — rest is negotiable",
    ],
    priorities: [
      "Great food every day — main draw of the trip",
      "At least one dumpling per day (Mike's mission)",
      "Do sunday roast properly + at least one traditional London pie-and-mash",
      "Fit in laksa, BBH pho, fez mangal lamb, gravy burger, ube matcha",
      "Keep sustainable energy — no packed days",
    ],
    tensions: [
      "Mike wants unlimited-sushi / unlimited-ribs spots; Arkady is pescatarian and wary of buffets",
      "Mike wants afternoon tea; Arkady won't do £80pp tier",
      "Filip doesn't drink beer — pub crawl compromise needed",
    ],
    decisions_made: [
      "Flights: Filip LO281 Warsaw → LHR (10:45am), Arkady OK881 Prague → LHR (11:15am), Mike BA from Edinburgh (3:05pm) — all April 14",
      "Airbnb booked: Shoreditch/Spitalfields border, 2br 2ba, 7 nights",
      "LPM La Petite Maison booked for Friday April 17, 7:30pm, 3 people (splurge night)",
      "No. Fifty Cheyne booked for Sunday April 19, 1:30pm, 2 pax (Arkady opts out)",
      "Ognisko Restaurant booked (Polish)",
      "Bar Douro London Bridge booked for Thursday 7pm, now 4 pax with Mike's +1",
      "Pot and Rice + Rasa Sayang booked (Filip)",
      "Sunny Spot booked Monday 7pm",
      "Fez Mangal is walk-in only",
      "Monohon Ramen walk-in only — fitted into Saturday lunch",
      "Columbia Road Flower Market on Sunday morning, then split for roast",
      "Contactless Apple Pay on the tube (no physical Oyster)",
      "Wednesday night = light, quiet airbnb evening with wine after pub crawl",
      "V&A + Tate Modern Thursday morning before Khao Gaeng lunch at Borough",
      "Mike's partner joining for Wed + Thu nights",
    ],
    open_questions: [
      "Find a legit fish-and-chips pub for Arkady-friendly pub night",
      "Afternoon tea slot — Monday afternoon between Baba Tang and Rasa Sayang?",
      "Which Vietnamese place wins the non-Caphe-House slot?",
      "Is 'unlimited sushi' a real place or a myth?",
      "Decide between Mestizo Chelsea cocktails vs Golden State on Saturday",
      "Gaya Korean omakase £13 — lunch flex day TBD",
      "Borrow UK adapter from Arkady or pack one?",
    ],
    updated_at: new Date().toISOString(),
  },
  { onConflict: "trip_id" }
);

// 2. participant_profiles — from the chat's food preferences check-in
const profiles = [
  {
    participant_id: byName["filip"],
    personality:
      "Curious, weird-food enthusiast, loves slow-cooked braises and natural wine. Doesn't drink beer. Mission: one Michelin-style splurge plus lots of weird gems.",
    interests: ["offal", "game meat", "natural wine", "whisky", "funky cheeses", "walking the city"],
    budget_style: "mid-range with one splurge",
    travel_style: "wander, follow the food, late-night-friendly",
    food_preferences: [
      "offal",
      "slow-cooked braises",
      "pie and mash",
      "Portuguese small plates",
      "Sunday roast",
      "Southeast Asian (laksa, BBH pho, banh mi)",
      "turkish mangal lamb",
      "gravy burger",
    ],
    dislikes: ["beer", "3.9-star buffets", "planned every-meal schedules"],
    dealbreakers: ["beer-only pubs"],
    open_questions: [
      "Which fish-and-chips pub is actually good?",
      "Can I convert Arkady to a pub with portuguese food?",
    ],
  },
  {
    participant_id: byName["arkady"],
    personality:
      "Pescatarian planner, mildly lactose-sensitive, prefers quiet evenings and at least one night of AirBnB-with-wine. Flower-market sentimentalist.",
    interests: [
      "sea bass",
      "tuna tartare",
      "ube ensaymada",
      "columbia road flowers",
      "V&A museum",
      "cocktail bars with mezcal",
    ],
    budget_style: "conservative, average dinner under £40pp",
    travel_style: "steady, some alone-time nights, values planning",
    food_preferences: [
      "fish",
      "lebanese (fez mangal, logma, oummi)",
      "polish (ognisko)",
      "malaysian (rasa sayang laksa, med salleh)",
      "filipino bakery (panadera)",
      "vegetarian options (vegivores)",
      "ube matcha",
    ],
    dislikes: [
      "all-you-can-eat meat buffets",
      "claridge's-tier afternoon tea (£80pp)",
      "tasting menus (scam)",
      "dense cheese dishes",
    ],
    dealbreakers: [
      "red meat",
      "poultry",
      "very heavy-dairy dishes (without notice)",
    ],
    open_questions: [
      "Which night becomes the quiet airbnb wine night?",
      "Vegivores or lighter pescatarian alt for Sunday roast day?",
    ],
  },
  {
    participant_id: byName["mike"],
    personality:
      "Self-appointed food lead with a colossal research doc. Spice-head, loves Southeast Asian, obsessed with a dumpling-a-day mission. Brings a partner for 2 nights mid-trip.",
    interests: [
      "korean bbq",
      "peruvian (next trip)",
      "chongqing noodles",
      "hand-pulled dumplings",
      "mezcal",
      "tiktok food research",
      "live jazz",
    ],
    budget_style: "mid-range with strategic splurges (LPM)",
    travel_style: "researcher, shares doc, iterates itinerary constantly",
    food_preferences: [
      "ramen (monohon)",
      "malaysian laksa",
      "vietnamese bbh",
      "thai khao gaeng (spicy)",
      "gravy burger",
      "peanut butter cheung fun",
      "korean omakase",
      "churrascaria picanha",
    ],
    dislikes: [
      "places rated under 4.0",
      "places in Wokingham (not a London pick)",
      "restaurants 4.9+ with only 50 reviews (unverified)",
    ],
    dealbreakers: [],
    open_questions: [
      "Is the 'unlimited sushi' place real?",
      "SANSHUN buffet — can we still stand by Saturday?",
      "Which Vietnamese place wins the second slot?",
    ],
  },
].filter((p) => p.participant_id);

for (const p of profiles) {
  await sb
    .from("participant_profiles")
    .upsert({ ...p, updated_at: new Date().toISOString() }, { onConflict: "participant_id" });
}

// 3. places — ~20 London spots from the chat, hand-geocoded (approximate lat/lng
//    for familiar central London locations). added_by set from context where
//    a participant clearly championed the place.
const places = [
  // Southeast Asian
  {
    name: "Rasa Sayang",
    category: "food",
    lat: 51.5130,
    lng: -0.1298,
    notes: "Malaysian (4.5★, 5,891 reviews). Laksa is legendary. Final-dinner pick for Mon.",
    time_of_day: "evening",
    added_by: byName["mike"] ?? null,
  },
  {
    name: "Caphe House",
    category: "food",
    lat: 51.5177,
    lng: -0.0991,
    notes: "Vietnamese. Rare BBH (bun bo hue) in London. Arrival-night dinner Tue.",
    time_of_day: "evening",
    added_by: byName["mike"] ?? null,
  },
  {
    name: "Plaza Khao Gaeng",
    category: "food",
    lat: 51.5048,
    lng: -0.0908,
    notes: "Southern Thai (4.9★). Borough Yards — spicy khao gaeng. Thursday lunch.",
    time_of_day: "afternoon",
    added_by: byName["filip"] ?? null,
  },
  {
    name: "Monohon Ramen",
    category: "food",
    lat: 51.5173,
    lng: -0.0775,
    notes: "Tonkotsu-style (4.6★, 1,900+). Walk-in only. Saturday lunch replacing tacos.",
    time_of_day: "afternoon",
    added_by: byName["mike"] ?? null,
  },
  // Splurge + French
  {
    name: "La Petite Maison",
    category: "food",
    lat: 51.5156,
    lng: -0.1474,
    notes: "LPM Mayfair. 4.4★, £100+. Splurge night. BOOKED Fri Apr 17, 7:30pm, 3 pax.",
    time_of_day: "evening",
    added_by: byName["arkady"] ?? null,
  },
  // Portuguese / Pubs / Roast
  {
    name: "Bar Douro London Bridge",
    category: "food",
    lat: 51.5058,
    lng: -0.0879,
    notes: "Portuguese small plates (4.7★). BOOKED Thu Apr 16, 7pm, 4 pax.",
    time_of_day: "evening",
    added_by: byName["filip"] ?? null,
  },
  {
    name: "No. Fifty Cheyne",
    category: "food",
    lat: 51.4826,
    lng: -0.1716,
    notes: "Classic Chelsea Sunday roast. BOOKED Sun Apr 19, 1:30pm, 2 pax (Arkady opts out).",
    time_of_day: "afternoon",
    added_by: byName["filip"] ?? null,
  },
  {
    name: "The Macbeth",
    category: "drinks",
    lat: 51.5335,
    lng: -0.0763,
    notes: "Hoxton pub that serves Portuguese food. 4.4★. Good pub night.",
    time_of_day: "evening",
    added_by: byName["filip"] ?? null,
  },
  // East London
  {
    name: "Maureen's Pie & Mash",
    category: "food",
    lat: 51.5445,
    lng: -0.0552,
    notes: "Traditional east-London pie & mash (4.8★, £1–10). Wed dinner before pub crawl.",
    time_of_day: "evening",
    added_by: byName["filip"] ?? null,
  },
  {
    name: "Utea Spitalfields",
    category: "food",
    lat: 51.5196,
    lng: -0.0756,
    notes: "Banh mi + boba (4.9★, £1–10). Wed lunch.",
    time_of_day: "afternoon",
    added_by: byName["mike"] ?? null,
  },
  {
    name: "The Black Eel",
    category: "food",
    lat: 51.5249,
    lng: -0.0717,
    notes: "Bagel shop (4.6★) near Columbia Road. Sunday-market breakfast.",
    time_of_day: "morning",
    added_by: byName["mike"] ?? null,
  },
  // Turkish / Lebanese
  {
    name: "Fez Mangal",
    category: "food",
    lat: 51.5147,
    lng: -0.2083,
    notes: "Turkish mangal (Ladbroke Grove). Walk-in only. Saturday dinner — lamb!",
    time_of_day: "evening",
    added_by: byName["filip"] ?? null,
  },
  {
    name: "Oummi Bon Appetit",
    category: "food",
    lat: 51.5196,
    lng: -0.1358,
    notes: "Lebanese (4.8★, 1,392 reviews). Backup if Fez Mangal is slammed.",
    time_of_day: "evening",
    added_by: byName["arkady"] ?? null,
  },
  {
    name: "Logma",
    category: "food",
    lat: 51.5173,
    lng: -0.1432,
    notes: "Khaleeji middle-eastern (4.9★). Flex lunch.",
    time_of_day: "afternoon",
    added_by: byName["mike"] ?? null,
  },
  // Markets / Cafes / Breakfast
  {
    name: "Borough Market",
    category: "food",
    lat: 51.5053,
    lng: -0.0906,
    notes: "THE market. Thursday combined with V&A + Tate + Khao Gaeng lunch.",
    time_of_day: "afternoon",
    added_by: byName["arkady"] ?? null,
  },
  {
    name: "Portobello Road Market",
    category: "shopping",
    lat: 51.5154,
    lng: -0.2063,
    notes: "Saturday morning chaos. Authentic Notting Hill market experience.",
    time_of_day: "morning",
    added_by: byName["filip"] ?? null,
  },
  {
    name: "Columbia Road Flower Market",
    category: "shopping",
    lat: 51.5295,
    lng: -0.0679,
    notes: "Sunday morning. Arkady's mom asked specifically for flower photos.",
    time_of_day: "morning",
    added_by: byName["arkady"] ?? null,
  },
  {
    name: "Shed",
    category: "food",
    lat: 51.5095,
    lng: -0.2015,
    notes: "Cafe (4.8★, £10–20). Morning default — light + solid.",
    time_of_day: "morning",
    added_by: byName["mike"] ?? null,
  },
  {
    name: "BLK CAB Coffee",
    category: "food",
    lat: 51.5168,
    lng: -0.1519,
    notes: "Marylebone coffee shop. UBE MATCHA (Arkady's must-try).",
    time_of_day: "morning",
    added_by: byName["arkady"] ?? null,
  },
  {
    name: "Imma The Bakery",
    category: "food",
    lat: 51.5231,
    lng: -0.0703,
    notes: "Bakery (4.9★, £1–10). Last-day pastries-to-go Tue Apr 21.",
    time_of_day: "morning",
    added_by: byName["mike"] ?? null,
  },
  {
    name: "Panadera Soho",
    category: "food",
    lat: 51.5138,
    lng: -0.1350,
    notes: "Filipino bakery. Ube ensaymada for Arkady. Saturday post-market lunch.",
    time_of_day: "afternoon",
    added_by: byName["arkady"] ?? null,
  },
  // Chinese / dumplings
  {
    name: "Baba Tang",
    category: "food",
    lat: 51.5151,
    lng: -0.1317,
    notes: "Cantonese (4.5★, £20–30). Hand-pulled dumplings — Mike's Mon lunch.",
    time_of_day: "afternoon",
    added_by: byName["mike"] ?? null,
  },
  {
    name: "Pot and Rice",
    category: "food",
    lat: 51.5131,
    lng: -0.1299,
    notes: "4.6★, 1,637 reviews. Peanut butter cheung fun + clay pot rice. Sun dinner.",
    time_of_day: "evening",
    added_by: byName["mike"] ?? null,
  },
  // Burgers / Bars / Nightlife
  {
    name: "Burger and Beyond Soho",
    category: "food",
    lat: 51.5135,
    lng: -0.1356,
    notes: "Gravy burger. 4.4★, 2,487 reviews. Flex lunch.",
    time_of_day: "afternoon",
    added_by: byName["filip"] ?? null,
  },
  {
    name: "Golden State",
    category: "drinks",
    lat: 51.5241,
    lng: -0.0854,
    notes: "Cocktail bar (4.9★). Small, intimate. Saturday post-dinner.",
    time_of_day: "night",
    added_by: byName["arkady"] ?? null,
  },
  {
    name: "Jassmine",
    category: "nightlife",
    lat: 51.5211,
    lng: -0.1290,
    notes: "Jazz bar. Mike's live-music pick for one night.",
    time_of_day: "night",
    added_by: byName["mike"] ?? null,
  },
  // Museums / Cultural
  {
    name: "V&A Museum",
    category: "sight",
    lat: 51.4966,
    lng: -0.1721,
    notes: "Thursday morning museum slot. Arkady's top cultural ask.",
    time_of_day: "morning",
    added_by: byName["arkady"] ?? null,
  },
  {
    name: "Tate Modern",
    category: "sight",
    lat: 51.5076,
    lng: -0.0993,
    notes: "Thursday midday — flows into Borough + Khao Gaeng.",
    time_of_day: "afternoon",
    added_by: byName["arkady"] ?? null,
  },
  // Japanese + Korean
  {
    name: "Sunny Spot",
    category: "food",
    lat: 51.5087,
    lng: -0.1383,
    notes: "Tiny Japanese (4.9★). Phone reservation — Mon 7pm.",
    time_of_day: "evening",
    added_by: byName["filip"] ?? null,
  },
  {
    name: "Gaya Korean",
    category: "food",
    lat: 51.5127,
    lng: -0.0878,
    notes: "Korean omakase for £13 (5-piece set). Flex lunch candidate.",
    time_of_day: "afternoon",
    added_by: byName["filip"] ?? null,
  },
];

// Wipe old fixture places for idempotence then insert fresh
await sb.from("places").delete().eq("trip_id", TRIP).eq("source", "ingest");
const toInsert = places.map((p) => ({
  ...p,
  trip_id: TRIP,
  source: "ingest",
  added_by_agent: false,
}));
const { error: placesErr } = await sb.from("places").insert(toInsert);
if (placesErr) console.error("places insert:", placesErr.message);

console.log("✅ Fixture data seeded for", TRIP);
console.log("- trip_memory: constraints/prefs/priorities/tensions/decisions/open_questions filled");
console.log("- participant_profiles:", profiles.length);
console.log("- places:", toInsert.length);
