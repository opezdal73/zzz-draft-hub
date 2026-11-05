-- In a private training room, expose only the selected target's saved loadouts
-- to that room's creator and allow those loadouts to populate side two.
create or replace function public.load_training_opponent_rosters(p_room_id uuid)
returns table (
  id uuid,
  name text,
  notes text,
  agent_ids jsonb,
  w_engine_ids jsonb,
  agent_levels jsonb,
  w_engine_levels jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r public.draft_rooms;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into r from public.draft_rooms where draft_rooms.id = p_room_id;
  if not found or r.training_mode is distinct from true or r.host_id <> auth.uid() then
    raise exception 'Тренировочная комната не найдена или у тебя нет доступа.';
  end if;
  return query
    select pr.id, pr.name, pr.notes, pr.agent_ids, pr.w_engine_ids, pr.agent_levels, pr.w_engine_levels
    from public.player_rosters pr
    where pr.player_id = r.training_opponent_id
    order by pr.updated_at desc;
end;
$$;
revoke all on function public.load_training_opponent_rosters(uuid) from public, anon;
grant execute on function public.load_training_opponent_rosters(uuid) to authenticated;

create or replace function public.select_training_roster_for_draft(p_room_id uuid, p_roster_id uuid, p_side text)
returns public.draft_rooms
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  r public.draft_rooms;
  saved public.player_rosters;
  updated public.draft_rooms;
  roster_owner uuid;
  agent_list text[];
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  if p_side not in ('I1', 'I2') then raise exception 'Неизвестная сторона драфта.'; end if;
  select * into r from public.draft_rooms where id = p_room_id for update;
  if not found or r.training_mode is distinct from true or r.host_id <> auth.uid() or r.player_one_id <> auth.uid() or r.player_two_id <> auth.uid() then
    raise exception 'Это не твоя тренировочная комната.';
  end if;
  if r.status not in ('waiting', 'ready') then raise exception 'После начала драфта ростеры изменить нельзя.'; end if;
  roster_owner := case when p_side = 'I2' then r.training_opponent_id else auth.uid() end;
  select * into saved from public.player_rosters where id = p_roster_id and player_id = roster_owner;
  if not found then raise exception 'Выбранный ростер не найден в профиле нужного игрока.'; end if;
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
