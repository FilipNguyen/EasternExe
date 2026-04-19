"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Brain, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useActivations } from "@/hooks/useActivations";
import { useTripGraph } from "@/hooks/useTripGraph";
import type { KGNode } from "@/lib/graph/types";
import type { Trip } from "@/types/db";

// react-force-graph uses window/canvas — disable SSR.
// The library's generic types don't play well with strict TS; we use `any`
// at the callback boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph3D: any = dynamic(
  () => import("react-force-graph-3d").then((m) => m.default),
  { ssr: false }
);

const KIND_COLOR: Record<string, string> = {
  trip: "#f59e0b",
  person: "#3b82f6",
  place: "#10b981",
  decision: "#8b5cf6",
  question: "#f97316",
  constraint: "#ef4444",
  preference: "#06b6d4",
  tension: "#ec4899",
  topic: "#facc15",
};

const LAYER_SPACING = 80; // distance between day layers on the z-axis
const GLOW_MS = 1800; // how long a node stays "hot" after activation

interface GraphNode {
  id: string;
  label: string;
  kind: string;
  importance: number;
  dayIndex: number;
  color: string;
  fz: number; // pinned z — makes this node sit in its day's layer
  val: number;
}

interface GraphLink {
  id: string;
  source: string;
  target: string;
  relation: string;
  color: string;
}

function dayIndexOf(createdAt: string, tripStart: Date): number {
  const t = new Date(createdAt).getTime();
  const ms = t - tripStart.getTime();
  const day = Math.floor(ms / (1000 * 60 * 60 * 24));
  return Math.max(day, 0);
}

export function TripBrainGraph({ trip }: { trip: Trip }) {
  const { nodes, edges, loading, rebuild } = useTripGraph(trip.id);
  const { activations } = useActivations(trip.id);
  const [busy, setBusy] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Measure the canvas container so we can hand react-force-graph-3d
  // explicit width/height — without these it defaults to window size and
  // the panel renders an off-center sliver of a huge canvas (= black box).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fgRef = useRef<{
    cameraPosition: (pos: Record<string, number>) => void;
    d3Force?: (name: string) => { strength?: (n: number) => void } | undefined;
  }>();

  // Auto-rebuild once if the graph is empty on first mount.
  const autoRebuiltRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (nodes.length === 0 && !autoRebuiltRef.current) {
      autoRebuiltRef.current = true;
      rebuild();
    }
  }, [loading, nodes.length, rebuild]);

  const tripStart = useMemo(() => {
    if (trip.start_date) return new Date(trip.start_date);
    return new Date(trip.created_at);
  }, [trip.start_date, trip.created_at]);

  // Build a map of node_id -> latest activation time for glow.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const latestActivationByNode = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of activations) {
      if (!a.node_id) continue;
      const t = new Date(a.activated_at).getTime();
      const prev = map.get(a.node_id) ?? 0;
      if (t > prev) map.set(a.node_id, t);
    }
    return map;
  }, [activations]);

  const { graphNodes, graphLinks, dayRange } = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let minDay = Infinity;
    let maxDay = -Infinity;
    const gn: GraphNode[] = nodes.map((n: KGNode) => {
      const di = dayIndexOf(n.created_at, tripStart);
      if (di < minDay) minDay = di;
      if (di > maxDay) maxDay = di;
      return {
        id: n.id,
        label: n.label,
        kind: n.kind,
        importance: n.importance,
        dayIndex: di,
        color: KIND_COLOR[n.kind] ?? "#94a3b8",
        fz: di * LAYER_SPACING,
        val: 2 + n.importance * 6,
      };
    });
    const gl: GraphLink[] = [];
    for (const e of edges) {
      if (!byId.has(e.src_id) || !byId.has(e.dst_id)) continue;
      gl.push({
        id: e.id,
        source: e.src_id,
        target: e.dst_id,
        relation: e.relation as string,
        color: "rgba(148,163,184,0.35)",
      });
    }
    return {
      graphNodes: gn,
      graphLinks: gl,
      dayRange:
        isFinite(minDay) && isFinite(maxDay)
          ? { min: minDay, max: maxDay }
          : { min: 0, max: 0 },
    };
  }, [nodes, edges, tripStart]);

  const handleRebuild = async () => {
    setBusy(true);
    try {
      await rebuild();
    } finally {
      setBusy(false);
    }
  };

  const handleSummarize = async () => {
    setSummarizing(true);
    try {
      await fetch(`/api/trips/${trip.id}/graph/summarize`, { method: "POST" });
      await rebuild();
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Brain className="size-4 text-violet-500" />
          <div>
            <div className="text-sm font-semibold">Trip brain</div>
            <div className="text-[10px] text-muted-foreground">
              {nodes.length} nodes · {edges.length} edges ·{" "}
              {dayRange.max - dayRange.min + 1} day layers
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSummarize}
            disabled={summarizing}
            title="Ask the LLM to fold new chat into the brain"
          >
            {summarizing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            <span className="ml-1 text-[11px]">Summarize chat</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRebuild}
            disabled={busy}
            title="Rebuild graph from current trip data"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            <span className="ml-1 text-[11px]">Rebuild</span>
          </Button>
        </div>
      </div>

      <Legend />

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(ellipse_at_center,_#0b1020_0%,_#000_100%)]"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Loading graph…
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
            <div>No brain yet.</div>
            <div className="opacity-70">
              Click <span className="font-medium">Rebuild</span> to derive one
              from trip data, or <span className="font-medium">Summarize chat</span> to
              fold in recent messages.
            </div>
          </div>
        ) : size.w === 0 ? null : (
          <ForceGraph3D
            ref={fgRef as never}
            width={size.w}
            height={size.h}
            graphData={{ nodes: graphNodes, links: graphLinks }}
            backgroundColor="rgba(0,0,0,0)"
            onNodeClick={(n: GraphNode) => setSelectedNodeId(n.id)}
            onBackgroundClick={() => setSelectedNodeId(null)}
            nodeLabel={(n: GraphNode) =>
              `<div style="background:#0f172a;color:white;padding:4px 8px;border-radius:6px;font-size:11px;">
                 <div style="font-weight:600">${escapeHtml(n.label)}</div>
                 <div style="opacity:0.6;margin-top:2px;text-transform:capitalize">${n.kind} · day ${n.dayIndex}</div>
               </div>`
            }
            linkLabel={(l: GraphLink) => l.relation}
            nodeThreeObject={(n: GraphNode) => {
              const lastHit = latestActivationByNode.get(n.id);
              const since = lastHit ? now - lastHit : Infinity;
              const isHot = since < GLOW_MS;
              // Pulse every ~300ms while hot (full sin cycle = 2π rad)
              const pulse = isHot
                ? 1 + 0.4 * Math.sin((since / 300) * Math.PI * 2)
                : 1;
              const radius = n.val * pulse;
              const group = new THREE.Group();
              const mat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(n.color),
                transparent: true,
                opacity: isHot ? 1 : 0.9,
              });
              const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(radius, 16, 16),
                mat
              );
              group.add(sphere);
              if (isHot) {
                const bloomOpacity = 0.5 * (1 - since / GLOW_MS);
                const haloMat = new THREE.MeshBasicMaterial({
                  color: new THREE.Color(n.color),
                  transparent: true,
                  opacity: bloomOpacity,
                });
                const halo = new THREE.Mesh(
                  new THREE.SphereGeometry(radius * 3.5, 16, 16),
                  haloMat
                );
                group.add(halo);
                // Outer ring — saturated white-ish for pop
                const outerMat = new THREE.MeshBasicMaterial({
                  color: new THREE.Color("#fde68a"),
                  transparent: true,
                  opacity: bloomOpacity * 0.35,
                });
                const outer = new THREE.Mesh(
                  new THREE.SphereGeometry(radius * 5, 12, 12),
                  outerMat
                );
                group.add(outer);
              }
              return group;
            }}
            linkWidth={0.6}
            linkOpacity={0.5}
            linkDirectionalParticles={(l: GraphLink) => {
              const src = l.source as unknown as GraphNode | string;
              const srcId = typeof src === "string" ? src : src.id;
              return latestActivationByNode.has(srcId) ? 2 : 0;
            }}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.006}
            linkColor={(l: GraphLink) => {
              const src = l.source as unknown as GraphNode | string;
              const srcId = typeof src === "string" ? src : src.id;
              const hot = latestActivationByNode.has(srcId);
              return hot ? "rgba(251,191,36,0.85)" : "rgba(148,163,184,0.35)";
            }}
            // Tighter cooldown so the sim settles quickly instead of endlessly
            // drifting. d3VelocityDecay = friction; d3AlphaDecay speeds the
            // cool-down; d3AlphaMin stops the sim earlier than the default.
            cooldownTicks={120}
            warmupTicks={30}
            d3AlphaDecay={0.06}
            d3AlphaMin={0.02}
            d3VelocityDecay={0.55}
            // When the sim stops, pin every node in place. Dragging a node
            // still works (react-force-graph repins on drop), but nothing
            // drifts passively any more.
            onEngineStop={() => {
              const fg = fgRef.current as unknown as
                | { graphData?: () => { nodes: Array<{ x: number; y: number; fx?: number; fy?: number }> } }
                | undefined;
              const data = fg?.graphData?.();
              if (!data) return;
              for (const n of data.nodes) {
                if (typeof n.x === "number") n.fx = n.x;
                if (typeof n.y === "number") n.fy = n.y;
              }
            }}
            showNavInfo={false}
          />
        )}

        {selectedNodeId ? (
          <WikiPanel
            node={nodes.find((n) => n.id === selectedNodeId)!}
            allNodes={nodes}
            allEdges={edges}
            onClose={() => setSelectedNodeId(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function WikiPanel({
  node,
  allNodes,
  allEdges,
  onClose,
}: {
  node: { id: string; kind: string; label: string; properties: Record<string, unknown>; importance: number };
  allNodes: { id: string; kind: string; label: string }[];
  allEdges: { src_id: string; dst_id: string; relation: string }[];
  onClose: () => void;
}) {
  if (!node) return null;
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const outgoing = allEdges.filter((e) => e.src_id === node.id);
  const incoming = allEdges.filter((e) => e.dst_id === node.id);
  const color = KIND_COLOR[node.kind] ?? "#94a3b8";

  return (
    <div className="absolute inset-y-0 right-0 flex w-[320px] flex-col border-l border-white/10 bg-slate-950/95 text-slate-100 shadow-2xl backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
            <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: color }} />
            {node.kind}
          </div>
          <div className="mt-1 break-words text-base font-semibold leading-snug">
            {node.label}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
        {Object.keys(node.properties ?? {}).length > 0 ? (
          <section>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Properties
            </div>
            <dl className="space-y-1">
              {Object.entries(node.properties).map(([k, v]) =>
                v === null || v === undefined || v === "" ? null : (
                  <div key={k} className="flex gap-2">
                    <dt className="w-24 shrink-0 text-slate-500">{k}</dt>
                    <dd className="flex-1 break-words text-slate-200">
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </dd>
                  </div>
                )
              )}
            </dl>
          </section>
        ) : null}

        {outgoing.length > 0 ? (
          <section>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Connects to ({outgoing.length})
            </div>
            <ul className="space-y-1">
              {outgoing.map((e, i) => {
                const dst = byId.get(e.dst_id);
                if (!dst) return null;
                const dstColor = KIND_COLOR[dst.kind] ?? "#94a3b8";
                return (
                  <li key={i} className="flex items-start gap-2 rounded bg-white/5 px-2 py-1.5">
                    <span className="mt-1 inline-block size-1.5 shrink-0 rounded-full" style={{ backgroundColor: dstColor }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[9px] font-mono uppercase tracking-wider text-slate-500">
                        {e.relation.replace(/_/g, " ").toLowerCase()}
                      </div>
                      <div className="break-words text-[11px] text-slate-200">{dst.label}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {incoming.length > 0 ? (
          <section>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Referenced by ({incoming.length})
            </div>
            <ul className="space-y-1">
              {incoming.map((e, i) => {
                const src = byId.get(e.src_id);
                if (!src) return null;
                const srcColor = KIND_COLOR[src.kind] ?? "#94a3b8";
                return (
                  <li key={i} className="flex items-start gap-2 rounded bg-white/5 px-2 py-1.5">
                    <span className="mt-1 inline-block size-1.5 shrink-0 rounded-full" style={{ backgroundColor: srcColor }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[9px] font-mono uppercase tracking-wider text-slate-500">
                        {e.relation.replace(/_/g, " ").toLowerCase()}
                      </div>
                      <div className="break-words text-[11px] text-slate-200">{src.label}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="border-t border-white/5 pt-2 text-[10px] text-slate-500">
          Importance · {node.importance.toFixed(2)} · id {node.id.slice(0, 32)}
        </section>
      </div>
    </div>
  );
}

function Legend() {
  const kinds: { kind: string; label: string }[] = [
    { kind: "trip", label: "Trip" },
    { kind: "topic", label: "Topics" },
    { kind: "person", label: "People" },
    { kind: "place", label: "Places" },
    { kind: "decision", label: "Decisions" },
    { kind: "question", label: "Questions" },
    { kind: "constraint", label: "Constraints" },
    { kind: "preference", label: "Preferences" },
    { kind: "tension", label: "Tensions" },
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 border-b bg-background/80 px-3 py-1.5 text-[10px]">
      {kinds.map((k) => (
        <span key={k.kind} className="inline-flex items-center gap-1">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: KIND_COLOR[k.kind] }}
          />
          {k.label}
        </span>
      ))}
      <span className="ml-auto text-[10px] text-muted-foreground">
        Z-axis = day · yellow = agent touched it
      </span>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
