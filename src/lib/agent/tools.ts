import "server-only";

import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { concatChunks } from "@/lib/embeddings";
import { googlePlacesTextSearch } from "@/lib/places";
import { braveSearch, isBraveAvailable } from "@/lib/brave";
import type {
  Participant,
  ParticipantProfile,
  PlaceCategory,
  TimeOfDay,
} from "@/types/db";

// ---------------------------------------------------------------
// Tool schemas (OpenAI function-calling format)
// ---------------------------------------------------------------
export const mainAgentTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "query_trip_brain",
      description:
        "Retrieve the most relevant passages from the group's own shared materials (WhatsApp chat, docs, intros) for a specific question. Returns up to 5 excerpts.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "What you want to know from the group's materials.",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_places",
      description:
        "Search Google Places for venues around the trip destination.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for." },
          category: {
            type: "string",
            enum: [
              "food",
              "drinks",
              "sight",
              "shopping",
              "nature",
              "nightlife",
              "other",
            ],
            description: "Optional category filter.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_place",
      description:
        "Pin a place to the group's shared map. Use after search_places confirms the venue exists.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          lat: { type: "number" },
          lng: { type: "number" },
          google_place_id: { type: "string" },
          category: {
            type: "string",
            enum: [
              "food",
              "drinks",
              "sight",
              "shopping",
              "nature",
              "nightlife",
              "other",
            ],
          },
          notes: { type: "string", description: "Why this place, 1 sentence." },
          time_of_day: {
            type: "string",
            enum: ["morning", "afternoon", "evening", "night", "any"],
          },
        },
        required: ["name", "lat", "lng", "category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_participant_profile",
      description:
        "Fetch one participant's full profile by display name. Fuzzy matches.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_activity",
      description:
        "Spawn the Research Agent to thoroughly investigate a specific activity, booking, or question and return 2-3 top options. Use this when the question needs real research, not a quick answer.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "What to investigate, in plain language.",
          },
          requester_context: {
            type: "string",
            description:
              "Any relevant context about who is asking (e.g. their budget, preferences).",
          },
        },
        required: ["description"],
      },
    },
  },
];

export const subagentResearchTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    mainAgentTools[1], // search_places
    mainAgentTools[2], // save_place
  ];

if (isBraveAvailable()) {
  subagentResearchTools.push({
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for information Google Places cannot answer (hours, reservation policies, reviews, blog posts). Returns top results.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  });
}

// ---------------------------------------------------------------
// Context + handlers
// ---------------------------------------------------------------
export interface ToolContext {
  supabase: SupabaseClient;
  tripId: string;
  roomId: string;
  destination: string | null;
  currentParticipantId: string | null;
  /** Provided by the main agent so research_activity can stream into
   * a new subagent message. Null from inside the subagent itself. */
  spawnResearchSubagent?: (args: {
    description: string;
    requesterContext: string;
  }) => Promise<string>;
}

export async function executeTool(
  name: string,
  argsJson: string,
  ctx: ToolContext
): Promise<string> {
  let args: unknown;
  try {
    args = JSON.parse(argsJson || "{}");
  } catch {
    return `Tool ${name} failed: invalid JSON arguments.`;
  }

  try {
    switch (name) {
      case "query_trip_brain":
        return await queryTripBrain(args, ctx);
      case "search_places":
        return await searchPlacesTool(args, ctx);
      case "save_place":
        return await savePlaceTool(args, ctx);
      case "get_participant_profile":
        return await getParticipantProfileTool(args, ctx);
      case "research_activity":
        if (!ctx.spawnResearchSubagent) {
          return "Research agent is not available from inside a subagent.";
        }
        return await researchActivityTool(args, ctx);
      case "web_search":
        return await webSearchTool(args);
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e) {
    return `Tool ${name} failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ---------------------------------------------------------------

const queryTripBrainArgs = z.object({ question: z.string().min(1) });

async function queryTripBrain(
  rawArgs: unknown,
  ctx: ToolContext
): Promise<string> {
  // args.question is unused in v1 (no semantic ranking). Kept for API
  // compat with agents that still pass it; the LLM can filter the corpus
  // itself when given the full text.
  queryTripBrainArgs.parse(rawArgs);
  const { data } = await ctx.supabase
    .from("upload_chunks")
    .select("id, content, created_at")
    .eq("trip_id", ctx.tripId)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as { id: string; content: string }[];
  if (rows.length === 0) return "No materials ingested yet.";
  return concatChunks(rows, 6000);
}

// ---------------------------------------------------------------

const searchPlacesArgs = z.object({
  query: z.string().min(1),
  category: z
    .enum([
      "food",
      "drinks",
      "sight",
      "shopping",
      "nature",
      "nightlife",
      "other",
    ])
    .optional(),
});

async function searchPlacesTool(
  rawArgs: unknown,
  ctx: ToolContext
): Promise<string> {
  const args = searchPlacesArgs.parse(rawArgs);
  const q = args.category ? `${args.category} ${args.query}` : args.query;
  const results = await googlePlacesTextSearch(q, ctx.destination);
  if (results.length === 0) return "No places matched.";
  return JSON.stringify(
    results.slice(0, 5).map((r) => ({
      name: r.name,
      place_id: r.place_id,
      lat: r.lat,
      lng: r.lng,
      address: r.formatted_address,
      rating: r.rating,
      reviews: r.user_ratings_total,
    })),
    null,
    2
  );
}

// ---------------------------------------------------------------

const savePlaceArgs = z.object({
  name: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  google_place_id: z.string().optional(),
  category: z.enum([
    "food",
    "drinks",
    "sight",
    "shopping",
    "nature",
    "nightlife",
    "other",
  ]) as z.ZodType<PlaceCategory>,
  notes: z.string().optional(),
  time_of_day: z
    .enum(["morning", "afternoon", "evening", "night", "any"])
    .optional() as z.ZodType<TimeOfDay | undefined>,
});

async function savePlaceTool(
  rawArgs: unknown,
  ctx: ToolContext
): Promise<string> {
  const args = savePlaceArgs.parse(rawArgs);
  const { data, error } = await ctx.supabase
    .from("places")
    .insert({
      trip_id: ctx.tripId,
      name: args.name,
      lat: args.lat,
      lng: args.lng,
      google_place_id: args.google_place_id ?? null,
      category: args.category,
      notes: args.notes ?? null,
      time_of_day: args.time_of_day ?? "any",
      source: "agent",
      added_by_agent: true,
    })
    .select()
    .single();
  if (error) return `Save failed: ${error.message}`;
  return `Saved "${args.name}" to the map (id ${(data as { id: string }).id}).`;
}

// ---------------------------------------------------------------

const getParticipantProfileArgs = z.object({ name: z.string().min(1) });

async function getParticipantProfileTool(
  rawArgs: unknown,
  ctx: ToolContext
): Promise<string> {
  const args = getParticipantProfileArgs.parse(rawArgs);
  const { data: participants } = await ctx.supabase
    .from("participants")
    .select("*")
    .eq("trip_id", ctx.tripId);
  const people = (participants ?? []) as Participant[];
  const needle = args.name.toLowerCase();
  const match =
    people.find((p) => p.display_name.toLowerCase() === needle) ??
    people.find((p) => p.display_name.toLowerCase().includes(needle)) ??
    people.find((p) => needle.includes(p.display_name.toLowerCase()));
  if (!match) return `No participant named "${args.name}" on this trip.`;
  const { data: profile } = await ctx.supabase
    .from("participant_profiles")
    .select("*")
    .eq("participant_id", match.id)
    .maybeSingle();
  if (!profile) return `${match.display_name} has no profile yet.`;
  return JSON.stringify(
    { display_name: match.display_name, ...(profile as ParticipantProfile) },
    null,
    2
  );
}

// ---------------------------------------------------------------

const researchActivityArgs = z.object({
  description: z.string().min(1),
  requester_context: z.string().optional().default(""),
});

async function researchActivityTool(
  rawArgs: unknown,
  ctx: ToolContext
): Promise<string> {
  const args = researchActivityArgs.parse(rawArgs);
  if (!ctx.spawnResearchSubagent) {
    return "Research agent unavailable.";
  }
  // Insert a friendly status message visible in chat before the subagent starts
  await ctx.supabase.from("chat_messages").insert({
    room_id: ctx.roomId,
    sender_type: "agent",
    sender_label: "Agent",
    content: "Let me research that for you...",
    thinking_state: "streaming",
  });
  return ctx.spawnResearchSubagent({
    description: args.description,
    requesterContext: args.requester_context,
  });
}

// ---------------------------------------------------------------

const webSearchArgs = z.object({ query: z.string().min(1) });

async function webSearchTool(rawArgs: unknown): Promise<string> {
  const args = webSearchArgs.parse(rawArgs);
  const results = await braveSearch(args.query, 6);
  if (results === null) return "web_search unavailable (no BRAVE_SEARCH_API_KEY).";
  if (results.length === 0) return "No web results.";
  return results
    .map(
      (r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.description}`
    )
    .join("\n\n");
}
