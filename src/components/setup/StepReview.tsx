"use client";

import { Calendar, MapPin, Users, FileStack, StickyNote } from "lucide-react";

import type { TripBasicsState } from "@/components/setup/StepTripBasics";
import type { ParticipantDraft } from "@/components/setup/StepParticipants";
import type { FileDraft } from "@/components/setup/StepUploads";
import type { IntroDraft } from "@/components/setup/StepIntros";

interface Props {
  basics: TripBasicsState;
  participants: ParticipantDraft[];
  files: FileDraft[];
  intros: Record<string, IntroDraft>;
}

export function StepReview({ basics, participants, files, intros }: Props) {
  const notesFilled = participants.filter((p) =>
    intros[p.tempId]?.notes?.trim()
  ).length;

  const Row = ({
    icon,
    label,
    value,
  }: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
  }) => (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 text-sm">{value}</div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-xl space-y-8">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Review</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Everything looks right? Hit continue — we&apos;ll save this and you
          can run ingestion from the workspace.
        </p>
      </header>

      <div className="divide-y rounded-xl border bg-card p-5 shadow-sm">
        <Row
          icon={<MapPin className="size-4" />}
          label="Trip"
          value={
            <div>
              <div className="font-medium">{basics.name || "—"}</div>
              <div className="text-muted-foreground">
                {basics.destination || "no destination"}
              </div>
            </div>
          }
        />
        {basics.start_date || basics.end_date ? (
          <Row
            icon={<Calendar className="size-4" />}
            label="Dates"
            value={
              <div>
                {basics.start_date || "?"} → {basics.end_date || "?"}
              </div>
            }
          />
        ) : null}
        <Row
          icon={<Users className="size-4" />}
          label={`Participants (${participants.length})`}
          value={
            <div className="flex flex-wrap gap-1.5">
              {participants.map((p) => (
                <span
                  key={p.tempId}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: p.color }}
                    aria-hidden
                  />
                  {p.display_name || "Unnamed"}
                </span>
              ))}
            </div>
          }
        />
        <Row
          icon={<FileStack className="size-4" />}
          label="Shared material"
          value={
            files.length > 0 ? (
              <div>
                {files.length} file{files.length === 1 ? "" : "s"} queued
              </div>
            ) : (
              <div className="text-muted-foreground">None</div>
            )
          }
        />
        <Row
          icon={<StickyNote className="size-4" />}
          label="Notes"
          value={
            <div>
              {notesFilled}/{participants.length} filled in
              {notesFilled === 0
                ? " — profiles will be shallow"
                : ""}
            </div>
          }
        />
      </div>
    </div>
  );
}
