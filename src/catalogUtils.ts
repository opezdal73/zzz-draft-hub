export const specialtyOrder = ['Нападение', 'Аномалия', 'Устрашение', 'Поддержка', 'Оборона', 'Разрушение', 'Оружейник', 'Не указана'];

export function compareBySpecialty<T extends { specialty?: string; name: string; rank?: string }>(a: T, b: T) {
  const aIndex = specialtyOrder.indexOf(a.specialty || 'Не указана');
  const bIndex = specialtyOrder.indexOf(b.specialty || 'Не указана');
  return (aIndex < 0 ? specialtyOrder.length : aIndex) - (bIndex < 0 ? specialtyOrder.length : bIndex)
    || (a.rank === b.rank ? 0 : a.rank === 'S' ? -1 : b.rank === 'S' ? 1 : a.rank === 'A' ? -1 : b.rank === 'A' ? 1 : 0)
    || a.name.localeCompare(b.name, 'ru');
}
