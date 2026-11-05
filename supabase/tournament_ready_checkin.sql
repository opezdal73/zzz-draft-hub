-- Apply after tournament_draft_rooms.sql.
-- Tournament rooms wait for both players to connect and confirm readiness.
alter table public.draft_rooms
  add column if not exists player_one_ready boolean not null default false,
  add column if not exists player_two_ready boolean not null default false;

create or replace function public.keep_tournament_room_waiting()
returns trigger language plpgsql as $$
begin
  if new.tournament_match_id is not null then
    new.status := 'waiting';
    new.player_one_ready := false;
    new.player_two_ready := false;
  end if;
  return new;
end;
$$;
drop trigger if exists keep_tournament_room_waiting_trigger on public.draft_rooms;
create trigger keep_tournament_room_waiting_trigger
before insert on public.draft_rooms
for each row execute function public.keep_tournament_room_waiting();

create or replace function public.set_tournament_player_ready(p_room_id uuid)
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare r public.draft_rooms; updated public.draft_rooms;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into r from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.tournament_match_id is null then raise exception 'Подтверждение готовности доступно только в турнирном драфте.'; end if;
  if r.status not in ('waiting','ready') then raise exception 'Турнирный драфт уже начался или завершён.'; end if;
  if r.player_one_id is null or r.player_two_id is null then raise exception 'Ожидаем подключения обоих игроков.'; end if;
  if auth.uid() = r.player_one_id then
    update public.draft_rooms set player_one_ready = true,
      status = case when player_two_ready then 'active' else 'waiting' end,
      current_step = case when player_two_ready then 0 else current_step end,
      actions = case when player_two_ready then '[]'::jsonb else actions end,
      revision = revision + 1, updated_at = now()
    where id = p_room_id returning * into updated;
  elsif auth.uid() = r.player_two_id then
    update public.draft_rooms set player_two_ready = true,
      status = case when player_one_ready then 'active' else 'waiting' end,
      current_step = case when player_one_ready then 0 else current_step end,
      actions = case when player_one_ready then '[]'::jsonb else actions end,
      revision = revision + 1, updated_at = now()
    where id = p_room_id returning * into updated;
  else
    raise exception 'Ты не участник этого турнирного матча.';
  end if;
  return updated;
end;
$$;
revoke all on function public.set_tournament_player_ready(uuid) from public;
grant execute on function public.set_tournament_player_ready(uuid) to authenticated;
