import { NextResponse } from "next/server";

import { computeGraphInMemory } from "@/lib/graph/build";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { tripId: string } }
) {
  const supabase = getSupabaseServerClient();
  try {
    const { nodes, edges } = await computeGraphInMemory(
      supabase,
      params.tripId
    );
    return NextResponse.json({ nodes, edges });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("graph compute failed:", msg);
    return NextResponse.json(
      { nodes: [], edges: [], error: msg },
      { status: 500 }
    );
  }
}
