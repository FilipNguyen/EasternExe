"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageSkeleton } from "@/components/chat/MessageSkeleton";
import type { Participant } from "@/types/db";
import type { OptimisticMessage } from "@/hooks/useChatMessages";

interface Props {
  messages: OptimisticMessage[];
  loading?: boolean;
  participants: Record<string, Participant>;
  currentParticipantId: string | null;
  tripId?: string;
  emptyState?: React.ReactNode;
  onShareToGroup?: (messageId: string) => Promise<void>;
}

const SCROLL_THRESHOLD_PX = 100;

export function MessageList({
  messages,
  loading,
  participants,
  currentParticipantId,
  tripId,
  emptyState,
  onShareToGroup,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  // Track scroll position
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const delta = el.scrollHeight - el.scrollTop - el.clientHeight;
      setAtBottom(delta < SCROLL_THRESHOLD_PX);
    };
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll on new message if we were at bottom
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [messages, atBottom]);

  const scrollToBottom = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={ref}
        className="h-full overflow-y-auto px-4 py-6 sm:px-6"
      >
        {loading && messages.length === 0 ? (
          <MessageSkeleton />
        ) : messages.length === 0 && emptyState ? (
          <div className="flex h-full items-center justify-center">
            {emptyState}
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                participants={participants}
                currentParticipantId={currentParticipantId}
                tripId={tripId}
                onShareToGroup={onShareToGroup}
              />
            ))}
          </div>
        )}
      </div>

      {!atBottom ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg"
        >
          <ArrowDown /> New messages
        </Button>
      ) : null}
    </div>
  );
}
