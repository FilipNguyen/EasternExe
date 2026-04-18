"use client";

import { useEffect, useRef, useState } from "react";

export type GeoPermission = "unknown" | "granted" | "denied" | "prompt";

interface Options {
  tripId: string;
  participantId: string | null;
  enabled: boolean;
}

/**
 * Watches the user's location and upserts it into participant_locations
 * every ~10s (or sooner on a meaningful move). Returns permission state
 * so callers can show a prompt-to-enable affordance.
 */
export function useGeolocation({ tripId, participantId, enabled }: Options) {
  const [permission, setPermission] = useState<GeoPermission>("unknown");
  const [error, setError] = useState<string | null>(null);
  const lastUpsertRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !participantId) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Geolocation unsupported");
      return;
    }

    const upsert = async (lat: number, lng: number, accuracy?: number) => {
      const now = Date.now();
      if (now - lastUpsertRef.current < 8000) return;
      lastUpsertRef.current = now;
      try {
        const res = await fetch("/api/locations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            participant_id: participantId,
            trip_id: tripId,
            lat,
            lng,
            accuracy: accuracy ?? null,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(body.error ?? `upsert failed (${res.status})`);
        } else {
          setError(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPermission("granted");
        setError(null);
        upsert(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setPermission("denied");
        else setPermission("prompt");
        setError(err.message);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled, participantId, tripId]);

  return { permission, error };
}
