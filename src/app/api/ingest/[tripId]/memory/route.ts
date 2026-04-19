import { NextResponse } from "next/server";

import { chainStep } from "@/lib/ingest/chain";
import { runMemory } from "@/lib/ingest/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: { tripId: string } }
) {
  if (!params.tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  chainStep(req, params.tripId, async () => {
    await runMemory(params.tripId);
    return `/api/ingest/${params.tripId}/places`;
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
