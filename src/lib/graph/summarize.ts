import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { callLlmJson, getZaiModel } from "@/lib/llm";
import { computeGraphInMemory } from "@/lib/graph/build";
import type { ChatMessage, Participant, TripMemory } from "@/types/db";

/**
 * Delta-ingest: look at chat messages since the last summary, ask the LLM
 * to merge new facts into trip_memory, then rebuild the graph from the
 * updated state.
 *
 * Rough-hackathon version: merge-on-upsert, trust the LLM, no conflict
 * resolution beyond dedup-by-string. Good enough to demo "graph grows as
 * we chat" and "30-min inactivity triggers a summary."
 */

const SYSTEM = `
You are the trip memory curator. You will receive:
- the current trip memory (7 arrays: constraints, group_preferences, priorities, tensions, decisions_made, open_questions, plus destination)
- a batch of new group-chat messages

Your job: emit the updated trip memory after incorporating whatever NEW facts the chat reveals. Rules:
- Preserve every existing item unless it is clearly contradicted or resolved by the new chat.
- Add new items in the correct array. Keep each item short (<= 140 chars) and objective.
- If an open_question was answered, move the answer to decisions_made and drop the question.
- Never invent. If nothing new, return the memory unchanged.

Output ONLY this JSON shape, no prose:
{
  "destination": string|null,
  "constraints": string[],
  "group_preferences": string[],
  "priorities": string[],
  "tensions": string[],
  "decisions_made": string[],
  "open_questions": string[]
}
`.trim();

function buildUser(args: {
  memory: TripMemory | null;
  messagesText: string;
  destination: string | null;
}): string {
  return `
Destination: ${args.destination ?? "(unknown)"}

Current trip memory (JSON):
${JSON.stringify(args.memory ?? {}, null, 2)}

New chat messages (chronological):
"""
${args.messagesText}
"""

Return the updated trip memory JSON now.
`.trim();
}

interface SummarizeResult {
  status: "ok" | "no-new-messages" | "noop";
  runId?: string;
  newMessageCount: number;
  sinceIso: string | null;
}

export async function summarizeChatIntoGraph(
  supabase: SupabaseClient,
  tripId: string,
  opts: { minMessages?: number } = {}
): Promise<SummarizeResult> {
  const minMessages = opts.minMessages ?? 3;

  // Load trip + memory + participants (for name mapping in the chat text)
  const [
    { data: tripRow },
    { data: memRow },
    { data: participantsRows },
  ] = await Promise.all([
    supabase.from("trips").select("*").eq("id", tripId).single(),
    supabase.from("trip_memory").select("*").eq("trip_id", tripId).maybeSingle(),
    supabase.from("participants").select("*").eq("trip_id", tripId),
  ]);
  if (!tripRow) throw new Error(`Trip ${tripId} not found`);

  // Find the last successful summary run to use as the "since" cutoff
  const { data: lastRun } = await supabase
    .from("ai_runs")
    .select("created_at")
    .eq("trip_id", tripId)
    .eq("kind", "graph.summary")
    .is("error", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const since = (lastRun?.created_at ?? tripRow.created_at) as string;

  // Load only group-room chat messages since the cutoff
  const { data: groupRooms } = await supabase
    .from("chat_rooms")
    .select("id")
    .eq("trip_id", tripId)
    .eq("type", "group");
  const groupRoomIds = (groupRooms ?? []).map((r) => r.id as string);
  if (groupRoomIds.length === 0) {
    return { status: "noop", newMessageCount: 0, sinceIso: since };
  }

  const { data: msgRows } = await supabase
    .from("chat_messages")
    .select("*")
    .in("room_id", groupRoomIds)
    .gt("created_at", since)
    .order("created_at", { ascending: true })
    .limit(500);

  const messages = (msgRows ?? []) as ChatMessage[];
  if (messages.length < minMessages) {
    return { status: "no-new-messages", newMessageCount: messages.length, sinceIso: since };
  }

  // Build the flat chat transcript
  const nameById = new Map(
    ((participantsRows ?? []) as Participant[]).map((p) => [p.id, p.display_name])
  );
  const transcript = messages
    .map((m) => {
      const who =
        m.sender_type === "user"
          ? nameById.get(m.sender_participant_id ?? "") ?? "Someone"
          : m.sender_type === "agent"
            ? "Agent"
            : m.sender_type === "subagent"
              ? "Research"
              : "System";
      return `${who}: ${m.content}`;
    })
    .join("\n");

  const t0 = Date.now();
  try {
    const updated = await callLlmJson<{
      destination: string | null;
      constraints: string[];
      group_preferences: string[];
      priorities: string[];
      tensions: string[];
      decisions_made: string[];
      open_questions: string[];
    }>({
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: buildUser({
            memory: (memRow ?? null) as TripMemory | null,
            messagesText: transcript,
            destination: (tripRow.destination as string | null) ?? null,
          }),
        },
      ],
    });

    // Sanity: string arrays only, tight lengths
    const clean = (arr: unknown): string[] =>
      Array.isArray(arr)
        ? arr
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim())
            .filter((x) => x.length > 0 && x.length <= 200)
            .slice(0, 30)
        : [];

    await supabase.from("trip_memory").upsert(
      {
        trip_id: tripId,
        destination:
          updated.destination || (tripRow.destination as string | null) || null,
        constraints: clean(updated.constraints),
        group_preferences: clean(updated.group_preferences),
        priorities: clean(updated.priorities),
        tensions: clean(updated.tensions),
        decisions_made: clean(updated.decisions_made),
        open_questions: clean(updated.open_questions),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "trip_id" }
    );

    // Warm the derivation (and catch any source-data errors early). Graph is
    // a live projection — no writes needed.
    await computeGraphInMemory(supabase, tripId);

    const { data: runRow } = await supabase
      .from("ai_runs")
      .insert({
        trip_id: tripId,
        kind: "graph.summary",
        input: { since, message_count: messages.length },
        output: {
          destination: updated.destination,
          constraints: clean(updated.constraints).length,
          decisions_made: clean(updated.decisions_made).length,
          open_questions: clean(updated.open_questions).length,
        },
        duration_ms: Date.now() - t0,
        model: getZaiModel(),
      })
      .select("id")
      .single();

    return {
      status: "ok",
      runId: runRow?.id as string | undefined,
      newMessageCount: messages.length,
      sinceIso: since,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("ai_runs").insert({
      trip_id: tripId,
      kind: "graph.summary",
      input: { since, message_count: messages.length },
      output: null,
      error: msg,
      duration_ms: Date.now() - t0,
      model: getZaiModel(),
    });
    throw e;
  }
}
