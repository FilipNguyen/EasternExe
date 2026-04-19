-- EasternExe storage policies
-- Run AFTER 001_init.sql. Paste into the Supabase SQL Editor and Run.
--
-- The `trip-uploads` bucket is private. Without explicit policies, neither the
-- anon key (browser) nor the service role (server) can insert / read objects
-- there, which breaks Setup step 5 uploads and the ingestion pipeline.
--
-- Scope: because the EasternExe MVP has no auth, we allow anon + authenticated to
-- insert and select within this one bucket. The security boundary is the
-- unguessable trip_id in the URL (matches the app's overall model per
-- BUILD_SPEC §5 / RLS-disabled stance).

-- idempotent — drop old policies first so re-running this file is safe
drop policy if exists "trip_uploads_insert"  on storage.objects;
drop policy if exists "trip_uploads_select"  on storage.objects;
drop policy if exists "trip_uploads_update"  on storage.objects;
drop policy if exists "trip_uploads_delete"  on storage.objects;

create policy "trip_uploads_insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'trip-uploads');

create policy "trip_uploads_select"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'trip-uploads');

create policy "trip_uploads_update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'trip-uploads')
  with check (bucket_id = 'trip-uploads');

create policy "trip_uploads_delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'trip-uploads');
