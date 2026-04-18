import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tripId = new URL(req.url).searchParams.get("trip_id");
  if (!tripId) {
    return NextResponse.json({ error: "trip_id required" }, { status: 400 });
  }
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("participant_locations")
    .select("*")
    .eq("trip_id", tripId);
  // Table may not exist yet if migration 004 hasn't run — treat as empty.
  if (error && !/participant_locations/i.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ locations: data ?? [] });
}

const upsertSchema = z.object({
  participant_id: z.string().uuid(),
  trip_id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nullable().optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("participant_locations")
    .upsert(
      {
        participant_id: parsed.data.participant_id,
        trip_id: parsed.data.trip_id,
        lat: parsed.data.lat,
        lng: parsed.data.lng,
        accuracy: parsed.data.accuracy ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "participant_id" }
    );
  if (error) {
    const status = /participant_locations/i.test(error.message) ? 501 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ ok: true });
}
