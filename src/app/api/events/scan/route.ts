import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  queryOverpassEventVenues,
  searchWebEvents,
  type EventResult,
} from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tripId = url.searchParams.get("trip_id");
  if (!tripId) {
    return NextResponse.json({ error: "trip_id required" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: trip } = await supabase
    .from("trips")
    .select("destination, destination_lat, destination_lng")
    .eq("id", tripId)
    .maybeSingle();

  if (!trip || !trip.destination) {
    return NextResponse.json(
      { error: "Trip not found or no destination" },
      { status: 404 }
    );
  }

  const lat = trip.destination_lat;
  const lng = trip.destination_lng;

  // Run Overpass + web search in parallel
  const [venueResults, webResults] = await Promise.all([
    lat && lng ? queryOverpassEventVenues(lat, lng, 5000) : Promise.resolve([]),
    searchWebEvents(trip.destination),
  ]);

  // Merge: venues first (they have coordinates), then web results
  const merged: EventResult[] = [...venueResults, ...webResults];

  return NextResponse.json(
    { results: merged },
    { headers: { "cache-control": "public, max-age=300" } }
  );
}
