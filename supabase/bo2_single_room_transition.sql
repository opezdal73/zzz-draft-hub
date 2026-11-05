-- Keep both BO2 games in the same draft_rooms row.
-- Apply once, after bo2_squads_and_timer_fix.sql.
-- Existing game-2 rooms remain readable; new BO2 transitions reuse the original room.

alter table public.draft_match_series
  add column if not exists player_one_id uuid,
  add column if not exists player_two_id uuid,
  add column if not exists game1_room_snapshot jsonb;

update public.draft_match_series s
set player_one_id = r.player_one_id,
    player_two_id = r.player_two_id
from public.draft_rooms r
where r.id = s.room_id
  and (s.player_one_id is null or s.player_two_id is null);

create or replace function public.bind_bo2_series_players()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.draft_rooms%rowtype;
begin
  select * into r from public.draft_rooms where id = new.room_id;
  if not found then raise exception 'Комната BO2 не найдена.'; end if;
  if new.player_one_id is null then new.player_one_id := r.player_one_id; end if;
  if new.player_two_id is null then new.player_two_id := r.player_two_id; end if;
  return new;
end;
$$;
drop trigger if exists bind_bo2_series_players_trigger on public.draft_match_series;
create trigger bind_bo2_series_players_trigger before insert on public.draft_match_series
for each row execute function public.bind_bo2_series_players();

-- This supersedes the old guard that assigned series ownership from the live room slots.
-- Player identities in the series stay fixed even when the room swaps its player slots for game 2.
create or replace function public.guard_bo2_match_series()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.draft_rooms%rowtype;
  game2_room public.draft_rooms%rowtype;
  game2_room_id uuid;
  uid uuid := auth.uid();
begin
  select * into r from public.draft_rooms where id = new.room_id;
  if not found then raise exception 'Комната BO2 не найдена.'; end if;
  game2_room_id := coalesce(new.second_room_id, old.second_room_id);
  if game2_room_id is not null then
    select * into game2_room from public.draft_rooms where id = game2_room_id;
    if not found then raise exception 'Комната второй игры не найдена.'; end if;
  else
    game2_room := r;
  end if;
  if uid not in (old.player_one_id, old.player_two_id, r.host_id) then
    raise exception 'Нет доступа к этой серии.';
  end if;
  if new.player_one_id is distinct from old.player_one_id or new.player_two_id is distinct from old.player_two_id then
    raise exception 'Игроков серии нельзя менять.';
  end if;
  if old.phase = 'completed' and new is distinct from old then
    raise exception 'Завершённую серию нельзя менять.';
  end if;

  if uid = old.player_one_id then
    if new.squad_two is distinct from old.squad_two or new.ready_two is distinct from old.ready_two
       or new.game2_squad_two is distinct from old.game2_squad_two
       or new.game2_squads_ready_two is distinct from old.game2_squads_ready_two
       or new.game2_ready_two is distinct from old.game2_ready_two
       or new.game1_timer_two is distinct from old.game1_timer_two
       or new.game2_timer_two is distinct from old.game2_timer_two
       or new.game1_restarts_two is distinct from old.game1_restarts_two
       or new.game2_restarts_two is distinct from old.game2_restarts_two then
      raise exception 'Нельзя менять данные соперника.';
    end if;
    if old.ready_one and (new.squad_one is distinct from old.squad_one or new.ready_one is distinct from old.ready_one) then
      raise exception 'После готовности отряд первой игры заблокирован.';
    end if;
    if old.game2_squads_ready_one and (new.game2_squad_one is distinct from old.game2_squad_one or new.game2_squads_ready_one is distinct from old.game2_squads_ready_one) then
      raise exception 'После готовности отряд второй игры заблокирован.';
    end if;
    if old.game2_ready_one and not new.game2_ready_one then raise exception 'Подтверждение перехода нельзя отменить.'; end if;
  elsif uid = old.player_two_id then
    if new.squad_one is distinct from old.squad_one or new.ready_one is distinct from old.ready_one
       or new.game2_squad_one is distinct from old.game2_squad_one
       or new.game2_squads_ready_one is distinct from old.game2_squads_ready_one
       or new.game2_ready_one is distinct from old.game2_ready_one
       or new.game1_timer_one is distinct from old.game1_timer_one
       or new.game2_timer_one is distinct from old.game2_timer_one
       or new.game1_restarts_one is distinct from old.game1_restarts_one
       or new.game2_restarts_one is distinct from old.game2_restarts_one then
      raise exception 'Нельзя менять данные соперника.';
    end if;
    if old.ready_two and (new.squad_two is distinct from old.squad_two or new.ready_two is distinct from old.ready_two) then
      raise exception 'После готовности отряд первой игры заблокирован.';
    end if;
    if old.game2_squads_ready_two and (new.game2_squad_two is distinct from old.game2_squad_two or new.game2_squads_ready_two is distinct from old.game2_squads_ready_two) then
      raise exception 'После готовности отряд второй игры заблокирован.';
    end if;
    if old.game2_ready_two and not new.game2_ready_two then raise exception 'Подтверждение перехода нельзя отменить.'; end if;
  end if;

  if new.game1_room_snapshot is distinct from old.game1_room_snapshot then
    if old.phase <> 'game1' or new.phase <> 'squads2' or r.bo2_game_number <> 2
       or r.status <> 'active' or (new.game1_room_snapshot->>'id') is distinct from r.id::text then
      raise exception 'Снимок первой игры можно сохранить только при переходе в ту же комнату для второй игры.';
    end if;
  end if;

  if new.squad_one is distinct from old.squad_one or new.squad_two is distinct from old.squad_two
     or new.ready_one is distinct from old.ready_one or new.ready_two is distinct from old.ready_two then
    if old.phase <> 'squads' then raise exception 'Отряды первой игры сейчас менять нельзя.'; end if;
  end if;
  if new.squad_one is distinct from old.squad_one then perform public.bo2_check_squad(new.squad_one, public.bo2_room_picks(r.id, 'I1')); end if;
  if new.squad_two is distinct from old.squad_two then perform public.bo2_check_squad(new.squad_two, public.bo2_room_picks(r.id, 'I2')); end if;

  if new.game2_squad_one is distinct from old.game2_squad_one or new.game2_squad_two is distinct from old.game2_squad_two
     or new.game2_squads_ready_one is distinct from old.game2_squads_ready_one
     or new.game2_squads_ready_two is distinct from old.game2_squads_ready_two then
    if old.phase <> 'squads2' or not (
      (r.bo2_game_number = 2 and r.status = 'completed') or
      (game2_room.bo2_parent_room_id = r.id and game2_room.bo2_game_number = 2 and game2_room.status = 'completed')
    ) then
      raise exception 'Отряды второй игры можно менять только после её драфта в той же комнате.';
    end if;
  end if;
  -- Original series player one now drafts from room side I2; original player two drafts from I1.
  if new.game2_squad_one is distinct from old.game2_squad_one then perform public.bo2_check_squad(new.game2_squad_one, public.bo2_room_picks(game2_room.id, 'I2')); end if;
  if new.game2_squad_two is distinct from old.game2_squad_two then perform public.bo2_check_squad(new.game2_squad_two, public.bo2_room_picks(game2_room.id, 'I1')); end if;

  if new.game1_timer_one is distinct from old.game1_timer_one then
    if uid <> old.player_one_id or old.phase <> 'game1' or old.game1_timer_one is not null then raise exception 'Таймер первой игры уже сохранён или сейчас недоступен.'; end if;
  end if;
  if new.game1_timer_two is distinct from old.game1_timer_two then
    if uid <> old.player_two_id or old.phase <> 'game1' or old.game1_timer_two is not null then raise exception 'Таймер первой игры уже сохранён или сейчас недоступен.'; end if;
  end if;
  if new.game2_timer_one is distinct from old.game2_timer_one then
    if uid <> old.player_one_id or old.phase <> 'game2' or old.game2_timer_one is not null then raise exception 'Таймер второй игры уже сохранён или сейчас недоступен.'; end if;
  end if;
  if new.game2_timer_two is distinct from old.game2_timer_two then
    if uid <> old.player_two_id or old.phase <> 'game2' or old.game2_timer_two is not null then raise exception 'Таймер второй игры уже сохранён или сейчас недоступен.'; end if;
  end if;
  if coalesce(new.game1_timer_one,0) > 600 or coalesce(new.game1_timer_two,0) > 600
     or coalesce(new.game2_timer_one,0) > 600 or coalesce(new.game2_timer_two,0) > 600 then
    raise exception 'Таймер не может быть больше 10:00.';
  end if;

  if new.game1_restarts_one < old.game1_restarts_one or new.game1_restarts_two < old.game1_restarts_two
     or new.game2_restarts_one < old.game2_restarts_one or new.game2_restarts_two < old.game2_restarts_two then
    raise exception 'Счётчик рестартов нельзя уменьшить.';
  end if;
  if new.game1_restarts_one > old.game1_restarts_one + 1 or new.game1_restarts_two > old.game1_restarts_two + 1
     or new.game2_restarts_one > old.game2_restarts_one + 1 or new.game2_restarts_two > old.game2_restarts_two + 1 then
    raise exception 'За один раз можно зарегистрировать только один рестарт.';
  end if;
  if old.phase = 'game1' and (new.game1_restarts_one > 5 or new.game1_restarts_two > 5) then raise exception 'Максимум 5 рестартов за игру.'; end if;
  if old.phase = 'game2' and (new.game2_restarts_one > 5 or new.game2_restarts_two > 5) then raise exception 'Максимум 5 рестартов за игру.'; end if;

  if new.game2_ready_one is distinct from old.game2_ready_one or new.game2_ready_two is distinct from old.game2_ready_two then
    if old.phase <> 'game1' then raise exception 'Переход ко второй игре сейчас недоступен.'; end if;
  end if;
  if old.phase = 'squads' and new.ready_one and new.ready_two then new.phase = 'game1'; end if;
  if old.phase = 'squads2' and new.game2_squads_ready_one and new.game2_squads_ready_two then new.phase = 'game2'; end if;
  if old.phase = 'squads' and new.phase = 'game1' and not (new.ready_one and new.ready_two) then raise exception 'Оба игрока должны нажать «Готов».'; end if;
  if old.phase = 'squads2' and new.phase = 'game2' and not (new.game2_squads_ready_one and new.game2_squads_ready_two) then raise exception 'Оба игрока должны собрать отряды второй игры и нажать «Готов».'; end if;
  if old.phase = 'game1' and new.phase = 'squads2'
     and (new.game1_timer_one is null or new.game1_timer_two is null or not (new.game2_ready_one and new.game2_ready_two)
       or not (
         (r.bo2_game_number = 2 and r.status = 'active' and new.game1_room_snapshot is not null) or
         (game2_room.bo2_parent_room_id = r.id and game2_room.bo2_game_number = 2 and game2_room.status = 'active')
       )) then
    raise exception 'Для перехода во вторую игру оба игрока должны подтвердить готовность; игра продолжится в этой комнате.';
  end if;
  if new.phase is distinct from old.phase and not (
    (old.phase = 'squads' and new.phase = 'game1') or
    (old.phase = 'game1' and new.phase = 'squads2') or
    (old.phase = 'squads2' and new.phase = 'game2') or
    (old.phase = 'game2' and new.phase = 'completed')
  ) then raise exception 'Недопустимый переход фазы BO2.'; end if;
  if old.phase = 'game2' and new.phase = 'completed' and (new.game2_timer_one is null or new.game2_timer_two is null) then
    raise exception 'Нужны таймеры обоих игроков второй игры.';
  end if;

  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists guard_bo2_match_series_trigger on public.draft_match_series;
create trigger guard_bo2_match_series_trigger before update on public.draft_match_series
for each row execute function public.guard_bo2_match_series();

-- The earlier ready guard relied on the room's current player slots. Series ownership is now stable by ID.
drop trigger if exists guard_bo2_game2_ready_trigger on public.draft_match_series;

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
  if series_row.game1_timer_one is null or series_row.game1_timer_two is null then raise exception 'Сначала сохраните таймеры обоих игроков первой игры.'; end if;

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

  -- Reuse the same room id and code. Preserve the first game's complete room state in the series row.
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

create or replace function public.set_bo2_game2_ready(p_room_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare root public.draft_rooms%rowtype; s public.draft_match_series%rowtype;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into root from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Комната матча не найдена.'; end if;
  if root.bo2_parent_room_id is not null then raise exception 'Эта старая BO2-серия уже использует отдельную комнату.'; end if;
  select * into s from public.draft_match_series where room_id = root.id for update;
  if not found then raise exception 'Данные BO2 не найдены.'; end if;
  if auth.uid() not in (s.player_one_id, s.player_two_id) then raise exception 'Ты не участник этого матча.'; end if;
  if root.bo2_game_number = 2 and s.phase in ('squads2','game2') then return root.id; end if;
  if root.status <> 'completed' or root.bo2_game_number = 2 or s.phase <> 'game1' then raise exception 'Первая игра ещё не завершена.'; end if;
  if s.game1_timer_one is null or s.game1_timer_two is null then raise exception 'Сначала оба игрока должны сохранить таймер первой игры.'; end if;
  if auth.uid() = s.player_one_id then
    update public.draft_match_series set game2_ready_one = true, updated_at = now() where room_id = root.id returning * into s;
  else
    update public.draft_match_series set game2_ready_two = true, updated_at = now() where room_id = root.id returning * into s;
  end if;
  if s.game2_ready_one and s.game2_ready_two then return public.create_bo2_second_draft(root.id); end if;
  return null;
end;
$$;
revoke all on function public.set_bo2_game2_ready(uuid) from public;
grant execute on function public.set_bo2_game2_ready(uuid) to authenticated;

comment on column public.draft_match_series.game1_room_snapshot is 'Archived game 1 state; game 2 reuses the same draft_rooms row.';
