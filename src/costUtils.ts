import type { Agent, WEngine } from './types';

export const MISSING_COST = 999;

function numericCost(value: unknown): number {
  if (value === undefined || value === null || String(value).trim() === '' || !Number.isFinite(Number(value))) {
    return MISSING_COST;
  }
  return Number(value);
}

export function getAgentCost(agent: Agent | undefined, level?: number): number {
  if (!agent) return MISSING_COST;
  const normalizedLevel = Number.isFinite(Number(level)) ? Number(level) : 0;
  const configured = agent.costs?.[`M${normalizedLevel}`];
  return numericCost(configured ?? (normalizedLevel === 0 ? agent.baseCost : undefined));
}

export function getWEngineCost(engine: WEngine | undefined, agent: Agent | undefined, level = 1): number {
  if (!engine || !agent) return MISSING_COST;
  const rank = `R${level}`;
  const individual = engine.agentCosts?.[agent.id]?.[rank];
  if (individual !== undefined && individual !== null && String(individual).trim() !== '') {
    return numericCost(individual);
  }
  const offbuild = Boolean(engine.specialty && agent.specialty && engine.specialty !== agent.specialty);
  const configured = offbuild
    ? engine.offbuildCosts?.[rank]
    : engine.rankCosts?.[rank] ?? (rank === 'R1' ? engine.baseCost : undefined);
  return numericCost(configured);
}
