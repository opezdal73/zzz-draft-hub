-- ZZZ Draft Hub: online tournaments and per-tournament player rosters.
-- Apply AFTER schema.sql, draft_rooms_migration.sql and online_rooms.sql.
-- This creates separate cloud tournament records; it does not modify existing demo/local tournaments.

create table if not exists public.online_tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  description text not null default '',
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_player_rosters (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.online_tournaments(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  agent_ids jsonb not null default '[]'::jsonb,
  w_engine_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roster_agent_ids_array check (jsonb_typeof(agent_ids) = 'array'),
  constraint roster_w_engine_ids_array check (jsonb_typeof(w_engine_ids) = 'array'),
  unique (tournament_id, player_id, name)
);

alter table public.online_tournaments enable row level security;
alter table public.tournament_player_rosters enable row level security;

drop policy if exists "online tournaments readable by signed-in users" on public.online_tournaments;
create policy "online tournaments readable by signed-in users" on public.online_tournaments
  for select to authenticated using (true);
drop policy if exists "users create online tournaments" on public.online_tournaments;
create policy "users create online tournaments" on public.online_tournaments
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "tournament owners update online tournaments" on public.online_tournaments;
create policy "tournament owners update online tournaments" on public.online_tournaments
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists "tournament owners delete online tournaments" on public.online_tournaments;
create policy "tournament owners delete online tournaments" on public.online_tournaments
  for delete to authenticated using (created_by = auth.uid());

drop policy if exists "rosters readable by signed-in users" on public.tournament_player_rosters;
create policy "rosters readable by signed-in users" on public.tournament_player_rosters
  for select to authenticated using (true);
drop policy if exists "players create own tournament rosters" on public.tournament_player_rosters;
create policy "players create own tournament rosters" on public.tournament_player_rosters
  for insert to authenticated with check (player_id = auth.uid());
drop policy if exists "players update own tournament rosters" on public.tournament_player_rosters;
create policy "players update own tournament rosters" on public.tournament_player_rosters
  for update to authenticated using (player_id = auth.uid()) with check (player_id = auth.uid());
drop policy if exists "players delete own tournament rosters" on public.tournament_player_rosters;
create policy "players delete own tournament rosters" on public.tournament_player_rosters
  for delete to authenticated using (player_id = auth.uid());

create index if not exists online_tournaments_created_by_idx on public.online_tournaments(created_by);
create index if not exists tournament_player_rosters_lookup_idx on public.tournament_player_rosters(tournament_id, player_id);
