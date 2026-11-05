import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Save, Trash2, Globe } from "lucide-react";
import { supabase } from "./supabase";

type Side = "I1" | "I2";
type Action = "ban" | "pick" | "mirror";
type DraftStep = { id: string; side: Side; action: Action; count: number; label: string };
type DraftTemplate = { id: string; name: string; steps: DraftStep[] };
const STORAGE_KEY = "zzzdraft-draft-templates-v1";
const uid = () => `step-${Math.random().toString(36).slice(2, 10)}`;
const makeStep = (side: Side, action: Action, count = 1): DraftStep => ({ id: uid(), side, action, count, label: "" });
const defaultSteps: DraftStep[] = [
  makeStep("I1", "ban"), makeStep("I2", "ban"), makeStep("I1", "pick"), makeStep("I2", "pick"),
  makeStep("I1", "pick", 2), makeStep("I2", "pick", 2), makeStep("I1", "pick"), makeStep("I2", "ban"),
  makeStep("I1", "ban"), makeStep("I2", "pick", 2), makeStep("I1", "pick", 2), makeStep("I2", "mirror"), makeStep("I1", "mirror"),
];
const defaultTemplates: DraftTemplate[] = [{ id: "standard", name: "Стандартный драфт", steps: defaultSteps }];
function loadTemplates(): DraftTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultTemplates;
    const parsed = JSON.parse(raw) as DraftTemplate[];
    return Array.isArray(parsed) && parsed.length ? parsed : defaultTemplates;
  } catch { return defaultTemplates; }
}
const actionLabel: Record<Action, string> = { ban: "Бан", pick: "Пик", mirror: "Зеркальный пик" };

function DraftPreview({ steps }: { steps: DraftStep[] }) {
  const actions = steps.flatMap((step, index) => Array.from({ length: step.count }, (_, sub) => ({ step, index, sub }))).map((item, turn) => ({ ...item, turn }));
  const categories: Action[] = ["ban", "pick", "mirror"];
  const categoryLabel: Record<Action, string> = { ban: "БАНЫ", pick: "ОБЫЧНЫЕ ПИКИ", mirror: "ЗЕРКАЛЬНЫЕ ПИКИ" };
  return <div className="draft-preview draft-preview-board"><div className="draft-preview-title"><div><b>Так будет выглядеть драфт</b><span>Слева и справа ходы игроков в порядке категорий</span></div><strong>{actions.length} ходов</strong></div><div className="draft-preview-matchbar"><div className="draft-preview-player"><span className="draft-preview-avatar">1</span><span><b>Игрок 1</b><small>Зарегистрированный ростер</small></span></div><div className="draft-preview-turn"><span>ПЕРВЫЙ ХОД</span><b>{actionLabel[steps[0]?.action ?? "ban"]}</b><small>{steps[0]?.side === "I2" ? "Игрок 2 ходит первым" : "Игрок 1 ходит первым"}</small></div><div className="draft-preview-player right"><span><b>Игрок 2</b><small>Зарегистрированный ростер</small></span><span className="draft-preview-avatar opponent">2</span></div></div><div className="draft-preview-columns">{(["I1", "I2"] as Side[]).map(side => <section className={`draft-preview-side ${side === "I2" ? "right" : ""}`} key={side}><div className="draft-preview-side-title"><span className={`draft-preview-avatar ${side === "I2" ? "opponent" : ""}`}>{side === "I1" ? "1" : "2"}</span><b>{side === "I1" ? "ХОДЫ ИГРОКА 1" : "ХОДЫ ИГРОКА 2"}</b></div><div className="draft-preview-categories">{categories.map(action => { const items = actions.filter(item => item.step.side === side && item.step.action === action); return <section className={`draft-preview-category category-${action}`} key={action}><h4>{categoryLabel[action]}</h4>{items.length ? <div className="draft-preview-action-list">{items.map(({ step, sub, turn }) => <div className={`draft-preview-turn-row action-${action} ${turn === 0 ? "is-current" : ""}`} key={`${step.id}-${sub}`}><b>{String(turn + 1).padStart(2, "0")}</b><span>{actionLabel[action]}</span>{step.label && sub === 0 && <small>{step.label}</small>}</div>)}</div> : <span className="draft-preview-empty">Нет ходов</span>}</section>; })}</div></section>)}</div></div>;
}

export default function DraftSequenceEditor() {
  const [templates, setTemplates] = useState<DraftTemplate[]>(loadTemplates);
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? "standard");
  const [saved, setSaved] = useState(true);
  const [globalTemplateId, setGlobalTemplateId] = useState<string | null>(null);
  const [globalBusy, setGlobalBusy] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const selected = templates.find(t => t.id === selectedId) ?? templates[0];
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(templates)); }, [templates]);
  useEffect(() => {
    let cancelled = false;
    async function loadGlobal() {
      if (!supabase) return;
      const { data, error } = await supabase.from("global_draft_template").select("template").eq("id", 1).maybeSingle();
      if (!cancelled && !error && data?.template?.id) setGlobalTemplateId(data.template.id);
    }
    void loadGlobal();
    return () => { cancelled = true; };
  }, []);
  const setGlobalTemplate = async () => {
    if (!supabase) { setGlobalMessage("Supabase не настроен."); return; }
    setGlobalBusy(true); setGlobalMessage("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Сначала войди в аккаунт администратора.");
      const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", authData.user.id).single();
      if (profileError) throw profileError;
      if (profile?.role !== "admin") throw new Error("Выбрать глобальный шаблон может только администратор.");
      const normalized = { ...selected, steps: selected.steps.map(({side, action, count, label}) => ({side, action, count, label})) };
      const { error } = await supabase.from("global_draft_template").upsert({ id: 1, template: normalized, updated_by: authData.user.id, updated_at: new Date().toISOString() });
      if (error) throw error;
      setGlobalTemplateId(selected.id);
      setGlobalMessage(`«${selected.name}» выбран глобальным шаблоном для новых драфтов.`);
    } catch (e: any) { setGlobalMessage(e.message || "Не удалось назначить глобальный шаблон."); }
    finally { setGlobalBusy(false); }
  };
  if (!selected) return null;
  const updateSelected = (fn: (template: DraftTemplate) => DraftTemplate) => {
    setTemplates(old => old.map(t => t.id === selected.id ? fn(t) : t));
    setSaved(false);
  };
  const moveStep = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= selected.steps.length) return;
    updateSelected(t => {
      const steps = [...t.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...t, steps };
    });
  };
  const insertStep = (index: number, action: Action) => {
    const previous = selected.steps[Math.max(0, index - 1)];
    const side: Side = previous?.side === "I1" ? "I2" : "I1";
    updateSelected(t => {
      const steps = [...t.steps];
      steps.splice(index, 0, makeStep(side, action));
      return { ...t, steps };
    });
  };
  const duplicateStep = (index: number) => updateSelected(t => {
    const steps = [...t.steps];
    steps.splice(index + 1, 0, { ...steps[index], id: uid() });
    return { ...t, steps };
  });
  const changeStepCount = (stepId: string, delta: number) => updateSelected(t => ({
    ...t,
    steps: t.steps.map(s => s.id === stepId ? { ...s, count: Math.min(5, Math.max(1, s.count + delta)) } : s),
  }));
  const addTemplate = () => {
    const template = { id: uid(), name: `Новый шаблон ${templates.length + 1}`, steps: [makeStep("I1", "ban"), makeStep("I2", "ban")] };
    setTemplates(old => [...old, template]); setSelectedId(template.id); setSaved(false);
  };
  const duplicateTemplate = () => {
    const copy = { ...selected, id: uid(), name: `${selected.name} — копия`, steps: selected.steps.map(s => ({ ...s, id: uid() })) };
    setTemplates(old => [...old, copy]); setSelectedId(copy.id); setSaved(false);
  };
  return <div className="panel draft-editor">
    <div className="panel-heading"><div><span className="eyebrow">DRAFT FLOW BUILDER</span><h3>Последовательности драфта</h3></div><span className={`badge ${saved ? "badge-green" : "badge-accent"}`}>{saved ? "Сохранено в браузере" : "Есть изменения"}</span></div>
    <p className="muted-text">Настрой порядок ходов, сохрани шаблон, а затем назначь его глобальным для всех новых онлайн-драфтов.</p>
    <div className="draft-template-toolbar"><select className="select" value={selected.id} onChange={e => setSelectedId(e.target.value)}>{templates.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select><button className="btn btn-secondary" onClick={addTemplate}><Plus size={14}/> Новый</button><button className="btn btn-secondary" onClick={duplicateTemplate}><Copy size={14}/> Копировать</button><button className="btn btn-primary" onClick={() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(templates)); setSaved(true); }}><Save size={14}/> Сохранить</button><button className="btn btn-secondary" disabled={globalBusy} onClick={() => void setGlobalTemplate()}><Globe size={14}/>{globalBusy ? "Назначаю…" : "Сделать глобальным"}</button></div>{globalMessage && <p className="muted-text" role="status">{globalMessage}</p>}<p className="muted-text">{globalTemplateId === selected.id ? "Этот шаблон сейчас глобальный." : "Глобальный шаблон: " + (templates.find(t => t.id === globalTemplateId)?.name ?? (globalTemplateId ? "назначен в базе" : "не выбран"))}</p>
    <label className="field-label">Название шаблона<input className="text-input" value={selected.name} onChange={e => updateSelected(t => ({ ...t, name: e.target.value }))} /></label>
    <div className="draft-builder-heading"><div><b>Порядок ходов</b><span>Добавляй действия между шагами и настраивай их прямо на карточках.</span></div><strong>{selected.steps.reduce((total, step) => total + step.count, 0)} действий</strong></div>
    <div className="draft-step-list">{selected.steps.map((step, index) => <div className="draft-step-group" key={step.id}>
      <div className={`draft-step-node action-${step.action}`}>
        <div className="draft-step-rail"><span>{String(index + 1).padStart(2, "0")}</span></div>
        <article className="draft-step-card">
          <div className="draft-step-card-head"><span className={`draft-action-badge action-${step.action}`}>{actionLabel[step.action]}</span><span className={`draft-side-badge ${step.side === "I1" ? "side-one" : "side-two"}`}>{step.side === "I1" ? "Игрок 1" : "Игрок 2"}</span><div className="draft-step-actions"><button className="icon-btn" title="Переместить выше" aria-label="Переместить выше" disabled={index === 0} onClick={() => moveStep(index, -1)}><ArrowUp size={14}/></button><button className="icon-btn" title="Переместить ниже" aria-label="Переместить ниже" disabled={index === selected.steps.length - 1} onClick={() => moveStep(index, 1)}><ArrowDown size={14}/></button><button className="icon-btn" title="Дублировать шаг" aria-label="Дублировать шаг" onClick={() => duplicateStep(index)}><Copy size={14}/></button><button className="icon-btn draft-delete" title="Удалить шаг" aria-label="Удалить шаг" onClick={() => updateSelected(t => ({ ...t, steps: t.steps.filter(s => s.id !== step.id) }))}><Trash2 size={14}/></button></div></div>
          <div className="draft-step-settings"><label><span>Ходит</span><select className="select" aria-label="Сторона" value={step.side} onChange={e => updateSelected(t => ({ ...t, steps: t.steps.map(s => s.id === step.id ? { ...s, side: e.target.value as Side } : s) }))}><option value="I1">Игрок 1</option><option value="I2">Игрок 2</option></select></label><label><span>Действие</span><select className="select" aria-label="Действие" value={step.action} onChange={e => updateSelected(t => ({ ...t, steps: t.steps.map(s => s.id === step.id ? { ...s, action: e.target.value as Action } : s) }))}>{Object.entries(actionLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="draft-count-control"><span>Количество</span><div><button type="button" aria-label="Уменьшить количество" disabled={step.count <= 1} onClick={() => changeStepCount(step.id, -1)}>−</button><b>{step.count}</b><button type="button" aria-label="Увеличить количество" disabled={step.count >= 5} onClick={() => changeStepCount(step.id, 1)}>+</button></div></div></div>
          <details className="draft-step-note"><summary>{step.label ? "Изменить подпись шага" : "Добавить подпись (необязательно)"}</summary><input className="text-input" aria-label="Подпись шага" placeholder="Например: первый бан" value={step.label} onChange={e => updateSelected(t => ({ ...t, steps: t.steps.map(s => s.id === step.id ? { ...s, label: e.target.value } : s) }))}/></details>
        </article>
      </div>
      {index < selected.steps.length - 1 && <div className="draft-step-insert"><span/><button type="button" onClick={() => insertStep(index + 1, "pick")}><Plus size={13}/> Вставить шаг</button><span/></div>}
    </div>)}</div>
    <div className="draft-step-presets"><span>Добавить действие</span><button type="button" onClick={() => insertStep(selected.steps.length, "ban")}><Plus size={14}/> Бан</button><button type="button" onClick={() => insertStep(selected.steps.length, "pick")}><Plus size={14}/> Пик</button><button type="button" onClick={() => insertStep(selected.steps.length, "mirror")}><Plus size={14}/> Зеркальный пик</button></div>
    <div className="draft-editor-footer"><span className="muted-text">Шаги запускаются в указанном порядке.</span><button className="btn btn-danger-ghost" disabled={templates.length <= 1} onClick={() => { if (!window.confirm(`Удалить шаблон «${selected.name}»?`)) return; const rest = templates.filter(t => t.id !== selected.id); setTemplates(rest); setSelectedId(rest[0].id); setSaved(false); }}>Удалить шаблон</button></div>
    <DraftPreview steps={selected.steps} />
  </div>;
}
