-- ZZZ Draft Hub: draft / roster integrity fix.
-- Apply ONCE in Supabase SQL Editor, AFTER every other migration (in particular after
-- draft_roster_rules_fix.sql and bo2_second_game_ready.sql). Do not re-run older draft migrations afterwards:
-- they define the same functions and would overwrite these versions.
--
-- NOTE: create_bo2_second_draft() from this file is replaced by bo2_squads_and_timer_fix.sql (apply that one AFTER
-- this file and never re-run this file afterwards).
--
-- What it fixes:
--  1. A normal pick is allowed ONLY from the picker's own roster (previously from either roster).
--     Bans stay restricted to the opponent's roster. A mirror pick must be an agent the opponent
--     picked that is ALSO in the mirroring player's own roster (and not mirrored by that player before).
--  2. BO2 game 2 now receives both roster snapshots (levels, amplifiers) swapped together with the
--     players. Before, the snapshots were missing, so costs fell back to defaults and amplifiers were lost.
--  3. BO2 game 2: extra bans for the cost difference are recalculated for the swapped sides instead of
--     being copied from game 1, where they ended up with the wrong player.
--  4. Tournament rooms take the rosters from the approved registration, not from what the client sends.
--  5. A roster cannot be re-selected in tournament / BO2 game 2 rooms through the RPC directly.
--  6. The legacy save_draft_roster() RPC (which changed the agent list without its levels snapshot)
--     is disabled; a room roster can only come from select_saved_roster_for_draft().
--  7. A client can no longer create a room with pre-filled rosters / status / actions.

-- Cost of a roster, identical to the formula used by start_draft_room() and the UI.
create or replace function public.roster_cost_from_snapshot(p_agent_ids jsonb, p_snapshot jsonb)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(coalesce(
    nullif(cc.settings->'agents'->a.id->'costs'->>('M' || lvl.v), '')::numeric,
    case when lvl.v = '0' then nullif(cc.settings->'agents'->a.id->>'baseCost', '')::numeric else null end,
    999
  )), 0)
  from jsonb_array_elements_text(coalesce(p_agent_ids, '[]'::jsonb)) as a(id)
  left join public.system_settings cc on cc.id = 'cost_config'
  cross join lateral (
    select coalesce(
      p_snapshot->'agent_levels'->>a.id,
      case when coalesce((select c.rank from public.draft_agent_costs c where c.agent_id = a.id), '') = 'A' then '6' else '0' end
    ) as v
  ) lvl
$$;
revoke all on function public.roster_cost_from_snapshot(jsonb, jsonb) from public;
grant execute on function public.roster_cost_from_snapshot(jsonb, jsonb) to authenticated;

-- 1) Picks only from the own roster
create or replace function public.submit_draft_action(
  p_room_id uuid, p_expected_step integer, p_action text, p_side text, p_agent_id text
)
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare
  r public.draft_rooms;
  step_item jsonb;
  expanded_index integer := 0;
  expected_side text;
  expected_action text;
  expected_count integer;
  result_room public.draft_rooms;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into r from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.status <> 'active' then raise exception 'Драфт не активен.'; end if;
  if r.current_step <> p_expected_step then raise exception 'Ход уже изменился. Обновляю состояние комнаты.'; end if;
  if p_side not in ('I1','I2') or p_action not in ('ban','pick','mirror') then raise exception 'Некорректное действие.'; end if;
  if (p_side = 'I1' and r.player_one_id <> auth.uid()) or (p_side = 'I2' and r.player_two_id <> auth.uid()) then
    raise exception 'Сейчас ход другого игрока.';
  end if;

  for step_item in select value from jsonb_array_elements(r.template_snapshot)
  loop
    expected_count := greatest(1, least(5, coalesce((step_item->>'count')::integer, 1)));
    if p_expected_step < expanded_index + expected_count then
      expected_side := step_item->>'side';
      expected_action := step_item->>'action';
      exit;
    end if;
    expanded_index := expanded_index + expected_count;
  end loop;
  if expected_side is null then raise exception 'Все шаги драфта завершены.'; end if;
  if expected_side <> p_side or (expected_action <> p_action and not (expected_action = 'mirror' and p_action in ('pick','mirror'))) then
    raise exception 'Действие не совпадает с текущим шагом шаблона.';
  end if;
  if exists (select 1 from jsonb_array_elements(r.actions) a where a->>'agent_id' = p_agent_id) and p_action <> 'mirror' then
    raise exception 'Этот персонаж уже был выбран или забанен.';
  end if;

  if p_action = 'ban' then
    if not exists (
      select 1 from jsonb_array_elements_text(case when p_side = 'I1' then r.roster_two else r.roster_one end) x
      where x = p_agent_id
    ) then raise exception 'Для бана выбери персонажа из ростера соперника.'; end if;
  elsif p_action = 'mirror' then
    if expected_action <> 'mirror' then raise exception 'Зеркальный пик доступен только на стадии зеркального пика.'; end if;
    if not exists (
      select 1 from jsonb_array_elements_text(case when p_side = 'I1' then r.roster_one else r.roster_two end) x
      where x = p_agent_id
    ) then raise exception 'Для зеркального пика персонаж должен входить в твой ростер.'; end if;
    if exists (
      select 1 from jsonb_array_elements(r.actions) a
      where a->>'action' = 'mirror' and a->>'side' = p_side and a->>'agent_id' = p_agent_id
    ) then raise exception 'Этого персонажа ты уже отзеркалил.'; end if;
    if not exists (
      select 1 from jsonb_array_elements(r.actions) a
      where a->>'action' = 'pick' and a->>'side' <> p_side and a->>'agent_id' = p_agent_id
    ) then raise exception 'Для зеркального пика выбери персонажа, которого пикнул соперник.'; end if;
  elsif not exists (
    select 1 from jsonb_array_elements_text(case when p_side = 'I1' then r.roster_one else r.roster_two end) x
    where x = p_agent_id
  ) then raise exception 'Пик доступен только из твоего ростера. Персонажей соперника можно банить; зеркалить можно только его пики, входящие в твой ростер.';
  end if;

  update public.draft_rooms
  set actions = actions || jsonb_build_array(jsonb_build_object(
        'side', p_side, 'action', p_action, 'agent_id', p_agent_id,
        'step_index', p_expected_step, 'actor_id', auth.uid()
      )),
      current_step = current_step + 1,
      status = case when current_step + 1 >= (
        select coalesce(sum(greatest(1, least(5, coalesce((s->>'count')::integer, 1)))), 0)
        from jsonb_array_elements(template_snapshot) s
      ) then 'completed' else 'active' end,
      revision = revision + 1, updated_at = now()
  where id = p_room_id returning * into result_room;

  insert into public.draft_room_events(room_id, actor_id, step_index, action_type, side, agent_id)
  values (p_room_id, auth.uid(), p_expected_step, p_action, p_side, p_agent_id);
  return result_room;
end;
$$;

-- 2) Roster selection
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
  if r.tournament_match_id is not null or r.bo2_parent_room_id is not null then
    raise exception 'Ростер этого матча зафиксирован и не может быть изменён.';
  end if;
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

-- 3) Tournament rooms
create or replace function public.create_tournament_draft_room(
  p_tournament_id text,
  p_match_id text,
  p_player_one uuid,
  p_player_two uuid,
  p_title text,
  p_template_snapshot jsonb,
  p_min_agents integer,
  p_source_room_id uuid,
  p_roster_one_snapshot jsonb,
  p_roster_two_snapshot jsonb
) returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r public.draft_rooms%rowtype;
  source_room public.draft_rooms%rowtype;
  code text;
  room_host uuid;
  rules jsonb := '{}'::jsonb;
  cost_config jsonb := '{}'::jsonb;
  required_agents integer := greatest(1, least(100, coalesce(p_min_agents, 5)));
  min_cost numeric := 0;
  max_cost numeric := 999;
  cost_per_ban integer := 3;
  cost_one numeric := 0;
  cost_two numeric := 0;
  extra_bans integer := 0;
  cheaper_side text;
  extra_steps jsonb := '[]'::jsonb;
  i integer;
  reg_one jsonb;
  reg_two jsonb;
  caller_is_admin boolean := false;
begin
  if uid is null then raise exception 'Сначала войди в аккаунт.'; end if;
  if exists (select 1 from public.profiles where id = uid and role = 'admin') then
    room_host := uid;
    caller_is_admin := true;
  else
    if p_source_room_id is null then raise exception 'Создать первую комнату турнира может только администратор.'; end if;
    select * into source_room from public.draft_rooms where id = p_source_room_id and tournament_id = p_tournament_id;
    if not found or source_room.status <> 'completed' or (uid is distinct from source_room.player_one_id and uid is distinct from source_room.player_two_id) then
      raise exception 'Создать следующий матч может только участник завершённого матча этого турнира.';
    end if;
    room_host := source_room.host_id;
  end if;
  if p_player_one is null or p_player_two is null or p_player_one = p_player_two then
    raise exception 'Для драфта нужны два разных участника.';
  end if;
  -- An already created room for this match is simply returned (before any roster checks).
  select * into r from public.draft_rooms where tournament_match_id = p_match_id;
  if found then return r; end if;

  -- Each player's roster is the one locked at registration. What the caller sends is only used as a
  -- fallback for an administrator (e.g. entrants added by hand); a participant can never substitute rosters.
  select q.roster_snapshot into reg_one from public.tournament_registration_requests q
   where q.tournament_id = p_tournament_id and q.player_id = p_player_one
     and q.status = 'approved' and q.roster_snapshot is not null
   order by q.created_at desc limit 1;
  select q.roster_snapshot into reg_two from public.tournament_registration_requests q
   where q.tournament_id = p_tournament_id and q.player_id = p_player_two
     and q.status = 'approved' and q.roster_snapshot is not null
   order by q.created_at desc limit 1;
  if not caller_is_admin and (reg_one is null or reg_two is null) then
    raise exception 'У обоих участников должен быть ростер, закреплённый при регистрации. Обратись к организатору турнира.';
  end if;
  if reg_one is not null then p_roster_one_snapshot := reg_one; end if;
  if reg_two is not null then p_roster_two_snapshot := reg_two; end if;
  if (p_roster_one_snapshot is not null and case when jsonb_typeof(p_roster_one_snapshot->'agent_ids') = 'array' then jsonb_array_length(p_roster_one_snapshot->'agent_ids') < required_agents else true end) or
     (p_roster_two_snapshot is not null and case when jsonb_typeof(p_roster_two_snapshot->'agent_ids') = 'array' then jsonb_array_length(p_roster_two_snapshot->'agent_ids') < required_agents else true end) then
    raise exception 'Зарегистрированный ростер не соответствует минимальному количеству агентов.';
  end if;
  select * into r from public.draft_rooms where tournament_match_id = p_match_id;
  if found then return r; end if;

  select coalesce(settings, '{}'::jsonb) into rules from public.system_settings where id = 'global_rules';
  select coalesce(settings, '{}'::jsonb) into cost_config from public.system_settings where id = 'cost_config';
  min_cost := greatest(0, coalesce((rules->>'min_roster_cost')::numeric, 0));
  max_cost := greatest(min_cost, coalesce((rules->>'max_roster_cost')::numeric, 999));
  cost_per_ban := greatest(1, coalesce((rules->>'cost_difference_per_preban')::integer, 3));

  if p_roster_one_snapshot is not null and p_roster_two_snapshot is not null then
    select coalesce(sum(coalesce(
      nullif(cost_config->'agents'->a.id->'costs'->>('M' || coalesce(p_roster_one_snapshot->'agent_levels'->>a.id, case when coalesce((select c.rank from public.draft_agent_costs c where c.agent_id = a.id), '') = 'A' then '6' else '0' end)), '')::numeric,
      case when coalesce(p_roster_one_snapshot->'agent_levels'->>a.id, case when coalesce((select c.rank from public.draft_agent_costs c where c.agent_id = a.id), '') = 'A' then '6' else '0' end) = '0'
        then nullif(cost_config->'agents'->a.id->>'baseCost', '')::numeric else null end,
      999
    )), 0) into cost_one
    from jsonb_array_elements_text(p_roster_one_snapshot->'agent_ids') as a(id);

    select coalesce(sum(coalesce(
      nullif(cost_config->'agents'->a.id->'costs'->>('M' || coalesce(p_roster_two_snapshot->'agent_levels'->>a.id, case when coalesce((select c.rank from public.draft_agent_costs c where c.agent_id = a.id), '') = 'A' then '6' else '0' end)), '')::numeric,
      case when coalesce(p_roster_two_snapshot->'agent_levels'->>a.id, case when coalesce((select c.rank from public.draft_agent_costs c where c.agent_id = a.id), '') = 'A' then '6' else '0' end) = '0'
        then nullif(cost_config->'agents'->a.id->>'baseCost', '')::numeric else null end,
      999
    )), 0) into cost_two
    from jsonb_array_elements_text(p_roster_two_snapshot->'agent_ids') as a(id);

    if cost_one < min_cost or cost_one > max_cost then
      raise exception 'Стоимость ростера игрока 1 (%) вне диапазона %–%.', cost_one, min_cost, max_cost;
    end if;
    if cost_two < min_cost or cost_two > max_cost then
      raise exception 'Стоимость ростера игрока 2 (%) вне диапазона %–%.', cost_two, min_cost, max_cost;
    end if;
    if cost_one < cost_two then
      cheaper_side := 'I1'; extra_bans := floor((cost_two - cost_one) / cost_per_ban)::integer;
    elsif cost_two < cost_one then
      cheaper_side := 'I2'; extra_bans := floor((cost_one - cost_two) / cost_per_ban)::integer;
    end if;
  end if;

  for i in 1..extra_bans loop
    extra_steps := extra_steps || jsonb_build_array(jsonb_build_object(
      'side', cheaper_side, 'action', 'ban', 'count', 1, 'label', 'Дополнительный бан за разницу костов'
    ));
  end loop;

  code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.draft_rooms (
    join_code, title, host_id, player_one_id, player_two_id, template_snapshot,
    status, roster_one, roster_two, roster_snapshot_one, roster_snapshot_two, actions, current_step, min_agents,
    tournament_id, tournament_match_id
  ) values (
    code, left(coalesce(nullif(trim(p_title), ''), 'Турнирный драфт'), 80), room_host,
    p_player_one, p_player_two,
    extra_steps || case when jsonb_typeof(p_template_snapshot) = 'array' and jsonb_array_length(p_template_snapshot) > 0 then p_template_snapshot else '[]'::jsonb end,
    case when p_roster_one_snapshot is not null and p_roster_two_snapshot is not null then 'active' else 'waiting' end,
    coalesce(p_roster_one_snapshot->'agent_ids', '[]'::jsonb), coalesce(p_roster_two_snapshot->'agent_ids', '[]'::jsonb),
    case when p_roster_one_snapshot is null then null else p_roster_one_snapshot || jsonb_build_object('locked_at', now()) end,
    case when p_roster_two_snapshot is null then null else p_roster_two_snapshot || jsonb_build_object('locked_at', now()) end,
    '[]'::jsonb, 0, required_agents,
    p_tournament_id, p_match_id
  ) returning * into r;
  return r;
end;
$$;

-- 4) BO2 game 2
create or replace function public.create_bo2_second_draft(p_room_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  root public.draft_rooms%rowtype;
  series_row public.draft_match_series%rowtype;
  new_id uuid;
  new_code text;
  rules jsonb := '{}'::jsonb;
  cost_per_ban integer := 3;
  cost_one numeric;
  cost_two numeric;
  cheaper_side text;
  extra_bans integer := 0;
  base_template jsonb;
  game2_template jsonb;
  i integer;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into root from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Исходная комната не найдена.'; end if;
  if auth.uid() not in (root.player_one_id, root.player_two_id) then
    raise exception 'Подтвердить переход могут только игроки матча.';
  end if;
  if root.bo2_parent_room_id is not null then raise exception 'Вызови создание второй игры из исходной комнаты.'; end if;
  if root.status <> 'completed' then raise exception 'Первый драфт должен быть завершён.'; end if;
  select * into series_row from public.draft_match_series where room_id = root.id for update;
  if not found then raise exception 'Данные BO2 не найдены.'; end if;
  if not (series_row.game2_ready_one and series_row.game2_ready_two) then
    raise exception 'Оба игрока должны нажать «Перейти ко второй игре».';
  end if;
  if series_row.game1_timer_one is null or series_row.game1_timer_two is null then
    raise exception 'Сначала сохраните таймеры обоих игроков первой игры.';
  end if;
  if series_row.second_room_id is not null then
    select id into new_id from public.draft_rooms where id = series_row.second_room_id
      and bo2_parent_room_id = root.id and bo2_game_number = 2;
    if new_id is not null then return new_id; end if;
  end if;
  select id into new_id from public.draft_rooms where bo2_parent_room_id = root.id and bo2_game_number = 2
    order by created_at nulls last limit 1;
  if new_id is not null then
    update public.draft_match_series set second_room_id = new_id, phase = 'game2', updated_at = now() where room_id = root.id;
    return new_id;
  end if;
  if series_row.phase in ('game2','completed') then raise exception 'Вторая игра уже отмечена начатой, но её комната не найдена.'; end if;
  if series_row.phase <> 'game1' then raise exception 'Сначала завершите подготовку первой игры.'; end if;

  -- Game 2 swaps the players. Player 1 of game 2 is player 2 of game 1 and brings that player's roster.
  -- The extra bans from game 1 are tied to a template side, so they must be removed and recalculated,
  -- otherwise they would end up with the wrong player after the swap.
  select coalesce(settings, '{}'::jsonb) into rules from public.system_settings where id = 'global_rules';
  cost_per_ban := greatest(1, coalesce((rules->>'cost_difference_per_preban')::integer, 3));
  cost_one := public.roster_cost_from_snapshot(root.roster_two, root.roster_snapshot_two);
  cost_two := public.roster_cost_from_snapshot(root.roster_one, root.roster_snapshot_one);
  if cost_one < cost_two then
    cheaper_side := 'I1'; extra_bans := floor((cost_two - cost_one) / cost_per_ban)::integer;
  elsif cost_two < cost_one then
    cheaper_side := 'I2'; extra_bans := floor((cost_one - cost_two) / cost_per_ban)::integer;
  end if;
  select coalesce(jsonb_agg(t.step order by t.ord), '[]'::jsonb) into base_template
    from jsonb_array_elements(coalesce(root.template_snapshot, '[]'::jsonb)) with ordinality as t(step, ord)
   where coalesce(t.step->>'label', '') not like 'Дополнительный бан%';
  if jsonb_array_length(base_template) = 0 then base_template := coalesce(root.template_snapshot, '[]'::jsonb); end if;
  game2_template := '[]'::jsonb;
  for i in 1..extra_bans loop
    game2_template := game2_template || jsonb_build_array(jsonb_build_object(
      'side', cheaper_side, 'action', 'ban', 'count', 1, 'label', 'Дополнительный бан за разницу костов'
    ));
  end loop;
  game2_template := game2_template || base_template;

  new_code := upper(substr(md5(random()::text || clock_timestamp()::text || root.id::text), 1, 6));
  insert into public.draft_rooms(
    join_code, title, host_id, player_one_id, player_two_id, template_id, template_snapshot, status,
    roster_one, roster_two, roster_snapshot_one, roster_snapshot_two,
    actions, current_step, revision, min_agents, bo2_parent_room_id, bo2_game_number
  ) values (
    new_code, left(root.title || ' · Игра 2', 80), root.host_id, root.player_two_id, root.player_one_id,
    root.template_id, game2_template, 'active', root.roster_two, root.roster_one,
    root.roster_snapshot_two, root.roster_snapshot_one,
    '[]'::jsonb, 0, 0, root.min_agents, root.id, 2
  ) returning id into new_id;
  update public.draft_match_series set phase = 'game2', second_room_id = new_id, updated_at = now() where room_id = root.id;
  return new_id;
end;
$$;

revoke all on function public.select_saved_roster_for_draft(uuid, uuid) from public;
grant execute on function public.select_saved_roster_for_draft(uuid, uuid) to authenticated;
revoke all on function public.submit_draft_action(uuid,integer,text,text,text) from public;
grant execute on function public.submit_draft_action(uuid,integer,text,text,text) to authenticated;
revoke all on function public.create_tournament_draft_room(text,text,uuid,uuid,text,jsonb,integer,uuid,jsonb,jsonb) from public;
grant execute on function public.create_tournament_draft_room(text,text,uuid,uuid,text,jsonb,integer,uuid,jsonb,jsonb) to authenticated;
revoke all on function public.create_bo2_second_draft(uuid) from public;
grant execute on function public.create_bo2_second_draft(uuid) to authenticated;

-- Legacy RPC: changed roster_one / roster_two without the levels snapshot, so the list and the levels
-- (and therefore the cost) could disagree. Rosters now come only from select_saved_roster_for_draft().
create or replace function public.save_draft_roster(p_room_id uuid, p_roster text[])
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
begin
  raise exception 'Ростер комнаты выбирается только из «Моих ростеров» (select_saved_roster_for_draft).';
end;
$$;
revoke all on function public.save_draft_roster(uuid, text[]) from public;
grant execute on function public.save_draft_roster(uuid, text[]) to authenticated;

-- A client may only create an empty waiting room as itself. Everything else (rosters, status, actions,
-- tournament / BO2 links) is set by the server-side RPCs, which bypass this policy.
drop policy if exists "authenticated can create own rooms" on public.draft_rooms;
create policy "authenticated can create own rooms" on public.draft_rooms
  for insert to authenticated
  with check (
    host_id = auth.uid() and player_one_id = auth.uid() and player_two_id is null
    and status = 'waiting'
    and roster_one = '[]'::jsonb and roster_two = '[]'::jsonb
    and roster_snapshot_one is null and roster_snapshot_two is null
    and actions = '[]'::jsonb and current_step = 0
    and tournament_id is null and tournament_match_id is null and bo2_parent_room_id is null
  );
