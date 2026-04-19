import { NextResponse } from "next/server";

import { chainStep } from "@/lib/ingest/chain";
import {
  listPendingUploadIds,
  runExtractOne,
  tripHasChunks,
} from "@/lib/ingest/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Per-upload extraction. Self-chains one upload per hop so each file gets
 * its own 60s budget — big WhatsApp zips were eating the whole shared
 * budget and starving subsequent notes uploads.
 *
 * No `?i=N` index: `listPendingUploadIds` filters on status, so the head of
 * the list is always the next upload still needing work. That also makes
 * the endpoint idempotent for manual retries.
 */
export async function POST(
  req: Request,
  { params }: { params: { tripId: string } }
) {
  if (!params.tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  chainStep(req, params.tripId, async () => {
    const uploadIds = await listPendingUploadIds(params.tripId);
    if (uploadIds.length === 0) {
      const hasChunks = await tripHasChunks(params.tripId);
      return hasChunks
        ? `/api/ingest/${params.tripId}/profiles?i=0`
        : `/api/ingest/${params.tripId}/finalize`;
    }
    await runExtractOne(params.tripId, uploadIds[0]);
    return `/api/ingest/${params.tripId}/extract`;
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
