export type Avatar = { id: string; name: string; color: string; initials: string; imageUrl?: string; imageFallbackUrl?: string; category?: string };
export type Player = { id: string; nickname: string; avatarId: string; role: "admin" | "cost_manager" | "player" };
export type TournamentStatus = "registration" | "ready" | "in_progress" | "completed";
export type Tournament = {
  id: string; name: string; description: string; maxPlayers: number; status: TournamentStatus;
  draftUrl: string; rules: string; costLimit: number; preBanEvery: number;
  mirrorsEnabled: boolean; mirrorStage: string; createdAt: string;
  format?: "single_elimination" | "double_elimination"; swissStage?: boolean; swissRounds?: number;
};
export type RegisteredRoster = { id: string; name: string; agent_ids: string[]; w_engine_ids: string[]; agent_levels?: Record<string, number>; w_engine_levels?: Record<string, number> };
export type Entrant = { id: string; tournamentId: string; playerId: string; seed: number; savedRosterId?: string; registeredRoster?: RegisteredRoster; testBot?: boolean; testName?: string };
export type JoinRequest = { id: string; tournamentId: string; playerId: string; status: "pending" | "accepted" | "rejected"; createdAt: string };
export type Match = { id: string; tournamentId: string; round: number; slot: number; playerA: string | null; playerB: string | null; winner: string | null; status: "pending" | "completed"; bracket?: "single" | "winners" | "losers" | "final" | "reset" | "swiss"; loser?: string | null; nextWinnerMatchId?: string | null; nextWinnerSide?: "playerA" | "playerB"; nextLoserMatchId?: string | null; nextLoserSide?: "playerA" | "playerB"; roomId?: string | null };
export type Agent = { id: string; name: string; baseCost: number; avatar: string; rank: string; specialty?: string; costs?: Record<string, number>; imageUrl?: string; imageFallbackUrl?: string };
export type WEngine = { id: string; name: string; baseCost: number; avatar: string; rank: string; specialty?: string; modifiers: Record<string, number>; rankCosts?: Record<string, number>; offbuildCosts?: Record<string, number>; agentCosts?: Record<string, Record<string, number>>; imageUrl?: string; imageFallbackUrl?: string };
