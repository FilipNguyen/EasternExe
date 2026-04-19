import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  trip_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  google_place_id: z.string().optional(),
  category: z.enum([
    "food",
    "drinks",
    "sight",
    "shopping",
    "nature",
    "nightlife",
    "other",
  ]),
  notes: z.string().max(500).optional(),
  source: z.enum(["agent", "nearby", "events", "manual"]).default("manual"),
});

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

  // Check for duplicate: same trip + same google_place_id or same name within 100m
  if (parsed.data.google_place_id) {
    const { data: existing } = await supabase
      .from("places")
      .select("id")
      .eq("trip_id", parsed.data.trip_id)
      .eq("google_place_id", parsed.data.google_place_id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        success: true,
        place: existing,
        message: "Already saved",
      });
    }
  }

  const { data, error } = await supabase
    .from("places")
    .insert({
      trip_id: parsed.data.trip_id,
      name: parsed.data.name,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      google_place_id: parsed.data.google_place_id ?? null,
      category: parsed.data.category,
      notes: parsed.data.notes ?? null,
      source: parsed.data.source,
      added_by_agent: parsed.data.source === "agent",
      status: "saved",
      time_of_day: "any",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, place: data });
}
