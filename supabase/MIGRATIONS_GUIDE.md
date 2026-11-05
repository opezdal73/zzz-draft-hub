# Supabase migration inventory and safe order

## Current database status

The connected project already has the application schema and live data. Its Supabase migration history was empty during this review, which means the historical SQL was applied outside Supabase's tracked migration flow. Do not replay the root-level files against that live database as a batch.

Root-level `*.sql` files are the project's historical, manually applied patches. Keep them as the audit trail. New tracked migrations belong in `supabase/migrations/` and should be applied once through Supabase MCP or the Supabase CLI. A timestamped migration file is the source of truth for each new database change.

## Recommended dependency order for a fresh database

This is a dependency map, not an instruction to run the entire list against an existing project.

1. **Base schema and online rooms**
   `schema.sql` → `draft_rooms_migration.sql` → `online_rooms.sql`.
2. **Personal rosters and draft validation**
   `player_rosters_migration.sql` → `roster_levels_migration.sql` → `online_saved_rosters.sql` → `configurable_min_agents.sql` → `roster_agent_limit_migration.sql` → `global_rules_admin.sql` → `global_rules_enforcement.sql` → `optional_mirror_and_ban_slots.sql` → `draft_roster_rules_fix.sql` → `draft_roster_integrity_fix.sql`.
3. **Shared costs and account inventory**
   `user_cost_configs_and_super_admin.sql` → `shared_cost_config.sql`; `cost_manager_global_rules.sql` follows `global_rules_admin.sql`. Inventory chain: `player_account_inventory.sql` → `player_account_inventory_levels.sql` → `player_account_inventory_weapon_copies.sql`.
4. **Tournament data**
   Apply `community_tournaments.sql` before `tournament_registration_requests.sql`, then `tournament_registration_rosters.sql` and `tournament_shared_state_realtime.sql`. The separate cloud-tournament tables come from `tournament_rosters_migration.sql`.
5. **Tournament draft rooms**
   `tournament_draft_rooms.sql` depends on `configurable_min_agents.sql`, `online_saved_rosters.sql`, and `tournament_registration_rosters.sql`; then apply `tournament_ready_checkin.sql` and `notifications_and_activity_log.sql`.
6. **BO2**
   `bo2_match_series.sql` → `bo2_second_draft.sql` → `bo2_second_game_side_rotation.sql` → `bo2_second_game_ready.sql` → `bo2_squads_and_timer_fix.sql` → `bo2_single_room_transition.sql`.
7. **Judge controls**
   `judge_tools_and_turn_timers.sql` → `judge_in_room_controls.sql` → `judge_series_room_id_ambiguity_fix.sql` → `judge_bo2_without_timers.sql`. `judge_crypto_search_path_fix.sql` is an older repair; the later judge definitions already set the extension search path.
8. **Optional admin setup**
   `admin_profile_roles.sql`, `admin_delete_drafts.sql`, and `global_draft_template.sql` are separate setup steps. `promote_owner_to_admin.sql` is a one-account operation; review and substitute the intended account before running it.

Some historical scripts depend on the product state at the time they were written. Use this ordering as a guide and inspect the target schema before preparing a new clean-install baseline.

## Superseded definitions: do not apply out of order

Several files replace the same PostgreSQL functions. PostgreSQL keeps only the last definition executed, so running an older file later can silently restore old behavior.

| Object | Historical definitions | Current source in the saved chain |
|---|---|---|
| `start_draft_room` | `online_rooms.sql`, `configurable_min_agents.sql`, `global_rules_enforcement.sql`, `draft_roster_rules_fix.sql` | `draft_roster_rules_fix.sql` |
| `submit_draft_action` | `online_rooms.sql`, `optional_mirror_and_ban_slots.sql`, `global_rules_enforcement.sql`, `draft_roster_rules_fix.sql`, `draft_roster_integrity_fix.sql` | `draft_roster_integrity_fix.sql` |
| `save_draft_roster` | `online_rooms.sql`, `roster_agent_limit_migration.sql`, `draft_roster_integrity_fix.sql` | `draft_roster_integrity_fix.sql` |
| `select_saved_roster_for_draft` | `online_saved_rosters.sql`, `configurable_min_agents.sql`, `roster_agent_limit_migration.sql`, `draft_roster_integrity_fix.sql` | `draft_roster_integrity_fix.sql` |
| `create_tournament_draft_room` | `tournament_draft_rooms.sql`, `draft_roster_rules_fix.sql`, `draft_roster_integrity_fix.sql` | `draft_roster_integrity_fix.sql` |
| `create_bo2_second_draft` / BO2 guard | `bo2_match_series.sql`, `bo2_second_*`, `draft_roster_integrity_fix.sql`, `bo2_squads_and_timer_fix.sql`, `bo2_single_room_transition.sql`, `judge_bo2_without_timers.sql` | `bo2_single_room_transition.sql`, finally overridden for judge no-timer behavior by `judge_bo2_without_timers.sql` |
| `control_draft_room_as_judge` | `judge_tools_and_turn_timers.sql` | `judge_bo2_without_timers.sql` |
| `read_match_series_as_judge` | `judge_in_room_controls.sql` | `judge_series_room_id_ambiguity_fix.sql` |

The old separate-room BO2 files are still useful as history, but the active design reuses one room through `bo2_single_room_transition.sql`.

## Findings from the live project review

- The root folder contains multiple generations of function replacements rather than one ordered migration stream.
- At the start of this review, the live database had no recorded migration history; the hardening migration below is now recorded, but older schema drift cannot be reconstructed just by comparing filenames.
- The grant migration removes `anon` execution from the reviewed client RPCs and internal helpers. The Security Advisor still flags 16 `SECURITY DEFINER` functions available to authenticated users; these are application RPCs and judge controls that need a separate per-function authorization review before any access is removed. It also reports four mutable search paths, an RLS-enabled judge-token table with no direct policies (its access is through RPCs), and overlapping permissive policies.
- Performance Advisor reports RLS predicates that re-evaluate `auth.uid()` per row and overlapping policies. These are optimization opportunities; combine policies only after preserving each role's exact access rules.
- One unused index was reported on `online_tournaments.created_by`. It is not removed automatically; the table may still be too small for reliable usage statistics.

The grant-hardening migration was applied to the connected database and is recorded as version `20261105123302` (`restrict_security_definer_grants`). Its local source is `supabase/migrations/20261105123302_restrict_security_definer_grants.sql`. Verification confirmed authenticated access remains enabled for the user-facing RPCs, anonymous access is disabled, and the inspected database triggers remain attached.

The room-owner cleanup policy is now superseded by `host_delete_unfinished_friendly_rooms`, recorded in Supabase as version `20261105124417`. It permits a creator to delete their own unfinished friendly room, including after an opponent joins or draft actions start; tournament rooms remain excluded. The active source is `supabase/migrations/20261105124417_host_delete_unfinished_friendly_rooms.sql`.

The BO2 ready-transition repair is recorded as version `20261105175543` (`fix_bo2_game2_ready_transition`). It replaces the stale live guard that left series stuck at `squads2` after both players confirmed their second-game squads, and advances affected ready series to `game2`. Its local source is `supabase/migrations/20261105175543_fix_bo2_game2_ready_transition.sql`.

## Safe workflow from now on

1. Read the live table, function, trigger, and policy definitions before changing behavior.
2. Add one timestamped SQL file under `supabase/migrations/` with a unique name and an explicit purpose.
3. Prefer additive, reversible changes. Keep table/row data intact and preserve RPC signatures used by the app.
4. Apply it once through the connected Supabase migration tool; do not also paste the same SQL into the Dashboard.
5. Verify the migration record, relevant function/table state, and Security/Performance Advisor results.
6. Never rerun a root-level historical file after its final replacement has been applied.

