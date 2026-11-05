-- ZZZ Draft Hub schema starter.
-- Apply in Supabase SQL Editor only after reviewing and configuring production auth.
create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'cost_manager', 'player');
create type public.tournament_status as enum ('registration', 'ready', 'in_progress', 'completed');
create type public.match_status as enum ('pending', 'completed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null unique check (char_length(nickname) between 3 and 24),
  avatar_id text not null default 'anby',
  role public.app_role not null default 'player',
  created_at timestamptz not null default now()
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  max_players integer not null default 16 check (max_players >= 2),
  status public.tournament_status not null default 'registration',
  draft_url text not null default '',
  rules_text text not null default '',
  cost_limit integer not null default 10 check (cost_limit >= 0),
  preban_every integer not null default 5 check (preban_every >= 0),
  mirrors_enabled boolean not null default true,
  mirror_stage text not null default 'Последний пик каждого игрока',
  cost_config jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.agents (
  id text primary key,
  name text not null,
  rank text not null default '',
  avatar_path text not null default '',
  default_cost integer not null default 0 check (default_cost >= 0)
);

create table public.w_engines (
  id text primary key,
  name text not null,
  rank text not null default '',
  engine_type text not null default '',
  avatar_path text not null default '',
  default_cost integer not null default 0 check (default_cost >= 0)
);

create table public.tournament_entrants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  seed integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tournament_id, player_id)
);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_number integer not null check (round_number >= 1),
  slot_number integer not null check (slot_number >= 1),
  player_a uuid references public.profiles(id),
  player_b uuid references public.profiles(id),
  winner_id uuid references public.profiles(id),
  status public.match_status not null default 'pending',
  unique (tournament_id, round_number, slot_number)
);

create table public.tournament_costs (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  item_kind text not null check (item_kind in ('agent', 'w_engine')),
  item_id text not null,
  base_cost integer not null default 0 check (base_cost >= 0),
  unique (tournament_id, item_kind, item_id)
);

create table public.w_engine_agent_modifiers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  w_engine_id text not null references public.w_engines(id) on delete cascade,
  agent_id text not null references public.agents(id) on delete cascade,
  modifier integer not null default 0,
  unique (tournament_id, w_engine_id, agent_id)
);

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.agents enable row level security;
alter table public.w_engines enable row level security;
alter table public.tournament_entrants enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_costs enable row level security;
alter table public.w_engine_agent_modifiers enable row level security;

-- Public read policies for tournament listings, roster data and rules.
create policy "profiles readable" on public.profiles for select using (true);
create policy "tournaments readable" on public.tournaments for select using (true);
create policy "agents readable" on public.agents for select using (true);
create policy "w engines readable" on public.w_engines for select using (true);
create policy "entrants readable" on public.tournament_entrants for select using (true);
create policy "matches readable" on public.tournament_matches for select using (true);
create policy "tournament costs readable" on public.tournament_costs for select using (true);
create policy "engine modifiers readable" on public.w_engine_agent_modifiers for select using (true);

-- IMPORTANT:
-- These read policies are only a starting point. Do not enable public writes.
-- Before production, add server-verified authorization policies or route mutations
-- through trusted Edge Functions. Never trust a client-provided role.
-- Username-only password auth requires a secure server-side auth implementation;
-- do not store plaintext passwords or use browser localStorage as production auth.