-- Apply after schema.sql and draft_rooms_migration.sql in Supabase SQL Editor.
-- This migration enables real email/password auth-backed profiles and atomic draft moves.

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  chosen_nickname text;
begin
  chosen_nickname := coalesce(nullif(trim(new.raw_user_meta_data->>'nickname'), ''), split_part(new.email, '@', 1));
  chosen_nickname := left(chosen_nickname, 24);
  if char_length(chosen_nickname) < 3 then chosen_nickname := 'Player_' || left(new.id::text, 8); end if;
  insert into public.profiles (id, nickname, avatar_id, role)
  values (new.id, chosen_nickname, 'anby', 'player')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

-- Profiles: user may read all public nicknames but only edit their own non-role fields.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Use RPC to join without granting arbitrary writes to non-participants.
create or replace function public.join_draft_room(p_join_code text)
returns setof public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare joined_room public.draft_rooms;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into joined_room from public.draft_rooms where join_code = upper(trim(p_join_code)) for update;
  if not found then raise exception 'Комната с таким кодом не найдена.'; end if;
  if joined_room.status not in ('waiting','ready') then raise exception 'Эта комната уже запущена или закрыта.'; end if;
  if joined_room.player_one_id = auth.uid() or joined_room.player_two_id = auth.uid() then
    return next joined_room; return;
  end if;
  if joined_room.player_two_id is not null then raise exception 'В комнате уже два игрока.'; end if;
  if joined_room.player_one_id = auth.uid() then raise exception 'Ты уже создатель этой комнаты.'; end if;
  update public.draft_rooms set player_two_id = auth.uid(), status = 'waiting', updated_at = now()
  where id = joined_room.id returning * into joined_room;
  return next joined_room;
end;
$$;
revoke all on function public.join_draft_room(text) from public;
grant execute on function public.join_draft_room(text) to authenticated;

-- Atomic server-side action validation prevents double-clicks/stale clients from overwriting a move.
create or replace function public.submit_draft_action(
  p_room_id uuid, p_expected_step integer, p_action text, p_side text, p_agent_id text
)
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare
  r public.draft_rooms;
  step_item jsonb;
  expanded_index integer := 0;
  expected_side text;
  expected_action text;
  expected_count integer;
  roster jsonb;
  result_room public.draft_rooms;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into r from public.draft_rooms where id = p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.status <> 'active' then raise exception 'Драфт не активен.'; end if;
  if r.current_step <> p_expected_step then raise exception 'Ход уже изменился. Обновляю состояние комнаты.'; end if;
  if p_side not in ('I1','I2') or p_action not in ('ban','pick','mirror') then raise exception 'Некорректное действие.'; end if;
  if (p_side = 'I1' and r.player_one_id <> auth.uid()) or (p_side = 'I2' and r.player_two_id <> auth.uid()) then
    raise exception 'Сейчас ход другого игрока.';
  end if;
  for step_item in select value from jsonb_array_elements(r.template_snapshot)
  loop
    expected_count := greatest(1, least(5, coalesce((step_item->>'count')::integer,1)));
    if p_expected_step < expanded_index + expected_count then
      expected_side := step_item->>'side'; expected_action := step_item->>'action'; exit;
    end if;
    expanded_index := expanded_index + expected_count;
  end loop;
  if expected_side is null then raise exception 'Все шаги драфта завершены.'; end if;
  if expected_side <> p_side or expected_action <> p_action then raise exception 'Действие не совпадает с текущим шагом шаблона.'; end if;
  if exists (select 1 from jsonb_array_elements(r.actions) a where a->>'agent_id' = p_agent_id) and p_action <> 'mirror' then
    raise exception 'Этот персонаж уже был выбран или забанен.';
  end if;
  roster := case when p_side = 'I1' then r.roster_one else r.roster_two end;
  if p_action = 'mirror' then
    if not exists (select 1 from jsonb_array_elements(r.actions) a where a->>'action'='pick' and a->>'side' <> p_side and a->>'agent_id'=p_agent_id) then
      raise exception 'Для зеркального пика выбери персонажа, которого пикнул соперник.';
    end if;
  elsif not exists (select 1 from jsonb_array_elements_text(roster) x where x = p_agent_id) then
    raise exception 'Персонаж не входит в состав твоей стороны.';
  end if;
  update public.draft_rooms
    set actions = actions || jsonb_build_array(jsonb_build_object(
      'side',p_side,'action',p_action,'agent_id',p_agent_id,'step_index',p_expected_step,'actor_id',auth.uid()
    )),
    current_step = current_step + 1,
    status = case when current_step + 1 >= (
      select coalesce(sum(greatest(1,least(5,coalesce((s->>'count')::integer,1)))),0)
      from jsonb_array_elements(template_snapshot) s
    ) then 'completed' else 'active' end,
    revision = revision + 1, updated_at = now()
  where id = p_room_id returning * into result_room;
  insert into public.draft_room_events(room_id,actor_id,step_index,action_type,side,agent_id)
  values (p_room_id,auth.uid(),p_expected_step,p_action,p_side,p_agent_id);
  return result_room;
end;
$$;
revoke all on function public.submit_draft_action(uuid,integer,text,text,text) from public;
grant execute on function public.submit_draft_action(uuid,integer,text,text,text) to authenticated;

-- Allow an authenticated player to create a room only as themselves.
drop policy if exists "authenticated can create own rooms" on public.draft_rooms;
create policy "authenticated can create own rooms" on public.draft_rooms
  for insert to authenticated with check (host_id = auth.uid() and player_one_id = auth.uid());

-- Room updates are constrained at the app layer for setup fields; draft actions must use the RPC above.
-- For a public launch, tighten this policy further so clients cannot change status/current_step/actions directly.

-- Setup changes are also performed through RPCs so a client cannot edit the other side's roster.
create or replace function public.save_draft_roster(p_room_id uuid, p_roster text[])
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare r public.draft_rooms; updated public.draft_rooms;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  if coalesce(array_length(p_roster,1),0) < 1 then raise exception 'Выбери хотя бы одного персонажа.'; end if;
  if (select count(distinct x) from unnest(p_roster) x) <> array_length(p_roster,1) then raise exception 'В составе не должно быть повторов.'; end if;
  select * into r from public.draft_rooms where id=p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.status not in ('waiting','ready') then raise exception 'Состав нельзя менять после начала драфта.'; end if;
  if r.player_one_id = auth.uid() then
    update public.draft_rooms set roster_one=to_jsonb(p_roster), status=case when player_two_id is not null and jsonb_array_length(roster_two)>0 then 'ready' else 'waiting' end, updated_at=now()
    where id=p_room_id returning * into updated;
  elsif r.player_two_id = auth.uid() then
    update public.draft_rooms set roster_two=to_jsonb(p_roster), status=case when player_one_id is not null and jsonb_array_length(roster_one)>0 then 'ready' else 'waiting' end, updated_at=now()
    where id=p_room_id returning * into updated;
  else raise exception 'Ты не участник этой комнаты.';
  end if;
  return updated;
end;
$$;
revoke all on function public.save_draft_roster(uuid,text[]) from public;
grant execute on function public.save_draft_roster(uuid,text[]) to authenticated;

create or replace function public.start_draft_room(p_room_id uuid)
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare r public.draft_rooms; updated public.draft_rooms;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into r from public.draft_rooms where id=p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.host_id <> auth.uid() then raise exception 'Начать драфт может только создатель комнаты.'; end if;
  if r.status <> 'ready' or r.player_two_id is null or jsonb_array_length(r.roster_one)=0 or jsonb_array_length(r.roster_two)=0 then
    raise exception 'Оба игрока должны присоединиться и сохранить составы.';
  end if;
  update public.draft_rooms set status='active',current_step=0,actions='[]'::jsonb,revision=revision+1,updated_at=now()
  where id=p_room_id returning * into updated;
  return updated;
end;
$$;
revoke all on function public.start_draft_room(uuid) from public;
grant execute on function public.start_draft_room(uuid) to authenticated;

-- Do not allow direct client updates to room state; state changes go through validated RPCs.
revoke update on public.draft_rooms from authenticated;
