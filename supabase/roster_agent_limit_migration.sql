-- Allow draft rosters with any number of agents, minimum one.
-- Apply once in Supabase SQL Editor. Does not delete or rewrite existing roster data.

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
  if jsonb_typeof(saved.agent_ids) <> 'array' or jsonb_array_length(saved.agent_ids) < 1 then
    raise exception 'В ростере должен быть хотя бы 1 агент.';
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


create or replace function public.save_draft_roster(p_room_id uuid, p_roster text[])
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare r public.draft_rooms; updated public.draft_rooms;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  if coalesce(array_length(p_roster,1),0) < 1 then raise exception 'Выбери хотя бы одного персонажа.'; end if;
  if (select count(distinct x) from unnest(p_roster) x) <> array_length(p_roster,1) then raise exception 'В составе не должно быть повторов.'; end if;
  select * into r from public.draft_rooms where id=p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.status not in ('waiting','ready') then raise exception 'Состав нельзя менять после начала драфта.'; end if;
  if r.player_one_id = auth.uid() then
    update public.draft_rooms set roster_one=to_jsonb(p_roster), status=case when player_two_id is not null and jsonb_array_length(roster_two)>0 then 'ready' else 'waiting' end, updated_at=now()
    where id=p_room_id returning * into updated;
  elsif r.player_two_id = auth.uid() then
    update public.draft_rooms set roster_two=to_jsonb(p_roster), status=case when player_one_id is not null and jsonb_array_length(roster_one)>0 then 'ready' else 'waiting' end, updated_at=now()
    where id=p_room_id returning * into updated;
  else raise exception 'Ты не участник этой комнаты.';
  end if;
  return updated;
end;
$$;

revoke all on function public.select_saved_roster_for_draft(uuid, uuid) from public;
grant execute on function public.select_saved_roster_for_draft(uuid, uuid) to authenticated;
revoke all on function public.save_draft_roster(uuid, text[]) from public;
grant execute on function public.save_draft_roster(uuid, text[]) to authenticated;
