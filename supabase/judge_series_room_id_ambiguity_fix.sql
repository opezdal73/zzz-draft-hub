-- Fixes the judge BO2 loader variable/column name collision.
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
    values (v_room_id, 'squads', '[]'::jsonb, '[]'::jsonb, false, false)
    on conflict (room_id) do nothing;
  select s.* into result from public.draft_match_series as s where s.room_id=v_room_id;
  return result;
end;
$$;
revoke all on function public.read_match_series_as_judge(text) from public;
grant execute on function public.read_match_series_as_judge(text) to authenticated;
