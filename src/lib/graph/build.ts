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

function collectPending(args: {
  trip: Trip;
  participants: Participant[];
  profiles: ParticipantProfile[];
  places: Place[];
  memory: TripMemory | null;
}): { nodes: PendingNode[]; edges: PendingEdge[] } {
  const nodes: PendingNode[] = [];
  const edges: PendingEdge[] = [];

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

  // 2. Person nodes + PART_OF edge
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

    // Per-person preferences (interests + food_preferences)
    const likeItems = [
      ...(profile?.interests ?? []).map((x) => ({ text: x, kind: "interest" })),
      ...(profile?.food_preferences ?? []).map((x) => ({
        text: x,
        kind: "food",
      })),
    ];
    for (const item of likeItems) {
      const prefOrigin = `pref:${item.kind}:${slug(item.text)}`;
      nodes.push({
        kind: "preference",
        label: item.text,
        properties: { kind: item.kind },
        importance: 0.4,
        origin_table: "derived",
        origin_id: prefOrigin,
      });
      edges.push({
        src_origin: personOrigin,
        dst_origin: prefOrigin,
        relation: "PREFERS",
      });
    }

    // Per-person dislikes → dislike preferences
    for (const d of profile?.dislikes ?? []) {
      const prefOrigin = `pref:dislike:${slug(d)}`;
      nodes.push({
        kind: "preference",
        label: d,
        properties: { kind: "dislike" },
        importance: 0.5,
        origin_table: "derived",
        origin_id: prefOrigin,
      });
      edges.push({
        src_origin: personOrigin,
        dst_origin: prefOrigin,
        relation: "DISLIKES",
      });
    }

    // Per-person dealbreakers → hard constraints
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
      // Heuristic: if the text mentions allergy, use ALLERGIC_TO; else DISLIKES
      const rel: KGRelation = /allerg|intoleran/i.test(db)
        ? "ALLERGIC_TO"
        : "DISLIKES";
      edges.push({
        src_origin: personOrigin,
        dst_origin: cOrigin,
        relation: rel,
      });
    }
  }

  // 3. Place nodes + PROPOSED edges
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
    if (place.added_by) {
      edges.push({
        src_origin: `person:${place.added_by}`,
        dst_origin: placeOrigin,
        relation: "PROPOSED",
      });
    }
  }

  // 4. Trip-level constraints / decisions / questions / tensions / group prefs
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
    }
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
