-- Judge links, synchronized pause/undo/BO2 controls, and per-turn clocks.
-- Apply once after the existing online room and bo2_single_room_transition migrations.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.draft_rooms
  add column if not exists turn_timer_seconds integer not null default 60 check (turn_timer_seconds between 10 and 600),
  add column if not exists reserve_time_seconds integer not null default 30 check (reserve_time_seconds between 0 and 300),
  add column if not exists turn_started_at timestamptz,
  add column if not exists is_paused boolean not null default false,
  add column if not exists pause_started_at timestamptz;

create table if not exists public.draft_room_judge_links (
  room_id uuid primary key references public.draft_rooms(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.draft_room_judge_links enable row level security;
revoke all on public.draft_room_judge_links from anon, authenticated;

create or replace function public.touch_draft_turn_clock()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'active' then
    new.turn_started_at := coalesce(new.turn_started_at, now());
  elsif tg_op = 'UPDATE' then
    if old.is_paused and (new.actions is distinct from old.actions or new.current_step is distinct from old.current_step or new.status is distinct from old.status)
       and coalesce(current_setting('app.judge_control', true), '') <> 'on' then
      raise exception 'Драфт на паузе. Дождись судью.';
    end if;
    if new.current_step is distinct from old.current_step or (old.status <> 'active' and new.status = 'active') then
      new.turn_started_at := now();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists draft_room_turn_clock on public.draft_rooms;
create trigger draft_room_turn_clock before insert or update on public.draft_rooms
for each row execute function public.touch_draft_turn_clock();

create or replace function public.apply_global_draft_timer_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare rules jsonb := '{}'::jsonb;
begin
  select coalesce(settings, '{}'::jsonb) into rules from public.system_settings where id = 'global_rules';
  new.turn_timer_seconds := greatest(10, least(600, coalesce((rules->>'turn_timer_seconds')::integer, 60)));
  new.reserve_time_seconds := greatest(0, least(300, coalesce((rules->>'reserve_time_seconds')::integer, 30)));
  return new;
end;
$$;
drop trigger if exists apply_global_draft_timer_rules_trigger on public.draft_rooms;
create trigger apply_global_draft_timer_rules_trigger before insert on public.draft_rooms
for each row execute function public.apply_global_draft_timer_rules();

create or replace function public.sync_global_timer_rules_to_pending_rooms()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.draft_rooms
    set turn_timer_seconds = greatest(10, least(600, coalesce((new.settings->>'turn_timer_seconds')::integer, 60))),
        reserve_time_seconds = greatest(0, least(300, coalesce((new.settings->>'reserve_time_seconds')::integer, 30))),
        revision = revision + 1, updated_at = now()
    where status in ('waiting', 'ready') and current_step = 0 and jsonb_array_length(actions) = 0;
  return new;
end;
$$;
drop trigger if exists sync_global_timer_rules_to_pending_rooms_trigger on public.system_settings;
create trigger sync_global_timer_rules_to_pending_rooms_trigger
after update of settings on public.system_settings
for each row when (old.id = 'global_rules' and (
  old.settings->>'turn_timer_seconds' is distinct from new.settings->>'turn_timer_seconds' or
  old.settings->>'reserve_time_seconds' is distinct from new.settings->>'reserve_time_seconds'
)) execute function public.sync_global_timer_rules_to_pending_rooms();
update public.draft_rooms r
  set turn_timer_seconds = greatest(10, least(600, coalesce((s.settings->>'turn_timer_seconds')::integer, 60))),
      reserve_time_seconds = greatest(0, least(300, coalesce((s.settings->>'reserve_time_seconds')::integer, 30)))
  from public.system_settings s
  where s.id = 'global_rules' and r.status in ('waiting', 'ready') and r.current_step = 0 and jsonb_array_length(r.actions) = 0;

create or replace function public.create_draft_judge_link(p_room_id uuid)
returns text language plpgsql security definer set search_path = pg_catalog, extensions, public as $$
declare token_value text; r public.draft_rooms%rowtype;
begin
  if auth.uid() is null then raise exception 'Войди в аккаунт, чтобы создать ссылку судьи.'; end if;
  select * into r from public.draft_rooms where id = p_room_id;
  if not found then raise exception 'Комната не найдена.'; end if;
  if auth.uid() not in (r.host_id, r.player_one_id, r.player_two_id)
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'Ссылку судьи может создать только участник комнаты или администратор.';
  end if;
  token_value := encode(gen_random_bytes(32), 'hex');
  insert into public.draft_room_judge_links(room_id, token_hash, created_by, revoked_at)
  values (r.id, encode(digest(token_value, 'sha256'), 'hex'), auth.uid(), null)
  on conflict (room_id) do update set token_hash = excluded.token_hash, created_by = excluded.created_by,
    created_at = now(), revoked_at = null;
  return token_value;
end;
$$;
revoke all on function public.create_draft_judge_link(uuid) from public;
grant execute on function public.create_draft_judge_link(uuid) to authenticated;

create or replace function public.read_draft_room_as_judge(p_token text)
returns public.draft_rooms language plpgsql security definer set search_path = pg_catalog, extensions, public as $$
declare result_room public.draft_rooms%rowtype;
begin
  if auth.uid() is null then raise exception 'Войди в аккаунт, чтобы открыть комнату судьи.'; end if;
  select r.* into result_room from public.draft_rooms r
  join public.draft_room_judge_links j on j.room_id = r.id
  where j.token_hash = encode(digest(p_token, 'sha256'), 'hex') and j.revoked_at is null;
  if not found then raise exception 'Ссылка судьи недействительна или отозвана.'; end if;
  return result_room;
end;
$$;
revoke all on function public.read_draft_room_as_judge(text) from public;
grant execute on function public.read_draft_room_as_judge(text) to authenticated;

-- Remove the earlier experimental overload that allowed judges to edit per-room timers.
drop function if exists public.control_draft_room_as_judge(text, text, integer, integer);

create or replace function public.control_draft_room_as_judge(
  p_token text, p_action text
)
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
    if series_row.game1_timer_one is null or series_row.game1_timer_two is null then raise exception 'Сначала оба игрока должны сохранить время первой игры.'; end if;
    -- The existing BO2 transition validates both ready flags and the stored result.
    -- Set each flag as its owner so its row guard remains in force, then use the normal transition.
    perform set_config('request.jwt.claim.sub', series_row.player_one_id::text, true);
    update public.draft_match_series set game2_ready_one = true, updated_at = now() where room_id = r.id;
    perform set_config('request.jwt.claim.sub', series_row.player_two_id::text, true);
    update public.draft_match_series set game2_ready_two = true, updated_at = now() where room_id = r.id;
    perform public.create_bo2_second_draft(r.id);
    perform set_config('request.jwt.claim.sub', caller_id::text, true);
    select * into r from public.draft_rooms where id = link_row.room_id;
  else
    raise exception 'Неизвестная команда судьи.';
  end if;
  return r;
end;
$$;
revoke all on function public.control_draft_room_as_judge(text, text) from public;
grant execute on function public.control_draft_room_as_judge(text, text) to authenticated;
