-- Apply after global_rules_admin.sql.
-- Grant Cost Managers access only to the shared global_rules record.
-- Administrator policies remain unchanged and continue to apply.

drop policy if exists "cost managers manage global draft rules" on public.system_settings;
create policy "cost managers manage global draft rules" on public.system_settings
  for all to authenticated
  using (
    id = 'global_rules'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'cost_manager')
  )
  with check (
    id = 'global_rules'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'cost_manager')
  );
