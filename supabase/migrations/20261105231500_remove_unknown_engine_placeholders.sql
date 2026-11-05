-- Remove only the eight non-canonical amplifier IDs shown as raw we-catalog-* labels.
-- These IDs are absent from src/data.ts; all other engine IDs and roster contents remain intact.
do $$
declare
  invalid_ids constant text[] := array[
    'we-catalog-023', 'we-catalog-024', 'we-catalog-025',
    'we-catalog-042', 'we-catalog-043', 'we-catalog-044',
    'we-catalog-074', 'we-catalog-087'
  ];
  invalid_level_keys constant text[] := array[
    'we-catalog-023', 'we-catalog-024', 'we-catalog-025',
    'we-catalog-042', 'we-catalog-043', 'we-catalog-044',
    'we-catalog-074', 'we-catalog-087'
  ];
begin
  update public.player_account_inventory i
  set w_engine_ids = array(
        select e.id from unnest(i.w_engine_ids) with ordinality e(id, position)
        where e.id <> all(invalid_ids) order by e.position
      ),
      w_engine_levels = coalesce((
        select jsonb_object_agg(k, v) from jsonb_each(i.w_engine_levels) as levels(k, v)
        where k <> all(invalid_level_keys) and k !~ '^copy:we-catalog-(023|024|025|042|043|044|074|087):[0-9]+$'
      ), '{}'::jsonb)
  where i.w_engine_ids && invalid_ids;

  update public.player_rosters r
  set w_engine_ids = coalesce((
        select jsonb_agg(e.value order by e.position)
        from jsonb_array_elements(r.w_engine_ids) with ordinality e(value, position)
        where e.value #>> '{}' <> all(invalid_ids)
      ), '[]'::jsonb),
      w_engine_levels = coalesce((
        select jsonb_object_agg(k, v) from jsonb_each(r.w_engine_levels) as levels(k, v)
        where k <> all(invalid_level_keys) and k !~ '^copy:we-catalog-(023|024|025|042|043|044|074|087):[0-9]+$'
      ), '{}'::jsonb)
  where exists (
    select 1 from jsonb_array_elements_text(r.w_engine_ids) e(id) where e.id = any(invalid_ids)
  );

  update public.tournament_player_rosters r
  set w_engine_ids = coalesce((
        select jsonb_agg(e.value order by e.position)
        from jsonb_array_elements(r.w_engine_ids) with ordinality e(value, position)
        where e.value #>> '{}' <> all(invalid_ids)
      ), '[]'::jsonb)
  where exists (
    select 1 from jsonb_array_elements_text(r.w_engine_ids) e(id) where e.id = any(invalid_ids)
  );

  update public.draft_rooms d
  set roster_snapshot_one = case when d.roster_snapshot_one is null then null else
        jsonb_set(
          jsonb_set(d.roster_snapshot_one, '{w_engine_ids}', coalesce((
            select jsonb_agg(e.value order by e.position)
            from jsonb_array_elements(coalesce(d.roster_snapshot_one->'w_engine_ids', '[]'::jsonb)) with ordinality e(value, position)
            where e.value #>> '{}' <> all(invalid_ids)
          ), '[]'::jsonb), true),
          '{w_engine_levels}', coalesce((
            select jsonb_object_agg(k, v) from jsonb_each(coalesce(d.roster_snapshot_one->'w_engine_levels', '{}'::jsonb)) as levels(k, v)
            where k <> all(invalid_level_keys) and k !~ '^copy:we-catalog-(023|024|025|042|043|044|074|087):[0-9]+$'
          ), '{}'::jsonb), true
        ) end,
      roster_snapshot_two = case when d.roster_snapshot_two is null then null else
        jsonb_set(
          jsonb_set(d.roster_snapshot_two, '{w_engine_ids}', coalesce((
            select jsonb_agg(e.value order by e.position)
            from jsonb_array_elements(coalesce(d.roster_snapshot_two->'w_engine_ids', '[]'::jsonb)) with ordinality e(value, position)
            where e.value #>> '{}' <> all(invalid_ids)
          ), '[]'::jsonb), true),
          '{w_engine_levels}', coalesce((
            select jsonb_object_agg(k, v) from jsonb_each(coalesce(d.roster_snapshot_two->'w_engine_levels', '{}'::jsonb)) as levels(k, v)
            where k <> all(invalid_level_keys) and k !~ '^copy:we-catalog-(023|024|025|042|043|044|074|087):[0-9]+$'
          ), '{}'::jsonb), true
        ) end
  where d.roster_snapshot_one is not null or d.roster_snapshot_two is not null;

  update public.tournament_registration_requests r
  set roster_snapshot = jsonb_set(
        jsonb_set(r.roster_snapshot, '{w_engine_ids}', coalesce((
          select jsonb_agg(e.value order by e.position)
          from jsonb_array_elements(coalesce(r.roster_snapshot->'w_engine_ids', '[]'::jsonb)) with ordinality e(value, position)
          where e.value #>> '{}' <> all(invalid_ids)
        ), '[]'::jsonb), true),
        '{w_engine_levels}', coalesce((
          select jsonb_object_agg(k, v) from jsonb_each(coalesce(r.roster_snapshot->'w_engine_levels', '{}'::jsonb)) as levels(k, v)
          where k <> all(invalid_level_keys) and k !~ '^copy:we-catalog-(023|024|025|042|043|044|074|087):[0-9]+$'
        ), '{}'::jsonb), true
      )
  where r.roster_snapshot is not null and exists (
    select 1 from jsonb_array_elements_text(coalesce(r.roster_snapshot->'w_engine_ids', '[]'::jsonb)) e(id) where e.id = any(invalid_ids)
  );

  update public.user_cost_configs c
  set engines = coalesce((
    select jsonb_object_agg(k, v) from jsonb_each(c.engines) as costs(k, v) where k <> all(invalid_ids)
  ), '{}'::jsonb)
  where c.engines ?| invalid_ids;

  update public.system_settings s
  set settings = jsonb_set(s.settings, '{engines}', coalesce((
    select jsonb_object_agg(k, v) from jsonb_each(coalesce(s.settings->'engines', '{}'::jsonb)) as costs(k, v) where k <> all(invalid_ids)
  ), '{}'::jsonb), true)
  where coalesce(s.settings->'engines', '{}'::jsonb) ?| invalid_ids;

  update public.tournaments t
  set cost_config = jsonb_set(t.cost_config, '{engines}', coalesce((
    select jsonb_object_agg(k, v) from jsonb_each(coalesce(t.cost_config->'engines', '{}'::jsonb)) as costs(k, v) where k <> all(invalid_ids)
  ), '{}'::jsonb), true)
  where coalesce(t.cost_config->'engines', '{}'::jsonb) ?| invalid_ids;

  delete from public.tournament_costs where item_kind = 'w_engine' and item_id = any(invalid_ids);
  delete from public.w_engine_agent_modifiers where w_engine_id = any(invalid_ids);
end;
$$;
