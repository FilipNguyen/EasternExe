import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Hobby plan caps serverless functions at 60s. This route only flips status
// and dispatches to /extract — the heavy work happens across the chained
// endpoints under src/app/api/ingest/[tripId]/{extract,profiles,...}.
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: { tripId: string } }
) {
  if (!params.tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  await supabase
    .from("trips")
    .update({ status: "ingesting", error: null })
    .eq("id", params.tripId);

  const extractUrl = new URL(
    `/api/ingest/${params.tripId}/extract`,
    req.url
  ).toString();

  waitUntil(
    fetch(extractUrl, { method: "POST" }).catch((e) =>
      console.error("extract dispatch failed:", e)
    )
  );

  return NextResponse.json({ ok: true, tripId: params.tripId }, { status: 202 });
}
