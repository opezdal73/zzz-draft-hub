import type { WEngine } from './types';

export type EngineLevels = Record<string, number>;

export const engineCopyLevelKey = (engineId: string, copyNumber: number) =>
  `copy:${encodeURIComponent(engineId)}:${copyNumber}`;

export const defaultEngineAwakening = (engine: Pick<WEngine, 'rank'> | undefined) =>
  engine?.rank === 'A' ? 5 : 1;

export function getEngineCopyAwakening(
  levels: EngineLevels | null | undefined,
  engineId: string,
  copyNumber: number,
  engine?: Pick<WEngine, 'rank'>,
) {
  const value = levels?.[engineCopyLevelKey(engineId, copyNumber)]
    ?? (copyNumber === 1 ? levels?.[engineId] : undefined)
    ?? defaultEngineAwakening(engine);
  return Math.max(1, Math.min(5, Math.floor(Number(value) || 1)));
}

export function serializeEngineCopyLevels(
  ids: string[],
  levels: EngineLevels | null | undefined,
  findEngine: (id: string) => Pick<WEngine, 'rank'> | undefined,
): EngineLevels {
  const seen = new Map<string, number>();
  const result: EngineLevels = {};
  for (const id of ids) {
    const copyNumber = (seen.get(id) || 0) + 1;
    seen.set(id, copyNumber);
    result[engineCopyLevelKey(id, copyNumber)] = getEngineCopyAwakening(levels, id, copyNumber, findEngine(id));
  }
  return result;
}

export function engineCopyCounts(ids: string[]) {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
}
