import "server-only";

import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { callLlm, getZaiModel } from "@/lib/llm";
import {
  executeTool,
  subagentResearchTools,
  type ToolContext,
} from "@/lib/agent/tools";
import {
  subagentResearchSystem,
  subagentResearchUser,
} from "@/lib/prompts/subagent-research";
import type { TripMemory } from "@/types/db";

const MAX_TURNS = 5;

const STAGE_MESSAGES: Record<string, string> = {
  search_places: "Checking out the best spots nearby...",
  web_search: "Looking for any special events happening...",
  save_place: "Saving a great find to your map...",
  query_trip_brain: "Reading your group's travel notes...",
  get_participant_profile: "Checking everyone's preferences...",
};

function friendlyStage(toolNames: string[]): string {
  for (const name of toolNames) {
    if (STAGE_MESSAGES[name]) return STAGE_MESSAGES[name];
  }
  return "Digging deeper...";
}

export async function runResearchSubagent(args: {
  supabase: SupabaseClient;
  tripId: string;
  roomId: string;
  description: string;
  requesterContext: string;
  destination: string | null;
  tripMemory: TripMemory | null;
  profilesJson: string;
  currentTimeOfDay: string;
}): Promise<string> {
  const t0 = Date.now();

  const insertStatus = async (content: string) => {
    await args.supabase.from("chat_messages").insert({
      room_id: args.roomId,
      sender_type: "subagent",
      sender_label: "Research Agent",
      content,
      thinking_state: "streaming",
    });
  };

  // 1. Insert the subagent "thinking" placeholder message
  const { data: placeholder, error: placeholderErr } = await args.supabase
    .from("chat_messages")
    .insert({
      room_id: args.roomId,
      sender_type: "subagent",
      sender_label: "Research Agent",
      content: "Scanning the best spots for you...",
      thinking_state: "thinking",
    })
    .select()
    .single();
  if (placeholderErr || !placeholder) {
    console.error("Subagent placeholder insert failed:", placeholderErr);
    return "Could not start research agent.";
  }

  const placeholderId = (placeholder as { id: string }).id;

  const updateSubagent = async (patch: {
    content?: string;
    thinking_state?: "streaming" | "done" | "failed";
  }) => {
    await args.supabase
      .from("chat_messages")
      .update(patch)
      .eq("id", placeholderId);
  };

  try {
    const toolCtx: ToolContext = {
      supabase: args.supabase,
      tripId: args.tripId,
      roomId: args.roomId,
      destination: args.destination,
      currentParticipantId: null,
    };

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: subagentResearchSystem },
      {
        role: "user",
        content: subagentResearchUser({
          description: args.description,
          requesterContext: args.requesterContext,
          tripMemoryJson: JSON.stringify(args.tripMemory ?? {}, null, 2),
          profilesJson: args.profilesJson,
          currentTimeOfDay: args.currentTimeOfDay,
        }),
      },
    ];

    let lastStageInserted = "";

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const isLastTurn = turn === MAX_TURNS - 1;
      if (!isLastTurn) {
        await updateSubagent({
          content: isLastTurn
            ? "Putting it all together..."
            : "Narrowing down the best options...",
          thinking_state: "streaming",
        });
      }

      const result = await callLlm({
        messages: messages as unknown as Parameters<typeof callLlm>[0]["messages"],
        tools: subagentResearchTools,
      });

      const fnCalls = result.toolCalls.filter(
        (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
          tc.type === "function"
      );

      if (fnCalls.length === 0) {
        // Insert a "putting together" status before the final
        if (lastStageInserted !== "Putting it all together...") {
          await insertStatus("Putting it all together...");
        }

        const finalContent =
          result.content.trim() ||
          "I couldn't find enough to recommend with confidence.";
        await updateSubagent({
          content: finalContent,
          thinking_state: "done",
        });

        await args.supabase.from("ai_runs").insert({
          trip_id: args.tripId,
          kind: "subagent.research",
          input: { description: args.description },
          output: { content: finalContent, turns: turn + 1 },
          duration_ms: Date.now() - t0,
          model: getZaiModel(),
        });

        return finalContent;
      }

      // Insert a friendly stage message in chat for each tool batch
      const stageMsg = friendlyStage(fnCalls.map((tc) => tc.function.name));
      if (stageMsg !== lastStageInserted) {
        await insertStatus(stageMsg);
        lastStageInserted = stageMsg;
      }

      // Update placeholder with tool progress
      const toolNames = fnCalls.map((tc) => tc.function.name).join(", ");
      await updateSubagent({
        content: `Investigating... (${toolNames})`,
        thinking_state: "streaming",
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
      }
    }

    // Exhausted turn budget
    if (lastStageInserted !== "Putting it all together...") {
      await insertStatus("Putting it all together...");
    }
    const fallback =
      "I've checked a few options but need more time to narrow it down — try asking me something more specific.";
    await updateSubagent({ content: fallback, thinking_state: "done" });
    return fallback;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("runResearchSubagent failed:", msg);
    await updateSubagent({
      content: "Sorry, the research agent hit an error. Try rephrasing?",
      thinking_state: "failed",
    });
    await args.supabase.from("ai_runs").insert({
      trip_id: args.tripId,
      kind: "subagent.research",
      input: { description: args.description },
      output: null,
      error: msg,
      duration_ms: Date.now() - t0,
      model: null,
    });
    return `Research agent failed: ${msg}`;
  }
}
