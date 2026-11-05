-- Account-wide agent ownership and mindscape levels.
-- Apply in Supabase SQL Editor. Existing inventory rows and ownership are preserved.
create table if not exists public.player_account_inventory (
  player_id uuid primary key references auth.users(id) on delete cascade,
  agent_ids text[] not null default '{}',
  w_engine_ids text[] not null default '{}',
  agent_levels jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.player_account_inventory
  add column if not exists agent_levels jsonb not null default '{}'::jsonb;

alter table public.player_account_inventory enable row level security;

drop policy if exists "Users can read own account inventory" on public.player_account_inventory;
create policy "Users can read own account inventory" on public.player_account_inventory
  for select to authenticated using (auth.uid() = player_id);
drop policy if exists "Users can insert own account inventory" on public.player_account_inventory;
create policy "Users can insert own account inventory" on public.player_account_inventory
  for insert to authenticated with check (auth.uid() = player_id);
drop policy if exists "Users can update own account inventory" on public.player_account_inventory;
create policy "Users can update own account inventory" on public.player_account_inventory
  for update to authenticated using (auth.uid() = player_id) with check (auth.uid() = player_id);

alter table public.player_account_inventory
  drop constraint if exists player_account_inventory_agent_levels_object;
alter table public.player_account_inventory
  add constraint player_account_inventory_agent_levels_object
  check (jsonb_typeof(agent_levels) = 'object');
