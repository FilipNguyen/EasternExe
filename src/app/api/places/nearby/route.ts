import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { googlePlacesNearbySearch } from "@/lib/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tripId = url.searchParams.get("trip_id");
  if (!tripId) {
    return NextResponse.json({ error: "trip_id required" }, { status: 400 });
  }

  const latParam = url.searchParams.get("lat");
  const lngParam = url.searchParams.get("lng");

  const supabase = getSupabaseServerClient();

  // Get trip destination coordinates if lat/lng not provided
  let lat = latParam ? Number(latParam) : null;
  let lng = lngParam ? Number(lngParam) : null;

  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
    const { data: trip } = await supabase
      .from("trips")
      .select("destination_lat, destination_lng")
      .eq("id", tripId)
      .maybeSingle();

    if (trip) {
      lat = trip.destination_lat;
      lng = trip.destination_lng;
    }
  }

  if (lat == null || lng == null) {
    return NextResponse.json(
      { error: "No coordinates available for this trip" },
      { status: 400 }
    );
  }

  const results = await googlePlacesNearbySearch(lat, lng, 1500);

  // Get existing places for this trip to mark duplicates
  const { data: existing } = await supabase
    .from("places")
    .select("google_place_id")
    .eq("trip_id", tripId);

  const existingIds = new Set(
    (existing ?? []).map((p) => p.google_place_id).filter(Boolean)
  );

  const enriched = results.map((r) => ({
    ...r,
    already_saved: existingIds.has(r.place_id),
  }));

  return NextResponse.json(
    { results: enriched },
    { headers: { "cache-control": "public, max-age=60" } }
  );
}
