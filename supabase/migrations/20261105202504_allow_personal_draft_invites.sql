-- Allow a room creator to assign one registered opponent at creation time.
-- Keep all existing checks that constrain new rooms to a pristine waiting state.
drop policy if exists "authenticated can create own rooms" on public.draft_rooms;
create policy "authenticated can create own rooms" on public.draft_rooms
  for insert to authenticated
  with check (
    host_id = auth.uid()
    and player_one_id = auth.uid()
    and player_two_id is not null
    and player_two_id <> auth.uid()
    and status = 'waiting'
    and roster_one = '[]'::jsonb
    and roster_two = '[]'::jsonb
    and roster_snapshot_one is null
    and roster_snapshot_two is null
    and actions = '[]'::jsonb
    and current_step = 0
    and tournament_id is null
    and tournament_match_id is null
    and bo2_parent_room_id is null
  );
