"use client";

import { Sparkles, Loader2, Wrench } from "lucide-react";

import type { OptimisticMessage } from "@/hooks/useChatMessages";

interface ToolCallLike {
  name?: string;
  function?: { name?: string };
  type?: string;
  id?: string;
}

interface Props {
  messages: OptimisticMessage[];
}

function toolLabel(tc: ToolCallLike): string {
  const n = tc.function?.name ?? tc.name ?? tc.type ?? "tool";
  return String(n);
}

const TOOL_LABELS: Record<string, string> = {
  query_trip_brain: "Reading trip memory",
  search_places: "Searching places",
  save_place: "Saving a place",
  get_participant_profile: "Reading profiles",
  research_activity: "Researching",
  web_search: "Searching the web",
};

export function AgentActivityPanel({ messages }: Props) {
  // Find latest agent message that's thinking/streaming.
  const active = [...messages]
    .reverse()
    .find(
      (m) =>
        m.sender_type === "agent" &&
        (m.thinking_state === "thinking" || m.thinking_state === "streaming")
    );

  if (!active) return null;

  const calls = (active.tool_calls ?? []) as ToolCallLike[];
  const labelRaw = calls.length
    ? toolLabel(calls[calls.length - 1])
    : undefined;
  const label = labelRaw ? (TOOL_LABELS[labelRaw] ?? labelRaw) : null;

  return (
    <div className="rounded-md border border-violet-400/30 bg-violet-500/5 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-violet-600">
        <Sparkles className="size-3.5" />
        Agent working…
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        <span>
          {label ? (
            <>
              <Wrench className="mr-1 inline size-3" />
              {label}
            </>
          ) : active.thinking_state === "streaming" ? (
            "Writing reply…"
          ) : (
            "Thinking…"
          )}
        </span>
      </div>

      {calls.length > 1 ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground/80">
          {calls.slice(0, -1).map((tc, i) => {
            const raw = toolLabel(tc);
            return (
              <li key={tc.id ?? `${raw}-${i}`}>
                ✓ {TOOL_LABELS[raw] ?? raw}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
