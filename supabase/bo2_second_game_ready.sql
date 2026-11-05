-- Apply after bo2_second_game_side_rotation.sql.
-- Both players must confirm the transition before the second BO2 draft is created.
alter table public.draft_match_series
  add column if not exists game2_ready_one boolean not null default false,
  add column if not exists game2_ready_two boolean not null default false;

create or replace function public.guard_bo2_game2_ready()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.draft_rooms%rowtype; uid uuid := auth.uid();
begin
  select * into r from public.draft_rooms where id = new.room_id;
  if not found then raise exception 'Комната матча не найдена.'; end if;
  if new.game2_ready_one is distinct from old.game2_ready_one and uid is distinct from r.player_one_id then
    raise exception 'Подтвердить переход может только игрок 1.';
  end if;
  if new.game2_ready_two is distinct from old.game2_ready_two and uid is distinct from r.player_two_id then
    raise exception 'Подтвердить переход может только игрок 2.';
  end if;
  if (old.game2_ready_one and not new.game2_ready_one) or (old.game2_ready_two and not new.game2_ready_two) then
    raise exception 'Подтверждение перехода нельзя отменить.';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_bo2_game2_ready_trigger on public.draft_match_series;
create trigger guard_bo2_game2_ready_trigger
before update on public.draft_match_series
for each row execute function public.guard_bo2_game2_ready();

create or replace function public.create_bo2_second_draft(p_room_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  root public.draft_rooms%rowtype;
  series_row public.draft_match_series%rowtype;
  new_id uuid;
  new_code text;
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

  new_code := upper(substr(md5(random()::text || clock_timestamp()::text || root.id::text), 1, 6));
  insert into public.draft_rooms(
    join_code, title, host_id, player_one_id, player_two_id, template_id, template_snapshot, status,
    roster_one, roster_two, actions, current_step, revision, min_agents, bo2_parent_room_id, bo2_game_number
  ) values (
    new_code, left(root.title || ' · Игра 2', 80), root.host_id, root.player_two_id, root.player_one_id,
    root.template_id, root.template_snapshot, 'active', root.roster_two, root.roster_one,
    '[]'::jsonb, 0, 0, root.min_agents, root.id, 2
  ) returning id into new_id;
  update public.draft_match_series set phase = 'game2', second_room_id = new_id, updated_at = now() where room_id = root.id;
  return new_id;
end;
$$;
revoke all on function public.create_bo2_second_draft(uuid) from public;
grant execute on function public.create_bo2_second_draft(uuid) to authenticated;

create or replace function public.set_bo2_game2_ready(p_room_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  root public.draft_rooms%rowtype;
  s public.draft_match_series%rowtype;
  new_room_id uuid;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into root from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Исходная комната не найдена.'; end if;
  if auth.uid() not in (root.player_one_id, root.player_two_id) then raise exception 'Ты не участник этого матча.'; end if;
  if root.status <> 'completed' then raise exception 'Первая игра ещё не завершена.'; end if;
  select * into s from public.draft_match_series where room_id = root.id for update;
  if not found or s.phase <> 'game1' then raise exception 'Переход ко второй игре сейчас недоступен.'; end if;
  if s.game1_timer_one is null or s.game1_timer_two is null then raise exception 'Сначала оба игрока должны сохранить таймер первой игры.'; end if;
  if auth.uid() = root.player_one_id then
    update public.draft_match_series set game2_ready_one = true, updated_at = now() where room_id = root.id returning * into s;
  else
    update public.draft_match_series set game2_ready_two = true, updated_at = now() where room_id = root.id returning * into s;
  end if;
  if s.game2_ready_one and s.game2_ready_two then
    new_room_id := public.create_bo2_second_draft(root.id);
    return new_room_id;
  end if;
  return null;
end;
$$;
revoke all on function public.set_bo2_game2_ready(uuid) from public;
grant execute on function public.set_bo2_game2_ready(uuid) to authenticated;
