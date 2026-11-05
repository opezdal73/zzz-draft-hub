import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, LockKeyhole, Plus, Swords, Trophy, X } from 'lucide-react';
import { getAgentIconUrl, initialAgents, initialWEngines } from './data';
import { getWEngineCost } from './costUtils';
import { engineCopyLevelKey, getEngineCopyAwakening } from './engineCopies';
import { compareBySpecialty, specialtyOrder } from './catalogUtils';
import { supabase } from './supabase';
import {
  MAX_AGENTS, MAX_TIMER_SECONDS, SQUAD_SIZE, canMarkReady, moveAgent, normalizeSlots, parseTimer,
  placeAgent, removeAgent, setEngine, squadCount, unplacedIds,
} from './bo2Utils';
import type { SquadNumber, SquadSlot } from './bo2Utils';

type Phase = 'squads' | 'game1' | 'squads2' | 'game2' | 'completed';
type Series = {
  room_id: string; second_room_id?: string | null; phase: Phase;
  // Game 1 squads and their ready flags.
  squad_one: SquadSlot[]; squad_two: SquadSlot[]; ready_one: boolean; ready_two: boolean;
  // Game 2 squads (arranged again after the second draft) and their ready flags.
  game2_squad_one?: SquadSlot[]; game2_squad_two?: SquadSlot[]; game2_squads_ready_one?: boolean; game2_squads_ready_two?: boolean;
  // "Go to game 2" confirmation after game 1.
  game2_ready_one?: boolean; game2_ready_two?: boolean;
  game1_timer_one: number | null; game1_timer_two: number | null; game2_timer_one: number | null; game2_timer_two: number | null;
  game1_restarts_one: number; game1_restarts_two: number; game2_restarts_one: number; game2_restarts_two: number;
  updated_at: string;
};
type Props = {
  room: any; profile: any; playerOneName?: string; playerTwoName?: string;
  judgeToken?: string | null;
  agents?: typeof initialAgents; engines?: typeof initialWEngines;
  onOpenRoom?: (id: string) => Promise<void> | void;
  onTournamentResult?: (matchId: string, winnerId: string) => void;
};

const clock = (n: number | null) => `${Math.floor((n ?? 0) / 60)}:${String((n ?? 0) % 60).padStart(2, '0')}`;
const hideBrokenImage = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget; const fallback = img.dataset.fallback;
  if (fallback && img.src !== fallback) { img.dataset.fallback = ''; img.src = fallback; } else img.style.display = 'none';
};

export default function MatchSeries({ room, profile, playerOneName = 'Игрок 1', playerTwoName = 'Игрок 2', judgeToken, agents, engines, onOpenRoom, onTournamentResult }: Props) {
  const [series, setSeries] = useState<Series | null>(null);
  const [liveRosterEngines, setLiveRosterEngines] = useState<{ ids: string[]; levels: Record<string, number> } | null>(null);
  const secondsInputRef = useRef<HTMLInputElement>(null);
  const [budget, setBudget] = useState(60);
  const [timerMinutesInput, setTimerMinutesInput] = useState('');
  const [timerSecondsInput, setTimerSecondsInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adminBudget, setAdminBudget] = useState('60');
  const [restartRules, setRestartRules] = useState({ free: 2, smallCount: 2, smallPenalty: 5, bigPenalty: 300 });
  const [restartDraft, setRestartDraft] = useState({ free: '2', smallCount: '2', smallPenalty: '5', bigPenalty: '300' });
  const [judgeSide, setJudgeSide] = useState<'one'|'two'>('one');
  const [enginePickerAgentId, setEnginePickerAgentId] = useState<string | null>(null);
  const [enginePickerSearch, setEnginePickerSearch] = useState('');
  const [enginePickerSpecialty, setEnginePickerSpecialty] = useState('Все классы');
  const [enginePickerRank, setEnginePickerRank] = useState('Все ранги');
  const isJudge = Boolean(judgeToken);

  // Both games share the same room. Game 2 swaps room positions, while the series keeps the original player order.
  // Keep legacy parent-room support so an already-running series can still finish after this update.
  const isSecondGame = Boolean(room.bo2_parent_room_id) || Number(room.bo2_game_number) === 2;
  const rootId: string = room.bo2_parent_room_id || room.id;
  const seriesPlayerOneId = isSecondGame ? room.player_two_id : room.player_one_id;
  const seriesPlayerTwoId = isSecondGame ? room.player_one_id : room.player_two_id;
  const isPlayer = isJudge || profile.id === room.player_one_id || profile.id === room.player_two_id;
  const side: 'one' | 'two' = isJudge ? judgeSide : profile.id === seriesPlayerOneId ? 'one' : profile.id === seriesPlayerTwoId ? 'two' : 'two';
  const seriesPlayerOneName = isSecondGame ? playerTwoName : playerOneName;
  const seriesPlayerTwoName = isSecondGame ? playerOneName : playerTwoName;
  const playerNames = [seriesPlayerOneName, seriesPlayerTwoName] as const;

  // Agents this player drafted in THE ROOM BEING SHOWN (game 1 room or game 2 room).
  const draftSideForSeriesPlayer = (which: 'one'|'two'): 'I1'|'I2' => {
    if (room.training_mode) {
      // Training rooms put the owner in both player ID fields, so IDs cannot tell
      // the two drafted rosters apart. Use the visible side swap and BO2 game swap.
      const originalOne: 'I1'|'I2' = room.training_sides_swapped ? 'I2' : 'I1';
      const gameOneSide: 'I1'|'I2' = isSecondGame ? (originalOne === 'I1' ? 'I2' : 'I1') : originalOne;
      return which === 'one' ? gameOneSide : gameOneSide === 'I1' ? 'I2' : 'I1';
    }
    const playerId = which === 'one' ? seriesPlayerOneId : seriesPlayerTwoId;
    return playerId === room.player_one_id ? 'I1' : 'I2';
  };
  const draftSide = draftSideForSeriesPlayer(side);
  const draftedIds = useMemo(
    () => Array.from(new Set<string>((room.actions ?? [])
      .filter((a: any) => (a.action === 'pick' || a.action === 'mirror') && a.side === draftSide)
      .map((a: any) => String(a.agent_id)))).slice(0, MAX_AGENTS),
    [room.actions, draftSide, room.training_mode, room.training_sides_swapped, isSecondGame],
  );

  // Costs come from the shared catalog passed by the draft room (not from this browser's localStorage).
  const costAgents = agents ?? initialAgents;
  const costEngines = engines ?? initialWEngines;

  const snapshotOne = isSecondGame ? (room.roster_snapshot_two || null) : (room.roster_snapshot_one || null);
  const snapshotTwo = isSecondGame ? (room.roster_snapshot_one || null) : (room.roster_snapshot_two || null);
  const ownSnapshot = side === 'one' ? snapshotOne : snapshotTwo;

  // The room snapshot can be stale when the roster was selected before its amplifier list was saved.
  // Re-read the source roster while this screen is open.
  useEffect(() => {
    let cancelled = false;
    const refreshRoster = async () => {
      if (!supabase || !ownSnapshot?.id) return;
      const { data } = await supabase.from('player_rosters').select('w_engine_ids,w_engine_levels').eq('id', ownSnapshot.id).maybeSingle();
      if (!cancelled && data) {
        const ids = Array.isArray(data.w_engine_ids) ? data.w_engine_ids.map(String) : [];
        setLiveRosterEngines({ ids, levels: (data.w_engine_levels && typeof data.w_engine_levels === 'object' ? data.w_engine_levels : {}) as Record<string, number> });
      }
    };
    void refreshRoster();
    const timer = window.setInterval(() => { void refreshRoster(); }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [ownSnapshot?.id]);

  const snapshotEngineIds: string[] = Array.isArray(ownSnapshot?.w_engine_ids) ? ownSnapshot.w_engine_ids : [];
  const allowedEngineIds = snapshotEngineIds.length ? snapshotEngineIds : (liveRosterEngines?.ids || []);
  const copyOrdinals = new Map<string, number>();
  const availableEngineCopies = allowedEngineIds.flatMap(engineId => {
    const engine = costEngines.find(w => w.id === engineId);
    if (!engine) return [];
    const copyNumber = (copyOrdinals.get(engineId) || 0) + 1;
    copyOrdinals.set(engineId, copyNumber);
    const key = engineCopyLevelKey(engineId, copyNumber);
    const levels = ownSnapshot?.w_engine_levels ?? liveRosterEngines?.levels;
    const level = getEngineCopyAwakening(levels, engineId, copyNumber, engine);
    return [{ id: engineId, key, level, engine }];
  });
  const targetAgentSpecialty = enginePickerAgentId
    ? costAgents.find(agent => agent.id === enginePickerAgentId)?.specialty
    : undefined;
  const sortedEngineCopies = [...availableEngineCopies].sort((a, b) =>
    (targetAgentSpecialty
      ? Number((a.engine.specialty || 'Не указана') !== targetAgentSpecialty) - Number((b.engine.specialty || 'Не указана') !== targetAgentSpecialty)
      : 0)
    || compareBySpecialty(a.engine, b.engine)
    || (a.id === b.id ? b.level - a.level : 0)
    || a.key.localeCompare(b.key),
  );
  const filteredEngineCopies = sortedEngineCopies.filter(copy =>
    copy.engine.name.toLocaleLowerCase('ru').includes(enginePickerSearch.toLocaleLowerCase('ru'))
    && (enginePickerSpecialty === 'Все классы' || (copy.engine.specialty || 'Не указана') === enginePickerSpecialty)
    && (enginePickerRank === 'Все ранги' || copy.engine.rank === enginePickerRank),
  );
  const engineRanks = [...new Set(sortedEngineCopies.map(copy => copy.engine.rank))]
    .sort((a, b) => (a === 'S' ? 0 : a === 'A' ? 1 : 2) - (b === 'S' ? 0 : b === 'A' ? 1 : 2));
  const engineCostFor = (agentId: string, engineId: string, copyKey?: string) => {
    const w = costEngines.find(x => x.id === engineId);
    const a = costAgents.find(x => x.id === agentId);
    const copy = availableEngineCopies.find(item => item.key === copyKey);
    const level = copy?.level ?? getEngineCopyAwakening(ownSnapshot?.w_engine_levels ?? liveRosterEngines?.levels, engineId, 1, w);
    return getWEngineCost(w, a, level);
  };

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error: loadError } = isJudge
      ? await supabase.rpc('read_match_series_as_judge', { p_token: judgeToken })
      : await supabase.from('draft_match_series').select('*').eq('room_id', rootId).maybeSingle();
    if (loadError) { setError(`Не удалось загрузить экран отрядов: ${loadError.message}. Примени supabase/bo2_match_series.sql.`); return; }
    if (data) { setSeries(data as Series); return; }
    // First time: create the series with EMPTY squads. Nobody is placed automatically.
    const row = { room_id: rootId, phase: 'squads', squad_one: [], squad_two: [], ready_one: false, ready_two: false };
    const { data: created, error: insertError } = await supabase.from('draft_match_series').upsert(row, { onConflict: 'room_id', ignoreDuplicates: true }).select('*').maybeSingle();
    if (insertError) { setError(`Не удалось создать серию BO2: ${insertError.message}`); return; }
    if (created) { setSeries(created as Series); return; }
    const { data: existing, error: readError } = await supabase.from('draft_match_series').select('*').eq('room_id', rootId).maybeSingle();
    if (readError || !existing) { setError(`Не удалось загрузить уже созданную серию BO2${readError ? `: ${readError.message}` : ''}.`); return; }
    setSeries(existing as Series);
  }, [rootId, isJudge, judgeToken]);

  useEffect(() => {
    void load();
    if (!supabase) return;
    const channel = supabase.channel(`match-series-${rootId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_match_series', filter: `room_id=eq.${rootId}` }, p => {
        if (p.new && (p.new as Series).room_id) setSeries(p.new as Series);
      }).subscribe();
    const poll = window.setInterval(() => { void load(); }, 1500);
    return () => { window.clearInterval(poll); void supabase!.removeChannel(channel); };
  }, [load, rootId]);

  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      const { data } = await supabase.from('system_settings').select('settings').eq('id', 'amplifier_rules').maybeSingle();
      if (data?.settings) { setBudget(Math.max(0, Number(data.settings.budget) || 60)); setAdminBudget(String(Math.max(0, Number(data.settings.budget) || 60))); }
      const { data: rr } = await supabase.from('system_settings').select('settings').eq('id', 'restart_rules').maybeSingle();
      const r = rr?.settings || {};
      const rules = { free: Math.max(0, Math.min(5, Number(r.free ?? 2))), smallCount: Math.max(0, Math.min(5, Number(r.smallCount ?? 2))), smallPenalty: Math.max(0, Number(r.smallPenalty ?? 5)), bigPenalty: Math.max(0, Number(r.bigPenalty ?? 300)) };
      setRestartRules(rules);
      setRestartDraft({ free: String(rules.free), smallCount: String(rules.smallCount), smallPenalty: String(rules.smallPenalty), bigPenalty: String(rules.bigPenalty) });
    })();
  }, []);

  if (!series) return <div className="panel"><h3>Подготовка BO2</h3><p>{error || 'Загружаем данные матча…'}</p></div>;

  // ---------- squads (the same editor serves game 1 and game 2) ----------
  const squadGame: 1 | 2 | null = series.phase === 'squads' ? 1 : series.phase === 'squads2' ? 2 : null;
  const roomGame: 1 | 2 = isSecondGame ? 2 : 1;
  const squadHere = squadGame === roomGame;
  const squadField = (game: 1 | 2) => (game === 1 ? (side === 'one' ? 'squad_one' : 'squad_two') : (side === 'one' ? 'game2_squad_one' : 'game2_squad_two')) as keyof Series;
  const readyField = (game: 1 | 2, own: boolean) => {
    const one = own ? side === 'one' : side !== 'one';
    return (game === 1 ? (one ? 'ready_one' : 'ready_two') : (one ? 'game2_squads_ready_one' : 'game2_squads_ready_two')) as keyof Series;
  };
  const rawSlots: SquadSlot[] = squadGame ? normalizeSlots(series[squadField(squadGame)] as SquadSlot[] | undefined, draftedIds) : [];
  const occupiedCopies = new Set<string>();
  const slots: SquadSlot[] = rawSlots.map(slot => {
    if (!slot.engine_id) return { ...slot, engine_copy_key: '' };
    const preserved = availableEngineCopies.find(copy => copy.key === slot.engine_copy_key && copy.id === slot.engine_id && !occupiedCopies.has(copy.key));
    const copy = preserved ?? availableEngineCopies.find(item => item.id === slot.engine_id && !occupiedCopies.has(item.key));
    if (!copy) return { ...slot, engine_copy_key: '' };
    occupiedCopies.add(copy.key);
    return { ...slot, engine_copy_key: copy.key };
  });
  const notPlaced = unplacedIds(slots, draftedIds);
  const squadReady = squadGame ? Boolean(series[readyField(squadGame, true)]) : false;
  const opponentSquadReady = squadGame ? Boolean(series[readyField(squadGame, false)]) : false;
  const squadLocked = squadReady || busy || !isPlayer;
  const totalCost = slots.reduce((sum, a) => (a.engine_id ? sum + engineCostFor(a.agent_id, a.engine_id, a.engine_copy_key) : sum), 0);
  const readyAllowed = canMarkReady(slots, draftedIds) && totalCost <= budget;

  const save = async (patch: Partial<Series>) => {
    if (!supabase) return false;
    setBusy(true); setError('');
    // Phase changes (squads -> game1, squads2 -> game2) are made atomically by the database trigger.
    if (isJudge) {
      let result: Series | null = series;
      for (const [field, value] of Object.entries(patch)) {
        const { data, error: saveError } = await supabase.rpc('update_match_series_as_judge', { p_token: judgeToken, p_field: field, p_value: value });
        if (saveError) { setError(`Не удалось сохранить матч: ${saveError.message}`); setBusy(false); return false; }
        if (data) result = data as Series;
      }
      if (result) setSeries(result);
      setBusy(false); return true;
    }
    const { data, error: saveError } = await supabase.from('draft_match_series').update({ ...patch, updated_at: new Date().toISOString() }).eq('room_id', rootId).select('*').single();
    if (saveError) { setError(`Не удалось сохранить матч: ${saveError.message}`); setBusy(false); return false; }
    setSeries(data as Series); setBusy(false); return true;
  };
  const commitSlots = (next: SquadSlot[] | null) => {
    if (!squadGame || !next || squadLocked) return;
    void save({ [squadField(squadGame)]: next } as Partial<Series>);
  };
  const nameOf = (id: string) => costAgents.find(a => a.id === id)?.name ?? id;
  const avatarOf = (id: string) => costAgents.find(a => a.id === id);

  // ---------- timers (both games: 10:00 at most) ----------
  const timer = parseTimer(timerMinutesInput, timerSecondsInput);
  const timerGame: 1 | 2 = series.phase === 'game1' ? 1 : 2;
  const myTimer = timerGame === 1 ? (side === 'one' ? series.game1_timer_one : series.game1_timer_two) : (side === 'one' ? series.game2_timer_one : series.game2_timer_two);
  const submitTimer = async () => {
    if (timer.seconds === null) { setError(timer.error || 'Введи время в формате мм:сс (не больше 10:00).'); return; }
    const patch = timerGame === 1 ? (side === 'one' ? { game1_timer_one: timer.seconds } : { game1_timer_two: timer.seconds }) : (side === 'one' ? { game2_timer_one: timer.seconds } : { game2_timer_two: timer.seconds });
    const ok = await save(patch);
    if (ok) { setTimerMinutesInput(''); setTimerSecondsInput(''); }
  };

  const advance = async () => {
    if (!isJudge && (series.game1_timer_one === null || series.game1_timer_two === null)) { setError('Сначала оба игрока должны ввести таймер первой игры.'); return; }
    if (!supabase) { setError('Supabase не настроен.'); return; }
    if (isJudge) {
      setBusy(true); setError('');
      const { data, error: judgeError } = await supabase.rpc('control_draft_room_as_judge', { p_token: judgeToken, p_action: 'bo2_game2' });
      setBusy(false);
      if (judgeError) { setError(`Не удалось начать вторую игру: ${judgeError.message}`); return; }
      const result = Array.isArray(data) ? data[0] : data;
      const roomId = result?.id || result?.room_id;
      if (roomId && onOpenRoom) await onOpenRoom(roomId);
      else setError('Обе стороны подтверждены. Комната обновится автоматически.');
      return;
    }
    setBusy(true); setError('');
    const { data, error: rpcError } = await supabase.rpc('set_bo2_game2_ready', { p_room_id: rootId });
    setBusy(false);
    if (rpcError) { setError(`Не удалось подтвердить готовность ко второй игре: ${rpcError.message}. Проверь, что применена миграция supabase/bo2_single_room_transition.sql.`); return; }
    const result = Array.isArray(data) ? data[0] : data;
    const roomId = typeof result === 'string' ? result : result?.room_id;
    if (roomId && onOpenRoom) { await onOpenRoom(roomId); }
    else setError('Готовность сохранена. Ожидаем подтверждение второго игрока.');
  };

  const finish = async () => {
    if (series.game2_timer_one === null || series.game2_timer_two === null) { setError('Сначала оба игрока должны ввести таймер второй игры.'); return; }
    const ok = await save({ phase: 'completed' });
    if (ok && series.game1_timer_one !== null && series.game1_timer_two !== null) {
      const penalty = (count: number) => Math.min(Math.max(0, count - restartRules.free), restartRules.smallCount) * restartRules.smallPenalty + Math.max(0, count - restartRules.free - restartRules.smallCount) * restartRules.bigPenalty;
      const one = series.game1_timer_one + series.game2_timer_one + penalty(series.game1_restarts_one ?? 0) + penalty(series.game2_restarts_one ?? 0);
      const two = series.game1_timer_two + series.game2_timer_two + penalty(series.game1_restarts_two ?? 0) + penalty(series.game2_restarts_two ?? 0);
      if (one !== two) {
        let root = room;
        if (room.bo2_parent_room_id && supabase) {
          const { data } = await supabase.from('draft_rooms').select('tournament_match_id').eq('id', room.bo2_parent_room_id).maybeSingle();
          if (data) root = { ...room, ...data };
        }
        if (root.tournament_match_id) onTournamentResult?.(root.tournament_match_id, one < two ? seriesPlayerOneId : seriesPlayerTwoId);
      }
    }
  };

  const restartPenalty = (count: number) => Math.min(Math.max(0, count - restartRules.free), restartRules.smallCount) * restartRules.smallPenalty + Math.max(0, count - restartRules.free - restartRules.smallCount) * restartRules.bigPenalty;
  const penaltyOne = restartPenalty(series.game1_restarts_one ?? 0) + restartPenalty(series.game2_restarts_one ?? 0);
  const penaltyTwo = restartPenalty(series.game1_restarts_two ?? 0) + restartPenalty(series.game2_restarts_two ?? 0);
  const totalOne = (series.game1_timer_one ?? 0) + (series.game2_timer_one ?? 0) + penaltyOne;
  const totalTwo = (series.game1_timer_two ?? 0) + (series.game2_timer_two ?? 0) + penaltyTwo;
  const fmtSeconds = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

  const heading = series.phase === 'squads' ? 'Сборка отрядов · игра 1'
    : series.phase === 'game1' ? 'Первая игра'
    : series.phase === 'squads2' ? 'Сборка отрядов · игра 2'
    : series.phase === 'game2' ? 'Вторая игра · смена сторон'
    : 'Результаты BO2';

  const draftedIdsForSide = (which: 'one'|'two') => Array.from(new Set<string>((room.actions ?? [])
    .filter((a: any) => (a.action === 'pick' || a.action === 'mirror') && a.side === draftSideForSeriesPlayer(which))
    .map((a: any) => String(a.agent_id)))).slice(0, MAX_AGENTS);
  const storedSlotsFor = (game: 1|2, which: 'one'|'two'): SquadSlot[] => {
    const key = game === 1 ? (which === 'one' ? 'squad_one' : 'squad_two') : (which === 'one' ? 'game2_squad_one' : 'game2_squad_two');
    return ((series[key] as SquadSlot[] | undefined) ?? []);
  };
  const visibleGames: (1|2)[] = series.phase === 'completed' || series.phase === 'game2' ? [1, 2] : [roomGame];
  const renderSharedTeams = (game: 1|2) => <section className="series-shared-game" key={game}>
    <h3>Отряды · игра {game}</h3>
    <div className="series-shared-columns">{(['one','two'] as const).map(which => {
      const allDrafted = draftedIdsForSide(which);
      const teamSlots = game === squadGame && which === side ? slots : storedSlotsFor(game, which);
      const assigned = new Set(teamSlots.map(slot => slot.agent_id));
      const label = which === 'one' ? seriesPlayerOneName : seriesPlayerTwoName;
      const playerSnapshot = which === 'one' ? snapshotOne : snapshotTwo;
      const engineTotal = teamSlots.reduce((sum,slot)=>{const engine=costEngines.find(item=>item.id===slot.engine_id);const agent=costAgents.find(item=>item.id===slot.agent_id);if(!engine)return sum;const copyNumber=Number(slot.engine_copy_key?.split(':').pop())||1;const level=getEngineCopyAwakening(playerSnapshot?.w_engine_levels,slot.engine_id,copyNumber,engine);return sum+getWEngineCost(engine,agent,level);},0);
      const readyForPlayer = game===1 ? Boolean(series[which==='one'?'ready_one':'ready_two']) : Boolean(series[which==='one'?'game2_squads_ready_one':'game2_squads_ready_two']);
      const canEdit = game === squadGame && which === side && !squadLocked;
      return <div className={`series-shared-player side-${which} ${which===side?'is-own':''}`} key={which}><h4>{label}<span>{which === side ? 'ВАША СТОРОНА' : 'СОПЕРНИК'}</span></h4>
      {([1,2] as const).map(squad => {const members=normalizeSlots(teamSlots.filter(slot=>slot.squad===squad),teamSlots.map(slot=>slot.agent_id));return <div className="series-shared-squad" key={squad}><div className="series-shared-squad-head"><b>0{squad} · ОТРЯД</b><span>{members.length}/{SQUAD_SIZE}</span></div><div className="series-shared-cards">{Array.from({length:SQUAD_SIZE},(_,index)=>{const slot=members.find(member=>member.slot_index===index);if(!slot)return <div className="series-shared-slot empty" key={`empty-${squad}-${index}`}><b>+</b>{canEdit&&<select aria-label={`Добавить агента в отряд ${squad}`} value="" disabled={busy||allDrafted.filter(id=>!assigned.has(id)).length===0} onChange={e=>{const id=e.target.value;if(id)commitSlots(placeAgent(teamSlots,draftedIds,id,squad));}}><option value="">Добавить агента</option>{allDrafted.filter(id=>!assigned.has(id)).map(id=><option key={id} value={id}>{nameOf(id)}</option>)}</select>}</div>;const agent=avatarOf(slot.agent_id);const engine=costEngines.find(item=>item.id===slot.engine_id);const engineCopy=availableEngineCopies.find(item=>item.key===slot.engine_copy_key);const other:SquadNumber=squad===1?2:1;const otherFull=squadCount(teamSlots,other)>=SQUAD_SIZE;return <div className={`series-shared-slot filled ${canEdit?'editable':''}`} key={slot.agent_id}><img className="series-shared-agent-image" src={getAgentIconUrl(slot.agent_id)} data-fallback={agent?.imageFallbackUrl} alt="" onError={hideBrokenImage}/><div className="series-shared-slot-content"><b title={agent?.name}>{nameOf(slot.agent_id)}</b><small>{agent?.specialty??'Класс не указан'}</small>{engine&&<span className="series-shared-engine-chip">{engine.imageUrl&&<img src={engine.imageUrl} data-fallback={engine.imageFallbackUrl} alt="" onError={hideBrokenImage}/>}<small>{engine.name} · Р{engineCopy?.level??1} · {engineCostFor(slot.agent_id,engine.id,slot.engine_copy_key)} кост.</small></span>}<button type="button" className="series-engine-trigger" aria-label={`Выбрать амплификатор для ${nameOf(slot.agent_id)}`} disabled={!canEdit||availableEngineCopies.length===0} onClick={()=>setEnginePickerAgentId(slot.agent_id)}>{engineCopy?.engine.imageUrl&&<img src={engineCopy.engine.imageUrl} data-fallback={engineCopy.engine.imageFallbackUrl} alt="" onError={hideBrokenImage}/>}<span>{engineCopy?`${engineCopy.engine.name} · Р${engineCopy.level}`:'Выбрать амплификатор'}</span><Plus size={12}/></button></div>{canEdit&&<div className="series-shared-slot-actions"><button type="button" title={otherFull?`Отряд ${other} заполнен`:`Перенести в отряд ${other}`} aria-label={`Перенести ${nameOf(slot.agent_id)} в отряд ${other}`} disabled={busy||otherFull} onClick={()=>commitSlots(moveAgent(teamSlots,slot.agent_id,other))}><ArrowLeftRight size={13}/></button><button type="button" title="Убрать из отряда" aria-label={`Убрать ${nameOf(slot.agent_id)} из отряда`} disabled={busy} onClick={()=>commitSlots(removeAgent(teamSlots,slot.agent_id))}><X size={13}/></button></div>}</div>;})}</div></div>;})}
        {game === roomGame && allDrafted.some(id=>!assigned.has(id))&&<div className="series-shared-unplaced"><b>Не распределены:</b> {allDrafted.filter(id=>!assigned.has(id)).map(id=>nameOf(id)).join(', ')}</div>}
        <div className="series-shared-footer"><span>Кост амплификаторов: <b>{engineTotal} / {budget}</b></span><strong className={readyForPlayer?'ready':''}>{readyForPlayer?'ГОТОВ':'НЕ ГОТОВ'}</strong></div>
      </div>;
    })}</div>
  </section>;

  return <div className="match-series"><div className="panel">
    <div className="panel-heading"><div><span className="eyebrow">BO2 · MATCH PREPARATION</span><h2>{heading}</h2>
      {squadGame && <p className="muted-text">Игроки: {series[readyField(squadGame, side === 'one' ? true : false)] ? `${seriesPlayerOneName} готов` : `${seriesPlayerOneName} не готов`} · {series[readyField(squadGame, side === 'one' ? false : true)] ? `${seriesPlayerTwoName} готов` : `${seriesPlayerTwoName} не готов`}</p>}
    </div><Swords size={25} /></div>
    <div className="series-shared-teams">{visibleGames.map(renderSharedTeams)}</div>
    {isJudge && <div className="notice-box"><span><b>Режим судьи · редактировать за:</b></span><button className={`btn ${judgeSide==='one'?'btn-primary':'btn-secondary'}`} disabled={busy} onClick={()=>setJudgeSide('one')}>{seriesPlayerOneName}</button><button className={`btn ${judgeSide==='two'?'btn-primary':'btn-secondary'}`} disabled={busy} onClick={()=>setJudgeSide('two')}>{seriesPlayerTwoName}</button><p>Выбранную сторону можно редактировать: отряды, амплификаторы, готовность и таймеры.</p></div>}
    {profile.role==='admin'&&<details className="series-admin-settings"><summary>Настройки амплификаторов (админ)</summary><label className="field-label">Общий лимит на 6 агентов<input className="text-input" type="number" min="0" value={adminBudget} onChange={e=>setAdminBudget(e.target.value)}/></label><p className="muted-text">Стоимость каждого амплификатора берётся из актуального Cost Manager: индивидуальный кост для агента, затем основной или оффбилд-кост соответствующего ранга. Старые общие значения амплификаторов больше не используются.</p><button className="btn btn-secondary" disabled={busy} onClick={async()=>{if(!supabase)return;const settings={budget:Math.max(0,Number(adminBudget)||0)};const {error}=await supabase.from('system_settings').upsert({id:'amplifier_rules',settings,updated_by:profile.id,updated_at:new Date().toISOString()});if(error)setError(error.message);else{setBudget(settings.budget);setError('Лимит стоимости сохранён. Стоимости амплификаторов берутся из Cost Manager.');}}}>Сохранить лимит</button><hr/><h4>Штрафы за рестарты</h4><div className="series-engine-costs"><label>Бесплатных рестартов<input className="text-input" type="number" min="0" max="5" value={restartDraft.free} onChange={e=>setRestartDraft(v=>({...v,free:e.target.value}))}/></label><label>Рестартов со штрафом +5 сек.<input className="text-input" type="number" min="0" max="5" value={restartDraft.smallCount} onChange={e=>setRestartDraft(v=>({...v,smallCount:e.target.value}))}/></label><label>Малый штраф, сек.<input className="text-input" type="number" min="0" value={restartDraft.smallPenalty} onChange={e=>setRestartDraft(v=>({...v,smallPenalty:e.target.value}))}/></label><label>Штраф следующего рестарта, сек.<input className="text-input" type="number" min="0" value={restartDraft.bigPenalty} onChange={e=>setRestartDraft(v=>({...v,bigPenalty:e.target.value}))}/></label></div><button className="btn btn-secondary" disabled={busy} onClick={async()=>{if(!supabase)return;const rules={free:Math.max(0,Math.min(5,Number(restartDraft.free)||0)),smallCount:Math.max(0,Math.min(5,Number(restartDraft.smallCount)||0)),smallPenalty:Math.max(0,Number(restartDraft.smallPenalty)||0),bigPenalty:Math.max(0,Number(restartDraft.bigPenalty)||0)};const {error}=await supabase.from('system_settings').upsert({id:'restart_rules',settings:rules,updated_by:profile.id,updated_at:new Date().toISOString()});if(error)setError(error.message);else{setRestartRules(rules);setError('Настройки рестартов сохранены.');}}}>Сохранить штрафы</button></details>}

    {squadGame && !squadHere && <div className="notice-box"><p>{squadGame === 2
      ? 'Сейчас идёт подготовка ко второй игре в комнате матча.'
      : 'Отряды первой игры собираются в комнате первой игры.'}</p>
      {squadGame === 2 && isSecondGame && series.second_room_id && onOpenRoom && <button className="btn btn-secondary" onClick={() => void onOpenRoom(series.second_room_id!)}>Вернуться в комнату второй игры старой серии</button>}
      </div>}

    {squadGame && squadHere && <>
      <p className="muted-text squad-hint">Распредели агентов по двум отрядам прямо в карточках выше: добавляй в пустые квадраты, выбирай амплификатор там же и меняй агента между отрядами. В каждом отряде до {SQUAD_SIZE} агентов; лимит амплификаторов — {budget} костов.</p>
      {availableEngineCopies.length === 0 && <p className="muted-text">{ownSnapshot?.id ? 'Загружаем список амплификаторов ростера…' : 'В сохранённом снимке ростера нет амплификаторов. Можно оставить всех без них и нажать «Готов».'}</p>}
      <div className="series-budget"><b>Стоимость назначенных амплификаторов: {totalCost} / {budget}</b><span>{budget - totalCost >= 0 ? `Осталось ${budget - totalCost} кост.` : `Превышение на ${totalCost - budget} кост.`}</span></div>
      <button className="btn btn-primary" disabled={busy || squadReady || !isPlayer || !readyAllowed}
        onClick={() => void save({ [readyField(squadGame, true)]: true } as Partial<Series>)}>
        {squadReady ? <><LockKeyhole size={15} /> Готово — состав заблокирован</> : <><CheckCircle2 size={15} /> Готов</>}
      </button>
      <p className="muted-text">{squadReady ? (opponentSquadReady ? 'Оба игрока готовы.' : 'Ожидаем соперника.') : (notPlaced.length > 0 ? 'Сначала распредели всех агентов.' : totalCost > budget ? 'Превышен лимит стоимости амплификаторов.' : 'После готовности редактирование будет заблокировано.')}{!squadReady && opponentSquadReady ? ' Соперник уже готов.' : ''}</p>
    </>}

    {(series.phase === 'game1' || series.phase === 'game2') && <>
      <div className="timer-grid">
        <div><span>{seriesPlayerOneName} · игра 1</span><b>{clock(series.game1_timer_one)}</b></div>
        <div><span>{seriesPlayerTwoName} · игра 1</span><b>{clock(series.game1_timer_two)}</b></div>
        {series.phase === 'game2' && <><div><span>{seriesPlayerOneName} · игра 2</span><b>{clock(series.game2_timer_one)}</b></div><div><span>{seriesPlayerTwoName} · игра 2</span><b>{clock(series.game2_timer_two)}</b></div></>}
      </div>
      <div className="restart-panel"><h3>Рестарты · {series.phase === 'game1' ? 'игра 1' : 'игра 2'}</h3>
        {([1, 2] as const).map(player => {
          const field = (series.phase === 'game1' ? (player === 1 ? 'game1_restarts_one' : 'game1_restarts_two') : (player === 1 ? 'game2_restarts_one' : 'game2_restarts_two')) as keyof Series;
          const count = Number(series[field] ?? 0);
          const isOwn = side === 'one' ? player === 1 : player === 2;
          return <div className="restart-row" key={field}><span>{playerNames[player - 1]}: <b>{count}/5</b> · штраф +{restartPenalty(count)} сек.</span>
        {(isOwn || isJudge) && <button className="btn btn-secondary" disabled={busy || count >= 5} onClick={() => void save({ [field]: count + 1 } as Partial<Series>)}>{count >= 5 ? 'Лимит рестартов' : 'Зарегистрировать рестарт'}</button>}</div>;
        })}
        <p className="muted-text">Правило: первые {restartRules.free} бесплатные, следующие {restartRules.smallCount} по +{restartRules.smallPenalty} сек., затем +{restartRules.bigPenalty} сек. за последний рестарт. Максимум 5.</p>
      </div>
      <label className="field-label">Твой таймер ({series.phase === 'game1' ? 'первая' : 'вторая'} игра) · не больше 10:00
        <div className="timer-input-mask">
          <input className="text-input" inputMode="numeric" aria-label="Минуты" value={timerMinutesInput} placeholder="мм" disabled={busy}
            onChange={e => { let value = e.target.value.replace(/\D/g, '').slice(0, 2); if (Number(value) > MAX_TIMER_SECONDS / 60) value = String(MAX_TIMER_SECONDS / 60); setTimerMinutesInput(value); if (value.length === 2) secondsInputRef.current?.focus(); }} />
          <span>:</span>
          <input ref={secondsInputRef} className="text-input" inputMode="numeric" aria-label="Секунды" value={timerSecondsInput} placeholder="сс" disabled={busy}
            onChange={e => setTimerSecondsInput(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onKeyDown={e => { if (e.key === 'Backspace' && !timerSecondsInput) document.querySelector<HTMLInputElement>('.timer-input-mask input[aria-label="Минуты"]')?.focus(); }} />
        </div>
      </label>
      {timer.error && <p className="timer-error" role="alert">{timer.error}</p>}
      <button className="btn btn-secondary" disabled={busy || timer.seconds === null || myTimer !== null} onClick={() => void submitTimer()}>Сохранить таймер</button>
      {series.phase === 'game1' && (isJudge || (series.game1_timer_one !== null && series.game1_timer_two !== null)) && <>
        <button className="btn btn-primary" disabled={busy || (side === 'one' ? series.game2_ready_one : series.game2_ready_two)} onClick={() => void advance()}>{(side === 'one' ? series.game2_ready_one : series.game2_ready_two) ? 'Готов ко второй игре' : 'Перейти ко второй игре'}</button>
        <p className="muted-text">{series.game2_ready_one && series.game2_ready_two ? 'Оба игрока готовы — в этой комнате начинается подготовка ко второй игре.' : (side === 'one' ? series.game2_ready_two : series.game2_ready_one) ? 'Соперник готов. Подтверди переход, чтобы начать вторую игру.' : 'Для перехода оба игрока должны нажать кнопку.'}</p></>}
      {series.phase === 'game2' && series.game2_timer_one !== null && series.game2_timer_two !== null && <button className="btn btn-primary" disabled={busy} onClick={() => void finish()}>Завершить игру</button>}
    </>}

    {series.phase==='completed'&&<><div className="timer-grid"><div><span>{seriesPlayerOneName} · игра 1</span><b>{clock(series.game1_timer_one)}</b></div><div><span>{seriesPlayerTwoName} · игра 1</span><b>{clock(series.game1_timer_two)}</b></div><div><span>{seriesPlayerOneName} · игра 2</span><b>{clock(series.game2_timer_one)}</b></div><div><span>{seriesPlayerTwoName} · игра 2</span><b>{clock(series.game2_timer_two)}</b></div></div><div className="timer-grid"><div><span>Рестарты · {seriesPlayerOneName}</span><b>{series.game1_restarts_one ?? 0} + {series.game2_restarts_one ?? 0}</b></div><div><span>Рестарты · {seriesPlayerTwoName}</span><b>{series.game1_restarts_two ?? 0} + {series.game2_restarts_two ?? 0}</b></div></div><div className="timer-grid"><div><span>Штрафы · {seriesPlayerOneName}</span><b>+{fmtSeconds(penaltyOne)}</b></div><div><span>Штрафы · {seriesPlayerTwoName}</span><b>+{fmtSeconds(penaltyTwo)}</b></div></div><div className="series-result"><Trophy size={28}/><h2>{totalOne===totalTwo?'Ничья':totalOne<totalTwo?`Победил ${seriesPlayerOneName}`:`Победил ${seriesPlayerTwoName}`}</h2><p>Суммарное время с учётом штрафов: {seriesPlayerOneName} — {clock(totalOne)} (штрафы +{fmtSeconds(penaltyOne)}), {seriesPlayerTwoName} — {clock(totalTwo)} (штрафы +{fmtSeconds(penaltyTwo)}).</p><b>Разница: {clock(Math.abs(totalOne-totalTwo))}</b></div></>}

    {squadGame && squadHere && enginePickerAgentId && <div className="series-engine-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEnginePickerAgentId(null);}}><section className="series-engine-modal" role="dialog" aria-modal="true" aria-labelledby="series-engine-modal-title"><header><div><span className="eyebrow">АМПЛИФИКАТОРЫ РОСТЕРА</span><h3 id="series-engine-modal-title">{nameOf(enginePickerAgentId)}</h3></div><button type="button" className="icon-btn" aria-label="Закрыть выбор амплификатора" onClick={()=>setEnginePickerAgentId(null)}><X size={18}/></button></header><button type="button" className="series-engine-none" onClick={()=>{commitSlots(setEngine(slots,enginePickerAgentId,'',''));setEnginePickerAgentId(null);}}>Убрать амплификатор</button><div className="series-engine-filters"><input className="text-input" type="search" placeholder="Найти амплификатор…" value={enginePickerSearch} onChange={e=>setEnginePickerSearch(e.target.value)}/><label>Класс<select className="text-input" value={enginePickerSpecialty} onChange={e=>setEnginePickerSpecialty(e.target.value)}><option>Все классы</option>{specialtyOrder.map(item=><option key={item}>{item}</option>)}</select></label><label>Ранг<select className="text-input" value={enginePickerRank} onChange={e=>setEnginePickerRank(e.target.value)}><option>Все ранги</option>{engineRanks.map(rank=><option key={rank}>{rank}</option>)}</select></label></div>{filteredEngineCopies.length===0?<p className="muted-text">По этим фильтрам амплификаторы не найдены.</p>:<div className="series-engine-grid">{filteredEngineCopies.map(copy=>{const usedBy=slots.find(item=>item.engine_copy_key===copy.key&&item.agent_id!==enginePickerAgentId);const selected=slots.some(item=>item.agent_id===enginePickerAgentId&&item.engine_copy_key===copy.key);return <button type="button" className={`series-engine-card ${selected?'selected':''}`} key={copy.key} disabled={Boolean(usedBy)||busy} title={usedBy?`Уже назначен: ${nameOf(usedBy.agent_id)}`:undefined} onClick={()=>{commitSlots(setEngine(slots,enginePickerAgentId,copy.id,copy.key));setEnginePickerAgentId(null);}}><span className="series-engine-card-image">{copy.engine.imageUrl&&<img src={copy.engine.imageUrl} data-fallback={copy.engine.imageFallbackUrl} alt="" onError={hideBrokenImage}/>}</span><b>{copy.engine.name}</b><small>Пробуждение Р{copy.level}</small><small>{engineCostFor(enginePickerAgentId,copy.id,copy.key)} кост.</small>{usedBy&&<small className="series-engine-used">Назначен: {nameOf(usedBy.agent_id)}</small>}</button>;})}</div>}</section></div>}
    {error && <div className="notice-box"><p>{error}</p></div>}
  </div></div>;
}
