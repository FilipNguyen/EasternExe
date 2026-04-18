import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { runAgent } from "@/lib/agent/main";
import type { ChatRoom } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const roomId = url.searchParams.get("room_id");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
  if (!roomId) {
    return NextResponse.json({ error: "room_id required" }, { status: 400 });
  }
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ messages: data ?? [] });
}

const bodySchema = z.object({
  room_id: z.string().uuid(),
  sender_participant_id: z.string().uuid().nullable().optional(),
  sender_type: z
    .enum(["user", "agent", "subagent", "system"])
    .default("user"),
  sender_label: z.string().max(60).nullable().optional(),
  content: z.string().min(1).max(8000),
  parent_message_id: z.string().uuid().nullable().optional(),
});

const AGENT_MENTION = /@agent\b/i;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServerClient();

  // Insert the user message first
  const { data: inserted, error } = await supabase
    .from("chat_messages")
    .insert({
      room_id: parsed.data.room_id,
      sender_participant_id: parsed.data.sender_participant_id ?? null,
      sender_type: parsed.data.sender_type,
      sender_label: parsed.data.sender_label ?? null,
      content: parsed.data.content,
      parent_message_id: parsed.data.parent_message_id ?? null,
    })
    .select()
    .single();

  if (error || !inserted) {
    return NextResponse.json(
      { error: error?.message ?? "Could not insert message" },
      { status: 500 }
    );
  }

  // Agent trigger: only on user messages.
  if (parsed.data.sender_type === "user") {
    const { data: roomData } = await supabase
      .from("chat_rooms")
      .select("*")
      .eq("id", parsed.data.room_id)
      .maybeSingle();
    const room = roomData as ChatRoom | null;

    const shouldTrigger =
      room &&
      ((room.type === "group" && AGENT_MENTION.test(parsed.data.content)) ||
        (room.type === "agent" &&
          room.owner_id === parsed.data.sender_participant_id));

    if (shouldTrigger && room) {
      const { data: placeholder } = await supabase
        .from("chat_messages")
        .insert({
          room_id: room.id,
          sender_type: "agent",
          sender_label: "Agent",
          content: "",
          thinking_state: "thinking",
          parent_message_id: (inserted as { id: string }).id,
        })
        .select()
        .single();

      if (placeholder) {
        // Fire-and-forget. The agent pipeline updates the placeholder row
        // in-place; clients see the progress via realtime.
        void runAgent({
          tripId: room.trip_id,
          roomId: room.id,
          placeholderMessageId: (placeholder as { id: string }).id,
          triggerMessageId: (inserted as { id: string }).id,
        }).catch((e) => {
          console.error("runAgent crashed:", e);
        });
      }
    }
  }

  return NextResponse.json({ message: inserted });
}
