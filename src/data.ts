import type { Avatar, Agent, WEngine, Tournament, Player, Entrant, Match } from "./types";
import { archiveAvatars } from "./avatarCatalog";
import { bRankProfileAmplifierAvatarIds, nanokaAgentIconsById, nanokaAffinityIconsByRole, nanokaProfileAgentIcons, nanokaProfileBEngineIcons, nanokaProfileEngineCatalogIds } from "./nanokaAssets";

const nanokaAgentPortraitPath = (icon: string) => {
  const affinityIcon = nanokaAffinityIconsByRole[icon];
  return affinityIcon ? `/images/nanoka/agent-affinity/${affinityIcon}.webp` : `/images/nanoka/agent-portraits/${icon.replace(/^IconRole/, "IconRoleSelect")}.webp`;
};
export const getAgentIconUrl = (id: string) => `/images/agent-icons/${id.replace(/^agent-/, "")}.webp`;
const agentIdByNanokaIcon = Object.fromEntries(Object.entries(nanokaAgentIconsById).map(([id, icon]) => [icon, id]));
const uploadedAgentIconPath = (icon: string) => {
  const id = agentIdByNanokaIcon[icon];
  return id ? getAgentIconUrl(id) : nanokaAgentPortraitPath(icon);
};
const nonPlayableAgentAvatarPaths: Record<string, string> = {
  "agent-belle-icon": "/images/agent-icons/belle.webp",
  "agent-wise-icon": "/images/agent-icons/wise.webp",
};
export const avatars: Avatar[] = archiveAvatars.map(avatar => {
  const agentIcon = nanokaProfileAgentIcons[avatar.id];
  if (agentIcon) return { ...avatar, imageUrl: uploadedAgentIconPath(agentIcon), imageFallbackUrl: `/images/profile-avatars/${avatar.id}.webp` };
  if (avatar.category === "Агент") return { ...avatar, imageUrl: nonPlayableAgentAvatarPaths[avatar.id] || `/images/profile-avatars/${avatar.id}.webp` };
  const engineCatalogId = nanokaProfileEngineCatalogIds[avatar.id];
  if (engineCatalogId) return { ...avatar, imageUrl: `/images/amplifiers-original/${engineCatalogId}.webp`, imageFallbackUrl: `/images/profile-avatars/${avatar.id}.webp` };
  const bEngineIcon = nanokaProfileBEngineIcons[avatar.id];
  if (bEngineIcon) return { ...avatar, imageUrl: `/images/nanoka/amplifiers/${bEngineIcon}.webp`, imageFallbackUrl: `/images/profile-avatars/${avatar.id}.webp` };
  return avatar;
});
const hiddenProfileAvatarIds = new Set(["agent-belle-icon", "agent-wise-icon"]);
export const profileSelectableAvatars: Avatar[] = avatars.filter(avatar => !bRankProfileAmplifierAvatarIds.has(avatar.id) && !hiddenProfileAvatarIds.has(avatar.id));
const fullSizeAgentIcons = new Set(['alice','anby','anton','arlecchino','astra','banyue','ben','billy','burnice','caesar','corin','dialyn','ellen','evelyn','grace','harumasa','hugo','jane','ju-fufu','koleda','lighter','lucia','lucy','lycaon','nicole','pan-yinhu','piper','pulchra','pyrois','rina','roxy','seth','severian','soldier-11','sou-kaku','starlight-billy','sunna','velina','yanagi','ye-shunguang','yidhari','yu-hua','zhao']);

const agentSpecialties: Record<string, string> = {
  'anby':'Устрашение','anton':'Нападение','ben':'Оборона','billy':'Нападение','corin':'Нападение','lucy':'Поддержка',
  'komano-manato':'Разрушение','nicole':'Поддержка','piper':'Аномалия','pulchra':'Устрашение','seth':'Оборона','sou-kaku':'Поддержка','pan-yinhu':'Оборона',
  'rina':'Поддержка','alice':'Аномалия','arlecchino':'Аномалия','aria':'Аномалия','astra':'Поддержка','banyue':'Разрушение','burnice':'Аномалия','caesar':'Оборона','cissia':'Нападение',
  'dialyn':'Устрашение','clarette':'Оружейник','ellen':'Нападение','evelyn':'Нападение','grace':'Аномалия','harumasa':'Нападение','hugo':'Нападение','jane':'Аномалия',
  'ju-fufu':'Устрашение','koleda':'Устрашение','lighter':'Устрашение','lucia':'Поддержка','miyabi':'Аномалия','nangong-yu':'Устрашение','nekomata':'Нападение',
  'norma':'Устрашение','ormare':'Нападение','phoenix':'Аномалия','promeia':'Аномалия','qingyi':'Устрашение','remielle':'Аномалия','roxy':'Устрашение',
  'seed':'Нападение','severian':'Нападение','sigrid':'Нападение','soldier-0-anby':'Нападение','soldier-11':'Нападение','starlight-billy':'Разрушение','sunna':'Поддержка',
  'trigger':'Устрашение','yanagi':'Аномалия','yu-hua':'Поддержка','velina':'Аномалия','vivian':'Аномалия','lycaon':'Устрашение',
  'ye-shunguang':'Нападение','yidhari':'Разрушение','yixuan':'Разрушение','zhao':'Оборона','zhu-yuan':'Нападение','pyrois':'Нападение'
};

// Use localized file names from the Russian ZZZ Wiki instead of guessing English Fandom filenames.
const wikiFile = (file: string) => `https://zenlesszonezero.wiki.gg/ru/wiki/Special:FilePath/${encodeURIComponent(file).replace(/%20/g, '_')}`;
const agentIconNames: Record<string, string> = {
  'anby':'Энби','anton':'Антон','ben':'Бен','billy':'Билли','corin':'Корин','lucy':'Люси','komano-manato':'Комано Манато','nicole':'Николь','piper':'Пайпер','pulchra':'Пульхра','seth':'Сет','sou-kaku':'Сокаку','pan-yinhu':'Пань Иньху',
  'rina':'Рина','alice':'Элис','arlecchino':'Ария','clarette':'Кларетт','astra':'Астра','banyue':'Баньюэ','burnice':'Бёрнис','caesar':'Цезарь','cissia':'Циссия','dialyn':'Диалинь','ellen':'Эллен','evelyn':'Эвелин','grace':'Грейс','harumasa':'Харумаса','hugo':'Хуго','jane':'Джейн','ju-fufu':'Цзюй Фуфу','koleda':'Коляда','lighter':'Лайтер','lucia':'Люсия','miyabi':'Мияби','nangong-yu':'Наньгун Юй','nekomata':'Нэкомата','norma':'Норма','ormare':'Орфея','phoenix':'Феникс','promeia':'Промея','qingyi':'Цинъи','remielle':'Ремиэлла','roxy':'Рокси','seed':'Сид','severian':'Севериан','sigrid':'Сигрид','soldier-0-anby':'Солдат 0 Энби','soldier-11':'Солдат 11','starlight-billy':'Звёздный Билли','sunna':'Санна','trigger':'Гашетка','yanagi':'Янаги','yu-hua':'Юдзуха','velina':'Велина','vivian':'Вивиан','lycaon':'Ликаон','ye-shunguang':'Е Шуньгуан','yidhari':'Йидхари','yixuan':'Исюань','zhao':'Чжао','zhu-yuan':'Чжу Юань','pyrois':'Пироис'
};

export const initialAgents: Agent[] = [
  // Играбельные агенты из русскоязычного каталога. ID сохраняются стабильными для уже сохранённых ростеров.
  ...([
    // A-ранг
    ['anby','Энби Демара','A'], ['anton','Антон Иванов','A'], ['ben','Бен Биггер','A'],
    ['billy','Билли Кид','A'], ['corin','Корин Уикс','A'], ['lucy','Люсиана де Монтефио','A'],
    ['komano-manato','Комано Манато','A'], ['nicole','Николь Демара','A'], ['piper','Пайпер Уил','A'],
    ['pulchra','Пульхра Феллини','A'], ['seth','Сет Лоуэлл','A'], ['sou-kaku','Сокаку','A'], ['pan-yinhu','Пань Иньху','A'],
    // S-ранг
    ['rina','Александрина Себастиан','S'], ['alice','Элис Таймфилд','S'], ['arlecchino','Ария','S'],
    ['astra','Астра Яо','S'], ['banyue','Баньюэ','S'], ['burnice','Бёрнис Уайт','S'], ['caesar','Цезарь Кинг','S'],
    ['cissia','Циссия','S'], ['dialyn','Диалинь','S'], ['clarette','Кларетт','S'], ['ellen','Эллен Джо','S'], ['evelyn','Эвелин Шевалье','S'],
    ['grace','Грейс Ховард','S'], ['harumasa','Асаба Харумаса','S'], ['hugo','Хуго Влад','S'], ['jane','Джейн Доу','S'],
    ['ju-fufu','Цзюй Фуфу','S'], ['koleda','Коляда Белобог','S'], ['lighter','Лайтер','S'], ['lucia','Люсия Эловен','S'],
    ['miyabi','Хосими Мияби','S'], ['nangong-yu','Наньгун Юй','S'], ['nekomata','Нэкомия Мана','S'],
    ['norma','Норма Холоуэлл','S'], ['ormare','Орфея Магнуссон и Магус','S'], ['phoenix','Феникс Реффаэлла','S'],
    ['promeia','Промея','S'], ['qingyi','Цинъи','S'], ['remielle','Ремиэлла Дан','S'], ['roxy','Рокси Ифрита Прайс','S'],
    ['seed','Сид','S'], ['severian','Севериан Лоуэлл','S'], ['sigrid',"Сигрид де Л'Азур",'S'],
    ['soldier-0-anby','Солдат 0 Энби','S'], ['soldier-11','Солдат 11','S'], ['starlight-billy','Звёздный Билли','S'],
    ['sunna','Санна','S'], ['trigger','Гашетка','S'], ['yanagi','Цукисиро Янаги','S'], ['yu-hua','Укинами Юдзуха','S'],
    ['velina','Велина Эйргид','S'], ['vivian','Вивиан Бэнси','S'], ['lycaon','Фон Ликаон','S'],
    ['ye-shunguang','Е Шуньгуан','S'], ['yidhari','Йидхари Мёрфи','S'], ['yixuan','Исюань','S'],
    ['zhao','Чжао','S'], ['zhu-yuan','Чжу Юань','S'], ['pyrois','Пироис','S']
  ] as string[][]).map(([id,name,rank]) => ({
    id: `agent-${id}`, name, baseCost: rank === 'S' ? 3 : 2,
    avatar: rank, rank, specialty: agentSpecialties[id] || 'Не указана',
    imageUrl: getAgentIconUrl(`agent-${id}`),
    imageFallbackUrl: fullSizeAgentIcons.has(id) ? `/images/agents/${id}.png` : `/images/agents/${id}.webp`
  } as Agent))
];

const engineEntries: [string, string, string, string][] = [
  ['catalog-036', 'Аккумулятор Демары II', 'A', 'Устрашение'],
  ['catalog-097', 'Алая жажда', 'S', 'Оружейник'],
  ['catalog-001', 'Аптечка дзансин', 'S', 'Нападение'],
  ['catalog-015', 'Артиллерийский ротор', 'A', 'Нападение'],
  ['catalog-026', 'Багряный гроб', 'S', 'Устрашение'],
  ['catalog-079', 'Большой цилиндр', 'A', 'Оборона'],
  ['catalog-069', 'Бум-пушка', 'A', 'Поддержка'],
  ['catalog-037', 'Бумагорезка', 'A', 'Устрашение'],
  ['catalog-016', 'Бур — красная ось', 'A', 'Нападение'],
  ['catalog-080', 'Весеннее тепло', 'A', 'Оборона'],
  ['catalog-027', 'Вместилище фурчаний', 'S', 'Устрашение'],
  ['catalog-045', 'Всесторонняя отточенность', 'S', 'Аномалия'],
  ['catalog-046', 'Встроенный компилятор', 'S', 'Аномалия'],
  ['catalog-002', 'Гость из глубин', 'S', 'Нападение'],
  ['catalog-088', 'Грозный страж', 'S', 'Разрушение'],
  ['catalog-017', 'Домработница', 'A', 'Нападение'],
  ['catalog-038', 'Драгоценная окаменелость', 'A', 'Устрашение'],
  ['catalog-048', 'Душа в доспехах', 'S', 'Аномалия'],
  ['catalog-092', 'Жарево заката', 'A', 'Разрушение'],
  ['catalog-049', 'Заострённые шипы', 'S', 'Аномалия'],
  ['catalog-070', 'Застенчивый монстр', 'A', 'Поддержка'],
  ['catalog-081', 'Заячья корзинка', 'A', 'Оборона'],
  ['catalog-018', 'Звезда улиц', 'A', 'Нападение'],
  ['catalog-089', 'Звёздное забрало', 'S', 'Разрушение'],
  ['catalog-019', 'Звёздный двигатель', 'A', 'Нападение'],
  ['catalog-028', 'Звонок из прошлого', 'S', 'Устрашение'],
  ['catalog-020', 'Златоцвет', 'A', 'Нападение'],
  ['catalog-071', 'Кадр на память', 'A', 'Поддержка'],
  ['catalog-082', 'Кинопроектор', 'A', 'Оборона'],
  ['catalog-090', 'Клетка Небесной птицы', 'S', 'Разрушение'],
  ['catalog-039', 'Клокочущий котелок', 'A', 'Устрашение'],
  ['catalog-077', 'Клыки ярости', 'S', 'Оборона'],
  ['catalog-091', 'Колыбель Кракена', 'S', 'Разрушение'],
  ['catalog-064', 'Колыбель плача', 'S', 'Поддержка'],
  ['catalog-098', 'Котик удачи', 'A', 'Оружейник'],
  ['catalog-099', 'Кроветворный ларец', 'A', 'Оружейник'],
  ['catalog-050', 'Ледяное новолуние', 'S', 'Аномалия'],
  ['catalog-021', 'Маркато-реверб', 'A', 'Нападение'],
  ['catalog-083', 'Миротворец специализированный', 'A', 'Оборона'],
  ['catalog-065', 'Мысли в бит', 'S', 'Поддержка'],
  ['catalog-072', 'Мяч для игры без правил', 'A', 'Поддержка'],
  ['catalog-029', 'Неоновое наваждение', 'S', 'Устрашение'],
  ['catalog-051', 'Ода о возвращении крыльев', 'S', 'Аномалия'],
  ['catalog-084', 'Оригинальный трансформатор', 'A', 'Оборона'],
  ['catalog-066', 'Очаг грёз', 'S', 'Поддержка'],
  ['catalog-040', 'Пароварка', 'A', 'Устрашение'],
  ['catalog-101', 'Перо перерождения', 'S', 'Аномалия'],
  ['catalog-030', 'Пламенный венец', 'S', 'Устрашение'],
  ['catalog-003', 'Пламя брани', 'S', 'Нападение'],
  ['catalog-056', 'Плачущие близнецы', 'A', 'Аномалия'],
  ['catalog-052', 'Полёт среди грёз', 'S', 'Аномалия'],
  ['catalog-031', 'Призрачный взор', 'S', 'Устрашение'],
  ['catalog-004', 'Проблеск в облаках', 'S', 'Нападение'],
  ['catalog-093', 'Радиопрогулка', 'A', 'Разрушение'],
  ['catalog-057', 'Ревущая тачка', 'A', 'Аномалия'],
  ['catalog-022', 'Реплика Звёздного двигателя', 'A', 'Нападение'],
  ['catalog-005', 'Рептилокатор', 'S', 'Нападение'],
  ['catalog-006', 'Рукотворное сердце', 'S', 'Нападение'],
  ['catalog-032', 'Сдержанность', 'S', 'Устрашение'],
  ['catalog-067', 'Семь уловок тануки', 'S', 'Поддержка'],
  ['catalog-007', 'Сера', 'S', 'Нападение'],
  ['catalog-078', 'Сладковатая зайка', 'S', 'Оборона'],
  ['catalog-009', 'Стальная лапа', 'S', 'Нападение'],
  ['catalog-033', 'Старший ассистент', 'S', 'Устрашение'],
  ['catalog-068', 'Стильная штучка', 'S', 'Поддержка'],
  ['catalog-010', 'Струны ночи', 'S', 'Нападение'],
  ['catalog-073', 'Сундук сокровищ', 'A', 'Поддержка'],
  ['catalog-058', 'Тадам-барабан', 'A', 'Аномалия'],
  ['catalog-053', 'Ткач времени', 'S', 'Аномалия'],
  ['catalog-094', 'Треножник поднебесья', 'A', 'Разрушение'],
  ['catalog-085', 'Триграмма Гром', 'A', 'Оборона'],
  ['catalog-059', 'Тропический гурман', 'A', 'Аномалия'],
  ['catalog-011', 'Тысяча затмений', 'S', 'Нападение'],
  ['catalog-012', 'Усмиритель беспорядков VI', 'S', 'Нападение'],
  ['catalog-013', 'Ход конём', 'S', 'Нападение'],
  ['catalog-054', 'Храм вьюги', 'S', 'Аномалия'],
  ['catalog-034', 'Чайник нефритовой чистоты', 'S', 'Устрашение'],
  ['catalog-014', 'Чистота утраты', 'S', 'Нападение'],
  ['catalog-095', 'Шар-головоломка', 'A', 'Разрушение'],
  ['catalog-055', 'Шейкер-огнемейкер', 'S', 'Аномалия'],
  ['catalog-035', 'Шестерни адского пламени', 'S', 'Устрашение'],
  ['catalog-041', 'Шестизарядник', 'A', 'Устрашение'],
  ['catalog-060', 'Электроблеск для губ', 'A', 'Аномалия'],
];

export const initialWEngines: WEngine[] = engineEntries.map(([id, name, rank, specialty]) => ({
  id: `we-${id}`, name, baseCost: rank === 'S' ? 3 : 2,
  avatar: 'W', rank, specialty, modifiers: {}, imageUrl: `/images/amplifiers-original/we-${id}.webp`, imageFallbackUrl: `/images/amplifiers/we-${id}.png`
}));

export const initialPlayers: Player[] = [
  { id: "p-admin", nickname: "Organizer", avatarId: "anby", role: "admin" },
  { id: "p-1", nickname: "Shadow", avatarId: "ellen", role: "player" },
  { id: "p-2", nickname: "MiyabiMain", avatarId: "lycaon", role: "player" },
  { id: "p-3", nickname: "Zero", avatarId: "grace", role: "player" },
  { id: "p-4", nickname: "Rin", avatarId: "nicole", role: "player" },
  { id: "p-5", nickname: "Proxy", avatarId: "billy", role: "player" },
  { id: "p-6", nickname: "Nova", avatarId: "koleda", role: "player" }
];
export const initialTournaments: Tournament[] = [
  { id: "t-1", name: "Community Cup #01", description: "Первый тестовый турнир сообщества.", maxPlayers: 8, status: "registration", draftUrl: "https://example.com", rules: "Пики и баны проводятся во внешнем инструменте.", costLimit: 10, preBanEvery: 5, mirrorsEnabled: true, mirrorStage: "Последний пик каждого игрока", createdAt: new Date().toISOString() },
  { id: "t-2", name: "Midnight Showdown", description: "Тестовая сетка для демонстрации.", maxPlayers: 8, status: "in_progress", draftUrl: "https://example.com", rules: "Проверочный турнир-пример.", costLimit: 12, preBanEvery: 5, mirrorsEnabled: true, mirrorStage: "Последний пик каждого игрока", createdAt: new Date().toISOString() }
];
export const initialEntrants: Entrant[] = [
  ...["p-1","p-2","p-3","p-4","p-5","p-6"].map((playerId, i) => ({ id: `e-${i}`, tournamentId: "t-1", playerId, seed: i + 1 })),
  ...["p-1","p-2","p-3","p-4"].map((playerId, i) => ({ id: `e2-${i}`, tournamentId: "t-2", playerId, seed: i + 1 }))
];
export const initialMatches: Match[] = [
  { id: "m-1", tournamentId: "t-2", round: 1, slot: 1, playerA: "p-1", playerB: "p-2", winner: "p-1", status: "completed" },
  { id: "m-2", tournamentId: "t-2", round: 1, slot: 2, playerA: "p-3", playerB: "p-4", winner: null, status: "pending" },
  { id: "m-3", tournamentId: "t-2", round: 2, slot: 1, playerA: "p-1", playerB: null, winner: null, status: "pending" }
];
