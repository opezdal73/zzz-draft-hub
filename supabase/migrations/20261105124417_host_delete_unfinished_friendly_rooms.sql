-- Room creators may delete their own unfinished friendly drafts, even after
-- the opponent has joined or draft actions have started.
-- Keep tournament rooms out of this policy so bracket state cannot be orphaned.
drop policy if exists "hosts can delete empty waiting rooms" on public.draft_rooms;
drop policy if exists "hosts can delete unfinished friendly rooms" on public.draft_rooms;

create policy "hosts can delete unfinished friendly rooms"
  on public.draft_rooms
  for delete
  to authenticated
  using (
    host_id = (select auth.uid())
    and status in ('waiting', 'ready', 'active')
    and tournament_id is null
    and tournament_match_id is null
    and bo2_parent_room_id is null
  );
