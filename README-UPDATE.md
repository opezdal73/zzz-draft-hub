# Обновление: полный список агентов и уровни по умолчанию

- Справочник агентов обновлён для состава, доступного к версии 3.3 (октябрь 2026).
- При добавлении A-Rank агента автоматически выставляется М6.
- При добавлении S-Rank агента автоматически выставляется М0.
- Уровень можно вручную изменить после выбора агента.
- Существующие идентификаторы ранее добавленных агентов по возможности сохранены, чтобы не разрывать связи в уже сохранённых ростерах.

Обновление не требует новой SQL-миграции. Сохраните свой `.env.local` при переносе проекта.

## Русские названия и изображения

В справочнике отображаются русские имена агентов и русские варианты названий амплификаторов. Изображения портретов и иконок амплификаторов загружаются по ссылкам Zenless Zone Zero Wiki (Fandom), поэтому для них требуется подключение к интернету. Если источник недоступен или файл не найден, карточка сохраняет текстовую заглушку.


## Исправление русских названий и портретов

Справочник агентов и названия амплификаторов сверены с русскоязычным каталогом Zenless Zone Zero Wiki (wiki.gg). Портреты запрашиваются через `Special:FilePath` на wiki.gg; если имя файла с коротким названием не совпадает, интерфейс пробует альтернативное имя файла. Для некоторых новых или недавно добавленных объектов имя файла всё ещё может потребовать ручной проверки.


## Supabase auth update
- Removed the local demo login and demo organizer shortcut.
- Login/registration now use Supabase Auth in a modal dialog.
- The signed-in session is shared across the app and the profile role is read from `public.profiles`.
- Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` based on `.env.example`.
- Existing tournament, roster, agent, and engine data screens still contain local prototype data; this change replaces authentication only, not all data persistence.
- Make sure a profile row is created for each Supabase user (the existing schema must include the profile creation trigger or profiles must be provisioned separately). New accounts without a `profiles` row will be treated as `player`.
