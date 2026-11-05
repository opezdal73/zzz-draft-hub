-- Shared tournament registration requests. Run once in Supabase SQL Editor.
create table if not exists public.tournament_registration_requests (
  id text primary key,
  tournament_id text not null references public.community_tournaments(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

alter table public.tournament_registration_requests enable row level security;
drop policy if exists "Players can submit own tournament requests" on public.tournament_registration_requests;
create policy "Players can submit own tournament requests" on public.tournament_registration_requests
for insert to authenticated with check (player_id = auth.uid() and status = 'pending');
drop policy if exists "Players and admins can read tournament requests" on public.tournament_registration_requests;
create policy "Players and admins can read tournament requests" on public.tournament_registration_requests
for select to authenticated using (
  player_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
drop policy if exists "Admins can update tournament requests" on public.tournament_registration_requests;
create policy "Admins can update tournament requests" on public.tournament_registration_requests
for update to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
drop policy if exists "Admins can delete tournament requests" on public.tournament_registration_requests;
create policy "Admins can delete tournament requests" on public.tournament_registration_requests
for delete to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
