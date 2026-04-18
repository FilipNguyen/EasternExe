"use client";

import { useEffect, useState } from "react";
import { Clock, MapPin, Sparkles } from "lucide-react";

import { AgentActivityPanel } from "@/components/workspace/AgentActivityPanel";
import { useRealtimeLocations } from "@/hooks/useRealtimeLocations";
import type { OptimisticMessage } from "@/hooks/useChatMessages";
import type { Participant, Trip } from "@/types/db";

interface Props {
  trip: Trip;
  participants: Participant[];
  currentParticipantId: string | null;
  messages: OptimisticMessage[];
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return null;
  const fmt = (d: string) => {
    const dt = new Date(d);
    return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  return fmt((start ?? end) as string);
}

function daysUntil(start: string | null) {
  if (!start) return null;
  const diffMs = new Date(start).getTime() - Date.now();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < -1) return `${Math.abs(diffDays)} days in`;
  if (diffDays === -1) return "Started yesterday";
  if (diffDays === 0) return "Starts today";
  if (diffDays === 1) return "Starts tomorrow";
  return `In ${diffDays} days`;
}

export function TripInfoPanel({
  trip,
  participants,
  currentParticipantId,
  messages,
}: Props) {
  const dates = formatDateRange(trip.start_date, trip.end_date);
  const countdown = daysUntil(trip.start_date);

  return (
    <aside className="flex h-full w-full flex-col gap-5 overflow-y-auto border-r bg-background/60 p-4 text-sm">
      <AgentActivityPanel messages={messages} />

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Destination
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-base font-semibold">
          <MapPin className="size-4 text-blue-500" />
          <span className="truncate">{trip.destination ?? "—"}</span>
        </div>
        {dates ? (
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {dates}
            {countdown ? <span className="opacity-70">· {countdown}</span> : null}
          </div>
        ) : null}
      </div>

      <TripStatusRow status={trip.status} />

      <LiveTravelers
        trip={trip}
        participants={participants}
        currentParticipantId={currentParticipantId}
      />

      <RecentActivity messages={messages} participants={participants} />
    </aside>
  );
}

function TripStatusRow({ status }: { status: string }) {
  const style: Record<string, { bg: string; text: string; label: string }> = {
    ready: { bg: "#16a34a22", text: "#15803d", label: "Ready" },
    ingesting: { bg: "#f59e0b22", text: "#b45309", label: "Ingesting…" },
    setup: { bg: "#64748b22", text: "#475569", label: "Setup" },
    error: { bg: "#ef444422", text: "#b91c1c", label: "Error" },
  };
  const s = style[status] ?? style.setup;
  return (
    <div className="flex items-center justify-between rounded-md border p-2">
      <span className="text-[11px] font-medium text-muted-foreground">
        Trip status
      </span>
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{ backgroundColor: s.bg, color: s.text }}
      >
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: s.text }}
          aria-hidden
        />
        {s.label}
      </span>
    </div>
  );
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 30) return "just now";
  if (s < 90) return "1 min ago";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function LiveTravelers({
  trip,
  participants,
  currentParticipantId,
}: {
  trip: Trip;
  participants: Participant[];
  currentParticipantId: string | null;
}) {
  const { locations } = useRealtimeLocations(trip.id);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Travelers
        </div>
        <div className="text-[10px] tabular-nums text-muted-foreground">
          {participants.length}
        </div>
      </div>
      <ul className="space-y-1.5">
        {participants.map((p) => {
          const loc = locations[p.id];
          const isMe = p.id === currentParticipantId;
          const fresh = loc && now - new Date(loc.updated_at).getTime() < 120000;
          return (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-md border bg-background/80 p-2"
            >
              <div className="relative">
                <div
                  className="flex size-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: p.color }}
                >
                  {p.display_name.charAt(0).toUpperCase()}
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 block size-2.5 rounded-full border-2 border-background ${
                    fresh ? "bg-green-500" : "bg-muted-foreground/30"
                  }`}
                  aria-hidden
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">
                  {p.display_name}
                  {isMe ? (
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      (you)
                    </span>
                  ) : null}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {fresh && loc
                    ? `Sharing location · ${relTime(loc.updated_at)}`
                    : loc
                      ? `Last seen ${relTime(loc.updated_at)}`
                      : "Not sharing location"}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RecentActivity({
  messages,
  participants,
}: {
  messages: OptimisticMessage[];
  participants: Participant[];
}) {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const recent = [...messages]
    .reverse()
    .slice(0, 4)
    .reverse();

  if (recent.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="size-3 text-violet-500" />
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recent in chat
        </div>
      </div>
      <ul className="space-y-1.5">
        {recent.map((m) => {
          const sender =
            m.sender_type === "user" && m.sender_participant_id
              ? byId.get(m.sender_participant_id)
              : null;
          const label =
            m.sender_type === "agent"
              ? "Agent"
              : m.sender_type === "subagent"
                ? "Research"
                : sender?.display_name ?? "Someone";
          const color =
            m.sender_type === "agent"
              ? "#1f2937"
              : m.sender_type === "subagent"
                ? "#7c3aed"
                : (sender?.color ?? "#64748b");
          const preview =
            m.content?.replace(/\s+/g, " ").trim().slice(0, 60) ?? "";
          return (
            <li
              key={m.id}
              className="flex items-start gap-2 rounded-md p-1.5 text-[11px]"
            >
              <span
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                style={{ backgroundColor: color }}
              >
                {label.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {relTime(m.created_at)}
                </span>
                <div className="truncate text-muted-foreground">{preview}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
