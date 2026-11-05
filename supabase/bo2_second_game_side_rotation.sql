-- Apply after bo2_second_draft.sql.
-- Game 2 swaps the two players' positions, while keeping the draft template sides
-- unchanged. This makes each player start on the opposite side of the template.

-- Repair second-game rooms created by the previous function if their draft has not started.
update public.draft_rooms second_game
set template_snapshot = root.template_snapshot
from public.draft_rooms root
where second_game.bo2_parent_room_id = root.id
  and second_game.bo2_game_number = 2
  and second_game.status in ('waiting','ready')
  and second_game.current_step = 0
  and coalesce(jsonb_array_length(second_game.actions), 0) = 0;

create or replace function public.create_bo2_second_draft(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  root public.draft_rooms%rowtype;
  series_row public.draft_match_series%rowtype;
  new_id uuid;
  new_code text;
begin
  select * into root from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Исходная комната не найдена.'; end if;
  if auth.uid() is null or auth.uid() <> root.host_id then
    raise exception 'Только создатель комнаты может начать вторую игру.';
  end if;
  if root.bo2_parent_room_id is not null then raise exception 'Вызови создание второй игры из исходной комнаты.'; end if;
  if root.status <> 'completed' then raise exception 'Первый драфт должен быть завершён.'; end if;

  select * into series_row from public.draft_match_series where room_id = root.id for update;
  if not found then raise exception 'Данные BO2 не найдены.'; end if;
  if series_row.game1_timer_one is null or series_row.game1_timer_two is null then
    raise exception 'Сначала сохраните таймеры обоих игроков первой игры.';
  end if;

  if series_row.second_room_id is not null then
    select id into new_id from public.draft_rooms
    where id = series_row.second_room_id and bo2_parent_room_id = root.id and bo2_game_number = 2;
    if new_id is not null then return new_id; end if;
  end if;
  select id into new_id from public.draft_rooms
  where bo2_parent_room_id = root.id and bo2_game_number = 2
  order by created_at nulls last limit 1;
  if new_id is not null then
    update public.draft_match_series set second_room_id = new_id, phase = 'game2', updated_at = now()
    where room_id = root.id;
    return new_id;
  end if;
  if series_row.phase in ('game2','completed') then
    raise exception 'Вторая игра уже отмечена начатой, но её комната не найдена.';
  end if;
  if series_row.phase <> 'game1' then raise exception 'Сначала завершите подготовку первой игры.'; end if;

  new_code := upper(substr(md5(random()::text || clock_timestamp()::text || root.id::text), 1, 6));
  insert into public.draft_rooms(
    join_code, title, host_id, player_one_id, player_two_id, template_id, template_snapshot, status,
    roster_one, roster_two, actions, current_step, revision, min_agents, bo2_parent_room_id, bo2_game_number
  ) values (
    new_code, left(root.title || ' · Игра 2', 80), root.host_id, root.player_two_id, root.player_one_id,
    root.template_id, root.template_snapshot, 'ready', root.roster_two, root.roster_one,
    '[]'::jsonb, 0, 0, root.min_agents, root.id, 2
  ) returning id into new_id;

  update public.draft_match_series set phase = 'game2', second_room_id = new_id, updated_at = now()
  where room_id = root.id;
  return new_id;
end;
$$;

revoke all on function public.create_bo2_second_draft(uuid) from public;
grant execute on function public.create_bo2_second_draft(uuid) to authenticated;
