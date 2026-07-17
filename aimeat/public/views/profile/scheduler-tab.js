/**
 * @file scheduler-tab.js
 * @description Profile › Scheduler — the master view of every recurring schedule
 *   the owner has running: AIMEAT-managed (ai / agent_task / extension), the
 *   owner's extension cron jobs, and each agent's self-reported internal
 *   scheduler. The server owns the clock; the owner can create, pause/resume,
 *   run-now, and cancel managed schedules (including any an agent created).
 * @structure
 *   - SchedulerTab (default) — loads /v1/schedules, renders a day/week/month calendar
 *     (SchedulerCalendar) + grouped sections + create form
 *   - jumpToSchedule — scroll to + flash a schedule's card/row when its calendar event is clicked
 * @usage Registered in profile.js TABS as { id:'scheduler', component: SchedulerTab }.
 * @version-history
 *   v1.1.0 -- 2026-07-16 -- Mount folds schedules + agents into GET /v1/scheduler/tab (getSchedulerTab);
 *     occurrences stay a range-driven request; individual reads kept as fallback.
 *   v1.0.0 -- 2026-06-03 -- Initial master scheduler view
 *   v1.0.1 -- 2026-06-03 -- Extension cron "Next run" uses formatUntil (was timeAgo → negative "ago")
 *   v1.1.0 -- 2026-07-03 -- Add SchedulerCalendar (day/week/month cadence view) at the top; clicking a
 *     calendar event scrolls to + flashes that schedule's card (id=sch-card-*) or extension row
 *     (id=sch-ext-*). loadData bumps reloadTick so the calendar refetches occurrences on any change.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { listAgents } from '/js/services/agents.js';
import { listAllSchedules, getSchedulerTab, createSchedule } from '/js/services/schedules.js';
import ScheduleItem, { formatUntil } from './schedule-item.js';
import SchedulerCalendar from './scheduler-calendar.js';

import { EmptyState } from '/components/EmptyState.js';
const html = htm.bind(h);

/** Scroll to and briefly flash a schedule's card (or extension row) by id. */
function jumpToSchedule(id) {
  const el = document.getElementById(`sch-card-${id}`) || document.getElementById(`sch-ext-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('sch-flash');
  setTimeout(() => { el.classList.remove('sch-flash'); }, 1600);
}

const CRON_PRESETS = [
  { key: 'morning', cron: '0 7 * * *' },
  { key: 'evening', cron: '0 19 * * *' },
  { key: 'hourly', cron: '0 * * * *' },
  { key: 'custom', cron: '' },
];

function resultBadge(result) {
  if (!result) return html`<span class="sch-muted">—</span>`;
  const cls = result === 'error' ? 'sch-badge--err' : 'sch-badge--ok';
  return html`<span class="sch-badge ${cls}">${result}</span>`;
}

export default function SchedulerTab({ showToast }) {
  const [data, setData] = useState({ managed: [], extensions: [], agentInternal: [] });
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  // Bumped on every (re)load so the calendar refetches its projected fire-times
  // whenever a schedule is created / paused / edited / cancelled or a live update lands.
  const [reloadTick, setReloadTick] = useState(0);

  const loadData = useCallback(async () => {
    try {
      // Mount fold: ONE composite (schedule aggregate + agent names). On failure, fall back to the
      // individual reads. The calendar's occurrence projection stays a separate (range-driven) request.
      const ov = await getSchedulerTab();
      if (ov) {
        setData(ov.schedules);
        setAgents(ov.agents);
      } else {
        const [schedRes, agentsRes] = await Promise.all([listAllSchedules(), listAgents().catch(() => null)]);
        setData(schedRes?.data || { managed: [], extensions: [], agentInternal: [] });
        setAgents(agentsRes?.data?.agents || []);
      }
      setError(null);
      setReloadTick((n) => n + 1);
    } catch (e) {
      setError(e.message || 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    loadData();
    return onLiveUpdate(['schedules', 'agent-tasks'], () => loadRef.current());
  }, [loadData]);

  if (loading) return html`<div class="sch-loading">${t('profile.scheduler.loading')}</div>`;

  return html`
    <div class="sch-tab">
      <div class="sch-head">
        <div>
          <div class="section-title">${t('profile.scheduler.title')}</div>
          <div class="section-desc">${t('profile.scheduler.desc')}</div>
        </div>
        <button class="btn-primary" onClick=${() => setShowForm(v => !v)}>
          ${showForm ? t('profile.scheduler.close') : t('profile.scheduler.newSchedule')}
        </button>
      </div>

      ${error && html`<div class="sch-error">${error}</div>`}

      ${showForm && html`<${CreateForm} agents=${agents} showToast=${showToast}
        onCreated=${() => { setShowForm(false); loadData(); }} />`}

      <!-- Calendar: when things fire, across day / week / month -->
      <div class="sch-section sch-cal-section">
        <h3 class="sch-section-title">${t('profile.scheduler.cal.title')}</h3>
        <${SchedulerCalendar}
          schedules=${[...data.managed, ...data.extensions]}
          reloadKey=${reloadTick}
          onJumpTo=${jumpToSchedule} />
      </div>

      <!-- AIMEAT-managed -->
      <div class="sch-section">
        <h3 class="sch-section-title">${t('profile.scheduler.managedTitle')}</h3>
        ${data.managed.length === 0
          ? html`<${EmptyState} text=${t('profile.scheduler.noManaged')} />`
          : html`<div class="sch-card-list">${data.managed.map(j => html`<${ScheduleItem} key=${j.id} schedule=${j} onChanged=${loadData} showToast=${showToast} />`)}</div>`}
      </div>

      <!-- Owner extension cron -->
      ${data.extensions.length > 0 && html`<div class="sch-section">
        <h3 class="sch-section-title">${t('profile.scheduler.extTitle')}</h3>
        <table class="sch-table"><thead><tr>
          <th>${t('profile.scheduler.col.name')}</th>
          <th>${t('profile.scheduler.col.extension')}</th>
          <th>${t('profile.scheduler.col.cron')}</th>
          <th>${t('profile.scheduler.col.lastRun')}</th>
          <th>${t('profile.scheduler.col.nextRun')}</th>
        </tr></thead><tbody>
          ${data.extensions.map(j => html`<tr key=${j.id} id=${'sch-ext-' + j.id}>
            <td>${j.displayName || j.name}</td>
            <td><code class="sch-cron">${j.extensionName}${j.actionId ? '/' + j.actionId : ''}</code></td>
            <td><code class="sch-cron">${j.cron}</code></td>
            <td>${j.lastRunAt ? timeAgo(j.lastRunAt) : '—'} ${resultBadge(j.lastRunResult)}</td>
            <td>${formatUntil(j.nextRunAt)}</td>
          </tr>`)}
        </tbody></table>
      </div>`}

      <!-- Agent internal (read-only mirror) -->
      ${data.agentInternal.length > 0 && html`<div class="sch-section">
        <h3 class="sch-section-title">${t('profile.scheduler.internalTitle')}</h3>
        <div class="sch-muted sch-internal-note">${t('profile.scheduler.internalNote')}</div>
        ${data.agentInternal.map(grp => html`<div class="sch-internal-group" key=${grp.gaii}>
          <div class="sch-internal-agent">${grp.agentName}</div>
          <table class="sch-table"><tbody>
            ${grp.entries.map((e, i) => html`<tr key=${e.id || i}>
              <td>${e.name}${e.purpose && html`<div class="sch-muted">${e.purpose}</div>`}</td>
              <td><code class="sch-cron">${e.cron || e.schedule || '—'}</code>${e.timezone && html`<div class="sch-muted">${e.timezone}</div>`}</td>
              <td>${e.status || 'active'}</td>
            </tr>`)}
          </tbody></table>
        </div>`)}
      </div>`}
    </div>`;
}

// ── Create form (exported so the agent Schedules sub-tab can reuse it) ──────
export function CreateForm({ agents = [], showToast, onCreated, lockedAgent }) {
  const [kind, setKind] = useState(lockedAgent ? 'agent_task' : 'ai');
  const [preset, setPreset] = useState('morning');
  const [form, setForm] = useState({
    display_name: '', cron: '0 7 * * *', timezone: '', purpose: '',
    agent_name: lockedAgent || '', prompt: '', input_keys: '', output_key: '',
    task_title: '', task_description: '', extension_name: '', action_id: '',
  });
  const [maxRuns, setMaxRuns] = useState({ enabled: false, limit: 7 });
  const [dailyLimit, setDailyLimit] = useState({ enabled: false, limit: 1 });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const onPreset = (p) => { setPreset(p); const found = CRON_PRESETS.find(c => c.key === p); if (found && found.cron) set('cron', found.cron); };

  const buildConstraints = () => {
    const c = [];
    if (maxRuns.enabled) c.push({ type: 'max_runs', enabled: true, params: { limit: Number(maxRuns.limit) } });
    if (dailyLimit.enabled) c.push({ type: 'daily_limit', enabled: true, params: { limit: Number(dailyLimit.limit) } });
    return c;
  };

  const submit = async () => {
    if (!form.display_name.trim()) { showToast?.(t('profile.scheduler.err.name'), true); return; }
    if (!form.cron.trim()) { showToast?.(t('profile.scheduler.err.cron'), true); return; }
    const body = {
      kind, cron: form.cron.trim(), display_name: form.display_name.trim(),
      timezone: form.timezone.trim() || undefined, purpose: form.purpose.trim() || undefined,
      constraints: buildConstraints(),
    };
    if (kind === 'ai') {
      if (!form.prompt.trim()) { showToast?.(t('profile.scheduler.err.prompt'), true); return; }
      body.prompt = form.prompt.trim();
      body.input_keys = form.input_keys.split(',').map(s => s.trim()).filter(Boolean);
      if (form.output_key.trim()) body.output_key = form.output_key.trim();
      if (form.agent_name) body.agent_name = form.agent_name;
    } else if (kind === 'agent_task') {
      if (!form.agent_name) { showToast?.(t('profile.scheduler.err.agent'), true); return; }
      if (!form.task_title.trim()) { showToast?.(t('profile.scheduler.err.taskTitle'), true); return; }
      body.agent_name = form.agent_name;
      body.task_template = { title: form.task_title.trim(), description: form.task_description.trim() };
    } else if (kind === 'extension') {
      if (!form.extension_name.trim() || !form.action_id.trim()) { showToast?.(t('profile.scheduler.err.ext'), true); return; }
      body.extension_name = form.extension_name.trim();
      body.action_id = form.action_id.trim();
      if (form.agent_name) body.agent_name = form.agent_name;
    }
    setSaving(true);
    try {
      await createSchedule(body);
      showToast?.(t('profile.scheduler.created'));
      onCreated?.();
    } catch (e) { showToast?.(e.message, true); }
    finally { setSaving(false); }
  };

  return html`
    <div class="sch-form">
      <div class="sch-form-row">
        <label>${t('profile.scheduler.field.kind')}</label>
        <select value=${kind} onChange=${e => setKind(e.target.value)}>
          <option value="ai">${t('profile.scheduler.kind.ai')} — ${t('profile.scheduler.kindHint.ai')}</option>
          <option value="agent_task">${t('profile.scheduler.kind.agent_task')} — ${t('profile.scheduler.kindHint.agent_task')}</option>
          <option value="extension">${t('profile.scheduler.kind.extension')} — ${t('profile.scheduler.kindHint.extension')}</option>
        </select>
      </div>

      <div class="sch-form-row">
        <label>${t('profile.scheduler.field.displayName')}</label>
        <input type="text" value=${form.display_name} onInput=${e => set('display_name', e.target.value)}
          placeholder=${t('profile.scheduler.ph.displayName')} />
      </div>

      <div class="sch-form-row">
        <label>${t('profile.scheduler.field.schedule')}</label>
        <div class="sch-presets">
          ${CRON_PRESETS.map(p => html`<button type="button"
            class="sch-preset ${preset === p.key ? 'sch-preset--on' : ''}"
            onClick=${() => onPreset(p.key)}>${t('profile.scheduler.preset.' + p.key)}</button>`)}
        </div>
        <input type="text" class="sch-cron-input" value=${form.cron} onInput=${e => set('cron', e.target.value)}
          placeholder="0 7 * * *" />
        <input type="text" value=${form.timezone} onInput=${e => set('timezone', e.target.value)}
          placeholder=${t('profile.scheduler.ph.timezone')} />
      </div>

      ${kind === 'ai' && html`<div class="sch-kind-fields">
        <div class="sch-form-row"><label>${t('profile.scheduler.field.inputKeys')}</label>
          <input type="text" value=${form.input_keys} onInput=${e => set('input_keys', e.target.value)}
            placeholder=${t('profile.scheduler.ph.inputKeys')} /></div>
        <div class="sch-form-row"><label>${t('profile.scheduler.field.prompt')}</label>
          <textarea rows="3" value=${form.prompt} onInput=${e => set('prompt', e.target.value)}
            placeholder=${t('profile.scheduler.ph.prompt')}></textarea></div>
        <div class="sch-form-row"><label>${t('profile.scheduler.field.outputKey')}</label>
          <input type="text" value=${form.output_key} onInput=${e => set('output_key', e.target.value)}
            placeholder=${t('profile.scheduler.ph.outputKey')} /></div>
      </div>`}

      ${kind === 'agent_task' && html`<div class="sch-kind-fields">
        <div class="sch-form-row"><label>${t('profile.scheduler.field.agent')}</label>
          ${lockedAgent
            ? html`<input type="text" value=${lockedAgent} disabled />`
            : html`<select value=${form.agent_name} onChange=${e => set('agent_name', e.target.value)}>
                <option value="">${t('profile.scheduler.ph.agent')}</option>
                ${agents.map(a => html`<option value=${a.name}>${a.name}</option>`)}
              </select>`}</div>
        <div class="sch-form-row"><label>${t('profile.scheduler.field.taskTitle')}</label>
          <input type="text" value=${form.task_title} onInput=${e => set('task_title', e.target.value)} /></div>
        <div class="sch-form-row"><label>${t('profile.scheduler.field.taskDescription')}</label>
          <textarea rows="3" value=${form.task_description} onInput=${e => set('task_description', e.target.value)}></textarea></div>
      </div>`}

      ${kind === 'extension' && html`<div class="sch-kind-fields">
        <div class="sch-form-row"><label>${t('profile.scheduler.field.extensionName')}</label>
          <input type="text" value=${form.extension_name} onInput=${e => set('extension_name', e.target.value)} /></div>
        <div class="sch-form-row"><label>${t('profile.scheduler.field.actionId')}</label>
          <input type="text" value=${form.action_id} onInput=${e => set('action_id', e.target.value)} /></div>
      </div>`}

      <div class="sch-form-row">
        <label>${t('profile.scheduler.field.purpose')}</label>
        <input type="text" value=${form.purpose} onInput=${e => set('purpose', e.target.value)}
          placeholder=${t('profile.scheduler.ph.purpose')} />
      </div>

      <div class="sch-constraints">
        <div class="sch-constraints-title">${t('profile.scheduler.constraints')}</div>
        <label class="sch-check">
          <input type="checkbox" checked=${maxRuns.enabled} onChange=${e => setMaxRuns(s => ({ ...s, enabled: e.target.checked }))} />
          ${t('profile.scheduler.maxRuns')}
          <input type="number" min="1" value=${maxRuns.limit} disabled=${!maxRuns.enabled}
            onInput=${e => setMaxRuns(s => ({ ...s, limit: e.target.value }))} class="sch-num" />
        </label>
        <label class="sch-check">
          <input type="checkbox" checked=${dailyLimit.enabled} onChange=${e => setDailyLimit(s => ({ ...s, enabled: e.target.checked }))} />
          ${t('profile.scheduler.dailyLimit')}
          <input type="number" min="0" step="0.1" value=${dailyLimit.limit} disabled=${!dailyLimit.enabled}
            onInput=${e => setDailyLimit(s => ({ ...s, limit: e.target.value }))} class="sch-num" />
        </label>
      </div>

      <div class="sch-form-actions">
        <button class="btn-primary" disabled=${saving} onClick=${submit}>
          ${saving ? t('profile.scheduler.saving') : t('profile.scheduler.create')}
        </button>
      </div>
    </div>`;
}
