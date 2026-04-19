import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { runIngestion } from "@/lib/ingest/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

const isVercel = !!process.env.VERCEL;

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

  if (isVercel) {
    // On Vercel: use chained endpoints so each step gets its own 60s budget.
    // waitUntil keeps the function alive past the response.
    const extractUrl = new URL(
      `/api/ingest/${params.tripId}/extract`,
      req.url
    ).toString();

    waitUntil(
      fetch(extractUrl, { method: "POST" }).catch((e) =>
        console.error("extract dispatch failed:", e)
      )
    );
  } else {
    // Local dev: waitUntil is a no-op outside Vercel, so the chained fetch
    // would never execute. Run the legacy single-invocation path instead —
    // no 60s cap locally, everything completes in-process.
    waitUntil(
      runIngestion(params.tripId).catch((e) =>
        console.error("runIngestion failed:", e)
      )
    );
  }

  return NextResponse.json({ ok: true, tripId: params.tripId }, { status: 202 });
}
