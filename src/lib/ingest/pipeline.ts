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
    const mediaUploads: { storage_path: string; filename: string; kind: Upload["kind"] }[] = [];

    for (const media of parsed.mediaFiles) {
      const path = `${upload.trip_id}/${crypto.randomUUID()}-${media.filename}`;
      const lower = media.filename.toLowerCase();
      const kind: Upload["kind"] = lower.match(/\.(jpe?g|png|heic|gif|webp)$/)
        ? "image"
        : "other";
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, media.data, {
          contentType: "application/octet-stream",
        });
      if (!error) {
        mediaUploads.push({ storage_path: path, filename: media.filename, kind });
      }
    }

    return {
      extracted: [
        {
          uploadId: upload.id,
          participantId: upload.participant_id,
          kind: upload.kind,
          text: parsed.text,
        },
      ],
      mediaUploads,
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
// main entry point
// ---------------------------------------------------------------

export async function runIngestion(tripId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  await setTripStatus(supabase, tripId, "ingesting");

  const startedAt = Date.now();

  try {
    // Load trip + participants + pending uploads
    const { data: tripData, error: tripErr } = await supabase
      .from("trips")
      .select("*")
      .eq("id", tripId)
      .single();
    if (tripErr || !tripData) throw new Error(`Trip ${tripId} not found`);
    const trip = tripData as Trip;

    const { data: participantsData } = await supabase
      .from("participants")
      .select("*")
      .eq("trip_id", tripId);
    const participants = (participantsData ?? []) as Participant[];

    const { data: uploadsData } = await supabase
      .from("uploads")
      .select("*")
      .eq("trip_id", tripId)
      .eq("status", "pending");
    const uploads = (uploadsData ?? []) as Upload[];

    // Step 1 — per-upload extraction
    const extractedTexts: ExtractedText[] = [];

    for (const upload of uploads) {
      await setUploadStatus(supabase, upload.id, "processing");
      try {
        const result = await extractFromUpload(supabase, upload);
        extractedTexts.push(...result.extracted);

        // Register zip-extracted media as additional upload rows
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

        await setUploadStatus(supabase, upload.id, "processed");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Upload ${upload.id} failed:`, msg);
        await setUploadStatus(supabase, upload.id, "failed", msg);
      }
    }

    // Step 2 — chunk + persist all extracted text
    const allChunkRows: {
      upload_id: string;
      trip_id: string;
      content: string;
    }[] = [];

    for (const ex of extractedTexts) {
      if (!ex.text.trim()) continue;
      const pieces = chunkText(ex.text);
      for (const piece of pieces) {
        allChunkRows.push({
          upload_id: ex.uploadId,
          trip_id: tripId,
          content: piece,
        });
      }
    }

    if (allChunkRows.length > 0) {
      for (let i = 0; i < allChunkRows.length; i += 100) {
        const batch = allChunkRows.slice(i, i + 100);
        const { error: insertErr } = await supabase
          .from("upload_chunks")
          .insert(batch);
        if (insertErr) {
          console.warn("chunk insert failed:", insertErr.message);
        }
      }
    }

    // Step 3 — load chunks (chronological order) for context assembly
    const { data: chunkRows } = await supabase
      .from("upload_chunks")
      .select("id, content, created_at")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true });

    const chunks = (chunkRows ?? []) as { id: string; content: string }[];

    // Step 4 — per-participant profile generation
    for (const p of participants) {
      // Look up participant's text notes from uploads (kind='other' with participant_id=p.id)
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
          // ignore
        }
      }

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
        await supabase
          .from("participant_profiles")
          .upsert(
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

    // Step 5 — trip memory
    {
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

    // Step 6 — places extraction + Google Places geocoding
    {
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

    // Step 7 — geocode the destination itself
    if (trip.destination) {
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
    console.log(
      `Ingestion complete for ${tripId} in ${Math.round((Date.now() - startedAt) / 1000)}s`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Ingestion for ${tripId} failed:`, msg);
    await setTripStatus(supabase, tripId, "error", msg);
  }
}
