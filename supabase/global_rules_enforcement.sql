-- Global server-side draft enforcement. Apply AFTER global_rules_admin.sql,
-- online_rooms.sql and configurable_min_agents.sql. Do not rerun configurable_min_agents.sql afterward,
-- because it redefines start_draft_room and can overwrite this global-rules implementation.
create table if not exists public.draft_agent_costs (
  agent_id text primary key,
  cost integer not null check (cost >= 0),
  rank text not null check (rank in ('A','S'))
);
alter table public.draft_agent_costs enable row level security;
drop policy if exists "authenticated can read agent costs" on public.draft_agent_costs;
create policy "authenticated can read agent costs" on public.draft_agent_costs for select to authenticated using (true);
insert into public.draft_agent_costs(agent_id,cost,rank) values
('agent-anby',2,'A'),
('agent-anton',2,'A'),
('agent-ben',2,'A'),
('agent-billy',2,'A'),
('agent-corin',2,'A'),
('agent-lucy',2,'A'),
('agent-komano-manato',2,'A'),
('agent-nicole',2,'A'),
('agent-piper',2,'A'),
('agent-pulchra',2,'A'),
('agent-seth',2,'A'),
('agent-sou-kaku',2,'A'),
('agent-pan-yinhu',2,'A'),
('agent-rina',3,'S'),
('agent-alice',3,'S'),
('agent-arlecchino',3,'S'),
('agent-astra',3,'S'),
('agent-banyue',3,'S'),
('agent-burnice',3,'S'),
('agent-caesar',3,'S'),
('agent-cissia',3,'S'),
('agent-dialyn',3,'S'),
('agent-ellen',3,'S'),
('agent-evelyn',3,'S'),
('agent-grace',3,'S'),
('agent-harumasa',3,'S'),
('agent-hugo',3,'S'),
('agent-jane',3,'S'),
('agent-ju-fufu',3,'S'),
('agent-koleda',3,'S'),
('agent-lighter',3,'S'),
('agent-lucia',3,'S'),
('agent-miyabi',3,'S'),
('agent-nangong-yu',3,'S'),
('agent-nekomata',3,'S'),
('agent-norma',3,'S'),
('agent-ormare',3,'S'),
('agent-phoenix',3,'S'),
('agent-promeia',3,'S'),
('agent-qingyi',3,'S'),
('agent-remielle',3,'S'),
('agent-roxy',3,'S'),
('agent-seed',3,'S'),
('agent-severian',3,'S'),
('agent-soldier-0-anby',3,'S'),
('agent-soldier-11',3,'S'),
('agent-starlight-billy',3,'S'),
('agent-sunna',3,'S'),
('agent-trigger',3,'S'),
('agent-yanagi',3,'S'),
('agent-yu-hua',3,'S'),
('agent-velina',3,'S'),
('agent-vivian',3,'S'),
('agent-lycaon',3,'S'),
('agent-ye-shunguang',3,'S'),
('agent-yidhari',3,'S'),
('agent-yixuan',3,'S'),
('agent-zhao',3,'S'),
('agent-zhu-yuan',3,'S'),
('agent-pyrois',3,'S')
on conflict (agent_id) do update set cost=excluded.cost, rank=excluded.rank;

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
  elsif p_action = 'ban' then
    if not exists (
      select 1 from jsonb_array_elements_text(case when p_side='I1' then r.roster_two else r.roster_one end) x where x = p_agent_id
    ) then
      raise exception 'Для бана выбери персонажа из ростера соперника или общего ростера.';
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

create or replace function public.start_draft_room(p_room_id uuid)
returns public.draft_rooms
language plpgsql security definer set search_path = public
as $$
declare
  r public.draft_rooms;
  updated public.draft_rooms;
  settings jsonb;
  min_agents integer := 5;
  min_cost integer := 0;
  max_cost integer := 999;
  cost_per_ban integer := 3;
  cost_one integer := 0;
  cost_two integer := 0;
  extra_bans integer := 0;
  cheaper_side text;
  extra_steps jsonb := '[]'::jsonb;
  i integer;
begin
  if auth.uid() is null then raise exception 'Сначала войди в аккаунт.'; end if;
  select * into r from public.draft_rooms where id=p_room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.host_id <> auth.uid() then raise exception 'Начать драфт может только создатель комнаты.'; end if;
  if r.status <> 'ready' or r.player_two_id is null or jsonb_array_length(r.roster_one)=0 or jsonb_array_length(r.roster_two)=0 then
    raise exception 'Оба игрока должны присоединиться и сохранить составы.';
  end if;
  select ss.settings into settings from public.system_settings ss where ss.id='global_rules';
  min_agents := coalesce((settings->>'min_agents')::integer,5);
  min_cost := coalesce((settings->>'min_roster_cost')::integer,0);
  max_cost := coalesce((settings->>'max_roster_cost')::integer,999);
  cost_per_ban := greatest(1,coalesce((settings->>'cost_difference_per_preban')::integer,3));
  if jsonb_array_length(r.roster_one)<min_agents or jsonb_array_length(r.roster_two)<min_agents then
    raise exception 'Оба ростера должны содержать минимум % персонажей.', min_agents;
  end if;
  select coalesce(sum(c.cost),0) into cost_one from jsonb_array_elements_text(r.roster_one) a(id) left join public.draft_agent_costs c on c.agent_id=a.id;
  select coalesce(sum(c.cost),0) into cost_two from jsonb_array_elements_text(r.roster_two) a(id) left join public.draft_agent_costs c on c.agent_id=a.id;
  if cost_one < min_cost or cost_one > max_cost then raise exception 'Стоимость ростера игрока 1 (%) вне диапазона %–%.',cost_one,min_cost,max_cost; end if;
  if cost_two < min_cost or cost_two > max_cost then raise exception 'Стоимость ростера игрока 2 (%) вне диапазона %–%.',cost_two,min_cost,max_cost; end if;
  if cost_one < cost_two then cheaper_side := 'I1'; extra_bans := floor((cost_two-cost_one)::numeric/cost_per_ban)::integer;
  elsif cost_two < cost_one then cheaper_side := 'I2'; extra_bans := floor((cost_one-cost_two)::numeric/cost_per_ban)::integer;
  end if;
  for i in 1..extra_bans loop
    extra_steps := extra_steps || jsonb_build_array(jsonb_build_object('side',cheaper_side,'action','ban','count',1,'label','Дополнительный бан'));
  end loop;
  update public.draft_rooms set status='active',current_step=0,actions='[]'::jsonb,
    template_snapshot=extra_steps || coalesce(template_snapshot,'[]'::jsonb),revision=revision+1,updated_at=now()
  where id=p_room_id returning * into updated;
  return updated;
end;
$$;
revoke all on function public.start_draft_room(uuid) from public;
grant execute on function public.start_draft_room(uuid) to authenticated;
