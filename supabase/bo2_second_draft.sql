-- Separate second-game draft room for BO2.
-- Run after bo2_match_series.sql and draft_rooms_migration.sql.

ALTER TABLE public.draft_rooms
  ADD COLUMN IF NOT EXISTS bo2_parent_room_id uuid REFERENCES public.draft_rooms(id) ON DELETE CASCADE;
ALTER TABLE public.draft_rooms
  ADD COLUMN IF NOT EXISTS bo2_game_number integer NOT NULL DEFAULT 1 CHECK (bo2_game_number IN (1,2));
CREATE INDEX IF NOT EXISTS draft_rooms_bo2_parent_idx ON public.draft_rooms(bo2_parent_room_id);

-- Shared pointer lets both clients discover and open the same second-game room.
ALTER TABLE public.draft_match_series
  ADD COLUMN IF NOT EXISTS second_room_id uuid REFERENCES public.draft_rooms(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.create_bo2_second_draft(p_room_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  root public.draft_rooms%ROWTYPE;
  series_row public.draft_match_series%ROWTYPE;
  new_id uuid;
  new_code text;
BEGIN
  SELECT * INTO root FROM public.draft_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Исходная комната не найдена.'; END IF;

  -- Only the room host may start game 2; do not rely on the UI button alone.
  IF auth.uid() IS NULL OR auth.uid() <> root.host_id THEN
    RAISE EXCEPTION 'Только создатель комнаты может начать вторую игру.';
  END IF;
  IF root.bo2_parent_room_id IS NOT NULL THEN
    RAISE EXCEPTION 'Вызови создание второй игры из исходной комнаты.';
  END IF;
  IF root.status <> 'completed' THEN
    RAISE EXCEPTION 'Первый драфт должен быть завершён.';
  END IF;

  SELECT * INTO series_row FROM public.draft_match_series WHERE room_id = root.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Данные BO2 не найдены.'; END IF;
  IF series_row.game1_timer_one IS NULL OR series_row.game1_timer_two IS NULL THEN
    RAISE EXCEPTION 'Сначала сохраните таймеры обоих игроков первой игры.';
  END IF;

  -- Idempotency: reuse an existing room and repair the shared pointer if needed.
  IF series_row.second_room_id IS NOT NULL THEN
    SELECT id INTO new_id FROM public.draft_rooms
    WHERE id = series_row.second_room_id AND bo2_parent_room_id = root.id AND bo2_game_number = 2;
    IF new_id IS NOT NULL THEN RETURN new_id; END IF;
  END IF;
  SELECT id INTO new_id FROM public.draft_rooms
  WHERE bo2_parent_room_id = root.id AND bo2_game_number = 2
  ORDER BY created_at NULLS LAST LIMIT 1;
  IF new_id IS NOT NULL THEN
    UPDATE public.draft_match_series
    SET second_room_id = new_id, phase = 'game2', updated_at = now()
    WHERE room_id = root.id;
    RETURN new_id;
  END IF;
  IF series_row.phase IN ('game2','completed') THEN
    RAISE EXCEPTION 'Вторая игра уже отмечена начатой, но её комната не найдена.';
  END IF;
  IF series_row.phase <> 'game1' THEN
    RAISE EXCEPTION 'Сначала завершите подготовку первой игры.';
  END IF;

  -- Avoid pgcrypto dependency: generate a short code using built-in PostgreSQL functions.
  new_code := upper(substr(md5(random()::text || clock_timestamp()::text || root.id::text), 1, 6));
  INSERT INTO public.draft_rooms(
    join_code, title, host_id, player_one_id, player_two_id, template_id, template_snapshot, status,
    roster_one, roster_two, actions, current_step, revision, min_agents, bo2_parent_room_id, bo2_game_number
  ) VALUES (
    new_code, left(root.title || ' · Игра 2', 80), root.host_id, root.player_two_id, root.player_one_id,
    root.template_id,
    (SELECT jsonb_agg(
      CASE
        WHEN item->>'side' = 'I1' THEN jsonb_set(item, '{side}', '"I2"'::jsonb)
        WHEN item->>'side' = 'I2' THEN jsonb_set(item, '{side}', '"I1"'::jsonb)
        ELSE item
      END ORDER BY ord
    ) FROM jsonb_array_elements(root.template_snapshot) WITH ORDINALITY AS x(item, ord)),
    'ready', root.roster_two, root.roster_one,
    '[]'::jsonb, 0, 0, root.min_agents, root.id, 2
  ) RETURNING id INTO new_id;

  UPDATE public.draft_match_series
  SET phase = 'game2', second_room_id = new_id, updated_at = now()
  WHERE room_id = root.id;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bo2_second_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_bo2_second_draft(uuid) TO authenticated;
