export type KGNodeKind =
  | "trip"
  | "person"
  | "place"
  | "decision"
  | "question"
  | "constraint"
  | "preference"
  | "tension"
  | "topic";

export type KGRelation =
  | "PART_OF"
  | "PROPOSED"
  | "PREFERS"
  | "DISLIKES"
  | "ALLERGIC_TO"
  | "DECIDED"
  | "ASKING"
  | "CONSTRAINED_BY"
  | "ABOUT"
  | "SUPERSEDES"
  | "RESOLVES"
  | "TENSION_BETWEEN"
  | "SUPPORTS";

export type KGConfidence = "provisional" | "confirmed" | "disputed";

export interface KGNode {
  id: string;
  trip_id: string;
  kind: KGNodeKind;
  label: string;
  properties: Record<string, unknown>;
  importance: number;
  confidence: KGConfidence;
  origin_table: string | null;
  origin_id: string | null;
  invalidated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface KGEdge {
  id: string;
  trip_id: string;
  src_id: string;
  dst_id: string;
  relation: KGRelation;
  weight: number;
  confidence: KGConfidence;
  properties: Record<string, unknown>;
  source_message_id: string | null;
  invalidated_at: string | null;
  created_at: string;
}

export interface AgentRunActivation {
  id: string;
  trip_id: string;
  run_id: string;
  node_id: string | null;
  edge_id: string | null;
  reason: string | null;
  activated_at: string;
}

export interface GraphSnapshot {
  nodes: KGNode[];
  edges: KGEdge[];
}
