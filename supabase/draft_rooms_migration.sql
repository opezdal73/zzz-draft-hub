-- Apply AFTER schema.sql in Supabase SQL Editor.
-- Draft templates are admin-managed. Rooms snapshot their template so edits do not
-- change active games. Do not enable anonymous writes.
create table if not exists public.draft_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  steps jsonb not null default '[]'::jsonb,
  is_default boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint draft_templates_steps_array check (jsonb_typeof(steps) = 'array')
);

create table if not exists public.draft_rooms (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique,
  title text not null default 'Комната драфта',
  host_id uuid not null references public.profiles(id),
  player_one_id uuid references public.profiles(id),
  player_two_id uuid references public.profiles(id),
  template_id uuid references public.draft_templates(id) on delete set null,
  template_snapshot jsonb not null,
  status text not null default 'waiting' check (status in ('waiting','ready','active','completed','cancelled')),
  roster_one jsonb not null default '[]'::jsonb,
  roster_two jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  current_step integer not null default 0 check (current_step >= 0),
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint draft_room_roster_one_array check (jsonb_typeof(roster_one) = 'array'),
  constraint draft_room_roster_two_array check (jsonb_typeof(roster_two) = 'array'),
  constraint draft_room_actions_array check (jsonb_typeof(actions) = 'array')
);

create table if not exists public.draft_room_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.draft_rooms(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  step_index integer not null check (step_index >= 0),
  action_type text not null check (action_type in ('ban','pick','mirror')),
  side text not null check (side in ('I1','I2')),
  agent_id text not null,
  created_at timestamptz not null default now()
);

alter table public.draft_templates enable row level security;
alter table public.draft_rooms enable row level security;
alter table public.draft_room_events enable row level security;

-- Authenticated users can view templates and rooms; policies below constrain writes.
create policy "authenticated can read draft templates" on public.draft_templates
  for select to authenticated using (true);
create policy "authenticated can create draft templates" on public.draft_templates
  for insert to authenticated with check (created_by = auth.uid());
create policy "template owner can update draft templates" on public.draft_templates
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "template owner can delete draft templates" on public.draft_templates
  for delete to authenticated using (created_by = auth.uid());

create policy "participants can read rooms" on public.draft_rooms
  for select to authenticated using (host_id = auth.uid() or player_one_id = auth.uid() or player_two_id = auth.uid());
create policy "authenticated can create own rooms" on public.draft_rooms
  for insert to authenticated with check (host_id = auth.uid() and (player_one_id is null or player_one_id = auth.uid()));
create policy "participants can update rooms" on public.draft_rooms
  for update to authenticated using (host_id = auth.uid() or player_one_id = auth.uid() or player_two_id = auth.uid())
  with check (host_id = auth.uid() or player_one_id = auth.uid() or player_two_id = auth.uid());
create policy "participants can read room events" on public.draft_room_events
  for select to authenticated using (exists (
    select 1 from public.draft_rooms r where r.id = room_id
    and (r.host_id = auth.uid() or r.player_one_id = auth.uid() or r.player_two_id = auth.uid())
  ));
create policy "room participants can add events" on public.draft_room_events
  for insert to authenticated with check (actor_id = auth.uid() and exists (
    select 1 from public.draft_rooms r where r.id = room_id
    and (r.host_id = auth.uid() or r.player_one_id = auth.uid() or r.player_two_id = auth.uid())
  ));

-- Enable Realtime updates for the room state. If this errors because already added,
-- check the publication membership in Supabase Dashboard > Database > Publications.
alter publication supabase_realtime add table public.draft_rooms;
alter publication supabase_realtime add table public.draft_room_events;

-- NOTE: This is a development foundation, not final anti-cheat authorization.
-- Before public launch, move pick/ban mutations into a Postgres RPC or Edge Function
-- that atomically validates turn ownership, step index, roster membership, and duplicates.
