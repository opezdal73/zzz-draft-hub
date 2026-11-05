-- Fix already-installed judge RPCs when pgcrypto lives outside public.
-- Supabase commonly installs pgcrypto in the extensions schema.
do $$
declare crypto_schema text;
begin
  select n.nspname into crypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if crypto_schema is null then
    raise exception 'pgcrypto extension is not installed. Enable pgcrypto, then run this patch again.';
  end if;

  execute format(
    'alter function public.create_draft_judge_link(uuid) set search_path = pg_catalog, %I, public',
    crypto_schema
  );
  execute format(
    'alter function public.read_draft_room_as_judge(text) set search_path = pg_catalog, %I, public',
    crypto_schema
  );
  execute format(
    'alter function public.control_draft_room_as_judge(text, text) set search_path = pg_catalog, %I, public',
    crypto_schema
  );
end;
$$;
