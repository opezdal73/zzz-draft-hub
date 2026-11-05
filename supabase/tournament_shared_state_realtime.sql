-- Apply in Supabase SQL Editor after community_tournaments.sql and tournament_registration_requests.sql.
-- Tournament JSON stores the canonical tournament settings plus entrant and match arrays.
-- Enable realtime notifications for shared tournament and registration-request changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_tournaments'
  ) then
    alter publication supabase_realtime add table public.community_tournaments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournament_registration_requests'
  ) then
    alter publication supabase_realtime add table public.tournament_registration_requests;
  end if;
end $$;
