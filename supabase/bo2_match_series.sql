-- BO2 post-draft squads, W-Engines and timers.
-- Run this migration once in Supabase SQL Editor.
create table if not exists public.draft_match_series (
  room_id uuid primary key references public.draft_rooms(id) on delete cascade,
  second_room_id uuid references public.draft_rooms(id) on delete set null,
  phase text not null default 'squads' check (phase in ('squads','game1','game2','completed')),
  squad_one jsonb not null default '[]'::jsonb,
  squad_two jsonb not null default '[]'::jsonb,
  ready_one boolean not null default false,
  ready_two boolean not null default false,
  game1_timer_one integer,
  game1_timer_two integer,
  game2_timer_one integer,
  game2_timer_two integer,
  updated_at timestamptz not null default now(),
  check (game1_timer_one is null or game1_timer_one >= 0),
  check (game1_timer_two is null or game1_timer_two >= 0),
  check (game2_timer_one is null or game2_timer_one >= 0),
  check (game2_timer_two is null or game2_timer_two >= 0)
);

alter table public.draft_match_series enable row level security;
drop policy if exists "Match participants can read BO2 series" on public.draft_match_series;
create policy "Match participants can read BO2 series" on public.draft_match_series for select to authenticated
using (exists (select 1 from public.draft_rooms r where r.id=room_id and auth.uid() in (r.player_one_id,r.player_two_id,r.host_id)));
drop policy if exists "Match participants can create BO2 series" on public.draft_match_series;
create policy "Match participants can create BO2 series" on public.draft_match_series for insert to authenticated
with check (exists (select 1 from public.draft_rooms r where r.id=room_id and auth.uid() in (r.player_one_id,r.player_two_id,r.host_id) and r.status='completed'));
drop policy if exists "Match participants can update BO2 series" on public.draft_match_series;
create policy "Match participants can update BO2 series" on public.draft_match_series for update to authenticated
using (exists (select 1 from public.draft_rooms r where r.id=room_id and auth.uid() in (r.player_one_id,r.player_two_id,r.host_id)))
with check (exists (select 1 from public.draft_rooms r where r.id=room_id and auth.uid() in (r.player_one_id,r.player_two_id,r.host_id)));

-- Settings stored in system_settings row id='amplifier_rules': {"budget":60,"costs":{"engine-id":10}}.
insert into public.system_settings (id, settings) values ('amplifier_rules', '{"budget":60,"costs":{}}'::jsonb)
on conflict (id) do nothing;

create or replace function public.guard_bo2_match_series()
returns trigger language plpgsql security definer set search_path=public as $$
declare r public.draft_rooms%rowtype; uid uuid := auth.uid(); old_side_ready boolean; new_side_ready boolean;
begin
  select * into r from public.draft_rooms where id=new.room_id;
  if not found or uid not in (r.player_one_id,r.player_two_id,r.host_id) then raise exception 'Нет доступа к этой серии.'; end if;
  if tg_op='UPDATE' then
    if old.phase='completed' and new is distinct from old then raise exception 'Завершённую серию нельзя менять.'; end if;
    if uid=r.player_one_id then
      if new.squad_two is distinct from old.squad_two or new.ready_two is distinct from old.ready_two then raise exception 'Нельзя менять данные соперника.'; end if;
      if old.ready_one and (new.squad_one is distinct from old.squad_one or new.ready_one is distinct from old.ready_one) then raise exception 'После готовности отряд и амплификаторы заблокированы.'; end if;
      if new.game1_timer_two is distinct from old.game1_timer_two or new.game2_timer_two is distinct from old.game2_timer_two then raise exception 'Можно вводить только свой таймер.'; end if;
    elsif uid=r.player_two_id then
      if new.squad_one is distinct from old.squad_one or new.ready_one is distinct from old.ready_one then raise exception 'Нельзя менять данные соперника.'; end if;
      if old.ready_two and (new.squad_two is distinct from old.squad_two or new.ready_two is distinct from old.ready_two) then raise exception 'После готовности отряд и амплификаторы заблокированы.'; end if;
      if new.game1_timer_one is distinct from old.game1_timer_one or new.game2_timer_one is distinct from old.game2_timer_one then raise exception 'Можно вводить только свой таймер.'; end if;
    end if;
    if uid=r.player_one_id then
      if new.game1_restarts_two is distinct from old.game1_restarts_two or new.game2_restarts_two is distinct from old.game2_restarts_two then raise exception 'Нельзя менять рестарты соперника.'; end if;
    elsif uid=r.player_two_id then
      if new.game1_restarts_one is distinct from old.game1_restarts_one or new.game2_restarts_one is distinct from old.game2_restarts_one then raise exception 'Нельзя менять рестарты соперника.'; end if;
    end if;
    if new.game1_restarts_one < old.game1_restarts_one or new.game1_restarts_two < old.game1_restarts_two or new.game2_restarts_one < old.game2_restarts_one or new.game2_restarts_two < old.game2_restarts_two then raise exception 'Счётчик рестартов нельзя уменьшить.'; end if;
    if new.game1_restarts_one > old.game1_restarts_one + 1 or new.game1_restarts_two > old.game1_restarts_two + 1 or new.game2_restarts_one > old.game2_restarts_one + 1 or new.game2_restarts_two > old.game2_restarts_two + 1 then raise exception 'За один раз можно зарегистрировать только один рестарт.'; end if;
    if old.phase='game1' and (new.game1_restarts_one > 5 or new.game1_restarts_two > 5) then raise exception 'Максимум 5 рестартов за игру.'; end if;
    if old.phase='game2' and (new.game2_restarts_one > 5 or new.game2_restarts_two > 5) then raise exception 'Максимум 5 рестартов за игру.'; end if;
    -- Atomic transition: when the second player marks ready, switch to game1
    -- in the same database transaction. This avoids stale client state/race conditions.
    if old.phase='squads' and new.ready_one and new.ready_two then
      new.phase='game1';
    end if;
    if old.phase='squads' and new.phase='game1' and not (new.ready_one and new.ready_two) then raise exception 'Оба игрока должны нажать Готов.'; end if;
    if old.phase='game1' and new.phase='game2' and (new.game1_timer_one is null or new.game1_timer_two is null) then raise exception 'Нужны таймеры обоих игроков первой игры.'; end if;
    if old.phase='game2' and new.phase='completed' and (new.game2_timer_one is null or new.game2_timer_two is null) then raise exception 'Нужны таймеры обоих игроков второй игры.'; end if;
  end if;
  new.updated_at=now();
  return new;
end; $$;
drop trigger if exists guard_bo2_match_series_trigger on public.draft_match_series;
create trigger guard_bo2_match_series_trigger before update on public.draft_match_series for each row execute function public.guard_bo2_match_series();

-- Restart tracking: each player may register at most five restarts per game.
alter table public.draft_match_series add column if not exists game1_restarts_one integer not null default 0;
alter table public.draft_match_series add column if not exists game1_restarts_two integer not null default 0;
alter table public.draft_match_series add column if not exists game2_restarts_one integer not null default 0;
alter table public.draft_match_series add column if not exists game2_restarts_two integer not null default 0;
alter table public.draft_match_series drop constraint if exists draft_match_series_game1_restarts_one_check;
alter table public.draft_match_series add constraint draft_match_series_game1_restarts_one_check check (game1_restarts_one between 0 and 5);
alter table public.draft_match_series drop constraint if exists draft_match_series_game1_restarts_two_check;
alter table public.draft_match_series add constraint draft_match_series_game1_restarts_two_check check (game1_restarts_two between 0 and 5);
alter table public.draft_match_series drop constraint if exists draft_match_series_game2_restarts_one_check;
alter table public.draft_match_series add constraint draft_match_series_game2_restarts_one_check check (game2_restarts_one between 0 and 5);
alter table public.draft_match_series drop constraint if exists draft_match_series_game2_restarts_two_check;
alter table public.draft_match_series add constraint draft_match_series_game2_restarts_two_check check (game2_restarts_two between 0 and 5);
insert into public.system_settings (id, settings) values ('restart_rules', '{"free":2,"smallCount":2,"smallPenalty":5,"bigPenalty":300}'::jsonb) on conflict (id) do nothing;
