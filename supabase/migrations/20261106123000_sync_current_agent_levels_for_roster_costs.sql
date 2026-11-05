-- Keep roster costs, draft side panels, pre-ban calculations, and tournament snapshots on the
-- same account-owned agent mindscape levels that the roster screens display.
create or replace function public.select_saved_roster_for_draft(p_room_id uuid, p_roster_id uuid)
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $function$
declare
  r public.draft_rooms;
  saved public.player_rosters;
  updated public.draft_rooms;
  agent_list text[];
  current_agent_levels jsonb := '{}'::jsonb;
  effective_agent_levels jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into r from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.status not in ('waiting','ready') then raise exception 'После начала драфта ростер изменить нельзя.'; end if;
  if r.tournament_match_id is not null or r.bo2_parent_room_id is not null then
    raise exception 'Ростер этого матча зафиксирован и не может быть изменён.';
  end if;
  if r.player_one_id <> auth.uid() and r.player_two_id <> auth.uid() then
    raise exception 'Ты не участник этой комнаты.';
  end if;
  select * into saved from public.player_rosters where id = p_roster_id and player_id = auth.uid();
  if not found then raise exception 'Ростер не найден или принадлежит другому игроку.'; end if;
  if jsonb_typeof(saved.agent_ids) <> 'array' or jsonb_array_length(saved.agent_ids) < coalesce(r.min_agents, 1) then
    raise exception 'Для этой комнаты нужно минимум % агентов.', coalesce(r.min_agents, 1);
  end if;
  if (select count(distinct x) from jsonb_array_elements_text(saved.agent_ids) x) <> jsonb_array_length(saved.agent_ids) then
    raise exception 'В ростере не должно быть повторяющихся агентов.';
  end if;
  select coalesce(to_jsonb(i.agent_levels), '{}'::jsonb) into current_agent_levels
    from public.player_account_inventory i where i.player_id = auth.uid();
  effective_agent_levels := coalesce(to_jsonb(saved.agent_levels), '{}'::jsonb) || coalesce(current_agent_levels, '{}'::jsonb);
  select array_agg(x) into agent_list from jsonb_array_elements_text(saved.agent_ids) x;

  if r.player_one_id = auth.uid() then
    update public.draft_rooms set
      roster_one = to_jsonb(agent_list),
      roster_snapshot_one = jsonb_build_object(
        'id', saved.id, 'name', saved.name, 'notes', saved.notes,
        'agent_ids', saved.agent_ids, 'w_engine_ids', saved.w_engine_ids,
        'agent_levels', effective_agent_levels,
        'w_engine_levels', coalesce(to_jsonb(saved.w_engine_levels), '{}'::jsonb),
        'locked_at', now()
      ),
      status = case when player_two_id is not null and jsonb_array_length(roster_two) > 0 then 'ready' else 'waiting' end,
      updated_at = now()
    where id = p_room_id returning * into updated;
  else
    update public.draft_rooms set
      roster_two = to_jsonb(agent_list),
      roster_snapshot_two = jsonb_build_object(
        'id', saved.id, 'name', saved.name, 'notes', saved.notes,
        'agent_ids', saved.agent_ids, 'w_engine_ids', saved.w_engine_ids,
        'agent_levels', effective_agent_levels,
        'w_engine_levels', coalesce(to_jsonb(saved.w_engine_levels), '{}'::jsonb),
        'locked_at', now()
      ),
      status = case when player_one_id is not null and jsonb_array_length(roster_one) > 0 then 'ready' else 'waiting' end,
      updated_at = now()
    where id = p_room_id returning * into updated;
  end if;
  return updated;
end;
$function$;

create or replace function public.select_training_roster_for_draft(p_room_id uuid, p_roster_id uuid, p_side text)
returns public.draft_rooms
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare
  r public.draft_rooms;
  saved public.player_rosters;
  updated public.draft_rooms;
  roster_owner uuid;
  agent_list text[];
  current_agent_levels jsonb := '{}'::jsonb;
  effective_agent_levels jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  if p_side not in ('I1', 'I2') then raise exception 'Неизвестная сторона драфта.'; end if;
  select * into r from public.draft_rooms where draft_rooms.id = p_room_id for update;
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
  select coalesce(to_jsonb(i.agent_levels), '{}'::jsonb) into current_agent_levels
    from public.player_account_inventory i where i.player_id = roster_owner;
  effective_agent_levels := coalesce(to_jsonb(saved.agent_levels), '{}'::jsonb) || coalesce(current_agent_levels, '{}'::jsonb);
  select array_agg(x) into agent_list from jsonb_array_elements_text(saved.agent_ids) x;

  if p_side = 'I1' then
    update public.draft_rooms set
      roster_one = to_jsonb(agent_list),
      roster_snapshot_one = jsonb_build_object(
        'id', saved.id, 'name', saved.name, 'notes', saved.notes,
        'agent_ids', saved.agent_ids, 'w_engine_ids', saved.w_engine_ids,
        'agent_levels', effective_agent_levels,
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
        'agent_levels', effective_agent_levels,
        'w_engine_levels', coalesce(to_jsonb(saved.w_engine_levels), '{}'::jsonb), 'locked_at', now()
      ),
      status = case when jsonb_array_length(roster_one) > 0 then 'ready' else 'waiting' end,
      updated_at = now()
    where id = p_room_id returning * into updated;
  end if;
  return updated;
end;
$function$;

create or replace function public.load_training_opponent_rosters(p_room_id uuid)
returns table(id uuid, name text, notes text, agent_ids jsonb, w_engine_ids jsonb, agent_levels jsonb, w_engine_levels jsonb)
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare
  r public.draft_rooms;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into r from public.draft_rooms where draft_rooms.id = p_room_id;
  if not found or r.training_mode is distinct from true or r.host_id <> auth.uid() then
    raise exception 'Тренировочная комната не найдена или у тебя нет доступа.';
  end if;
  return query
    select pr.id, pr.name, pr.notes, pr.agent_ids, pr.w_engine_ids,
      coalesce(to_jsonb(pr.agent_levels), '{}'::jsonb) || coalesce(to_jsonb(inv.agent_levels), '{}'::jsonb),
      pr.w_engine_levels
    from public.player_rosters pr
    left join public.player_account_inventory inv on inv.player_id = pr.player_id
    where pr.player_id = r.training_opponent_id
    order by pr.updated_at desc;
end;
$function$;

create or replace function public.capture_registration_roster()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare
  saved public.player_rosters%rowtype;
  current_agent_levels jsonb := '{}'::jsonb;
begin
  if new.roster_id is null then raise exception 'Выбери сохранённый ростер для участия в турнире.'; end if;
  select * into saved from public.player_rosters where id = new.roster_id and player_id = new.player_id;
  if not found then raise exception 'Этот ростер не принадлежит твоему аккаунту.'; end if;
  select coalesce(to_jsonb(i.agent_levels), '{}'::jsonb) into current_agent_levels
    from public.player_account_inventory i where i.player_id = new.player_id;
  new.roster_snapshot := jsonb_build_object(
    'id', saved.id,
    'name', saved.name,
    'agent_ids', saved.agent_ids,
    'w_engine_ids', saved.w_engine_ids,
    'agent_levels', coalesce(to_jsonb(saved.agent_levels), '{}'::jsonb) || coalesce(current_agent_levels, '{}'::jsonb),
    'w_engine_levels', coalesce(to_jsonb(saved.w_engine_levels), '{}'::jsonb)
  );
  return new;
end;
$function$;
