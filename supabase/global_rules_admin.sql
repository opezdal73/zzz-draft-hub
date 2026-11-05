-- Global rules and owner-only admin settings for ZZZ Draft Hub.
-- Apply after the existing profile/draft room migrations.
create table if not exists public.system_settings (
  id text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.system_settings enable row level security;
drop policy if exists "global settings readable by authenticated" on public.system_settings;
create policy "global settings readable by authenticated" on public.system_settings
  for select to authenticated using (true);
drop policy if exists "admins manage global settings" on public.system_settings;
create policy "admins manage global settings" on public.system_settings
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
insert into public.system_settings (id, settings)
values ('global_rules', '{"min_agents":5,"min_roster_cost":0,"max_roster_cost":999,"cost_difference_per_preban":3,"turn_timer_seconds":60,"reserve_time_seconds":30}'::jsonb)
on conflict (id) do nothing;

-- IMPORTANT: after registering your real owner account, promote it manually in SQL Editor.
-- Replace the email below with the email you used for your owner account, then run separately:
-- update public.profiles p set role = 'admin'
-- from auth.users u where p.id = u.id and u.email = 'YOUR_OWNER_EMAIL_HERE';

-- Prevent a normal user from promoting themselves by updating their profile role.
create or replace function public.prevent_self_role_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  -- Allow trusted SQL Editor / migration execution where auth.uid() is NULL.
  -- Authenticated app users still cannot change their own or anyone else's role unless admin.
  if auth.uid() is not null
     and new.role is distinct from old.role
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'Только администратор может менять роли пользователей.';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role before update on public.profiles
for each row execute function public.prevent_self_role_change();
