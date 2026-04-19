"use client";

import { useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  StepTripBasics,
  type TripBasicsState,
} from "@/components/setup/StepTripBasics";
import {
  StepParticipants,
  type ParticipantDraft,
} from "@/components/setup/StepParticipants";
import {
  StepUploads,
  type FileDraft,
} from "@/components/setup/StepUploads";
import {
  StepIntros,
  type IntroDraft,
} from "@/components/setup/StepIntros";
import { StepReview } from "@/components/setup/StepReview";
import { pickColor } from "@/lib/colors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type StepIndex = 1 | 2 | 3 | 4 | 5;

interface SetupState {
  step: StepIndex;
  basics: TripBasicsState;
  participants: ParticipantDraft[];
  files: FileDraft[];
  intros: Record<string, IntroDraft>;
}

type Action =
  | { type: "SET_STEP"; step: StepIndex }
  | { type: "SET_BASICS"; value: TripBasicsState }
  | { type: "SET_PARTICIPANTS"; value: ParticipantDraft[] }
  | { type: "SET_FILES"; value: FileDraft[] }
  | { type: "SET_INTROS"; value: Record<string, IntroDraft> };

const initialState: SetupState = {
  step: 1,
  basics: { name: "", destination: "", start_date: "", end_date: "" },
  participants: [
    { tempId: crypto.randomUUID(), display_name: "", color: pickColor(0) },
    { tempId: crypto.randomUUID(), display_name: "", color: pickColor(1) },
  ],
  files: [],
  intros: {},
};

function reducer(state: SetupState, action: Action): SetupState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step };
    case "SET_BASICS":
      return { ...state, basics: action.value };
    case "SET_PARTICIPANTS":
      return { ...state, participants: action.value };
    case "SET_FILES":
      return { ...state, files: action.value };
    case "SET_INTROS":
      return { ...state, intros: action.value };
    default:
      return state;
  }
}

const STEP_LABELS = ["Basics", "People", "Files", "Notes", "Review"] as const;

export default function SetupPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  const validateStep = (step: StepIndex): string | null => {
    if (step === 1) {
      if (!state.basics.name.trim()) return "Trip name is required.";
      if (!state.basics.destination.trim()) return "Destination is required.";
    }
    if (step === 2) {
      const named = state.participants.filter((p) =>
        p.display_name.trim()
      );
      if (named.length < 2) return "At least 2 named participants.";
    }
    return null;
  };

  const next = () => {
    const err = validateStep(state.step);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    if (state.step < 5) {
      dispatch({ type: "SET_STEP", step: (state.step + 1) as StepIndex });
    } else {
      void submit();
    }
  };

  const back = () => {
    setStepError(null);
    if (state.step > 1) {
      dispatch({ type: "SET_STEP", step: (state.step - 1) as StepIndex });
    } else {
      router.push("/");
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setSubmitMessage("Saving trip…");

    try {
      const cleanParticipants = state.participants
        .filter((p) => p.display_name.trim())
        .map((p) => ({
          tempId: p.tempId,
          display_name: p.display_name.trim(),
          color: p.color,
        }));

      const tripRes = await fetch("/api/trips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: state.basics.name.trim(),
          destination: state.basics.destination.trim(),
          start_date: state.basics.start_date || null,
          end_date: state.basics.end_date || null,
          participants: cleanParticipants.map((p) => ({
            display_name: p.display_name,
            color: p.color,
          })),
        }),
      });
      if (!tripRes.ok) {
        const body = await tripRes.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to create trip (${tripRes.status})`);
      }
      const {
        trip,
        participants: createdParticipants,
      }: {
        trip: { id: string };
        participants: { id: string; display_name: string }[];
      } = await tripRes.json();

      // Map tempId → created id via name match (insertion order preserved server-side)
      const tempIdToId: Record<string, string> = {};
      cleanParticipants.forEach((p, i) => {
        tempIdToId[p.tempId] = createdParticipants[i]?.id;
      });

      // Store participantId in localStorage for the creator (assume first participant)
      const self = createdParticipants[0];
      if (self && typeof window !== "undefined") {
        window.localStorage.setItem(`participantId_${trip.id}`, self.id);
      }

      // Upload files
      const notesCount = Object.values(state.intros).filter((i) =>
        i?.notes?.trim()
      ).length;
      const total = state.files.length + notesCount;
      let done = 0;
      const bump = (label: string) => {
        done += 1;
        setSubmitMessage(`${label} (${done}/${total})`);
      };

      const supabase = getSupabaseBrowserClient();

      for (const f of state.files) {
        const path = `${trip.id}/${crypto.randomUUID()}-${f.file.name}`;
        const { error: upErr } = await supabase.storage
          .from("trip-uploads")
          .upload(path, f.file, { upsert: false, contentType: f.file.type });
        if (upErr) throw new Error(`Upload failed for ${f.file.name}: ${upErr.message}`);
        const registerRes = await fetch("/api/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            trip_id: trip.id,
            kind: f.kind,
            storage_path: path,
            filename: f.file.name,
          }),
        });
        if (!registerRes.ok) throw new Error("Failed to register upload");
        bump(`Uploaded ${f.file.name}`);
      }

      // Upload per-participant notes (as text files, ingestion reads them
      // back alongside shared materials)
      for (const p of cleanParticipants) {
        const intro = state.intros[p.tempId];
        if (!intro?.notes?.trim()) continue;
        const participantId = tempIdToId[p.tempId];
        const noteBlob = new Blob([intro.notes.trim()], {
          type: "text/plain",
        });
        const path = `${trip.id}/${participantId}-notes.txt`;
        const { error: upErr } = await supabase.storage
          .from("trip-uploads")
          .upload(path, noteBlob, {
            upsert: true,
            contentType: "text/plain",
          });
        if (upErr) {
          throw new Error(
            `Notes upload failed for ${p.display_name}: ${upErr.message}`
          );
        }
        const registerRes = await fetch("/api/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            trip_id: trip.id,
            participant_id: participantId,
            kind: "other",
            storage_path: path,
            filename: `${p.display_name} notes.txt`,
          }),
        });
        if (!registerRes.ok) throw new Error("Failed to register notes");
        bump(`Saved ${p.display_name}'s notes`);
      }

      setSubmitMessage("Starting ingestion…");
      // Fire-and-forget: the server pipeline awaits many LLM + Places calls,
      // which take 30–120s. We don't block the UI.
      void fetch(`/api/ingest/${trip.id}`, {
        method: "POST",
        keepalive: true,
      }).catch(() => undefined);

      setSubmitMessage("Opening workspace…");
      router.push(`/trip/${trip.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setSubmitting(false);
    }
  };

  const progressPct = ((state.step - 1) / 4) * 100;

  return (
    <main className="min-h-dvh bg-background">
      <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <div className="text-sm font-semibold tracking-tight">Quorum</div>
          <div className="text-xs text-muted-foreground">
            Step {state.step} of 5 · {STEP_LABELS[state.step - 1]}
          </div>
        </div>
        <Progress value={progressPct} className="rounded-none" />
      </div>

      <div className="mx-auto w-full max-w-2xl px-6 py-10 pb-40">
        {state.step === 1 && (
          <StepTripBasics
            value={state.basics}
            onChange={(v) => dispatch({ type: "SET_BASICS", value: v })}
          />
        )}
        {state.step === 2 && (
          <StepParticipants
            value={state.participants}
            onChange={(v) => dispatch({ type: "SET_PARTICIPANTS", value: v })}
            error={stepError ?? undefined}
          />
        )}
        {state.step === 3 && (
          <StepUploads
            value={state.files}
            onChange={(v) => dispatch({ type: "SET_FILES", value: v })}
          />
        )}
        {state.step === 4 && (
          <StepIntros
            participants={state.participants.filter((p) =>
              p.display_name.trim()
            )}
            intros={state.intros}
            onChange={(v) => dispatch({ type: "SET_INTROS", value: v })}
          />
        )}
        {state.step === 5 && (
          <StepReview
            basics={state.basics}
            participants={state.participants.filter((p) =>
              p.display_name.trim()
            )}
            files={state.files}
            intros={state.intros}
          />
        )}
      </div>

      {stepError && state.step === 1 ? (
        <p className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground shadow">
          {stepError}
        </p>
      ) : null}
      {error ? (
        <p className="fixed bottom-24 left-1/2 w-[min(90%,36rem)] -translate-x-1/2 rounded-md bg-destructive px-3 py-2 text-center text-xs text-destructive-foreground shadow">
          {error}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={back}
            disabled={submitting}
          >
            <ArrowLeft /> {state.step === 1 ? "Home" : "Back"}
          </Button>

          <div className="text-xs text-muted-foreground">
            {submitting ? submitMessage : null}
          </div>

          <Button type="button" onClick={next} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="animate-spin" /> Working…
              </>
            ) : state.step === 5 ? (
              <>
                Continue <ArrowRight />
              </>
            ) : (
              <>
                Next <ArrowRight />
              </>
            )}
          </Button>
        </div>
      </div>
    </main>
  );
}
