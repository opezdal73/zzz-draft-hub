-- Разрешает администраторам видеть все онлайн-драфты и удалять любой драфт.
-- Безопасно применить один раз: политики создаются только если их ещё нет.
DROP POLICY IF EXISTS "admins can read all draft rooms" ON public.draft_rooms;
CREATE POLICY "admins can read all draft rooms"
  ON public.draft_rooms FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "admins can delete any draft room" ON public.draft_rooms;
CREATE POLICY "admins can delete any draft room"
  ON public.draft_rooms FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
