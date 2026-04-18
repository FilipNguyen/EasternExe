"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Place } from "@/types/db";

export function useRealtimePlaces(tripId: string | undefined) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tripId) return;
    const supabase = getSupabaseBrowserClient();
    let active = true;

    (async () => {
      try {
        const res = await fetch(`/api/places?trip_id=${tripId}`, {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as {
          places?: Place[];
        };
        if (!active) return;
        if (body.places) setPlaces(body.places);
      } catch (e) {
        console.error("useRealtimePlaces initial fetch failed:", e);
      } finally {
        if (active) setLoading(false);
      }
    })();

    const channel = supabase
      .channel(`places:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "places",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) =>
          setPlaces((prev) => {
            const p = payload.new as Place;
            if (prev.find((x) => x.id === p.id)) return prev;
            return [...prev, p];
          })
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "places",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) =>
          setPlaces((prev) =>
            prev.map((x) =>
              x.id === (payload.new as Place).id ? (payload.new as Place) : x
            )
          )
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  return { places, loading };
}
