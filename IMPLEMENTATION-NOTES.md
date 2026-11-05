# Глобальные правила — первая итерация

В этой версии добавлен каркас глобальных настроек в онлайн-драфте:
- настройки хранятся в Supabase в `system_settings`;
- редактирование доступно профилю с ролью `admin`;
- при создании новой комнаты минимум агентов берётся из глобальной настройки, а не задаётся создателем комнаты;
- добавлены поля минимального/максимального коста и стоимости разницы для дополнительного пребана;
- SQL защищает изменение настроек RLS-политикой и запрещает обычным пользователям менять себе роль.

## Установка
1. Распакуй архив в новую папку и перенеси свой `.env.local`.
2. В Supabase SQL Editor выполни `supabase/global_rules_admin.sql` после предыдущих миграций проекта.
3. Чтобы назначить владельца, выполни отдельно SQL-команду из комментария в конце миграции, подставив email своего аккаунта.
4. Запусти `npm install`, затем `npm run dev`.

## Важно: что пока не включено
Эта итерация создаёт и сохраняет настройки, но ещё не включает полный runtime-процесс дополнительных пребанов и не выполняет серверную проверку минимального/максимального коста ростера. Эти проверки нужно внедрить в RPC и состояние комнаты следующим этапом; поля настроек пока являются фундаментом админ-панели, а не заявлением, что все правила уже enforced.


## Admin-role SQL fix
The `global_rules_admin.sql` trigger now allows trusted SQL Editor/migration execution when `auth.uid()` is NULL, while continuing to block role changes made by authenticated non-admin users. After the owner account has registered, run `supabase/promote_owner_to_admin.sql` separately in Supabase SQL Editor after replacing the placeholder email.
