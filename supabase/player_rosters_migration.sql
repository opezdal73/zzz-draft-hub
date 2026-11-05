-- ZZZ Draft Hub: personal rosters, independent from tournaments and matches.
-- Apply once in Supabase SQL Editor. This adds a new table and does not delete existing data.

create table if not exists public.player_rosters (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  notes text not null default '' check (char_length(notes) <= 300),
  agent_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(agent_ids) = 'array'),
  w_engine_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(w_engine_ids) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, name)
);

create index if not exists player_rosters_owner_updated_idx
  on public.player_rosters (player_id, updated_at desc);

alter table public.player_rosters enable row level security;

drop policy if exists "players read own personal rosters" on public.player_rosters;
create policy "players read own personal rosters" on public.player_rosters
  for select to authenticated using (player_id = auth.uid());
drop policy if exists "players create own personal rosters" on public.player_rosters;
create policy "players create own personal rosters" on public.player_rosters
  for insert to authenticated with check (player_id = auth.uid());
drop policy if exists "players update own personal rosters" on public.player_rosters;
create policy "players update own personal rosters" on public.player_rosters
  for update to authenticated using (player_id = auth.uid()) with check (player_id = auth.uid());
drop policy if exists "players delete own personal rosters" on public.player_rosters;
create policy "players delete own personal rosters" on public.player_rosters
  for delete to authenticated using (player_id = auth.uid());

create or replace function public.set_player_rosters_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists player_rosters_updated_at on public.player_rosters;
create trigger player_rosters_updated_at before update on public.player_rosters
  for each row execute function public.set_player_rosters_updated_at();

-- Best-effort copy of existing per-tournament rosters into personal rosters.
-- Existing rows are retained in the old table. Names include tournament name to avoid collisions.
do $$
begin
  if to_regclass('public.tournament_player_rosters') is not null
     and to_regclass('public.online_tournaments') is not null then
    execute $copy$
      insert into public.player_rosters (player_id, name, notes, agent_ids, w_engine_ids)
      select old.player_id,
             left(old.name || ' — ' || coalesce(t.name, 'старый турнир'), 60),
             'Импортировано из ростера турнира: ' || coalesce(t.name, 'без названия'),
             old.agent_ids, old.w_engine_ids
      from public.tournament_player_rosters old
      left join public.online_tournaments t on t.id = old.tournament_id
      where not exists (
        select 1 from public.player_rosters current
        where current.player_id = old.player_id
          and current.name = left(old.name || ' — ' || coalesce(t.name, 'старый турнир'), 60)
      )
    $copy$;
  end if;
end $$;
