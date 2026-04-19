import "server-only";

import type OpenAI from "openai";

import { callLlm, getZaiModel } from "@/lib/llm";
import { concatChunks } from "@/lib/embeddings";
import {
  executeTool,
  mainAgentTools,
  type ToolContext,
} from "@/lib/agent/tools";
import { runResearchSubagent } from "@/lib/agent/subagent-research";
import {
  agentGroupContext,
  agentGroupSystem,
} from "@/lib/prompts/agent-group";
import {
  agentPrivateContext,
  agentPrivateSystem,
} from "@/lib/prompts/agent-private";
import { computeGraphInMemory } from "@/lib/graph/build";
import { serializeGraph } from "@/lib/graph/serialize";
import type { KGEdge, KGNode } from "@/lib/graph/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ChatMessage,
  ChatRoom,
  Participant,
  ParticipantProfile,
  Trip,
  TripMemory,
} from "@/types/db";

const HISTORY_LIMIT = 20;
const MAX_TURNS = 5;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

export interface RunAgentArgs {
  tripId: string;
  roomId: string;
  placeholderMessageId: string;
  triggerMessageId: string;
}

export async function runAgent(args: RunAgentArgs): Promise<void> {
  const supabase = getSupabaseServerClient();
  const t0 = Date.now();

  const updatePlaceholder = async (patch: {
    content?: string;
    thinking_state?: "streaming" | "done" | "failed";
    tool_calls?: unknown[];
  }) => {
    await supabase
      .from("chat_messages")
      .update(patch)
      .eq("id", args.placeholderMessageId);
  };

  // Create the ai_runs row up front so we have a run_id to stamp on
  // agent_run_activations as the agent touches graph nodes. We'll fill in
  // the final output/duration at the terminal update below.
  const { data: runRow } = await supabase
    .from("ai_runs")
    .insert({
      trip_id: args.tripId,
      kind: "agent.run",
      input: { trigger_message_id: args.triggerMessageId },
      model: getZaiModel(),
    })
    .select("id")
    .single();
  const runId = (runRow?.id ?? null) as string | null;

  const finalizeRun = async (patch: {
    kind?: string;
    output?: unknown;
    error?: string | null;
  }) => {
    if (!runId) return;
    await supabase
      .from("ai_runs")
      .update({
        ...patch,
        duration_ms: Date.now() - t0,
      })
      .eq("id", runId);
  };

  // Activations are ephemeral UI events — ship them via Supabase Realtime
  // broadcast (no table required, no migration dependency). The client's
  // useActivations hook subscribes to the same channel and lights up the
  // matching nodes for ~1.8s.
  const activationChannel = supabase.channel(`graph-activations:${args.tripId}`, {
    config: { broadcast: { self: false } },
  });
  let channelReady: Promise<void> | null = null;
  const ensureChannel = (): Promise<void> => {
    if (!channelReady) {
      channelReady = new Promise((resolve) => {
        activationChannel.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
        });
        // Hard cap so a flaky channel doesn't block the agent
        setTimeout(resolve, 1500);
      });
    }
    return channelReady;
  };

  const broadcastActivations = async (
    nodeIds: string[],
    reason: string
  ): Promise<void> => {
    if (!runId || nodeIds.length === 0) return;
    try {
      await ensureChannel();
      await activationChannel.send({
        type: "broadcast",
        event: "activate",
        payload: {
          trip_id: args.tripId,
          run_id: runId,
          node_ids: nodeIds,
          reason,
          at: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.warn("broadcast failed (non-fatal):", e);
    }
  };

  try {
    // Load room to determine mode
    const { data: roomData } = await supabase
      .from("chat_rooms")
      .select("*")
      .eq("id", args.roomId)
      .single();
    if (!roomData) throw new Error(`Room ${args.roomId} not found`);
    const room = roomData as ChatRoom;

    // Load trip, trip_memory, participants, profiles
    const [
      { data: tripData },
      { data: tripMemoryData },
      { data: participantsData },
      { data: triggerMsgData },
    ] = await Promise.all([
      supabase.from("trips").select("*").eq("id", args.tripId).single(),
      supabase.from("trip_memory").select("*").eq("trip_id", args.tripId).maybeSingle(),
      supabase.from("participants").select("*").eq("trip_id", args.tripId),
      supabase.from("chat_messages").select("*").eq("id", args.triggerMessageId).single(),
    ]);
    if (!tripData) throw new Error(`Trip ${args.tripId} not found`);
    if (!triggerMsgData) throw new Error("Trigger message not found");
    const trip = tripData as Trip;
    const tripMemory = (tripMemoryData ?? null) as TripMemory | null;
    const participants = (participantsData ?? []) as Participant[];
    const triggerMsg = triggerMsgData as ChatMessage;

    // Load last 20 messages in this room (excluding the placeholder itself)
    const { data: historyData } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("room_id", args.roomId)
      .neq("id", args.placeholderMessageId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    const history = ((historyData ?? []) as ChatMessage[]).reverse();

    // Profiles
    const { data: profilesData } = await supabase
      .from("participant_profiles")
      .select("*")
      .in(
        "participant_id",
        participants.map((p) => p.id)
      );
    const profiles = (profilesData ?? []) as ParticipantProfile[];

    const nameById: Record<string, string> = {};
    participants.forEach((p) => {
      nameById[p.id] = p.display_name;
    });

    // Attach display_name to profiles for legibility
    const profilesForPrompt = profiles.map((p) => ({
      display_name: nameById[p.participant_id] ?? "Unknown",
      ...p,
    }));

    // Trip-brain context: v1 feeds the full corpus (truncated) rather than
    // similarity-ranking. Fine for one trip with ~200 messages; swap in a
    // real embedder if this scales.
    let ragChunks = "";
    if (triggerMsg.content.trim()) {
      const { data: chunkRows } = await supabase
        .from("upload_chunks")
        .select("id, content, created_at")
        .eq("trip_id", args.tripId)
        .order("created_at", { ascending: true });
      const chunks = (chunkRows ?? []) as { id: string; content: string }[];
      ragChunks = concatChunks(chunks, 5000);
    }

    // Knowledge graph — compute on the fly from source tables (no
    // kg_nodes/kg_edges tables needed). Serialize into the prompt so the
    // agent sees the compiled trip brain, and broadcast the node IDs it
    // consumed so the viz lights them up in real time.
    const { nodes: kgNodes, edges: kgEdges } = await computeGraphInMemory(
      supabase,
      args.tripId
    );
    const graphDigest =
      kgNodes.length > 0
        ? serializeGraph(
            kgNodes as unknown as KGNode[],
            kgEdges as unknown as KGEdge[],
            { maxPerKind: 25 }
          )
        : "";
    if (kgNodes.length > 0) {
      // Phased waves so the viz cascades visibly as the agent reads the brain.
      // 1) Trip hub + participants, 2) constraints + preferences, 3) decisions
      //    + questions + tensions, 4) places. ~120ms between waves.
      const orderGroups = [
        new Set(["trip", "person"]),
        new Set(["constraint", "preference"]),
        new Set(["decision", "question", "tension"]),
        new Set(["place"]),
      ];
      for (let i = 0; i < orderGroups.length; i++) {
        const wave = kgNodes
          .filter((n) => orderGroups[i].has(n.kind))
          .map((n) => n.id);
        if (wave.length === 0) continue;
        await broadcastActivations(
          wave,
          `Wave ${i + 1} · ${Array.from(orderGroups[i]).join("/")}`
        );
        if (i < orderGroups.length - 1) await sleep(120);
      }
    }

    // Decide mode and build system prompt
    const mode: "group" | "private" = room.type === "group" ? "group" : "private";

    const historyForPrompt = history
      .map((m) => {
        const who =
          m.sender_type === "user"
            ? (nameById[m.sender_participant_id ?? ""] ?? "User")
            : m.sender_type === "agent"
              ? "Agent"
              : m.sender_type === "subagent"
                ? "Research Agent"
                : "System";
        return `${who}: ${m.content}`;
      })
      .join("\n");

    let systemPrompt: string;
    let contextBlock: string;

    const prependGraph = (block: string) =>
      graphDigest
        ? `TRIP KNOWLEDGE GRAPH (compiled brain — prefer this over raw RAG):\n${graphDigest}\n\n---\n\n${block}`
        : block;

    if (mode === "group") {
      systemPrompt = agentGroupSystem;
      contextBlock = prependGraph(
        agentGroupContext({
          tripMemoryJson: JSON.stringify(tripMemory ?? {}, null, 2),
          participantsJson: JSON.stringify(profilesForPrompt, null, 2),
          recentMessages: historyForPrompt,
          ragChunks,
        })
      );
    } else {
      const ownerId = room.owner_id!;
      const ownerName = nameById[ownerId] ?? "participant";
      const ownerProfile = profiles.find((p) => p.participant_id === ownerId);

      // Also fetch the group room's last 20 messages for read-only context
      const { data: groupRoomData } = await supabase
        .from("chat_rooms")
        .select("*")
        .eq("trip_id", args.tripId)
        .eq("type", "group")
        .maybeSingle();
      let groupRecent = "";
      if (groupRoomData) {
        const { data: groupMsgs } = await supabase
          .from("chat_messages")
          .select("*")
          .eq("room_id", (groupRoomData as ChatRoom).id)
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT);
        const groupMsgsOrdered = (
          (groupMsgs ?? []) as ChatMessage[]
        ).reverse();
        groupRecent = groupMsgsOrdered
          .map((m) => {
            const who =
              m.sender_type === "user"
                ? (nameById[m.sender_participant_id ?? ""] ?? "User")
                : m.sender_type === "agent"
                  ? "Agent"
                  : m.sender_type === "subagent"
                    ? "Research Agent"
                    : "System";
            return `${who}: ${m.content}`;
          })
          .join("\n");
      }

      systemPrompt = agentPrivateSystem;
      contextBlock = prependGraph(
        agentPrivateContext({
          participantName: ownerName,
          profileJson: JSON.stringify(
            ownerProfile
              ? { display_name: ownerName, ...ownerProfile }
              : { display_name: ownerName },
            null,
            2
          ),
          tripMemoryJson: JSON.stringify(tripMemory ?? {}, null, 2),
          groupRecentMessages: groupRecent,
          privateRecentMessages: historyForPrompt,
          ragChunks,
        })
      );
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "system", content: contextBlock },
      { role: "user", content: triggerMsg.content },
    ];

    const currentTimeOfDay = getTimeOfDay();
    const profilesJson = JSON.stringify(profilesForPrompt, null, 2);

    const toolCtx: ToolContext = {
      supabase,
      tripId: args.tripId,
      roomId: args.roomId,
      destination: trip.destination,
      currentParticipantId: room.owner_id ?? null,
      spawnResearchSubagent: async (subArgs) => {
        return await runResearchSubagent({
          supabase,
          tripId: args.tripId,
          roomId: args.roomId,
          description: subArgs.description,
          requesterContext: subArgs.requesterContext,
          destination: trip.destination,
          tripMemory,
          profilesJson,
          currentTimeOfDay,
        });
      },
    };

    // Tool loop
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const result = await callLlm({
        messages: messages as unknown as Parameters<typeof callLlm>[0]["messages"],
        tools: mainAgentTools,
      });

      if (result.toolCalls.length === 0) {
        const finalContent =
          result.content.trim() ||
          "I couldn't find anything useful on that.";
        await updatePlaceholder({
          content: finalContent,
          thinking_state: "done",
        });
        await finalizeRun({
          kind: `agent.${mode}`,
          output: { content: finalContent, turns: turn + 1 },
        });
        return;
      }

      // Only function-typed tool calls are supported in v1.
      const fnCalls = result.toolCalls.filter(
        (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
          tc.type === "function"
      );

      // Progressive update: show which tools the agent is calling
      const toolNames = fnCalls.map((tc) => tc.function.name).join(", ");
      const progress = result.content.trim()
        ? `${result.content.trim()}\n\n_Calling ${toolNames}…_`
        : `_Calling ${toolNames}…_`;
      await updatePlaceholder({
        content: progress,
        thinking_state: "streaming",
        tool_calls: fnCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
        })),
      });

      messages.push({
        role: "assistant",
        content: result.content ?? "",
        tool_calls: fnCalls,
      });

      for (const tc of fnCalls) {
        const toolResult = await executeTool(
          tc.function.name,
          tc.function.arguments,
          toolCtx
        );
        messages.push({
          role: "tool",
          content: toolResult,
          tool_call_id: tc.id,
        });

        // If research_activity was called, the subagent has already written
        // its final answer directly to chat. Finalize our placeholder and exit.
        if (tc.function.name === "research_activity" && !toolResult) {
          await updatePlaceholder({
            content: result.content?.trim() || "The Research Agent has posted its findings above.",
            thinking_state: "done",
          });
          await finalizeRun({
            kind: `agent.${mode}`,
            output: { content: "Delegated to research subagent", turns: turn + 1 },
          });
          return;
        }
      }
    }

    // Turn budget exhausted — summarize whatever we have
    const fallback =
      "I've gathered enough to say: let me know if you want me to dig deeper on a specific angle.";
    await updatePlaceholder({
      content: fallback,
      thinking_state: "done",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("runAgent failed:", msg);
    await updatePlaceholder({
      content: "Sorry, I hit an error. Try rephrasing?",
      thinking_state: "failed",
    });
    await finalizeRun({
      kind: "agent.error",
      output: null,
      error: msg,
    });
  }
}
