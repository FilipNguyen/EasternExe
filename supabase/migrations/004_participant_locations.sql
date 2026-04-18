-- Quorum — live participant locations for the map tab.
-- Paste into Supabase SQL Editor and Run.
--
-- After running: Dashboard → Database → Replication → enable realtime for
-- the `participant_locations` table (so the map updates without polling).

create table if not exists participant_locations (
  participant_id uuid primary key references participants(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  updated_at timestamptz default now()
);

create index if not exists participant_locations_trip_id_idx
  on participant_locations (trip_id);

alter table participant_locations disable row level security;

-- Grants for the new `sb_publishable_*` key format (migration 003 covers
-- existing tables but not this brand-new one).
grant select, insert, update, delete
  on participant_locations
  to anon, authenticated;
