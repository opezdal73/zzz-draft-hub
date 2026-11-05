-- ZZZ Draft Hub: final fix for draft roster pools, level-aware costs and extra bans.
-- Apply this AFTER all existing draft-room, global-rules, shared-cost and optional-ban migrations.

create or replace function public.start_draft_room(p_room_id uuid)
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare
  r public.draft_rooms;
  updated public.draft_rooms;
  rules jsonb := '{}'::jsonb;
  cost_config jsonb := '{}'::jsonb;
  min_agents integer := 5;
  min_cost numeric := 0;
  max_cost numeric := 999;
  cost_per_ban integer := 3;
  cost_one numeric := 0;
  cost_two numeric := 0;
  extra_bans integer := 0;
  cheaper_side text;
  extra_steps jsonb := '[]'::jsonb;
  i integer;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into r from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.host_id <> auth.uid() then raise exception 'Начать драфт может только создатель комнаты.'; end if;
  if r.status <> 'ready' or r.player_two_id is null or jsonb_array_length(r.roster_one) = 0 or jsonb_array_length(r.roster_two) = 0 then
    raise exception 'Оба игрока должны присоединиться и сохранить составы.';
  end if;

  select coalesce(settings, '{}'::jsonb) into rules from public.system_settings where id = 'global_rules';
  select coalesce(settings, '{}'::jsonb) into cost_config from public.system_settings where id = 'cost_config';
  min_agents := greatest(1, coalesce((rules->>'min_agents')::integer, 5));
  min_cost := greatest(0, coalesce((rules->>'min_roster_cost')::numeric, 0));
  max_cost := greatest(min_cost, coalesce((rules->>'max_roster_cost')::numeric, 999));
  cost_per_ban := greatest(1, coalesce((rules->>'cost_difference_per_preban')::integer, 3));

  if jsonb_array_length(r.roster_one) < min_agents or jsonb_array_length(r.roster_two) < min_agents then
    raise exception 'Оба ростера должны содержать минимум % персонажей.', min_agents;
  end if;

  -- Use the same shared Cost Manager configuration and saved M-levels as the UI.
  -- Missing non-M0 costs deliberately count as 999, matching MISSING_COST in costUtils.ts.
  -- Legacy roster rows without saved levels use the catalog rank (A agents default to M6).
  select coalesce(sum(coalesce(
    nullif(cost_config->'agents'->a.id->'costs'->>('M' || coalesce(r.roster_snapshot_one->'agent_levels'->>a.id, case when coalesce((select c.rank from public.draft_agent_costs c where c.agent_id = a.id), '') = 'A' then '6' else '0' end)), '')::numeric,
    case when coalesce(r.roster_snapshot_one->'agent_levels'->>a.id, case when coalesce((select c.rank from public.draft_agent_costs c where c.agent_id = a.id), '') = 'A' then '6' else '0' end) = '0'
      then nullif(cost_config->'agents'->a.id->>'baseCost', '')::numeric else null end,
    999
  )), 0)
  into cost_one
  from jsonb_array_elements_text(r.roster_one) as a(id);

  select coalesce(sum(coalesce(
    nullif(cost_config->'agents'->a.id->'costs'->>('M' || coalesce(r.roster_snapshot_two->'agent_levels'->>a.id, case when coalesce((select c.rank from public.draft_agent_costs c where c.agent_id = a.id), '') = 'A' then '6' else '0' end)), '')::numeric,
    case when coalesce(r.roster_snapshot_two->'agent_levels'->>a.id, case when coalesce((select c.rank from public.draft_agent_costs c where c.agent_id = a.id), '') = 'A' then '6' else '0' end) = '0'
      then nullif(cost_config->'agents'->a.id->>'baseCost', '')::numeric else null end,
    999
  )), 0)
  into cost_two
  from jsonb_array_elements_text(r.roster_two) as a(id);

  if cost_one < min_cost or cost_one > max_cost then
    raise exception 'Стоимость ростера игрока 1 (%) вне диапазона %–%.', cost_one, min_cost, max_cost;
  end if;
  if cost_two < min_cost or cost_two > max_cost then
    raise exception 'Стоимость ростера игрока 2 (%) вне диапазона %–%.', cost_two, min_cost, max_cost;
  end if;

  if cost_one < cost_two then
    cheaper_side := 'I1';
    extra_bans := floor((cost_two - cost_one) / cost_per_ban)::integer;
  elsif cost_two < cost_one then
    cheaper_side := 'I2';
    extra_bans := floor((cost_one - cost_two) / cost_per_ban)::integer;
  end if;

  for i in 1..extra_bans loop
    extra_steps := extra_steps || jsonb_build_array(jsonb_build_object(
      'side', cheaper_side, 'action', 'ban', 'count', 1, 'label', 'Дополнительный бан за разницу костов'
    ));
  end loop;

  update public.draft_rooms
  set status = 'active', current_step = 0, actions = '[]'::jsonb,
      template_snapshot = extra_steps || coalesce(template_snapshot, '[]'::jsonb),
      revision = revision + 1, updated_at = now()
  where id = p_room_id returning * into updated;
  return updated;
end;
$$;

revoke all on function public.start_draft_room(uuid) from public;
grant execute on function public.start_draft_room(uuid) to authenticated;

-- Enforce the intended draft rule server-side: a normal pick can use either roster;
-- a ban must target the opposing roster; mirror picks require a previous opposing pick.
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
      select 1 from jsonb_array_elements_text(case when p_side = 'I1' then r.roster_two else r.roster_one end) x
      where x = p_agent_id
    ) then raise exception 'Для зеркального пика персонаж должен входить в ростер соперника.'; end if;
    if not exists (
      select 1 from jsonb_array_elements(r.actions) a
      where a->>'action' = 'pick' and a->>'side' <> p_side and a->>'agent_id' = p_agent_id
    ) then raise exception 'Для зеркального пика выбери персонажа, которого пикнул соперник.'; end if;
  elsif not exists (
    select 1 from jsonb_array_elements_text(r.roster_one || r.roster_two) x where x = p_agent_id
  ) then raise exception 'Для пика персонаж должен входить в один из двух ростеров.';
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

revoke all on function public.submit_draft_action(uuid,integer,text,text,text) from public;
grant execute on function public.submit_draft_action(uuid,integer,text,text,text) to authenticated;

-- Tournament rooms are created directly in the active state, so apply the same
-- level-aware cost limits and extra-ban advantage at room creation time.
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
begin
  if uid is null then raise exception 'Сначала войди в аккаунт.'; end if;
  if exists (select 1 from public.profiles where id = uid and role = 'admin') then
    room_host := uid;
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
revoke all on function public.create_tournament_draft_room(text,text,uuid,uuid,text,jsonb,integer,uuid,jsonb,jsonb) from public;
grant execute on function public.create_tournament_draft_room(text,text,uuid,uuid,text,jsonb,integer,uuid,jsonb,jsonb) to authenticated;
