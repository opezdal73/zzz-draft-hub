-- Per-copy amplifier awakening ranks in a player's account inventory.
-- Apply once in Supabase SQL Editor. Existing account inventory is preserved;
-- the client fills missing levels with the rank defaults (A-rank R5, S-rank R1).

alter table public.player_account_inventory
  add column if not exists w_engine_levels jsonb not null default '{}'::jsonb;

alter table public.player_account_inventory
  drop constraint if exists player_account_inventory_w_engine_levels_object;

alter table public.player_account_inventory
  add constraint player_account_inventory_w_engine_levels_object
  check (jsonb_typeof(w_engine_levels) = 'object');
