"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { ParticipantDraft } from "@/components/setup/StepParticipants";

export interface IntroDraft {
  notes: string;
}

interface Props {
  participants: ParticipantDraft[];
  intros: Record<string, IntroDraft>;
  onChange: (next: Record<string, IntroDraft>) => void;
}

export function StepIntros({ participants, intros, onChange }: Props) {
  const update = (tempId: string, notes: string) => {
    onChange({
      ...intros,
      [tempId]: { notes },
    });
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-8">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">
          About each person
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          A few sentences per person — what they&apos;re into, what they
          don&apos;t want. These feed their profile directly. Skipping means
          the AI knows them only from the shared materials.
        </p>
      </header>

      <div className="space-y-4">
        {participants.map((p) => {
          const draft = intros[p.tempId] ?? { notes: "" };
          return (
            <div
              key={p.tempId}
              className="space-y-3 rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ backgroundColor: p.color }}
                  aria-hidden
                >
                  {p.display_name.trim().charAt(0).toUpperCase() || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {p.display_name || "Unnamed"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {draft.notes.trim()
                      ? `${draft.notes.trim().length} chars`
                      : "No notes yet"}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor={`notes-${p.tempId}`}
                  className="text-xs text-muted-foreground"
                >
                  Notes
                </Label>
                <Textarea
                  id={`notes-${p.tempId}`}
                  placeholder="e.g. Loves ramen, vegetarian, gets cranky after 11pm, wants one chill day"
                  value={draft.notes}
                  onChange={(e) => update(p.tempId, e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
