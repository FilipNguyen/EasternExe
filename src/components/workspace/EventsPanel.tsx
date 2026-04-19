"use client";

import { useState } from "react";
import { Calendar, Search, Zap } from "lucide-react";

import { SpotCard, type SpotData } from "@/components/chat/SpotCard";
import type { Trip } from "@/types/db";

interface Props {
  trip: Trip;
}

export function EventsPanel({ trip }: Props) {
  const [results, setResults] = useState<SpotData[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/scan?trip_id=${trip.id}`);
      if (!res.ok) throw new Error("Scan failed");
      const data = await res.json();
      // Brave event results fall into two buckets: actual venue hits (have
      // lat/lng) and editorial "things to do in April" articles (have no
      // location). Previously we coerced missing coords to (0,0) — which
      // meant hitting "Add to map" saved a pin at Null Island off Africa.
      // Fall back to the trip destination so the pin at least lands in the
      // right city; the user can reposition or remove if needed.
      const fallbackLat = trip.destination_lat ?? 0;
      const fallbackLng = trip.destination_lng ?? 0;
      setResults(
        (data.results ?? []).map(
          (r: {
            name: string;
            lat: number | null;
            lng: number | null;
            description?: string;
            url?: string;
            category?: string;
            thumbnail_url?: string;
            source_host?: string;
          }) => ({
            name: r.name,
            lat: r.lat ?? fallbackLat,
            lng: r.lng ?? fallbackLng,
            summary: r.description,
            url: r.url,
            category: r.category ?? "other",
            thumbnail_url: r.thumbnail_url,
            source_host: r.source_host,
          })
        )
      );
      setScanned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Events & Pop-ups</h2>
          <p className="text-[11px] text-muted-foreground">
            Limited-time happenings near {trip.destination ?? "your destination"}
          </p>
        </div>
        {scanned && (
          <button
            onClick={handleScan}
            disabled={scanning}
            className="rounded-md border p-1.5 hover:bg-muted disabled:opacity-50"
          >
            <Search className={`size-4 ${scanning ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!scanned && !scanning && !error ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="rounded-full bg-primary/10 p-4">
              <Calendar className="size-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-sm font-semibold">
                Scan for events nearby
              </h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                We&apos;ll search for festivals, pop-ups, concerts, exhibitions,
                and other limited-time happenings near{" "}
                {trip.destination ?? "your destination"}.
              </p>
            </div>
            <button
              onClick={handleScan}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Zap className="size-4" />
              Scan Now
            </button>
          </div>
        ) : scanning ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-lg bg-muted"
              />
            ))}
            <div className="col-span-full py-4 text-center text-xs text-muted-foreground">
              Scanning event venues and web listings...
            </div>
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : results.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No events found right now. Try again closer to your trip dates.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {results.map((event, i) => (
              <SpotCard
                key={`${event.name}-${i}`}
                spot={event}
                tripId={trip.id}
                onSave={() => {
                  setResults((prev) =>
                    prev.map((s) =>
                      s.name === event.name && s.lat === event.lat
                        ? { ...s, already_saved: true }
                        : s
                    )
                  );
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
