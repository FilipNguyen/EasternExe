import { NextResponse } from "next/server";

import { chainStep } from "@/lib/ingest/chain";
import {
  listParticipantIds,
  runProfileForParticipant,
} from "@/lib/ingest/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Per-participant profile generation. Self-chains one participant at a time
 * so each LLM call gets its own 60s budget. `?i=N` is the index into the
 * trip's participants (ordered by created_at).
 */
export async function POST(
  req: Request,
  { params }: { params: { tripId: string } }
) {
  if (!params.tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  const idx = Number.parseInt(
    new URL(req.url).searchParams.get("i") ?? "0",
    10
  );

  chainStep(req, params.tripId, async () => {
    const participantIds = await listParticipantIds(params.tripId);
    if (idx >= participantIds.length) {
      return `/api/ingest/${params.tripId}/memory`;
    }
    await runProfileForParticipant(params.tripId, participantIds[idx]);
    return `/api/ingest/${params.tripId}/profiles?i=${idx + 1}`;
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
