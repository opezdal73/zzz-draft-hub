-- Apply after draft_rooms_migration.sql, configurable_min_agents.sql and online_saved_rosters.sql.
-- Apply after tournament_registration_rosters.sql as well as the migrations below.
-- Adds tournament metadata and a narrowly authorized room creator for tournament admins.
alter table public.draft_rooms add column if not exists tournament_id text;
alter table public.draft_rooms add column if not exists tournament_match_id text;
create unique index if not exists draft_rooms_tournament_match_unique
  on public.draft_rooms (tournament_match_id) where tournament_match_id is not null;

create or replace function public.autostart_tournament_draft()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.tournament_match_id is not null and new.status = 'ready' and old.status <> 'ready' then
    new.status := 'active';
    new.current_step := 0;
    new.actions := '[]'::jsonb;
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;
drop trigger if exists autostart_tournament_draft_trigger on public.draft_rooms;
create trigger autostart_tournament_draft_trigger before update on public.draft_rooms
for each row execute function public.autostart_tournament_draft();

drop function if exists public.create_tournament_draft_room(text,text,uuid,uuid,text,jsonb,integer,uuid);
drop function if exists public.create_tournament_draft_room(text,text,uuid,uuid,text,jsonb,integer);
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
declare uid uuid := auth.uid(); r public.draft_rooms%rowtype; source_room public.draft_rooms%rowtype; code text; room_host uuid;
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
  if (p_roster_one_snapshot is not null and case when jsonb_typeof(p_roster_one_snapshot->'agent_ids') = 'array' then jsonb_array_length(p_roster_one_snapshot->'agent_ids') < greatest(1, least(100, p_min_agents)) else true end) or
     (p_roster_two_snapshot is not null and case when jsonb_typeof(p_roster_two_snapshot->'agent_ids') = 'array' then jsonb_array_length(p_roster_two_snapshot->'agent_ids') < greatest(1, least(100, p_min_agents)) else true end) then
    raise exception 'Зарегистрированный ростер не соответствует минимальному количеству агентов.';
  end if;
  select * into r from public.draft_rooms where tournament_match_id = p_match_id;
  if found then return r; end if;
  code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.draft_rooms (
    join_code, title, host_id, player_one_id, player_two_id, template_snapshot,
    status, roster_one, roster_two, roster_snapshot_one, roster_snapshot_two, actions, current_step, min_agents,
    tournament_id, tournament_match_id
  ) values (
    code, left(coalesce(nullif(trim(p_title), ''), 'Турнирный драфт'), 80), room_host,
    p_player_one, p_player_two,
    case when jsonb_typeof(p_template_snapshot) = 'array' and jsonb_array_length(p_template_snapshot) > 0 then p_template_snapshot else '[]'::jsonb end,
    case when p_roster_one_snapshot is not null and p_roster_two_snapshot is not null then 'active' else 'waiting' end,
    coalesce(p_roster_one_snapshot->'agent_ids', '[]'::jsonb), coalesce(p_roster_two_snapshot->'agent_ids', '[]'::jsonb),
    case when p_roster_one_snapshot is null then null else p_roster_one_snapshot || jsonb_build_object('locked_at', now()) end,
    case when p_roster_two_snapshot is null then null else p_roster_two_snapshot || jsonb_build_object('locked_at', now()) end,
    '[]'::jsonb, 0, greatest(1, least(100, p_min_agents)),
    p_tournament_id, p_match_id
  ) returning * into r;
  return r;
end;
$$;
revoke all on function public.create_tournament_draft_room(text,text,uuid,uuid,text,jsonb,integer,uuid,jsonb,jsonb) from public;
grant execute on function public.create_tournament_draft_room(text,text,uuid,uuid,text,jsonb,integer,uuid,jsonb,jsonb) to authenticated;
