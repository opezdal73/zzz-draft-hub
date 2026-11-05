import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ShieldCheck, Trophy, Users, Settings2, ExternalLink, Plus, LogOut, UserRound, Swords, ChevronRight, LockKeyhole, SlidersHorizontal, CircleHelp, Check, X, Copy, RotateCcw, Home, Bell } from "lucide-react";
import { avatars, profileSelectableAvatars, getAgentIconUrl, initialAgents, initialEntrants, initialMatches, initialPlayers, initialTournaments, initialWEngines } from "./data";
import type { Agent, Entrant, Match, Player, RegisteredRoster, Tournament, WEngine } from "./types";
import DraftSequenceEditor from "./DraftSequenceEditor";
import DraftRooms from "./DraftRooms";
import MyRosters from "./MyRosters";
import GlobalRulesAdmin from "./GlobalRulesAdmin";
import { compareBySpecialty } from "./catalogUtils";
import { getAgentCost } from "./costUtils";
import { getEngineCopyAwakening } from "./engineCopies";
import { isSupabaseConfigured, supabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";

type RegistrationRequest = {
  id: string;
  tournamentId: string;
  playerId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  savedRosterId?: string;
  registeredRoster?: RegisteredRoster;
};
type UserNotification = { id: string; kind: string; title: string; message: string; created_at: string; read_at: string | null; room_id?: string | null; tournament_id?: string | null };
type CreatedDraftRoom = { id: string; title: string; status: string; tournament_id: string | null; tournament_match_id: string | null; created_at: string; player_one_id: string | null; player_two_id: string | null };
type GlobalDraftRules = { min_agents: number; min_roster_cost: number; max_roster_cost: number; cost_difference_per_preban: number; turn_timer_seconds: number; reserve_time_seconds: number };
const defaultGlobalDraftRules: GlobalDraftRules = { min_agents: 5, min_roster_cost: 0, max_roster_cost: 999, cost_difference_per_preban: 3, turn_timer_seconds: 60, reserve_time_seconds: 30 };

function RosterAmplifierPreview({ ids, levels, engines }: { ids: string[]; levels?: Record<string, number>; engines: WEngine[] }) {
  if (!ids.length) return <p className="muted-text">В этом ростере амплификаторы не выбраны.</p>;
  return <div className="registered-roster-engines"><h4>Амплификаторы ростера</h4><div>{ids.map((id, index) => { const engine = engines.find(item => item.id === id); const copyNumber = ids.slice(0,index+1).filter(item=>item===id).length; return <span className="registered-engine-chip" key={`${id}-${index}`}>{engine?.imageUrl && <img src={engine.imageUrl} data-fallback={engine.imageFallbackUrl} alt="" onError={e => { const img = e.currentTarget; const fallback = img.dataset.fallback; if (fallback && img.src !== fallback) { img.dataset.fallback = ""; img.src = fallback; } else img.style.display = "none"; }}/>}<span><b>{engine?.name || id}</b><small>R{getEngineCopyAwakening(levels,id,copyNumber,engine)}</small></span></span>; })}</div></div>;
}

type State = {
  players: Player[];
  tournaments: Tournament[];
  entrants: Entrant[];
  matches: Match[];
  agents: Agent[];
  engines: WEngine[];
  currentPlayerId: string;
  registrationRequests: RegistrationRequest[];
};
const STORAGE_KEY = "zzzdraft-demo-v1";
const PAGE_STORAGE_KEY = "zzzdraft-active-page-v1";
const seedState: State = {
  players: initialPlayers,
  tournaments: initialTournaments,
  entrants: initialEntrants,
  matches: initialMatches,
  agents: initialAgents,
  engines: initialWEngines,
  currentPlayerId: "p-admin",
  registrationRequests: [],
};
function loadState(): State {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return seedState;
    const parsed = JSON.parse(saved);
    // Merge the latest canonical catalog with saved local settings. Older localStorage
    // snapshots may contain only a small legacy catalog (for example, six agents).
    // Keep user-edited cost fields by stable ID, while canonical catalog fields come
    // from the current source so newly added agents/engines appear immediately.
    const mergeCatalog = <T extends { id: string }>(defaults: T[], savedItems: T[] | undefined): T[] => {
      const savedById = new Map((savedItems ?? []).map(item => [item.id, item]));
      const merged = defaults.map(item => {
        const savedItem = savedById.get(item.id);
        if (!savedItem) return item;
        return { ...savedItem, ...item } as T;
      });
      // The canonical catalog is authoritative. Do not append legacy/custom catalog
      // entries from old localStorage snapshots: these may be obsolete English-name
      // agents or amplifiers that duplicate the current Russian catalog.
      return merged;
    };
    return {
      ...seedState,
      ...parsed,
      agents: mergeCatalog(seedState.agents, parsed.agents),
      engines: mergeCatalog(seedState.engines, parsed.engines),
      registrationRequests: parsed.registrationRequests ?? [],
    };
  } catch {
    return seedState;
  }
}
function saveState(s: State) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function costConfigSnapshot(agents: Agent[], engines: WEngine[]) {
  return stableJson({
    agents: Object.fromEntries(agents.map(a => [a.id, { baseCost: a.baseCost, costs: a.costs }])),
    engines: Object.fromEntries(engines.map(w => [w.id, { baseCost: w.baseCost, rankCosts: w.rankCosts, offbuildCosts: w.offbuildCosts, agentCosts: w.agentCosts }])),
  });
}
function makeId(prefix: string) { return `${prefix}-${Math.random().toString(36).slice(2, 9)}`; }
function Avatar({ id, size = "md" }: { id: string; size?: "sm"|"md"|"lg" }) {
  const legacyAvatarIds: Record<string,string> = { anby:"agent-anby-demara", nicole:"agent-nicole-demara", billy:"agent-billy-kid", ellen:"agent-ellen-joe", lycaon:"agent-von-lycaon", grace:"agent-grace-howard", koleda:"agent-koleda-belobog", nekomata:"agent-nekomiya-manato" };
  const a = avatars.find(x => x.id === id) || avatars.find(x => x.id === legacyAvatarIds[id]) || avatars[0];
  return <div className={`avatar avatar-${size} ${a.imageUrl ? "avatar-image" : ""}`} style={{ background: `linear-gradient(145deg, ${a.color}, #17171d)` }} title={a.name}>{a.imageUrl ? <img src={a.imageUrl} data-fallback={a.imageFallbackUrl} alt={a.name} loading="lazy" onError={e=>{const img=e.currentTarget;const fallback=img.dataset.fallback;if(fallback&&img.src!==fallback){img.dataset.fallback="";img.src=fallback;}else img.style.display="none";}}/> : a.initials}</div>;
}
function Badge({ children, kind = "neutral" }: { children: React.ReactNode; kind?: string }) { return <span className={`badge badge-${kind}`}>{children}</span>; }
function Button({ children, onClick, kind = "primary", disabled = false }: { children: React.ReactNode; onClick?: () => void; kind?: string; disabled?: boolean }) { return <button className={`btn btn-${kind}`} onClick={onClick} disabled={disabled}>{children}</button>; }

function buildEliminationBracket(tournament: Tournament, entrants: Entrant[], shuffle = true): Match[] {
  const ordered = shuffle ? [...entrants].sort(() => Math.random() - 0.5) : entrants;
  const size = 2 ** Math.ceil(Math.log2(ordered.length));
  const rounds = Math.log2(size);
  const matches: Match[] = [];
  const winners: Match[][] = [];
  for (let round = 1; round <= rounds; round++) {
    winners[round] = [];
    for (let slot = 1; slot <= size / (2 ** round); slot++) {
      const match: Match = { id: makeId("m"), tournamentId: tournament.id, round, slot, playerA: round === 1 ? ordered[(slot - 1) * 2]?.playerId ?? null : null, playerB: round === 1 ? ordered[(slot - 1) * 2 + 1]?.playerId ?? null : null, winner: null, status: "pending", bracket: tournament.format === "double_elimination" ? (rounds > 1 ? "winners" : "final") : "single" };
      winners[round][slot] = match; matches.push(match);
    }
  }
  if (tournament.format === "double_elimination" && rounds > 1) {
    const losers: Match[][] = [];
    const addLoserRound = (round: number, count: number) => { losers[round] = []; for (let slot = 1; slot <= count; slot++) { const match: Match = { id: makeId("m"), tournamentId: tournament.id, round, slot, playerA: null, playerB: null, winner: null, status: "pending", bracket: "losers" }; losers[round][slot] = match; matches.push(match); } };
    addLoserRound(1, size / 4);
    for (let round = 2; round <= rounds; round++) { addLoserRound(2 * round - 2, size / (2 ** round)); if (round < rounds) addLoserRound(2 * round - 1, size / (2 ** (round + 1))); }
    for (let round = 1; round < rounds; round++) for (const match of winners[round].slice(1)) { const next = winners[round + 1][Math.ceil(match.slot / 2)]; match.nextWinnerMatchId = next.id; match.nextWinnerSide = match.slot % 2 ? "playerA" : "playerB"; }
    for (const match of winners[1].slice(1)) { const next = losers[1][Math.ceil(match.slot / 2)]; match.nextLoserMatchId = next.id; match.nextLoserSide = match.slot % 2 ? "playerA" : "playerB"; }
    for (let round = 2; round <= rounds; round++) for (const match of winners[round].slice(1)) { const next = round === rounds ? null : winners[round + 1][Math.ceil(match.slot / 2)]; if (next) { match.nextWinnerMatchId = next.id; match.nextWinnerSide = match.slot % 2 ? "playerA" : "playerB"; } const drop = losers[2 * round - 2][match.slot]; match.nextLoserMatchId = drop.id; match.nextLoserSide = "playerB"; }
    for (let round = 1; round < 2 * rounds - 2; round++) for (const match of (losers[round] ?? []).slice(1)) { const nextRound = round + 1; const next = losers[nextRound]?.[round % 2 === 1 ? match.slot : Math.ceil(match.slot / 2)]; if (next) { match.nextWinnerMatchId = next.id; match.nextWinnerSide = round % 2 === 1 ? "playerA" : (match.slot % 2 ? "playerA" : "playerB"); } }
    const final: Match = { id: makeId("m"), tournamentId: tournament.id, round: 1, slot: 1, playerA: null, playerB: null, winner: null, status: "pending", bracket: "final" }; matches.push(final);
    winners[rounds][1].nextWinnerMatchId = final.id; winners[rounds][1].nextWinnerSide = "playerA";
    losers[2 * rounds - 2][1].nextWinnerMatchId = final.id; losers[2 * rounds - 2][1].nextWinnerSide = "playerB";
  } else {
    for (let round = 1; round < rounds; round++) for (const match of winners[round].slice(1)) { const next = winners[round + 1][Math.ceil(match.slot / 2)]; match.nextWinnerMatchId = next.id; match.nextWinnerSide = match.slot % 2 ? "playerA" : "playerB"; }
  }
  for (let pass = 0; pass < rounds; pass++) for (const match of matches) if (match.status === "pending" && (Boolean(match.playerA) !== Boolean(match.playerB)) && !matches.some(source => source.status !== "completed" && (source.nextWinnerMatchId === match.id || source.nextLoserMatchId === match.id))) { match.winner = match.playerA || match.playerB; match.status = "completed"; const next = matches.find(candidate => candidate.id === match.nextWinnerMatchId); if (next && match.nextWinnerSide && match.winner) next[match.nextWinnerSide] = match.winner; }
  return matches;
}

function buildSwissRound(tournament: Tournament, entrants: Entrant[], history: Match[], round: number, randomize = false): Match[] {
  const points = new Map(entrants.map(entrant => [entrant.playerId, 0]));
  const opponents = new Map(entrants.map(entrant => [entrant.playerId, new Set<string>()]));
  const byes = new Set<string>();
  for (const match of history.filter(item => item.tournamentId === tournament.id && item.bracket === "swiss" && item.status === "completed")) {
    if (match.winner) points.set(match.winner, (points.get(match.winner) || 0) + 1);
    if (match.playerA && match.playerB) { opponents.get(match.playerA)?.add(match.playerB); opponents.get(match.playerB)?.add(match.playerA); }
    else if (match.winner) byes.add(match.winner);
  }
  const buchholz = (id: string) => [...(opponents.get(id) || [])].reduce((total, opponent) => total + (points.get(opponent) || 0), 0);
  const ordered = randomize ? [...entrants].sort(() => Math.random() - 0.5) : [...entrants].sort((a,b) => (points.get(b.playerId)||0)-(points.get(a.playerId)||0) || buchholz(b.playerId)-buchholz(a.playerId) || a.seed-b.seed);
  let bye: Entrant | undefined;
  if (ordered.length % 2) {
    const byeIndex = randomize ? ordered.length - 1 : [...ordered].reverse().findIndex(entrant => !byes.has(entrant.playerId));
    const index = randomize ? byeIndex : byeIndex < 0 ? ordered.length - 1 : ordered.length - 1 - byeIndex;
    bye = ordered.splice(index, 1)[0];
  }
  const matches: Match[] = [];
  while (ordered.length >= 2) {
    const first = ordered.shift()!;
    const opponentIndex = ordered.findIndex(candidate => !opponents.get(first.playerId)?.has(candidate.playerId));
    const second = ordered.splice(opponentIndex < 0 ? 0 : opponentIndex, 1)[0];
    matches.push({ id: makeId("m"), tournamentId: tournament.id, round, slot: matches.length + 1, playerA: first.playerId, playerB: second.playerId, winner: null, status: "pending", bracket: "swiss" });
  }
  if (bye) matches.push({ id: makeId("m"), tournamentId: tournament.id, round, slot: matches.length + 1, playerA: bye.playerId, playerB: null, winner: bye.playerId, status: "completed", bracket: "swiss" });
  return matches;
}

function rankSwissEntrants(entrants: Entrant[], matches: Match[]): Entrant[] {
  const wins = new Map(entrants.map(entrant => [entrant.playerId, 0]));
  const opponents = new Map(entrants.map(entrant => [entrant.playerId, new Set<string>()]));
  for (const match of matches.filter(item => item.bracket === "swiss" && item.status === "completed")) {
    if (match.winner) wins.set(match.winner, (wins.get(match.winner) || 0) + 1);
    if (match.playerA && match.playerB) { opponents.get(match.playerA)?.add(match.playerB); opponents.get(match.playerB)?.add(match.playerA); }
  }
  const buchholz = (id: string) => [...(opponents.get(id) || [])].reduce((total, opponent) => total + (wins.get(opponent) || 0), 0);
  return [...entrants].sort((a,b) => (wins.get(b.playerId)||0)-(wins.get(a.playerId)||0) || buchholz(b.playerId)-buchholz(a.playerId) || a.seed-b.seed);
}

export default function App() {
  const [state, setState] = useState<State>(loadState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const tournamentActionQueue = useRef<Promise<void>>(Promise.resolve());
  const [session, setSession] = useState<Session | null>(null);
  const [supabaseRole, setSupabaseRole] = useState<"admin" | "cost_manager" | "player">("player");
  const [profileAvatarId, setProfileAvatarId] = useState<string>("anby");
  const [profileNickname, setProfileNickname] = useState<string>("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [costConfigReady, setCostConfigReady] = useState(false);
  const lastCostConfigSnapshot = useRef("");
  const [sharedTournamentsReady, setSharedTournamentsReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [passwordRecoveryOpen, setPasswordRecoveryOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [judgeToken] = useState(() => new URLSearchParams(window.location.search).get("judge"));
  const [page, setPage] = useState(() => {
    if (new URLSearchParams(window.location.search).has("judge") || new URLSearchParams(window.location.search).has("room")) return "drafts";
    try { const saved = localStorage.getItem(PAGE_STORAGE_KEY); return !saved || saved === "tournaments" ? "home" : saved; } catch { return "home"; }
  });
  const [globalDraftRules, setGlobalDraftRules] = useState<GlobalDraftRules>(defaultGlobalDraftRules);
  const [roleLoadedForUser, setRoleLoadedForUser] = useState("");
  const [selectedTournament, setSelectedTournament] = useState("t-1");
  const [draftRoomToOpen, setDraftRoomToOpen] = useState<string | null>(() => new URLSearchParams(window.location.search).get("room"));
  const [ownedRosters, setOwnedRosters] = useState<RegisteredRoster[]>([]);
  const [joinRosterTournament, setJoinRosterTournament] = useState<Tournament | null>(null);
  const [selectedRegistrationRosterId, setSelectedRegistrationRosterId] = useState("");
  const [viewEntrantRoster, setViewEntrantRoster] = useState<Entrant | null>(null);
  const [rostersLoading, setRostersLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [createdDraftRooms, setCreatedDraftRooms] = useState<CreatedDraftRoom[]>([]);
  const [auditEntries, setAuditEntries] = useState<Array<{id:string; tournament_id:string; action:string; actor_nickname:string|null; created_at:string}>>([]);
  const [search, setSearch] = useState("");
  const [newTournament, setNewTournament] = useState({ name: "", description: "", maxPlayers: 16, draftUrl: "", costLimit: 10, preBanEvery: 5, format: "single_elimination" as "single_elimination"|"double_elimination", swissStage: false, swissRounds: 3 });
  const sharedLoadRef = useRef(false);
  const sharedSyncTimer = useRef<number | null>(null);
  const lastSharedSnapshot = useRef("");
  const [authMode, setAuthMode] = useState<"login"|"register">("login");
  const [auth, setAuth] = useState({ nickname: "", password: "", avatarId: "anby" });
  const [showCreate, setShowCreate] = useState(false);
  const [editingCosts, setEditingCosts] = useState<"agents"|"engines">("agents");
  const [engineSearch, setEngineSearch] = useState("");
  const [agentClassFilter, setAgentClassFilter] = useState("Все классы");
  const [engineClassFilter, setEngineClassFilter] = useState("Все классы");
  const [registeredUsers, setRegisteredUsers] = useState<Array<{id:string; nickname:string; role:"admin"|"cost_manager"|"player"; is_super_admin?:boolean; created_at?:string}>>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState("agent-anby");
  const [agentPickerEngineId, setAgentPickerEngineId] = useState<string | null>(null);
  const [pendingAgentId, setPendingAgentId] = useState("");
  const localCurrent = state.players.find(p => p.id === state.currentPlayerId) || state.players[0];
  const current = { ...localCurrent, id: session?.user.id ?? localCurrent.id, nickname: profileNickname || (session?.user.user_metadata?.nickname as string) || session?.user.email?.split("@")[0] || localCurrent.nickname, avatarId: session ? profileAvatarId : localCurrent.avatarId, role: supabaseRole };
  const isAdmin = Boolean(session && supabaseRole === "admin");
  const isCostManager = Boolean(session && (supabaseRole === "admin" || supabaseRole === "cost_manager"));
  const activeTournament = state.tournaments.find(t => t.id === selectedTournament) || state.tournaments[0];

  useEffect(() => {
    if (!supabase) { setAuthOpen(true); setAuthReady(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthOpen(!data.session);
      setAuthReady(true);
    }).catch(() => { setAuthOpen(true); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setAuthOpen(!nextSession);
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecoveryOpen(true);
        setAuthOpen(false);
        setAuthError("");
        setAuthNotice("");
      }
      setAuthReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user.id || !supabase) { setNotifications([]); setCreatedDraftRooms([]); return; }
    let cancelled = false;
    const loadNotifications = async () => {
      const { data } = await supabase!.from("user_notifications").select("id,kind,title,message,created_at,read_at,room_id,tournament_id").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(25);
      if (!cancelled && data) setNotifications(data as UserNotification[]);
    };
    const loadCreatedRooms = async () => {
      const { data } = await supabase!.from("draft_rooms").select("id,title,status,tournament_id,tournament_match_id,created_at,player_one_id,player_two_id").eq("host_id", session.user.id).order("created_at", { ascending: false }).limit(100);
      if (!cancelled && data) setCreatedDraftRooms(data as CreatedDraftRoom[]);
    };
    void loadNotifications(); void loadCreatedRooms();
    const timer = window.setInterval(() => { void loadNotifications(); void loadCreatedRooms(); }, 20000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [session?.user.id]);

  useEffect(() => {
    if (page !== "admin" || !isAdmin || !supabase) { setAuditEntries([]); return; }
    let cancelled = false;
    void supabase.from("tournament_activity_log").select("id,tournament_id,action,created_at,profiles(nickname)").order("created_at", { ascending: false }).limit(50).then(({ data }) => {
      if (cancelled) return;
      if (data) setAuditEntries(data.map((row: any) => ({ id: row.id, tournament_id: row.tournament_id, action: row.action, created_at: row.created_at, actor_nickname: row.profiles?.nickname || null })));
    });
    return () => { cancelled = true; };
  }, [page, isAdmin]);

  useEffect(() => {
    let cancelled = false;
    if (!session?.user.id || !supabase) { setOwnedRosters([]); setRostersLoading(false); return; }
    setRostersLoading(true);
    void supabase.from("player_rosters").select("id,name,agent_ids,w_engine_ids,agent_levels,w_engine_levels").eq("player_id", session.user.id).order("updated_at", { ascending: false }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setNotice(`Не удалось загрузить личные ростеры: ${error.message}`);
      else setOwnedRosters((data || []) as RegisteredRoster[]);
      setRostersLoading(false);
    });
    return () => { cancelled = true; };
  }, [session?.user.id]);
  useEffect(() => {
    let cancelled = false;
    async function loadRole() {
      if (!supabase || !session?.user.id) { setSupabaseRole("player"); setIsSuperAdmin(false); setCostConfigReady(false); return; }
      setCostConfigReady(false);
      const { data, error } = await supabase.from("profiles").select("role,is_super_admin,avatar_id,nickname").eq("id", session.user.id).maybeSingle();
      if (!cancelled) {
        setSupabaseRole(!error && (data?.role === "admin" || data?.role === "cost_manager") ? data.role : "player");
        setIsSuperAdmin(Boolean(data?.is_super_admin));
        setProfileAvatarId(data?.avatar_id || "anby");
        setProfileNickname(data?.nickname || (session.user.user_metadata?.nickname as string) || session.user.email?.split("@")[0] || "Игрок");
        setRoleLoadedForUser(session.user.id);
      }
      if (!supabase || !session?.user.id) return;
      // Discard this browser's cached cost edits before loading the shared source.
      const canonical = {
        agents: Object.fromEntries(initialAgents.map(a => [a.id, { baseCost: a.baseCost, costs: a.costs }])),
        engines: Object.fromEntries(initialWEngines.map(w => [w.id, { baseCost: w.baseCost, rankCosts: w.rankCosts, offbuildCosts: w.offbuildCosts, agentCosts: w.agentCosts }])),
      };
      const applyCosts = (settings: any) => {
        const config = { agents: settings?.agents ?? {}, engines: settings?.engines ?? {} };
        const snapshot = stableJson(config);
        if (snapshot === lastCostConfigSnapshot.current) return;
        lastCostConfigSnapshot.current = snapshot;
        setState(prev => ({ ...prev,
          agents: prev.agents.map(a => ({ ...a, ...(config.agents[a.id] || {}) })),
          engines: prev.engines.map(w => ({ ...w, ...(config.engines[w.id] || {}) })),
        }));
      };
      setState(prev => ({ ...prev,
        agents: prev.agents.map(a => { const d=initialAgents.find(x=>x.id===a.id); return {...a,baseCost:d?.baseCost ?? a.baseCost,costs:d?.costs}; }),
        engines: prev.engines.map(w => { const d=initialWEngines.find(x=>x.id===w.id); return {...w,baseCost:d?.baseCost ?? w.baseCost,rankCosts:d?.rankCosts,offbuildCosts:d?.offbuildCosts,agentCosts:d?.agentCosts}; }),
      }));
      lastCostConfigSnapshot.current = stableJson(canonical);
      const { data: costRow, error: costError } = await supabase.from("system_settings").select("settings").eq("id", "cost_config").maybeSingle();
      if (cancelled) return;
      if (costError) {
        setNotice(`Не удалось загрузить общие косты: ${costError.message}. Проверь миграцию shared_cost_config.sql.`);
        return;
      }
      if (costRow?.settings) applyCosts(costRow.settings);
      setCostConfigReady(true);
    }
    loadRole();
    return () => { cancelled = true; };
  }, [session?.user.id]);
  useEffect(() => {
    try { localStorage.setItem(PAGE_STORAGE_KEY, page); } catch { /* ignore unavailable browser storage */ }
  }, [page]);
  useEffect(() => {
    if (!supabase || !session?.user.id) { setGlobalDraftRules(defaultGlobalDraftRules); return; }
    let cancelled = false;
    const applyRules = (settings: any) => setGlobalDraftRules({
      min_agents: Math.max(1, Number(settings?.min_agents) || defaultGlobalDraftRules.min_agents),
      min_roster_cost: Math.max(0, Number(settings?.min_roster_cost) || 0),
      max_roster_cost: settings?.max_roster_cost == null ? defaultGlobalDraftRules.max_roster_cost : Math.max(0, Number(settings.max_roster_cost) || 0),
      cost_difference_per_preban: Math.max(1, Number(settings?.cost_difference_per_preban) || defaultGlobalDraftRules.cost_difference_per_preban),
      turn_timer_seconds: Math.max(10, Math.min(600, Number(settings?.turn_timer_seconds) || defaultGlobalDraftRules.turn_timer_seconds)),
      reserve_time_seconds: Math.max(0, Math.min(300, settings?.reserve_time_seconds == null ? defaultGlobalDraftRules.reserve_time_seconds : Number(settings.reserve_time_seconds) || 0)),
    });
    void supabase.from("system_settings").select("settings").eq("id", "global_rules").maybeSingle().then(({ data, error }) => {
      if (!cancelled && !error && data?.settings) applyRules(data.settings);
    });
    const sb = supabase;
    const channel = sb.channel(`tournament-rules-${session.user.id}`).on("postgres_changes", { event:"UPDATE", schema:"public", table:"system_settings", filter:"id=eq.global_rules" }, payload => {
      if ((payload.new as any)?.settings) applyRules((payload.new as any).settings);
    }).subscribe();
    return () => { cancelled = true; void sb.removeChannel(channel); };
  }, [session?.user.id]);
  // Tournaments are shared through Supabase, not the per-browser demo localStorage.
  useEffect(() => {
    let cancelled = false;
    let loadDebounce: number | null = null;
    async function loadSharedTournamentsNow() {
      if (!session?.user.id || !supabase) { setSharedTournamentsReady(false); return; }
      const [{ data, error }, { data: requestRows, error: requestError }] = await Promise.all([
        supabase.from("community_tournaments").select("id,data,updated_at").order("updated_at", { ascending: false }),
        supabase.from("tournament_registration_requests").select("id,tournament_id,player_id,status,created_at,roster_id,roster_snapshot").order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      if (error) {
        setNotice(`Не удалось загрузить общие турниры: ${error.message}. Проверь SQL-миграцию.`);
        update(prev => ({ ...prev, tournaments: [] }));
      } else {
        const tournaments = (data || []).map((row: any) => ({ ...(row.data || {}), id: row.id })) as Tournament[];
        const sharedEntrants: Entrant[] = (data || []).flatMap((row: any) => Array.isArray(row.data?.entrants) ? row.data.entrants : []);
        const sharedMatches: Match[] = (data || []).flatMap((row: any) => Array.isArray(row.data?.matches) ? row.data.matches : []);
        const fetchedSnapshot = JSON.stringify({ tournaments, entrants: sharedEntrants, matches: sharedMatches });
        const currentState = stateRef.current;
        const currentSnapshot = JSON.stringify({ tournaments: currentState.tournaments, entrants: currentState.entrants, matches: currentState.matches });
        const hasUnsyncedLocalChanges = sharedLoadRef.current && currentSnapshot !== lastSharedSnapshot.current;
        const requests: RegistrationRequest[] = (requestRows || []).map((r: any) => ({ id:r.id, tournamentId:r.tournament_id, playerId:r.player_id, status:r.status, createdAt:r.created_at, savedRosterId:r.roster_id || undefined, registeredRoster:r.roster_snapshot || undefined }));
        if (!hasUnsyncedLocalChanges) lastSharedSnapshot.current = fetchedSnapshot;
        update(prev => ({ ...prev, ...(hasUnsyncedLocalChanges ? {} : { tournaments, entrants: sharedEntrants, matches: sharedMatches }), registrationRequests: requestError ? prev.registrationRequests : requests }));
        sharedLoadRef.current = true;
        if (!hasUnsyncedLocalChanges && selectedTournament && !tournaments.some(t => t.id === selectedTournament)) setSelectedTournament(tournaments[0]?.id || "");
        // Populate real profile names for requests submitted by registered Supabase users.
        const playerIds = [...new Set(requests.map(r => r.playerId))];
        if (playerIds.length) {
          const { data: profiles } = await supabase.from("profiles").select("id,nickname,avatar_id,role").in("id", playerIds);
          if (!cancelled && profiles?.length) update(prev => ({ ...prev, players: [...prev.players.filter(p => !playerIds.includes(p.id)), ...profiles.map((p:any) => ({ id:p.id, nickname:p.nickname || "Игрок", avatarId:p.avatar_id || "anby", role:p.role || "player" }))] }));
        }
        if (requestError) setNotice(`Не удалось загрузить заявки: ${requestError.message}. Выполни миграцию tournament_registration_requests.sql.`);
      }
      setSharedTournamentsReady(true);
    }
    function loadSharedTournaments() {
      if (loadDebounce !== null) window.clearTimeout(loadDebounce);
      loadDebounce = window.setTimeout(() => {
        loadDebounce = null;
        void enqueueTournamentAction(loadSharedTournamentsNow);
      }, 100);
    }
    void loadSharedTournaments();
    const timer = window.setInterval(() => { void loadSharedTournaments(); }, 10000);
    const sb = supabase; const activeSession = session;
    if (!sb || !activeSession) { return () => { cancelled = true; window.clearInterval(timer); }; }
    const channel = sb.channel(`tournament-sync-${activeSession.user.id}`).on("postgres_changes", { event: "*", schema: "public", table: "community_tournaments" }, () => { void loadSharedTournaments(); }).on("postgres_changes", { event: "*", schema: "public", table: "tournament_registration_requests" }, () => { void loadSharedTournaments(); }).subscribe();
    return () => { cancelled = true; window.clearInterval(timer); if (loadDebounce !== null) window.clearTimeout(loadDebounce); void sb.removeChannel(channel); };
  }, [session?.user.id]);
  useEffect(() => { saveState(state); }, [state]);
  // Tournament participants and bracket state are stored with the canonical tournament row,
  // so every authenticated client reads the same source of truth. Debounce local changes.
  useEffect(() => {
    if (!session?.user.id || !supabase || !sharedTournamentsReady || !sharedLoadRef.current) return;
    const snapshot = JSON.stringify({ tournaments: state.tournaments, entrants: state.entrants, matches: state.matches });
    if (snapshot === lastSharedSnapshot.current) return;
    if (sharedSyncTimer.current !== null) window.clearTimeout(sharedSyncTimer.current);
    sharedSyncTimer.current = window.setTimeout(() => {
      void enqueueTournamentAction(async () => {
        const latest = stateRef.current;
        const latestSnapshot = JSON.stringify({ tournaments: latest.tournaments, entrants: latest.entrants, matches: latest.matches });
        if (latestSnapshot === lastSharedSnapshot.current) return;
        let failed = false;
        for (const tournament of latest.tournaments) {
          const data = { ...tournament, entrants: latest.entrants.filter(e => e.tournamentId === tournament.id), matches: latest.matches.filter(m => m.tournamentId === tournament.id) };
          const { error } = await supabase!.from("community_tournaments").update({ data, updated_at: new Date().toISOString() }).eq("id", tournament.id);
          if (error) { failed = true; console.warn("Tournament sync failed", tournament.id, error.message); }
        }
        if (!failed) lastSharedSnapshot.current = latestSnapshot;
      });
    }, 650);
    return () => { if (sharedSyncTimer.current !== null) window.clearTimeout(sharedSyncTimer.current); };
  }, [state.tournaments, state.entrants, state.matches, session?.user.id, sharedTournamentsReady]);
  useEffect(() => {
    if (!session?.user.id || !costConfigReady || !supabase || !isCostManager) return;
    const agents = Object.fromEntries(state.agents.map(a => [a.id, {baseCost:a.baseCost,costs:a.costs}]));
    const engines = Object.fromEntries(state.engines.map(w => [w.id, {baseCost:w.baseCost,rankCosts:w.rankCosts,offbuildCosts:w.offbuildCosts,agentCosts:w.agentCosts}]));
    const snapshot = stableJson({ agents, engines });
    if (snapshot === lastCostConfigSnapshot.current) return;
    const sb = supabase;
    const timer = window.setTimeout(async () => {
      if (!sb) return;
      const { error } = await sb
        .from("system_settings")
        .upsert({ id:"cost_config", settings:{agents,engines}, updated_by:session.user.id, updated_at:new Date().toISOString() }, { onConflict:"id" });
      if (error) {
        setNotice(`Не удалось сохранить общие косты: ${error.message}`);
      } else {
        lastCostConfigSnapshot.current = snapshot;
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [state.agents, state.engines, session?.user.id, costConfigReady, isCostManager]);
  useEffect(() => {
    if (!session?.user.id || !supabase || !costConfigReady) return;
    const sb = supabase;
    const channel = sb.channel("shared-cost-config")
      .on("postgres_changes", { event:"UPDATE", schema:"public", table:"system_settings", filter:"id=eq.cost_config" }, payload => {
        const settings = (payload.new as any)?.settings;
        if (!settings) return;
        const snapshot = stableJson({ agents:settings.agents ?? {}, engines:settings.engines ?? {} });
        if (snapshot === lastCostConfigSnapshot.current) return;
        lastCostConfigSnapshot.current = snapshot;
        setState(prev => ({ ...prev,
          agents: prev.agents.map(a => ({ ...a, ...(settings.agents?.[a.id] || {}) })),
          engines: prev.engines.map(w => ({ ...w, ...(settings.engines?.[w.id] || {}) })),
        }));
      }).subscribe();
    return () => { void sb.removeChannel(channel); };
  }, [session?.user.id, costConfigReady]);
  useEffect(() => {
    const permissionsResolved = session ? roleLoadedForUser === session.user.id : authReady;
    if (!permissionsResolved) return;
    if (page === "admin" && !isAdmin) setPage("tournaments");
    else if ((page === "costs" || page === "rules") && !isCostManager) setPage("tournaments");
  }, [page, isAdmin, isCostManager, session?.user.id, roleLoadedForUser, authReady]);
  useEffect(() => {
    let cancelled = false;
    async function loadUsers() {
      if (page !== "admin" || !isAdmin || !supabase) return;
      setUsersLoading(true);
      const { data, error } = await supabase.from("profiles").select("id,nickname,role,is_super_admin,created_at").order("created_at", { ascending: false });
      if (!cancelled) {
        if (error) setNotice(`Не удалось загрузить список игроков: ${error.message}`);
        else setRegisteredUsers((data || []) as typeof registeredUsers);
        setUsersLoading(false);
      }
    }
    void loadUsers();
    return () => { cancelled = true; };
  }, [page, isAdmin, session?.user.id]);
  async function changePlayerRole(userId: string, role: "admin"|"cost_manager"|"player") {
    if (!supabase || !isAdmin || registeredUsers.find(u=>u.id===userId && (u as any).is_super_admin) || userId === session?.user.id && role !== "admin") {
      setNotice("Нельзя снять роль администратора у текущего аккаунта."); return;
    }
    const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
    if (error) { setNotice(`Не удалось изменить роль: ${error.message}`); return; }
    setRegisteredUsers(users => users.map(user => user.id === userId ? { ...user, role } : user));
    setNotice("Роль игрока обновлена.");
  }
  async function selectProfileAvatar(avatarId: string) {
    if (session && supabase) {
      const { error } = await supabase.from("profiles").update({ avatar_id: avatarId }).eq("id", session.user.id);
      if (error) { setNotice(`Не удалось сохранить аватар: ${error.message}`); return; }
      setProfileAvatarId(avatarId);
    } else {
      update(s => ({...s,players:s.players.map(p=>p.id===current.id?{...p,avatarId}:p)}));
    }
    setNotice("Аватар обновлён.");
  }
  async function saveProfile() {
    const nick=(auth.nickname||current.nickname).trim();
    if(nick.length<3){setNotice("Ник слишком короткий.");return;}
    if(state.players.some(p=>p.id!==current.id&&p.nickname.toLowerCase()===nick.toLowerCase())){setNotice("Такой ник уже занят.");return;}
    if(session && supabase){
      const {error}=await supabase.from("profiles").update({nickname:nick}).eq("id",session.user.id);
      if(error){setNotice(`Не удалось сохранить профиль: ${error.message}`);return;}
      const {error:metaError}=await supabase.auth.updateUser({data:{nickname:nick}});
      if(metaError){setNotice(`Ник сохранён в профиле, но метаданные аккаунта не обновились: ${metaError.message}`);return;}
      setProfileNickname(nick);
    } else {
      update(s=>({...s,players:s.players.map(p=>p.id===current.id?{...p,nickname:nick}:p)}));
    }
    setAuth(a=>({...a,nickname:""}));setNotice("Профиль обновлён.");
  }
  async function deleteTournament(t: Tournament) {
    await enqueueTournamentAction(() => deleteTournamentNow(t));
  }
  async function deleteTournamentNow(t: Tournament) {
    const liveTournament = stateRef.current.tournaments.find(item => item.id === t.id);
    if (!liveTournament) return;
    t = liveTournament;
    if (!isAdmin || !window.confirm(`Удалить турнир «${t.name}» и связанные с ним заявки, участников и матчи?`)) return;
    if (session && supabase) {
      const { error } = await supabase.from("community_tournaments").delete().eq("id", t.id);
      if (error) { setNotice(`Не удалось удалить общий турнир: ${error.message}`); return; }
    }
    update(s => ({ ...s, tournaments: s.tournaments.filter(item => item.id !== t.id), entrants: s.entrants.filter(item => item.tournamentId !== t.id), matches: s.matches.filter(item => item.tournamentId !== t.id), registrationRequests: s.registrationRequests.filter(item => item.tournamentId !== t.id) }));
    if (selectedTournament === t.id) setSelectedTournament(stateRef.current.tournaments.find(item => item.id !== t.id)?.id || "");
    setNotice(session ? "Турнир удалён для всех пользователей." : "Турнир удалён в демо-режиме.");
  }
  useEffect(() => { if (notice) { const t = setTimeout(() => setNotice(""), 3200); return () => clearTimeout(t); } }, [notice]);
  const entrantsFor = (id: string) => state.entrants.filter(e => e.tournamentId === id);
  const playerById = (id: string | null) => {
    const player = state.players.find(p => p.id === id);
    if (player || !id) return player;
    const testEntrant = state.entrants.find(e => e.playerId === id && e.testBot);
    return testEntrant ? { id, nickname: testEntrant.testName || "Тестовый игрок", avatarId: "anby", role: "player" as const } : undefined;
  };
  const activeTournamentFinal = activeTournament ? state.matches.find(m => m.tournamentId === activeTournament.id && m.bracket === "final" && m.status === "completed") : undefined;
  const activeTournamentChampion = activeTournamentFinal?.winner ? playerById(activeTournamentFinal.winner) : undefined;
  const update = (fn: (s: State) => State) => {
    const next = fn(structuredClone(stateRef.current));
    stateRef.current = next;
    setState(next);
  };
  function enqueueTournamentAction<T>(work: () => Promise<T> | T): Promise<T> {
    const task = tournamentActionQueue.current.then(work, work);
    tournamentActionQueue.current = task.then(() => undefined, () => undefined);
    return task;
  }
  async function loginOrRegister() {
    if (!supabase || !isSupabaseConfigured) {
      setAuthError("Supabase не настроен. Заполни VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в .env.local.");
      return;
    }
    if (!authEmail.trim() || !auth.password) {
      setAuthError("Введи почту и пароль.");
      return;
    }
    setAuthBusy(true); setAuthError("");
    try {
      if (authMode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: auth.password,
          options: { data: { nickname: auth.nickname.trim() || authEmail.trim().split("@")[0] } }
        });
        if (error) throw error;
        if (!data.session) setAuthError("Аккаунт создан. Проверь почту для подтверждения, затем войди.");
        else { setAuthOpen(false); setPage("home"); setNotice("Вход выполнен."); }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: auth.password });
        if (error) throw error;
        setAuthOpen(false); setPage("home"); setNotice("Вход выполнен.");
      }
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Не удалось выполнить авторизацию.");
    } finally { setAuthBusy(false); }
  }
  async function sendPasswordReset() {
    if (!supabase || !isSupabaseConfigured) { setAuthError("Supabase не настроен."); return; }
    if (!authEmail.trim()) { setAuthError("Введи почту, на которую зарегистрирован аккаунт."); return; }
    setAuthBusy(true); setAuthError(""); setAuthNotice("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(authEmail.trim(), { redirectTo: window.location.origin });
      if (error) throw error;
      setAuthNotice("Если аккаунт с такой почтой существует, на неё отправлено письмо со ссылкой для сброса пароля.");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Не удалось отправить письмо для сброса пароля.");
    } finally { setAuthBusy(false); }
  }
  async function saveRecoveredPassword() {
    if (!supabase) return;
    if (newPassword.length < 6) { setAuthError("Новый пароль должен содержать не менее 6 символов."); return; }
    if (newPassword !== confirmNewPassword) { setAuthError("Пароли не совпадают."); return; }
    setAuthBusy(true); setAuthError("");
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordRecoveryOpen(false); setAuthOpen(false); setNewPassword(""); setConfirmNewPassword("");
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      setNotice("Пароль успешно изменён.");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Не удалось обновить пароль.");
    } finally { setAuthBusy(false); }
  }
  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setSession(null); setSupabaseRole("player"); setAuthMode("login"); setAuthOpen(true);
  }
  async function createTournament() {
    if (!newTournament.name.trim()) { setNotice("Укажи название турнира."); return; }
    const t: Tournament = { id: makeId("t"), name: newTournament.name.trim(), description: newTournament.description.trim(), maxPlayers: Math.max(2, Number(newTournament.maxPlayers) || 2), status: "registration", draftUrl: newTournament.draftUrl.trim(), rules: "", costLimit: Number(newTournament.costLimit) || 0, preBanEvery: Number(newTournament.preBanEvery) || 0, mirrorsEnabled: true, mirrorStage: "Последний пик каждого игрока", createdAt: new Date().toISOString(), format: newTournament.format, swissStage: newTournament.swissStage, swissRounds: newTournament.swissRounds };
    if (session && supabase) {
      if (!sharedTournamentsReady) { setNotice("Общие турниры ещё загружаются. Попробуй снова через несколько секунд."); return; }
      const { error } = await supabase.from("community_tournaments").insert({ id: t.id, data: t, created_by: session.user.id });
      if (error) { setNotice(`Не удалось создать общий турнир: ${error.message}`); return; }
    }
    update(s => ({ ...s, tournaments: [t, ...s.tournaments] }));
    setSelectedTournament(t.id); setShowCreate(false); setPage("tournament"); setNotice(session ? "Турнир создан и доступен всем пользователям." : "Турнир создан в демо-режиме.");
  }
  async function joinTournament(t: Tournament) {
    if (t.status !== "registration") {
      setNotice("Регистрация на этот турнир закрыта.");
      return;
    }
    if (entrantsFor(t.id).some(e => e.playerId === current.id)) {
      setNotice("Ты уже участвуешь в этом турнире.");
      return;
    }
    if (entrantsFor(t.id).length >= t.maxPlayers) {
      setNotice("Мест больше нет.");
      return;
    }
    const existingRequest = state.registrationRequests.some(
      r => r.tournamentId === t.id && r.playerId === current.id && r.status === "pending"
    );
    if (existingRequest) {
      setNotice("Твоя заявка уже ожидает рассмотрения.");
      return;
    }
    if (session && supabase) {
      setRostersLoading(true);
      const [{ data, error }, { data: inventory }] = await Promise.all([
        supabase.from("player_rosters").select("id,name,agent_ids,w_engine_ids,agent_levels,w_engine_levels").eq("player_id", session.user.id).order("updated_at", { ascending: false }),
        supabase.from("player_account_inventory").select("agent_levels").eq("player_id", session.user.id).maybeSingle(),
      ]);
      setRostersLoading(false);
      if (error) { setNotice(`Не удалось загрузить ростеры: ${error.message}`); return; }
      const currentLevels = (inventory?.agent_levels || {}) as Record<string, number>;
      const choices = (data || []).map(roster => ({ ...roster, agent_levels: { ...(roster.agent_levels || {}), ...currentLevels } })) as RegisteredRoster[];
      setOwnedRosters(choices);
      if (!choices.length) { setNotice("Сначала создай и сохрани ростер в разделе «Мои ростеры»."); return; }
      setJoinRosterTournament(t);
      setSelectedRegistrationRosterId(choices[0].id);
      return;
    }
    const requestId = makeId("req");
    const createdAt = new Date().toISOString();
    if (session && supabase) {
      const { error } = await supabase.from("tournament_registration_requests").insert({ id:requestId, tournament_id:t.id, player_id:session.user.id, status:"pending", created_at:createdAt });
      if (error) { setNotice(`Не удалось отправить заявку: ${error.message}. Проверь SQL-миграцию заявок.`); return; }
    }
    update(s => ({ ...s, registrationRequests: [...s.registrationRequests, { id:requestId, tournamentId:t.id, playerId:current.id, status:"pending", createdAt }] }));
    setNotice("Заявка отправлена организатору!");
  }
  async function submitTournamentRegistration() {
    const tournament = joinRosterTournament;
    const roster = ownedRosters.find(item => item.id === selectedRegistrationRosterId);
    if (!tournament || !roster) { setNotice("Выбери сохранённый ростер для регистрации."); return; }
    if (roster.agent_ids.length < globalDraftRules.min_agents) { setNotice(`В ростере должно быть минимум ${globalDraftRules.min_agents} агентов.`); return; }
    const totalCost = roster.agent_ids.reduce((sum, id) => sum + getAgentCost(state.agents.find(item => item.id === id), roster.agent_levels?.[id] ?? 0), 0);
    if (totalCost < globalDraftRules.min_roster_cost || totalCost > globalDraftRules.max_roster_cost) { setNotice(`Кост ростера должен быть от ${globalDraftRules.min_roster_cost} до ${globalDraftRules.max_roster_cost}.`); return; }
    const requestId = makeId("req");
    const createdAt = new Date().toISOString();
    const registeredRoster: RegisteredRoster = { id: roster.id, name: roster.name, agent_ids: [...roster.agent_ids], w_engine_ids: [...roster.w_engine_ids], agent_levels: { ...(roster.agent_levels || {}) }, w_engine_levels: { ...(roster.w_engine_levels || {}) } };
    if (session && supabase) {
      const { data, error } = await supabase.from("tournament_registration_requests").insert({ id:requestId, tournament_id:tournament.id, player_id:session.user.id, status:"pending", created_at:createdAt, roster_id:roster.id, roster_snapshot:registeredRoster }).select("roster_id,roster_snapshot").single();
      if (error) { setNotice(`Не удалось отправить заявку: ${error.message}. Примени миграцию supabase/tournament_registration_rosters.sql.`); return; }
      if (data?.roster_snapshot) Object.assign(registeredRoster, data.roster_snapshot);
    }
    update(s => ({ ...s, registrationRequests: [...s.registrationRequests, { id:requestId, tournamentId:tournament.id, playerId:current.id, status:"pending", createdAt, savedRosterId:roster.id, registeredRoster }] }));
    setJoinRosterTournament(null);
    setNotice(`Заявка отправлена с ростером «${roster.name}».`);
  }
  async function approveRequest(request: RegistrationRequest) {
    await enqueueTournamentAction(() => approveRequestNow(request));
  }
  async function approveRequestNow(request: RegistrationRequest) {
    if (!isAdmin) {
      setNotice("Только организатор может одобрять заявки.");
      return;
    }
    const liveState = stateRef.current;
    const liveRequest = liveState.registrationRequests.find(item => item.id === request.id);
    if (!liveRequest || liveRequest.status !== "pending") return;
    request = { ...request, ...liveRequest };
    const tournament = liveState.tournaments.find(t => t.id === request.tournamentId);
    if (!tournament || tournament.status !== "registration") {
      setNotice("Регистрация на этот турнир закрыта.");
      return;
    }
    const entrants = liveState.entrants.filter(e => e.tournamentId === request.tournamentId);
    if (entrants.some(e => e.playerId === request.playerId)) {
      update(s => ({
        ...s,
        registrationRequests: s.registrationRequests.filter(r => r.id !== request.id),
      }));
      setNotice("Игрок уже участвует в турнире.");
      return;
    }
    if (entrants.length >= tournament.maxPlayers) {
      setNotice("Свободных мест больше нет.");
      return;
    }
    const newEntrant: Entrant = { id: makeId("e"), tournamentId: request.tournamentId, playerId: request.playerId, seed: entrants.length + 1, savedRosterId: request.savedRosterId, registeredRoster: request.registeredRoster };
    if (session && supabase) {
      // Persist the entrant in the canonical tournament row before changing the request.
      // Request Realtime can trigger a full tournament reload immediately after approval;
      // if the entrant only exists in local state, that reload removes them again.
      const { data: tournamentRow, error: readError } = await supabase.from("community_tournaments").select("data").eq("id", tournament.id).single();
      if (readError || !tournamentRow) { setNotice(`Не удалось загрузить данные турнира: ${readError?.message || "запись не найдена"}`); return; }
      const currentData = (tournamentRow.data || {}) as Tournament & { entrants?: Entrant[]; matches?: Match[] };
      const currentEntrants = Array.isArray(currentData.entrants) ? currentData.entrants : [];
      if (currentEntrants.some(e => e.playerId === request.playerId)) {
        setNotice("Игрок уже участвует в турнире.");
        return;
      }
      if (currentEntrants.length >= tournament.maxPlayers) { setNotice("Свободных мест больше нет."); return; }
      const persistedEntrants = [...currentEntrants, { ...newEntrant, seed: currentEntrants.length + 1 }];
      const nextData = { ...currentData, id: tournament.id, entrants: persistedEntrants };
      const { error: entrantError } = await supabase.from("community_tournaments").update({ data: nextData, updated_at: new Date().toISOString() }).eq("id", tournament.id);
      if (entrantError) { setNotice(`Не удалось сохранить участника турнира: ${entrantError.message}`); return; }
      const { error: requestError } = await supabase.from("tournament_registration_requests").update({ status:"approved" }).eq("id", request.id).eq("status", "pending");
      if (requestError) {
        setNotice(`Участник сохранён, но не удалось обновить статус заявки: ${requestError.message}`);
        void supabase.from("community_tournaments").update({ data: { ...nextData, entrants: currentEntrants }, updated_at: new Date().toISOString() }).eq("id", tournament.id);
        return;
      }
      lastSharedSnapshot.current = JSON.stringify({
        tournaments: liveState.tournaments.map(t => t.id === tournament.id ? { ...t, ...nextData } : t),
        entrants: [...liveState.entrants.filter(e => e.tournamentId !== tournament.id), ...persistedEntrants],
        matches: liveState.matches,
      });
      newEntrant.seed = persistedEntrants.length;
    }
    update(s => ({
      ...s,
      entrants: s.entrants.some(e => e.tournamentId === request.tournamentId && e.playerId === request.playerId)
        ? s.entrants
        : [...s.entrants, newEntrant],
      registrationRequests: s.registrationRequests.map(r => r.id === request.id ? { ...r, status:"approved" as const } : r),
    }));
    setNotice("Заявка одобрена. Игрок добавлен в турнир.");
  }
  async function rejectRequest(request: RegistrationRequest) {
    await enqueueTournamentAction(() => rejectRequestNow(request));
  }
  async function rejectRequestNow(request: RegistrationRequest) {
    if (!isAdmin) return;
    const liveRequest = stateRef.current.registrationRequests.find(item => item.id === request.id);
    if (!liveRequest || liveRequest.status !== "pending") return;
    if (session && supabase) {
      const { error } = await supabase.from("tournament_registration_requests").update({ status:"rejected" }).eq("id", request.id).eq("status", "pending");
      if (error) { setNotice(`Не удалось отклонить заявку: ${error.message}`); return; }
    }
    update(s => ({ ...s, registrationRequests: s.registrationRequests.map(r => r.id === request.id ? { ...r, status:"rejected" as const } : r) }));
    setNotice("Заявка отклонена. Игрок сможет подать её повторно.");
  }
  async function ensureTournamentDraftRoom(t: Tournament, match: Match, sourceRoomId?: string | null) {
    if (!session || !supabase || !match.playerA || !match.playerB || match.roomId) return match.roomId;
    const { data: templateRow, error: templateError } = await supabase.from("global_draft_template").select("template").eq("id", 1).maybeSingle();
    if (templateError) throw new Error(`Не удалось загрузить шаблон драфта: ${templateError.message}`);
    const { data: rulesRow } = await supabase.from("system_settings").select("settings").eq("id", "global_rules").maybeSingle();
    const template = Array.isArray(templateRow?.template?.steps) && templateRow.template.steps.length ? templateRow.template.steps : [{side:"I1",action:"ban",count:1},{side:"I2",action:"ban",count:1},{side:"I1",action:"pick",count:1},{side:"I2",action:"pick",count:1},{side:"I1",action:"pick",count:2},{side:"I2",action:"pick",count:2},{side:"I1",action:"pick",count:1},{side:"I2",action:"ban",count:1},{side:"I1",action:"ban",count:1},{side:"I2",action:"pick",count:2},{side:"I1",action:"pick",count:2},{side:"I2",action:"mirror",count:1},{side:"I1",action:"mirror",count:1}];
    const rosterOne = stateRef.current.entrants.find(e => e.tournamentId === t.id && e.playerId === match.playerA)?.registeredRoster || null;
    const rosterTwo = stateRef.current.entrants.find(e => e.tournamentId === t.id && e.playerId === match.playerB)?.registeredRoster || null;
    if (!rosterOne || !rosterTwo) throw new Error("У одного из участников нет ростера, закреплённого при регистрации. Повторно добавь участника в турнир с выбранным ростером.");
    const { data, error } = await supabase.rpc("create_tournament_draft_room", { p_tournament_id: t.id, p_match_id: match.id, p_player_one: match.playerA, p_player_two: match.playerB, p_title: `${t.name} · ${match.bracket === "losers" ? "Нижняя сетка" : match.bracket === "reset" ? "Решающий матч" : "Матч"} ${match.round}.${match.slot}`, p_template_snapshot: template, p_min_agents: Number(rulesRow?.settings?.min_agents) || 5, p_source_room_id: sourceRoomId || null, p_roster_one_snapshot: rosterOne, p_roster_two_snapshot: rosterTwo });
    if (error) throw new Error(`Не удалось создать комнату матча ${match.round}.${match.slot}: ${error.message}. Примени supabase/tournament_draft_rooms.sql.`);
    const room = Array.isArray(data) ? data[0] : data; return room?.id as string | undefined;
  }
  async function openTournamentMatchDraft(match: Match) {
    let roomId = match.roomId || null;
    if (!roomId && supabase) {
      const { data, error } = await supabase.from("draft_rooms").select("id").eq("tournament_match_id", match.id).maybeSingle();
      if (error) { setNotice(`Не удалось найти комнату матча: ${error.message}`); return; }
      roomId = data?.id || null;
      if (roomId) update(s => ({ ...s, matches: s.matches.map(item => item.id === match.id ? { ...item, roomId } : item) }));
    }
    if (!roomId && isAdmin && supabase) {
      const tournament = state.tournaments.find(item => item.id === match.tournamentId);
      if (tournament) {
        try { roomId = (await ensureTournamentDraftRoom(tournament, match)) || null; if (roomId) update(s => ({ ...s, matches: s.matches.map(item => item.id === match.id ? { ...item, roomId } : item) })); }
        catch (e) { setNotice(e instanceof Error ? e.message : "Не удалось создать комнату этого матча."); return; }
      }
    }
    if (!roomId) { setNotice("Комната этого матча ещё не создана. Организатору нужно применить миграцию supabase/tournament_draft_rooms.sql и пересоздать сетку."); return; }
    setDraftRoomToOpen(roomId);
    setPage("drafts");
  }
  async function addTournamentTestEntrants(tournament: Tournament) {
    await enqueueTournamentAction(() => addTournamentTestEntrantsNow(tournament));
  }
  async function addTournamentTestEntrantsNow(requestedTournament: Tournament) {
    if (!isAdmin) return;
    const tournament = stateRef.current.tournaments.find(t => t.id === requestedTournament.id);
    if (!tournament || tournament.status !== "registration") return;
    const currentEntrants = stateRef.current.entrants.filter(e => e.tournamentId === tournament.id);
    if (currentEntrants.some(e => e.testBot)) { setNotice("Тестовые участники уже добавлены в этот турнир."); return; }
    if (currentEntrants.length + 14 > tournament.maxPlayers) { setNotice(`Для 14 тестовых участников нужно ${14 - Math.max(0, tournament.maxPlayers - currentEntrants.length)} дополнительных мест.`); return; }
    const testEntrants: Entrant[] = Array.from({ length: 14 }, (_, index) => ({
      id: makeId("test-entrant"), tournamentId: tournament.id, playerId: crypto.randomUUID(),
      seed: currentEntrants.length + index + 1, testBot: true,
      testName: `Тестовый игрок ${String(index + 1).padStart(2, "0")}`,
    }));
    let canonicalEntrants = currentEntrants;
    if (session && supabase) {
      const { data: row, error: readError } = await supabase.from("community_tournaments").select("data").eq("id", tournament.id).single();
      if (readError || !row) { setNotice(`Не удалось загрузить турнир: ${readError?.message || "запись не найдена"}`); return; }
      const currentData = (row.data || {}) as Tournament & { entrants?: Entrant[]; matches?: Match[] };
      canonicalEntrants = Array.isArray(currentData.entrants) ? currentData.entrants : [];
      if (canonicalEntrants.some(e => e.testBot)) { setNotice("Тестовые участники уже добавлены в этот турнир."); return; }
      if (canonicalEntrants.length + 14 > tournament.maxPlayers) { setNotice("В турнире недостаточно свободных мест для 14 тестовых участников."); return; }
      const persistedEntrants = [...canonicalEntrants, ...testEntrants.map((entrant, index) => ({ ...entrant, seed: canonicalEntrants.length + index + 1 }))];
      const nextData = { ...currentData, id: tournament.id, entrants: persistedEntrants };
      const { error } = await supabase.from("community_tournaments").update({ data: nextData, updated_at: new Date().toISOString() }).eq("id", tournament.id);
      if (error) { setNotice(`Не удалось добавить тестовых участников: ${error.message}`); return; }
      canonicalEntrants = persistedEntrants;
      update(prev => ({ ...prev,
        tournaments: prev.tournaments.map(t => t.id === tournament.id ? { ...t, ...nextData } : t),
        entrants: [...prev.entrants.filter(e => e.tournamentId !== tournament.id), ...persistedEntrants],
      }));
    } else {
      update(s => ({ ...s, entrants: [...s.entrants, ...testEntrants] }));
    }
    setNotice("Добавлено 14 тестовых участников. Они появятся в сетке, но не смогут создавать реальные комнаты драфта.");
  }
  async function generateBracket(t: Tournament) {
    await enqueueTournamentAction(() => generateBracketNow(t));
  }
  async function generateBracketNow(requestedTournament: Tournament) {
    if (!isAdmin) { setNotice("Только организатор может создать сетку."); return; }
    const t = stateRef.current.tournaments.find(item => item.id === requestedTournament.id);
    if (!t || t.status !== "registration") { setNotice("Сетка уже создана или регистрация закрыта."); return; }
    const list = stateRef.current.entrants.filter(e => e.tournamentId === t.id);
    if (list.length < 2) { setNotice("Нужно минимум два участника."); return; }
    if (t.swissStage) {
      const matches = buildSwissRound(t, list, [], 1, true);
      if (session && supabase) {
        try { const testBotIds = new Set(list.filter(e => e.testBot).map(e => e.playerId)); for (const match of matches) if (match.playerA && match.playerB && !testBotIds.has(match.playerA) && !testBotIds.has(match.playerB)) match.roomId = await ensureTournamentDraftRoom(t, match); }
        catch (e) { setNotice(e instanceof Error ? e.message : "Не удалось создать комнаты Swiss-раунда."); return; }
      }
      update(s => ({ ...s, matches: [...s.matches.filter(m => m.tournamentId !== t.id), ...matches], tournaments: s.tournaments.map(x => x.id === t.id ? { ...x, status: "in_progress" } : x) }));
      setNotice("Первый Swiss-раунд создан. После результатов всех матчей пары следующего раунда сформируются автоматически; в плей-офф выйдут 4 лучших участника.");
      return;
    }
    const shuffled = [...list].sort(() => Math.random() - 0.5);
    const size = 2 ** Math.ceil(Math.log2(shuffled.length));
    const rounds = Math.log2(size);
    const matches: Match[] = [];
    const winners: Match[][] = [];
    for (let r = 1; r <= rounds; r++) {
      winners[r] = [];
      for (let slot = 1; slot <= size / (2 ** r); slot++) {
        const match: Match = { id: makeId("m"), tournamentId: t.id, round: r, slot, playerA: r === 1 ? shuffled[(slot - 1) * 2]?.playerId ?? null : null, playerB: r === 1 ? shuffled[(slot - 1) * 2 + 1]?.playerId ?? null : null, winner: null, status: "pending", bracket: t.format === "double_elimination" ? (rounds > 1 ? "winners" : "final") : "single" };
        winners[r][slot] = match; matches.push(match);
      }
    }
    if (t.format === "double_elimination" && rounds > 1) {
      const losers: Match[][] = [];
      const addLoserRound = (index: number, count: number) => { losers[index] = []; for (let slot = 1; slot <= count; slot++) { const m: Match = { id: makeId("m"), tournamentId: t.id, round: index, slot, playerA: null, playerB: null, winner: null, status: "pending", bracket: "losers" }; losers[index][slot] = m; matches.push(m); } };
      addLoserRound(1, size / 4);
      for (let r = 2; r <= rounds; r++) { addLoserRound(2 * r - 2, size / (2 ** r)); if (r < rounds) addLoserRound(2 * r - 1, size / (2 ** (r + 1))); }
      for (let r = 1; r < rounds; r++) for (const m of winners[r].slice(1)) { const next = winners[r + 1][Math.ceil(m.slot / 2)]; m.nextWinnerMatchId = next.id; m.nextWinnerSide = m.slot % 2 ? "playerA" : "playerB"; }
      for (const m of winners[1].slice(1)) { const next = losers[1][Math.ceil(m.slot / 2)]; m.nextLoserMatchId = next.id; m.nextLoserSide = m.slot % 2 ? "playerA" : "playerB"; }
      for (let r = 2; r <= rounds; r++) for (const m of winners[r].slice(1)) { const next = r === rounds ? null : winners[r + 1][Math.ceil(m.slot / 2)]; if (next) { m.nextWinnerMatchId = next.id; m.nextWinnerSide = m.slot % 2 ? "playerA" : "playerB"; } const drop = losers[2 * r - 2][m.slot]; m.nextLoserMatchId = drop.id; m.nextLoserSide = "playerB"; }
      for (let r = 1; r < 2 * rounds - 2; r++) for (const m of (losers[r] ?? []).slice(1)) { const nextRound = r + 1; const next = losers[nextRound]?.[r % 2 === 1 ? m.slot : Math.ceil(m.slot / 2)]; if (next) { m.nextWinnerMatchId = next.id; m.nextWinnerSide = r % 2 === 1 ? "playerA" : (m.slot % 2 ? "playerA" : "playerB"); } }
      const final: Match = { id: makeId("m"), tournamentId: t.id, round: 1, slot: 1, playerA: null, playerB: null, winner: null, status: "pending", bracket: "final" }; matches.push(final);
      const winnersFinal = winners[rounds][1]; winnersFinal.nextWinnerMatchId = final.id; winnersFinal.nextWinnerSide = "playerA";
      const losersFinal = losers[2 * rounds - 2][1]; losersFinal.nextWinnerMatchId = final.id; losersFinal.nextWinnerSide = "playerB";
    } else {
      for (let r = 1; r < rounds; r++) for (const m of winners[r].slice(1)) { const next = winners[r + 1][Math.ceil(m.slot / 2)]; m.nextWinnerMatchId = next.id; m.nextWinnerSide = m.slot % 2 ? "playerA" : "playerB"; }
    }
    for (let pass = 0; pass < rounds; pass++) for (const m of matches) if (m.status === "pending" && (Boolean(m.playerA) !== Boolean(m.playerB)) && !matches.some(source => source.status !== "completed" && (source.nextWinnerMatchId === m.id || source.nextLoserMatchId === m.id))) { m.winner = m.playerA || m.playerB; m.status = "completed"; const next = matches.find(x => x.id === m.nextWinnerMatchId); if (next && m.nextWinnerSide && m.winner) next[m.nextWinnerSide] = m.winner; }
    if (session && supabase) {
      try { const testBotIds = new Set(list.filter(e => e.testBot).map(e => e.playerId)); for (let i = 0; i < matches.length; i++) { const match = matches[i]; const playerA = match.playerA; const playerB = match.playerB; if (playerA && playerB && !testBotIds.has(playerA) && !testBotIds.has(playerB)) match.roomId = await ensureTournamentDraftRoom(t, match); } }
      catch (e) { setNotice(e instanceof Error ? e.message : "Не удалось создать комнаты драфта."); return; }
    }
    update(s => ({ ...s, matches: [...s.matches.filter(m => m.tournamentId !== t.id), ...matches], tournaments: s.tournaments.map(x => x.id === t.id ? { ...x, status: "in_progress" } : x) }));
    setNotice("Сетка создана. Проверь пары и пропуски первого раунда.");
  }
  function recordMatchResultNow(matchId: string, winnerId: string, confirmedByDraft = false) {
    const match = stateRef.current.matches.find(item => item.id === matchId);
    if (!match) return;
    if (!confirmedByDraft && !isAdmin) { setNotice("Подтвердить результат может организатор турнира."); return; }
    if (!match.playerA || !match.playerB || ![match.playerA, match.playerB].includes(winnerId)) return;
    if (!confirmedByDraft && !window.confirm("Подтвердить результат матча? Победитель продвинется по сетке автоматически.")) return;
    update(s => {
      let matches = s.matches.map(m => m.id === match.id ? { ...m, winner: winnerId, loser: winnerId === match.playerA ? match.playerB : match.playerA, status: "completed" as const } : m);
      const completed = matches.find(m => m.id === match.id)!;
      const winnerDestination = matches.find(m => m.id === completed.nextWinnerMatchId);
      const loserDestination = matches.find(m => m.id === completed.nextLoserMatchId);
      if (winnerDestination && completed.nextWinnerSide) matches = matches.map(m => m.id === winnerDestination.id ? { ...m, [completed.nextWinnerSide!]: winnerId, winner: null, status: "pending" as const } : m);
      const loserId = completed.loser;
      if (loserDestination && completed.nextLoserSide && loserId) matches = matches.map(m => m.id === loserDestination.id ? { ...m, [completed.nextLoserSide!]: loserId, winner: null, status: "pending" as const } : m);
      const tournament = s.tournaments.find(t => t.id === completed.tournamentId);
      if (completed.bracket === "swiss" && tournament) {
        const roundMatches = matches.filter(m => m.tournamentId === completed.tournamentId && m.bracket === "swiss" && m.round === completed.round);
        if (roundMatches.length && roundMatches.every(m => m.status === "completed")) {
          const totalRounds = Math.max(1, Math.min(10, Number(tournament.swissRounds) || 3));
          if (completed.round < totalRounds) {
            matches = [...matches, ...buildSwissRound(tournament, s.entrants.filter(e => e.tournamentId === tournament.id), matches, completed.round + 1)];
          } else {
            const playoffEntrants = rankSwissEntrants(s.entrants.filter(e => e.tournamentId === tournament.id), matches).slice(0, 4);
            matches = [...matches, ...buildEliminationBracket(tournament, playoffEntrants, false)];
          }
        }
      }
      const tournamentMatches = matches.filter(m => m.tournamentId === match.tournamentId);
      const grandFinal = tournamentMatches.find(m => m.bracket === "final");
      const singleFinal = tournamentMatches.find(m => m.bracket === "single" && !m.nextWinnerMatchId);
      const tournamentComplete = grandFinal?.status === "completed" || singleFinal?.status === "completed";
      return { ...s, matches, tournaments: tournamentComplete ? s.tournaments.map(t => t.id === match.tournamentId ? { ...t, status: "completed" as const } : t) : s.tournaments };
    });
    setNotice(confirmedByDraft ? "Результат матча получен. Сетка обновлена автоматически." : "Результат сохранён. Сетка обновлена автоматически.");
  }
  function setWinner(match: Match, winnerId: string) { if (!isAdmin || !window.confirm("Подтвердить результат матча? Сетка и следующая комната драфта обновятся автоматически.")) return; void handleTournamentDraftResult(match.id, winnerId); }
  async function handleTournamentDraftResult(matchId: string, winnerId: string) {
    await enqueueTournamentAction(() => handleTournamentDraftResultNow(matchId, winnerId));
  }
  async function handleTournamentDraftResultNow(matchId: string, winnerId: string) {
    const match = stateRef.current.matches.find(m => m.id === matchId);
    if (!match || match.status === "completed") return;
    recordMatchResultNow(matchId, winnerId, true);
    const latestState = stateRef.current;
    const loserId = winnerId === match.playerA ? match.playerB : match.playerA;
    const destinationIds = [match.nextWinnerMatchId, match.nextLoserMatchId].filter(Boolean) as string[];
    const destinations = destinationIds.map(id => latestState.matches.find(m => m.id === id)).filter((m): m is Match => Boolean(m));
    const ready = destinations.map(dest => ({ dest, candidateA: dest.id === match.nextWinnerMatchId ? (match.nextWinnerSide === "playerA" ? winnerId : dest.playerA) : dest.id === match.nextLoserMatchId && match.nextLoserSide === "playerA" ? loserId : dest.playerA, candidateB: dest.id === match.nextWinnerMatchId ? (match.nextWinnerSide === "playerB" ? winnerId : dest.playerB) : dest.id === match.nextLoserMatchId && match.nextLoserSide === "playerB" ? loserId : dest.playerB })).find(x => x.candidateA && x.candidateB && !x.dest.roomId);
    if (!ready || !supabase) return;
    const tournament = latestState.tournaments.find(t => t.id === match.tournamentId);
    if (!tournament) return;
    try {
      const roomId = await ensureTournamentDraftRoom(tournament, { ...ready.dest, playerA: ready.candidateA!, playerB: ready.candidateB!, roomId: null }, match.roomId);
      if (roomId) update(s => ({ ...s, matches: s.matches.map(m => m.id === ready.dest.id ? { ...m, roomId } : m) }));
    } catch (e) { setNotice(e instanceof Error ? e.message : "Не удалось создать комнату следующего матча."); }
  }
  function patchTournament(patch: Partial<Tournament>) { update(s => ({ ...s, tournaments: s.tournaments.map(t => t.id === activeTournament.id ? { ...t, ...patch } : t) })); }
  function changeAgentCost(id: string, cost: number) { update(s => ({ ...s, agents: s.agents.map(a => a.id === id ? { ...a, baseCost: Math.max(0, cost) } : a) })); }
  function changeEngine(id: string, patch: Partial<WEngine>) { update(s => ({ ...s, engines: s.engines.map(e => e.id === id ? { ...e, ...patch } : e) })); }
  const shownTournaments = useMemo(() => state.tournaments.filter(t => `${t.name} ${t.description}`.toLowerCase().includes(search.toLowerCase())), [state.tournaments, search]);
  const bracketMatchesForView = activeTournament ? state.matches.filter(m => m.tournamentId === activeTournament.id && m.bracket !== "reset") : [];
  const maxWinnerRoundsForView = Math.max(0, ...bracketMatchesForView.filter(m => m.bracket === "winners").map(m => m.round));
  const maxLoserRoundsForView = Math.max(0, ...bracketMatchesForView.filter(m => m.bracket === "losers").map(m => m.round));
  const maxSwissRoundsForView = Math.max(0, ...bracketMatchesForView.filter(m => m.bracket === "swiss").map(m => m.round));
  const hasDoubleBracketForView = bracketMatchesForView.some(m => m.bracket === "winners" || m.bracket === "losers");
  const hasTreeBracketForView = bracketMatchesForView.some(m => ["single","winners","losers","final","reset"].includes(m.bracket || ""));
  const bracketMatchPositions = new Map<string, number>();
  for (const match of bracketMatchesForView.filter(m => (m.bracket === "single" || m.bracket === "winners") && m.round === 1).sort((a,b) => a.slot-b.slot)) bracketMatchPositions.set(match.id, (match.slot - 1) * 6);
  for (let pass = 0; pass < bracketMatchesForView.length; pass++) {
    let changed = false;
    for (const match of bracketMatchesForView) {
      if (bracketMatchPositions.has(match.id)) continue;
      const sources = bracketMatchesForView.filter(source => source.nextWinnerMatchId === match.id || source.nextLoserMatchId === match.id);
      if (!sources.length || sources.some(source => !bracketMatchPositions.has(source.id))) continue;
      bracketMatchPositions.set(match.id, Math.round(sources.reduce((sum, source) => sum + (bracketMatchPositions.get(source.id) || 0), 0) / sources.length));
      changed = true;
    }
    if (!changed) break;
  }
  const grandFinalPosition = bracketMatchesForView.find(m => m.bracket === "final");
  for (const match of bracketMatchesForView.filter(m => m.bracket === "reset")) bracketMatchPositions.set(match.id, grandFinalPosition ? bracketMatchPositions.get(grandFinalPosition.id) || 0 : 0);
  for (const match of bracketMatchesForView) if (!bracketMatchPositions.has(match.id)) bracketMatchPositions.set(match.id, (match.slot - 1) * 6);
  const bracketGridRows = Math.max(3, ...bracketMatchPositions.values()) + 8;
  const bracketLaneHeight = 24 + bracketGridRows * 14;
  const bracketColumnIndex = (match: Match) => match.bracket === "swiss" ? match.round : match.bracket === "single" || match.bracket === "winners" || match.bracket === "losers" ? maxSwissRoundsForView + match.round : match.bracket === "final" ? maxSwissRoundsForView + maxWinnerRoundsForView + 1 : match.bracket === "reset" ? maxSwissRoundsForView + maxWinnerRoundsForView + 2 : match.round;
  const bracketLaneIndex = (match: Match) => match.bracket === "losers" ? 1 : hasDoubleBracketForView && (match.bracket === "final" || match.bracket === "reset") ? 2 : 0;
  const bracketColumnWidth = 156;
  const bracketColumnGap = 44;
  const bracketMatchCenterY = (match: Match) => hasDoubleBracketForView && (match.bracket === "final" || match.bracket === "reset") ? bracketLaneHeight + 14 : bracketLaneIndex(match) * (bracketLaneHeight + 28) + 24 + (bracketMatchPositions.get(match.id) || 0) * 14 + 35;
  const bracketConnectors = bracketMatchesForView.flatMap(source => [source.nextWinnerMatchId].filter((id): id is string => Boolean(id)).map((targetId, edge) => {
    const target = bracketMatchesForView.find(match => match.id === targetId);
    if (!target || (source.bracket === "losers" && target.bracket === "final")) return null;
    const sourceColumn = bracketColumnIndex(source) - 1;
    const targetColumn = bracketColumnIndex(target) - 1;
    const sourceRight = sourceColumn * (bracketColumnWidth + bracketColumnGap) + bracketColumnWidth;
    const targetLeft = targetColumn * (bracketColumnWidth + bracketColumnGap);
    const targetRight = targetLeft + bracketColumnWidth;
    const sourceY = bracketMatchCenterY(source);
    const targetY = bracketMatchCenterY(target);
    const bendsBackward = targetColumn <= sourceColumn;
    const bendX = bendsBackward ? sourceRight + bracketColumnGap / 2 : (sourceRight + targetLeft) / 2;
    const endX = bendsBackward ? targetRight : targetLeft;
    return { key: `${source.id}-${edge}`, path: `M ${sourceRight} ${sourceY} H ${bendX} V ${targetY} H ${endX}` };
  })).filter((edge): edge is { key: string; path: string } => Boolean(edge));
  const bracketSvgWidth = Math.max(1, ...bracketMatchesForView.map(match => bracketColumnIndex(match))) * (bracketColumnWidth + bracketColumnGap);

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setPage("home")}><span className="brand-mark">ZZ</span><span><b>DRAFT HUB</b><small>NEW ERIDU // TOURNAMENTS</small></span></button>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav-item ${page === "home" ? "active" : ""}`} onClick={() => setPage("home")}><Home size={17}/> Главная</button>
      <button className={`nav-item ${page === "tournaments" ? "active" : ""}`} onClick={() => setPage("tournaments")}><Trophy size={17}/> Турниры</button>
      <button className={`nav-item ${page === "drafts" ? "active" : ""}`} onClick={() => { setDraftRoomToOpen(null); setPage("drafts"); }}><Swords size={17}/> Онлайн-драфт</button>
      <button className={`nav-item ${page === "rosters" ? "active" : ""}`} onClick={() => setPage("rosters")}><Users size={17}/> Мои ростеры</button>
      {isCostManager && <button className={`nav-item ${page === "costs" ? "active" : ""}`} onClick={() => setPage("costs")}><SlidersHorizontal size={17}/> Cost Manager</button>}
      {isCostManager && <button className={`nav-item ${page === "rules" ? "active" : ""}`} onClick={() => setPage("rules")}><Settings2 size={17}/> Правила драфта</button>}
      {isAdmin && <button className={`nav-item ${page === "admin" ? "active" : ""}`} onClick={() => setPage("admin")}><ShieldCheck size={17}/> Админ-панель</button>}
      <div className="sidebar-bottom">
        <div className="user-card"><Avatar id={current.avatarId} size="sm"/><div className="user-meta"><b>{current.nickname}</b><small>{current.role === "admin" ? "ADMINISTRATOR" : current.role === "cost_manager" ? "COST MANAGER" : "PLAYER"}</small></div><button className="icon-btn" title="Профиль" onClick={() => setPage("profile")}><UserRound size={16}/></button></div>
        <button className="nav-item muted" onClick={() => { void signOut(); }}><LogOut size={17}/> Выйти</button>
        
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div><span className="eyebrow">ZENLESS ZONE ZERO</span><h1>{page === "home" ? "Главная" : page === "tournaments" ? "Турниры" : page === "tournament" ? (activeTournament?.name || "Турнир") : page === "bracket" ? "Турнирная сетка" : page === "costs" ? "Cost Manager" : page === "rules" ? "Глобальные правила драфта" : page === "admin" ? "Админ-панель" : page === "drafts" ? "Онлайн-драфт" : page === "rosters" ? "Мои ростеры" : page === "profile" ? "Профиль игрока" : "Аккаунт"}</h1></div><div className="top-actions"><Badge kind="live">COMMUNITY TOOL</Badge>{session && <div className="notification-wrap"><button className="icon-btn notification-button" aria-label="Уведомления" onClick={() => setNotificationsOpen(v => !v)}><Bell size={18}/>{notifications.some(n => !n.read_at) && <i/>}</button>{notificationsOpen && <div className="notification-popover"><div className="panel-heading"><b>Уведомления</b><button className="icon-btn" onClick={async () => { const unread = notifications.filter(n => !n.read_at).map(n => n.id); if (!unread.length || !supabase) return; await supabase.from("user_notifications").update({ read_at: new Date().toISOString() }).in("id", unread); setNotifications(old => old.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() }))); }} title="Отметить все прочитанными"><Check size={15}/></button></div>{notifications.length ? notifications.map(n => <button className={`notification-item ${n.read_at ? "" : "unread"}`} key={n.id} onClick={async () => { if (!n.read_at && supabase) { const readAt = new Date().toISOString(); await supabase.from("user_notifications").update({ read_at: readAt }).eq("id", n.id); setNotifications(old => old.map(x => x.id === n.id ? { ...x, read_at: readAt } : x)); } if (n.room_id) { setDraftRoomToOpen(n.room_id); setPage("drafts"); } else if (n.tournament_id) { setPage("tournament"); setSelectedTournament(n.tournament_id); } setNotificationsOpen(false); }}><b>{n.title}</b><span>{n.message}</span><small>{new Date(n.created_at).toLocaleString("ru-RU")}</small></button>) : <p className="muted-text">Пока нет новых событий.</p>}</div>}</div>}<button className="profile-chip" onClick={() => setPage("profile")}><Avatar id={current.avatarId} size="sm"/><span>{current.nickname}</span><ChevronRight size={15}/></button></div></header>
      {notice && <div className="toast"><Check size={16}/>{notice}<button onClick={() => setNotice("")}><X size={14}/></button></div>}

      {page === "drafts" && <DraftRooms agents={state.agents} engines={state.engines} initialRoomId={draftRoomToOpen} judgeToken={judgeToken} onTournamentResult={(matchId,winnerId)=>void handleTournamentDraftResult(matchId,winnerId)}/>}
      {page === "rosters" && <MyRosters agents={state.agents} engines={state.engines}/>}

      {page === "home" && <section className="content">
        <div className="hero-panel">
          <div className="hero-copy">
            <span className="hero-kicker"><span/>ТУРНИРНЫЙ ЦЕНТР СООБЩЕСТВА</span>
            <h2>Я хочу Вкусно и Точка, понимаете?<br/><em>Я Архитектор блять.</em></h2>
            <p>Турниры по Zenless Zone Zero: найди событие, собери ростер и играй за победу.</p>
            <div className="hero-actions"><button className="btn btn-primary" onClick={() => setPage("tournaments")}>Смотреть турниры <ArrowRight size={16}/></button><span>Нью-Эриду ждёт твоего хода</span></div>
          </div>
          <div className="hero-status-card">
            <div className="hero-status-heading"><div><span className="hero-live-dot"/>СООБЩЕСТВО ZZZ</div><span>СЕЙЧАС</span></div>
            <div className="hero-stats">
              <div><span className="hero-stat-icon"><Trophy size={17}/></span><b>{state.tournaments.length.toString().padStart(2,"0")}</b><span>Турниров</span></div>
              <div><span className="hero-stat-icon"><Swords size={17}/></span><b>{state.tournaments.filter(t => t.status === "in_progress").length.toString().padStart(2,"0")}</b><span>Идёт сейчас</span></div>
              <div><span className="hero-stat-icon"><Users size={17}/></span><b>{state.tournaments.filter(t => t.status === "registration").length.toString().padStart(2,"0")}</b><span>Регистрация</span></div>
            </div>
            <div className="hero-card-foot"><span>01</span><span>СОБЕРИ СВОЙ СОСТАВ</span><span className="hero-foot-line"/></div>
          </div>
        </div>
      </section>}

      {page === "tournaments" && <section className="content">
        <div className="section-heading" id="tournament-directory"><div><span className="eyebrow">EVENT DIRECTORY</span><h2>Все турниры</h2></div><div className="heading-actions"><input className="search" placeholder="Поиск турнира..." value={search} onChange={e => setSearch(e.target.value)}/>{isAdmin && <Button onClick={() => setShowCreate(true)}><Plus size={16}/> Создать турнир</Button>}</div></div>
        <div className="tournament-grid">{shownTournaments.map(t => { const count = entrantsFor(t.id).length; return <article className="tournament-card" key={t.id}><div className="card-top"><Badge kind={t.status === "registration" ? "green" : t.status === "completed" ? "neutral" : "accent"}>{t.status === "registration" ? "Регистрация открыта" : t.status === "completed" ? "Завершён" : "Идёт турнир"}</Badge><span className="card-index">EVENT / {t.id.toUpperCase()}</span></div><h3>{t.name}</h3><p>{t.description || "Турнир сообщества ZZZ."}</p><div className="progress-line"><span style={{ width: `${Math.min(100, count / t.maxPlayers * 100)}%` }}/></div><div className="card-meta"><span><Users size={15}/>{count} / {t.maxPlayers} игроков</span><span><SlidersHorizontal size={15}/>Лимит: {globalDraftRules.min_roster_cost.toLocaleString("ru-RU")}–{globalDraftRules.max_roster_cost.toLocaleString("ru-RU")} костов</span></div><div className="card-footer"><Button kind="secondary" onClick={() => { setSelectedTournament(t.id); setPage("tournament"); }}>Подробнее <ArrowRight size={15}/></Button>{t.status === "registration" && <Button onClick={() => joinTournament(t)}>Участвовать</Button>}{isAdmin && <Button kind="danger-ghost" onClick={() => deleteTournament(t)}>Удалить</Button>}</div></article>; })}</div>
      </section>}

      {page === "tournament" && activeTournament && <section className="content">
        <div className="detail-grid"><div className="panel"><div className="panel-heading"><div><span className="eyebrow">EVENT DETAILS</span><h2>{activeTournament.name}</h2></div><Badge kind={activeTournament.status === "registration" || activeTournament.status === "completed" ? "green" : "accent"}>{activeTournament.status === "registration" ? "Регистрация" : activeTournament.status === "completed" ? "Завершён" : "В процессе"}</Badge></div>{activeTournament.status === "completed" && <div className="tournament-champion"><Trophy size={20}/><div><span>ПОБЕДИТЕЛЬ ТУРНИРА</span><b>{activeTournamentChampion?.nickname || "Игрок"}</b></div>{activeTournamentChampion && <Avatar id={activeTournamentChampion.avatarId} size="sm"/>}</div>}<p className="muted-text">{activeTournament.description}</p><div className="detail-stats participant-stat"><div><span>Участники</span><b>{entrantsFor(activeTournament.id).length} / {activeTournament.maxPlayers}</b></div></div><div className="button-row">{activeTournament.status === "registration" && <Button onClick={() => joinTournament(activeTournament)}>Зарегистрироваться</Button>}<Button kind="secondary" onClick={() => setPage("bracket")}>Открыть сетку <ArrowRight size={15}/></Button>{(() => { const match = state.matches.find(m => m.tournamentId === activeTournament.id && m.status !== "completed" && (m.playerA === current.id || m.playerB === current.id)); return match ? <Button kind="ghost" onClick={() => void openTournamentMatchDraft(match)}>Открыть мой драфт <Swords size={15}/></Button> : null; })()}</div></div>
        <div className="panel rules-panel"><div className="panel-heading"><div><span className="eyebrow">RULESET</span><h3>Правила турнира</h3></div><Settings2 size={18}/></div><div className="rule-row"><span>Костовая система</span><Badge kind="green">Включена</Badge></div><div className="rule-row"><span>Дополнительные баны</span><b>1 за {globalDraftRules.cost_difference_per_preban} костов разницы</b></div><div className="rule-row"><span>Лимит коста</span><b>{globalDraftRules.min_roster_cost.toLocaleString("ru-RU")}–{globalDraftRules.max_roster_cost.toLocaleString("ru-RU")}</b></div><div className="rule-row"><span>Минимум агентов в ростере</span><b>{globalDraftRules.min_agents}</b></div></div></div>
        {entrantsFor(activeTournament.id).some(e => e.playerId === current.id) && <div className="panel"><div className="panel-heading"><div><span className="eyebrow">PLAYER MATCHES</span><h3>Мои матчи в этом турнире</h3></div><Badge kind="accent">{state.matches.filter(m => m.tournamentId === activeTournament.id && (m.playerA === current.id || m.playerB === current.id)).length}</Badge></div>{state.matches.filter(m => m.tournamentId === activeTournament.id && (m.playerA === current.id || m.playerB === current.id)).length ? <div className="entrant-list">{state.matches.filter(m => m.tournamentId === activeTournament.id && (m.playerA === current.id || m.playerB === current.id)).sort((a,b)=>a.round-b.round || a.slot-b.slot).map(m => { const a = playerById(m.playerA); const b = playerById(m.playerB); return <div className="entrant-row" key={m.id}><div><b>Раунд {m.round}, матч {m.slot}</b><p className="muted-text">{a?.nickname || "Ожидание игрока"} vs {b?.nickname || "Ожидание соперника"}</p></div><span className="spacer"/><Badge kind={m.status === "completed" ? "green" : m.playerA && m.playerB ? "accent" : "neutral"}>{m.status === "completed" ? (m.winner === current.id ? "Победа" : "Завершён") : m.playerA && m.playerB ? "Готов к игре" : "Ожидание соперника"}</Badge><Button kind="secondary" disabled={!m.playerA || !m.playerB || m.status === "completed" || state.entrants.some(e => e.testBot && e.tournamentId === activeTournament.id && (m.playerA === e.playerId || m.playerB === e.playerId))} onClick={() => void openTournamentMatchDraft(m)}>{state.entrants.some(e => e.testBot && e.tournamentId === activeTournament.id && (m.playerA === e.playerId || m.playerB === e.playerId)) ? "Тестовый матч" : "Открыть драфт"}</Button></div>; })}</div> : <div className="empty-state">Матчи появятся после создания сетки.</div>}</div>}
        <div className="panel"><div className="panel-heading"><div><span className="eyebrow">ROSTER</span><h3>Участники</h3></div><div className="heading-actions"><span className="muted-text">{entrantsFor(activeTournament.id).length} зарегистрировано</span>{isAdmin && activeTournament.status === "registration" && <Button kind="secondary" onClick={() => void addTournamentTestEntrants(activeTournament)}>Добавить 14 тестовых участников</Button>}</div></div>{entrantsFor(activeTournament.id).length ? <div className="entrant-list">{entrantsFor(activeTournament.id).map((e,i) => { const p = playerById(e.playerId); return <div className="entrant-row" key={e.id}><span className="seed">#{i+1}</span><Avatar id={p?.avatarId || "anby"} size="sm"/><b>{p?.nickname || "Удалённый игрок"}</b>{isAdmin && !e.testBot && <Button kind="secondary" disabled={!e.registeredRoster} onClick={() => setViewEntrantRoster(e)}>{e.registeredRoster ? "Открыть ростер" : "Ростер не указан"}</Button>}<span className="spacer"/>{isAdmin && <Button kind="danger-ghost" onClick={() => { if (window.confirm("Удалить участника из турнира?")) update(s => ({...s, entrants: s.entrants.filter(x => x.id !== e.id)})); }}>Удалить</Button>}</div>; })}</div> : <div className="empty-state">Пока никто не зарегистрировался.</div>}{isAdmin && <div className="admin-action"><h3>Заявки на участие</h3>{state.registrationRequests.filter(r => r.tournamentId === activeTournament.id && r.status === "pending").length === 0 ? <p className="muted-text">Новых заявок нет.</p> : <div className="entrant-list">{state.registrationRequests.filter(r => r.tournamentId === activeTournament.id && r.status === "pending").map(request => { const p = playerById(request.playerId); return <div className="entrant-row" key={request.id}><Avatar id={p?.avatarId || "anby"} size="sm"/><b>{p?.nickname || "Удалённый игрок"}</b>{isAdmin && <Button kind="secondary" disabled={!request.registeredRoster} onClick={() => setViewEntrantRoster({ id:request.id, tournamentId:request.tournamentId, playerId:request.playerId, seed:0, savedRosterId:request.savedRosterId, registeredRoster:request.registeredRoster })}>Ростер участника</Button>}<span className="spacer"/><Button onClick={() => approveRequest(request)} disabled={entrantsFor(activeTournament.id).length >= activeTournament.maxPlayers || !request.registeredRoster}><Check size={14}/> Одобрить</Button><Button kind="danger-ghost" onClick={() => rejectRequest(request)}><X size={14}/> Отклонить</Button></div>; })}</div>}</div>}{isAdmin && activeTournament.status === "registration" && <div className="admin-action"><Button onClick={() => { if (window.confirm("Закрыть регистрацию и сгенерировать сетку?")) generateBracket(activeTournament); }}><Swords size={16}/> Закрыть регистрацию и создать сетку</Button></div>}</div>
      </section>}

      {page === "my-matches" && <section className="content"><div className="section-heading"><div><span className="eyebrow">PLAYER MATCHES</span><h2>Мои матчи</h2><p className="muted-text">Здесь отображаются только комнаты, созданные этим аккаунтом.</p></div></div><div className="panel">{createdDraftRooms.length ? <div className="entrant-list">{createdDraftRooms.map(room => { const a = playerById(room.player_one_id), b = playerById(room.player_two_id); return <div className="entrant-row" key={room.id}><div><b>{room.title}</b><p className="muted-text">{a?.nickname || "Игрок 1"} vs {b?.nickname || "Ожидание соперника"}{room.created_at ? ` · ${new Date(room.created_at).toLocaleDateString("ru-RU")}` : ""}</p></div><span className="spacer"/><Badge kind={room.status === "completed" ? "green" : room.status === "active" ? "accent" : "neutral"}>{room.status === "completed" ? "Завершена" : room.status === "active" ? "Идёт" : room.status === "waiting" ? "Ожидает соперника" : room.status === "ready" ? "Готова" : room.status}</Badge><Button kind="secondary" onClick={() => { if (room.tournament_id && room.tournament_match_id) setPage("drafts"); else setPage("drafts"); setDraftRoomToOpen(room.id); }}>Открыть</Button></div>; })}</div> : <div className="empty-state">Пока нет комнат, созданных этим аккаунтом.</div>}</div></section>}
      {page === "bracket" && (activeTournament ? <section className="content"><div className="section-heading"><div><span className="eyebrow">{(() => { const tournamentMatches = state.matches.filter(m => m.tournamentId === activeTournament.id); const hasDouble = tournamentMatches.some(m => ["winners","losers","final"].includes(m.bracket || "")); const hasSingle = tournamentMatches.some(m => m.bracket === "single"); const isDouble = hasDouble || (!hasSingle && activeTournament.format === "double_elimination"); const hasSwiss = tournamentMatches.some(m => m.bracket === "swiss") || (activeTournament.swissStage && tournamentMatches.length === 0); return hasSwiss ? `SWISS STAGE · ${isDouble ? "DOUBLE ELIMINATION PLAYOFF" : "SINGLE ELIMINATION PLAYOFF"}` : isDouble ? "DOUBLE ELIMINATION" : "SINGLE ELIMINATION"; })()}</span><h2>{activeTournament.name}</h2><p className="muted-text">После подтверждения результата победитель автоматически переходит в следующий раунд.</p></div><div className="heading-actions"><select className="select" value={selectedTournament} onChange={e => setSelectedTournament(e.target.value)}>{state.tournaments.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select>{isAdmin && activeTournament.status === "registration" && <Button onClick={() => { if (window.confirm("Сгенерировать сетку? Это действие создаст новые пары.")) generateBracket(activeTournament); }}>Сгенерировать сетку</Button>}</div></div>
        {bracketMatchesForView.length ? <div className="bracket-scroll"><div className="bracket-columns">{hasTreeBracketForView && <svg className="bracket-connectors" width={bracketSvgWidth} height={bracketLaneHeight * (hasDoubleBracketForView ? 2 : 1) + (hasDoubleBracketForView ? 28 : 0)} aria-hidden="true">{bracketConnectors.map(edge => <path key={edge.key} d={edge.path}/>)}</svg>}{Array.from(new Set(bracketMatchesForView.map(m => `${m.bracket || "single"}:${m.round}`))).sort((a,b)=>["swiss","single","winners","losers","final","reset"].indexOf(a.split(":")[0])-["swiss","single","winners","losers","final","reset"].indexOf(b.split(":")[0]) || Number(a.split(":")[1])-Number(b.split(":")[1])).map(group => { const [bracket, roundText] = group.split(":"); const round = Number(roundText); const ms = bracketMatchesForView.filter(m => (m.bracket || "single") === bracket && m.round === round).sort((a,b)=>a.slot-b.slot); return <div className="round-column" data-bracket={bracket} data-round={round} style={hasTreeBracketForView ? { gridRow: hasDoubleBracketForView && (bracket === "final" || bracket === "reset") ? "1 / span 2" : bracket === "losers" ? 2 : 1, gridColumn: bracket === "swiss" ? round : bracket === "single" || bracket === "winners" || bracket === "losers" ? maxSwissRoundsForView + round : bracket === "final" ? maxSwissRoundsForView + maxWinnerRoundsForView + 1 : bracket === "reset" ? maxSwissRoundsForView + maxWinnerRoundsForView + 2 : round, gridTemplateRows: hasDoubleBracketForView && (bracket === "final" || bracket === "reset") ? undefined : `24px repeat(${bracketGridRows}, 14px)`, height: hasDoubleBracketForView && (bracket === "final" || bracket === "reset") ? bracketLaneHeight * 2 + 28 : undefined } : undefined} key={`${bracket}-${round}`}><div className="round-title">{bracket === "swiss" ? "SWISS STAGE · " : bracket === "losers" ? "LOWER BRACKET · " : bracket === "winners" ? "UPPER BRACKET · " : bracket === "final" ? "GRAND FINAL · " : bracket === "reset" ? "BRACKET RESET · " : ""}ROUND {round}<span>{ms.every(m=>!m.nextWinnerMatchId) ? "FINAL STAGE" : `${ms.length} MATCHES`}</span></div>{ms.map(m => <div className="match-card" style={hasTreeBracketForView ? { gridRow: `${(bracketMatchPositions.get(m.id) ?? 0) + 2} / span 5` } : undefined} key={m.id}><div className="match-top"><span>MATCH {m.slot.toString().padStart(2,"0")}</span><Badge kind={m.status === "completed" ? "green" : "neutral"}>{m.status === "completed" ? "Завершён" : "Ожидание"}</Badge></div>{([["playerA",m.playerA],["playerB",m.playerB]] as const).map(([side,pid]) => { const p = playerById(pid); const winner = m.winner === pid && !!pid; return <div className={`match-player ${winner ? "winner" : ""}`} key={side}><Avatar id={p?.avatarId || "anby"} size="sm"/><span>{p?.nickname || (pid ? "Игрок" : "Ожидание")}</span>{winner && <Check size={14}/>}</div>; })}{isAdmin && m.playerA && m.playerB && <div className="winner-actions"><button onClick={() => setWinner(m,m.playerA!)} disabled={m.winner===m.playerA}>Победа A</button><button onClick={() => setWinner(m,m.playerB!)} disabled={m.winner===m.playerB}>Победа B</button></div>}<button className="match-draft-link" disabled={!m.playerA || !m.playerB || m.status === "completed" || state.entrants.some(e => e.testBot && e.tournamentId === activeTournament.id && (m.playerA === e.playerId || m.playerB === e.playerId))} onClick={() => void openTournamentMatchDraft(m)}>{state.entrants.some(e => e.testBot && e.tournamentId === activeTournament.id && (m.playerA === e.playerId || m.playerB === e.playerId)) ? "Тестовый матч" : m.roomId ? "Открыть драфт" : "Открыть комнату матча"} <Swords size={12}/></button></div>)}</div>; })}</div></div> : <div className="empty-panel"><Trophy size={28}/><h3>Сетка ещё не создана</h3><p>Закрой регистрацию и сгенерируй пары участников.</p></div>}</section> : <section className="content"><div className="empty-panel"><Trophy size={28}/><h3>Пока нет турниров</h3><p>Создай турнир во вкладке «Турниры», чтобы открыть турнирную сетку.</p><Button onClick={() => setPage("tournaments")}>Перейти к турнирам</Button></div></section>)}

      {page === "rules" && isCostManager && <section className="content"><GlobalRulesAdmin /></section>}

      {page === "admin" && isAdmin && <section className="content">
        <div className="cost-intro"><div><span className="eyebrow">ADMINISTRATION</span><h2>Админ-панель</h2><p>Глобальные правила и системные настройки проекта.</p></div><Badge kind="accent"><ShieldCheck size={13}/> ADMIN</Badge></div>
        <div className="panel"><div className="panel-heading"><div><span className="eyebrow">TOURNAMENT ACTIVITY</span><h3>Журнал действий</h3><p className="muted-text">Последние изменения турниров с указанием автора и времени.</p></div><Button kind="secondary" onClick={async()=>{if(!supabase)return;const {data}=await supabase.from("tournament_activity_log").select("id,tournament_id,action,created_at,profiles(nickname)").order("created_at",{ascending:false}).limit(50);if(data)setAuditEntries(data.map((row:any)=>({id:row.id,tournament_id:row.tournament_id,action:row.action,created_at:row.created_at,actor_nickname:row.profiles?.nickname||null})));}}>Обновить</Button></div>{auditEntries.length?<div className="entrant-list">{auditEntries.map(entry=><div className="entrant-row" key={entry.id}><div><b>{state.tournaments.find(t=>t.id===entry.tournament_id)?.name||entry.tournament_id}</b><p className="muted-text">{entry.action}</p></div><span className="spacer"/><small className="muted-text">{entry.actor_nickname||"Система"} · {new Date(entry.created_at).toLocaleString("ru-RU")}</small></div>)}</div>:<div className="empty-state">Пока нет записей. Новые изменения появятся после применения серверной миграции.</div>}</div>
        <DraftSequenceEditor />
        <div className="panel"><div className="panel-heading"><div><span className="eyebrow">REGISTERED PLAYERS</span><h3>Игроки и роли</h3><p className="muted-text">Выдавай роли игрока, Cost Manager или администратора. Super Admin защищён. Только Super Admin может менять роли других администраторов.</p></div><Button kind="secondary" onClick={async () => { if (!supabase) return; setUsersLoading(true); const { data, error } = await supabase.from("profiles").select("id,nickname,role,is_super_admin,created_at").order("created_at", { ascending: false }); if (error) setNotice(`Не удалось загрузить список игроков: ${error.message}`); else setRegisteredUsers((data || []) as typeof registeredUsers); setUsersLoading(false); }}>Обновить список</Button></div>{usersLoading ? <p className="muted-text">Загрузка списка игроков…</p> : registeredUsers.length ? <div className="role-list">{registeredUsers.map(user => <div className="role-row" key={user.id}><div style={{flex:1,minWidth:0}}><b>{user.nickname}</b><small style={{display:"block",color:"#77717f",marginTop:3}}>{user.id === session?.user.id ? "Твой аккаунт" : user.id}</small></div><Badge kind={user.role === "admin" ? "accent" : "neutral"}>{user.role}</Badge><select className="select role-select" value={user.role} disabled={user.id === session?.user.id || Boolean(user.is_super_admin) || (!isSuperAdmin && user.role === "admin")} aria-label={`Роль игрока ${user.nickname}`} onChange={e => void changePlayerRole(user.id, e.target.value as "admin"|"cost_manager"|"player")}><option value="player">Игрок</option><option value="cost_manager">Cost Manager</option><option value="admin">Администратор</option></select></div>)}</div> : <p className="muted-text">Игроки не найдены. Проверь подключение Supabase и права чтения таблицы profiles.</p>}</div>
        <div className="panel"><div className="panel-heading"><div><span className="eyebrow">QUICK ACTIONS</span><h3>Управление</h3></div></div><div className="button-row"><Button kind="secondary" onClick={() => setPage("drafts")}>Настройки и шаблоны драфта</Button><Button kind="secondary" onClick={() => setPage("costs")}>Открыть Cost Manager</Button><Button kind="secondary" onClick={() => setPage("tournaments")}>Управление турнирами</Button></div><p className="muted-text">Административные действия остаются защищены ролью администратора.</p></div>
      </section>}

      {page === "costs" && <section className="content"><div className="cost-intro"><div><span className="eyebrow">RULE CONFIGURATION</span><h2>Cost Manager</h2><p>Настройка стоимости каждого уровня ментальной картины и ранга амплификатора.</p></div><Badge kind="accent"><ShieldCheck size={13}/> {isSuperAdmin ? "SUPER ADMIN" : current.role === "admin" ? "ADMIN" : "COST MANAGER"}</Badge></div><div className="panel"><div className="tabs"><button className={editingCosts==="agents"?"selected":""} onClick={()=>setEditingCosts("agents")}>Агенты ({state.agents.length})</button><button className={editingCosts==="engines"?"selected":""} onClick={()=>setEditingCosts("engines")}>Амплификаторы ({state.engines.length})</button></div>{editingCosts === "agents" ? <><div className="engine-toolbar"><input className="search" placeholder="Найти агента..." value={engineSearch} onChange={e=>setEngineSearch(e.target.value)}/><select className="select" value={agentClassFilter} onChange={e=>setAgentClassFilter(e.target.value)}><option>Все классы</option>{["Нападение","Аномалия","Устрашение","Поддержка","Оборона","Разрушение","Оружейник","Не указана"].map(c=><option key={c}>{c}</option>)}</select></div><div className="cost-table">{state.agents.filter(a=>a.name.toLocaleLowerCase().includes(engineSearch.toLocaleLowerCase()) && (agentClassFilter === "Все классы" || (a.specialty || "Не указана") === agentClassFilter)).sort(compareBySpecialty).map(a => <details className="engine-cost-row cost-level-editor" key={a.id}><summary className="cost-table-row"><div className="name-with-avatar"><div className="mini-portrait"><img src={getAgentIconUrl(a.id)} data-fallback={a.imageFallbackUrl} alt="" loading="lazy" onError={e=>{const img=e.currentTarget;const fallback=img.dataset.fallback;if(fallback&&img.src!==fallback){img.dataset.fallback="";img.src=fallback;}else img.style.display="none";}}/><span>{a.avatar}</span></div><b>{a.name}</b></div><Badge>{a.rank}-ранг · {a.specialty || 'Класс не указан'}</Badge><span className="muted-text">Настроить M0–M6 ▾</span></summary><div className="cost-level-grid">{Array.from({length:7},(_,i)=>`M${i}`).map(level=><label key={level}>{level}<input type="number" min="0" className="text-input" value={a.costs?.[level] ?? (level==='M0'?a.baseCost:'')} placeholder={level==='M0'?'':'999'} title={level==='M0'?'Базовый кост':'Пустое значение считается как 999 костов'} onChange={e=>{const value=e.target.value;update(st=>({...st,agents:st.agents.map(item=>item.id!==a.id?item:{...item,baseCost:level==='M0'&&value!==''?Math.max(0,Number(value)):item.baseCost,costs:{...(item.costs||{}),...(value===''?{}:{[level]:Math.max(0,Number(value))})}})}));}}/></label>)}</div></details>)}</div></> : <><div className="engine-toolbar"><input className="search" placeholder="Найти амплификатор..." value={engineSearch} onChange={e=>setEngineSearch(e.target.value)}/><select className="select" value={engineClassFilter} onChange={e=>setEngineClassFilter(e.target.value)}><option>Все классы</option>{["Нападение","Аномалия","Устрашение","Поддержка","Оборона","Разрушение","Оружейник","Не указана"].map(c=><option key={c}>{c}</option>)}</select></div><div className="cost-table">{state.engines.filter(e=>e.name.toLocaleLowerCase().includes(engineSearch.toLocaleLowerCase()) && (engineClassFilter === "Все классы" || (e.specialty || "Не указана") === engineClassFilter)).sort(compareBySpecialty).map(w=><details className="engine-cost-row cost-level-editor" key={w.id}><summary className="cost-table-row"><div className="name-with-avatar"><div className="mini-portrait"><img src={w.imageUrl} data-fallback={w.imageFallbackUrl} alt="" loading="lazy" onError={e=>{const img=e.currentTarget;const fallback=img.dataset.fallback;if(fallback&&img.src!==fallback){img.dataset.fallback="";img.src=fallback;}else img.style.display="none";}}/><span>W</span></div><b>{w.name}</b></div><Badge>{w.rank}-ранг · {w.specialty || 'Класс не указан'}</Badge><span className="muted-text">Настроить R1–R5 ▾</span></summary><div className="cost-subsection"><h4>Основной кост</h4><div className="cost-level-grid">{Array.from({length:5},(_,i)=>`R${i+1}`).map(rank=><label key={rank}>{rank}<input type="number" min="0" className="text-input" value={w.rankCosts?.[rank] ?? (rank==='R1'?w.baseCost:'')} placeholder={rank==='R1'?'':'999'} title={rank==='R1'?'Базовый кост':'Пустое значение считается как 999 костов'} onChange={e=>{const value=e.target.value;changeEngine(w.id,{baseCost:rank==='R1'&&value!==''?Math.max(0,Number(value)):w.baseCost,rankCosts:{...(w.rankCosts||{}),...(value===''?{}:{[rank]:Math.max(0,Number(value))})}});}}/></label>)}</div></div><div className="cost-subsection"><h4>Оффбилд-кост</h4><div className="cost-level-grid">{Array.from({length:5},(_,i)=>`R${i+1}`).map(rank=><label key={rank}>{rank}<input type="number" min="0" className="text-input" value={w.offbuildCosts?.[rank] ?? ''} placeholder="999" title="Пустое значение считается как 999 костов" onChange={e=>{const value=e.target.value;changeEngine(w.id,{offbuildCosts:{...(w.offbuildCosts||{}),...(value===''?{}:{[rank]:Math.max(0,Number(value))})}});}}/></label>)}</div></div><div className="cost-subsection"><div className="panel-heading"><h4>Индивидуальный кост для агентов</h4><button className="btn btn-secondary" type="button" onClick={()=>{setAgentPickerEngineId(agentPickerEngineId===w.id?null:w.id);setPendingAgentId(state.agents.find(a=>!Object.prototype.hasOwnProperty.call(w.agentCosts||{},a.id))?.id||state.agents[0]?.id||'');}}>+ Добавить агента</button></div>{agentPickerEngineId===w.id&&<div className="add-agent-cost-picker"><label className="field-label">Выбери агента из полного списка<select className="select" value={pendingAgentId} onChange={e=>setPendingAgentId(e.target.value)}>{state.agents.filter(a=>!Object.prototype.hasOwnProperty.call(w.agentCosts||{},a.id)).sort(compareBySpecialty).map(a=><option value={a.id} key={a.id}>{a.name} · {a.specialty||'Класс не указан'}</option>)}</select>{state.agents.find(a=>a.id===pendingAgentId)&&<span className="cost-agent-picker-preview"><img src={getAgentIconUrl(pendingAgentId)} data-fallback={state.agents.find(a=>a.id===pendingAgentId)?.imageFallbackUrl} alt="" onError={e=>{const img=e.currentTarget;const fallback=img.dataset.fallback;if(fallback&&img.src!==fallback){img.dataset.fallback="";img.src=fallback;}else img.style.display="none";}}/><b>{state.agents.find(a=>a.id===pendingAgentId)?.name}</b></span>}</label><button className="btn btn-primary" type="button" disabled={!pendingAgentId||Object.prototype.hasOwnProperty.call(w.agentCosts||{},pendingAgentId)} onClick={()=>{changeEngine(w.id,{agentCosts:{...(w.agentCosts||{}),[pendingAgentId]:{}}});setSelectedEngine(pendingAgentId);setAgentPickerEngineId(null);}}>Добавить в настройки</button></div>}{Object.keys(w.agentCosts||{}).filter(agentId=>state.agents.some(a=>a.id===agentId)).map(agentId=>{const agent=state.agents.find(a=>a.id===agentId)!;return <div className="cost-subsection individual-agent-cost" key={agentId}><div className="panel-heading"><h4 className="individual-agent-heading"><span className="mini-portrait"><img src={getAgentIconUrl(agent.id)} alt="" loading="lazy" onError={e=>{const img=e.currentTarget;const fallback=img.dataset.fallback;if(fallback&&img.src!==fallback){img.dataset.fallback="";img.src=fallback;}else img.style.display="none";}}/><span>{agent.avatar}</span></span>{agent.name}</h4><button className="btn btn-danger-ghost" type="button" onClick={()=>{const next={...(w.agentCosts||{})};delete next[agentId];changeEngine(w.id,{agentCosts:next});}}>Убрать агента</button></div><div className="cost-level-grid">{Array.from({length:5},(_,i)=>`R${i+1}`).map(rank=><label key={rank}>{rank}<input type="number" min="0" className="text-input" value={w.agentCosts?.[agentId]?.[rank] ?? ''} placeholder="999" title="Пустое значение считается как 999 костов" onChange={e=>{const value=e.target.value;changeEngine(w.id,{agentCosts:{...(w.agentCosts||{}),[agentId]:{...(w.agentCosts?.[agentId]||{}),...(value===''?{}:{[rank]:Math.max(0,Number(value))})}}});}}/></label>)}</div></div>})}{!Object.keys(w.agentCosts||{}).some(agentId=>state.agents.some(a=>a.id===agentId))&&<p className="muted-text">Пока нет индивидуальных настроек. Нажми «Добавить агента».</p>}</div></details>)}</div></>}</div><div className="notice-box"><CircleHelp size={17}/><div><b>Как выбирается кост</b><p>Для амплификатора сначала используется индивидуальная стоимость для выбранного агента, если она задана; иначе — основной кост при совпадении специальностей или оффбилд-кост при различии. Пустое значение при расчёте автоматически считается как 999 костов. Изменения синхронизируются через Supabase и видны всем аккаунтам и окнам сайта.</p></div></div></section>}
      {page === "profile" && <section className="content"><div className="profile-layout"><div className="panel profile-panel"><Avatar id={current.avatarId} size="lg"/><h2>{current.nickname}</h2><Badge kind={current.role==="admin"?"accent":"neutral"}>{current.role==="admin"?"Организатор":current.role==="cost_manager"?"Cost Manager":"Участник"}</Badge><p className="muted-text">Турниры, в которых аккаунт участвовал.</p></div><div className="panel"><div className="panel-heading"><div><span className="eyebrow">PROFILE SETTINGS</span><h3>Настройки профиля</h3></div></div><label className="field-label">Никнейм<input className="text-input" value={auth.nickname || current.nickname} onChange={e=>setAuth(a=>({...a,nickname:e.target.value}))}/></label><div className="avatar-picker"><span className="field-label">Аватарка</span><div className="avatar-options">{profileSelectableAvatars.map(a=><button key={a.id} className={`avatar-option ${current.avatarId===a.id?"picked":""}`} type="button" onClick={()=>void selectProfileAvatar(a.id)}><Avatar id={a.id}/><span>{a.name}</span></button>)}</div></div><Button onClick={()=>void saveProfile()}>Сохранить профиль</Button></div></div><div className="panel"><div className="panel-heading"><div><span className="eyebrow">TOURNAMENT HISTORY</span><h3>История турниров</h3></div></div>{state.entrants.filter(e=>e.playerId===current.id).length ? <div className="entrant-list">{state.entrants.filter(e=>e.playerId===current.id).map(e=>{const t=state.tournaments.find(x=>x.id===e.tournamentId);const tournamentMatches=state.matches.filter(m=>m.tournamentId===e.tournamentId&&m.status==="completed");const finalMatch=tournamentMatches.filter(m=>m.bracket==="final").sort((a,b)=>b.round-a.round)[0]||tournamentMatches.sort((a,b)=>b.round-a.round)[0];const won=finalMatch?.winner===current.id;const runnerUp=finalMatch?.loser===current.id;return <div className="entrant-row" key={`${e.tournamentId}-${e.playerId}`}><div><b>{t?.name||"Турнир"}</b><p className="muted-text">{t?.status==="completed"?(won?"Победитель турнира":runnerUp?"Финалист":"Турнир завершён"):t?.status==="in_progress"?"Турнир идёт":"Заявка принята"}</p></div><span className="spacer"/><Badge kind={won?"green":"neutral"}>{won?"1 место":runnerUp?"2 место":t?.status==="completed"?"Участник":"В процессе"}</Badge></div>;})}</div> : <div className="empty-state">История появится после регистрации на турнир.</div>}</div></section>}



      {joinRosterTournament && <div className="modal-backdrop" onClick={() => setJoinRosterTournament(null)}><div className="modal" onClick={e => e.stopPropagation()}><div className="panel-heading"><div><span className="eyebrow">TOURNAMENT REGISTRATION</span><h2>Выбери турнирный ростер</h2></div><button className="icon-btn" onClick={() => setJoinRosterTournament(null)}><X size={18}/></button></div><p className="muted-text">Этот сохранённый состав будет закреплён за тобой на весь турнир и автоматически выбран в каждой турнирной комнате.</p>{rostersLoading ? <p className="muted-text">Загружаем ростеры…</p> : <><label className="field-label">Сохранённый ростер<select className="text-input" value={selectedRegistrationRosterId} onChange={e => setSelectedRegistrationRosterId(e.target.value)}><option value="">Выбери ростер…</option>{ownedRosters.map(r => <option key={r.id} value={r.id}>{r.name} · {r.agent_ids.length} агентов</option>)}</select></label>{(() => { const roster = ownedRosters.find(r => r.id === selectedRegistrationRosterId); return roster ? <div className="registered-roster-preview"><b>{roster.name}</b><div className="registered-roster-agents">{roster.agent_ids.map(id => { const agent = state.agents.find(a => a.id === id); return <span key={id}>{agent?.imageUrl && <img src={getAgentIconUrl(agent.id)} alt=""/>}<span>{agent?.name || id}{roster.agent_levels?.[id] !== undefined ? ` · М${roster.agent_levels[id]}` : ""}</span></span>; })}</div><RosterAmplifierPreview ids={roster.w_engine_ids || []} levels={roster.w_engine_levels} engines={state.engines}/><p className="muted-text">{roster.agent_ids.length} агентов · {roster.w_engine_ids.length} амплификаторов</p></div> : null; })()}<div className="modal-actions"><Button kind="secondary" onClick={() => setJoinRosterTournament(null)}>Отмена</Button><Button disabled={!selectedRegistrationRosterId} onClick={() => void submitTournamentRegistration()}>Подать заявку с этим ростером</Button></div></>}</div></div>}
      {viewEntrantRoster && <div className="modal-backdrop" onClick={() => setViewEntrantRoster(null)}><div className="modal entrant-roster-modal" onClick={e => e.stopPropagation()}><div className="panel-heading"><div><span className="eyebrow">REGISTERED TOURNAMENT ROSTER</span><h2>{viewEntrantRoster.registeredRoster?.name || "Ростер участника"}</h2><p className="muted-text">{playerById(viewEntrantRoster.playerId)?.nickname || "Участник"} · состав, закреплённый при регистрации</p></div><button className="icon-btn" onClick={() => setViewEntrantRoster(null)}><X size={18}/></button></div><div className="registered-roster-agents large">{(viewEntrantRoster.registeredRoster?.agent_ids || []).map(id => { const agent = state.agents.find(a => a.id === id); return <article key={id}>{agent?.imageUrl && <img src={getAgentIconUrl(agent.id)} alt=""/>}<b>{agent?.name || id}</b><span>{agent?.specialty || "Класс не указан"}{viewEntrantRoster.registeredRoster?.agent_levels?.[id] !== undefined ? ` · М${viewEntrantRoster.registeredRoster.agent_levels[id]}` : ""}</span></article>; })}</div>{Boolean(viewEntrantRoster.registeredRoster?.w_engine_ids.length) && <div className="registered-roster-engines"><h3>Амплификаторы ростера</h3>{viewEntrantRoster.registeredRoster?.w_engine_ids.map((id,index) => { const engine = state.engines.find(w => w.id === id); const copyNumber=(viewEntrantRoster.registeredRoster?.w_engine_ids || []).slice(0,index+1).filter(item=>item===id).length; return <span key={`${id}-${index}`}>{engine?.imageUrl && <img src={engine.imageUrl} alt=""/>}{engine?.name || id} · R{getEngineCopyAwakening(viewEntrantRoster.registeredRoster?.w_engine_levels,id,copyNumber,engine)}</span>; })}</div>}<p className="muted-text">Этот снимок состава не меняется, даже если участник отредактирует личный ростер после регистрации.</p></div></div>}      {showCreate && <div className="modal-backdrop" onClick={()=>setShowCreate(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="panel-heading"><div><span className="eyebrow">NEW EVENT</span><h2>Создать турнир</h2></div><button className="icon-btn" onClick={()=>setShowCreate(false)}><X size={18}/></button></div><label className="field-label">Название<input className="text-input" value={newTournament.name} onChange={e=>setNewTournament(x=>({...x,name:e.target.value}))} placeholder="Community Cup"/></label><label className="field-label">Описание<textarea className="text-input textarea" value={newTournament.description} onChange={e=>setNewTournament(x=>({...x,description:e.target.value}))} placeholder="Краткие правила и информация"/></label><label className="field-label">Лимит участников<input className="text-input" type="number" min="2" value={newTournament.maxPlayers} onChange={e=>setNewTournament(x=>({...x,maxPlayers:Number(e.target.value)}))}/></label><label className="field-label">Сетка<select className="text-input" value={newTournament.format} onChange={e=>setNewTournament(x=>({...x,format:e.target.value as "single_elimination"|"double_elimination"}))}><option value="single_elimination">Single Elimination</option><option value="double_elimination">Double Elimination</option></select></label><label className="field-label"><span><input type="checkbox" checked={newTournament.swissStage} onChange={e=>setNewTournament(x=>({...x,swissStage:e.target.checked}))}/> Добавить групповой этап по швейцарской системе</span></label>{newTournament.swissStage && <label className="field-label">Количество раундов Swiss<input className="text-input" type="number" min="1" max="10" value={newTournament.swissRounds} onChange={e=>setNewTournament(x=>({...x,swissRounds:Math.max(1,Number(e.target.value)||1)}))}/></label>}<div className="modal-actions"><Button kind="secondary" onClick={()=>setShowCreate(false)}>Отмена</Button><Button onClick={createTournament}>Создать турнир</Button></div></div></div>}
      {authReady && (authOpen || passwordRecoveryOpen) && <div className="modal-backdrop auth-backdrop"><div className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className="auth-panel"><div className="brand-mark large">ZZ</div><span className="eyebrow">SUPABASE ACCOUNT</span><h2 id="auth-title">{passwordRecoveryOpen ? "Новый пароль" : forgotPassword ? "Восстановление пароля" : authMode === "login" ? "Вход в аккаунт" : "Регистрация"}</h2>
        {!isSupabaseConfigured && <p className="error-text">Supabase не настроен. Добавь ключи проекта в .env.local.</p>}
        {passwordRecoveryOpen ? <><p className="muted-text">Задай новый пароль для своей учётной записи.</p><label className="field-label">Новый пароль<input className="text-input" type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Не менее 6 символов"/></label><label className="field-label">Повтори новый пароль<input className="text-input" type="password" autoComplete="new-password" value={confirmNewPassword} onChange={e=>setConfirmNewPassword(e.target.value)} placeholder="Повтори пароль"/></label>{authError && <p className="error-text">{authError}</p>}<Button onClick={()=>void saveRecoveredPassword()} disabled={authBusy || !isSupabaseConfigured}>{authBusy ? "Сохраняем..." : "Сохранить пароль"} <ArrowRight size={15}/></Button></> : <>
          {!forgotPassword && <div className="tabs"><button className={authMode === "login" ? "selected" : ""} onClick={() => {setAuthMode("login");setAuthError("");setAuthNotice("");}}>Вход</button><button className={authMode === "register" ? "selected" : ""} onClick={() => {setAuthMode("register");setAuthError("");setAuthNotice("");}}>Регистрация</button></div>}
          {authMode === "register" && !forgotPassword && <label className="field-label">Никнейм<input className="text-input" value={auth.nickname} onChange={e=>setAuth(a=>({...a,nickname:e.target.value}))} placeholder="Твой ник"/></label>}
          <label className="field-label">Электронная почта<input className="text-input" type="email" autoComplete="email" value={authEmail} onChange={e=>{setAuthEmail(e.target.value);setAuthNotice("");}} placeholder="you@example.com"/></label>
          {!forgotPassword && <><label className="field-label">Пароль<input className="text-input" type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={auth.password} onChange={e=>setAuth(a=>({...a,password:e.target.value}))} placeholder="Пароль"/></label>{authMode === "login" && <button className="text-link forgot-password-link" onClick={()=>{setForgotPassword(true);setAuthError("");setAuthNotice("");}}>Забыли пароль?</button>}</>}
          {authError && <p className="error-text">{authError}</p>}{authNotice && <p className="muted-text auth-notice">{authNotice}</p>}
          {forgotPassword ? <><Button onClick={()=>void sendPasswordReset()} disabled={authBusy || !isSupabaseConfigured}>{authBusy ? "Отправляем..." : "Отправить ссылку для сброса"} <ArrowRight size={15}/></Button><button className="text-link" onClick={()=>{setForgotPassword(false);setAuthError("");setAuthNotice("");}}>Вернуться ко входу</button></> : <Button onClick={()=>void loginOrRegister()} disabled={authBusy || !isSupabaseConfigured}>{authBusy ? "Подождите..." : authMode === "login" ? "Войти" : "Создать аккаунт"} <ArrowRight size={15}/></Button>}
        </>}
      </div></div></div>}
      <footer className="footer"><span>ZZZ DRAFT HUB <i>•</i> COMMUNITY TOOL</span><span>UNOFFICIAL FAN PROJECT · NOT AFFILIATED WITH HOYOVERSE</span></footer>
    </main>
  </div>;
}
