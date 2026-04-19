import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { runIncrementalForUpload } from "@/lib/ingest/incremental";
import { fetchUrlText } from "@/lib/ingest/fetch-url";
import type { Upload } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface AddItem {
  kind?: "url" | "text" | "storage";
  url?: string;
  text?: string;
  title?: string;
  storage_path?: string;
  filename?: string;
}

interface AddRequest {
  items?: AddItem[];
}

const BUCKET = "trip-uploads";

function classifyByFilename(name: string | undefined): Upload["kind"] {
  if (!name) return "other";
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip")) return "whatsapp_zip";
  if (
    lower.endsWith(".pdf") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md")
  )
    return "doc";
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp")
  )
    return "image";
  return "other";
}

function safeFilename(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 100)
    .replace(/^-+|-+$/g, "") || "file";
}

export async function POST(
  req: Request,
  { params }: { params: { tripId: string } }
) {
  const tripId = params.tripId;
  let body: AddRequest;
  try {
    body = (await req.json()) as AddRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const items = body.items ?? [];
  if (items.length === 0) {
    return NextResponse.json({ error: "No items provided" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  const { data: trip } = await supabase
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const uploadIds: string[] = [];
  const detected: Array<{
    source: string;
    kind: Upload["kind"];
    bytes: number;
    filename: string;
  }> = [];

  for (const item of items) {
    try {
      if (item.url) {
        const fetched = await fetchUrlText(item.url);
        const text = `Source: ${fetched.url}\nTitle: ${fetched.title}\n\n${fetched.text}`;
        const bytes = new TextEncoder().encode(text);
        const filename = `${safeFilename(fetched.title)}.txt`;
        const path = `${tripId}/link-${Date.now()}-${safeFilename(fetched.host)}.txt`;
        const { error: uploadErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, bytes, {
            upsert: false,
            contentType: "text/plain",
          });
        if (uploadErr) throw new Error(`Storage upload: ${uploadErr.message}`);
        const { data: row, error: rowErr } = await supabase
          .from("uploads")
          .insert({
            trip_id: tripId,
            kind: "doc",
            storage_path: path,
            filename,
            status: "pending",
          })
          .select("id")
          .single();
        if (rowErr || !row) {
          throw new Error(rowErr?.message ?? "Insert upload failed");
        }
        uploadIds.push((row as { id: string }).id);
        detected.push({
          source: item.url,
          kind: "doc",
          bytes: bytes.byteLength,
          filename,
        });
      } else if (item.text && item.text.trim()) {
        const title = item.title?.trim() || "Pasted note";
        const text = `Title: ${title}\n\n${item.text.trim()}`;
        const bytes = new TextEncoder().encode(text);
        const filename = `${safeFilename(title)}.txt`;
        const path = `${tripId}/note-${Date.now()}-${safeFilename(title)}.txt`;
        const { error: uploadErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, bytes, {
            upsert: false,
            contentType: "text/plain",
          });
        if (uploadErr) throw new Error(`Storage upload: ${uploadErr.message}`);
        const { data: row, error: rowErr } = await supabase
          .from("uploads")
          .insert({
            trip_id: tripId,
            kind: "doc",
            storage_path: path,
            filename,
            status: "pending",
          })
          .select("id")
          .single();
        if (rowErr || !row) {
          throw new Error(rowErr?.message ?? "Insert upload failed");
        }
        uploadIds.push((row as { id: string }).id);
        detected.push({
          source: "pasted",
          kind: "doc",
          bytes: bytes.byteLength,
          filename,
        });
      } else if (item.storage_path) {
        const kind = classifyByFilename(item.filename);
        const { data: row, error: rowErr } = await supabase
          .from("uploads")
          .insert({
            trip_id: tripId,
            kind,
            storage_path: item.storage_path,
            filename: item.filename ?? null,
            status: "pending",
          })
          .select("id")
          .single();
        if (rowErr || !row) {
          throw new Error(rowErr?.message ?? "Insert upload failed");
        }
        uploadIds.push((row as { id: string }).id);
        detected.push({
          source: item.filename ?? item.storage_path,
          kind,
          bytes: 0,
          filename: item.filename ?? item.storage_path,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      detected.push({
        source: item.url ?? item.filename ?? "unknown",
        kind: "other",
        bytes: 0,
        filename: `FAILED: ${msg}`,
      });
    }
  }

  // Kick off incremental processing per upload. Keep instance alive with
  // waitUntil — fire-and-forget gets killed by serverless response freeze.
  for (const id of uploadIds) {
    waitUntil(
      runIncrementalForUpload(tripId, id).catch((err) => {
        console.error(`Incremental ingest for ${id} failed:`, err);
      })
    );
  }

  return NextResponse.json({
    queued: uploadIds.length,
    detected,
  });
}
