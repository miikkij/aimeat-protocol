/**
 * @file public/views/profile/scheduler/create-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The new-schedule form in the poster face: who does it (three framed choices in words),
 *   a name, when (ready-made cadences as chips, a time field, the time zone, and the cron beside them
 *   as evidence, with the cadence read back in words), then the fields the chosen kind needs, the
 *   purpose and the optional limits. Submits exactly what the old form submitted. Used by the
 *   scheduler's own "New schedule" page and by an agent's Schedules sub-tab (with the agent locked).
 * @structure CRON_PRESETS · CreateForm
 * @usage <${CreateForm} agents=${agents} showToast=${showToast} onCreated=${reload} lockedAgent=${name} />
 * @version-history
 *   v2.0.0 — 2026-08-30 — Moved out of scheduler-tab.js and laid out on the poster face; three new
 *     cadences (weekdays, Mondays, the 1st of the month), a time field that rewrites the cron, and
 *     the cadence read back in words. The request body is unchanged.
 *   v1.0.0 — 2026-06-03 — Initial, inside scheduler-tab.js.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { createSchedule } from '/js/services/schedules.js';
import { cronWords, timeOfCron, withTime } from './cron-words.js';

const html = htm.bind(h);

export const CRON_PRESETS = [
  { key: 'morning', cron: '0 7 * * *' },
  { key: 'evening', cron: '0 19 * * *' },
  { key: 'hourly', cron: '0 * * * *' },
  { key: 'weekdays', cron: '0 7 * * 1-5' },
  { key: 'monday', cron: '0 7 * * 1' },
  { key: 'monthly', cron: '0 5 1 * *' },
  { key: 'custom', cron: '' },
];
const KINDS = ['ai', 'agent_task', 'extension'];
const c = (key, vars) => t('profile.scheduler.cover.' + key, vars);

export function CreateForm({ agents = [], showToast, onCreated, onCancel = null, lockedAgent }) {
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
  const onPreset = (p) => { setPreset(p); const found = CRON_PRESETS.find(x => x.key === p); if (found && found.cron) set('cron', found.cron); };
  const onTime = (hhmm) => set('cron', withTime(form.cron, hhmm));
  const time = timeOfCron(form.cron);
  const words = cronWords(form.cron);

  const buildConstraints = () => {
    const out = [];
    if (maxRuns.enabled) out.push({ type: 'max_runs', enabled: true, params: { limit: Number(maxRuns.limit) } });
    if (dailyLimit.enabled) out.push({ type: 'daily_limit', enabled: true, params: { limit: Number(dailyLimit.limit) } });
    return out;
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

  const row = (label, sub, body) => html`<div class="sc-form-k">${label}${sub ? html`<small>${sub}</small>` : null}</div><div class="sc-form-v">${body}</div>`;

  return html`
    <div class="sc-form sch-form-fields">
      ${row(c('kWho'), null, html`<div class="sc-choices">
        ${KINDS.map(k => html`<button type="button" key=${k} class=${`sc-choice ${kind === k ? 'on' : ''}`} onClick=${() => setKind(k)}>
          <b>${t('profile.scheduler.kind.' + k)}</b>${t('profile.scheduler.kindHint.' + k)}</button>`)}
      </div>`)}

      ${row(t('profile.scheduler.field.displayName'), null, html`<input type="text" value=${form.display_name} onInput=${e => set('display_name', e.target.value)} placeholder=${t('profile.scheduler.ph.displayName')} />`)}

      ${row(c('kWhen'), c('kWhenSub'), html`
        <div class="og-chips sc-cad">
          ${CRON_PRESETS.map(p => html`<button type="button" key=${p.key} class=${`og-chip sc-cad-chip ${preset === p.key ? 'og-chip--sun' : ''}`} onClick=${() => onPreset(p.key)}>${t('profile.scheduler.preset.' + p.key)}</button>`)}
        </div>
        <div class="sc-when">
          <label><span class="sc-label">${c('kTime')}</span><input type="time" value=${time} disabled=${!time} onInput=${e => onTime(e.target.value)} /></label>
          <label><span class="sc-label">${c('kZone')}</span><input type="text" value=${form.timezone} onInput=${e => set('timezone', e.target.value)} placeholder=${t('profile.scheduler.ph.timezone')} /></label>
          <label><span class="sc-label">${c('kCron')}</span><input type="text" class="sch-cron-input" value=${form.cron} onInput=${e => { set('cron', e.target.value); setPreset('custom'); }} placeholder="0 7 * * *" /></label>
        </div>
        ${words && words !== form.cron ? html`<div class="sc-hint">${words}${form.timezone ? ` · ${form.timezone}` : ''}</div>` : null}`)}

      ${kind === 'ai' && html`
        ${row(t('profile.scheduler.field.prompt'), null, html`<textarea rows="4" value=${form.prompt} onInput=${e => set('prompt', e.target.value)} placeholder=${t('profile.scheduler.ph.prompt')}></textarea>`)}
        ${row(t('profile.scheduler.reads'), t('profile.scheduler.field.inputKeys'), html`<input type="text" class="sch-cron-input" value=${form.input_keys} onInput=${e => set('input_keys', e.target.value)} placeholder=${t('profile.scheduler.ph.inputKeys')} />`)}
        ${row(t('profile.scheduler.writes'), t('profile.scheduler.field.outputKey'), html`<input type="text" class="sch-cron-input" value=${form.output_key} onInput=${e => set('output_key', e.target.value)} placeholder=${t('profile.scheduler.ph.outputKey')} />`)}`}

      ${kind === 'agent_task' && html`
        ${row(t('profile.scheduler.field.agent'), null, lockedAgent
          ? html`<input type="text" value=${lockedAgent} disabled />`
          : html`<select value=${form.agent_name} onChange=${e => set('agent_name', e.target.value)}>
              <option value="">${t('profile.scheduler.ph.agent')}</option>
              ${agents.map(a => html`<option value=${a.name} key=${a.name}>${a.name}</option>`)}
            </select>`)}
        ${row(t('profile.scheduler.field.taskTitle'), null, html`<input type="text" value=${form.task_title} onInput=${e => set('task_title', e.target.value)} />`)}
        ${row(t('profile.scheduler.field.taskDescription'), null, html`<textarea rows="4" value=${form.task_description} onInput=${e => set('task_description', e.target.value)}></textarea>`)}`}

      ${kind === 'extension' && html`
        ${row(t('profile.scheduler.field.extensionName'), null, html`<input type="text" value=${form.extension_name} onInput=${e => set('extension_name', e.target.value)} />`)}
        ${row(t('profile.scheduler.field.actionId'), null, html`<input type="text" value=${form.action_id} onInput=${e => set('action_id', e.target.value)} />`)}`}

      ${row(t('profile.scheduler.field.purpose'), null, html`<input type="text" value=${form.purpose} onInput=${e => set('purpose', e.target.value)} placeholder=${t('profile.scheduler.ph.purpose')} />`)}

      ${row(t('profile.scheduler.constraints'), null, html`<div class="sc-limits">
        <label class="sch-check">
          <input type="checkbox" checked=${maxRuns.enabled} onChange=${e => setMaxRuns(s => ({ ...s, enabled: e.target.checked }))} />
          ${t('profile.scheduler.maxRuns')}
          <input type="number" min="1" value=${maxRuns.limit} disabled=${!maxRuns.enabled} onInput=${e => setMaxRuns(s => ({ ...s, limit: e.target.value }))} class="sch-num" />
        </label>
        <label class="sch-check">
          <input type="checkbox" checked=${dailyLimit.enabled} onChange=${e => setDailyLimit(s => ({ ...s, enabled: e.target.checked }))} />
          ${t('profile.scheduler.dailyLimit')}
          <input type="number" min="0" step="0.1" value=${dailyLimit.limit} disabled=${!dailyLimit.enabled} onInput=${e => setDailyLimit(s => ({ ...s, limit: e.target.value }))} class="sch-num" />
        </label>
      </div>`)}

      <div class="sc-form-actions">
        <button type="button" class="og-slab" disabled=${saving} onClick=${submit}>${saving ? t('profile.scheduler.saving') : t('profile.scheduler.create')}</button>
        ${onCancel ? html`<button type="button" class="og-door og-door--quiet" onClick=${onCancel}>${t('profile.scheduler.close')}</button>` : null}
      </div>
    </div>`;
}
