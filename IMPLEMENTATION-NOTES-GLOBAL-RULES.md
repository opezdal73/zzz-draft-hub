# ZZZ Draft Hub — global rules enforcement

## New migration
`supabase/global_rules_enforcement.sql` adds server-side roster-cost validation and dynamic extra bans.

Apply it ONCE in Supabase SQL Editor after the earlier migrations: `global_rules_admin.sql`, `online_rooms.sql`, `online_saved_rosters.sql`, and `configurable_min_agents.sql`.

It creates `draft_agent_costs` with current app base costs (A-rank=2, S-rank=3), validates saved roster snapshots against global minimum agent count and cost range, prepends the correct number of extra-ban steps when a draft starts, and validates ban/pick availability in the server RPC. The cheaper roster chooses the extra bans; each extra ban is a normal ban action and bans are valid only for agents in the union of both rosters. Banned agents become unavailable to both sides because the action is recorded globally.

## Important
- If character costs are changed in `src/data.ts`, update `draft_agent_costs` in Supabase too, otherwise the server cost rules will use stale costs.
- Existing rooms are not rewritten; create a new room to test the new rules.
- Run the migration only after the prerequisite migrations are present. Keep a backup before production changes.
