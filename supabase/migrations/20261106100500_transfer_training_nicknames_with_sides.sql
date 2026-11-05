-- In training drafts both authenticated room slots belong to the trainer. Track
-- which displayed side represents the selected opponent so names follow roster swaps.
alter table public.draft_rooms
  add column if not exists training_sides_swapped boolean not null default false;

create or replace function public.swap_draft_sides_as_judge(p_token text)
returns public.draft_rooms
language plpgsql
security definer
set search_path = pg_catalog, extensions, public
as $$
declare
  link_row public.draft_room_judge_links%rowtype;
  r public.draft_rooms%rowtype;
  actor uuid := auth.uid();
  result public.draft_rooms%rowtype;
begin
  if actor is null then raise exception 'Войди в аккаунт, чтобы судить матч.'; end if;
  select * into link_row
  from public.draft_room_judge_links
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if not found then raise exception 'Ссылка судьи недействительна или отозвана.'; end if;

  select * into r from public.draft_rooms where id = link_row.room_id for update;
  if not found then raise exception 'Комната не найдена.'; end if;
  if r.status <> 'active' then raise exception 'Поменять стороны можно только во время активного драфта.'; end if;

  update public.draft_rooms
  set player_one_id = r.player_two_id,
      player_two_id = r.player_one_id,
      roster_one = r.roster_two,
      roster_two = r.roster_one,
      roster_snapshot_one = r.roster_snapshot_two,
      roster_snapshot_two = r.roster_snapshot_one,
      player_one_ready = r.player_two_ready,
      player_two_ready = r.player_one_ready,
      actions = coalesce((
        select jsonb_agg(
          jsonb_set(a, '{side}', to_jsonb(case when a->>'side' = 'I1' then 'I2' else 'I1' end))
          order by (a->>'step_index')::integer
        )
        from jsonb_array_elements(r.actions) a
      ), '[]'::jsonb),
      training_sides_swapped = case when r.training_mode
        then not coalesce(r.training_sides_swapped, false)
        else coalesce(r.training_sides_swapped, false)
      end,
      revision = revision + 1,
      updated_at = now()
  where id = r.id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.swap_draft_sides_as_judge(text) from public, anon;
grant execute on function public.swap_draft_sides_as_judge(text) to authenticated;
