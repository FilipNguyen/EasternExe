import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { tripId: string } }
) {
  const supabase = getSupabaseServerClient();
  const [{ data: trip }, { data: uploads }] = await Promise.all([
    supabase.from("trips").select("*").eq("id", params.tripId).maybeSingle(),
    supabase.from("uploads").select("*").eq("trip_id", params.tripId),
  ]);
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ trip, uploads: uploads ?? [] });
}
