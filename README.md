# ZZZ Draft Hub

React + TypeScript + Vite prototype for a Zenless Zone Zero community tournament hub.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

## Online draft setup (Supabase)

> **Migration note:** the SQL files directly under `supabase/` are historical, manually applied patches and include several superseded function definitions. Do not run them all, or rerun an older patch, against the existing live project. See [the migration inventory and safe order](supabase/MIGRATIONS_GUIDE.md) before applying SQL. New tracked migrations go in `supabase/migrations/`.

1. Create a project at https://supabase.com/dashboard.
2. Copy `.env.example` to `.env.local`.
3. Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the Supabase project API settings. Use only the public anon/publishable key in the frontend. Never put a `service_role` or secret key in frontend env variables.
4. In Supabase SQL Editor, run these files in order:
   - `supabase/schema.sql`
   - `supabase/draft_rooms_migration.sql`
   - `supabase/online_rooms.sql`
5. In Project Settings > Authentication, choose whether email confirmation should be required. For testing, this can be adjusted in Supabase Auth settings.
6. Restart Vite after changing `.env.local`.
7. Open the **Онлайн-драфт** section, register two accounts with different email addresses, create a room on one account, and join with the code on the other.

The online draft uses Supabase Auth, database persistence, Realtime room updates, and SQL RPC functions for roster saving, room start, joining, and turn validation. The room takes a snapshot of the current default sequence when created.

## Shared Cost Manager settings

After applying `supabase/global_rules_admin.sql` and `supabase/user_cost_configs_and_super_admin.sql`, run `supabase/shared_cost_config.sql` in the SQL Editor. It moves Cost Manager settings to the shared `system_settings` row `cost_config`, seeds that row from the most recently updated existing per-account config, and enables Realtime updates. Admins and Cost Managers can edit the shared values; all authenticated accounts can read them. Existing `user_cost_configs` rows are retained as a backup. Reopen or refresh the app after applying the migration if it was already open.

To let Cost Managers change global draft rules, also run `supabase/cost_manager_global_rules.sql`. The migration grants them access to the `global_rules` row only; existing administrator permissions are unchanged.

## Current limitations

- The existing tournament pages and demo profiles still use local browser storage and are not connected to Supabase auth.
- The online draft currently uses a built-in example sequence; the admin sequence editor is still browser-local and must be connected to `draft_templates` in a follow-up step.
- Agent list/costs are illustrative and incomplete. Load the verified current roster before a real tournament.
- Before public launch, review and test every RLS policy and SQL function in a non-production project. Configure account recovery, email delivery, rate limits, and moderator/admin authorization.
- This is an unofficial community project and is not affiliated with HoYoverse.

## Турнирные ростеры (новая миграция)

Файл `supabase/tournament_rosters_migration.sql` добавляет облачные турниры и сохранённые ростеры игроков отдельно для каждого турнира. Применяй его **после** основных SQL-файлов. Эта миграция не удаляет комнаты/аккаунты и не изменяет локальные демо-турниры. На этом этапе таблицы готовы для подключения интерфейса ростеров; существующие демо-страницы турниров пока не синхронизируются с облачными турнирами автоматически.


## Мои ростеры (новый интерфейс)

В боковом меню появилась страница «Мои ростеры». Она использует таблицы `online_tournaments` и `tournament_player_rosters` из `supabase/tournament_rosters_migration.sql`. Войди через тот же Supabase-аккаунт, что и в онлайн-драфте. Создай облачный турнир, выбери его, собери ростер и сохрани. Ростеры привязаны к турниру и аккаунту.

Важно: этот экран сейчас использует текущий демонстрационный список агентов и W-Engines из `src/data.ts`. Он ещё не подключён к выбору состава в комнате онлайн-драфта; это следующий этап. Старые локальные турниры в основном интерфейсе пока не переносятся автоматически в облако.


## Personal rosters (current step)

Personal rosters are independent of tournaments. In Supabase SQL Editor, run `supabase/player_rosters_migration.sql` once. This adds `player_rosters`, applies owner-only row-level security, and attempts to copy existing rows from `tournament_player_rosters` without deleting the originals. Then restart the app (`npm run dev`) and open **Мои ростеры**. Users can create, edit, duplicate, search, and delete personal rosters.

The current agent and W-Engine catalog is still the project's demo catalog. Selecting a personal roster inside online draft rooms and tournament registration is a separate next integration step.

## Ростеры: уровни агентов и амплификаторов

В версии с уровнями ростера можно назначать каждому выбранному агенту ментальную картину М0–М6, а каждому выбранному амплификатору — ранг пробуждения 1–5. Эти значения сохраняются в `player_rosters.agent_levels` и `player_rosters.w_engine_levels`.

Перед запуском обновлённой версии один раз выполни `supabase/roster_levels_migration.sql` в Supabase SQL Editor. Миграция добавляет два JSONB-столбца и не удаляет ростеры. После этого скопируй свой `.env.local` в папку проекта и выполни `npm install`, `npm run dev`.

Справочник персонажей расширен, но список — встроенный справочник приложения, не автоматически обновляемый с игрой. Перед соревновательным использованием проверь актуальность имён и доступность агентов/амплификаторов в текущей версии Zenless Zone Zero.

## Выбор личного ростера перед онлайн-драфтом

Для подключения сохранённых личных ростеров к онлайн-комнатам примени новый файл `supabase/online_saved_rosters.sql` в Supabase SQL Editor. Предварительно должны быть применены `player_rosters_migration.sql`, `roster_levels_migration.sql` и `online_rooms.sql`. Миграция добавляет снимки выбранных ростеров к комнатам и RPC `select_saved_roster_for_draft`; старые таблицы и существующие комнаты не удаляются.

В комнате каждый игрок выбирает свой ростер из `player_rosters`. Серверная функция проверяет владельца и состояние комнаты, сохраняет список агентов для драфта и снимок данных ростера. Для новых комнат больше не нужно вручную набирать персонажей.


## Ростеры без верхнего лимита агентов

Если проект уже подключён к Supabase, выполни `supabase/roster_agent_limit_migration.sql` в SQL Editor. Теперь ростер должен содержать минимум одного агента, но верхнего ограничения по количеству нет. Миграция заменяет функции проверки, не удаляя сохранённые ростеры. Ограничение `count` в редакторе последовательности драфта относится к числу повторяющихся действий одного шага и не связано с количеством агентов в ростере.
