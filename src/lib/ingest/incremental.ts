import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { callLlmJson } from "@/lib/llm";
import { chunkText, concatChunks } from "@/lib/embeddings";
import {
  ingestPlacesSystem,
  ingestPlacesUser,
} from "@/lib/prompts/ingest-places";
import { googlePlacesTextSearch } from "@/lib/places";
import { parseWhatsAppZip } from "@/lib/ingest/whatsapp-parser";
import { extractDocText } from "@/lib/ingest/doc-extract";
import { extractedPlacesResponseSchema } from "@/lib/schemas";
import type { Trip, Upload } from "@/types/db";

const BUCKET = "trip-uploads";
const PLACES_CONTEXT_CHARS = 12000;

async function downloadUpload(
  supabase: SupabaseClient,
  path: string
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error(`Storage download failed for ${path}: ${error?.message}`);
  }
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

async function extractTextForUpload(
  supabase: SupabaseClient,
  upload: Upload
): Promise<string> {
  if (
    upload.kind !== "whatsapp_zip" &&
    upload.kind !== "doc" &&
    upload.kind !== "other"
  ) {
    return "";
  }
  const buf = await downloadUpload(supabase, upload.storage_path);
  if (upload.kind === "whatsapp_zip") {
    const parsed = await parseWhatsAppZip(buf);
    return parsed.text;
  }
  return extractDocText(upload.filename, buf);
}

export interface IncrementalResult {
  uploadId: string;
  chunks_added: number;
  places_added: number;
  places_skipped: number;
}

/**
 * Process a single new upload in place: extract text → chunk → insert
 * upload_chunks → run one places extraction LLM call on just the new chunks
 * → insert new places (skipping any whose google_place_id already exists
 * for the trip).
 *
 * Trip-level profile / memory regeneration is intentionally skipped — this
 * is a cheap "add more context" path. The full pipeline rerun remains the
 * way to rebuild memory from a new corpus.
 */
export async function runIncrementalForUpload(
  tripId: string,
  uploadId: string
): Promise<IncrementalResult> {
  const supabase = getSupabaseServerClient();

  const { data: uploadData, error: uploadErr } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", uploadId)
    .single();
  if (uploadErr || !uploadData) {
    throw new Error(`Upload ${uploadId} not found`);
  }
  const upload = uploadData as Upload;

  await supabase
    .from("uploads")
    .update({ status: "processing" })
    .eq("id", upload.id);

  let newChunks: string[] = [];
  try {
    const text = await extractTextForUpload(supabase, upload);
    newChunks = text.trim() ? chunkText(text) : [];

    if (newChunks.length > 0) {
      const rows = newChunks.map((content) => ({
        upload_id: upload.id,
        trip_id: tripId,
        content,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error: insertErr } = await supabase
          .from("upload_chunks")
          .insert(batch);
        if (insertErr) {
          throw new Error(`Chunk insert failed: ${insertErr.message}`);
        }
      }
    }

    await supabase
      .from("uploads")
      .update({ status: "processed" })
      .eq("id", upload.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("uploads")
      .update({ status: "failed", error: msg })
      .eq("id", upload.id);
    throw e;
  }

  // If we didn't produce any new text (image, unsupported kind, empty URL),
  // we're done. No places extraction.
  if (newChunks.length === 0) {
    return {
      uploadId: upload.id,
      chunks_added: 0,
      places_added: 0,
      places_skipped: 0,
    };
  }

  // One places extraction call on just the new chunks.
  const { data: tripData } = await supabase
    .from("trips")
    .select("destination")
    .eq("id", tripId)
    .maybeSingle();
  const destination = (tripData as Trip | null)?.destination ?? "";

  // Fake "id" field for concatChunks — it only uses content.
  const chunkDocs = newChunks.map((content, idx) => ({
    id: `${upload.id}-${idx}`,
    content,
  }));
  const excerpts = concatChunks(chunkDocs, PLACES_CONTEXT_CHARS);

  let placesAdded = 0;
  let placesSkipped = 0;
  const t0 = Date.now();
  try {
    const raw = await callLlmJson({
      messages: [
        { role: "system", content: ingestPlacesSystem },
        {
          role: "user",
          content: ingestPlacesUser({ destination, excerpts }),
        },
      ],
    });
    const parsed = extractedPlacesResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Places schema mismatch: ${parsed.error.message}`);
    }

    // Load existing google_place_ids to dedupe.
    const { data: existingRows } = await supabase
      .from("places")
      .select("google_place_id")
      .eq("trip_id", tripId);
    const existingIds = new Set(
      (existingRows ?? [])
        .map((r) => (r as { google_place_id: string | null }).google_place_id)
        .filter(Boolean)
    );

    for (const place of parsed.data.places) {
      try {
        const results = await googlePlacesTextSearch(place.name, destination);
        if (results.length === 0) continue;
        const top = results[0];
        if (top.place_id && existingIds.has(top.place_id)) {
          placesSkipped += 1;
          continue;
        }
        const { error: insErr } = await supabase.from("places").insert({
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
        if (!insErr) {
          placesAdded += 1;
          if (top.place_id) existingIds.add(top.place_id);
        }
      } catch (err) {
        console.warn(`Place "${place.name}" geocode failed:`, err);
      }
    }

    await supabase.from("ai_runs").insert({
      trip_id: tripId,
      kind: "ingest.places.incremental",
      input: { upload_id: upload.id, chunks: newChunks.length },
      output: {
        places_added: placesAdded,
        places_skipped: placesSkipped,
        extracted: parsed.data.places.length,
      },
      duration_ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Incremental places extraction failed:", msg);
    await supabase.from("ai_runs").insert({
      trip_id: tripId,
      kind: "ingest.places.incremental",
      input: { upload_id: upload.id },
      output: null,
      duration_ms: Date.now() - t0,
      error: msg,
    });
  }

  return {
    uploadId: upload.id,
    chunks_added: newChunks.length,
    places_added: placesAdded,
    places_skipped: placesSkipped,
  };
}
