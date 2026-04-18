"use client";

import { useState } from "react";
import { Share2, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Props {
  messageId: string;
  onShare: (messageId: string) => Promise<void>;
}

type State = "idle" | "confirming" | "sharing" | "done" | "error";

export function ShareToGroupButton({ messageId, onShare }: Props) {
  const [state, setState] = useState<State>("idle");

  const handleConfirm = async () => {
    setState("sharing");
    try {
      await onShare(messageId);
      setState("done");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  };

  if (state === "confirming") {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1 shadow-sm">
        <span className="text-[11px] text-muted-foreground">Share to group?</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setState("idle")}
        >
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleConfirm}>
          Yes, share
        </Button>
      </div>
    );
  }

  if (state === "sharing") {
    return (
      <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Sharing…
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-green-600">
        <Check className="size-3" /> Shared to group
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-destructive">
        Failed — try again
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setState("confirming")}
      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
    >
      <Share2 className="size-3" />
      Share to group
    </button>
  );
}
