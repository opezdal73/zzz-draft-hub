-- Let a room creator clean up an accidental, unjoined friendly room.
-- Tournament rooms, BO2 rooms, joined rooms, and rooms with draft actions are excluded.
drop policy if exists "hosts can delete empty waiting rooms" on public.draft_rooms;

create policy "hosts can delete empty waiting rooms"
  on public.draft_rooms
  for delete
  to authenticated
  using (
    host_id = (select auth.uid())
    and player_two_id is null
    and status = 'waiting'
    and tournament_id is null
    and tournament_match_id is null
    and bo2_parent_room_id is null
    and actions = '[]'::jsonb
  );
