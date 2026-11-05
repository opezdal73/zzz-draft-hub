# Tournament sync update

This update changes the tournament client to:

- subscribe to Supabase Realtime changes for tournaments and registration requests, while retaining a 10-second refresh as a fallback;
- load participant and match arrays from the shared `community_tournaments.data` JSON record;
- persist local participant/bracket changes back to the shared tournament record (debounced);
- add a “Мои матчи” view and show unresolved opponents as waiting;
- add tournament format settings for Single Elimination / Double Elimination and an optional Swiss-stage setting.

## Supabase setup

Run, in order if not already applied:
1. `supabase/community_tournaments.sql`
2. `supabase/tournament_registration_requests.sql`
3. `supabase/tournament_shared_state_realtime.sql`

Realtime updates require the tables to be included in the `supabase_realtime` publication and accessible under the existing RLS policies.

## Important implementation status

The format selectors and personal match list are present, but the current bracket-generation/result-progression logic is still the original single-elimination implementation. Double-elimination lower-bracket routing, Swiss pairing/standings, automatic per-match draft-room creation, and transactional server-side result processing still require a further implementation pass. This update should not be treated as a completed tournament-engine rewrite.

The source ZIP contained `.env.local`; it has intentionally been excluded from the distributable archive so private project configuration is not copied into the package. Restore your own `.env.local` locally from your private backup.
