-- Restore the current BO2 state machine. The live trigger was an older version
-- and never switched phase from squads2 to game2 after both players were ready.
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

-- Recover series that were stranded after both players had already pressed Ready.
update public.draft_match_series s
set phase = 'game2', updated_at = now()
from public.draft_rooms r
where r.id = s.room_id
  and s.phase = 'squads2'
  and s.game2_squads_ready_one
  and s.game2_squads_ready_two
  and ((r.bo2_game_number = 2 and r.status = 'completed')
    or (s.second_room_id is not null and exists (
      select 1 from public.draft_rooms r2
      where r2.id = s.second_room_id and r2.bo2_parent_room_id = r.id
        and r2.bo2_game_number = 2 and r2.status = 'completed'
    )));
