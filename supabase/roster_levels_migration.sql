-- Adds selected upgrade levels to personal rosters. Safe to run more than once.
alter table public.player_rosters
  add column if not exists agent_levels jsonb not null default '{}'::jsonb,
  add column if not exists w_engine_levels jsonb not null default '{}'::jsonb;

alter table public.player_rosters
  drop constraint if exists player_rosters_agent_levels_object,
  drop constraint if exists player_rosters_w_engine_levels_object;
alter table public.player_rosters
  add constraint player_rosters_agent_levels_object check (jsonb_typeof(agent_levels) = 'object'),
  add constraint player_rosters_w_engine_levels_object check (jsonb_typeof(w_engine_levels) = 'object');
