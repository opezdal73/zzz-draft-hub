-- Lets a judge advance BO2 after the first draft even when one or both timers are missing.
-- Apply after judge_tools_and_turn_timers.sql and bo2_single_room_transition.sql.

create or replace function public.create_bo2_second_draft(p_room_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  root public.draft_rooms%rowtype;
  series_row public.draft_match_series%rowtype;
  rules jsonb := '{}'::jsonb;
  cost_per_ban integer := 3;
  cost_one numeric;
  cost_two numeric;
  cheaper_side text;
  extra_bans integer := 0;
  base_template jsonb;
  game2_template jsonb := '[]'::jsonb;
  room_snapshot jsonb;
  i integer;
  judge_override boolean := coalesce(current_setting('app.judge_control', true), '') = 'on';
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into root from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Исходная комната не найдена.'; end if;
  if auth.uid() not in (root.player_one_id, root.player_two_id) then raise exception 'Подтвердить переход могут только игроки матча.'; end if;
  if root.bo2_parent_room_id is not null then raise exception 'Для уже начатой старой серии переход не создаётся повторно.'; end if;
  select * into series_row from public.draft_match_series where room_id = root.id for update;
  if not found then raise exception 'Данные BO2 не найдены.'; end if;
  if root.bo2_game_number = 2 and series_row.phase in ('squads2','game2') then return root.id; end if;
  if root.bo2_game_number = 2 or root.status <> 'completed' or series_row.phase <> 'game1' then
    raise exception 'Первая игра должна быть завершена перед переходом ко второй.';
  end if;
  if not (series_row.game2_ready_one and series_row.game2_ready_two) then raise exception 'Оба игрока должны нажать «Перейти ко второй игре».'; end if;
  if not judge_override and (series_row.game1_timer_one is null or series_row.game1_timer_two is null) then
    raise exception 'Сначала сохраните таймеры обоих игроков первой игры.';
  end if;

  room_snapshot := to_jsonb(root);
  select coalesce(settings, '{}'::jsonb) into rules from public.system_settings where id = 'global_rules';
  cost_per_ban := greatest(1, coalesce((rules->>'cost_difference_per_preban')::integer, 3));
  cost_one := public.roster_cost_from_snapshot(root.roster_two, root.roster_snapshot_two);
  cost_two := public.roster_cost_from_snapshot(root.roster_one, root.roster_snapshot_one);
  if cost_one < cost_two then cheaper_side := 'I1'; extra_bans := floor((cost_two-cost_one)/cost_per_ban)::integer;
  elsif cost_two < cost_one then cheaper_side := 'I2'; extra_bans := floor((cost_one-cost_two)/cost_per_ban)::integer;
  end if;
  select coalesce(jsonb_agg(t.step order by t.ord), '[]'::jsonb) into base_template
  from jsonb_array_elements(coalesce(root.template_snapshot, '[]'::jsonb)) with ordinality as t(step, ord)
  where coalesce(t.step->>'label','') not like 'Дополнительный бан%';
  if jsonb_array_length(base_template) = 0 then base_template := coalesce(root.template_snapshot, '[]'::jsonb); end if;
  for i in 1..extra_bans loop
    game2_template := game2_template || jsonb_build_array(jsonb_build_object('side',cheaper_side,'action','ban','count',1,'label','Дополнительный бан за разницу костов'));
  end loop;
  game2_template := game2_template || base_template;

  update public.draft_rooms set
    title = case when title like '% · Игра 2' then title else left(title || ' · Игра 2', 80) end,
    player_one_id = root.player_two_id,
    player_two_id = root.player_one_id,
    template_snapshot = game2_template,
    roster_one = root.roster_two,
    roster_two = root.roster_one,
    roster_snapshot_one = root.roster_snapshot_two,
    roster_snapshot_two = root.roster_snapshot_one,
    actions = '[]'::jsonb,
    current_step = 0,
    status = 'active',
    revision = revision + 1,
    bo2_game_number = 2,
    updated_at = now()
  where id = root.id;
  update public.draft_match_series set phase = 'squads2', second_room_id = null,
    game1_room_snapshot = room_snapshot, updated_at = now()
  where room_id = root.id;
  return root.id;
end;
$$;
revoke all on function public.create_bo2_second_draft(uuid) from public;
grant execute on function public.create_bo2_second_draft(uuid) to authenticated;

create or replace function public.control_draft_room_as_judge(p_token text, p_action text)
returns public.draft_rooms language plpgsql security definer set search_path = pg_catalog, extensions, public as $$
declare
  link_row public.draft_room_judge_links%rowtype;
  r public.draft_rooms%rowtype;
  series_row public.draft_match_series%rowtype;
  caller_id uuid := auth.uid();
begin
  if caller_id is null then raise exception 'Войди в аккаунт, чтобы управлять матчем.'; end if;
  select * into link_row from public.draft_room_judge_links
    where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if not found then raise exception 'Ссылка судьи недействительна или отозвана.'; end if;
  select * into r from public.draft_rooms where id = link_row.room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;

  if p_action = 'pause' then
    if r.status <> 'active' or r.is_paused then raise exception 'Сейчас нельзя поставить этот драфт на паузу.'; end if;
    update public.draft_rooms set is_paused = true, pause_started_at = now(), updated_at = now(), revision = revision + 1
      where id = r.id returning * into r;
  elsif p_action = 'resume' then
    if not r.is_paused or r.pause_started_at is null then raise exception 'Драфт уже идёт.'; end if;
    update public.draft_rooms set is_paused = false, turn_started_at = coalesce(turn_started_at, now()) + (now() - pause_started_at),
      pause_started_at = null, updated_at = now(), revision = revision + 1
      where id = r.id returning * into r;
  elsif p_action = 'undo' then
    if jsonb_array_length(r.actions) = 0 then raise exception 'Пока нечего отменять.'; end if;
    perform set_config('app.judge_control', 'on', true);
    update public.draft_rooms set actions = actions - (jsonb_array_length(actions) - 1),
      current_step = greatest(0, current_step - 1), status = 'active', is_paused = false, pause_started_at = null,
      turn_started_at = now(), revision = revision + 1, updated_at = now()
      where id = r.id returning * into r;
    perform set_config('app.judge_control', '', true);
  elsif p_action = 'bo2_game2' then
    if r.status <> 'completed' or r.bo2_game_number = 2 then raise exception 'Сначала завершите первый драфт BO2.'; end if;
    select * into series_row from public.draft_match_series where room_id = r.id for update;
    if not found or series_row.phase <> 'game1' then raise exception 'Данные первой игры BO2 пока недоступны.'; end if;
    -- Judges explicitly confirm the transition, so first-game timers are optional here.
    perform set_config('request.jwt.claim.sub', series_row.player_one_id::text, true);
    update public.draft_match_series set game2_ready_one = true, updated_at = now() where room_id = r.id;
    perform set_config('request.jwt.claim.sub', series_row.player_two_id::text, true);
    update public.draft_match_series set game2_ready_two = true, updated_at = now() where room_id = r.id;
    perform set_config('app.judge_control', 'on', true);
    perform public.create_bo2_second_draft(r.id);
    perform set_config('app.judge_control', '', true);
    perform set_config('request.jwt.claim.sub', caller_id::text, true);
    select * into r from public.draft_rooms where id = link_row.room_id;
  else
    raise exception 'Неизвестная команда судьи.';
  end if;
  return r;
exception when others then
  perform set_config('app.judge_control', '', true);
  perform set_config('request.jwt.claim.sub', coalesce(caller_id::text, ''), true);
  raise;
end;
$$;
revoke all on function public.control_draft_room_as_judge(text, text) from public;
grant execute on function public.control_draft_room_as_judge(text, text) to authenticated;
