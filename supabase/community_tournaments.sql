-- Shared tournament list. Run once in Supabase SQL Editor.
create table if not exists public.community_tournaments (
  id text primary key,
  data jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_community_tournament_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists community_tournaments_updated_at on public.community_tournaments;
create trigger community_tournaments_updated_at before update on public.community_tournaments
for each row execute function public.touch_community_tournament_updated_at();

alter table public.community_tournaments enable row level security;
drop policy if exists "Authenticated users can view tournaments" on public.community_tournaments;
create policy "Authenticated users can view tournaments" on public.community_tournaments
for select to authenticated using (true);
drop policy if exists "Admins can create tournaments" on public.community_tournaments;
create policy "Admins can create tournaments" on public.community_tournaments
for insert to authenticated with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
drop policy if exists "Admins can delete tournaments" on public.community_tournaments;
create policy "Admins can delete tournaments" on public.community_tournaments
for delete to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
drop policy if exists "Admins can update tournaments" on public.community_tournaments;
create policy "Admins can update tournaments" on public.community_tournaments
for update to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
