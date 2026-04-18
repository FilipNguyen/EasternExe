"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const AGENT_MENTION = /@agent\b/i;

interface Props {
  placeholder?: string;
  onSend: (content: string) => Promise<void> | void;
  disabled?: boolean;
  /** If true, sending triggers the agent regardless of @mention (e.g. private tab). */
  alwaysTriggersAgent?: boolean;
  /** Incrementing key that re-triggers the prefill; paired with `prefillContent`. */
  prefillKey?: number;
  prefillContent?: string;
}

export function ChatInput({
  placeholder,
  onSend,
  disabled,
  alwaysTriggersAgent,
  prefillKey,
  prefillContent,
}: Props) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (prefillKey && prefillContent) {
      setValue(prefillContent);
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [prefillKey, prefillContent]);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || sending || disabled) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setValue("");
      requestAnimationFrame(() => ref.current?.focus());
    } finally {
      setSending(false);
    }
  };

  const willTriggerAgent =
    alwaysTriggersAgent || AGENT_MENTION.test(value);

  return (
    <div className="border-t bg-background/80 backdrop-blur">
      {willTriggerAgent && value.trim().length > 0 ? (
        <div className="mx-auto flex max-w-3xl items-center gap-1.5 px-4 pt-2 text-[11px] font-medium text-violet-600 sm:px-6">
          <Sparkles className="size-3" />
          Agent will respond when you send
        </div>
      ) : null}
      <div className="mx-auto flex max-w-3xl items-end gap-2 px-4 py-3 sm:px-6">
        <Textarea
          ref={ref}
          value={value}
          placeholder={placeholder ?? "Message the group…"}
          disabled={disabled || sending}
          rows={1}
          className="min-h-9 resize-none"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          onClick={submit}
          disabled={!value.trim() || sending || disabled}
          aria-label="Send"
        >
          <Send />
        </Button>
      </div>
    </div>
  );
}
