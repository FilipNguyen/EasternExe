import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Participant,
  ParticipantProfile,
  Place,
  Trip,
  TripMemory,
} from "@/types/db";
import type { KGNodeKind, KGRelation } from "./types";

/**
 * Deterministic graph builder. No LLM calls. Turns whatever's already in
 * trips/participants/participant_profiles/places/trip_memory into a graph.
 *
 * Stable origin keys mean re-running this is idempotent: the same row in
 * (e.g.) trip_memory.constraints always produces the same node.
 */

interface PendingNode {
  kind: KGNodeKind;
  label: string;
  properties?: Record<string, unknown>;
  importance?: number;
  origin_table: string;
  origin_id: string;
}

interface PendingEdge {
  src_origin: string; // origin_id of src
  dst_origin: string;
  relation: KGRelation;
  weight?: number;
  properties?: Record<string, unknown>;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Fixed topic vocabulary + keyword heuristics. Pick the first topic whose
 * pattern hits; fall back to null (no topic edge) so we don't over-attach.
 */
const TOPICS: {
  id: string;
  label: string;
  pattern: RegExp;
}[] = [
  {
    id: "food",
    label: "Food",
    pattern:
      /\b(food|eat|eating|restaurant|dinner|lunch|breakfast|brunch|ramen|sushi|pho|banh|laksa|dumpling|bbq|burger|pizza|bakery|pastry|dim sum|cuisine|chef|menu|michelin|omakase|pie|mash|curry|noodle|taco|buffet|dish|meal|kitchen)\b/i,
  },
  {
    id: "drinks",
    label: "Drinks & Bars",
    pattern:
      /\b(drink|drinks|cocktail|wine|whisky|whiskey|bar\b|beer|pint|pub|ale|lager|cider|mezcal|gin|vodka|bourbon|natural wine|sommelier)\b/i,
  },
  {
    id: "nightlife",
    label: "Nightlife",
    pattern:
      /\b(nightlife|club|jazz|live music|dj|late-night|night out|dancing|karaoke)\b/i,
  },
  {
    id: "sight",
    label: "Sights & Culture",
    pattern:
      /\b(sight|museum|gallery|art|exhibit|cultural|history|historic|temple|shrine|palace|castle|tower|cathedral|architecture|landmark|viewpoint|v&a|tate|british museum)\b/i,
  },
  {
    id: "shopping",
    label: "Shopping",
    pattern:
      /\b(shop|shopping|market|boutique|store|souvenir|vintage|flea|flower market|outlet)\b/i,
  },
  {
    id: "nature",
    label: "Nature & Outdoors",
    pattern:
      /\b(park|garden|nature|hike|trail|walk|river|waterfront|beach|outdoor|green|forest)\b/i,
  },
  {
    id: "logistics",
    label: "Travel & Logistics",
    pattern:
      /\b(flight|airline|airport|airbnb|hotel|room|check-in|check in|taxi|tube|train|transfer|pass|adapter|baggage|arrival|departure|landing|transit|contactless|oyster)\b/i,
  },
  {
    id: "schedule",
    label: "Schedule",
    pattern:
      /\b(date|dates|schedule|day|morning|afternoon|evening|night\b|booking|reservation|booked|reserved|slot|time)\b/i,
  },
  {
    id: "budget",
    label: "Budget",
    pattern:
      /\b(budget|£\d|\$\d|cost|price|cheap|expensive|splurge|pp\b|per person|afford|reasonable|mid-range)\b/i,
  },
  {
    id: "dietary",
    label: "Diet & Allergies",
    pattern:
      /\b(allerg|pescatarian|vegetarian|vegan|gluten|lactose|dairy|peanut|shellfish|halal|kosher|dealbreaker|diet)\b/i,
  },
];

function inferTopic(text: string): string | null {
  for (const t of TOPICS) if (t.pattern.test(text)) return t.id;
  return null;
}

function placeCategoryToTopic(category: string | null | undefined): string | null {
  switch (category) {
    case "food":
      return "food";
    case "drinks":
      return "drinks";
    case "nightlife":
      return "nightlife";
    case "sight":
      return "sight";
    case "shopping":
      return "shopping";
    case "nature":
      return "nature";
    default:
      return null;
  }
}

function collectPending(args: {
  trip: Trip;
  participants: Participant[];
  profiles: ParticipantProfile[];
  places: Place[];
  memory: TripMemory | null;
}): { nodes: PendingNode[]; edges: PendingEdge[] } {
  const nodes: PendingNode[] = [];
  const edges: PendingEdge[] = [];
  const topicsUsed = new Set<string>();

  const topicOriginOf = (topicId: string) => `topic:${topicId}`;

  const attachTopic = (
    subjectOrigin: string,
    text: string,
    fallbackTopic?: string | null
  ) => {
    const topic = inferTopic(text) ?? fallbackTopic ?? null;
    if (!topic) return;
    topicsUsed.add(topic);
    edges.push({
      src_origin: subjectOrigin,
      dst_origin: topicOriginOf(topic),
      relation: "ABOUT",
    });
  };

  // 1. Trip hub
  const tripOrigin = `trip:${args.trip.id}`;
  nodes.push({
    kind: "trip",
    label: args.trip.destination ?? args.trip.name,
    properties: {
      name: args.trip.name,
      destination: args.trip.destination,
      start_date: args.trip.start_date,
      end_date: args.trip.end_date,
    },
    importance: 1.0,
    origin_table: "trips",
    origin_id: tripOrigin,
  });

  // 2. Person nodes — kept connected to trip only. No per-person preference
  // nodes; individual likes now flow into topic hubs to avoid per-person
  // clustering in the force layout.
  const profileByParticipant = new Map(
    args.profiles.map((p) => [p.participant_id, p])
  );
  for (const p of args.participants) {
    const profile = profileByParticipant.get(p.id);
    const personOrigin = `person:${p.id}`;
    nodes.push({
      kind: "person",
      label: p.display_name,
      properties: {
        color: p.color,
        personality: profile?.personality ?? null,
        budget_style: profile?.budget_style ?? null,
        travel_style: profile?.travel_style ?? null,
      },
      importance: 0.9,
      origin_table: "participants",
      origin_id: personOrigin,
    });
    edges.push({
      src_origin: personOrigin,
      dst_origin: tripOrigin,
      relation: "PART_OF",
    });

    // Dealbreakers still produce constraint nodes, but attach to the dietary
    // topic rather than to the person individually — keeps the graph honest
    // about hard constraints without per-person gravity wells.
    for (const db of profile?.dealbreakers ?? []) {
      const cOrigin = `constraint:${slug(db)}`;
      nodes.push({
        kind: "constraint",
        label: db,
        properties: { source: "dealbreaker", owner: p.display_name },
        importance: 0.9,
        origin_table: "derived",
        origin_id: cOrigin,
      });
      edges.push({
        src_origin: tripOrigin,
        dst_origin: cOrigin,
        relation: "CONSTRAINED_BY",
      });
      attachTopic(cOrigin, db, "dietary");
    }

    // Person → topic edges based on budget_style / travel_style keywords.
    if (profile?.budget_style) attachTopic(personOrigin, profile.budget_style, "budget");
    if (profile?.travel_style) attachTopic(personOrigin, profile.travel_style);
  }

  // 3. Place nodes → ABOUT → topic hub. PROPOSED edges dropped so the force
  // layout no longer orbits each place around its champion.
  for (const place of args.places) {
    const placeOrigin = `place:${place.id}`;
    nodes.push({
      kind: "place",
      label: place.name,
      properties: {
        category: place.category,
        lat: place.lat,
        lng: place.lng,
        time_of_day: place.time_of_day,
        added_by_agent: place.added_by_agent,
        status: place.status,
      },
      importance: 0.6,
      origin_table: "places",
      origin_id: placeOrigin,
    });
    const placeTopic = placeCategoryToTopic(place.category);
    if (placeTopic) {
      topicsUsed.add(placeTopic);
      edges.push({
        src_origin: placeOrigin,
        dst_origin: topicOriginOf(placeTopic),
        relation: "ABOUT",
      });
    } else {
      // If there's no category, fall back to keyword inference on the name.
      attachTopic(placeOrigin, place.name);
    }
  }

  // 4. Trip-memory items — connect to trip hub (so rebuild doesn't orphan
  // them) AND to their inferred topic so topic clusters pull them together.
  if (args.memory) {
    const m = args.memory;
    for (const c of m.constraints ?? []) {
      const cOrigin = `constraint:${slug(c)}`;
      nodes.push({
        kind: "constraint",
        label: c,
        properties: { source: "trip_memory" },
        importance: 0.85,
        origin_table: "trip_memory",
        origin_id: cOrigin,
      });
      edges.push({
        src_origin: tripOrigin,
        dst_origin: cOrigin,
        relation: "CONSTRAINED_BY",
      });
      attachTopic(cOrigin, c);
    }
    for (const d of m.decisions_made ?? []) {
      const dOrigin = `decision:${slug(d)}`;
      nodes.push({
        kind: "decision",
        label: d,
        properties: { source: "trip_memory" },
        importance: 0.8,
        origin_table: "trip_memory",
        origin_id: dOrigin,
      });
      edges.push({
        src_origin: tripOrigin,
        dst_origin: dOrigin,
        relation: "DECIDED",
      });
      attachTopic(dOrigin, d);
    }
    for (const q of m.open_questions ?? []) {
      const qOrigin = `question:${slug(q)}`;
      nodes.push({
        kind: "question",
        label: q,
        properties: { source: "trip_memory" },
        importance: 0.7,
        origin_table: "trip_memory",
        origin_id: qOrigin,
      });
      edges.push({
        src_origin: tripOrigin,
        dst_origin: qOrigin,
        relation: "ASKING",
      });
      attachTopic(qOrigin, q);
    }
    for (const gp of m.group_preferences ?? []) {
      const pOrigin = `pref:group:${slug(gp)}`;
      nodes.push({
        kind: "preference",
        label: gp,
        properties: { kind: "group" },
        importance: 0.55,
        origin_table: "trip_memory",
        origin_id: pOrigin,
      });
      edges.push({
        src_origin: tripOrigin,
        dst_origin: pOrigin,
        relation: "SUPPORTS",
      });
      attachTopic(pOrigin, gp);
    }
    for (const t of m.tensions ?? []) {
      const tOrigin = `tension:${slug(t)}`;
      nodes.push({
        kind: "tension",
        label: t,
        properties: { source: "trip_memory" },
        importance: 0.6,
        origin_table: "trip_memory",
        origin_id: tOrigin,
      });
      edges.push({
        src_origin: tripOrigin,
        dst_origin: tOrigin,
        relation: "TENSION_BETWEEN",
      });
      attachTopic(tOrigin, t);
    }
  }

  // 5. Emit topic hub nodes for every topic that was referenced. Connect
  // each topic to the trip so they sit near the root rather than floating.
  for (const topicId of topicsUsed) {
    const meta = TOPICS.find((t) => t.id === topicId);
    if (!meta) continue;
    const tOrigin = topicOriginOf(topicId);
    nodes.push({
      kind: "topic",
      label: meta.label,
      properties: { id: topicId },
      importance: 0.75,
      origin_table: "derived",
      origin_id: tOrigin,
    });
    edges.push({
      src_origin: tOrigin,
      dst_origin: tripOrigin,
      relation: "PART_OF",
    });
  }

  return { nodes, edges };
}

interface InMemoryNode {
  id: string; // = origin_id, stable across rebuilds
  trip_id: string;
  kind: KGNodeKind;
  label: string;
  properties: Record<string, unknown>;
  importance: number;
  confidence: "provisional" | "confirmed" | "disputed";
  origin_table: string;
  origin_id: string;
  invalidated_at: null;
  created_at: string;
  updated_at: string;
}

interface InMemoryEdge {
  id: string; // synthetic: src|dst|relation
  trip_id: string;
  src_id: string;
  dst_id: string;
  relation: KGRelation;
  weight: number;
  confidence: "provisional";
  properties: Record<string, unknown>;
  source_message_id: null;
  invalidated_at: null;
  created_at: string;
}

/**
 * Compute the graph in memory from source tables. No writes. Deterministic:
 * same source data always produces the same (id, label, edges).
 *
 * This is what the graph API returns — we treat the graph as a derived view,
 * not a stored artifact. Consequence: no migration 005 needed. Cost: we
 * recompute per request, ~5–50ms at trip scale.
 */
export async function computeGraphInMemory(
  supabase: SupabaseClient,
  tripId: string
): Promise<{ nodes: InMemoryNode[]; edges: InMemoryEdge[] }> {
  const [tripRes, participantsRes, placesRes, memoryRes] = await Promise.all([
    supabase.from("trips").select("*").eq("id", tripId).single(),
    supabase.from("participants").select("*").eq("trip_id", tripId),
    supabase.from("places").select("*").eq("trip_id", tripId),
    supabase
      .from("trip_memory")
      .select("*")
      .eq("trip_id", tripId)
      .maybeSingle(),
  ]);

  if (tripRes.error || !tripRes.data) {
    throw new Error(`Trip ${tripId} not found`);
  }

  const trip = tripRes.data as Trip;
  const participants = (participantsRes.data ?? []) as Participant[];
  const places = (placesRes.data ?? []) as Place[];
  const memory = (memoryRes.data ?? null) as TripMemory | null;

  const { data: profilesData } = await supabase
    .from("participant_profiles")
    .select("*")
    .in(
      "participant_id",
      participants.map((p) => p.id)
    );
  const profiles = (profilesData ?? []) as ParticipantProfile[];

  const { nodes: pendingNodes, edges: pendingEdges } = collectPending({
    trip,
    participants,
    profiles,
    places,
    memory,
  });

  // Dedupe nodes by origin_id, keeping the highest importance.
  const nodesByOrigin = new Map<string, PendingNode>();
  for (const n of pendingNodes) {
    const existing = nodesByOrigin.get(n.origin_id);
    if (!existing) {
      nodesByOrigin.set(n.origin_id, n);
    } else {
      existing.importance = Math.max(
        existing.importance ?? 0.5,
        n.importance ?? 0.5
      );
    }
  }

  const now = new Date().toISOString();
  const nodes: InMemoryNode[] = Array.from(nodesByOrigin.values()).map((n) => ({
    id: n.origin_id,
    trip_id: tripId,
    kind: n.kind,
    label: n.label,
    properties: n.properties ?? {},
    importance: n.importance ?? 0.5,
    confidence: "provisional",
    origin_table: n.origin_table,
    origin_id: n.origin_id,
    invalidated_at: null,
    created_at: tripCreatedAtFor(n, trip, places, memory),
    updated_at: now,
  }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const edges: InMemoryEdge[] = [];
  for (const e of pendingEdges) {
    if (!nodeIds.has(e.src_origin) || !nodeIds.has(e.dst_origin)) continue;
    if (e.src_origin === e.dst_origin) continue;
    const key = `${e.src_origin}|${e.dst_origin}|${e.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: key,
      trip_id: tripId,
      src_id: e.src_origin,
      dst_id: e.dst_origin,
      relation: e.relation,
      weight: e.weight ?? 1.0,
      confidence: "provisional",
      properties: e.properties ?? {},
      source_message_id: null,
      invalidated_at: null,
      created_at: now,
    });
  }

  return { nodes, edges };
}

/**
 * Best-guess "when did this node come into existence" for the z-axis day
 * layers. We sample the origin row's created_at where available; otherwise
 * fall back to the trip start so the node sits on day 0.
 */
function tripCreatedAtFor(
  n: PendingNode,
  trip: Trip,
  places: Place[],
  memory: TripMemory | null
): string {
  if (n.origin_table === "trips") return trip.created_at;
  if (n.origin_table === "places") {
    const rawId = n.origin_id.startsWith("place:")
      ? n.origin_id.slice("place:".length)
      : n.origin_id;
    const p = places.find((pp) => pp.id === rawId);
    if (p) return p.created_at;
  }
  if (n.origin_table === "participants") return trip.created_at;
  if (n.origin_table === "trip_memory" && memory) return memory.updated_at;
  return trip.created_at;
}
