-- Configurable minimum number of agents per online draft room; no maximum.
-- Run once in Supabase SQL Editor after previous online-roster migrations.
alter table public.draft_rooms add column if not exists min_agents integer not null default 1;
alter table public.draft_rooms drop constraint if exists draft_rooms_min_agents_check;
alter table public.draft_rooms add constraint draft_rooms_min_agents_check check (min_agents >= 1 and min_agents <= 100);

create or replace function public.select_saved_roster_for_draft(p_room_id uuid, p_roster_id uuid)
returns public.draft_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.draft_rooms;
  saved public.player_rosters;
  updated public.draft_rooms;
  agent_list text[];
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;

  select * into r from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.status not in ('waiting','ready') then raise exception 'После начала драфта ростер изменить нельзя.'; end if;
  if r.player_one_id <> auth.uid() and r.player_two_id <> auth.uid() then
    raise exception 'Ты не участник этой комнаты.';
  end if;

  select * into saved from public.player_rosters
    where id = p_roster_id and player_id = auth.uid();
  if not found then raise exception 'Ростер не найден или принадлежит другому игроку.'; end if;
  if jsonb_typeof(saved.agent_ids) <> 'array' or jsonb_array_length(saved.agent_ids) < coalesce(r.min_agents, 1) then
    raise exception 'Для этой комнаты нужно минимум % агентов.', coalesce(r.min_agents, 1);
  end if;
  if (select count(distinct x) from jsonb_array_elements_text(saved.agent_ids) x) <> jsonb_array_length(saved.agent_ids) then
    raise exception 'В ростере не должно быть повторяющихся агентов.';
  end if;
  select array_agg(x) into agent_list from jsonb_array_elements_text(saved.agent_ids) x;

  if r.player_one_id = auth.uid() then
    update public.draft_rooms set
      roster_one = to_jsonb(agent_list),
      roster_snapshot_one = jsonb_build_object(
        'id', saved.id, 'name', saved.name, 'notes', saved.notes,
        'agent_ids', saved.agent_ids, 'w_engine_ids', saved.w_engine_ids,
        'agent_levels', coalesce(to_jsonb(saved.agent_levels), '{}'::jsonb),
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
        'agent_levels', coalesce(to_jsonb(saved.agent_levels), '{}'::jsonb),
        'w_engine_levels', coalesce(to_jsonb(saved.w_engine_levels), '{}'::jsonb),
        'locked_at', now()
      ),
      status = case when player_one_id is not null and jsonb_array_length(roster_one) > 0 then 'ready' else 'waiting' end,
      updated_at = now()
    where id = p_room_id returning * into updated;
  end if;
  return updated;
end;
$$;


create or replace function public.start_draft_room(p_room_id uuid)
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare r public.draft_rooms; updated public.draft_rooms;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into r from public.draft_rooms where id=p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.host_id <> auth.uid() then raise exception 'Начать драфт может только создатель комнаты.'; end if;
  if r.status <> 'ready' or r.player_two_id is null or jsonb_array_length(r.roster_one)<coalesce(r.min_agents,1) or jsonb_array_length(r.roster_two)<coalesce(r.min_agents,1) then
    raise exception 'Оба игрока должны присоединиться и выбрать ростеры минимум из % агентов.', coalesce(r.min_agents,1);
  end if;
  update public.draft_rooms set status='active',current_step=0,actions='[]'::jsonb,revision=revision+1,updated_at=now()
  where id=p_room_id returning * into updated;
  return updated;
end;
$$;
revoke all on function public.start_draft_room(uuid) from public;
grant execute on function public.start_draft_room(uuid) to authenticated;
