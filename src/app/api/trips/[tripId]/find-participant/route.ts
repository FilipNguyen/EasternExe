import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function normalize(s: string) {
  return s.trim().toLowerCase();
}

export async function POST(
  req: Request,
  { params }: { params: { tripId: string } }
) {
  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const needle = body.name ? normalize(body.name) : "";
  if (!needle) {
    return NextResponse.json(
      { error: "Name is required" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServerClient();

  const { data: trip } = await supabase
    .from("trips")
    .select("id, name")
    .eq("id", params.tripId)
    .maybeSingle();

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const { data: participants, error } = await supabase
    .from("participants")
    .select("id, display_name, color")
    .eq("trip_id", params.tripId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Match on full display_name OR on the first whitespace-separated token.
  // Case-insensitive + trimmed on both sides.
  const match = (participants ?? []).find((p) => {
    const full = normalize(p.display_name);
    const first = full.split(/\s+/)[0] ?? "";
    return full === needle || first === needle;
  });

  if (!match) {
    return NextResponse.json(
      {
        error: `No participant matching "${body.name}" in this trip.`,
        available: (participants ?? []).map((p) => p.display_name),
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    participantId: match.id,
    displayName: match.display_name,
    tripId: trip.id,
    tripName: trip.name,
  });
}
