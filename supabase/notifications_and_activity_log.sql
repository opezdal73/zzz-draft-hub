-- Persistent player notifications and organizer audit trail.
-- Apply once in the Supabase SQL Editor after the existing tournament and room migrations.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  message text not null default '',
  tournament_id text,
  room_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists user_notifications_user_created_idx
  on public.user_notifications(user_id, created_at desc);
alter table public.user_notifications enable row level security;
drop policy if exists "Users read own notifications" on public.user_notifications;
create policy "Users read own notifications" on public.user_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users update own notifications" on public.user_notifications;
create policy "Users update own notifications" on public.user_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, update on public.user_notifications to authenticated;

create table if not exists public.tournament_activity_log (
  id uuid primary key default gen_random_uuid(),
  tournament_id text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists tournament_activity_log_created_idx
  on public.tournament_activity_log(created_at desc);
alter table public.tournament_activity_log enable row level security;
drop policy if exists "Admins read tournament activity" on public.tournament_activity_log;
create policy "Admins read tournament activity" on public.tournament_activity_log
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
grant select on public.tournament_activity_log to authenticated;

create or replace function public.notify_registration_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare tournament_name text;
begin
  if new.status is distinct from old.status and new.status = 'approved' then
    select coalesce(data->>'name', 'Турнир') into tournament_name
      from public.community_tournaments where id = new.tournament_id;
    insert into public.user_notifications(user_id, kind, title, message, tournament_id)
    values (new.player_id, 'tournament_registration',
      'Заявка одобрена',
      tournament_name, new.tournament_id);
  end if;
  return new;
end;
$$;
drop trigger if exists tournament_registration_decision_notification on public.tournament_registration_requests;
create trigger tournament_registration_decision_notification
after update of status on public.tournament_registration_requests
for each row execute function public.notify_registration_decision();

create or replace function public.notify_tournament_room_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.tournament_match_id is not null then
    insert into public.user_notifications(user_id, kind, title, message, tournament_id, room_id)
    select uid, 'tournament_match', 'Создана комната матча', coalesce(new.title, 'Турнирный матч'), new.tournament_id, new.id
    from (values (new.player_one_id), (new.player_two_id)) as players(uid)
    where uid is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists tournament_room_notifications on public.draft_rooms;
create trigger tournament_room_notifications
after insert on public.draft_rooms
for each row execute function public.notify_tournament_room_events();

create or replace function public.audit_community_tournament_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare action_text text;
begin
  if tg_op = 'INSERT' then
    action_text := 'Турнир создан';
  elsif old.data->>'status' is distinct from new.data->>'status' then
    action_text := 'Изменён статус: ' || coalesce(new.data->>'status', 'не указан');
  elsif old.data->'matches' is distinct from new.data->'matches' then
    action_text := 'Обновлена сетка или внесён результат матча';
  elsif old.data->'entrants' is distinct from new.data->'entrants' then
    action_text := 'Обновлён список участников';
  else
    action_text := 'Изменены настройки турнира';
  end if;
  insert into public.tournament_activity_log(tournament_id, actor_id, action)
  values (new.id, auth.uid(), action_text);
  return new;
end;
$$;
drop trigger if exists community_tournament_audit on public.community_tournaments;
create trigger community_tournament_audit
after insert or update of data on public.community_tournaments
for each row execute function public.audit_community_tournament_changes();

create or replace function public.notify_new_tournament_matchups()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  match_row jsonb;
  previous_match jsonb;
  player_value text;
begin
  if tg_op <> 'UPDATE' or old.data->'matches' is not distinct from new.data->'matches' then
    return new;
  end if;
  for match_row in select value from jsonb_array_elements(coalesce(new.data->'matches', '[]'::jsonb)) as rows(value)
  loop
    select value into previous_match
      from jsonb_array_elements(coalesce(old.data->'matches', '[]'::jsonb)) as rows(value)
      where value->>'id' = match_row->>'id'
      limit 1;
    if coalesce(match_row->>'playerA', '') <> '' and coalesce(match_row->>'playerB', '') <> ''
       and (previous_match is null
         or previous_match->>'playerA' is distinct from match_row->>'playerA'
         or previous_match->>'playerB' is distinct from match_row->>'playerB') then
      foreach player_value in array array[match_row->>'playerA', match_row->>'playerB']
      loop
        if player_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          insert into public.user_notifications(user_id, kind, title, message, tournament_id)
          values (player_value::uuid, 'tournament_next_match', 'Соперник определён',
            coalesce(new.data->>'name', 'Турнир') || ' · раунд ' || coalesce(match_row->>'round', '?'), new.id);
        end if;
      end loop;
    end if;
    previous_match := null;
  end loop;
  return new;
end;
$$;
drop trigger if exists community_tournament_matchup_notifications on public.community_tournaments;
create trigger community_tournament_matchup_notifications
after update of data on public.community_tournaments
for each row execute function public.notify_new_tournament_matchups();
