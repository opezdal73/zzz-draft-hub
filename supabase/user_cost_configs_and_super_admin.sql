-- Apply in Supabase SQL Editor after the existing schema/auth migrations.
-- 1) Per-account Cost Manager settings, isolated by auth.uid().
create table if not exists public.user_cost_configs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  agents jsonb not null default '{}'::jsonb,
  engines jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_cost_configs enable row level security;
drop policy if exists "users read own cost config" on public.user_cost_configs;
create policy "users read own cost config" on public.user_cost_configs
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "users insert own cost config" on public.user_cost_configs;
create policy "users insert own cost config" on public.user_cost_configs
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "users update own cost config" on public.user_cost_configs;
create policy "users update own cost config" on public.user_cost_configs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2) Protected Super Admin flag. It is separate from the ordinary role enum.
alter table public.profiles add column if not exists is_super_admin boolean not null default false;

create or replace function public.protect_super_admin_profile()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null then
    -- A Super Admin flag can only be changed by trusted SQL/migration (auth.uid() is NULL).
    if new.is_super_admin is distinct from old.is_super_admin then
      raise exception 'Флаг Super Admin может менять только владелец базы через SQL.';
    end if;
    -- Ordinary admins cannot change the role of a Super Admin, and only a Super Admin
    -- may change roles of other existing admins.
    if new.role is distinct from old.role and old.is_super_admin then
      raise exception 'Нельзя изменить роль Super Admin.';
    end if;
    if new.role is distinct from old.role and old.role = 'admin'::public.app_role
       and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_super_admin) then
      raise exception 'Только Super Admin может изменить роль другого администратора.';
    end if;
    if new.role is distinct from old.role and not exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'::public.app_role
    ) then
      raise exception 'Только администратор может менять роли пользователей.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_role on public.profiles;
drop trigger if exists protect_super_admin_profile on public.profiles;
create trigger protect_super_admin_profile before update on public.profiles
for each row execute function public.protect_super_admin_profile();

-- IMPORTANT: after applying this file, assign the protected flag to YOUR account.
-- Replace YOUR_OWNER_EMAIL_HERE with the email used to sign in, then run this separately:
-- update public.profiles p set role = 'admin', is_super_admin = true
-- from auth.users u where p.id = u.id and lower(u.email) = lower('YOUR_OWNER_EMAIL_HERE');
