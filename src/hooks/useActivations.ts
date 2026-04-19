"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AgentRunActivation } from "@/lib/graph/types";

const WINDOW_MS = 5 * 60 * 1000;

interface BroadcastPayload {
  trip_id: string;
  run_id: string;
  node_ids: string[];
  reason?: string;
  at: string;
}

/**
 * Subscribe to ephemeral agent activation events via Supabase Realtime
 * broadcast (no DB table required). When an @agent turn loads the graph,
 * the server fans out { trip_id, run_id, node_ids, at } on the channel
 * `graph-activations:<tripId>`; the graph viz lights those nodes up for
 * ~1.8s.
 */
export function useActivations(tripId: string | undefined) {
  const [activations, setActivations] = useState<AgentRunActivation[]>([]);
  const idCounter = useRef(0);

  const appendFromPayload = useCallback((p: BroadcastPayload) => {
    if (!p.node_ids?.length) return;
    const now = Date.now();
    const newRows: AgentRunActivation[] = p.node_ids.map((nodeId) => ({
      id: `local-${++idCounter.current}`,
      trip_id: p.trip_id,
      run_id: p.run_id,
      node_id: nodeId,
      edge_id: null,
      reason: p.reason ?? null,
      activated_at: p.at ?? new Date().toISOString(),
    }));
    setActivations((prev) => {
      const cutoff = now - WINDOW_MS;
      return [...prev, ...newRows].filter(
        (a) => new Date(a.activated_at).getTime() >= cutoff
      );
    });
  }, []);

  useEffect(() => {
    if (!tripId) {
      setActivations([]);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`graph-activations:${tripId}`, {
        config: { broadcast: { self: true } },
      })
      .on("broadcast", { event: "activate" }, (msg) => {
        appendFromPayload(msg.payload as BroadcastPayload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, appendFromPayload]);

  return { activations };
}
