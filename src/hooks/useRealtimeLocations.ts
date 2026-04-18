"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface ParticipantLocation {
  participant_id: string;
  trip_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  updated_at: string;
}

/**
 * Subscribes to participant_locations for the trip. Returns a map keyed by
 * participant_id. Falls back to 15s polling if realtime isn't enabled for
 * the table in the Supabase dashboard.
 */
export function useRealtimeLocations(tripId: string | undefined) {
  const [locations, setLocations] = useState<Record<string, ParticipantLocation>>(
    {}
  );

  useEffect(() => {
    if (!tripId) return;
    const supabase = getSupabaseBrowserClient();
    let active = true;

    const fetchAll = async () => {
      try {
        const res = await fetch(`/api/locations?trip_id=${tripId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          locations?: ParticipantLocation[];
        };
        if (!active || !body.locations) return;
        const next: Record<string, ParticipantLocation> = {};
        for (const row of body.locations) {
          next[row.participant_id] = row;
        }
        setLocations(next);
      } catch {
        // Transient — retry on next poll tick.
      }
    };

    fetchAll();

    const channel = supabase
      .channel(`participant-locations:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "participant_locations",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          const row = payload.new as ParticipantLocation | undefined;
          if (!row || !row.participant_id) return;
          setLocations((prev) => ({ ...prev, [row.participant_id]: row }));
        }
      )
      .subscribe();

    const pollHandle = setInterval(fetchAll, 15000);

    return () => {
      active = false;
      clearInterval(pollHandle);
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  return { locations };
}
