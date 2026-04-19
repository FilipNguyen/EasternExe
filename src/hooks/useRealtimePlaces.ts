"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Place } from "@/types/db";

const POLL_INTERVAL_MS = 5000;

export const PLACE_SAVED_EVENT = "quorum:place-saved";

export function dispatchPlaceSaved(place: Place) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<Place>(PLACE_SAVED_EVENT, { detail: place })
  );
}

export function useRealtimePlaces(tripId: string | undefined) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const pollTimerRef = useRef<ReturnType<typeof setInterval>>();

  const mergePlace = useCallback((p: Place) => {
    setPlaces((prev) => {
      const idx = prev.findIndex((x) => x.id === p.id);
      if (idx === -1) return [...prev, p];
      const next = prev.slice();
      next[idx] = p;
      return next;
    });
  }, []);

  const fetchPlaces = useCallback(async () => {
    if (!tripId) return;
    try {
      const res = await fetch(`/api/places?trip_id=${tripId}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        places?: Place[];
      };
      if (body.places) {
        setPlaces((prev) => {
          // Keep optimistic-merged rows that haven't come back in the fetch yet;
          // the server response is authoritative for everything it returns.
          const byId = new Map<string, Place>();
          for (const p of prev) byId.set(p.id, p);
          for (const p of body.places!) byId.set(p.id, p);
          return Array.from(byId.values());
        });
      }
    } catch (e) {
      console.error("useRealtimePlaces fetch failed:", e);
    }
  }, [tripId]);

  useEffect(() => {
    if (!tripId) {
      setPlaces([]);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    let active = true;

    setPlaces([]);

    (async () => {
      setLoading(true);
      await fetchPlaces();
      if (active) setLoading(false);
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
        (payload) => mergePlace(payload.new as Place)
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "places",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => mergePlace(payload.new as Place)
      )
      .subscribe();

    // Polling fallback: catches inserts if realtime isn't enabled on `places`.
    pollTimerRef.current = setInterval(fetchPlaces, POLL_INTERVAL_MS);

    // Cross-component event: PlaceResultCard (and others) dispatch this
    // on successful save so the marker appears instantly without waiting
    // for realtime or the next poll tick.
    const onPlaceSaved = (e: Event) => {
      const ce = e as CustomEvent<Place>;
      if (ce.detail && ce.detail.trip_id === tripId) {
        mergePlace(ce.detail);
      }
    };
    window.addEventListener(PLACE_SAVED_EVENT, onPlaceSaved);

    return () => {
      active = false;
      supabase.removeChannel(channel);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      window.removeEventListener(PLACE_SAVED_EVENT, onPlaceSaved);
    };
  }, [tripId, mergePlace, fetchPlaces]);

  return { places, loading };
}
