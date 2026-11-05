import { useEffect, useState } from 'react';
import { Ban, ShieldCheck } from 'lucide-react';
import { supabase } from './supabase';

type GlobalRules = { min_agents: number; min_roster_cost: number; max_roster_cost: number; cost_difference_per_preban: number; turn_timer_seconds: number; reserve_time_seconds: number };
const defaults: GlobalRules = { min_agents: 5, min_roster_cost: 0, max_roster_cost: 999, cost_difference_per_preban: 3, turn_timer_seconds: 60, reserve_time_seconds: 30 };

export default function GlobalRulesAdmin() {
  const [rules, setRules] = useState<GlobalRules>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    async function load() {
      if (!supabase) { if (alive) { setMessage('Supabase не настроен.'); setLoading(false); } return; }
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!user) { if (alive) { setMessage('Войди в аккаунт администратора.'); setLoading(false); } return; }
      const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (profileError || !['admin', 'cost_manager'].includes(profile?.role || '')) { if (alive) { setMessage('Доступ запрещён: глобальные правила доступны администраторам и Cost Manager.'); setLoading(false); } return; }
      const { data, error } = await supabase.from('system_settings').select('settings').eq('id', 'global_rules').maybeSingle();
      if (alive) {
        if (error) setMessage('Не удалось загрузить правила: ' + error.message);
        else if (data?.settings) setRules({ ...defaults, ...(data.settings as Partial<GlobalRules>) });
        setLoading(false);
      }
    }
    void load();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    const channel = sb.channel('global-rules-editor')
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'system_settings', filter:'id=eq.global_rules' }, payload => {
        if ((payload.new as any)?.settings) setRules({ ...defaults, ...(payload.new as any).settings });
      }).subscribe();
    return () => { void sb.removeChannel(channel); };
  }, []);
  async function save() {
    if (!supabase) return;
    setSaving(true); setMessage('');
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error('Сессия не найдена. Войди снова.');
      const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', authData.user.id).maybeSingle();
      if (profileError || !['admin', 'cost_manager'].includes(profile?.role || '')) throw new Error('Доступ запрещён: глобальные правила могут менять администратор и Cost Manager.');
      const normalized = {
        min_agents: Math.max(1, Math.min(100, Math.floor(Number(rules.min_agents) || 1))),
        min_roster_cost: Math.max(0, Math.floor(Number(rules.min_roster_cost) || 0)),
        max_roster_cost: Math.max(0, Math.floor(Number(rules.max_roster_cost) || 0)),
        cost_difference_per_preban: Math.max(1, Math.floor(Number(rules.cost_difference_per_preban) || 1)),
        turn_timer_seconds: Math.max(10, Math.min(600, Math.floor(Number(rules.turn_timer_seconds) || defaults.turn_timer_seconds))),
        reserve_time_seconds: Math.max(0, Math.min(300, Math.floor(Number(rules.reserve_time_seconds) || 0))),
      };
      if (normalized.max_roster_cost < normalized.min_roster_cost) throw new Error('Максимальная стоимость не может быть меньше минимальной.');
      const { error } = await supabase.from('system_settings').upsert({ id: 'global_rules', settings: normalized, updated_by: authData.user.id, updated_at: new Date().toISOString() });
      if (error) throw error;
      setRules(normalized); setMessage('Глобальные правила сохранены.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось сохранить настройки.'); }
    finally { setSaving(false); }
  }
  return <div className="panel global-rules-panel"><div className="panel-heading"><div><span className="eyebrow">SYSTEM CONFIGURATION</span><h3><ShieldCheck size={17} style={{verticalAlign:'middle', marginRight:8}}/>Глобальные правила драфта</h3><p className="muted-text">Настройки доступны администраторам и Cost Manager и сохраняются в Supabase. Значения таймера применяются к каждой новой комнате.</p></div></div>{loading ? <p className="muted-text">Загружаем настройки…</p> : <><div className="settings-grid"><label className="field-label">Минимум агентов в ростере<input className="text-input" type="number" min={1} max={100} value={rules.min_agents} onChange={e=>setRules(v=>({...v,min_agents:Number(e.target.value)}))}/></label><label className="field-label">Минимальная стоимость ростера<input className="text-input" type="number" min={0} value={rules.min_roster_cost} onChange={e=>setRules(v=>({...v,min_roster_cost:Number(e.target.value)}))}/></label><label className="field-label">Максимальная стоимость ростера<input className="text-input" type="number" min={0} value={rules.max_roster_cost} onChange={e=>setRules(v=>({...v,max_roster_cost:Number(e.target.value)}))}/></label><label className="field-label">Разница стоимости на дополнительный бан<input className="text-input" type="number" min={1} value={rules.cost_difference_per_preban} onChange={e=>setRules(v=>({...v,cost_difference_per_preban:Number(e.target.value)}))}/><small className="muted-text">Количество дополнительных банов: разница стоимости, делённая на это значение, округление вниз.</small></label><label className="field-label">Время на ход, секунд<input className="text-input" type="number" min={10} max={600} step={5} value={rules.turn_timer_seconds} onChange={e=>setRules(v=>({...v,turn_timer_seconds:Number(e.target.value)}))}/><small className="muted-text">От 10 секунд до 10 минут на каждый ход.</small></label><label className="field-label">Запасное время на ход, секунд<input className="text-input" type="number" min={0} max={300} step={5} value={rules.reserve_time_seconds} onChange={e=>setRules(v=>({...v,reserve_time_seconds:Number(e.target.value)}))}/><small className="muted-text">Дополнительное время после основного, до 5 минут.</small></label></div><div className="notice-box"><Ban size={17}/><p>Дополнительные баны получает игрок с более дешёвым ростером. Серверная проверка доступности персонажей должна быть включена отдельно в логике драфта.</p></div><button className="btn btn-primary" disabled={saving} onClick={()=>void save()}>{saving?'Сохраняю…':'Сохранить глобальные правила'}</button></>}{message&&<p className="online-message">{message}</p>}</div>;
}
