-- Restrict SECURITY DEFINER execution to the roles and entry points that need it.
-- Internal helpers and trigger functions are not public RPC endpoints.

-- Authenticated RLS helper. Policies call this while evaluating access rules.
revoke all on function public.current_user_is_admin() from public, anon;
grant execute on function public.current_user_is_admin() to authenticated;

-- Application RPCs: signed-in users only. Each function performs its own ownership checks.
revoke all on function public.join_draft_room(text) from public, anon;
grant execute on function public.join_draft_room(text) to authenticated;
revoke all on function public.save_draft_roster(uuid, text[]) from public, anon;
grant execute on function public.save_draft_roster(uuid, text[]) to authenticated;
revoke all on function public.select_saved_roster_for_draft(uuid, uuid) from public, anon;
grant execute on function public.select_saved_roster_for_draft(uuid, uuid) to authenticated;
revoke all on function public.start_draft_room(uuid) from public, anon;
grant execute on function public.start_draft_room(uuid) to authenticated;
revoke all on function public.submit_draft_action(uuid, integer, text, text, text) from public, anon;
grant execute on function public.submit_draft_action(uuid, integer, text, text, text) to authenticated;
revoke all on function public.set_bo2_game2_ready(uuid) from public, anon;
grant execute on function public.set_bo2_game2_ready(uuid) to authenticated;
revoke all on function public.set_tournament_player_ready(uuid) from public, anon;
grant execute on function public.set_tournament_player_ready(uuid) to authenticated;
revoke all on function public.create_tournament_draft_room(text, text, uuid, uuid, text, jsonb, integer, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_tournament_draft_room(text, text, uuid, uuid, text, jsonb, integer, uuid, jsonb, jsonb) to authenticated;

-- Judge RPCs: the user must be authenticated and possess a valid room token.
revoke all on function public.create_draft_judge_link(uuid) from public, anon;
grant execute on function public.create_draft_judge_link(uuid) to authenticated;
revoke all on function public.read_draft_room_as_judge(text) from public, anon;
grant execute on function public.read_draft_room_as_judge(text) to authenticated;
revoke all on function public.control_draft_room_as_judge(text, text) from public, anon;
grant execute on function public.control_draft_room_as_judge(text, text) to authenticated;
revoke all on function public.submit_draft_action_as_judge(text, integer, text, text, text) from public, anon;
grant execute on function public.submit_draft_action_as_judge(text, integer, text, text, text) to authenticated;
revoke all on function public.read_match_series_as_judge(text) from public, anon;
grant execute on function public.read_match_series_as_judge(text) to authenticated;
revoke all on function public.update_match_series_as_judge(text, text, jsonb) from public, anon;
grant execute on function public.update_match_series_as_judge(text, text, jsonb) to authenticated;
revoke all on function public.swap_draft_sides_as_judge(text) from public, anon;
grant execute on function public.swap_draft_sides_as_judge(text) to authenticated;

-- Internal helpers. SECURITY DEFINER callers execute these with their owner privileges.
revoke all on function public.create_bo2_second_draft(uuid) from public, anon, authenticated;
revoke all on function public.bo2_room_picks(uuid, text) from public, anon, authenticated;
revoke all on function public.roster_cost_from_snapshot(jsonb, jsonb) from public, anon, authenticated;

-- Trigger entry points must not be callable through PostgREST RPC.
revoke all on function public.apply_global_draft_timer_rules() from public, anon, authenticated;
revoke all on function public.audit_community_tournament_changes() from public, anon, authenticated;
revoke all on function public.autostart_tournament_draft() from public, anon, authenticated;
revoke all on function public.bind_bo2_series_players() from public, anon, authenticated;
revoke all on function public.capture_registration_roster() from public, anon, authenticated;
revoke all on function public.guard_bo2_game2_ready() from public, anon, authenticated;
revoke all on function public.guard_bo2_match_series() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.notify_new_tournament_matchups() from public, anon, authenticated;
revoke all on function public.notify_registration_decision() from public, anon, authenticated;
revoke all on function public.notify_tournament_room_events() from public, anon, authenticated;
revoke all on function public.prevent_self_role_change() from public, anon, authenticated;
revoke all on function public.protect_super_admin_profile() from public, anon, authenticated;
revoke all on function public.sync_global_timer_rules_to_pending_rooms() from public, anon, authenticated;
