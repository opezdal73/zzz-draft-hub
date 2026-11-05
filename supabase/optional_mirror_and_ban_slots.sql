-- Apply once. Mirror is available only on explicit 'mirror' template stages. On that stage, player may pick from own roster or mirror an opponent pick that belongs to opponent roster.
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
  if expected_side <> p_side or (expected_action <> p_action and not (expected_action = 'mirror' and p_action in ('pick','mirror'))) then raise exception 'Действие не совпадает с текущим шагом шаблона.'; end if;
  if exists (select 1 from jsonb_array_elements(r.actions) a where a->>'agent_id' = p_agent_id) and p_action <> 'mirror' then
    raise exception 'Этот персонаж уже был выбран или забанен.';
  end if;
  roster := case when p_side = 'I1' then r.roster_one else r.roster_two end;
  if p_action = 'mirror' then
    if expected_action <> 'mirror' then raise exception 'Зеркальный пик доступен только на стадии зеркального пика в шаблоне.'; end if;
    if not exists (select 1 from jsonb_array_elements_text(case when p_side='I1' then r.roster_two else r.roster_one end) x where x=p_agent_id) then
      raise exception 'Для зеркального пика персонаж должен входить в ростер соперника.';
    end if;
    if not exists (select 1 from jsonb_array_elements(r.actions) a where a->>'action'='pick' and a->>'side' <> p_side and a->>'agent_id'=p_agent_id) then
      raise exception 'Для зеркального пика выбери персонажа, которого пикнул соперник.';
    end if;
  elsif p_action = 'ban' then
    if not exists (
      select 1 from jsonb_array_elements_text(case when p_side='I1' then r.roster_two else r.roster_one end) x where x = p_agent_id
    ) then
      raise exception 'Для бана выбери персонажа из ростера соперника или общего ростера.';
    end if;
  elsif expected_action = 'mirror' then
    if not exists (select 1 from jsonb_array_elements_text(roster) x where x = p_agent_id) then
      raise exception 'На стадии зеркального пика обычный пик должен быть из твоего ростера.';
    end if;
  elsif not exists (select 1 from jsonb_array_elements_text(r.roster_one || r.roster_two) x where x = p_agent_id) then
    raise exception 'Для пика персонаж должен входить хотя бы в один из двух ростеров.';
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

