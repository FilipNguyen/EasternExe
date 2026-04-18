import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { runIngestion } from "@/lib/ingest/pipeline";
import { PARTICIPANT_COLORS } from "@/lib/colors";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "trip-uploads";

/**
 * Seeds a complete demo trip from the fixtures in /test-data.
 * Hit GET /api/seed-test-trip?confirm=1 and it will:
 *   - create "Tokyo Apr 2026 (seed)" with 3 participants (Filip, Taro, Kenji)
 *   - upload tokyo-chat.zip (WhatsApp-format ~400 messages)
 *   - upload each participant's notes
 *   - fire runIngestion() — LLM builds profiles, trip memory, extracts places
 *   - return a redirect URL to the trip workspace
 *
 * Gated by ?confirm=1 so accidental hits don't create rows.
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("confirm") !== "1") {
    return NextResponse.json(
      {
        error:
          "Safety gate. Pass ?confirm=1 to seed a fresh demo trip from /test-data.",
        usage: "GET /api/seed-test-trip?confirm=1",
      },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseServerClient();
    const testDataDir = path.join(process.cwd(), "test-data");

    // 1. Create the trip
    const { data: trip, error: tripErr } = await supabase
      .from("trips")
      .insert({
        name: "Tokyo Apr 2026 (seed)",
        destination: "Tokyo, Japan",
        start_date: "2026-04-18",
        end_date: "2026-04-25",
      })
      .select()
      .single();
    if (tripErr || !trip) {
      return NextResponse.json(
        { error: `Trip insert failed: ${tripErr?.message}` },
        { status: 500 }
      );
    }

    // 2. Create the three participants
    const participantRows = [
      { display_name: "Filip", color: PARTICIPANT_COLORS[0] },
      { display_name: "Taro", color: PARTICIPANT_COLORS[1] },
      { display_name: "Kenji", color: PARTICIPANT_COLORS[3] },
    ];
    const { data: participants, error: partErr } = await supabase
      .from("participants")
      .insert(participantRows.map((p) => ({ trip_id: trip.id, ...p })))
      .select();
    if (partErr || !participants) {
      await supabase.from("trips").delete().eq("id", trip.id);
      return NextResponse.json(
        { error: `Participants insert failed: ${partErr?.message}` },
        { status: 500 }
      );
    }

    const byName: Record<string, { id: string; display_name: string }> = {};
    for (const p of participants as { id: string; display_name: string }[]) {
      byName[p.display_name.toLowerCase()] = p;
    }

    // 3. Upload the WhatsApp zip
    const zipBuffer = await fs.readFile(path.join(testDataDir, "tokyo-chat.zip"));
    const zipPath = `${trip.id}/${crypto.randomUUID()}-tokyo-chat.zip`;
    {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(zipPath, zipBuffer, { contentType: "application/zip" });
      if (error) throw new Error(`zip upload failed: ${error.message}`);
    }
    await supabase.from("uploads").insert({
      trip_id: trip.id,
      kind: "whatsapp_zip",
      storage_path: zipPath,
      filename: "tokyo-chat.zip",
    });

    // 4. Upload each participant's notes
    const notesMap: Record<string, string> = {
      filip: "filip-notes.txt",
      taro: "taro-notes.txt",
      kenji: "kenji-notes.txt",
    };
    for (const [who, filename] of Object.entries(notesMap)) {
      const participant = byName[who];
      if (!participant) continue;
      const noteBuf = await fs.readFile(path.join(testDataDir, filename));
      const notePath = `${trip.id}/${participant.id}-notes.txt`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(notePath, noteBuf, {
          contentType: "text/plain",
          upsert: true,
        });
      if (error) throw new Error(`notes upload failed (${who}): ${error.message}`);
      await supabase.from("uploads").insert({
        trip_id: trip.id,
        participant_id: participant.id,
        kind: "other",
        storage_path: notePath,
        filename,
      });
    }

    // 5. Fire ingestion — async, don't block the response
    void runIngestion(trip.id).catch((e) => {
      console.error("runIngestion crashed:", e);
    });

    const tripUrl = `/trip/${trip.id}`;

    return NextResponse.json(
      {
        ok: true,
        tripId: trip.id,
        tripUrl,
        participants: participants as { id: string; display_name: string }[],
        message: [
          "Trip seeded + ingestion fired.",
          `Open ${tripUrl} in your browser, pick a participant, watch the brain build.`,
          "Ingestion typically takes 30–120s end to end.",
        ].join("\n"),
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
