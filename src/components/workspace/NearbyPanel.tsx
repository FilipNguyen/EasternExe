"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Compass, RefreshCw } from "lucide-react";

import { SpotCard, type SpotData } from "@/components/chat/SpotCard";
import type { Place, Trip } from "@/types/db";

interface Props {
  trip: Trip;
  places: Place[];
}

export function NearbyPanel({ trip, places }: Props) {
  const [results, setResults] = useState<SpotData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const savedPlaceIds = new Set(
    places.map((p) => p.google_place_id).filter(Boolean)
  );

  const fetchNearby = useCallback(async () => {
    try {
      const params = new URLSearchParams({ trip_id: trip.id });
      if (trip.destination_lat != null) params.set("lat", String(trip.destination_lat));
      if (trip.destination_lng != null) params.set("lng", String(trip.destination_lng));

      const res = await fetch(`/api/places/nearby?${params}`);
      if (!res.ok) throw new Error("Failed to fetch nearby spots");
      const data = await res.json();
      setResults(
        (data.results ?? []).map((r: SpotData & { already_saved?: boolean }) => ({
          ...r,
          already_saved: r.already_saved || (r.place_id ? savedPlaceIds.has(r.place_id) : false),
        }))
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [trip.id, trip.destination_lat, trip.destination_lng]);

  // Initial fetch + 60s polling
  useEffect(() => {
    fetchNearby();
    intervalRef.current = setInterval(fetchNearby, 60000);
    return () => clearInterval(intervalRef.current);
  }, [fetchNearby]);

  const handleRefresh = () => {
    setLoading(true);
    fetchNearby();
  };

  if (!trip.destination_lat || !trip.destination_lng) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <Compass className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            Set a trip destination to discover nearby spots.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Nearby Spots</h2>
          <p className="text-[11px] text-muted-foreground">
            Interesting places near {trip.destination}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="rounded-md border p-1.5 hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && results.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : results.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No nearby spots found. Try refreshing.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {results.map((spot, i) => (
              <SpotCard
                key={`${spot.place_id ?? spot.name}-${i}`}
                spot={spot}
                tripId={trip.id}
                onSave={() => {
                  setResults((prev) =>
                    prev.map((s) =>
                      s.place_id === spot.place_id
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
