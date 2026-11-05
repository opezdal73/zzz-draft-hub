// Pure rules for the BO2 post-draft screen (squads + timers). Used for BOTH games of a series.

export const SQUAD_SIZE = 3;
export const MAX_AGENTS = SQUAD_SIZE * 2;
/** Longest allowed single-game timer: 10:00. */
export const MAX_TIMER_SECONDS = 600;

export type SquadNumber = 1 | 2;
export type SquadSlot = { agent_id: string; squad: SquadNumber; engine_id: string; engine_copy_key?: string };

/**
 * Turns the minutes / seconds inputs into seconds.
 * Both empty -> nothing entered yet (no error). Anything above 10:00 is rejected.
 */
export function parseTimer(minutes: string, seconds: string): { seconds: number | null; error: string | null } {
  if (!minutes && !seconds) return { seconds: null, error: null };
  const mm = minutes || '0';
  const ss = seconds.padStart(2, '0');
  if (!/^\d{1,2}$/.test(mm) || !/^\d{2}$/.test(ss)) return { seconds: null, error: 'Введи время в формате мм:сс.' };
  if (Number(ss) > 59) return { seconds: null, error: 'Секунды должны быть от 00 до 59.' };
  const total = Number(mm) * 60 + Number(ss);
  if (total > MAX_TIMER_SECONDS) return { seconds: null, error: 'Таймер не может быть больше 10:00.' };
  return { seconds: total, error: null };
}

export const squadCount = (slots: SquadSlot[], squad: SquadNumber) => slots.filter(s => s.squad === squad).length;
export const squadHasRoom = (slots: SquadSlot[], squad: SquadNumber) => squadCount(slots, squad) < SQUAD_SIZE;

/** Keep only drafted agents, once each, and never more than SQUAD_SIZE per squad. Order is preserved. */
export function normalizeSlots(slots: SquadSlot[] | null | undefined, draftedIds: string[]): SquadSlot[] {
  const out: SquadSlot[] = [];
  for (const slot of slots ?? []) {
    if (!draftedIds.includes(slot.agent_id)) continue;
    if (out.some(s => s.agent_id === slot.agent_id)) continue;
    if (slot.squad !== 1 && slot.squad !== 2) continue;
    if (!squadHasRoom(out, slot.squad)) continue;
    out.push({ agent_id: slot.agent_id, squad: slot.squad, engine_id: slot.engine_id || '', engine_copy_key: slot.engine_copy_key || '' });
  }
  return out;
}

export const unplacedIds = (slots: SquadSlot[], draftedIds: string[]) =>
  draftedIds.filter(id => !slots.some(s => s.agent_id === id));

/** Put a drafted, not yet placed agent into a squad. Returns null if that is not allowed (squad is full, etc.). */
export function placeAgent(slots: SquadSlot[], draftedIds: string[], agentId: string, squad: SquadNumber): SquadSlot[] | null {
  if (!draftedIds.includes(agentId) || slots.some(s => s.agent_id === agentId)) return null;
  if (!squadHasRoom(slots, squad)) return null;
  return [...slots, { agent_id: agentId, squad, engine_id: '' }];
}

/** Move an already placed agent to the other squad. Returns null if the target squad is full. */
export function moveAgent(slots: SquadSlot[], agentId: string, squad: SquadNumber): SquadSlot[] | null {
  const current = slots.find(s => s.agent_id === agentId);
  if (!current) return null;
  if (current.squad === squad) return slots;
  if (!squadHasRoom(slots, squad)) return null;
  return slots.map(s => (s.agent_id === agentId ? { ...s, squad } : s));
}

/** Take an agent out of its squad (the amplifier is dropped with it). */
export const removeAgent = (slots: SquadSlot[], agentId: string): SquadSlot[] => slots.filter(s => s.agent_id !== agentId);

export const setEngine = (slots: SquadSlot[], agentId: string, engineId: string, engineCopyKey = ''): SquadSlot[] =>
  slots.map(s => (s.agent_id === agentId ? { ...s, engine_id: engineId, engine_copy_key: engineCopyKey } : s));

/** Ready is possible when every drafted agent is placed and no squad is over its limit. */
export function canMarkReady(slots: SquadSlot[], draftedIds: string[]): boolean {
  return draftedIds.length > 0
    && unplacedIds(slots, draftedIds).length === 0
    && slots.length === draftedIds.length
    && squadCount(slots, 1) <= SQUAD_SIZE
    && squadCount(slots, 2) <= SQUAD_SIZE;
}
