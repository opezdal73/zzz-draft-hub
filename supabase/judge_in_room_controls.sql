-- Judge controls inside the draft room: draft moves, BO2 data entry and side swap.
-- Apply after judge_tools_and_turn_timers.sql and bo2_single_room_transition.sql.

create or replace function public.submit_draft_action_as_judge(
  p_token text, p_expected_step integer, p_action text, p_side text, p_agent_id text
)
returns public.draft_rooms
language plpgsql security definer set search_path = pg_catalog, extensions, public
as $$
declare link_row public.draft_room_judge_links%rowtype; r public.draft_rooms%rowtype; actor uuid := auth.uid(); result public.draft_rooms%rowtype;
begin
  if actor is null then raise exception 'Войди в аккаунт, чтобы судить матч.'; end if;
  select * into link_row from public.draft_room_judge_links
    where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if not found then raise exception 'Ссылка судьи недействительна или отозвана.'; end if;
  select * into r from public.draft_rooms where id = link_row.room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.is_paused then raise exception 'Драфт на паузе. Сначала продолжите матч.'; end if;
  if p_side not in ('I1','I2') then raise exception 'Некорректная сторона хода.'; end if;
  perform set_config('app.judge_control', 'on', true);
  perform set_config('request.jwt.claim.sub', case when p_side='I1' then r.player_one_id::text else r.player_two_id::text end, true);
  result := public.submit_draft_action(r.id, p_expected_step, p_action, p_side, p_agent_id);
  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('app.judge_control', '', true);
  return result;
exception when others then
  perform set_config('request.jwt.claim.sub', coalesce(actor::text, ''), true);
  perform set_config('app.judge_control', '', true);
  raise;
end;
$$;
revoke all on function public.submit_draft_action_as_judge(text,integer,text,text,text) from public;
grant execute on function public.submit_draft_action_as_judge(text,integer,text,text,text) to authenticated;

create or replace function public.read_match_series_as_judge(p_token text)
returns public.draft_match_series
language plpgsql security definer set search_path = pg_catalog, extensions, public
as $$
declare result public.draft_match_series%rowtype; v_room_id uuid;
begin
  if auth.uid() is null then raise exception 'Войди в аккаунт, чтобы открыть матч.'; end if;
  select j.room_id into v_room_id from public.draft_room_judge_links j
    where j.token_hash=encode(digest(p_token,'sha256'),'hex') and j.revoked_at is null;
  if not found then raise exception 'Ссылка судьи недействительна.'; end if;
  insert into public.draft_match_series(room_id, phase, squad_one, squad_two, ready_one, ready_two)
    values (v_room_id, 'squads', '[]'::jsonb, '[]'::jsonb, false, false) on conflict (room_id) do nothing;
  select s.* into result from public.draft_match_series as s where s.room_id=v_room_id;
  return result;
end;
$$;
revoke all on function public.read_match_series_as_judge(text) from public;
grant execute on function public.read_match_series_as_judge(text) to authenticated;

create or replace function public.update_match_series_as_judge(p_token text, p_field text, p_value jsonb)
returns public.draft_match_series
language plpgsql security definer set search_path = pg_catalog, extensions, public
as $$
declare
  link_row public.draft_room_judge_links%rowtype; r public.draft_rooms%rowtype;
  s public.draft_match_series%rowtype; owner_id uuid; stmt text; actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Войди в аккаунт, чтобы судить матч.'; end if;
  select * into link_row from public.draft_room_judge_links where token_hash=encode(digest(p_token,'sha256'),'hex') and revoked_at is null;
  if not found then raise exception 'Ссылка судьи недействительна или отозвана.'; end if;
  select * into r from public.draft_rooms where id=link_row.room_id;
  select * into s from public.draft_match_series where room_id=link_row.room_id for update;
  if not found then raise exception 'Данные матча BO2 не найдены.'; end if;
  if p_field not in ('squad_one','squad_two','ready_one','ready_two','game2_squad_one','game2_squad_two','game2_squads_ready_one','game2_squads_ready_two','game1_timer_one','game1_timer_two','game2_timer_one','game2_timer_two','game1_restarts_one','game1_restarts_two','game2_restarts_one','game2_restarts_two','phase','game2_ready_one','game2_ready_two') then
    raise exception 'Это поле нельзя менять через режим судьи.';
  end if;
  if p_field like '%_one' then owner_id := s.player_one_id; else owner_id := s.player_two_id; end if;
  if p_field='phase' then owner_id := s.player_one_id; end if;
  if p_field like '%timer%' and (p_value is null or jsonb_typeof(p_value)='null') then
    -- Clearing a timer is allowed for a judge to correct a mistaken entry.
    null;
  elsif p_field like '%timer%' and (jsonb_typeof(p_value)<>'number' or (p_value #>> '{}')::integer < 0 or (p_value #>> '{}')::integer > 600) then
    raise exception 'Таймер должен быть от 0:00 до 10:00.';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if p_field in ('squad_one','squad_two','game2_squad_one','game2_squad_two') then
    stmt := format('update public.draft_match_series set %I=$1, updated_at=now() where room_id=$2 returning *',p_field);
    execute stmt into s using coalesce(p_value,'[]'::jsonb), link_row.room_id;
  elsif p_field like '%timer%' then
    stmt := format('update public.draft_match_series set %I=case when jsonb_typeof($1)=''null'' then null else ($1 #>> ''{}'')::integer end, updated_at=now() where room_id=$2 returning *',p_field);
    execute stmt into s using p_value, link_row.room_id;
  elsif p_field='phase' then
    if p_value #>> '{}' not in ('game1','game2','completed') then raise exception 'Недопустимая фаза матча.'; end if;
    update public.draft_match_series set phase=p_value #>> '{}', updated_at=now() where room_id=link_row.room_id returning * into s;
  elsif p_field like '%restarts%' then
    stmt := format('update public.draft_match_series set %I=greatest(0,least(5,($1 #>> ''{}'')::integer)), updated_at=now() where room_id=$2 returning *',p_field);
    execute stmt into s using p_value, link_row.room_id;
  else
    stmt := format('update public.draft_match_series set %I=($1 #>> ''{}'')::boolean, updated_at=now() where room_id=$2 returning *',p_field);
    execute stmt into s using p_value, link_row.room_id;
  end if;
  perform set_config('request.jwt.claim.sub', actor::text, true);
  return s;
exception when others then
  perform set_config('request.jwt.claim.sub', coalesce(actor::text, ''), true);
  raise;
end;
$$;
revoke all on function public.update_match_series_as_judge(text,text,jsonb) from public;
grant execute on function public.update_match_series_as_judge(text,text,jsonb) to authenticated;

create or replace function public.swap_draft_sides_as_judge(p_token text)
returns public.draft_rooms
language plpgsql security definer set search_path = pg_catalog, extensions, public
as $$
declare link_row public.draft_room_judge_links%rowtype; r public.draft_rooms%rowtype; actor uuid := auth.uid(); result public.draft_rooms%rowtype;
begin
  if actor is null then raise exception 'Войди в аккаунт, чтобы судить матч.'; end if;
  select * into link_row from public.draft_room_judge_links where token_hash=encode(digest(p_token,'sha256'),'hex') and revoked_at is null;
  if not found then raise exception 'Ссылка судьи недействительна или отозвана.'; end if;
  select * into r from public.draft_rooms where id=link_row.room_id for update;
  if r.status <> 'active' then raise exception 'Поменять стороны можно только во время активного драфта.'; end if;
  update public.draft_rooms set player_one_id=r.player_two_id, player_two_id=r.player_one_id,
    roster_one=r.roster_two, roster_two=r.roster_one,
    roster_snapshot_one=r.roster_snapshot_two, roster_snapshot_two=r.roster_snapshot_one,
    player_one_ready=r.player_two_ready, player_two_ready=r.player_one_ready,
    actions=coalesce((select jsonb_agg(jsonb_set(a, '{side}', to_jsonb(case when a->>'side'='I1' then 'I2' else 'I1' end)) order by (a->>'step_index')::integer) from jsonb_array_elements(r.actions) a),'[]'::jsonb),
    template_snapshot=coalesce((select jsonb_agg(jsonb_set(s, '{side}', to_jsonb(case when s->>'side'='I1' then 'I2' else 'I1' end)) order by ord) from jsonb_array_elements(r.template_snapshot) with ordinality x(s,ord)),'[]'::jsonb),
    revision=revision+1, updated_at=now()
    where id=r.id returning * into result;
  return result;
end;
$$;
revoke all on function public.swap_draft_sides_as_judge(text) from public;
grant execute on function public.swap_draft_sides_as_judge(text) to authenticated;
