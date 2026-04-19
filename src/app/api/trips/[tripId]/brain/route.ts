import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { tripId: string } }
) {
  const supabase = getSupabaseServerClient();
  const { data: trippers } = await supabase
    .from("participants")
    .select("id")
    .eq("trip_id", params.tripId);
  const participantIds = (trippers ?? []).map((p) => p.id as string);

  const [{ data: memory }, { data: places }, { data: profiles }] =
    await Promise.all([
      supabase
        .from("trip_memory")
        .select("*")
        .eq("trip_id", params.tripId)
        .maybeSingle(),
      supabase
        .from("places")
        .select("id,category,status")
        .eq("trip_id", params.tripId),
      participantIds.length > 0
        ? supabase
            .from("participant_profiles")
            .select(
              "participant_id,personality,interests,travel_style,food_preferences,dealbreakers"
            )
            .in("participant_id", participantIds)
        : Promise.resolve({ data: [] }),
    ]);

  const byCategory: Record<string, number> = {};
  for (const p of (places ?? []) as Array<{ category: string | null }>) {
    const key = p.category ?? "other";
    byCategory[key] = (byCategory[key] ?? 0) + 1;
  }

  return NextResponse.json({
    memory: memory ?? null,
    placesTotal: places?.length ?? 0,
    placesByCategory: byCategory,
    profiles: profiles ?? [],
  });
}
