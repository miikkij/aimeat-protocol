/**
 * @file workflows-form.js
 * @description Create/Edit form for an Agent Workflow (Profile › Workflows). Authors the descriptor
 *   the API validates: trigger (manual/schedule/event) + typed vars + steps (each picks an agent +
 *   a workflow-compatible offer; signals are inherited from that offer, so the form needs no signal
 *   editor) + the llm-consent toggle. Save → PUT /v1/workflows/:id; save-time validation errors
 *   (DAG / offer-compatibility / undeclared var) render inline. See plan §12.
 * @structure WorkflowForm({ existing, onSaved, onCancel, showToast })
 * @version-history
 *   v1.0.0 -- 2026-06-13 -- Phase 9b: create/edit form (closes the §12 form gap).
 *   v1.1.0 -- 2026-06-15 -- Add the "notify on finish" opt-in toggle (notify_on_finish).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { listAgents } from '/js/services/agents.js';
import { putWorkflow, getAgentOffers } from '/js/services/workflows.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

function loc(s) {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.en_US || s.fi_FI || Object.values(s)[0] || '';
}

const blankStep = () => ({ id: '', agent: '', offer: '', after: [], noInput: false, timeout_min: 60, retryMax: 0, backoffMin: 5, description: '' });

export default function WorkflowForm({ existing, onSaved, onCancel, showToast }) {
  const editing = !!existing;
  const [id, setId] = useState(existing?.id || '');
  const [title, setTitle] = useState(loc(existing?.title));
  const [description, setDescription] = useState(loc(existing?.description));
  const [triggerKind, setTriggerKind] = useState(existing?.trigger?.kind || 'manual');
  const [cron, setCron] = useState(existing?.trigger?.cron || '0 17 * * *');
  const [timezone, setTimezone] = useState(existing?.trigger?.timezone || 'Europe/Helsinki');
  const [eventOn, setEventOn] = useState(existing?.trigger?.on || 'memory.write');
  const [eventMatch, setEventMatch] = useState(existing?.trigger?.match?.key || existing?.trigger?.match?.offer || '');
  const [vars, setVars] = useState(existing?.vars?.map(v => ({ ...v, description: loc(v.description) })) || []);
  const [steps, setSteps] = useState(
    existing?.steps?.map(s => ({
      id: s.id, agent: Array.isArray(s.agent) ? s.agent[0] : s.agent, offer: s.offer,
      after: s.after || [], noInput: s.required_to_function === 'none',
      timeout_min: s.timeout_min ?? 60, retryMax: s.retry?.max || 0, backoffMin: s.retry?.backoff_min || 5,
      description: loc(s.description),
    })) || [blankStep()],
  );
  const [llmApproved, setLlmApproved] = useState(!!existing?.llm?.approved);
  const [notifyOnFinish, setNotifyOnFinish] = useState(!!existing?.notify_on_finish);
  const [agents, setAgents] = useState([]);
  const [offersByAgent, setOffersByAgent] = useState({});
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);

  // listAgents() returns the agent array directly (not an envelope); stay tolerant of both shapes.
  useEffect(() => { listAgents().then(r => setAgents(Array.isArray(r) ? r : (r?.data?.agents ?? r?.data ?? []))).catch(err => { swallowed('workflows-form: WorkflowForm', err); }); }, []);

  const loadOffers = useCallback(async (agentName) => {
    if (!agentName) return;
    setOffersByAgent(prev => {
      if (prev[agentName]) return prev;
      getAgentOffers(agentName).then(r => {
        const offers = (r?.data?.offers || []).filter(o => o.success_signal && o.required_to_function && o.deliverable?.location);
        setOffersByAgent(p => ({ ...p, [agentName]: offers }));
      }).catch(() => setOffersByAgent(p => ({ ...p, [agentName]: [] })));
      return prev;
    });
  }, []);

  // Pre-load offers for steps that already name an agent (edit mode). Mount-once by design: `steps` is
  // read as its INITIAL value only, and later per-step agent changes call loadOffers from the select's
  // onChange (below), so re-running on every steps edit is not wanted. loadOffers is a stable []-useCallback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { steps.forEach(s => s.agent && loadOffers(s.agent)); }, []);

  const setStep = (i, patch) => setSteps(prev => prev.map((s, j) => j === i ? { ...s, ...patch } : s));
  const addStep = () => setSteps(prev => [...prev, blankStep()]);
  const removeStep = (i) => setSteps(prev => prev.filter((_, j) => j !== i));
  const setVar = (i, patch) => setVars(prev => prev.map((v, j) => j === i ? { ...v, ...patch } : v));
  const addVar = () => setVars(prev => [...prev, { name: '', type: 'string', description: '', default: '' }]);
  const removeVar = (i) => setVars(prev => prev.filter((_, j) => j !== i));

  const save = async () => {
    setErrors([]);
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id)) { setErrors([t('profile.workflows.form.idHint')]); return; }
    const trigger = triggerKind === 'schedule' ? { kind: 'schedule', cron, ...(timezone ? { timezone } : {}) }
      : triggerKind === 'event' ? { kind: 'event', on: eventOn, match: eventOn === 'memory.write' ? { key: eventMatch } : { offer: eventMatch } }
      : { kind: 'manual' };
    const def = {
      title: title || id,
      description: description || '-',
      trigger,
      vars: vars.filter(v => v.name).map(v => ({ name: v.name, type: v.type || 'string', description: v.description || v.name, ...(v.default ? { default: v.default } : {}) })),
      steps: steps.map(s => ({
        id: s.id, agent: s.agent, offer: s.offer,
        ...(s.after?.length ? { after: s.after } : {}),
        description: s.description || s.id,
        ...(s.noInput ? { required_to_function: 'none' } : {}),
        ...(Number(s.retryMax) > 0 ? { retry: { max: Number(s.retryMax), backoff_min: Number(s.backoffMin) || 5 } } : {}),
        timeout_min: Number(s.timeout_min) || 60,
      })),
      on_step_fail: 'inspect',
      ...(notifyOnFinish ? { notify_on_finish: true } : {}),
      ...(llmApproved ? { llm: { approved: true } } : {}),
    };
    setSaving(true);
    try {
      await putWorkflow(id, def);
      showToast?.(t('profile.workflows.form.saved'), false);
      onSaved?.(id);
    } catch (e) {
      const list = e?.response?.error?.details?.errors;
      setErrors(Array.isArray(list) && list.length ? list : [e?.message || 'Save failed']);
    } finally {
      setSaving(false);
    }
  };

  const stepIds = steps.map(s => s.id).filter(Boolean);

  return html`
    <div class="wf-tab">
      <div class="wf-detail-head">
        <button class="btn-ghost" onClick=${onCancel}>← ${t('profile.workflows.back')}</button>
        <div class="wf-detail-title">${editing ? t('profile.workflows.form.editTitle') : t('profile.workflows.form.newTitle')}</div>
      </div>

      ${errors.length > 0 && html`<div class="wf-error"><ul class="wf-err-list">${errors.map(e => html`<li>${e}</li>`)}</ul></div>`}

      <div class="wf-form">
        <label class="wf-field">
          <span>${t('profile.workflows.form.id')}</span>
          <input type="text" value=${id} disabled=${editing} placeholder="laimeat-sanomat-evening"
            onInput=${e => setId(e.target.value)} />
        </label>
        <label class="wf-field">
          <span>${t('profile.workflows.form.titleField')}</span>
          <input type="text" value=${title} onInput=${e => setTitle(e.target.value)} />
        </label>
        <label class="wf-field">
          <span>${t('profile.workflows.form.description')}</span>
          <input type="text" value=${description} onInput=${e => setDescription(e.target.value)} />
        </label>

        <!-- Trigger -->
        <label class="wf-field">
          <span>${t('profile.workflows.form.trigger')}</span>
          <select value=${triggerKind} onChange=${e => setTriggerKind(e.target.value)}>
            <option value="manual">${t('profile.workflows.trigger.manual')}</option>
            <option value="schedule">${t('profile.workflows.trigger.schedule')}</option>
            <option value="event">${t('profile.workflows.trigger.event')}</option>
          </select>
        </label>
        ${triggerKind === 'schedule' && html`<div class="wf-field-row">
          <label class="wf-field"><span>cron</span><input type="text" value=${cron} onInput=${e => setCron(e.target.value)} /></label>
          <label class="wf-field"><span>timezone</span><input type="text" value=${timezone} onInput=${e => setTimezone(e.target.value)} /></label>
        </div>`}
        ${triggerKind === 'event' && html`<div class="wf-field-row">
          <label class="wf-field"><span>on</span>
            <select value=${eventOn} onChange=${e => setEventOn(e.target.value)}>
              <option value="memory.write">memory.write</option>
              <option value="offer.ordered">offer.ordered</option>
            </select>
          </label>
          <label class="wf-field"><span>${eventOn === 'memory.write' ? t('profile.workflows.form.matchKey') : t('profile.workflows.form.matchOffer')}</span>
            <input type="text" value=${eventMatch} onInput=${e => setEventMatch(e.target.value)} placeholder=${eventOn === 'memory.write' ? 'news.*' : 'fetch'} /></label>
        </div>`}

        <!-- Vars -->
        <div class="wf-form-section">
          <div class="wf-form-section-head"><span>${t('profile.workflows.form.vars')}</span>
            <button class="btn-ghost" onClick=${addVar}>+ ${t('profile.workflows.form.addVar')}</button></div>
          ${vars.map((v, i) => html`<div class="wf-field-row" key=${i}>
            <input type="text" placeholder="name" value=${v.name} onInput=${e => setVar(i, { name: e.target.value })} />
            <input type="text" placeholder="type" value=${v.type} onInput=${e => setVar(i, { type: e.target.value })} />
            <input type="text" placeholder="default (<run-date>)" value=${v.default || ''} onInput=${e => setVar(i, { default: e.target.value })} />
            <button class="btn-ghost" onClick=${() => removeVar(i)}>✕</button>
          </div>`)}
        </div>

        <!-- Steps -->
        <div class="wf-form-section">
          <div class="wf-form-section-head"><span>${t('profile.workflows.form.steps')}</span>
            <button class="btn-ghost" onClick=${addStep}>+ ${t('profile.workflows.form.addStep')}</button></div>
          ${steps.map((s, i) => html`<div class="wf-step-edit" key=${i}>
            <div class="wf-field-row">
              <input type="text" placeholder="step id" value=${s.id} onInput=${e => setStep(i, { id: e.target.value })} />
              <select value=${s.agent} onChange=${e => { setStep(i, { agent: e.target.value, offer: '' }); loadOffers(e.target.value); }}>
                <option value="">${t('profile.workflows.form.pickAgent')}</option>
                ${agents.map(a => html`<option value=${a.name} key=${a.name}>${a.name}</option>`)}
              </select>
              <select value=${s.offer} onChange=${e => setStep(i, { offer: e.target.value })}>
                <option value="">${t('profile.workflows.form.pickOffer')}</option>
                ${(offersByAgent[s.agent] || []).map(o => html`<option value=${o.id} key=${o.id}>${o.id}</option>`)}
              </select>
              <button class="btn-ghost" onClick=${() => removeStep(i)}>✕</button>
            </div>
            ${s.agent && (offersByAgent[s.agent]?.length === 0) && html`<div class="wf-muted">${t('profile.workflows.form.noCompatibleOffers')}</div>`}
            <div class="wf-field-row wf-step-opts">
              <label class="wf-inline"><input type="checkbox" checked=${s.noInput} onChange=${e => setStep(i, { noInput: e.target.checked })} /> ${t('profile.workflows.form.noInput')}</label>
              <label class="wf-inline">timeout_min <input type="number" min="1" value=${s.timeout_min} onInput=${e => setStep(i, { timeout_min: e.target.value })} /></label>
              <label class="wf-inline">retry <input type="number" min="0" value=${s.retryMax} onInput=${e => setStep(i, { retryMax: e.target.value })} /></label>
              ${Number(s.retryMax) > 0 && html`<label class="wf-inline">backoff_min <input type="number" min="0" value=${s.backoffMin} onInput=${e => setStep(i, { backoffMin: e.target.value })} /></label>`}
            </div>
            ${stepIds.filter(x => x && x !== s.id).length > 0 && html`<div class="wf-step-after">
              <span class="wf-muted">${t('profile.workflows.after')}:</span>
              ${stepIds.filter(x => x && x !== s.id).map(other => html`<label class="wf-inline" key=${other}>
                <input type="checkbox" checked=${s.after?.includes(other)} onChange=${e => setStep(i, { after: e.target.checked ? [...(s.after || []), other] : (s.after || []).filter(a => a !== other) })} /> ${other}
              </label>`)}
            </div>`}
          </div>`)}
        </div>

        <label class="wf-inline wf-notify-toggle">
          <input type="checkbox" checked=${notifyOnFinish} onChange=${e => setNotifyOnFinish(e.target.checked)} />
          ${t('profile.workflows.form.notifyOnFinish')}
        </label>

        <label class="wf-inline wf-llm-toggle">
          <input type="checkbox" checked=${llmApproved} onChange=${e => setLlmApproved(e.target.checked)} />
          ${t('profile.workflows.form.llmApproved')}
        </label>

        <div class="wf-form-actions">
          <button class="btn-ghost" onClick=${onCancel}>${t('profile.workflows.form.cancel')}</button>
          <button class="btn-primary" disabled=${saving} onClick=${save}>${saving ? '…' : t('profile.workflows.form.save')}</button>
        </div>
      </div>
    </div>`;
}
