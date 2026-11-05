-- Private practice rooms. The selected opponent is only a display target; only the
-- creator is a participant, and the normal judge controls let them draft both sides.
alter table public.draft_rooms
  add column if not exists training_mode boolean not null default false,
  add column if not exists training_opponent_id uuid references public.profiles(id) on delete set null;

drop policy if exists "authenticated can create own rooms" on public.draft_rooms;
create policy "authenticated can create own rooms" on public.draft_rooms
  for insert to authenticated
  with check (
    host_id = auth.uid()
    and player_one_id = auth.uid()
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
    and (
      (coalesce(training_mode, false) = false and player_two_id is not null and player_two_id <> auth.uid() and training_opponent_id is null)
      or
      (training_mode = true and player_two_id = auth.uid() and training_opponent_id is not null and training_opponent_id <> auth.uid())
    )
  );

create or replace function public.select_training_roster_for_draft(p_room_id uuid, p_roster_id uuid, p_side text)
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare
  r public.draft_rooms;
  saved public.player_rosters;
  updated public.draft_rooms;
  agent_list text[];
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  if p_side not in ('I1', 'I2') then raise exception 'Неизвестная сторона драфта.'; end if;
  select * into r from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.training_mode is distinct from true or r.host_id <> auth.uid() or r.player_one_id <> auth.uid() or r.player_two_id <> auth.uid() then
    raise exception 'Это не твоя тренировочная комната.';
  end if;
  if r.status not in ('waiting', 'ready') then raise exception 'После начала драфта ростеры изменить нельзя.'; end if;
  select * into saved from public.player_rosters where id = p_roster_id and player_id = auth.uid();
  if not found then raise exception 'Ростер не найден или принадлежит другому игроку.'; end if;
  if jsonb_typeof(saved.agent_ids) <> 'array' or jsonb_array_length(saved.agent_ids) < greatest(1, coalesce(r.min_agents, 1)) then
    raise exception 'В ростере должно быть минимум % агентов.', greatest(1, coalesce(r.min_agents, 1));
  end if;
  if (select count(distinct x) from jsonb_array_elements_text(saved.agent_ids) x) <> jsonb_array_length(saved.agent_ids) then
    raise exception 'В ростере не должно быть повторяющихся агентов.';
  end if;
  select array_agg(x) into agent_list from jsonb_array_elements_text(saved.agent_ids) x;

  if p_side = 'I1' then
    update public.draft_rooms set
      roster_one = to_jsonb(agent_list),
      roster_snapshot_one = jsonb_build_object(
        'id', saved.id, 'name', saved.name, 'notes', saved.notes,
        'agent_ids', saved.agent_ids, 'w_engine_ids', saved.w_engine_ids,
        'agent_levels', coalesce(to_jsonb(saved.agent_levels), '{}'::jsonb),
        'w_engine_levels', coalesce(to_jsonb(saved.w_engine_levels), '{}'::jsonb), 'locked_at', now()
      ),
      status = case when jsonb_array_length(roster_two) > 0 then 'ready' else 'waiting' end,
      updated_at = now()
    where id = p_room_id returning * into updated;
  else
    update public.draft_rooms set
      roster_two = to_jsonb(agent_list),
      roster_snapshot_two = jsonb_build_object(
        'id', saved.id, 'name', saved.name, 'notes', saved.notes,
        'agent_ids', saved.agent_ids, 'w_engine_ids', saved.w_engine_ids,
        'agent_levels', coalesce(to_jsonb(saved.agent_levels), '{}'::jsonb),
        'w_engine_levels', coalesce(to_jsonb(saved.w_engine_levels), '{}'::jsonb), 'locked_at', now()
      ),
      status = case when jsonb_array_length(roster_one) > 0 then 'ready' else 'waiting' end,
      updated_at = now()
    where id = p_room_id returning * into updated;
  end if;
  return updated;
end;
$$;

revoke all on function public.select_training_roster_for_draft(uuid, uuid, text) from public, anon;
grant execute on function public.select_training_roster_for_draft(uuid, uuid, text) to authenticated;
