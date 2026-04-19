import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Markdown } from "@/components/chat/Markdown";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { ShareToGroupButton } from "@/components/chat/ShareToGroupButton";
import { BotAvatar } from "@/components/chat/BotAvatar";
import {
  PlaceResultCard,
  type PlaceResult,
} from "@/components/chat/PlaceResultCard";
import type { Participant } from "@/types/db";
import type { OptimisticMessage } from "@/hooks/useChatMessages";

interface Props {
  message: OptimisticMessage;
  participants: Record<string, Participant>;
  currentParticipantId: string | null;
  tripId?: string;
  onShareToGroup?: (messageId: string) => Promise<void>;
}

function Avatar({
  label,
  color,
  icon,
}: {
  label: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={color ? { backgroundColor: color } : undefined}
      aria-hidden
    >
      {icon ?? label.charAt(0).toUpperCase()}
    </div>
  );
}

interface ParsedContent {
  places: PlaceResult[];
  text: string;
}

function parsePlacesBlock(content: string): ParsedContent {
  const marker = ":::places";
  const startIdx = content.indexOf(marker);
  if (startIdx === -1) return { places: [], text: content };

  const jsonStart = startIdx + marker.length;
  const endMarker = ":::";
  const afterJson = content.indexOf(endMarker, jsonStart);
  if (afterJson === -1) return { places: [], text: content };

  const jsonStr = content.slice(jsonStart, afterJson).trim();
  const remaining = content.slice(0, startIdx).trim() + "\n" + content.slice(afterJson + endMarker.length).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return { places: [], text: content };
    const places: PlaceResult[] = parsed
      .filter(
        (p: unknown) =>
          typeof p === "object" &&
          p !== null &&
          "name" in p &&
          "lat" in p &&
          "lng" in p
      )
      .map((p: Record<string, unknown>) => ({
        name: String(p.name),
        place_id: p.place_id ? String(p.place_id) : undefined,
        lat: Number(p.lat),
        lng: Number(p.lng),
        category: String(p.category ?? "other"),
        summary: p.summary ? String(p.summary) : undefined,
      }));
    return { places, text: remaining.trim() };
  } catch {
    return { places: [], text: content };
  }
}

export function MessageBubble({
  message,
  participants,
  currentParticipantId,
  tripId,
  onShareToGroup,
}: Props) {
  const canShare =
    !!onShareToGroup &&
    (message.sender_type === "agent" || message.sender_type === "subagent") &&
    message.thinking_state !== "thinking" &&
    !!message.content;
  const isUser = message.sender_type === "user";
  const isAgent = message.sender_type === "agent";
  const isSubagent = message.sender_type === "subagent";
  const isSystem = message.sender_type === "system";
  const mine =
    isUser && message.sender_participant_id === currentParticipantId;

  const sender = message.sender_participant_id
    ? participants[message.sender_participant_id]
    : undefined;

  const shared = !!message.shared_from_room_id;

  // Parse :::places blocks from agent/subagent messages
  const isBotMessage = isAgent || isSubagent;
  const { places, text: contentText } =
    isBotMessage && message.content
      ? parsePlacesBlock(message.content)
      : { places: [], text: message.content };

  if (isSystem) {
    return (
      <div className="my-4 text-center text-xs text-muted-foreground">
        {message.content}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex w-full items-end gap-2 animate-fade-in",
        mine ? "flex-row-reverse" : "flex-row"
      )}
    >
      {!mine ? (
        <>
          {isUser && sender ? (
            <Avatar label={sender.display_name} color={sender.color} />
          ) : null}
          {isAgent ? (
            <BotAvatar
              state={
                message.thinking_state === "thinking"
                  ? "thinking"
                  : message.thinking_state === "streaming"
                    ? "speaking"
                    : message.thinking_state === "done"
                      ? "happy"
                      : "idle"
              }
            />
          ) : null}
          {isSubagent ? (
            <BotAvatar
              state={
                message.thinking_state === "thinking"
                  ? "thinking"
                  : message.thinking_state === "streaming"
                    ? "speaking"
                    : "idle"
              }
              size={24}
            />
          ) : null}
        </>
      ) : null}

      <div
        className={cn(
          "flex max-w-[78%] flex-col gap-1",
          mine ? "items-end" : "items-start"
        )}
      >
        {!mine && (isAgent || isSubagent) ? (
          <span className="px-1 text-[11px] font-medium text-muted-foreground">
            {isSubagent ? "Research Agent" : "Agent"}
          </span>
        ) : null}
        {!mine && isUser && sender ? (
          <span className="px-1 text-[11px] font-medium text-muted-foreground">
            {sender.display_name}
          </span>
        ) : null}
        {shared ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
            <Sparkles className="size-3" />
            Shared from private research
          </span>
        ) : null}
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
            mine
              ? "bg-primary text-primary-foreground"
              : isAgent
                ? "bg-muted text-foreground"
                : isSubagent
                  ? "border-l-4 border-violet-500 bg-violet-50 text-foreground dark:bg-violet-950/40"
                  : "bg-secondary text-secondary-foreground",
            shared ? "border-l-4 border-violet-500" : "",
            message.optimistic ? "opacity-50" : "opacity-100",
            message.failed ? "border border-destructive" : "",
            message.thinking_state === "failed"
              ? "border border-destructive bg-destructive/10 text-destructive"
              : ""
          )}
        >
          {message.thinking_state === "thinking" && !message.content ? (
            <ThinkingIndicator />
          ) : isUser ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : (
            <Markdown>{contentText || message.content}</Markdown>
          )}
          {message.thinking_state === "streaming" && message.content ? (
            <span className="ml-0.5 inline-block size-1.5 animate-pulse rounded-full bg-current align-middle" />
          ) : null}
        </div>

        {/* Rich place cards from :::places block */}
        {places.length > 0 && tripId ? (
          <div className="grid grid-cols-1 gap-2 w-full mt-1">
            {places.map((place, i) => (
              <PlaceResultCard
                key={`${place.name}-${i}`}
                place={place}
                tripId={tripId}
              />
            ))}
          </div>
        ) : null}

        {message.failed ? (
          <span className="px-1 text-[10px] text-destructive">
            Failed to send
          </span>
        ) : null}
        {canShare ? (
          <ShareToGroupButton
            messageId={message.id}
            onShare={onShareToGroup!}
          />
        ) : null}
      </div>
    </div>
  );
}
