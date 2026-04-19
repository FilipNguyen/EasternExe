-- EasternExe M2 verification
-- Paste into the Supabase SQL Editor AFTER running 001_init.sql.
-- Creates a test trip + participant inside a transaction, checks that the
-- triggers fired, then rolls back so nothing persists.

do $$
declare
  v_trip_id uuid;
  v_participant_id uuid;
  v_group_rooms int;
  v_trip_memory_rows int;
  v_agent_rooms int;
  v_profile_rows int;
  v_bucket_exists int;
begin
  -- 1. Create a test trip
  insert into trips (name, destination)
  values ('Verify trip', 'Tokyo, Japan')
  returning id into v_trip_id;

  -- 2. trip_insert_side_effects should have made a group room + trip_memory shell
  select count(*) into v_group_rooms
    from chat_rooms where trip_id = v_trip_id and type = 'group';
  select count(*) into v_trip_memory_rows
    from trip_memory where trip_id = v_trip_id;

  -- 3. Create a participant
  insert into participants (trip_id, display_name, color)
  values (v_trip_id, 'Test Participant', '#f97316')
  returning id into v_participant_id;

  -- 4. participant_insert_side_effects should have made an agent room + profile shell
  select count(*) into v_agent_rooms
    from chat_rooms
    where trip_id = v_trip_id and type = 'agent' and owner_id = v_participant_id;
  select count(*) into v_profile_rows
    from participant_profiles where participant_id = v_participant_id;

  -- 5. Storage bucket exists
  select count(*) into v_bucket_exists
    from storage.buckets where id = 'trip-uploads';

  raise notice '--- EasternExe M2 verify ---';
  raise notice 'group_rooms        (expect 1): %', v_group_rooms;
  raise notice 'trip_memory_rows   (expect 1): %', v_trip_memory_rows;
  raise notice 'agent_rooms        (expect 1): %', v_agent_rooms;
  raise notice 'profile_rows       (expect 1): %', v_profile_rows;
  raise notice 'bucket_exists      (expect 1): %', v_bucket_exists;

  if v_group_rooms       <> 1 then raise exception 'trip_insert_side_effects trigger failed: group_rooms = %',      v_group_rooms;       end if;
  if v_trip_memory_rows  <> 1 then raise exception 'trip_insert_side_effects trigger failed: trip_memory_rows = %', v_trip_memory_rows;  end if;
  if v_agent_rooms       <> 1 then raise exception 'participant_insert_side_effects trigger failed: agent_rooms = %',      v_agent_rooms; end if;
  if v_profile_rows      <> 1 then raise exception 'participant_insert_side_effects trigger failed: profile_rows = %',     v_profile_rows; end if;
  if v_bucket_exists     <> 1 then raise exception 'storage bucket trip-uploads missing';                                                  end if;

  raise notice '✅ All triggers + storage bucket verified. Rolling back test rows.';

  -- Clean up (cascades handle chat_rooms, trip_memory, participant_profiles via FK on delete cascade)
  delete from trips where id = v_trip_id;
end $$;
