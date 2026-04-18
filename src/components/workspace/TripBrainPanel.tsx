"use client";

import { useState } from "react";
import {
  Calendar,
  CheckSquare,
  ListTodo,
  MapPin,
  Plane,
  Square,
  Sparkles,
  Trophy,
  Brain,
} from "lucide-react";

import { useTripBrain } from "@/hooks/useTripBrain";
import { PlacesPanel } from "@/components/workspace/PlacesPanel";
import { cn } from "@/lib/utils";
import type { Place } from "@/types/db";

interface Props {
  tripId: string;
  places: Place[];
}

type BrainTab = "plan" | "places" | "todo" | "logistics";

const TABS: {
  id: BrainTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}[] = [
  { id: "plan", label: "Plan", icon: Sparkles, accent: "#22c55e" },
  { id: "places", label: "Places", icon: MapPin, accent: "#0ea5e9" },
  { id: "todo", label: "To-do", icon: ListTodo, accent: "#f59e0b" },
  { id: "logistics", label: "Travel", icon: Plane, accent: "#8b5cf6" },
];

// Decide which "logistics" bucket a decision string falls into.
function categorizeDecision(text: string): {
  kind: "travel" | "other";
  icon: React.ComponentType<{ className?: string }>;
} {
  const t = text.toLowerCase();
  if (/flight|airline|airport|\bana\b|klm|air canada|nrt|hnd/.test(t)) {
    return { kind: "travel", icon: Plane };
  }
  if (/\baccommodation|hotel|airbnb|room|futon|tatami|bed|night\b/.test(t)) {
    return { kind: "travel", icon: Calendar };
  }
  if (/date|april|day|schedule/.test(t)) {
    return { kind: "travel", icon: Calendar };
  }
  return { kind: "other", icon: Trophy };
}

export function TripBrainPanel({ tripId, places }: Props) {
  const brain = useTripBrain(tripId);
  const [tab, setTab] = useState<BrainTab>("plan");
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set());

  const priorities = brain?.memory?.priorities ?? [];
  const decisions = brain?.memory?.decisions_made ?? [];
  const openQuestions = brain?.memory?.open_questions ?? [];
  const constraints = brain?.memory?.constraints ?? [];

  const travelDecisions = decisions.filter(
    (d) => categorizeDecision(d).kind === "travel"
  );

  const counts = {
    plan: priorities.length + decisions.filter((d) => categorizeDecision(d).kind === "other").length,
    places: brain?.placesTotal ?? places.length,
    todo: openQuestions.length,
    logistics: travelDecisions.length + constraints.length,
  };

  return (
    <aside className="flex h-full w-full min-h-0 flex-col border-l bg-background/60 text-sm">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Brain className="size-4 text-violet-500" />
        <div>
          <div className="text-sm font-semibold">Trip dashboard</div>
          <div className="text-[11px] text-muted-foreground">
            Ingested from chat + notes
          </div>
        </div>
      </div>

      <div className="flex items-stretch gap-0.5 border-b px-1 py-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === tab;
          const count = counts[t.id];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] font-medium uppercase tracking-wide transition-colors",
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              style={isActive ? { color: t.accent } : undefined}
            >
              <Icon className="size-4" />
              <span className="leading-none">{t.label}</span>
              {count > 0 ? (
                <span className="text-[9px] tabular-nums opacity-70">
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "plan" ? (
          <PlanTab priorities={priorities} decisions={decisions} />
        ) : tab === "places" ? (
          <PlacesPanel places={places} />
        ) : tab === "todo" ? (
          <TodoTab
            items={openQuestions}
            done={doneIds}
            onToggle={(i) =>
              setDoneIds((prev) => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                return next;
              })
            }
          />
        ) : (
          <LogisticsTab
            constraints={constraints}
            decisions={decisions.filter(
              (d) => categorizeDecision(d).kind === "travel"
            )}
          />
        )}
      </div>
    </aside>
  );
}

function PlanTab({
  priorities,
  decisions,
}: {
  priorities: string[];
  decisions: string[];
}) {
  const planDecisions = decisions.filter(
    (d) => categorizeDecision(d).kind === "other"
  );

  if (priorities.length === 0 && planDecisions.length === 0) {
    return <EmptyState label="Plan is still forming." />;
  }

  return (
    <div className="space-y-5">
      {priorities.length > 0 ? (
        <div>
          <SectionLabel
            icon={Sparkles}
            label="What we're prioritizing"
            accent="#22c55e"
          />
          <ul className="mt-2 space-y-2">
            {priorities.map((p, i) => (
              <li
                key={i}
                className="rounded-md border bg-background/80 p-2.5 text-xs leading-snug"
                style={{ borderLeftColor: "#22c55e", borderLeftWidth: 3 }}
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {planDecisions.length > 0 ? (
        <div>
          <SectionLabel
            icon={Trophy}
            label="Already decided"
            accent="#8b5cf6"
          />
          <ul className="mt-2 space-y-2">
            {planDecisions.map((d, i) => (
              <li
                key={i}
                className="rounded-md border bg-background/80 p-2.5 text-xs leading-snug"
                style={{ borderLeftColor: "#8b5cf6", borderLeftWidth: 3 }}
              >
                {d}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TodoTab({
  items,
  done,
  onToggle,
}: {
  items: string[];
  done: Set<number>;
  onToggle: (i: number) => void;
}) {
  if (items.length === 0) {
    return <EmptyState label="Nothing open — nice." />;
  }
  return (
    <div>
      <SectionLabel
        icon={ListTodo}
        label={`${done.size} of ${items.length} done`}
        accent="#f59e0b"
      />
      <ul className="mt-2 space-y-1.5">
        {items.map((q, i) => {
          const isDone = done.has(i);
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onToggle(i)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md border bg-background/80 p-2.5 text-left text-xs leading-snug transition-colors hover:border-foreground/30",
                  isDone && "opacity-60"
                )}
              >
                {isDone ? (
                  <CheckSquare className="size-4 shrink-0 text-green-600" />
                ) : (
                  <Square className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className={isDone ? "line-through" : undefined}>{q}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LogisticsTab({
  constraints,
  decisions,
}: {
  constraints: string[];
  decisions: string[];
}) {
  if (constraints.length === 0 && decisions.length === 0) {
    return <EmptyState label="No travel details logged yet." />;
  }
  return (
    <div className="space-y-5">
      {decisions.length > 0 ? (
        <div>
          <SectionLabel icon={Plane} label="Bookings & dates" accent="#8b5cf6" />
          <ul className="mt-2 space-y-2">
            {decisions.map((d, i) => {
              const Icon = categorizeDecision(d).icon;
              return (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md border bg-background/80 p-2.5 text-xs leading-snug"
                >
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-violet-500" />
                  <span>{d}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {constraints.length > 0 ? (
        <div>
          <SectionLabel
            icon={CheckSquare}
            label="Hard constraints"
            accent="#0ea5e9"
          />
          <ul className="mt-2 space-y-2">
            {constraints.map((c, i) => (
              <li
                key={i}
                className="rounded-md border bg-background/80 p-2.5 text-xs leading-snug"
                style={{ borderLeftColor: "#0ea5e9", borderLeftWidth: 3 }}
              >
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SectionLabel({
  icon: Icon,
  label,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  accent: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: accent }}
    >
      <Icon className="size-3.5" />
      {label}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
      {label}
    </div>
  );
}
