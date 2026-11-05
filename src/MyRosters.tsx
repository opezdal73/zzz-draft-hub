import { useEffect, useMemo, useState } from 'react';
import { Copy, Plus, Save, Trash2, Users, RefreshCw, Search, X, Settings2, Coins } from 'lucide-react';
import { supabase, isSupabaseConfigured } from './supabase';
import { getAgentIconUrl } from './data';
import type { Agent, WEngine } from './types';
import { compareBySpecialty, specialtyOrder } from './catalogUtils';
import { getAgentCost as resolveAgentCost } from './costUtils';
import { defaultEngineAwakening, engineCopyLevelKey, getEngineCopyAwakening, serializeEngineCopyLevels } from './engineCopies';

type Roster = {
  id: string;
  player_id: string;
  name: string;
  notes: string;
  agent_ids: string[];
  w_engine_ids: string[];
  agent_levels?: Record<string, number>;
  w_engine_levels?: Record<string, number>;
  created_at?: string;
  updated_at?: string;
};

export default function MyRosters({ agents, engines }: { agents: Agent[]; engines: WEngine[] }) {
  const [userId, setUserId] = useState('');
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [rosterName, setRosterName] = useState('Основной');
  const [notes, setNotes] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [engineIds, setEngineIds] = useState<string[]>([]);
  const [agentLevels, setAgentLevels] = useState<Record<string, number>>({});
  const [engineLevels, setEngineLevels] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [agentQuery, setAgentQuery] = useState('');
  const [agentSpecialty, setAgentSpecialty] = useState('Все классы');
  const [engineQuery, setEngineQuery] = useState('');
  const [engineSpecialty, setEngineSpecialty] = useState('Все классы');
  const [builderTab, setBuilderTab] = useState<'agents' | 'engines'>('agents');
  const [accountAgentIds, setAccountAgentIds] = useState<string[]>([]);
  const [accountEngineIds, setAccountEngineIds] = useState<string[]>([]);
  const [accountEngineLevels, setAccountEngineLevels] = useState<Record<string, number>>({});
  const [accountAgentLevels, setAccountAgentLevels] = useState<Record<string, number>>({});
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventoryTab, setInventoryTab] = useState<'agents' | 'engines'>('agents');
  const [inventoryAgentQuery, setInventoryAgentQuery] = useState('');
  const [inventoryAgentClass, setInventoryAgentClass] = useState('Все классы');
  const [inventoryEngineQuery, setInventoryEngineQuery] = useState('');
  const [inventoryEngineClass, setInventoryEngineClass] = useState('Все классы');

  function getAgentCost(id: string, level: number) {
    return resolveAgentCost(agents.find(item => item.id === id), level);
  }

  function getRosterCost(ids: string[], levels?: Record<string, number>) {
    return ids.reduce((total, id) => {
      const agent = agents.find(item => item.id === id);
      const level = accountAgentLevels[id] ?? levels?.[id] ?? (agent?.rank === 'A' ? 6 : 0);
      return total + getAgentCost(id, level);
    }, 0);
  }

  const copiesOf = (ids: string[], id: string) => ids.filter(value => value === id).length;
  const defaultEngineLevel = defaultEngineAwakening;
  const copyNumberAt = (ids: string[], index: number) => ids.slice(0, index + 1).filter(id => id === ids[index]).length;
  const copyLevel = (ids: string[], levels: Record<string, number> | undefined, index: number, catalog: WEngine[]) => {
    const id = ids[index];
    const number = copyNumberAt(ids, index);
    return getEngineCopyAwakening(levels, id, number, catalog.find(w => w.id === id));
  };
  const removeOneCopy = (ids: string[], id: string) => {
    const index = ids.lastIndexOf(id);
    return index < 0 ? ids : ids.filter((_, i) => i !== index);
  };
  const limitEngineCopies = (selected: string[], owned: string[]) => {
    const used = new Map<string, number>();
    const limits = new Map<string, number>();
    for (const id of owned) limits.set(id, (limits.get(id) || 0) + 1);
    return selected.filter(id => {
      const nextCount = (used.get(id) || 0) + 1;
      used.set(id, nextCount);
      return nextCount <= (limits.get(id) || 0);
    });
  };

  async function load() {
    if (!supabase) return;
    setBusy(true);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      setMessage('Сначала войди в онлайн-аккаунт на странице «Онлайн-драфт».');
      setBusy(false);
      return;
    }
    setUserId(user.id);
    const { data: inventory, error: inventoryError } = await supabase.from('player_account_inventory').select('*').eq('player_id', user.id).maybeSingle();
    if (inventoryError) {
      setMessage('Не удалось загрузить ростер аккаунта. Проверь миграцию player_account_inventory.sql: ' + inventoryError.message);
    } else if (inventory) {
      const loadedAgentIds = (inventory.agent_ids || []) as string[];
      const loadedEngineIds = (inventory.w_engine_ids || []) as string[];
      setAccountAgentIds(loadedAgentIds);
      setAccountEngineIds(loadedEngineIds);
      const storedLevels = (inventory.agent_levels || {}) as Record<string, number>;
      const storedEngineLevels = (inventory.w_engine_levels || {}) as Record<string, number>;
      setAccountAgentLevels(Object.fromEntries(loadedAgentIds.map(id => [id, Number.isFinite(Number(storedLevels[id])) ? Number(storedLevels[id]) : (agents.find(a => a.id === id)?.rank === 'A' ? 6 : 0)])));
      setAccountEngineLevels(serializeEngineCopyLevels(loadedEngineIds, storedEngineLevels, id => engines.find(w => w.id === id)));
    } else {
      setAccountAgentIds([]); setAccountEngineIds([]); setAccountAgentLevels({}); setAccountEngineLevels({});
    }
    const { data, error } = await supabase.from('player_rosters').select('*').eq('player_id', user.id).order('updated_at', { ascending: false });
    if (error) setMessage('Не удалось загрузить ростеры. Проверь, что применена миграция player_rosters_migration.sql. Подробности: ' + error.message);
    else setRosters((data || []) as Roster[]);
    setBusy(false);
  }

  useEffect(() => { void load(); }, []);

  const visibleRosters = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return rosters.filter(r => !term || r.name.toLocaleLowerCase().includes(term) || (r.notes || '').toLocaleLowerCase().includes(term));
  }, [rosters, query]);

  function clearForm() {
    setEditingId(''); setRosterName('Основной'); setNotes(''); setAgentIds([]); setEngineIds([]); setAgentLevels({}); setEngineLevels({}); setAgentQuery(''); setEngineQuery(''); setAgentSpecialty('Все классы'); setEngineSpecialty('Все классы'); setBuilderTab('agents');
  }

  function startEdit(r: Roster) {
    setEditingId(r.id); setRosterName(r.name); setNotes(r.notes || ''); setAgentIds(r.agent_ids || []); setEngineIds(r.w_engine_ids || []); setAgentLevels(r.agent_levels || {}); setEngineLevels(r.w_engine_levels || {});
    setBuilderTab('agents');
    document.getElementById('roster-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function startCopy(r: Roster) {
    setEditingId(''); setRosterName(`${r.name} — копия`); setNotes(r.notes || ''); setAgentIds(r.agent_ids || []); setEngineIds(r.w_engine_ids || []); setAgentLevels(r.agent_levels || {}); setEngineLevels(r.w_engine_levels || {});
    setBuilderTab('agents');
    document.getElementById('roster-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveInventory() {
    if (!supabase || !userId) { setMessage('Сначала войди в онлайн-аккаунт.'); return; }
    setBusy(true); setMessage('');
    const { error } = await supabase.from('player_account_inventory').upsert({ player_id: userId, agent_ids: accountAgentIds, w_engine_ids: accountEngineIds, agent_levels: Object.fromEntries(accountAgentIds.map(id => [id, accountAgentLevels[id] ?? (agents.find(a => a.id === id)?.rank === 'A' ? 6 : 0)])), w_engine_levels: serializeEngineCopyLevels(accountEngineIds, accountEngineLevels, id => engines.find(w => w.id === id)), updated_at: new Date().toISOString() }, { onConflict: 'player_id' });
    if (error) setMessage('Не удалось сохранить ростер аккаунта. Примени supabase/player_account_inventory_weapon_copies.sql в SQL Editor Supabase. ' + error.message);
    else { setMessage('Ростер аккаунта сохранён в облаке.'); setInventoryOpen(false); const remainingEngines = limitEngineCopies(engineIds, accountEngineIds); setAgentIds(ids => ids.filter(id => accountAgentIds.includes(id))); setEngineIds(remainingEngines); setEngineLevels(serializeEngineCopyLevels(remainingEngines, accountEngineLevels, id => engines.find(w => w.id === id))); setAgentLevels(Object.fromEntries(accountAgentIds.map(id => [id, accountAgentLevels[id] ?? (agents.find(a => a.id === id)?.rank === 'A' ? 6 : 0)]))); await load(); }
    setBusy(false);
  }

  async function saveRoster() {
    if (!supabase || !userId) { setMessage('Сначала войди в онлайн-аккаунт.'); return; }
    if (rosterName.trim().length < 1) { setMessage('Введи название ростера.'); return; }
    if (agentIds.length === 0) { setMessage('Добавь в ростер хотя бы одного агента.'); return; }
    setBusy(true); setMessage('');
    const payload = { player_id: userId, name: rosterName.trim(), notes: notes.trim(), agent_ids: agentIds, w_engine_ids: engineIds, agent_levels: Object.fromEntries(agentIds.map(id => [id, accountAgentLevels[id] ?? agentLevels[id] ?? (agents.find(a => a.id === id)?.rank === 'A' ? 6 : 0)])), w_engine_levels: serializeEngineCopyLevels(engineIds, engineLevels, id => engines.find(w => w.id === id)) };
    const request = editingId
      ? supabase.from('player_rosters').update(payload).eq('id', editingId).eq('player_id', userId)
      : supabase.from('player_rosters').insert(payload);
    const { error } = await request;
    if (error) setMessage(error.code === '23505' ? 'У тебя уже есть ростер с таким названием. Выбери другое.' : 'Не удалось сохранить ростер: ' + error.message);
    else { setMessage(editingId ? 'Изменения сохранены.' : 'Ростер сохранён в облаке.'); clearForm(); await load(); }
    setBusy(false);
  }

  async function deleteRoster(id: string) {
    if (!supabase || !userId || !confirm('Удалить этот ростер? Это действие нельзя отменить.')) return;
    setBusy(true);
    const { error } = await supabase.from('player_rosters').delete().eq('id', id).eq('player_id', userId);
    setMessage(error ? 'Не удалось удалить ростер: ' + error.message : 'Ростер удалён.');
    if (!error) { setRosters(prev => prev.filter(r => r.id !== id)); if (editingId === id) clearForm(); }
    setBusy(false);
  }

  if (!isSupabaseConfigured) return <section className="content"><div className="panel"><h2>Мои ростеры</h2><p>Сначала настрой .env.local с Supabase.</p></div></section>;

  return <section className="content">
    <div className="section-heading">
      <div><span className="eyebrow">PLAYER LOADOUTS</span><h2>Мои ростеры</h2><p className="muted-text">Личные составы, которые можно выбрать для турнира или обычного драфта 1×1.</p></div>
      <div className="button-row"><button className="btn btn-secondary" onClick={() => void load()} disabled={busy}><RefreshCw size={15}/> Обновить</button><button className="btn btn-primary" aria-pressed={inventoryOpen} onClick={() => setInventoryOpen(true)}><Settings2 size={15}/> Ростер аккаунта</button><button className="btn btn-primary" onClick={() => { clearForm(); document.getElementById('roster-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><Plus size={15}/> Создать ростер</button></div>
    </div>

    <div className="detail-grid">
      <div className="panel" id="roster-builder">
        <div className="panel-heading">
          <div><span className="eyebrow">ROSTER BUILDER</span><h2>{editingId ? 'Редактировать ростер' : 'Новый ростер'}</h2></div>
          <Users size={20}/>
        </div>
        <label className="field-label">Название ростера<input className="text-input" maxLength={60} value={rosterName} onChange={e => setRosterName(e.target.value)} placeholder="Например, Основной состав" /></label>
        <label className="field-label">Заметки <span className="muted-text">(необязательно)</span><textarea className="text-input" rows={2} maxLength={300} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Например, стратегия или замены" /></label>
        <div className="roster-cost-summary">
          <Coins size={17}/>
          <span>Стоимость ростера по агентам</span>
          <strong>{agentIds.length === 0 ? 'Выбери агентов' : `${getRosterCost(agentIds, agentLevels).toLocaleString('ru-RU')} кост.`}</strong>
          <small>Сумма стоимости выбранных агентов с их уровнями М</small>
        </div>
        <div className="tabs roster-tabs" role="tablist" aria-label="Состав ростера">
          <button type="button" role="tab" aria-selected={builderTab === 'agents'} className={builderTab === 'agents' ? 'selected' : ''} onClick={() => setBuilderTab('agents')}>Агенты · {agentIds.length}</button>
          <button type="button" role="tab" aria-selected={builderTab === 'engines'} className={builderTab === 'engines' ? 'selected' : ''} onClick={() => setBuilderTab('engines')}>Амплификаторы · {engineIds.length}</button>
        </div>
        {builderTab === 'agents' ? <>
          <div className="panel-heading roster-tab-heading">
            <h3>Агенты из ростера аккаунта</h3>
            <div className="button-row roster-filter-row">
              <button type="button" className="btn btn-secondary" disabled={accountAgentIds.length===0} onClick={()=>{setAgentIds([...accountAgentIds]);setAgentLevels(Object.fromEntries(accountAgentIds.map(id=>[id,accountAgentLevels[id]??(agents.find(a=>a.id===id)?.rank==='A'?6:0)])));}}>Добавить все</button>
              <button type="button" className="btn btn-secondary" disabled={agentIds.length===0} onClick={()=>{setAgentIds([]);setAgentLevels({});}}>Убрать все</button>
              <label className="search-field"><Search size={14}/><input value={agentQuery} onChange={e => setAgentQuery(e.target.value)} placeholder="Найти агента" /></label>
              <label className="field-label compact-filter">Класс<select className="text-input" value={agentSpecialty} onChange={e => setAgentSpecialty(e.target.value)}><option>Все классы</option>{['Нападение','Устрашение','Аномалия','Поддержка','Оборона','Разрушение','Оружейник','Не указана'].map(specialty => <option key={specialty}>{specialty}</option>)}</select></label>
            </div>
          </div>
          <div className="roster-choice-grid">
            {agents.filter(a => accountAgentIds.includes(a.id) && a.name.toLowerCase().includes(agentQuery.toLowerCase()) && (agentSpecialty === 'Все классы' || (a.specialty || 'Не указана') === agentSpecialty)).sort(compareBySpecialty).map(a => {
              const level = accountAgentLevels[a.id] ?? agentLevels[a.id] ?? (a.rank === 'A' ? 6 : 0);
              const cost = getAgentCost(a.id, level);
              return <div key={a.id} className={`roster-choice ${agentIds.includes(a.id) ? 'picked' : ''}`}>
                <button type="button" className="roster-choice-main" onClick={() => {
                  if (agentIds.includes(a.id)) setAgentIds(prev => prev.filter(id => id !== a.id));
                  else { setAgentIds(prev => [...prev, a.id]); setAgentLevels(prev => ({ ...prev, [a.id]: accountAgentLevels[a.id] ?? prev[a.id] ?? (a.rank === 'A' ? 6 : 0) })); }
                }}>
                  <b className="roster-choice-art">{a.avatar}<img src={getAgentIconUrl(a.id)} data-fallback={a.imageFallbackUrl} alt="" loading="lazy" onError={e => { const img = e.currentTarget; const fallback = img.dataset.fallback; if (fallback && img.src !== fallback) { img.dataset.fallback = ''; img.src = fallback; } else img.style.display = 'none'; }} /></b>
                  <span>{a.name}</span><small>{a.rank}-ранг · {a.specialty || 'Класс не указан'} · {cost === null ? 'кост не настроен' : `${cost} кост.`}</small>
                </button>
                {agentIds.includes(a.id) && <div className="level-select account-level-readonly"><span>Ментальная картина</span><strong>М{level}</strong></div>}
              </div>;
            })}
            {accountAgentIds.length === 0 && <p className="muted-text">Сначала добавь агентов во вкладке «Ростер аккаунта».</p>}
          </div>
        </> : <>
          <div className="panel-heading roster-tab-heading">
            <div><h3>Амплификаторы из ростера аккаунта</h3><p className="muted-text">Выбирай нужные копии отдельно. Нажатие на карточку переключает все копии амплификатора.</p></div>
            <div className="button-row roster-filter-row">
              <button type="button" className="btn btn-secondary" disabled={accountEngineIds.length===0} onClick={()=>{setEngineIds([...accountEngineIds]);setEngineLevels(serializeEngineCopyLevels(accountEngineIds,accountEngineLevels,id=>engines.find(w=>w.id===id)));}}>Добавить все</button>
              <button type="button" className="btn btn-secondary" disabled={engineIds.length===0} onClick={()=>{setEngineIds([]);setEngineLevels({});}}>Убрать все</button>
              <label className="search-field"><Search size={14}/><input value={engineQuery} onChange={e => setEngineQuery(e.target.value)} placeholder="Найти амплификатор" /></label>
              <label className="field-label compact-filter">Класс<select className="text-input" value={engineSpecialty} onChange={e => setEngineSpecialty(e.target.value)}><option>Все классы</option>{specialtyOrder.map(specialty => <option key={specialty}>{specialty}</option>)}</select></label>
            </div>
          </div>
          <div className="roster-choice-grid">
            {engines.filter(w => copiesOf(accountEngineIds, w.id) > 0 && w.name.toLowerCase().includes(engineQuery.toLowerCase()) && (engineSpecialty === 'Все классы' || (w.specialty || 'Не указана') === engineSpecialty)).sort(compareBySpecialty).map(w => {
              const ownedCount = copiesOf(accountEngineIds, w.id);
              const selectedCount = copiesOf(engineIds, w.id);
              const accountCopies = accountEngineIds.flatMap((id,index)=>id===w.id?[{copyNumber:copyNumberAt(accountEngineIds,index),level:copyLevel(accountEngineIds,accountEngineLevels,index,engines)}]:[]);
              const selectedLevels = engineIds.flatMap((id,index)=>id===w.id?[copyLevel(engineIds,engineLevels,index,engines)]:[]);
              const seenLevels = new Map<number,number>();
              const copyRows = accountCopies.map(copy=>{
                const occurrence=(seenLevels.get(copy.level)||0)+1;seenLevels.set(copy.level,occurrence);
                return {...copy,selected:(selectedLevels.filter(level=>level===copy.level).length>=occurrence)};
              });
              const toggleAllCopies = () => {
                if (selectedCount > 0) {
                  setEngineIds(prev=>prev.filter(id=>id!==w.id));
                  setEngineLevels(prev=>{const next={...prev};delete next[w.id];for(let copy=1;copy<=selectedCount;copy++)delete next[engineCopyLevelKey(w.id,copy)];return next;});
                } else {
                  setEngineIds(prev=>[...prev,...accountCopies.map(()=>w.id)]);
                  setEngineLevels(prev=>({...prev,...Object.fromEntries(accountCopies.map((copy,index)=>[engineCopyLevelKey(w.id,index+1),copy.level]))}));
                }
              };
              const toggleCopy = (level:number, selected:boolean) => {
                if (!selected) {
                  if (selectedCount>=ownedCount) return;
                  setEngineIds(prev=>[...prev,w.id]);
                  setEngineLevels(prev=>({...prev,[engineCopyLevelKey(w.id,selectedCount+1)]:level}));
                  return;
                }
                const selectedIndex=engineIds.findIndex((id,index)=>id===w.id&&copyLevel(engineIds,engineLevels,index,engines)===level);
                if (selectedIndex<0) return;
                const nextIds=[...engineIds];nextIds.splice(selectedIndex,1);
                const nextLevels={...engineLevels};delete nextLevels[w.id];for(let copy=1;copy<=selectedCount;copy++)delete nextLevels[engineCopyLevelKey(w.id,copy)];
                let nextCopy=0;
                engineIds.forEach((id,index)=>{if(id===w.id&&index!==selectedIndex){nextCopy++;nextLevels[engineCopyLevelKey(w.id,nextCopy)]=copyLevel(engineIds,engineLevels,index,engines);}});
                setEngineIds(nextIds);setEngineLevels(nextLevels);
              };
              return <div key={w.id} className={`roster-choice ${selectedCount ? 'picked' : ''}`}>
              <button type="button" className="roster-choice-main" aria-pressed={selectedCount === ownedCount} onClick={toggleAllCopies}>
                <b className="roster-choice-art engine-choice-art">W<img src={w.imageUrl} data-fallback={w.imageFallbackUrl} alt="" loading="lazy" onError={e => { const img = e.currentTarget; const fallback = img.dataset.fallback; if (fallback && img.src !== fallback) { img.dataset.fallback = ''; img.src = fallback; } else img.style.display = 'none'; }} /></b>
                <span>{w.name}</span><small>{w.rank}-ранг · {w.specialty || 'Класс не указан'}</small><small>Копий в ростере: {selectedCount} из {ownedCount}</small>
              </button>
              <div className="inventory-engine-controls"><span>Выбрано копий: {selectedCount} / {ownedCount}</span></div>
              <div className="engine-copy-level-list builder-engine-copy-list">{copyRows.map((copy,index)=><button type="button" className={`engine-copy-level selectable-copy ${copy.selected?'selected':''}`} key={`${w.id}-${copy.copyNumber}`} aria-label={`${copy.selected?'Убрать':'Добавить'} копию ${copy.copyNumber} ${w.name} Р${copy.level}`} aria-pressed={copy.selected} onClick={()=>toggleCopy(copy.level,copy.selected)}><span>Копия {copy.copyNumber} · Р{copy.level}</span><b aria-hidden="true">{copy.selected?'−':'+'}</b></button>)}</div>
            </div>; })}
            {accountEngineIds.length === 0 && <p className="muted-text">Сначала добавь амплификаторы во вкладке «Ростер аккаунта».</p>}
          </div>
        </>}
        <div className="button-row"><button className="btn btn-primary" onClick={() => void saveRoster()} disabled={busy}><Save size={15}/> {editingId ? 'Сохранить изменения' : 'Сохранить ростер'}</button>{(editingId || agentIds.length > 0 || engineIds.length > 0 || notes) && <button className="btn btn-secondary" onClick={clearForm}><X size={15}/> Очистить</button>}</div>
      </div>
      <div className="panel">
        <div className="panel-heading"><div><span className="eyebrow">SAVED LOADOUTS</span><h2>Сохранённые ростеры</h2></div><span className="badge">{rosters.length}</span></div>
        <label className="search-field roster-search"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по названию и заметкам" /></label>
        {visibleRosters.length === 0 ? <div className="empty-state"><h3>{rosters.length ? 'Ничего не найдено' : 'Пока нет ростеров'}</h3><p>{rosters.length ? 'Попробуй изменить запрос.' : 'Создай первый личный ростер. Сначала отметь своих агентов и амплификаторы в «Ростере аккаунта».'}</p><button className="btn btn-primary" onClick={() => { clearForm(); document.getElementById('roster-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><Plus size={15}/> Создать ростер</button></div> : visibleRosters.map(r => <article className="saved-roster roster-showcase" key={r.id}><div className="saved-roster-copy"><div className="roster-showcase-heading"><div><span className="eyebrow">SAVED LOADOUT</span><h3>{r.name}</h3></div><span className="badge">{(r.agent_ids || []).length} агентов · {getRosterCost(r.agent_ids || [], r.agent_levels).toLocaleString('ru-RU')} кост.</span></div>{r.notes && <p className="roster-notes">{r.notes}</p>}<div className="roster-showcase-section"><h4>Агенты</h4><div className="roster-agent-cards">{(r.agent_ids || []).map(id => { const a = agents.find(item => item.id === id); const level = accountAgentLevels[id] ?? r.agent_levels?.[id] ?? (a?.rank === 'A' ? 6 : 0); return <div className="roster-agent-card" key={id}><div className={`roster-agent-rank rank-${a?.rank || 'X'}`}>{a?.rank || '?'}<img src={a ? getAgentIconUrl(a.id) : undefined} data-fallback={a?.imageFallbackUrl} alt="" loading="lazy" onError={e => { const img = e.currentTarget; const fallback = img.dataset.fallback; if (fallback && img.src !== fallback) { img.dataset.fallback = ''; img.src = fallback; } else img.style.display = 'none'; }} /></div><div className="roster-agent-info"><b>{a?.name || id}</b><span>{a?.specialty || 'Класс не указан'}</span></div><strong className="roster-level-pill">М{level}</strong></div>; })}</div></div><div className="roster-showcase-section"><h4>Амплификаторы</h4>{(r.w_engine_ids || []).length ? <div className="roster-engine-cards">{r.w_engine_ids.map((id, index) => { const w = engines.find(item => item.id === id); return <div className="roster-engine-card" key={`${id}-${index}`}><span className={`engine-rank rank-${w?.rank || 'X'}`}>{w?.rank || '?'}<img src={w?.imageUrl} data-fallback={w?.imageFallbackUrl} alt="" loading="lazy" onError={e => { const img = e.currentTarget; const fallback = img.dataset.fallback; if (fallback && img.src !== fallback) { img.dataset.fallback = ''; img.src = fallback; } else img.style.display = 'none'; }} /></span><div><b>{w?.name || id}</b><small>{w?.rank || 'Ранг не указан'}-ранг</small></div><strong>Р{copyLevel(r.w_engine_ids, r.w_engine_levels, index, engines)}</strong></div>; })}</div> : <p className="roster-empty-inline">Амплификаторы не выбраны</p>}</div></div><div className="button-row roster-actions"><button className="btn btn-secondary" onClick={() => startEdit(r)}>Изменить</button><button className="btn btn-secondary" onClick={() => startCopy(r)} title="Создать копию"><Copy size={14}/></button><button className="btn btn-danger-ghost" onClick={() => void deleteRoster(r.id)} title="Удалить"><Trash2 size={14}/></button></div></article>)}
      </div>
    </div>
    {inventoryOpen && <div className="inventory-modal-backdrop" role="presentation" onClick={e=>{if(e.target===e.currentTarget)setInventoryOpen(false);}}>
      <div className="panel inventory-modal" role="dialog" aria-modal="true" aria-label="Ростер аккаунта">
        <div className="panel-heading">
          <div><span className="eyebrow">ACCOUNT COLLECTION</span><h2>Ростер аккаунта</h2><p className="muted-text">Отметь предметы, которые есть у тебя. В конструкторе ростера будут доступны только выбранные предметы.</p></div>
          <button className="btn btn-secondary" onClick={()=>setInventoryOpen(false)}><X size={15}/> Закрыть</button>
        </div>
        <div className="tabs roster-tabs" role="tablist" aria-label="Ростер аккаунта">
          <button type="button" role="tab" aria-selected={inventoryTab==='agents'} className={inventoryTab==='agents'?'selected':''} onClick={()=>setInventoryTab('agents')}>Агенты · {accountAgentIds.length}</button>
          <button type="button" role="tab" aria-selected={inventoryTab==='engines'} className={inventoryTab==='engines'?'selected':''} onClick={()=>setInventoryTab('engines')}>Амплификаторы · {accountEngineIds.length}</button>
        </div>
        {inventoryTab==='agents' ? <>
          <div className="panel-heading roster-tab-heading">
            <h3>Агенты · {accountAgentIds.length}</h3>
            <div className="button-row">
              <button type="button" className="btn btn-secondary" disabled={accountAgentIds.length===agents.length} onClick={()=>{setAccountAgentIds(agents.map(a=>a.id));setAccountAgentLevels(prev=>({...prev,...Object.fromEntries(agents.map(a=>[a.id,prev[a.id]??(a.rank==='A'?6:0)]))}));}}>Добавить все</button>
              <button type="button" className="btn btn-secondary" disabled={accountAgentIds.length===0} onClick={()=>{setAccountAgentIds([]);setAccountAgentLevels({});}}>Убрать все</button>
              <label className="search-field"><Search size={14}/><input value={inventoryAgentQuery} onChange={e=>setInventoryAgentQuery(e.target.value)} placeholder="Найти агента" /></label>
              <select className="select" value={inventoryAgentClass} onChange={e=>setInventoryAgentClass(e.target.value)}><option>Все классы</option>{specialtyOrder.map(c=><option key={c}>{c}</option>)}</select>
            </div>
          </div>
          <div className="inventory-grid">
            {agents.filter(a=>a.name.toLowerCase().includes(inventoryAgentQuery.toLowerCase()) && (inventoryAgentClass==="Все классы" || (a.specialty || "Не указана")==inventoryAgentClass)).sort(compareBySpecialty).map(a=><div key={a.id} className={`inventory-item inventory-item-card ${accountAgentIds.includes(a.id)?'picked':''}`}>
              <button type="button" className="inventory-item-toggle" onClick={()=>setAccountAgentIds(ids=>{const exists=ids.includes(a.id);if(exists){setAccountAgentLevels(levels=>{const next={...levels};delete next[a.id];return next;});return ids.filter(id=>id!==a.id);}setAccountAgentLevels(levels=>({...levels,[a.id]:levels[a.id]??(a.rank==='A'?6:0)}));return [...ids,a.id];})}>
                <span className="inventory-art"><img src={getAgentIconUrl(a.id)} data-fallback={a.imageFallbackUrl} alt="" loading="lazy" onError={e=>{const img=e.currentTarget;const fallback=img.dataset.fallback;if(fallback&&img.src!==fallback){img.dataset.fallback='';img.src=fallback;}else img.style.display='none';}}/><i>{a.rank}</i></span>
                <b>{a.name}</b><small>{a.rank} · {a.specialty}</small><span>{accountAgentIds.includes(a.id)?'✓ Есть на аккаунте':'＋ Добавить'}</span>
              </button>
              {accountAgentIds.includes(a.id)&&<label className="inventory-level-select">Ментальная картина<select aria-label={`Уровень ментальной картины: ${a.name}`} value={accountAgentLevels[a.id]??(a.rank==='A'?6:0)} onChange={e=>setAccountAgentLevels(levels=>({...levels,[a.id]:Number(e.target.value)}))}>{Array.from({length:7},(_,i)=><option key={i} value={i}>М{i}</option>)}</select></label>}
            </div>)}
          </div>
        </> : <>
          <div className="panel-heading roster-tab-heading">
            <h3>Амплификаторы · {accountEngineIds.length}</h3>
            <div className="button-row">
              <button type="button" className="btn btn-secondary" disabled={engines.every(w=>copiesOf(accountEngineIds,w.id)>0)} onClick={()=>{const missing=engines.filter(w=>copiesOf(accountEngineIds,w.id)===0);setAccountEngineIds(prev=>[...prev,...missing.map(w=>w.id)]);setAccountEngineLevels(prev=>({...prev,...Object.fromEntries(missing.map(w=>[engineCopyLevelKey(w.id,1),defaultEngineLevel(w)]))}));}}>Добавить все</button>
              <button type="button" className="btn btn-secondary" disabled={accountEngineIds.length===0} onClick={()=>{setAccountEngineIds([]);setAccountEngineLevels({});}}>Убрать все</button>
              <label className="search-field"><Search size={14}/><input value={inventoryEngineQuery} onChange={e=>setInventoryEngineQuery(e.target.value)} placeholder="Найти амплификатор" /></label>
              <label className="field-label compact-filter">Класс<select className="text-input" value={inventoryEngineClass} onChange={e=>setInventoryEngineClass(e.target.value)}><option>Все классы</option>{specialtyOrder.map(specialty=><option key={specialty}>{specialty}</option>)}</select></label>
            </div>
          </div>
          <div className="inventory-grid">
            {engines.filter(w=>w.name.toLowerCase().includes(inventoryEngineQuery.toLowerCase()) && (inventoryEngineClass==='Все классы' || (w.specialty||'Не указана')===inventoryEngineClass)).sort(compareBySpecialty).map(w=>{
              const count = copiesOf(accountEngineIds, w.id);
              const toggleAccountEngine = () => {
                if (count === 0) {
                  setAccountEngineIds(ids=>[...ids,w.id]);
                  setAccountEngineLevels(prev=>({...prev,[engineCopyLevelKey(w.id,1)]:defaultEngineLevel(w)}));
                  return;
                }
                setAccountEngineIds(ids=>ids.filter(id=>id!==w.id));
                setAccountEngineLevels(prev=>{
                  const next={...prev};
                  delete next[w.id];
                  for(let copy=1;copy<=count;copy++) delete next[engineCopyLevelKey(w.id,copy)];
                  return next;
                });
              };
              return <div key={w.id} className={`inventory-item inventory-item-card ${count ? 'picked' : ''}`}>
                <div className="inventory-item-toggle" role="button" tabIndex={0} aria-pressed={count > 0} onClick={toggleAccountEngine} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleAccountEngine();}}}>
                  <span className="inventory-art engine-inventory-art"><img src={w.imageUrl} data-fallback={w.imageFallbackUrl} alt="" loading="lazy" onError={e=>{const img=e.currentTarget;const fallback=img.dataset.fallback;if(fallback&&img.src!==fallback){img.dataset.fallback='';img.src=fallback;}else img.style.display='none';}}/><i>{w.rank}</i></span>
                  <b>{w.name}</b><small>{w.rank} · {w.specialty}</small><span>{count ? `Есть на аккаунте: ${count}` : 'Нет на аккаунте'}</span>
                  <small>{w.rank === 'A' ? 'В новых ростерах будет Р5 по умолчанию' : 'Пробуждение в новых ростерах — Р1 по умолчанию'}</small>
                </div>
                <div className="inventory-engine-controls"><button type="button" className="btn btn-secondary" aria-label={`Убрать копию ${w.name}`} disabled={count === 0} onClick={()=>{const key=engineCopyLevelKey(w.id,count);setAccountEngineIds(ids=>removeOneCopy(ids,w.id));setAccountEngineLevels(prev=>{const next={...prev};delete next[key];return next;});}}>−</button><span>{count} коп. в аккаунте</span><button type="button" className="btn btn-secondary" aria-label={`Добавить копию ${w.name}`} onClick={()=>{const number=count+1;setAccountEngineIds(ids=>[...ids,w.id]);setAccountEngineLevels(prev=>({...prev,[engineCopyLevelKey(w.id,number)]:defaultEngineLevel(w)}));}}>＋</button></div>
                {count>0&&<div className="engine-copy-level-list inventory-copy-level-list">{accountEngineIds.map((id,index)=>id===w.id?<label className="engine-copy-level" key={`${id}-${copyNumberAt(accountEngineIds,index)}`}><span>Копия {copyNumberAt(accountEngineIds,index)}</span><select aria-label={`Пробуждение копии ${copyNumberAt(accountEngineIds,index)}: ${w.name}`} value={copyLevel(accountEngineIds,accountEngineLevels,index,engines)} onChange={e=>setAccountEngineLevels(prev=>({...prev,[engineCopyLevelKey(w.id,copyNumberAt(accountEngineIds,index))]:Number(e.target.value)}))}>{Array.from({length:5},(_,i)=><option key={i} value={i+1}>Р{i+1}</option>)}</select></label>:null)}</div>}
              </div>;
            })}
          </div>
        </>}
        <div className="button-row"><button className="btn btn-primary" disabled={busy} onClick={()=>void saveInventory()}><Save size={15}/> Сохранить коллекцию</button></div>
      </div>
    </div>}
    {message && <div className="notice-box" style={{ marginTop: 12 }}>{message}</div>}
    {busy && <p className="muted-text">Загрузка…</p>}
    <p className="muted-text">Названия агентов и амплификаторов отображаются на русском языке. Уровни М0–М6 сохраняются в облаке. В ростер аккаунта можно добавить несколько копий одного амплификатора; количество копий ограничивает выбор в личных ростерах и отрядах BO2. Для A-ранговых амплификаторов в новых ростерах автоматически установлен уровень пробуждения Р5, для S-ранговых — Р1; уровень можно изменить вручную.</p>
  </section>;
}
