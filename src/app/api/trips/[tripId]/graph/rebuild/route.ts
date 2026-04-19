import { NextResponse } from "next/server";

import { computeGraphInMemory } from "@/lib/graph/build";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Rebuild" in the zero-migration architecture is just re-compute. No DB
 * writes — the graph is a live projection of trip_memory + profiles +
 * places. Kept as its own endpoint so the UI button has something to hit
 * and can show a result count.
 */
export async function POST(
  _req: Request,
  { params }: { params: { tripId: string } }
) {
  const supabase = getSupabaseServerClient();
  try {
    const { nodes, edges } = await computeGraphInMemory(
      supabase,
      params.tripId
    );
    return NextResponse.json({
      ok: true,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("graph rebuild failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
