-- EasternExe — grant anon + authenticated roles full read on the public schema.
-- Paste into Supabase SQL Editor and Run.
--
-- Why this file exists: Supabase's new `sb_publishable_*` / `sb_secret_*`
-- API key format uses the anon + authenticated Postgres roles, but unlike
-- the legacy anon JWT, new publishable keys DO NOT auto-grant SELECT on
-- tables in the public schema. Symptoms: PostgREST returns `[]` for every
-- GET from the browser even though table RLS is disabled — because the
-- role lacks privileges, not because a policy denies them.
--
-- Scope: RLS is off for MVP so we grant wide. The security boundary is
-- still the unguessable trip_id in URLs (per BUILD_SPEC §5 / §14).

-- Schema access
grant usage on schema public to anon, authenticated;

-- Full read + write on all current tables
grant select, insert, update, delete
  on all tables in schema public
  to anon, authenticated;

-- Sequences (for tables with serial PKs — we don't use any, but keep safe)
grant usage, select
  on all sequences in schema public
  to anon, authenticated;

-- Default privileges — any new table created later inherits the grant
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
