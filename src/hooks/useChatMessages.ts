"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ChatMessage, SenderType, ThinkingState } from "@/types/db";

export interface OptimisticMessage extends ChatMessage {
  optimistic?: boolean;
  failed?: boolean;
}

interface SendArgs {
  content: string;
  senderParticipantId: string | null;
  senderType?: SenderType;
  senderLabel?: string | null;
  parentMessageId?: string | null;
}

const INITIAL_LIMIT = 100;
const POLL_INTERVAL_MS = 3000;

export function useChatMessages(roomId: string | undefined) {
  const [messages, setMessages] = useState<OptimisticMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const mergedIds = useRef<Set<string>>(new Set());
  const pollTimerRef = useRef<ReturnType<typeof setInterval>>();

  const mergeIn = useCallback((next: OptimisticMessage[]) => {
    setMessages((prev) => {
      const map = new Map<string, OptimisticMessage>();
      for (const m of prev) map.set(m.id, m);
      for (const m of next) {
        // If the server-sent row matches an optimistic placeholder by content+sender,
        // drop the optimistic first.
        if (!m.optimistic && !mergedIds.current.has(m.id)) {
          for (const [k, v] of map) {
            if (
              v.optimistic &&
              v.content === m.content &&
              v.sender_participant_id === m.sender_participant_id
            ) {
              map.delete(k);
            }
          }
        }
        map.set(m.id, m);
        mergedIds.current.add(m.id);
      }
      return Array.from(map.values()).sort(
        (a, b) => +new Date(a.created_at) - +new Date(b.created_at)
      );
    });
  }, []);

  // Fetch messages from the API
  const fetchMessages = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await fetch(
        `/api/messages?room_id=${roomId}&limit=${INITIAL_LIMIT}`,
        { cache: "no-store" }
      );
      const body = (await res.json().catch(() => ({}))) as {
        messages?: OptimisticMessage[];
      };
      if (body.messages) mergeIn(body.messages);
    } catch (e) {
      console.error("Failed to poll messages:", e);
    }
  }, [roomId, mergeIn]);

  useEffect(() => {
    if (!roomId) {
      setMessages([]);
      mergedIds.current = new Set();
      return;
    }
    let active = true;
    const supabase = getSupabaseBrowserClient();
    // Reset state when switching rooms so messages from a previous room
    // can't bleed into the new one via the merge-by-id state carry-over.
    setMessages([]);
    mergedIds.current = new Set();

    // Initial load
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/messages?room_id=${roomId}&limit=${INITIAL_LIMIT}`,
          { cache: "no-store" }
        );
        const body = (await res.json().catch(() => ({}))) as {
          messages?: OptimisticMessage[];
        };
        if (!active) return;
        if (body.messages) mergeIn(body.messages);
      } catch (e) {
        console.error("Failed to load messages:", e);
      } finally {
        if (active) setLoading(false);
      }
    })();

    // Realtime subscription for instant updates
    const channel = supabase
      .channel(`chat:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => mergeIn([payload.new as OptimisticMessage])
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => mergeIn([payload.new as OptimisticMessage])
      )
      .subscribe((status) => {
        // If realtime fails or is stuck at connecting, the polling fallback
        // will keep things moving
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("Realtime subscription issue, relying on polling:", status);
        }
      });

    // Polling fallback: every 3 seconds, fetch latest messages.
    // This ensures updates arrive even if realtime is not configured on the table.
    pollTimerRef.current = setInterval(() => {
      fetchMessages();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      supabase.removeChannel(channel);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [roomId, mergeIn, fetchMessages]);

  const send = useCallback(
    async ({
      content,
      senderParticipantId,
      senderType = "user",
      senderLabel = null,
      parentMessageId = null,
    }: SendArgs) => {
      if (!roomId || !content.trim()) return;

      const tempId = `optimistic-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      const optimistic: OptimisticMessage = {
        id: tempId,
        room_id: roomId,
        sender_participant_id: senderParticipantId,
        sender_type: senderType,
        sender_label: senderLabel,
        content: content.trim(),
        attachments: [],
        parent_message_id: parentMessageId,
        shared_from_room_id: null,
        shared_by_participant_id: null,
        thinking_state: null,
        tool_calls: [],
        metadata: {},
        created_at: now,
        optimistic: true,
      };
      setMessages((prev) =>
        [...prev, optimistic].sort(
          (a, b) => +new Date(a.created_at) - +new Date(b.created_at)
        )
      );

      try {
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            room_id: roomId,
            content: content.trim(),
            sender_participant_id: senderParticipantId,
            sender_type: senderType,
            parent_message_id: parentMessageId,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Send failed (${res.status})`);
        }

        // Immediately confirm by merging the server response.
        // The POST returns the inserted message, so we can confirm right away
        // without waiting for realtime.
        const inserted = (await res.json().catch(() => ({}))) as {
          message?: OptimisticMessage;
        };
        if (inserted.message) {
          mergeIn([inserted.message]);
        }
      } catch (e) {
        console.error("send failed:", e);
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, failed: true } : m))
        );
      }
    },
    [roomId, mergeIn]
  );

  return { messages, loading, send } as const;
}

export type { ThinkingState };
