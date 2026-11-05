-- Apply after player_rosters_migration.sql, roster_levels_migration.sql,
-- and tournament_registration_requests.sql.
alter table public.tournament_registration_requests
  add column if not exists roster_id uuid references public.player_rosters(id) on delete set null;
alter table public.tournament_registration_requests
  add column if not exists roster_snapshot jsonb;

create or replace function public.capture_registration_roster()
returns trigger language plpgsql security definer set search_path = public
as $$
declare saved public.player_rosters%rowtype;
begin
  if new.roster_id is null then raise exception 'Выбери сохранённый ростер для участия в турнире.'; end if;
  select * into saved from public.player_rosters where id = new.roster_id and player_id = new.player_id;
  if not found then raise exception 'Этот ростер не принадлежит твоему аккаунту.'; end if;
  new.roster_snapshot := jsonb_build_object(
    'id', saved.id,
    'name', saved.name,
    'agent_ids', saved.agent_ids,
    'w_engine_ids', saved.w_engine_ids,
    'agent_levels', coalesce(to_jsonb(saved.agent_levels), '{}'::jsonb),
    'w_engine_levels', coalesce(to_jsonb(saved.w_engine_levels), '{}'::jsonb)
  );
  return new;
end;
$$;
drop trigger if exists capture_registration_roster_trigger on public.tournament_registration_requests;
create trigger capture_registration_roster_trigger
before insert on public.tournament_registration_requests
for each row execute function public.capture_registration_roster();

drop policy if exists "Players can submit own tournament requests" on public.tournament_registration_requests;
create policy "Players can submit own tournament requests" on public.tournament_registration_requests
for insert to authenticated with check (
  player_id = auth.uid()
  and status = 'pending'
  and roster_id is not null
  and exists (select 1 from public.player_rosters r where r.id = roster_id and r.player_id = auth.uid())
);
