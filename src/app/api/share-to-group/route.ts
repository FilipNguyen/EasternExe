import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { ChatMessage, ChatRoom } from "@/types/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  message_id: z.string().uuid(),
  group_room_id: z.string().uuid(),
  shared_by_participant_id: z.string().uuid(),
});

const PREAMBLE = "💡 Shared from private research:\n\n";

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

  // Look up the source message + group room for trip_id checks
  const [{ data: sourceMsg }, { data: groupRoom }] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("*")
      .eq("id", parsed.data.message_id)
      .maybeSingle(),
    supabase
      .from("chat_rooms")
      .select("*")
      .eq("id", parsed.data.group_room_id)
      .maybeSingle(),
  ]);
  const msg = sourceMsg as ChatMessage | null;
  const room = groupRoom as ChatRoom | null;

  if (!msg) {
    return NextResponse.json(
      { error: "Source message not found" },
      { status: 404 }
    );
  }
  if (!room || room.type !== "group") {
    return NextResponse.json(
      { error: "Target room is not a group room" },
      { status: 400 }
    );
  }
  if (msg.sender_type !== "agent" && msg.sender_type !== "subagent") {
    return NextResponse.json(
      { error: "Only agent/subagent messages can be shared" },
      { status: 400 }
    );
  }

  const { data: inserted, error } = await supabase
    .from("chat_messages")
    .insert({
      room_id: room.id,
      sender_participant_id: parsed.data.shared_by_participant_id,
      sender_type: "user",
      content: `${PREAMBLE}${msg.content}`,
      shared_from_room_id: msg.room_id,
      shared_by_participant_id: parsed.data.shared_by_participant_id,
    })
    .select()
    .single();

  if (error || !inserted) {
    return NextResponse.json(
      { error: error?.message ?? "Could not share" },
      { status: 500 }
    );
  }

  return NextResponse.json({ message: inserted });
}
