-- Apply after global_rules_admin.sql and user_cost_configs_and_super_admin.sql.
-- Cost Manager values are shared by every authenticated account and browser tab.

create table if not exists public.system_settings (
  id text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.system_settings enable row level security;

drop policy if exists "shared cost config readable" on public.system_settings;
create policy "shared cost config readable" on public.system_settings
  for select to authenticated using (id = 'cost_config');

drop policy if exists "cost managers manage shared cost config" on public.system_settings;
create policy "cost managers manage shared cost config" on public.system_settings
  for all to authenticated
  using (
    id = 'cost_config'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'cost_manager'))
  )
  with check (
    id = 'cost_config'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'cost_manager'))
  );

-- Preserve the most recently edited account config as the initial shared catalog.
-- Existing per-account rows remain intact as a backup.
insert into public.system_settings (id, settings, updated_at)
select 'cost_config', jsonb_build_object('agents', agents, 'engines', engines), updated_at
from public.user_cost_configs
order by updated_at desc
limit 1
on conflict (id) do nothing;

insert into public.system_settings (id, settings)
values (
  'cost_config',
  '{"agents": {}, "engines": {}}'::jsonb
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'system_settings'
  ) then
    alter publication supabase_realtime add table public.system_settings;
  end if;
end;
$$;
