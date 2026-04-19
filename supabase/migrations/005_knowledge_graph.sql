-- EasternExe — knowledge graph tables for the "trip brain" viz.
-- Paste into Supabase SQL Editor and Run after 004.
-- Then: Dashboard → Database → Replication → enable realtime for
--   kg_nodes, kg_edges, agent_run_activations

-- ---------------------------------------------------------------
-- kg_nodes — entities in the trip graph (people, places, decisions, …)
-- ---------------------------------------------------------------
create table if not exists kg_nodes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  kind text not null check (kind in (
    'trip',        -- hub node: the trip itself
    'person',      -- a participant
    'place',       -- a saved place (mirrors places.id when origin_id is set)
    'decision',    -- something the group has decided
    'question',    -- an open question
    'constraint',  -- a hard constraint (budget, dietary, accessibility)
    'preference',  -- a soft preference (food, vibe, activity)
    'tension'      -- a disagreement the group is working through
  )),
  label text not null,
  properties jsonb default '{}',
  importance real default 0.5,
  confidence text default 'provisional' check (confidence in ('provisional','confirmed','disputed')),
  origin_table text,      -- where this node was derived from (participants, places, trip_memory, …)
  origin_id text,          -- row id in origin_table (may be uuid or synthetic key)
  invalidated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on kg_nodes (trip_id);
create index on kg_nodes (trip_id, kind);
create unique index kg_nodes_origin_unique on kg_nodes (trip_id, origin_table, origin_id)
  where origin_table is not null and origin_id is not null;

-- ---------------------------------------------------------------
-- kg_edges — typed relationships between nodes (closed enum)
-- ---------------------------------------------------------------
create table if not exists kg_edges (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  src_id uuid not null references kg_nodes(id) on delete cascade,
  dst_id uuid not null references kg_nodes(id) on delete cascade,
  relation text not null check (relation in (
    'PART_OF',        -- person PART_OF trip
    'PROPOSED',       -- person PROPOSED place
    'PREFERS',        -- person PREFERS preference
    'DISLIKES',       -- person DISLIKES preference/constraint
    'ALLERGIC_TO',    -- person ALLERGIC_TO constraint
    'DECIDED',        -- group/trip DECIDED decision
    'ASKING',         -- group/trip ASKING question
    'CONSTRAINED_BY', -- trip CONSTRAINED_BY constraint
    'ABOUT',          -- decision/question ABOUT place/topic
    'SUPERSEDES',     -- decision SUPERSEDES decision
    'RESOLVES',       -- decision RESOLVES question
    'TENSION_BETWEEN',-- tension TENSION_BETWEEN two things
    'SUPPORTS'        -- generic: something supports something (fallback)
  )),
  weight real default 1.0,
  confidence text default 'provisional' check (confidence in ('provisional','confirmed','disputed')),
  properties jsonb default '{}',
  source_message_id uuid references chat_messages(id) on delete set null,
  invalidated_at timestamptz,
  created_at timestamptz default now()
);
create index on kg_edges (trip_id);
create index on kg_edges (src_id);
create index on kg_edges (dst_id);
create index on kg_edges (trip_id, relation);

-- ---------------------------------------------------------------
-- agent_run_activations — which nodes/edges the agent touched in a run
-- drives the "light up" visualization
-- ---------------------------------------------------------------
create table if not exists agent_run_activations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  run_id uuid not null references ai_runs(id) on delete cascade,
  node_id uuid references kg_nodes(id) on delete cascade,
  edge_id uuid references kg_edges(id) on delete cascade,
  reason text,
  activated_at timestamptz default now(),
  check (node_id is not null or edge_id is not null)
);
create index on agent_run_activations (trip_id);
create index on agent_run_activations (run_id);
create index on agent_run_activations (trip_id, activated_at desc);

-- ---------------------------------------------------------------
-- RLS: disabled (trip_id in URL is the boundary — matches the rest of schema)
-- ---------------------------------------------------------------
alter table kg_nodes disable row level security;
alter table kg_edges disable row level security;
alter table agent_run_activations disable row level security;

-- ---------------------------------------------------------------
-- Grants: inherit default privileges from 003; explicit grants here too
-- so this migration is self-contained even if 003 is re-run after.
-- ---------------------------------------------------------------
grant select, insert, update, delete on kg_nodes to anon, authenticated;
grant select, insert, update, delete on kg_edges to anon, authenticated;
grant select, insert, update, delete on agent_run_activations to anon, authenticated;
