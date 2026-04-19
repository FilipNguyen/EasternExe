-- EasternExe initial schema
-- Paste this entire file into the Supabase SQL Editor and Run.
-- Then: Dashboard → Database → Replication → enable realtime for
--   chat_messages, places, trips, uploads, participant_profiles, trip_memory

-- ---------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------
create table trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  destination text,
  destination_lat double precision,
  destination_lng double precision,
  start_date date,
  end_date date,
  status text default 'setup' check (status in ('setup','ingesting','ready','error')),
  error text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------
-- participants
-- ---------------------------------------------------------------
create table participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  display_name text not null,
  color text not null,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------
-- uploads
-- ---------------------------------------------------------------
create table uploads (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  participant_id uuid references participants(id),
  kind text not null check (kind in ('whatsapp_zip','doc','image','audio_intro','other')),
  storage_path text not null,
  filename text,
  status text default 'pending' check (status in ('pending','processing','processed','failed')),
  error text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------
-- upload_chunks (retrieval — v1 stores chunked text only. Z.ai doesn't
-- expose an embeddings endpoint so we feed whole-corpus context to the LLM
-- instead of similarity-ranking chunks. Add an embedding column later if
-- you swap in a local embedder like @xenova/transformers.)
-- ---------------------------------------------------------------
create table upload_chunks (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references uploads(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  content text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
create index on upload_chunks (trip_id);

-- ---------------------------------------------------------------
-- participant_profiles
-- ---------------------------------------------------------------
create table participant_profiles (
  participant_id uuid primary key references participants(id) on delete cascade,
  personality text,
  interests jsonb default '[]',
  budget_style text,
  travel_style text,
  food_preferences jsonb default '[]',
  dislikes jsonb default '[]',
  dealbreakers jsonb default '[]',
  open_questions jsonb default '[]',
  raw_intro_transcript text,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------
-- trip_memory
-- ---------------------------------------------------------------
create table trip_memory (
  trip_id uuid primary key references trips(id) on delete cascade,
  destination text,
  constraints jsonb default '[]',
  group_preferences jsonb default '[]',
  priorities jsonb default '[]',
  tensions jsonb default '[]',
  decisions_made jsonb default '[]',
  open_questions jsonb default '[]',
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------
-- places
-- ---------------------------------------------------------------
create table places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null,
  lat double precision,
  lng double precision,
  google_place_id text,
  category text check (category in ('food','drinks','sight','shopping','nature','nightlife','other')),
  status text default 'saved' check (status in ('saved','visited','suggested')),
  added_by uuid references participants(id),
  added_by_agent boolean default false,
  notes text,
  source text check (source in ('whatsapp','doc','agent','manual','ingest')),
  time_of_day text check (time_of_day in ('morning','afternoon','evening','night','any')),
  created_at timestamptz default now()
);
create index on places (trip_id);

-- ---------------------------------------------------------------
-- chat_rooms
-- ---------------------------------------------------------------
create table chat_rooms (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  type text not null check (type in ('group','agent')),
  owner_id uuid references participants(id),
  created_at timestamptz default now(),
  unique (trip_id, type, owner_id)
);

-- ---------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references chat_rooms(id) on delete cascade,
  sender_participant_id uuid references participants(id),
  sender_type text not null check (sender_type in ('user','agent','subagent','system')),
  sender_label text,
  content text not null,
  attachments jsonb default '[]',
  parent_message_id uuid references chat_messages(id),
  shared_from_room_id uuid references chat_rooms(id),
  shared_by_participant_id uuid references participants(id),
  thinking_state text check (thinking_state in ('thinking','streaming','done','failed')),
  tool_calls jsonb default '[]',
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
create index on chat_messages (room_id, created_at);

-- ---------------------------------------------------------------
-- ai_runs (audit log)
-- ---------------------------------------------------------------
create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id),
  kind text not null,
  input jsonb,
  output jsonb,
  error text,
  duration_ms int,
  model text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------
-- When a trip is created: auto-create the group chat room + trip_memory shell
create or replace function create_trip_side_effects()
returns trigger as $$
begin
  insert into chat_rooms (trip_id, type, owner_id) values (new.id, 'group', null);
  insert into trip_memory (trip_id) values (new.id);
  return new;
end;
$$ language plpgsql;

create trigger trip_insert_side_effects
  after insert on trips
  for each row execute function create_trip_side_effects();

-- When a participant is created: auto-create their private agent room + profile shell
create or replace function create_participant_side_effects()
returns trigger as $$
begin
  insert into chat_rooms (trip_id, type, owner_id) values (new.trip_id, 'agent', new.id);
  insert into participant_profiles (participant_id) values (new.id);
  return new;
end;
$$ language plpgsql;

create trigger participant_insert_side_effects
  after insert on participants
  for each row execute function create_participant_side_effects();

-- ---------------------------------------------------------------
-- Storage bucket for uploads
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('trip-uploads', 'trip-uploads', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- RLS: disabled for MVP (trip_id in URL is the boundary)
-- ---------------------------------------------------------------
alter table trips disable row level security;
alter table participants disable row level security;
alter table uploads disable row level security;
alter table upload_chunks disable row level security;
alter table participant_profiles disable row level security;
alter table trip_memory disable row level security;
alter table places disable row level security;
alter table chat_rooms disable row level security;
alter table chat_messages disable row level security;
alter table ai_runs disable row level security;
