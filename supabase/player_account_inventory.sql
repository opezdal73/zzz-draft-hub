-- Personal account collection used by the My Rosters builder.
create table if not exists public.player_account_inventory (
  player_id uuid primary key references auth.users(id) on delete cascade,
  agent_ids text[] not null default '{}',
  w_engine_ids text[] not null default '{}',
  agent_levels jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.player_account_inventory enable row level security;
drop policy if exists "Users can read own account inventory" on public.player_account_inventory;
create policy "Users can read own account inventory" on public.player_account_inventory for select using (auth.uid() = player_id);
drop policy if exists "Users can insert own account inventory" on public.player_account_inventory;
create policy "Users can insert own account inventory" on public.player_account_inventory for insert with check (auth.uid() = player_id);
drop policy if exists "Users can update own account inventory" on public.player_account_inventory;
create policy "Users can update own account inventory" on public.player_account_inventory for update using (auth.uid() = player_id) with check (auth.uid() = player_id);

-- Safe upgrade for projects where this table already existed.
alter table public.player_account_inventory add column if not exists agent_levels jsonb not null default '{}'::jsonb;
