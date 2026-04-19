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
  day: "#a78bfa",
};

// Force-layout link strengths per edge kind. Hub spokes stay weak (the
// auto-normalized default from d3-force would be 1/degree — we override to
// avoid hub drift); sibling semantic edges pull harder so NEAR / SAME_DAY
// clusters tighten. Numbers come from the eval agent synthesis + d3 docs.
const RELATION_STRENGTH: Record<string, number> = {
  PART_OF: 0.3,
  ABOUT: 0.25,
  SCHEDULED_ON: 0.5,
  NEXT_DAY: 0.7,
  NEAR: 0.55,
  SAME_DAY: 0.45,
  SAME_TIME_OF_DAY: 0.25,
  PROPOSED: 0.3,
  CONSTRAINED_BY: 0.3,
  DECIDED: 0.3,
  ASKING: 0.3,
  SUPPORTS: 0.25,
  TENSION_BETWEEN: 0.3,
};

// Topic hubs sit on a fixed ring around the origin — gives the layout a
// stable skeleton. Radius chosen so 10 topics + day spine fit comfortably.
const TOPIC_RING_RADIUS = 260;
// Day nodes sit on a second, tighter ring so the itinerary spine doesn't
// get lost inside the topic ring.
const DAY_RING_RADIUS = 140;

// 3D day-axis — each calendar day gets its own Z-plane. Nodes scheduled
// on a day stack onto that day's plane. Topic hubs float on a meta-plane
// above everything. Unscheduled nodes sit on a "general" plane between
// the topic meta-plane and the earliest day.
const LAYER_SPACING = 140;
const TOPIC_PLANE_Z = -400; // topics hover above the day stack
const UNSCHEDULED_PLANE_Z = -200;

const GLOW_MS = 1800; // how long a node stays "hot" after activation

interface GraphNode {
  id: string;
  label: string;
  kind: string;
  importance: number;
  dayIndex: number;
  color: string;
  fx?: number;
  fy?: number;
  fz?: number;
  val: number;
  degree: number;
}

interface GraphLink {
  id: string;
  source: string;
  target: string;
  relation: string;
  color: string;
  strength: number;
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

  // Persistent positions across rebuilds. Every time the simulation
  // settles (onEngineStop) we copy the live (x,y,z) into this ref, and
  // every time we rebuild GraphNode objects we re-apply them as (fx,fy,
  // fz). This is what makes the layout actually static: d3-force starts
  // with every node already at its pinned position, so there's nothing
  // to solve on re-render.
  const pinnedPositions = useRef<
    Map<string, { x: number; y: number; z: number; dayIndex: number }>
  >(new Map());

  // Auto-rebuild once if the graph is empty on first mount.
  const autoRebuiltRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (nodes.length === 0 && !autoRebuiltRef.current) {
      autoRebuiltRef.current = true;
      rebuild();
    }
  }, [loading, nodes.length, rebuild]);

  // Activation glow state uses a ref for the ticking `now` value so the 4Hz
  // interval never triggers a re-render of the ForceGraph subtree. Without
  // this decoupling, react-force-graph-3d sees a fresh graphData object
  // reference every 250ms and reheats the simulation → graph never settles.
  // See Eval 6 / vasturiano/react-force-graph#reheat-on-prop-change.
  const nowRef = useRef<number>(Date.now());
  // Prefix `_` to silence unused warning while retaining the re-render
  // trigger. The value is only read via nowRef in nodeThreeObject.
  const [, setGlowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      nowRef.current = Date.now();
      // Bump a tiny state only to rerender the THREE object inline render;
      // we immediately gate ForceGraph3D's reheat via a stable graphData ref
      // below, so this rerender doesn't restart the sim.
      setGlowTick((t) => (t + 1) % 1_000_000);
    }, 250);
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

    // Degree count — drives node sizing and the focus+context neighbor set.
    const degree = new Map<string, number>();
    for (const e of edges) {
      if (!byId.has(e.src_id) || !byId.has(e.dst_id)) continue;
      degree.set(e.src_id, (degree.get(e.src_id) ?? 0) + 1);
      degree.set(e.dst_id, (degree.get(e.dst_id) ?? 0) + 1);
    }

    // Sort topics + days deterministically so ring positions are stable
    // across rebuilds.
    const topicIds = nodes
      .filter((n) => n.kind === "topic")
      .map((n) => n.id)
      .sort();
    const dayIds = nodes
      .filter((n) => n.kind === "day")
      .map((n) => n.id)
      .sort();

    // Read the server-computed day_index on each node's properties.
    // Nodes with a SCHEDULED_ON edge to a day inherit that day's index;
    // the rest get -1 (unscheduled plane). See src/lib/graph/build.ts
    // step 7 where propagation happens.
    const dayIndexOfNode = (n: KGNode): number => {
      const v = (n.properties as { day_index?: unknown } | null)?.day_index;
      return typeof v === "number" ? v : -1;
    };

    let minDay = 0;
    let maxDay = 0;
    for (const n of nodes) {
      const di = dayIndexOfNode(n);
      if (di < 0) continue;
      if (di < minDay) minDay = di;
      if (di > maxDay) maxDay = di;
    }

    const gn: GraphNode[] = nodes.map((n: KGNode) => {
      const di = dayIndexOfNode(n);
      const deg = degree.get(n.id) ?? 0;
      const base: GraphNode = {
        id: n.id,
        label: n.label,
        kind: n.kind,
        importance: n.importance,
        dayIndex: di,
        color: KIND_COLOR[n.kind] ?? "#94a3b8",
        val: 2 + n.importance * 5 + Math.log2(1 + deg) * 1.6,
        degree: deg,
      };

      // Z-plane: day-index-based stacking. Topics sit on a meta-plane
      // above the whole stack. Unscheduled nodes (di = -1) go on their
      // own plane just below the topic plane.
      const zForDayIndex =
        di >= 0 ? di * LAYER_SPACING : UNSCHEDULED_PLANE_Z;

      if (n.kind === "trip") {
        base.fx = 0;
        base.fy = 0;
        base.fz = TOPIC_PLANE_Z;
      } else if (n.kind === "topic") {
        const idx = topicIds.indexOf(n.id);
        const total = Math.max(topicIds.length, 1);
        const angle = (idx / total) * Math.PI * 2;
        base.fx = Math.cos(angle) * TOPIC_RING_RADIUS;
        base.fy = Math.sin(angle) * TOPIC_RING_RADIUS;
        base.fz = TOPIC_PLANE_Z;
      } else if (n.kind === "day") {
        const idx = dayIds.indexOf(n.id);
        const total = Math.max(dayIds.length, 1);
        const angle = (idx / total) * Math.PI * 2 + Math.PI / total;
        base.fx = Math.cos(angle) * DAY_RING_RADIUS;
        base.fy = Math.sin(angle) * DAY_RING_RADIUS;
        // Each day node anchors its own Z-plane. Non-day nodes scheduled
        // on that day stack onto the same plane.
        base.fz = zForDayIndex;
      } else {
        // X/Y floats free so sibling edges (NEAR / SAME_DAY) shape the
        // cluster within the plane; Z is pinned to the day layer so the
        // layers visibly stack in 3D.
        base.fz = zForDayIndex;
      }

      // If we've remembered a position from a prior settle, restore it —
      // but only if the day index hasn't changed. A node moving to a new
      // day plane must re-layout; otherwise reuse the settled position so
      // renders don't restart the sim.
      const saved = pinnedPositions.current.get(n.id);
      if (saved && saved.dayIndex === di) {
        base.fx = saved.x;
        base.fy = saved.y;
        base.fz = saved.z;
      }
      return base;
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
        strength:
          RELATION_STRENGTH[e.relation as string] ??
          (typeof e.weight === "number" ? e.weight : 0.3),
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
  }, [nodes, edges]);

  // Neighbor set for focus+context. Memoized against selection + edges so
  // clicking a node dims the rest of the graph without reheating forces.
  const neighborSet = useMemo(() => {
    if (!selectedNodeId) return null;
    const oneHop = new Set<string>([selectedNodeId]);
    const twoHop = new Set<string>([selectedNodeId]);
    for (const e of edges) {
      if (e.src_id === selectedNodeId) oneHop.add(e.dst_id);
      if (e.dst_id === selectedNodeId) oneHop.add(e.src_id);
    }
    for (const e of edges) {
      if (oneHop.has(e.src_id)) twoHop.add(e.dst_id);
      if (oneHop.has(e.dst_id)) twoHop.add(e.src_id);
    }
    return { oneHop, twoHop };
  }, [selectedNodeId, edges]);

  // Stable graphData object — key on node/edge identity, NOT on glowTick.
  // This is the fix for the reheat-forever bug: feeding a fresh
  // {nodes,links} object literal on every render reset d3-force's alpha to
  // 1 each time setGlowTick fired.
  const graphData = useMemo(
    () => ({ nodes: graphNodes, links: graphLinks }),
    [graphNodes, graphLinks]
  );

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
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            onNodeClick={(n: GraphNode) => setSelectedNodeId(n.id)}
            onBackgroundClick={() => setSelectedNodeId(null)}
            nodeLabel={(n: GraphNode) =>
              `<div style="background:#0f172a;color:white;padding:4px 8px;border-radius:6px;font-size:11px;">
                 <div style="font-weight:600">${escapeHtml(n.label)}</div>
                 <div style="opacity:0.6;margin-top:2px;text-transform:capitalize">${n.kind} · degree ${n.degree}</div>
               </div>`
            }
            linkLabel={(l: GraphLink) => l.relation}
            nodeThreeObject={(n: GraphNode) => {
              const now = nowRef.current;
              const lastHit = latestActivationByNode.get(n.id);
              const since = lastHit ? now - lastHit : Infinity;
              const isHot = since < GLOW_MS;
              // Pulse every ~300ms while hot (full sin cycle = 2π rad)
              const pulse = isHot
                ? 1 + 0.4 * Math.sin((since / 300) * Math.PI * 2)
                : 1;
              const radius = n.val * pulse;
              const group = new THREE.Group();

              // Focus+context: if a node is selected, dim anything outside
              // the 2-hop neighborhood so the relevant sub-graph pops.
              const inFocus =
                !neighborSet || neighborSet.twoHop.has(n.id);
              const isDirect =
                !neighborSet || neighborSet.oneHop.has(n.id);
              const baseOpacity = !inFocus
                ? 0.08
                : isDirect || isHot
                  ? 1
                  : 0.5;

              const mat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(n.color),
                transparent: true,
                opacity: baseOpacity,
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
              const dst = l.target as unknown as GraphNode | string;
              const srcId = typeof src === "string" ? src : src.id;
              const dstId = typeof dst === "string" ? dst : dst.id;
              const hot = latestActivationByNode.has(srcId);
              if (hot) return "rgba(251,191,36,0.85)";

              // Focus+context: fade edges that don't touch the selected
              // node's 2-hop neighborhood.
              if (neighborSet) {
                const touches =
                  neighborSet.twoHop.has(srcId) ||
                  neighborSet.twoHop.has(dstId);
                if (!touches) return "rgba(148,163,184,0.04)";
              }

              // Sibling semantic edges (NEAR / SAME_DAY) pop brighter so
              // the graph's web-like structure is visible; hub spokes
              // (ABOUT / PART_OF) dim into context.
              if (
                l.relation === "NEAR" ||
                l.relation === "SAME_DAY" ||
                l.relation === "NEXT_DAY"
              ) {
                return "rgba(186,230,253,0.55)";
              }
              return "rgba(148,163,184,0.18)";
            }}
            // Per-link force strength pulled from the edge type map so
            // semantic edges (NEAR, SAME_DAY) pull harder than hub spokes.
            linkStrength={(l: GraphLink) => l.strength}
            // Settle-and-stop recipe validated in research: heavier
            // friction, higher alphaMin to kill residual oscillation,
            // slightly slower alphaDecay so the settle actually reaches
            // equilibrium before being clamped.
            cooldownTicks={80}
            warmupTicks={60}
            d3AlphaDecay={0.035}
            d3AlphaMin={0.1}
            d3VelocityDecay={0.75}
            // When the sim stops, pin every node in place. Dragging a node
            // still works (react-force-graph re-pins on drop), and since
            // graphData's object identity is now stable (not recreated on
            // every render) the sim doesn't re-heat on glow-tick renders.
            onEngineStop={() => {
              const fg = fgRef.current as unknown as
                | {
                    graphData?: () => {
                      nodes: Array<{
                        id: string;
                        x: number;
                        y: number;
                        z?: number;
                        fx?: number;
                        fy?: number;
                        fz?: number;
                        dayIndex?: number;
                      }>;
                    };
                  }
                | undefined;
              const data = fg?.graphData?.();
              if (!data) return;
              for (const n of data.nodes) {
                if (typeof n.x !== "number" || typeof n.y !== "number") continue;
                n.fx = n.x;
                n.fy = n.y;
                if (typeof n.z === "number") n.fz = n.z;
                pinnedPositions.current.set(n.id, {
                  x: n.x,
                  y: n.y,
                  z: typeof n.z === "number" ? n.z : 0,
                  dayIndex: typeof n.dayIndex === "number" ? n.dayIndex : -1,
                });
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
    { kind: "day", label: "Days" },
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
