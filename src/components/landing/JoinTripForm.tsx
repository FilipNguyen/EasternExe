"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extractTripId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(UUID_RE);
  return match ? match[0].toLowerCase() : null;
}

export function JoinTripForm() {
  const router = useRouter();
  const [tripRef, setTripRef] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const tripId = extractTripId(tripRef);
    if (!tripId) {
      setError("Paste a trip URL or trip ID.");
      return;
    }
    if (!name.trim()) {
      setError("Enter your first name.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/find-participant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        participantId?: string;
        error?: string;
        available?: string[];
      };

      if (!res.ok || !body.participantId) {
        const hint = body.available?.length
          ? ` — group has: ${body.available.join(", ")}`
          : "";
        setError((body.error ?? "Could not join trip") + hint);
        setBusy(false);
        return;
      }

      window.localStorage.setItem(
        `participantId_${tripId}`,
        body.participantId
      );
      router.push(`/trip/${tripId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mt-6 w-full max-w-sm rounded-xl border bg-background/80 p-4 text-left shadow-sm backdrop-blur"
    >
      <p className="mb-3 text-xs font-medium text-muted-foreground">
        Join an existing trip
      </p>
      <div className="space-y-2">
        <Input
          name="trip"
          placeholder="Trip URL or ID"
          value={tripRef}
          onChange={(e) => setTripRef(e.target.value)}
          disabled={busy}
          autoComplete="off"
        />
        <Input
          name="firstName"
          placeholder="Your first name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          autoComplete="given-name"
        />
      </div>
      {error ? (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      ) : null}
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        disabled={busy}
      >
        {busy ? (
          <>
            <Loader2 className="animate-spin" /> Joining…
          </>
        ) : (
          <>
            Join trip <ArrowRight />
          </>
        )}
      </Button>
    </form>
  );
}
