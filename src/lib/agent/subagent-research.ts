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

const MAX_TURNS = 3;

const STAGE_MESSAGES: Record<string, string> = {
  search_places: "Checking out the best spots nearby...",
  web_search: "Looking for any special events happening...",
  save_place: "Saving a great find to your map...",
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

  // Insert status messages without awaiting to reduce latency
  const insertStatus = (content: string) =>
    args.supabase.from("chat_messages").insert({
      room_id: args.roomId,
      sender_type: "subagent",
      sender_label: "Research Agent",
      content,
      thinking_state: "streaming",
    });

  // Insert the subagent placeholder -- this is the message we'll update with the final answer
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
      const result = await callLlm({
        messages: messages as unknown as Parameters<typeof callLlm>[0]["messages"],
        tools: subagentResearchTools,
      });

      const fnCalls = result.toolCalls.filter(
        (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
          tc.type === "function"
      );

      if (fnCalls.length === 0) {
        // Final response -- write directly to the placeholder
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

        // Return empty string so the main agent knows not to add another message
        return "";
      }

      // Fire-and-forget stage message + placeholder update (non-blocking)
      const stageMsg = friendlyStage(fnCalls.map((tc) => tc.function.name));
      if (stageMsg !== lastStageInserted) {
        insertStatus(stageMsg); // don't await
        lastStageInserted = stageMsg;
      }
      const toolNames = fnCalls.map((tc) => tc.function.name).join(", ");
      updateSubagent({
        content: `Investigating... (${toolNames})`,
        thinking_state: "streaming",
      }); // don't await

      messages.push({
        role: "assistant",
        content: result.content ?? "",
        tool_calls: fnCalls,
      });

      // Execute tools in parallel when possible
      const toolResults = await Promise.all(
        fnCalls.map(async (tc) => ({
          id: tc.id,
          result: await executeTool(tc.function.name, tc.function.arguments, toolCtx),
        }))
      );

      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          content: tr.result,
          tool_call_id: tr.id,
        });
      }
    }

    // Exhausted turn budget -- force a final response without tools
    insertStatus("Putting it all together..."); // don't await
    const forcedResult = await callLlm({
      messages: messages as unknown as Parameters<typeof callLlm>[0]["messages"],
      // No tools -- force a text response
    });
    const fallback =
      forcedResult.content.trim() ||
      "I've checked a few options but need more time to narrow it down — try asking me something more specific.";
    await updateSubagent({ content: fallback, thinking_state: "done" });
    return "";
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
    return "";
  }
}
