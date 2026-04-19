import "server-only";

import { waitUntil } from "@vercel/functions";

import { markIngestError } from "@/lib/ingest/pipeline";

/**
 * Run one link of the chained ingestion pipeline.
 *
 * Splits the old single-invocation `runIngestion` across separate HTTP
 * endpoints so each step gets its own 60s Hobby-cap budget. Each step
 * returns the relative path of the next hop (e.g. `/api/ingest/xxx/memory`)
 * or `null` to stop. On any uncaught error we flip the trip to `status=error`
 * so the UI stops spinning.
 *
 * Failure mode to know about: if the next-hop `fetch` itself drops (Vercel
 * restart, network blip), the chain stalls — trip sits at `ingesting`. For
 * that we'd need a queue (Inngest/QStash) or a cron sweep, neither wired up.
 */
export function chainStep(
  req: Request,
  tripId: string,
  run: () => Promise<string | null>
): void {
  waitUntil(
    (async () => {
      try {
        const nextPath = await run();
        if (nextPath) {
          const nextUrl = new URL(nextPath, req.url).toString();
          await fetch(nextUrl, { method: "POST" }).catch((e) =>
            console.error(`next-hop dispatch to ${nextPath} failed:`, e)
          );
        }
      } catch (e) {
        console.error(`ingest chain step failed for ${tripId}:`, e);
        await markIngestError(tripId, e);
      }
    })()
  );
}
