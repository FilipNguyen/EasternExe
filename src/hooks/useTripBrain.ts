"use client";

import { useEffect, useState } from "react";

import type { ParticipantProfile, TripMemory } from "@/types/db";

export interface TripBrainData {
  memory: TripMemory | null;
  placesTotal: number;
  placesByCategory: Record<string, number>;
  profiles: Pick<
    ParticipantProfile,
    | "participant_id"
    | "personality"
    | "interests"
    | "travel_style"
    | "food_preferences"
    | "dealbreakers"
  >[];
}

export function useTripBrain(tripId: string | undefined) {
  const [data, setData] = useState<TripBrainData | null>(null);

  useEffect(() => {
    if (!tripId) return;
    let active = true;

    const fetchBrain = async () => {
      try {
        const res = await fetch(`/api/trips/${tripId}/brain`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as TripBrainData;
        if (active) setData(body);
      } catch {
        // transient
      }
    };

    fetchBrain();
    const poll = setInterval(fetchBrain, 15000);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [tripId]);

  return data;
}
