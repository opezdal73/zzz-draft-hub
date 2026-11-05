-- Глобальный шаблон драфта для всех новых онлайн-комнат.
-- Выполнить один раз в Supabase SQL Editor. Не удаляет существующие таблицы или данные.
CREATE TABLE IF NOT EXISTS public.global_draft_template (
  id integer PRIMARY KEY CHECK (id = 1),
  template jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.global_draft_template ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read global draft template" ON public.global_draft_template;
CREATE POLICY "Anyone can read global draft template"
  ON public.global_draft_template FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can insert global draft template" ON public.global_draft_template;
CREATE POLICY "Admins can insert global draft template"
  ON public.global_draft_template FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ));

DROP POLICY IF EXISTS "Admins can update global draft template" ON public.global_draft_template;
CREATE POLICY "Admins can update global draft template"
  ON public.global_draft_template FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ));

GRANT SELECT, INSERT, UPDATE ON public.global_draft_template TO authenticated;
