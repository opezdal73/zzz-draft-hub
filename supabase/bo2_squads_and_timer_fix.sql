-- ZZZ Draft Hub: BO2 squads for BOTH games + 10:00 timer cap.
-- Apply ONCE in Supabase SQL Editor, AFTER draft_roster_integrity_fix.sql (and after every older BO2 migration).
-- Do not re-run bo2_match_series.sql / bo2_second_game_*.sql / draft_roster_integrity_fix.sql afterwards:
-- they define guard_bo2_match_series() / create_bo2_second_draft() and would overwrite the versions below.
--
-- What it does:
--  1. Game 2 gets its own squad arrangement: new phase 'squads2' (after the game 2 draft, before the game 2 timers)
--     and separate columns for the game 2 squads and their ready flags.
--  2. Server-side squad rules for both games: at most 3 agents per squad, at most 6 in total,
--     no duplicates, only agents the player drafted in that game.
--  3. Timers can not be longer than 10:00 (600 s) in either game.
--  4. At most one game 2 room per BO2 series (protects against duplicate rooms).

-- 1) Phase + columns
alter table public.draft_match_series drop constraint if exists draft_match_series_phase_check;
alter table public.draft_match_series add constraint draft_match_series_phase_check
  check (phase in ('squads','game1','squads2','game2','completed'));

alter table public.draft_match_series add column if not exists game2_squad_one jsonb not null default '[]'::jsonb;
alter table public.draft_match_series add column if not exists game2_squad_two jsonb not null default '[]'::jsonb;
alter table public.draft_match_series add column if not exists game2_squads_ready_one boolean not null default false;
alter table public.draft_match_series add column if not exists game2_squads_ready_two boolean not null default false;

-- 2) Timer cap: 10:00. NOT VALID = existing rows are left alone, every new / changed value is checked.
alter table public.draft_match_series drop constraint if exists draft_match_series_game1_timer_one_max;
alter table public.draft_match_series add constraint draft_match_series_game1_timer_one_max check (game1_timer_one is null or game1_timer_one <= 600) not valid;
alter table public.draft_match_series drop constraint if exists draft_match_series_game1_timer_two_max;
alter table public.draft_match_series add constraint draft_match_series_game1_timer_two_max check (game1_timer_two is null or game1_timer_two <= 600) not valid;
alter table public.draft_match_series drop constraint if exists draft_match_series_game2_timer_one_max;
alter table public.draft_match_series add constraint draft_match_series_game2_timer_one_max check (game2_timer_one is null or game2_timer_one <= 600) not valid;
alter table public.draft_match_series drop constraint if exists draft_match_series_game2_timer_two_max;
alter table public.draft_match_series add constraint draft_match_series_game2_timer_two_max check (game2_timer_two is null or game2_timer_two <= 600) not valid;

-- 3) Helpers
-- Agents a side picked (pick + mirror) in a room.
create or replace function public.bo2_room_picks(p_room_id uuid, p_side text)
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(distinct a ->> 'agent_id'), '{}'::text[])
  from public.draft_rooms r, jsonb_array_elements(r.actions) a
  where r.id = p_room_id and a ->> 'side' = p_side and a ->> 'action' in ('pick', 'mirror')
$$;

-- Squad rules: array of {agent_id, squad, engine_id}; max 3 per squad, max 6 total, unique, only drafted agents.
create or replace function public.bo2_check_squad(p_squad jsonb, p_picks text[])
returns void
language plpgsql
as $$
declare
  item jsonb;
  aid text;
  sq integer;
  n1 integer := 0;
  n2 integer := 0;
  seen text[] := '{}'::text[];
begin
  if p_squad is null or jsonb_typeof(p_squad) <> 'array' then raise exception 'Некорректный формат отрядов.'; end if;
  if jsonb_array_length(p_squad) > 6 then raise exception 'В двух отрядах не может быть больше 6 агентов.'; end if;
  for item in select value from jsonb_array_elements(p_squad) loop
    aid := item ->> 'agent_id';
    sq := nullif(item ->> 'squad', '')::integer;
    if aid is null or aid = '' or sq is null or sq not in (1, 2) then raise exception 'Некорректные данные агента в отряде.'; end if;
    if aid = any(seen) then raise exception 'Один агент не может быть в отрядах дважды.'; end if;
    seen := seen || aid;
    if not (aid = any(coalesce(p_picks, '{}'::text[]))) then
      raise exception 'В отряд можно поставить только агентов, которых ты выбрал в драфте этой игры.';
    end if;
    if sq = 1 then n1 := n1 + 1; else n2 := n2 + 1; end if;
  end loop;
  if n1 > 3 or n2 > 3 then raise exception 'В отряде не может быть больше трёх агентов.'; end if;
end;
$$;

-- 4) Series guard (replaces the one from bo2_match_series.sql; all old rules are kept).
-- Series player "one" is player 1 of the FIRST room. In the game 2 room the players are swapped,
-- so series player one is side I2 there.
create or replace function public.guard_bo2_match_series()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.draft_rooms%rowtype;
  uid uuid := auth.uid();
begin
  select * into r from public.draft_rooms where id = new.room_id;
  if not found or uid not in (r.player_one_id, r.player_two_id, r.host_id) then raise exception 'Нет доступа к этой серии.'; end if;
  if tg_op = 'UPDATE' then
    if old.phase = 'completed' and new is distinct from old then raise exception 'Завершённую серию нельзя менять.'; end if;

    -- Each player edits only his own data.
    if uid = r.player_one_id then
      if new.squad_two is distinct from old.squad_two or new.ready_two is distinct from old.ready_two then raise exception 'Нельзя менять данные соперника.'; end if;
      if new.game2_squad_two is distinct from old.game2_squad_two or new.game2_squads_ready_two is distinct from old.game2_squads_ready_two then raise exception 'Нельзя менять данные соперника.'; end if;
      if old.ready_one and (new.squad_one is distinct from old.squad_one or new.ready_one is distinct from old.ready_one) then raise exception 'После готовности отряд и амплификаторы заблокированы.'; end if;
      if old.game2_squads_ready_one and (new.game2_squad_one is distinct from old.game2_squad_one or new.game2_squads_ready_one is distinct from old.game2_squads_ready_one) then raise exception 'После готовности отряд и амплификаторы заблокированы.'; end if;
      if new.game1_timer_two is distinct from old.game1_timer_two or new.game2_timer_two is distinct from old.game2_timer_two then raise exception 'Можно вводить только свой таймер.'; end if;
    elsif uid = r.player_two_id then
      if new.squad_one is distinct from old.squad_one or new.ready_one is distinct from old.ready_one then raise exception 'Нельзя менять данные соперника.'; end if;
      if new.game2_squad_one is distinct from old.game2_squad_one or new.game2_squads_ready_one is distinct from old.game2_squads_ready_one then raise exception 'Нельзя менять данные соперника.'; end if;
      if old.ready_two and (new.squad_two is distinct from old.squad_two or new.ready_two is distinct from old.ready_two) then raise exception 'После готовности отряд и амплификаторы заблокированы.'; end if;
      if old.game2_squads_ready_two and (new.game2_squad_two is distinct from old.game2_squad_two or new.game2_squads_ready_two is distinct from old.game2_squads_ready_two) then raise exception 'После готовности отряд и амплификаторы заблокированы.'; end if;
      if new.game1_timer_one is distinct from old.game1_timer_one or new.game2_timer_one is distinct from old.game2_timer_one then raise exception 'Можно вводить только свой таймер.'; end if;
    end if;
    if uid = r.player_one_id then
      if new.game1_restarts_two is distinct from old.game1_restarts_two or new.game2_restarts_two is distinct from old.game2_restarts_two then raise exception 'Нельзя менять рестарты соперника.'; end if;
    elsif uid = r.player_two_id then
      if new.game1_restarts_one is distinct from old.game1_restarts_one or new.game2_restarts_one is distinct from old.game2_restarts_one then raise exception 'Нельзя менять рестарты соперника.'; end if;
    end if;

    -- Squads of game 1: only while the phase is 'squads'; contents are validated.
    if new.squad_one is distinct from old.squad_one or new.squad_two is distinct from old.squad_two
       or new.ready_one is distinct from old.ready_one or new.ready_two is distinct from old.ready_two then
      if old.phase <> 'squads' then raise exception 'Отряды первой игры уже заблокированы.'; end if;
    end if;
    if new.squad_one is distinct from old.squad_one then perform public.bo2_check_squad(new.squad_one, public.bo2_room_picks(r.id, 'I1')); end if;
    if new.squad_two is distinct from old.squad_two then perform public.bo2_check_squad(new.squad_two, public.bo2_room_picks(r.id, 'I2')); end if;

    -- Squads of game 2: only in phase 'squads2' and only after the game 2 draft is finished.
    if new.game2_squad_one is distinct from old.game2_squad_one or new.game2_squad_two is distinct from old.game2_squad_two
       or new.game2_squads_ready_one is distinct from old.game2_squads_ready_one or new.game2_squads_ready_two is distinct from old.game2_squads_ready_two then
      if old.phase <> 'squads2' then raise exception 'Отряды второй игры сейчас менять нельзя.'; end if;
      if not exists (select 1 from public.draft_rooms s where s.id = coalesce(new.second_room_id, old.second_room_id) and s.status = 'completed') then
        raise exception 'Драфт второй игры ещё не завершён.';
      end if;
    end if;
    -- In the game 2 room the players are swapped: series player one drafted as I2 there.
    if new.game2_squad_one is distinct from old.game2_squad_one then
      perform public.bo2_check_squad(new.game2_squad_one, public.bo2_room_picks(coalesce(new.second_room_id, old.second_room_id), 'I2'));
    end if;
    if new.game2_squad_two is distinct from old.game2_squad_two then
      perform public.bo2_check_squad(new.game2_squad_two, public.bo2_room_picks(coalesce(new.second_room_id, old.second_room_id), 'I1'));
    end if;

    -- Timers: 10:00 at most, for both games.
    if (new.game1_timer_one is distinct from old.game1_timer_one and new.game1_timer_one > 600)
       or (new.game1_timer_two is distinct from old.game1_timer_two and new.game1_timer_two > 600)
       or (new.game2_timer_one is distinct from old.game2_timer_one and new.game2_timer_one > 600)
       or (new.game2_timer_two is distinct from old.game2_timer_two and new.game2_timer_two > 600) then
      raise exception 'Таймер не может быть больше 10:00.';
    end if;

    -- Restarts (unchanged rules).
    if new.game1_restarts_one < old.game1_restarts_one or new.game1_restarts_two < old.game1_restarts_two or new.game2_restarts_one < old.game2_restarts_one or new.game2_restarts_two < old.game2_restarts_two then raise exception 'Счётчик рестартов нельзя уменьшить.'; end if;
    if new.game1_restarts_one > old.game1_restarts_one + 1 or new.game1_restarts_two > old.game1_restarts_two + 1 or new.game2_restarts_one > old.game2_restarts_one + 1 or new.game2_restarts_two > old.game2_restarts_two + 1 then raise exception 'За один раз можно зарегистрировать только один рестарт.'; end if;
    if old.phase = 'game1' and (new.game1_restarts_one > 5 or new.game1_restarts_two > 5) then raise exception 'Максимум 5 рестартов за игру.'; end if;
    if old.phase = 'game2' and (new.game2_restarts_one > 5 or new.game2_restarts_two > 5) then raise exception 'Максимум 5 рестартов за игру.'; end if;

    -- Atomic phase transitions (done in the same transaction, so stale client state can not skip a step).
    if old.phase = 'squads' and new.ready_one and new.ready_two then new.phase = 'game1'; end if;
    if old.phase = 'squads2' and new.game2_squads_ready_one and new.game2_squads_ready_two then new.phase = 'game2'; end if;
    if old.phase = 'squads' and new.phase = 'game1' and not (new.ready_one and new.ready_two) then raise exception 'Оба игрока должны нажать Готов.'; end if;
    if old.phase = 'squads2' and new.phase = 'game2' and not (new.game2_squads_ready_one and new.game2_squads_ready_two) then raise exception 'Оба игрока должны собрать отряды второй игры и нажать Готов.'; end if;
    if old.phase = 'game1' and new.phase = 'squads2' and (new.game1_timer_one is null or new.game1_timer_two is null) then raise exception 'Нужны таймеры обоих игроков первой игры.'; end if;
    if old.phase = 'game1' and new.phase = 'game2' then raise exception 'Перед второй игрой нужно собрать отряды.'; end if;
    if old.phase = 'game2' and new.phase = 'completed' and (new.game2_timer_one is null or new.game2_timer_two is null) then raise exception 'Нужны таймеры обоих игроков второй игры.'; end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists guard_bo2_match_series_trigger on public.draft_match_series;
create trigger guard_bo2_match_series_trigger before update on public.draft_match_series
for each row execute function public.guard_bo2_match_series();

-- 5) Game 2 room creation: the series moves to 'squads2' (was: straight to 'game2').
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
    update public.draft_match_series set second_room_id = new_id, phase = case when phase = 'game1' then 'squads2' else phase end, updated_at = now() where room_id = root.id;
    return new_id;
  end if;
  if series_row.phase in ('squads2','game2','completed') then raise exception 'Вторая игра уже отмечена начатой, но её комната не найдена.'; end if;
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
  -- After the game 2 draft both players arrange their squads again (phase squads2), then play (game2).
  update public.draft_match_series set phase = 'squads2', second_room_id = new_id, updated_at = now() where room_id = root.id;
  return new_id;
end;
$$;
revoke all on function public.create_bo2_second_draft(uuid) from public;
grant execute on function public.create_bo2_second_draft(uuid) to authenticated;

-- 6) Never more than one game 2 room per series. If duplicates already exist the index is skipped
-- (NOTICE); find them with:
--   select bo2_parent_room_id, count(*) from public.draft_rooms where bo2_game_number = 2 group by 1 having count(*) > 1;
do $$
begin
  create unique index if not exists draft_rooms_one_bo2_game2_per_parent
    on public.draft_rooms (bo2_parent_room_id) where bo2_parent_room_id is not null and bo2_game_number = 2;
exception when unique_violation then
  raise notice 'Duplicate game 2 rooms already exist; unique index was not created. Remove the duplicates and run this block again.';
end $$;
