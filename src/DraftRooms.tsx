import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, LogIn, LogOut, Plus, RefreshCw, Swords, UserRound, CheckCircle2, Ban, Users, Trash2, Clock3, Pause, Play, Undo2, Gavel, Link2 } from 'lucide-react';
import { getAgentIconUrl, initialAgents, initialWEngines } from './data';
import { isSupabaseConfigured, supabase } from './supabase';
import MatchSeries from './MatchSeries';
import { compareBySpecialty, specialtyOrder } from './catalogUtils';
import { getAgentCost } from './costUtils';

type Step = { side: 'I1'|'I2'; action: 'ban'|'pick'|'mirror'; count: number; label?: string };
type Room = {
  id: string; join_code: string; title: string; host_id: string; player_one_id: string|null; player_two_id: string|null; updated_at?: string;
  template_snapshot: Step[]; status: 'waiting'|'ready'|'active'|'completed'|'cancelled'; roster_one: string[]; roster_two: string[];
  actions: {side:'I1'|'I2'; action:'ban'|'pick'|'mirror'; agent_id:string; step_index:number; actor_id:string}[]; current_step:number; revision:number; min_agents:number;
  bo2_parent_room_id?: string | null;
  bo2_game_number?: number;
  tournament_id?: string | null;
  tournament_match_id?: string | null;
  player_one_ready?: boolean;
  player_two_ready?: boolean;
  turn_timer_seconds?: number;
  reserve_time_seconds?: number;
  turn_started_at?: string | null;
  is_paused?: boolean;
  pause_started_at?: string | null;
  roster_snapshot_one?: { agent_ids?: string[]; w_engine_ids?: string[]; agent_levels?: Record<string, number>; w_engine_levels?: Record<string, number> } | null;
  roster_snapshot_two?: { agent_ids?: string[]; w_engine_ids?: string[]; agent_levels?: Record<string, number>; w_engine_levels?: Record<string, number> } | null;
};
type Profile = { id: string; nickname: string; avatar_id: string; role: string };
type SavedRoster = { id: string; name: string; notes: string; agent_ids: string[]; w_engine_ids: string[]; agent_levels?: Record<string, number>; w_engine_levels?: Record<string, number> };
type GlobalRules = { min_agents: number; min_roster_cost: number; max_roster_cost: number; cost_difference_per_preban: number; turn_timer_seconds: number; reserve_time_seconds: number };
const defaultRules: GlobalRules = { min_agents: 5, min_roster_cost: 0, max_roster_cost: 999, cost_difference_per_preban: 3, turn_timer_seconds: 60, reserve_time_seconds: 30 };
const defaultSteps: Step[] = [
  {side:'I1',action:'ban',count:1},{side:'I2',action:'ban',count:1},{side:'I1',action:'pick',count:1},{side:'I2',action:'pick',count:1},
  {side:'I1',action:'pick',count:2},{side:'I2',action:'pick',count:2},{side:'I1',action:'pick',count:1},{side:'I2',action:'ban',count:1},
  {side:'I1',action:'ban',count:1},{side:'I2',action:'pick',count:2},{side:'I1',action:'pick',count:2},{side:'I2',action:'mirror',count:1},{side:'I1',action:'mirror',count:1},
];
const actionName = (a:string) => a==='ban'?'Бан':a==='mirror'?'Зеркальный пик':'Пик';
const makeCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export default function DraftRooms({ agents, engines, initialRoomId, judgeToken, onTournamentResult }: { agents: typeof initialAgents; engines: typeof initialWEngines; initialRoomId?: string | null; judgeToken?: string | null; onTournamentResult?: (matchId: string, winnerId: string) => void }) {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile|null>(null);
  const [roomNicknames, setRoomNicknames] = useState<Record<string,string>>({});
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [nickname, setNickname] = useState('');
  const [authMode, setAuthMode] = useState<'login'|'register'>('login');
  const [room, setRoomState] = useState<Room|null>(null); const roomRef = useRef<Room|null>(null);
  const setRoom = (next: Room|null) => {
    const current = roomRef.current;
    if (next && current?.id === next.id) {
      const currentRevision = Number(current.revision) || 0;
      const nextRevision = Number(next.revision) || 0;
      const currentTime = Date.parse(current.updated_at || "") || 0;
      const nextTime = Date.parse(next.updated_at || "") || 0;
      const isBo2GameReset = (Number(next.bo2_game_number) || 1) > (Number(current.bo2_game_number) || 1);
      if (!isBo2GameReset && (nextRevision < currentRevision || (nextRevision === currentRevision && (nextTime < currentTime || next.current_step < current.current_step || next.actions.length < current.actions.length)))) return;
      if (nextRevision === currentRevision && nextTime === currentTime && next.current_step === current.current_step && next.actions.length === current.actions.length && next.status === current.status) return;
    }
    roomRef.current = next;
    setRoomState(next);
  };
  const [connectedPlayers, setConnectedPlayers] = useState<string[]>([]);
  const [resumeRooms, setResumeRooms] = useState<Pick<Room, 'id'|'title'|'join_code'|'host_id'|'player_one_id'|'player_two_id'|'status'|'updated_at'|'tournament_id'|'tournament_match_id'|'bo2_parent_room_id'|'actions'>[]>([]);
  const [resumeRoomsError, setResumeRoomsError] = useState('');
  const [openingInitialRoom, setOpeningInitialRoom] = useState(false); const [initialRoomError, setInitialRoomError] = useState(""); const [dismissedInitialRoomId, setDismissedInitialRoomId] = useState<string|null>(null);
  const [roomTitle, setRoomTitle] = useState('Драфт ZZZ'); const [joinCode, setJoinCode] = useState('');
  const [activeJudgeToken, setActiveJudgeToken] = useState(judgeToken || ''); const [judgeLink, setJudgeLink] = useState('');
  const [judgeBusy, setJudgeBusy] = useState(false); const [clockNow, setClockNow] = useState(Date.now());
  const [globalRules, setGlobalRules] = useState<GlobalRules>(defaultRules); const [rulesLoaded, setRulesLoaded] = useState(false); const [rulesBusy, setRulesBusy] = useState(false); const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [roster, setRoster] = useState<string[]>([]); const [savedRosters, setSavedRosters] = useState<SavedRoster[]>([]); const [selectedRosterId, setSelectedRosterId] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [agentSearch, setAgentSearch] = useState(''); const [agentClass, setAgentClass] = useState('Все классы'); const [mirrorMode, setMirrorMode] = useState(false);
  const agentCost = (id: string, level?: number) => getAgentCost(agents.find(a => a.id === id), level);
  const rosterCost = (r?: SavedRoster) => { if (!r) return null; return (r.agent_ids || []).reduce((total, id) => { const agent = agents.find(a => a.id === id); const level = r.agent_levels?.[id] ?? (agent?.rank === 'A' ? 6 : 0); return total + agentCost(id, level); }, 0); };
  const flattenedSteps = useMemo(() => (room?.template_snapshot ?? defaultSteps).flatMap((s, idx) => Array.from({length:Math.max(1,Math.min(5,s.count||1))}, (_, sub) => ({...s, sourceIndex:idx, subIndex:sub}))), [room]);
  const activeAction = room ? flattenedSteps[room.current_step] : null;
  const timerReference = room?.is_paused && room.pause_started_at ? Date.parse(room.pause_started_at) : clockNow;
  const turnElapsed = room?.turn_started_at ? Math.max(0, Math.floor((timerReference - Date.parse(room.turn_started_at)) / 1000)) : 0;
  const turnBaseLeft = Math.max(0, (room?.turn_timer_seconds ?? 60) - turnElapsed);
  const turnReserveLeft = Math.max(0, (room?.reserve_time_seconds ?? 30) - Math.max(0, turnElapsed - (room?.turn_timer_seconds ?? 60)));
  const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const usedIds = new Set((room?.actions ?? []).map(a => a.agent_id));
  const activeSideUserId = activeAction?.side === 'I1' ? room?.player_one_id : room?.player_two_id;
  const isMyTurn = Boolean(profile && activeSideUserId === profile.id);
  const mySide = room && profile ? (room.player_one_id === profile.id ? 'I1' : room.player_two_id === profile.id ? 'I2' : null) : null;
  const playerOneName = room ? roomNicknames[room.player_one_id || ""] || (room.player_one_id === profile?.id ? profile.nickname : "Игрок 1") : "Игрок 1";
  const playerTwoName = room ? roomNicknames[room.player_two_id || ""] || (room.player_two_id === profile?.id ? profile.nickname : "Игрок 2") : "Игрок 2";

  const canDeleteOwnedRoom = (target: typeof resumeRooms[number]) => Boolean(profile && target.host_id === profile.id && !target.tournament_id && !target.tournament_match_id && !target.bo2_parent_room_id && ['waiting', 'ready', 'active'].includes(target.status));
  const deleteRoom = async (target: Room | typeof resumeRooms[number]) => {
    const isAdmin = profile?.role === 'admin';
    if (!supabase || !profile || (!isAdmin && !canDeleteOwnedRoom(target))) return;
    if (!window.confirm(`Удалить драфт «${target.title}» (${target.join_code})? Соперник потеряет доступ к комнате. Это действие нельзя отменить.`)) return;
    setBusy(true); setMessage('');
    try {
      let request = supabase.from('draft_rooms').delete().eq('id', target.id);
      if (!isAdmin) request = request.eq('host_id', profile.id).is('tournament_id', null).is('tournament_match_id', null).is('bo2_parent_room_id', null).in('status', ['waiting', 'ready', 'active']);
      const { error } = await request;
      if (error) throw error;
      if (room?.id === target.id) setRoom(null);
      setResumeRooms(current => current.filter(item => item.id !== target.id));
      setMessage('Драфт удалён.');
    } catch (e:any) {
      setMessage(e.message || 'Не удалось удалить драфт. Возможно, у тебя нет прав или это турнирная комната.');
    } finally { setBusy(false); }
  };
  const loadSavedRosters = useCallback(async (userId:string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from('player_rosters').select('id,name,notes,agent_ids,w_engine_ids,agent_levels,w_engine_levels').eq('player_id', userId).order('updated_at', { ascending: false });
    if (error) { setMessage('Не удалось загрузить личные ростеры: ' + error.message); return; }
    setSavedRosters((data ?? []) as SavedRoster[]);
  }, []);
  const loadGlobalRules = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('system_settings').select('settings').eq('id', 'global_rules').maybeSingle();
    if (!error && data?.settings) setGlobalRules({ ...defaultRules, ...(data.settings as Partial<GlobalRules>) });
    setRulesLoaded(true);
  }, []);
  const saveGlobalRules = async () => {
    const currentProfile = profile;
    if (!supabase || !currentProfile || !['admin', 'cost_manager'].includes(currentProfile.role || '')) return;
    setRulesBusy(true); setMessage('');
    try {
      const normalized: GlobalRules = {
        min_agents: Math.max(1, Math.min(100, Math.floor(Number(globalRules.min_agents) || 1))),
        min_roster_cost: Math.max(0, Math.floor(Number(globalRules.min_roster_cost) || 0)),
        max_roster_cost: Math.max(0, Math.floor(Number(globalRules.max_roster_cost) || 0)),
        cost_difference_per_preban: Math.max(1, Math.floor(Number(globalRules.cost_difference_per_preban) || 1)),
        turn_timer_seconds: Math.max(10, Math.min(600, Math.floor(Number(globalRules.turn_timer_seconds) || defaultRules.turn_timer_seconds))),
        reserve_time_seconds: Math.max(0, Math.min(300, Math.floor(Number(globalRules.reserve_time_seconds) || 0))),
      };
      if (normalized.max_roster_cost < normalized.min_roster_cost) throw new Error('Максимальный кост не может быть меньше минимального.');
      const { error } = await supabase.from('system_settings').upsert({ id: 'global_rules', settings: normalized, updated_by: currentProfile.id, updated_at: new Date().toISOString() });
      if (error) throw error;
      setGlobalRules(normalized); setMessage('Глобальные правила сохранены. Они будут использоваться в новых комнатах.');
    } catch (e: any) { setMessage(e.message || 'Не удалось сохранить глобальные правила.'); }
    finally { setRulesBusy(false); }
  };
  const loadProfile = useCallback(async (userId:string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from('profiles').select('id,nickname,avatar_id,role').eq('id',userId).maybeSingle();
    if (error) { setMessage(error.message); return; }
    if (data) setProfile(data as Profile);
  }, []);
  const refreshRoom = useCallback(async (roomId:string, force = false) => {
    if (!supabase) return false;
    const {data,error} = await supabase.from('draft_rooms').select('*').eq('id',roomId).single();
    if (error) { setMessage(error.message); return false; }
    const loaded = data as Room;
    if (force && roomRef.current?.id === roomId) { roomRef.current = null; setRoomState(null); }
    setRoom(loaded);
    if (profile) setRoster(loaded.player_one_id === profile.id ? (loaded.roster_one ?? []) : loaded.player_two_id === profile.id ? (loaded.roster_two ?? []) : []);
    return true;
  }, [profile]);

  const loadResumeRooms = useCallback(async () => {
    if (!supabase || !profile?.id) { setResumeRooms([]); return; }
    const select = 'id,title,join_code,host_id,player_one_id,player_two_id,status,updated_at,tournament_id,tournament_match_id,bo2_parent_room_id,actions';
    const [owned, active] = await Promise.all([
      supabase.from('draft_rooms').select(select).eq('host_id', profile.id).in('status', ['waiting','ready','active']).order('updated_at', { ascending: false }).limit(20),
      supabase.from('draft_rooms').select(select).or(`player_one_id.eq.${profile.id},player_two_id.eq.${profile.id}`).eq('status', 'active').order('updated_at', { ascending: false }).limit(20),
    ]);
    const error = owned.error || active.error;
    if (error) { setResumeRoomsError(error.message); return; }
    const rooms = new Map<string, typeof resumeRooms[number]>();
    for (const item of [...(owned.data || []), ...(active.data || [])] as typeof resumeRooms) rooms.set(item.id, item);
    setResumeRooms([...rooms.values()].sort((a,b) => Date.parse(b.updated_at || '') - Date.parse(a.updated_at || '')).slice(0,20));
    setResumeRoomsError('');
  }, [profile?.id]);

  const refreshJudgeRoom = useCallback(async (token: string) => {
    if (!supabase || !token) return false;
    const { data, error } = await supabase.rpc('read_draft_room_as_judge', { p_token: token });
    if (error || !data) { setInitialRoomError(error?.message || 'Ссылка судьи недействительна или отозвана.'); return false; }
    setRoom(data as Room);
    return true;
  }, []);

  useEffect(() => { const tick = window.setInterval(() => setClockNow(Date.now()), 250); return () => window.clearInterval(tick); }, []);
  useEffect(() => {
    if (room || !profile?.id || judgeToken) return;
    void loadResumeRooms();
    const timer = window.setInterval(() => { void loadResumeRooms(); }, 5000);
    return () => window.clearInterval(timer);
  }, [room?.id, profile?.id, judgeToken, loadResumeRooms]);
  useEffect(() => {
    if (!judgeToken || !session?.user.id) return;
    setActiveJudgeToken(judgeToken); setOpeningInitialRoom(true); setInitialRoomError('');
    void refreshJudgeRoom(judgeToken).then(ok => { setOpeningInitialRoom(false); if (!ok) setInitialRoomError('Ссылка судьи недействительна или отозвана.'); });
  }, [judgeToken, session?.user.id, refreshJudgeRoom]);
  useEffect(() => {
    if (!activeJudgeToken || !room?.id || !supabase) return;
    const poll = window.setInterval(() => { void refreshJudgeRoom(activeJudgeToken); }, 1800);
    return () => window.clearInterval(poll);
  }, [activeJudgeToken, room?.id, refreshJudgeRoom]);

  useEffect(() => { if (!initialRoomId || judgeToken) { if (!judgeToken) { setOpeningInitialRoom(false); setInitialRoomError(""); } return; } setDismissedInitialRoomId(null); setOpeningInitialRoom(true); setInitialRoomError(""); void refreshRoom(initialRoomId).then(ok => { setOpeningInitialRoom(false); if (!ok) setInitialRoomError("Проверь, что комната существует и ты участник этого матча."); }); }, [initialRoomId, judgeToken, refreshRoom]);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(async ({data}) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session?.user) { await loadProfile(data.session.user.id); await loadSavedRosters(data.session.user.id); await loadGlobalRules(); }
    });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) { window.setTimeout(() => { void loadProfile(nextSession.user.id); void loadSavedRosters(nextSession.user.id); void loadGlobalRules(); },0); }
      else { setProfile(null); setRoom(null); setRulesLoaded(false); setGlobalRules(defaultRules); }
    });
    return () => { alive=false; subscription.unsubscribe(); };
  }, [loadProfile,loadSavedRosters,loadGlobalRules]);

  useEffect(() => {
    if (!supabase || !room) { setRoomNicknames({}); return; }
    const ids = [...new Set([room.player_one_id, room.player_two_id].filter((id): id is string => Boolean(id)))];
    if (!ids.length) { setRoomNicknames({}); return; }
    let cancelled = false;
    void supabase.from("profiles").select("id,nickname").in("id", ids).then(({data,error}) => {
      if (cancelled) return;
      if (error) { setMessage(`Не удалось загрузить ники игроков: ${error.message}`); return; }
      setRoomNicknames(Object.fromEntries((data || []).map((p:any) => [p.id, p.nickname || "Игрок"])));
    });
    return () => { cancelled = true; };
  }, [room?.player_one_id, room?.player_two_id, room?.id]);

  useEffect(() => {
    if (!supabase || !session?.user.id) return;
    const channel = supabase.channel('global-draft-rules')
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'system_settings', filter:'id=eq.global_rules' }, payload => {
        if (payload.new && (payload.new as any).settings) setGlobalRules({ ...defaultRules, ...(payload.new as any).settings });
      }).subscribe();
    return () => { void supabase!.removeChannel(channel); };
  }, [session?.user.id]);

  useEffect(() => {
    if (!supabase || !room?.id) return;
    const channel = supabase.channel(`draft-room-${room.id}`).on('postgres_changes', {event:'*',schema:'public',table:'draft_rooms',filter:`id=eq.${room.id}`}, payload => {
      if (payload.new && (payload.new as Room).id) setRoom(payload.new as Room);
    }).subscribe();
    return () => { void supabase!.removeChannel(channel); };
  }, [room?.id]);

  useEffect(() => {
    if (!supabase || !room?.tournament_match_id || !profile || !mySide) { setConnectedPlayers([]); return; }
    const channel = supabase.channel(`tournament-presence-${room.id}`, { config: { presence: { key: profile.id } } });
    const readPresence = () => {
      const state = channel.presenceState() as Record<string, Array<{ user_id?: string }>>;
      setConnectedPlayers([...new Set(Object.values(state).flatMap(metas => metas.map(meta => meta.user_id).filter((id): id is string => Boolean(id))))]);
    };
    channel.on('presence', { event: 'sync' }, readPresence)
      .on('presence', { event: 'join' }, readPresence)
      .on('presence', { event: 'leave' }, readPresence)
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: profile.id, online_at: new Date().toISOString() });
          readPresence();
        }
      });
    return () => { void supabase!.removeChannel(channel); };
  }, [room?.id, room?.tournament_match_id, profile?.id, mySide]);

  async function authenticate() {
    if (!supabase) return;
    setBusy(true); setMessage('');
    try {
      if (authMode === 'register') {
        if (nickname.trim().length < 3) throw new Error('Никнейм должен содержать минимум 3 символа.');
        const {data,error} = await supabase.auth.signUp({email:email.trim(),password,options:{data:{nickname:nickname.trim()}}});
        if (error) throw error;
        if (data.user && data.session) {
          await supabase.from('profiles').upsert({id:data.user.id,nickname:nickname.trim(),avatar_id:'anby',role:'player'});
          setMessage('Аккаунт создан. Если включено подтверждение почты, проверь почту и затем войди.');
        } else setMessage('Проверь почту для подтверждения аккаунта, затем войди.');
      } else {
        const {error} = await supabase.auth.signInWithPassword({email:email.trim(),password});
        if (error) throw error;
      }
    } catch(e:any) { setMessage(e.message || 'Не удалось выполнить вход.'); }
    finally { setBusy(false); }
  }
  async function signOut() { if (supabase) await supabase.auth.signOut(); }
  async function createRoom() {
    if (!supabase || !profile) return;
    setBusy(true); setMessage('');
    try {
      const code = makeCode();
      const { data: globalTemplateRow, error: templateError } = await supabase.from('global_draft_template').select('template').eq('id', 1).maybeSingle();
      if (templateError) throw new Error('Не удалось загрузить глобальный шаблон: ' + templateError.message + '. Примени SQL-файл global_draft_template.sql.');
      const configuredSteps = Array.isArray(globalTemplateRow?.template?.steps) && globalTemplateRow.template.steps.length ? globalTemplateRow.template.steps : defaultSteps;
      const templateSnapshot = configuredSteps.map((step: any) => ({ side: step.side, action: step.action, count: Math.max(1, Math.min(5, Number(step.count) || 1)), label: step.label || '' }));
      const {data,error} = await supabase.from('draft_rooms').insert({join_code:code,title:roomTitle.trim()||'Драфт ZZZ',host_id:profile.id,player_one_id:profile.id,min_agents:globalRules.min_agents,template_snapshot:templateSnapshot,status:'waiting',roster_one:[],roster_two:[],actions:[],current_step:0}).select('*').single();
      if (error) throw error;
      setRoom(data as Room); setRoster([]); setMessage(`Комната создана. Код приглашения: ${code}`);
    } catch(e:any) { setMessage(e.message || 'Не удалось создать комнату. Проверь SQL-миграцию.'); }
    finally { setBusy(false); }
  }
  async function joinRoom() {
    if (!supabase || !profile) return;
    setBusy(true); setMessage('');
    try {
      const {data,error} = await supabase.rpc('join_draft_room',{p_join_code:joinCode.trim().toUpperCase()});
      if (error) throw error;
      const joined = (Array.isArray(data) ? data[0] : data) as Room;
      if (joined?.id) { await refreshRoom(joined.id); setRoster([]); setMessage('Ты присоединился к комнате.'); }
      else throw new Error('Комната не найдена или в ней уже есть два игрока.');
    } catch(e:any) { setMessage(e.message || 'Не удалось присоединиться к комнате.'); }
    finally { setBusy(false); }
  }
  async function saveRoster() {
    if (!supabase || !room || !profile || !mySide || !selectedRosterId) return;
    setBusy(true); setMessage('');
    try {
      const { data, error } = await supabase.rpc('select_saved_roster_for_draft', { p_room_id: room.id, p_roster_id: selectedRosterId });
      if (error) throw error;
      const updated = (Array.isArray(data) ? data[0] : data) as Room | null;
      if (updated?.id) setRoom(updated); else await refreshRoom(room.id);
      setMessage('Ростер выбран для матча. Состав сохранён в комнате.');
    } catch (e:any) { setMessage(e.message || 'Не удалось выбрать ростер. Проверь, применена ли миграция online_saved_rosters.sql.'); }
    finally { setBusy(false); }
  }
  async function startDraft() {
    if (!supabase || !room || !profile || room.host_id !== profile.id) return;
    const {error} = await supabase.rpc('start_draft_room',{p_room_id:room.id});
    if (error) setMessage(error.message); else { await refreshRoom(room.id); setMessage('Драфт начался!'); }
  }
  async function readyForTournamentDraft() {
    if (!supabase || !room?.tournament_match_id || !profile || !mySide || busy) return;
    setBusy(true); setMessage('');
    try {
      const { data, error } = await supabase.rpc('set_tournament_player_ready', { p_room_id: room.id });
      if (error) throw error;
      const updated = (Array.isArray(data) ? data[0] : data) as Room | null;
      if (updated?.id) setRoom(updated); else await refreshRoom(room.id);
      setMessage(updated?.status === 'active' ? 'Оба игрока готовы. Турнирный драфт начался!' : 'Готовность отмечена. Ожидаем подтверждение соперника.');
    } catch (e:any) { setMessage(e.message || 'Не удалось подтвердить готовность. Примени миграцию tournament_ready_checkin.sql.'); }
    finally { setBusy(false); }
  }
  async function makeMove(agentId:string, actionOverride?: 'pick'|'mirror') {
    const judgeMode = Boolean(activeJudgeToken);
    if (!supabase || !room || !profile || !activeAction || (!isMyTurn && !judgeMode) || room.status!=='active' || room.is_paused) return;
    setBusy(true); setMessage('');
    try {
      const {error} = judgeMode
        ? await supabase.rpc('submit_draft_action_as_judge',{p_token:activeJudgeToken,p_expected_step:room.current_step,p_action:actionOverride ?? activeAction.action,p_side:activeAction.side,p_agent_id:agentId})
        : await supabase.rpc('submit_draft_action',{p_room_id:room.id,p_expected_step:room.current_step,p_action:actionOverride ?? activeAction.action,p_side:activeAction.side,p_agent_id:agentId});
      if (error) throw error;
      if (judgeMode) await refreshJudgeRoom(activeJudgeToken); else await refreshRoom(room.id);
    } catch(e:any) { setMessage(e.message || 'Не удалось сохранить ход.'); await refreshRoom(room.id); }
    finally { setBusy(false); setMirrorMode(false); }
  }
  async function createJudgeLink() {
    if (!supabase || !room) return;
    setJudgeBusy(true); setMessage('');
    try {
      const { data, error } = await supabase.rpc('create_draft_judge_link', { p_room_id: room.id });
      if (error) throw error;
      const token = String(data || ''); if (!token) throw new Error('Ссылка не была создана.');
      const url = new URL(window.location.href); url.search = ''; url.searchParams.set('judge', token);
      const href = url.toString(); setJudgeLink(href);
      await navigator.clipboard.writeText(href); setMessage('Ссылка судьи скопирована. Для управления судье понадобится войти в аккаунт сайта.');
    } catch (e:any) { setMessage(e.message || 'Не удалось создать ссылку судьи. Примени миграцию judge_tools_and_turn_timers.sql.'); }
    finally { setJudgeBusy(false); }
  }
  async function judgeAction(action: 'undo'|'pause'|'resume'|'bo2_game2'|'swap_sides') {
    if (!supabase || !activeJudgeToken) return;
    const labels = { undo: 'Откатить последний ход?', pause: 'Поставить драфт на паузу?', resume: 'Продолжить драфт?', bo2_game2: 'Сразу начать второй драфт BO2?', swap_sides: 'Поменять игроков сторонами? Порядок уже сделанных ходов сохранится за теми же игроками.' };
    if (!window.confirm(labels[action])) return;
    setJudgeBusy(true); setMessage('');
    try {
      const { data, error } = action === 'swap_sides'
        ? await supabase.rpc('swap_draft_sides_as_judge', { p_token: activeJudgeToken })
        : await supabase.rpc('control_draft_room_as_judge', { p_token: activeJudgeToken, p_action: action });
      if (error) throw error;
      const updated = Array.isArray(data) ? data[0] : data;
      if (updated?.id) setRoom(updated as Room);
      await refreshJudgeRoom(activeJudgeToken);
      setMessage(action === 'undo' ? 'Последний ход отменён.' : action === 'pause' ? 'Драфт поставлен на паузу.' : action === 'resume' ? 'Драфт продолжен.' : action === 'swap_sides' ? 'Игроки поменялись сторонами.' : 'Второй драфт BO2 начат.');
    } catch (e:any) { setMessage(e.message || 'Не удалось выполнить действие судьи.'); }
    finally { setJudgeBusy(false); }
  }
  async function copyCode(code:string) { try { await navigator.clipboard.writeText(code); setMessage(`Код ${code} скопирован.`); } catch { setMessage(`Код комнаты: ${code}`); } }

  if (!isSupabaseConfigured || !supabase) return <section className="content"><div className="panel online-intro"><span className="eyebrow">ONLINE DRAFT</span><h2>Онлайн-комнаты драфта</h2><p>Синхронизация между устройствами требует Supabase. Создай проект и заполни переменные окружения — тогда вход, комнаты и ходы будут храниться на сервере.</p><div className="notice-box"><UserRound size={18}/><div><b>Нужно настроить подключение</b><p>В файле <code>.env.local</code> укажи <code>VITE_SUPABASE_URL</code> и <code>VITE_SUPABASE_ANON_KEY</code>, затем перезапусти <code>npm run dev</code>. Примени SQL-файлы из папки <code>supabase</code>.</p></div></div></div></section>;

  if (!session || !profile) return <section className="content"><div className="panel online-intro"><span className="eyebrow">ONLINE DRAFT</span><h2>{session ? 'Загружаем профиль…' : 'Нужен вход в аккаунт'}</h2><p className="muted-text">Авторизация общая для всего приложения. Используй окно входа в верхнем уровне приложения — отдельной формы входа в онлайн-драфте больше нет.</p>{session && <p className="muted-text">Если загрузка не заканчивается, проверь, что для аккаунта существует запись в таблице <code>public.profiles</code>.</p>}</div></section>;

  return <section className="content"><div className="section-heading"><div><span className="eyebrow">REALTIME · SUPABASE</span><h2>Онлайн-комнаты</h2><p className="muted-text">Аккаунт: {profile.nickname} · действия синхронизируются между игроками.</p></div><button className="btn btn-secondary" onClick={()=>void signOut()}><LogOut size={15}/> Выйти</button></div>
    {message&&<div className="notice-box online-notice"><CheckCircle2 size={17}/><p>{message}</p><button className="icon-btn" onClick={()=>setMessage('')}>×</button></div>}
    {initialRoomId && initialRoomId !== dismissedInitialRoomId && !room ? <div className="panel"><span className="eyebrow">TOURNAMENT MATCH ROOM</span><h3>{openingInitialRoom ? "Открываем комнату матча…" : "Не удалось открыть турнирную комнату"}</h3><p className="muted-text">{openingInitialRoom ? "Загружаем уже созданный драфт. Экран создания комнаты не будет показан." : initialRoomError || message || "Комната матча недоступна."}</p>{!openingInitialRoom && <button className="btn btn-secondary" onClick={() => { setDismissedInitialRoomId(initialRoomId); setInitialRoomError(""); }}>Назад к онлайн-драфтам</button>}</div> : !room ? <>{resumeRooms.length>0 && <div className="panel resume-drafts-panel"><div className="panel-heading"><div><span className="eyebrow">ТВОИ АКТИВНЫЕ МАТЧИ</span><h3>Вернуться в драфт</h3><p className="muted-text">Здесь отображаются созданные тобой комнаты и уже начавшиеся матчи с твоим участием.</p></div><button className="icon-btn" title="Обновить список" onClick={()=>void loadResumeRooms()}><RefreshCw size={16}/></button></div><div className="resume-drafts-list">{resumeRooms.map(activeRoom=><div className="resume-draft-row" key={activeRoom.id}><div><b>{activeRoom.title}</b><small>{activeRoom.host_id!==profile.id&&activeRoom.status==='active'?'Матч соперника · ':''}{activeRoom.tournament_match_id?'Турнирный матч':'Код комнаты: '+activeRoom.join_code} · {activeRoom.status==='active'?'Драфт идёт':activeRoom.status==='ready'?'Ожидает начала':'Ожидает второго игрока'}</small></div><div className="heading-actions">{canDeleteOwnedRoom(activeRoom)&&<button className="btn btn-danger-ghost" disabled={busy} title="Удалить созданный драфт" onClick={()=>void deleteRoom(activeRoom)}><Trash2 size={14}/> Удалить</button>}<button className="btn btn-primary" disabled={busy} onClick={async()=>{setBusy(true);await refreshRoom(activeRoom.id,true);setBusy(false);}}><ArrowRight size={15}/> Вернуться</button></div></div>)}</div>{resumeRoomsError&&<p className="muted-text">Список активных матчей временно недоступен: {resumeRoomsError}</p>}</div>}{!resumeRooms.length&&resumeRoomsError&&<div className="notice-box"><p>Не удалось загрузить список активных матчей: {resumeRoomsError}</p></div>}<div className="online-room-actions"><div className="panel"><span className="eyebrow">CREATE ROOM</span><h3>Создать комнату</h3><p className="muted-text">Ты станешь игроком 1. После создания отправь сопернику код комнаты.</p><label className="field-label">Название комнаты<input className="text-input" value={roomTitle} onChange={e=>setRoomTitle(e.target.value)} maxLength={80}/></label><div className="notice-box"><Users size={17}/><p>Глобальный минимум: <b>{globalRules.min_agents}</b> агентов. Правило устанавливает администратор или Cost Manager.</p></div><button className="btn btn-primary" disabled={busy} onClick={()=>void createRoom()}><Plus size={15}/> Создать комнату</button></div><div className="panel"><span className="eyebrow">JOIN ROOM</span><h3>Войти по коду</h3><p className="muted-text">Введи код, который отправил создатель комнаты.</p><label className="field-label">Код приглашения<input className="text-input code-input" value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase().slice(0,8))} placeholder="A1B2C3" maxLength={8}/></label><button className="btn btn-secondary" disabled={busy||joinCode.trim().length<4} onClick={()=>void joinRoom()}><LogIn size={15}/> Присоединиться</button></div></div></> : <>
      <div className="panel draft-room-panel"><div className="panel-heading"><div><span className="eyebrow">{room.tournament_match_id ? "TOURNAMENT MATCH" : "FRIENDLY ROOM"} · {room.join_code}</span><h2>{room.title}</h2><p className="muted-text">{room.tournament_match_id ? room.status==='active'?'Драфт в процессе':room.status==='completed'?'Драфт завершён':connectedPlayers.length<2?'Ожидание подключения обоих игроков':'Оба игрока подключены — подтвердите готовность' : room.status==='waiting'?'Ожидание второго игрока':room.status==='ready'?'Оба состава сохранены — можно начинать':room.status==='active'?'Драфт в процессе':'Драфт завершён'}</p></div><div className="heading-actions"><button className="btn btn-secondary" onClick={()=>void copyCode(room.join_code)}><Copy size={14}/> Код</button><button className="btn btn-secondary" onClick={()=>{setRoom(null);setMessage('');setDismissedInitialRoomId(initialRoomId||null);}}><ArrowLeft size={14}/> Назад к драфтам</button>{(profile.role==='admin'||canDeleteOwnedRoom(room))&&<button className="btn btn-danger" disabled={busy} onClick={()=>void deleteRoom(room)}><Trash2 size={14}/> Удалить драфт</button>}</div></div><div className="room-sides"><div className={`room-side ${mySide==='I1'?'my-side':''}`}><b>{playerOneName} {room.player_one_id===profile.id?'(ты)':''}</b><small>{room.tournament_match_id ? (room.player_one_id&&connectedPlayers.includes(room.player_one_id)?'Подключён':room.player_one_id?'Не подключён':'Ожидает') : room.player_one_id?'Подключён':'Ожидает'}{room.tournament_match_id&&room.player_one_ready?' · Готов':''}</small><div className="room-roster">{(room.roster_one??[]).map(id=><span key={id}>{agents.find(a=>a.id===id)?.name??id}</span>)}</div></div><div className={`room-side ${mySide==='I2'?'my-side':''}`}><b>{playerTwoName} {room.player_two_id===profile.id?'(ты)':''}</b><small>{room.tournament_match_id ? (room.player_two_id&&connectedPlayers.includes(room.player_two_id)?'Подключён':room.player_two_id?'Не подключён':'Ожидает') : room.player_two_id?'Подключён':'Ожидает'}{room.tournament_match_id&&room.player_two_ready?' · Готов':''}</small><div className="room-roster">{(room.roster_two??[]).map(id=><span key={id}>{agents.find(a=>a.id===id)?.name??id}</span>)}</div></div></div>

      <div className="draft-control-panel">{room.status==="active" && <div className={`turn-clock ${room.is_paused ? "paused" : turnElapsed >= (room.turn_timer_seconds ?? 60) ? "reserve" : ""}`}><Clock3 size={18}/><div><b>{room.is_paused ? "Пауза" : turnElapsed >= (room.turn_timer_seconds ?? 60) ? `Запас: ${formatClock(turnReserveLeft)}` : `Ход: ${formatClock(turnBaseLeft)}`}</b><small>На ход {formatClock(room.turn_timer_seconds ?? 60)} · запас {formatClock(room.reserve_time_seconds ?? 30)}{turnReserveLeft === 0 && turnElapsed >= (room.turn_timer_seconds ?? 60) ? " · время вышло" : ""}</small></div></div>}<div className="judge-actions">{(mySide || room.host_id === profile.id || profile.role === "admin") && <button className="btn btn-secondary" disabled={judgeBusy} onClick={()=>void createJudgeLink()}><Link2 size={15}/>{judgeLink ? "Создать новую ссылку судьи" : "Создать ссылку судьи"}</button>}{activeJudgeToken && <><button className="btn btn-ghost" disabled={judgeBusy || !room.actions.length} onClick={()=>void judgeAction("undo")}><Undo2 size={15}/> Откатить ход</button>{room.status === "active" && <button className="btn btn-ghost" disabled={judgeBusy} onClick={()=>void judgeAction(room.is_paused ? "resume" : "pause")}>{room.is_paused ? <Play size={15}/> : <Pause size={15}/>} {room.is_paused ? "Продолжить" : "Пауза"}</button>}{room.status === "active" && <button className="btn btn-ghost" disabled={judgeBusy} onClick={()=>void judgeAction("swap_sides")}><Users size={15}/> Поменять стороны игроков</button>}{room.status === "completed" && room.bo2_game_number !== 2 && <button className="btn btn-ghost" disabled={judgeBusy} onClick={()=>void judgeAction("bo2_game2")}><Gavel size={15}/> Начать второй драфт BO2</button>}</>}</div>{judgeLink && <p className="muted-text judge-link-copy">Ссылка создана и скопирована. Отправь её судье; он должен войти в аккаунт сайта.</p>}{activeJudgeToken && !judgeLink && <p className="muted-text">Открыт режим судьи. Комната обновляется автоматически.</p>}</div>{room.tournament_match_id&&(room.status==='waiting'||room.status==='ready')&&<div className="notice-box"><Swords size={17}/><p>Для турнирного матча используется ростер, выбранный при регистрации. Если состав не прикрепился, обратись к организатору турнира.</p></div>}
      {(room.status==='waiting'||room.status==='ready')&&!room.tournament_match_id&&!room.bo2_parent_room_id&&room.bo2_game_number!==2&&mySide&&<div className="roster-picker"><div><h3>Выбери сохранённый ростер</h3><p className="muted-text">Для этой комнаты нужно минимум {room.min_agents || globalRules.min_agents} агентов. Максимум не ограничен. Состав берётся из «Моих ростеров». После начала матча он останется неизменным, даже если ты отредактируешь личный ростер.</p></div>{savedRosters.length===0?<div className="notice-box"><Users size={17}/><p>У тебя пока нет сохранённых ростеров. Сначала создай состав в разделе «Мои ростеры», затем вернись сюда.</p></div>:<><label className="field-label">Личный ростер<select className="text-input" value={selectedRosterId} onChange={e=>setSelectedRosterId(e.target.value)}><option value="">Выбери ростер…</option>{savedRosters.map(r=><option key={r.id} value={r.id}>{r.name} · {(r.agent_ids||[]).length} агентов</option>)}</select></label>{selectedRosterId&&(()=>{const r=savedRosters.find(x=>x.id===selectedRosterId);const total=r?rosterCost(r):null;return r?<div className="saved-roster-preview"><b>{r.name}</b><div className="room-roster">{(r.agent_ids||[]).map(id=><span key={id}>{agents.find(a=>a.id===id)?.name??id}{r.agent_levels?.[id]!==undefined?` · М${r.agent_levels[id]}`:''}</span>)}</div>{(r.w_engine_ids||[]).length>0&&<div className="draft-engine-preview"><small>Доступные амплификаторы этого ростера:</small><div>{(r.w_engine_ids||[]).map(id=>{const w=engines.find(item=>item.id===id);return <span className="draft-engine-chip" key={id}>{w?.imageUrl&&<img src={w.imageUrl} data-fallback={w.imageFallbackUrl} alt="" loading="lazy" onError={e=>{const img=e.currentTarget;const fallback=img.dataset.fallback;if(fallback&&img.src!==fallback){img.dataset.fallback="";img.src=fallback;}else img.style.display='none';}}/>}{w?.name??id}</span>;})}</div></div>}<p className="muted-text">Стоимость агентов по выбранным M-уровням: {total===null?'не задана для одного или нескольких уровней':`${total} кост.`}</p></div>:null})()}{(savedRosters.find(x=>x.id===selectedRosterId)?.agent_ids.length ?? 0)<(room.min_agents||1)&&selectedRosterId&&<p className="error-text">В этом ростере меньше {room.min_agents||1} агентов. Выбери другой ростер.</p>}{selectedRosterId&&rosterCost(savedRosters.find(x=>x.id===selectedRosterId))===null&&<p className="error-text">Для одного или нескольких уровней M не задан кост. Заполни его в Cost Manager перед выбором ростера.</p>}{selectedRosterId&&rosterCost(savedRosters.find(x=>x.id===selectedRosterId))!==null&&((rosterCost(savedRosters.find(x=>x.id===selectedRosterId))??0)<globalRules.min_roster_cost||(rosterCost(savedRosters.find(x=>x.id===selectedRosterId))??0)>globalRules.max_roster_cost)&&<p className="error-text">Стоимость ростера должна быть от {globalRules.min_roster_cost} до {globalRules.max_roster_cost} костов.</p>}<button className="btn btn-primary" disabled={!selectedRosterId||busy||(savedRosters.find(x=>x.id===selectedRosterId)?.agent_ids.length ?? 0)<(room.min_agents||1)||rosterCost(savedRosters.find(x=>x.id===selectedRosterId))===null||(rosterCost(savedRosters.find(x=>x.id===selectedRosterId))??0)<globalRules.min_roster_cost||(rosterCost(savedRosters.find(x=>x.id===selectedRosterId))??0)>globalRules.max_roster_cost} onClick={()=>void saveRoster()}><CheckCircle2 size={15}/> Выбрать ростер для матча</button></>}</div>}
      {room.status==='ready'&&!room.tournament_match_id&&room.host_id===profile.id&&<div className="admin-action"><button className="btn btn-primary" onClick={()=>void startDraft()}><Swords size={15}/> Начать драфт</button></div>}
      {room.status==='completed'&&<MatchSeries room={room} profile={profile} judgeToken={activeJudgeToken} playerOneName={playerOneName} playerTwoName={playerTwoName} agents={agents} engines={engines} onTournamentResult={onTournamentResult} onOpenRoom={async(id:string)=>{if(activeJudgeToken) await refreshJudgeRoom(activeJudgeToken); else await refreshRoom(id);}}/>}
      {room.status==='active'&&(()=>{
        const rosterOne = room.roster_one ?? [];
        const rosterTwo = room.roster_two ?? [];
        const pickedOne = room.actions.filter(a=>a.side==='I1' && a.action==='pick');
        const pickedTwo = room.actions.filter(a=>a.side==='I2' && a.action==='pick');
        const mirrorOne = room.actions.filter(a=>a.side==='I1' && a.action==='mirror');
        const mirrorTwo = room.actions.filter(a=>a.side==='I2' && a.action==='mirror');
        const bansOne = room.actions.filter(a=>a.side==='I1' && a.action==='ban');
        const bansTwo = room.actions.filter(a=>a.side==='I2' && a.action==='ban');
        const ownRoster = activeAction?.side==='I1' ? rosterOne : rosterTwo;
        const opponentPicks = room.actions.filter(a=>a.action==='pick' && a.side!==activeAction?.side).map(a=>a.agent_id);
        const opponentRoster = activeAction?.side==='I1' ? rosterTwo : rosterOne;
        // Mirror pick: only an agent the opponent has picked AND that is in YOUR roster (and not mirrored by you yet).
        const eligibleMirrors = [...new Set(opponentPicks.filter(id=>ownRoster.includes(id) && !room.actions.some(a=>a.action==='mirror' && a.side===activeAction?.side && a.agent_id===id)))];
        const isMirrorStage = activeAction?.action==='mirror';
        const ownSnapshot = activeAction?.side==='I1' ? room.roster_snapshot_one : room.roster_snapshot_two;
        const opponentSnapshot = activeAction?.side==='I1' ? room.roster_snapshot_two : room.roster_snapshot_one;
        const effectiveAction = activeAction?.action==='ban' ? 'ban' : activeAction?.action==='mirror' && mirrorMode ? 'mirror' : 'pick';
        // The visible pool determines whose constellation level to show. Checking whether
        // the agent exists in a roster is ambiguous when both players own that agent.
        const displayedSnapshot = effectiveAction==='ban' ? opponentSnapshot : ownSnapshot;
        const draftAgentLevel = (id:string) => displayedSnapshot?.agent_levels?.[id] ?? (agents.find(a=>a.id===id)?.rank==='A'?6:0);
        // Draft pools (the server enforces the same rules in submit_draft_action):
        //  - ban: only the OPPONENT's roster;
        //  - pick: only your OWN roster;
        //  - mirror stage: your own roster; an agent the opponent has picked is a mirror pick only if it is in your roster.
        const pool = effectiveAction==='ban' ? opponentRoster : isMirrorStage ? [...new Set([...ownRoster,...eligibleMirrors])] : ownRoster;
        const available = agents.filter(a=>pool.includes(a.id) && ((isMirrorStage && eligibleMirrors.includes(a.id)) || !usedIds.has(a.id)) && (agentClass === 'Все классы' || (a.specialty || 'Не указана') === agentClass) && (a.name.toLocaleLowerCase('ru').includes(agentSearch.toLocaleLowerCase('ru')) || a.specialty?.toLocaleLowerCase('ru').includes(agentSearch.toLocaleLowerCase('ru')))).sort(compareBySpecialty);
        const renderSlot = (agentId:string, label:string, kind:string, index:number) => { const agent=agents.find(a=>a.id===agentId); return <div className={`draft-slot filled ${kind}`} key={`${kind}-${agentId}-${index}`} title={agent?.name ?? agentId}>{agent?.imageUrl && <img src={getAgentIconUrl(agent.id)} alt="" onError={e=>{const img=e.currentTarget;if(agent.imageFallbackUrl && img.src!==agent.imageFallbackUrl) img.src=agent.imageFallbackUrl; else img.style.display='none';}}/>}<span className="draft-slot-number">{index+1}</span><b>{agent?.name ?? agentId}</b><small>{label}</small></div>; };
        const renderEmpty = (label:string,index:number,kind:string) => <div className={`draft-slot empty ${kind}`} key={`${kind}-empty-${index}`}><span className="draft-slot-number">{index+1}</span><b>—</b><small>{label}</small></div>;
        const rosterSlots = (ids:string[], actions:typeof room.actions, kind:string, label:string) => { const used = actions.map(a=>a.agent_id); const shown = ids.filter(id=>used.includes(id)); const targetSide = actions===pickedOne ? 'I1' : actions===pickedTwo ? 'I2' : actions===bansOne ? 'I1' : 'I2'; const targetAction = kind==='pick-slot' ? 'pick' : kind==='mirror-slot' ? 'mirror' : 'ban'; const future = Math.max(0, room.template_snapshot.filter(s=>s.action===targetAction && s.side===targetSide).reduce((n,s)=>n+Math.max(1,Math.min(5,s.count||1)),0)-actions.length); return <div className="draft-slots">{shown.map((id,i)=>{const action=actions.find(a=>a.agent_id===id)!;return renderSlot(id,action.action==='ban'?'БАН':'ПИК',kind,i);})}{Array.from({length:future},(_,i)=>renderEmpty(label,shown.length+i,kind))}{shown.length===0&&future===0&&<div className="draft-empty-note">Пока нет действий</div>}</div>; };
        return <div className="draft-board">
          {activeJudgeToken && <div className="notice-box"><Gavel size={17}/><p><b>Режим судьи.</b> Вы выполняете текущий ход за {activeAction?.side==='I1'?playerOneName:playerTwoName}. Доступны действия от лица обеих сторон.</p></div>}
          <div className="draft-matchbar">
            <div className={`draft-player ${activeAction?.side==='I1'?'turn-active':''}`}><div className="draft-player-avatar">{profile.avatar_id?.slice(0,1).toUpperCase() || '1'}</div><div><b>{playerOneName}</b><small>{rosterOne.length} персонажей · {rosterOne.reduce((sum,id)=>sum+(agentCost(id, room.roster_snapshot_one?.agent_levels?.[id] ?? (agents.find(a=>a.id===id)?.rank==='A'?6:0))??0),0)} кост.</small></div></div>
            <div className="draft-turn-center"><span className="draft-live-dot"/><b>{activeAction ? (activeAction.action==='ban'?'БАН':activeAction.action==='mirror'?'СТАДИЯ ЗЕРКАЛЬНОГО ПИКА':'ПИК') : 'ЗАВЕРШЕНО'}</b><strong>{Math.min(room.current_step+1,flattenedSteps.length)}<small> / {flattenedSteps.length}</small></strong><small>{activeAction ? (isMyTurn?'ТВОЙ ХОД':`ХОД СОПЕРНИКА · ${activeAction.side==='I1'?playerOneName.toLocaleUpperCase('ru-RU'):playerTwoName.toLocaleUpperCase('ru-RU')}`) : 'Матч завершён'}</small></div>
            <div className={`draft-player right ${activeAction?.side==='I2'?'turn-active':''}`}><div><b>{playerTwoName}</b><small>{rosterTwo.length} персонажей · {rosterTwo.reduce((sum,id)=>sum+(agentCost(id, room.roster_snapshot_two?.agent_levels?.[id] ?? (agents.find(a=>a.id===id)?.rank==='A'?6:0))??0),0)} кост.</small></div><div className="draft-player-avatar opponent">2</div></div>
          </div>
          <div className="draft-shared-rosters" aria-label="Ростеры обоих игроков">
            {([{ side: 'I1' as const, name: playerOneName, ids: rosterOne, snapshot: room.roster_snapshot_one }, { side: 'I2' as const, name: playerTwoName, ids: rosterTwo, snapshot: room.roster_snapshot_two }]).map(player => <section className={`draft-shared-roster ${activeAction?.side===player.side?'is-active':''}`} key={player.side}>
              <h3>{player.name}<span>{player.ids.length} агентов</span></h3>
              <div>{[...player.ids].map(id=>agents.find(a=>a.id===id)).filter((a):a is (typeof agents)[number]=>Boolean(a)).sort(compareBySpecialty).map(agent=>{const level=player.snapshot?.agent_levels?.[agent.id] ?? (agent.rank==='A'?6:0);return <span className="draft-roster-agent" key={agent.id} title={`${agent.name} · ${agent.specialty??'Класс не указан'} · М${level}`}><img src={getAgentIconUrl(agent.id)} data-fallback={agent.imageFallbackUrl} alt="" onError={e=>{const img=e.currentTarget;if(agent.imageFallbackUrl&&img.src!==agent.imageFallbackUrl)img.src=agent.imageFallbackUrl;else img.style.display='none';}}/><b>{agent.name}</b><small>{agent.specialty??'Класс не указан'} · М{level}</small></span>;})}</div>
            </section>)}
          </div>
          <div className="draft-sides-board">
            <section className="draft-side-column"><div className="draft-zone-title ban-title"><Ban size={15}/> БАНЫ ИГРОКА 1 <span>{bansOne.length}</span></div>{rosterSlots(bansOne.map(a=>a.agent_id), bansOne, 'ban-slot','ожидает бана')}</section>
            <section className="draft-side-column"><div className="draft-zone-title ban-title"><Ban size={15}/> БАНЫ ИГРОКА 2 <span>{bansTwo.length}</span></div>{rosterSlots(bansTwo.map(a=>a.agent_id), bansTwo, 'ban-slot','ожидает бана')}</section>
          </div>
          <div className="draft-sides-board picks-board">
            <section className="draft-side-column"><div className="draft-zone-title pick-title"><Swords size={15}/> ПИКИ ИГРОКА 1 <span>{pickedOne.length}</span></div>{rosterSlots(pickedOne.map(a=>a.agent_id), pickedOne, 'pick-slot','ожидает пика')}</section>
            <section className="draft-side-column"><div className="draft-zone-title pick-title"><Swords size={15}/> ПИКИ ИГРОКА 2 <span>{pickedTwo.length}</span></div>{rosterSlots(pickedTwo.map(a=>a.agent_id), pickedTwo, 'pick-slot','ожидает пика')}</section>
          </div>
          <div className="draft-sides-board mirror-picks-board">
            <section className="draft-side-column"><div className="draft-zone-title mirror-title"><Swords size={15}/> ЗЕРКАЛЬНЫЕ ПИКИ ИГРОКА 1 <span>{mirrorOne.length}</span></div>{rosterSlots(mirrorOne.map(a=>a.agent_id), mirrorOne, 'mirror-slot','ожидает зеркального пика')}</section>
            <section className="draft-side-column"><div className="draft-zone-title mirror-title"><Swords size={15}/> ЗЕРКАЛЬНЫЕ ПИКИ ИГРОКА 2 <span>{mirrorTwo.length}</span></div>{rosterSlots(mirrorTwo.map(a=>a.agent_id), mirrorTwo, 'mirror-slot','ожидает зеркального пика')}</section>
          </div>
          <div className="draft-chooser"><div className="draft-chooser-heading"><div><span className="eyebrow">ПУЛ ПЕРСОНАЖЕЙ</span><h3>{activeAction ? (activeAction.action==='ban'?'Выбери персонажа для бана':effectiveAction==='mirror'?'Выбери персонажа для зеркального пика':'Выбери персонажа для пика') : 'Драфт завершён'}</h3><p>{isMyTurn?(activeAction?.action==='ban'?'Выбери персонажа из ростера соперника для бана.':isMirrorStage?'На стадии зеркального пика выбери агента из своего ростера или переключись на зеркальные пики соперника.':'Для пика доступны только персонажи из твоего ростера. Персонажей соперника можно банить.'):activeAction?'Ожидаем действие второго игрока.':'Все действия выполнены.'}</p></div><div className="draft-search-controls"><label className="draft-search"><span>⌕</span><input value={agentSearch} onChange={e=>setAgentSearch(e.target.value)} placeholder="Поиск персонажа…" aria-label="Поиск персонажа"/></label><select className="select" value={agentClass} onChange={e=>setAgentClass(e.target.value)} aria-label="Фильтр по классу персонажа"><option>Все классы</option>{specialtyOrder.map(s=><option key={s}>{s}</option>)}</select></div></div>
            <div className="draft-agent-gallery">{available.map(a=><button className="draft-agent-card" key={a.id} disabled={(!isMyTurn&&!activeJudgeToken)||busy||!activeAction||room.is_paused} onClick={()=>void makeMove(a.id, isMirrorStage ? (eligibleMirrors.includes(a.id) ? 'mirror' : 'pick') : activeAction?.action==='pick' ? 'pick' : undefined)} title={`${a.name} · ${a.specialty??'Специальность не указана'}`}><div className="draft-agent-art">{a.imageUrl?<img src={getAgentIconUrl(a.id)} data-fallback={a.imageFallbackUrl} alt="" onError={e=>{const img=e.currentTarget;if(a.imageFallbackUrl && img.src!==a.imageFallbackUrl) img.src=a.imageFallbackUrl; else img.style.display='none';}}/>:<span>{a.avatar}</span>}<span className={`draft-rank ${a.rank==='S'?'rank-s':'rank-a'}`}>{a.rank}</span><span className="draft-cost">М{draftAgentLevel(a.id)}</span></div><div className="draft-agent-meta"><b>{a.name}</b><small>{isMirrorStage&&eligibleMirrors.includes(a.id)?'Зеркальный пик · ':''}{a.specialty??'Агент'} · М{draftAgentLevel(a.id)}</small></div></button>)}{available.length===0&&<p className="muted-text">Нет доступных персонажей для этого действия.</p>}</div>
          </div>
          <details className="draft-history-modern"><summary>История ходов <span>{room.actions.length}</span></summary><div>{room.actions.map((a,i)=><div className="draft-history-row" key={`${a.step_index}-${a.agent_id}-${i}`}><span>{i+1}</span><b>{a.side==='I1'?playerOneName:playerTwoName}</b><span>{actionName(a.action)}</span><strong>{agents.find(x=>x.id===a.agent_id)?.name??a.agent_id}</strong></div>)}</div></details>
        </div>;
      })()}
      <p className="muted-text room-footnote">Шаблон последовательности сейчас временный встроенный пример. Следующим этапом подключим к комнатам шаблоны из админ-редактора.</p></div></>}
  </section>;
}
