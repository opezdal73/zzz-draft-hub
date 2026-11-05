-- Run in Supabase SQL Editor. Lets authenticated admins change roles while preventing
-- ordinary users from promoting themselves. Profile SELECT is already public in schema.sql.
create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'::public.app_role
  );
$$;

revoke all on function public.current_user_is_admin() from public;
grant execute on function public.current_user_is_admin() to authenticated;

drop policy if exists "admins can update profile roles" on public.profiles;
create policy "admins can update profile roles"
on public.profiles
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());
