import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { callLlmJson, getZaiModel } from "@/lib/llm";
import { chunkText, concatChunks } from "@/lib/embeddings";
import {
  ingestProfileSystem,
  ingestProfileUser,
} from "@/lib/prompts/ingest-profile";
import {
  ingestTripMemorySystem,
  ingestTripMemoryUser,
} from "@/lib/prompts/ingest-trip-memory";
import {
  ingestPlacesSystem,
  ingestPlacesUser,
} from "@/lib/prompts/ingest-places";
import { geocodeDestination, googlePlacesTextSearch } from "@/lib/places";
import { parseWhatsAppZip } from "@/lib/ingest/whatsapp-parser";
import { extractDocText } from "@/lib/ingest/doc-extract";
import {
  extractedPlacesResponseSchema,
  participantProfileLlmSchema,
  tripMemoryLlmSchema,
} from "@/lib/schemas";
import type { Participant, Trip, Upload } from "@/types/db";

const BUCKET = "trip-uploads";
const PROFILE_CONTEXT_CHARS = 6000;
const MEMORY_CONTEXT_CHARS = 12000;
const PLACES_CONTEXT_CHARS = 12000;

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

async function downloadUpload(
  supabase: SupabaseClient,
  path: string
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed for ${path}: ${error?.message}`);
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

async function setUploadStatus(
  supabase: SupabaseClient,
  id: string,
  status: "processing" | "processed" | "failed",
  errorMsg?: string
) {
  await supabase
    .from("uploads")
    .update({ status, error: errorMsg ?? null })
    .eq("id", id);
}

async function setTripStatus(
  supabase: SupabaseClient,
  tripId: string,
  status: "setup" | "ingesting" | "ready" | "error",
  errorMsg?: string
) {
  await supabase
    .from("trips")
    .update({ status, error: errorMsg ?? null })
    .eq("id", tripId);
}

async function logRun(
  supabase: SupabaseClient,
  tripId: string,
  kind: string,
  input: unknown,
  output: unknown,
  durationMs: number,
  error?: string
) {
  await supabase.from("ai_runs").insert({
    trip_id: tripId,
    kind,
    input,
    output,
    error: error ?? null,
    duration_ms: durationMs,
    model: error ? null : getModelNameSafely(),
  });
}

function getModelNameSafely(): string | null {
  try {
    return getZaiModel();
  } catch {
    return null;
  }
}

async function loadChunks(
  supabase: SupabaseClient,
  tripId: string
): Promise<{ id: string; content: string }[]> {
  const { data: chunkRows } = await supabase
    .from("upload_chunks")
    .select("id, content, created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });
  return (chunkRows ?? []) as { id: string; content: string }[];
}

// ---------------------------------------------------------------
// text extraction per upload
// ---------------------------------------------------------------

interface ExtractedText {
  uploadId: string;
  participantId: string | null;
  kind: Upload["kind"];
  text: string;
}

async function extractFromUpload(
  supabase: SupabaseClient,
  upload: Upload
): Promise<{
  extracted: ExtractedText[];
  mediaUploads: { storage_path: string; filename: string; kind: Upload["kind"] }[];
}> {
  const buf = await downloadUpload(supabase, upload.storage_path);

  if (upload.kind === "whatsapp_zip") {
    const parsed = await parseWhatsAppZip(buf);
    return {
      extracted: [
        {
          uploadId: upload.id,
          participantId: upload.participant_id,
          kind: upload.kind,
          text: parsed.text,
        },
      ],
      mediaUploads: [],
    };
  }

  if (upload.kind === "doc" || upload.kind === "other") {
    const text = await extractDocText(upload.filename, buf);
    return {
      extracted: [
        {
          uploadId: upload.id,
          participantId: upload.participant_id,
          kind: upload.kind,
          text,
        },
      ],
      mediaUploads: [],
    };
  }

  // audio_intro is a legacy kind from the Whisper pipeline; we no longer
  // transcribe audio. If an upload still carries that kind we just skip it.
  // image or unknown — also skip text extraction in v1
  return { extracted: [], mediaUploads: [] };
}

// ---------------------------------------------------------------
// step functions — each runs inside its own serverless invocation
// on the chained-endpoint path (src/app/api/ingest/[tripId]/*).
// ---------------------------------------------------------------

/**
 * Return ids of uploads that still need extraction for this trip. Includes
 * both `pending` and stale `processing` rows — the latter are rows where a
 * prior extract invocation got killed by the Vercel 60s cap mid-await, so
 * the catch block that would have flipped them to `failed` never ran.
 */
export async function listPendingUploadIds(tripId: string): Promise<string[]> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("uploads")
    .select("id, created_at")
    .eq("trip_id", tripId)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => (r as { id: string }).id);
}

/**
 * Extract one upload: download, parse, chunk its text, persist chunks.
 * Self-contained so it can run inside a single 60s serverless invocation.
 * Large WhatsApp zips took ~all of one 60s budget on their own, which
 * starved subsequent uploads (notes rows pinned at `processing` forever).
 */
export async function runExtractOne(
  tripId: string,
  uploadId: string
): Promise<void> {
  const supabase = getSupabaseServerClient();

  const { data: uploadData, error: uploadErr } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", uploadId)
    .single();
  if (uploadErr || !uploadData)
    throw new Error(`Upload ${uploadId} not found`);
  const upload = uploadData as Upload;

  await setUploadStatus(supabase, upload.id, "processing");

  try {
    const result = await extractFromUpload(supabase, upload);

    for (const media of result.mediaUploads) {
      await supabase.from("uploads").insert({
        trip_id: upload.trip_id,
        participant_id: upload.participant_id,
        kind: media.kind,
        storage_path: media.storage_path,
        filename: media.filename,
        status: "processed",
      });
    }

    const chunkRows: { upload_id: string; trip_id: string; content: string }[] =
      [];
    for (const ex of result.extracted) {
      if (!ex.text.trim()) continue;
      const pieces = chunkText(ex.text);
      for (const piece of pieces) {
        chunkRows.push({
          upload_id: ex.uploadId,
          trip_id: tripId,
          content: piece,
        });
      }
    }

    for (let i = 0; i < chunkRows.length; i += 100) {
      const batch = chunkRows.slice(i, i + 100);
      const { error: insertErr } = await supabase
        .from("upload_chunks")
        .insert(batch);
      if (insertErr) {
        console.warn("chunk insert failed:", insertErr.message);
      }
    }

    await setUploadStatus(supabase, upload.id, "processed");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Upload ${upload.id} failed:`, msg);
    await setUploadStatus(supabase, upload.id, "failed", msg);
  }
}

/** True if the trip has any chunks — decides whether to run profiles/memory/places or skip. */
export async function tripHasChunks(tripId: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { count } = await supabase
    .from("upload_chunks")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", tripId);
  return (count ?? 0) > 0;
}

/**
 * Legacy loop kept for `runIngestion` (local-dev seed path). The chained
 * endpoints under src/app/api/ingest/[tripId]/extract now use
 * `listPendingUploadIds` + `runExtractOne` one-per-hop instead.
 */
export async function runExtract(
  tripId: string
): Promise<{ hasUploads: boolean }> {
  const ids = await listPendingUploadIds(tripId);
  if (ids.length === 0) return { hasUploads: false };
  for (const id of ids) {
    await runExtractOne(tripId, id);
  }
  return { hasUploads: true };
}

/** Return participant ids for a trip, ordered by created_at. */
export async function listParticipantIds(tripId: string): Promise<string[]> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("participants")
    .select("id")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => (r as { id: string }).id);
}

/** Step 4 (per participant): generate profile from bio notes + trip chunks. */
export async function runProfileForParticipant(
  tripId: string,
  participantId: string
): Promise<void> {
  const supabase = getSupabaseServerClient();

  const { data: pData, error: pErr } = await supabase
    .from("participants")
    .select("*")
    .eq("id", participantId)
    .single();
  if (pErr || !pData)
    throw new Error(`Participant ${participantId} not found`);
  const p = pData as Participant;

  const { data: noteRows } = await supabase
    .from("uploads")
    .select("id, storage_path")
    .eq("trip_id", tripId)
    .eq("participant_id", p.id)
    .eq("kind", "other");

  let notes = "";
  for (const n of noteRows ?? []) {
    try {
      const buf = await downloadUpload(
        supabase,
        (n as { storage_path: string }).storage_path
      );
      notes += `${new TextDecoder().decode(buf)}\n`;
    } catch {
      // ignore — best-effort read of notes
    }
  }

  const chunks = await loadChunks(supabase, tripId);
  const excerpts = concatChunks(chunks, PROFILE_CONTEXT_CHARS);

  const t0 = Date.now();
  try {
    const raw = await callLlmJson({
      messages: [
        { role: "system", content: ingestProfileSystem },
        {
          role: "user",
          content: ingestProfileUser({
            displayName: p.display_name,
            transcript: "",
            notes,
            excerpts,
          }),
        },
      ],
    });
    const parsed = participantProfileLlmSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Profile schema mismatch for ${p.display_name}: ${parsed.error.message}`
      );
    }
    await supabase.from("participant_profiles").upsert(
      {
        participant_id: p.id,
        personality: parsed.data.personality,
        interests: parsed.data.interests,
        budget_style: parsed.data.budget_style,
        travel_style: parsed.data.travel_style,
        food_preferences: parsed.data.food_preferences,
        dislikes: parsed.data.dislikes,
        dealbreakers: parsed.data.dealbreakers,
        open_questions: parsed.data.open_questions,
        raw_intro_transcript: notes || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "participant_id" }
    );
    await logRun(
      supabase,
      tripId,
      "ingest.profile",
      { participant_id: p.id, display_name: p.display_name },
      parsed.data,
      Date.now() - t0
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Profile gen for ${p.display_name} failed:`, msg);
    await logRun(
      supabase,
      tripId,
      "ingest.profile",
      { participant_id: p.id },
      null,
      Date.now() - t0,
      msg
    );
  }
}

/** Step 5: trip-level memory extraction. */
export async function runMemory(tripId: string): Promise<void> {
  const supabase = getSupabaseServerClient();

  const { data: tripData, error: tripErr } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();
  if (tripErr || !tripData) throw new Error(`Trip ${tripId} not found`);
  const trip = tripData as Trip;

  const chunks = await loadChunks(supabase, tripId);
  const excerpts = concatChunks(chunks, MEMORY_CONTEXT_CHARS);

  const t0 = Date.now();
  try {
    const raw = await callLlmJson({
      messages: [
        { role: "system", content: ingestTripMemorySystem },
        {
          role: "user",
          content: ingestTripMemoryUser({
            destination: trip.destination ?? "",
            excerpts,
          }),
        },
      ],
    });
    const parsed = tripMemoryLlmSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Trip memory schema mismatch: ${parsed.error.message}`);
    }
    await supabase.from("trip_memory").upsert(
      {
        trip_id: tripId,
        destination: parsed.data.destination || trip.destination,
        constraints: parsed.data.constraints,
        group_preferences: parsed.data.group_preferences,
        priorities: parsed.data.priorities,
        tensions: parsed.data.tensions,
        decisions_made: parsed.data.decisions_made,
        open_questions: parsed.data.open_questions,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "trip_id" }
    );
    await logRun(
      supabase,
      tripId,
      "ingest.trip_memory",
      { destination: trip.destination },
      parsed.data,
      Date.now() - t0
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Trip memory generation failed:", msg);
    await logRun(
      supabase,
      tripId,
      "ingest.trip_memory",
      {},
      null,
      Date.now() - t0,
      msg
    );
  }
}

/** Step 6: places extraction + Google Places geocoding. */
export async function runPlaces(tripId: string): Promise<void> {
  const supabase = getSupabaseServerClient();

  const { data: tripData, error: tripErr } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();
  if (tripErr || !tripData) throw new Error(`Trip ${tripId} not found`);
  const trip = tripData as Trip;

  const chunks = await loadChunks(supabase, tripId);
  const excerpts = concatChunks(chunks, PLACES_CONTEXT_CHARS);

  const t0 = Date.now();
  try {
    const raw = await callLlmJson({
      messages: [
        { role: "system", content: ingestPlacesSystem },
        {
          role: "user",
          content: ingestPlacesUser({
            destination: trip.destination ?? "",
            excerpts,
          }),
        },
      ],
    });
    const parsed = extractedPlacesResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Places schema mismatch: ${parsed.error.message}`);
    }

    for (const place of parsed.data.places) {
      try {
        const results = await googlePlacesTextSearch(
          place.name,
          trip.destination
        );
        if (results.length === 0) continue;
        const top = results[0];
        await supabase.from("places").insert({
          trip_id: tripId,
          name: top.name || place.name,
          lat: top.lat,
          lng: top.lng,
          google_place_id: top.place_id,
          category: place.category,
          time_of_day: place.time_of_day,
          notes: place.notes || null,
          source: "ingest",
          added_by_agent: false,
        });
      } catch (e) {
        console.warn(`Place "${place.name}" geocode failed:`, e);
      }
    }

    await logRun(
      supabase,
      tripId,
      "ingest.places",
      { count: parsed.data.places.length },
      parsed.data,
      Date.now() - t0
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Places extraction failed:", msg);
    await logRun(
      supabase,
      tripId,
      "ingest.places",
      {},
      null,
      Date.now() - t0,
      msg
    );
  }
}

/** Step 7 + status flip: geocode destination, mark trip `ready`. */
export async function runFinalize(tripId: string): Promise<void> {
  const supabase = getSupabaseServerClient();

  const { data: tripData } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();
  const trip = tripData as Trip | null;

  if (trip?.destination) {
    try {
      const geo = await geocodeDestination(trip.destination);
      if (geo) {
        await supabase
          .from("trips")
          .update({
            destination_lat: geo.lat,
            destination_lng: geo.lng,
          })
          .eq("id", tripId);
      }
    } catch (e) {
      console.warn("Destination geocode failed:", e);
    }
  }

  await setTripStatus(supabase, tripId, "ready");
}

/** Mark a trip errored — called by chain.ts when a step throws. */
export async function markIngestError(
  tripId: string,
  err: unknown
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const msg = err instanceof Error ? err.message : String(err);
  await setTripStatus(supabase, tripId, "error", msg);
}

// ---------------------------------------------------------------
// Legacy single-invocation path — still used by seed-test-trip, which
// runs locally where the 60s Hobby cap is irrelevant. In production the
// chained-endpoint path in src/app/api/ingest/[tripId]/* is authoritative.
// ---------------------------------------------------------------

export async function runIngestion(tripId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  await setTripStatus(supabase, tripId, "ingesting");
  const startedAt = Date.now();

  try {
    const { hasUploads } = await runExtract(tripId);
    if (hasUploads) {
      const participantIds = await listParticipantIds(tripId);
      for (const pid of participantIds) {
        await runProfileForParticipant(tripId, pid);
      }
      await runMemory(tripId);
      await runPlaces(tripId);
    }
    await runFinalize(tripId);
    console.log(
      `Ingestion complete for ${tripId} in ${Math.round((Date.now() - startedAt) / 1000)}s`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Ingestion for ${tripId} failed:`, msg);
    await setTripStatus(supabase, tripId, "error", msg);
  }
}
