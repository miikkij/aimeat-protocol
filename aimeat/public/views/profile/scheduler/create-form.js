/**
 * @file public/views/profile/scheduler/create-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The new-schedule form in the poster face: who does it (three choices in words), a
 *   name, when (ready-made cadences, a time field, the time zone, and the cron beside them as
 *   evidence, with the cadence read back in words), then the fields the chosen kind needs, the
 *   purpose and the optional limits. Submits exactly what the old form submitted. Used by the
 *   scheduler's own "New schedule" page and by an agent's Schedules sub-tab (with the agent locked).
 * @structure CRON_PRESETS · CreateForm
 * @usage <${CreateForm} agents=${agents} showToast=${showToast} onCreated=${reload} lockedAgent=${name} />
 * @version-history
 *   v2.2.0 -- 2026-09-22 -- Composed from the shared component set (Field, ListRow for the three
 *     choices, Action tabs for the cadences, Columns, Stack); no own CSS. The request body and every
 *     label are unchanged.
 *   v2.1.0 -- 2026-09-13 -- V2: use the shared ink rule on the form action row.
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
import { Stack, Columns, Field, ListRow, Action, Text } from '/components/poster-parts.js';
import { cronWords, timeOfCron, withTime } from './cron-words.js';
import { resolvedTimeZone } from '/js/display-prefs.js';

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
  // The zone starts as the CREATOR'S OWN, because "every day at seven" means seven where the
  // person saying it is. Left empty it went to the server unset, the cron then ran on whatever the
  // node's process zone happened to be, and nothing anywhere could say which zone the hour belonged
  // to: a reader on another clock saw "Mon at 23:00" beside a run the same screen called Tuesday
  // 05:00, with nothing to reconcile them. It is still a plain field and still editable.
  const [form, setForm] = useState({
    display_name: '', cron: '0 7 * * *', timezone: resolvedTimeZone(), purpose: '',
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

  const field = (key, label, extra = {}) => html`<${Field} label=${label} value=${form[key]} onInput=${e => set(key, e.target.value)} ...${extra} />`;

  return html`<${Stack} density="roomy">
    <${Stack} density="compact">
      <${Text} kind="label">${c('kWho')}<//>
      ${KINDS.map(k => html`<${ListRow} key=${k} density="compact" selected=${kind === k} onOpen=${() => setKind(k)}
        name=${t('profile.scheduler.kind.' + k)} detail=${t('profile.scheduler.kindHint.' + k)} detailKind="text" />`)}
    <//>

    ${field('display_name', t('profile.scheduler.field.displayName'), { placeholder: t('profile.scheduler.ph.displayName') })}

    <${Stack} density="compact">
      <${Text} kind="label">${c('kWhen')}<//>
      <${Text} kind="caption" tone="muted">${c('kWhenSub')}<//>
      <${Stack} direction="wrap" density="compact">
        ${CRON_PRESETS.map(p => html`<${Action} key=${p.key} kind="tab" selected=${preset === p.key} onClick=${() => onPreset(p.key)}>${t('profile.scheduler.preset.' + p.key)}<//>`)}
      <//>
      <${Columns} layout="thirds" collapse="600" density="compact">
        <${Field} type="time" label=${c('kTime')} value=${time} disabled=${!time} onInput=${e => onTime(e.target.value)} />
        ${field('timezone', c('kZone'), { placeholder: t('profile.scheduler.ph.timezone') })}
        <${Field} label=${c('kCron')} value=${form.cron} onInput=${e => { set('cron', e.target.value); setPreset('custom'); }} placeholder="0 7 * * *" />
      <//>
      ${words && words !== form.cron ? html`<${Text} kind="caption" tone="muted">${words}${form.timezone ? ` · ${form.timezone}` : ''}<//>` : null}
    <//>

    ${kind === 'ai' && html`
      ${field('prompt', t('profile.scheduler.field.prompt'), { type: 'textarea', rows: 4, placeholder: t('profile.scheduler.ph.prompt') })}
      ${field('input_keys', t('profile.scheduler.reads'), { hint: t('profile.scheduler.field.inputKeys'), placeholder: t('profile.scheduler.ph.inputKeys') })}
      ${field('output_key', t('profile.scheduler.writes'), { hint: t('profile.scheduler.field.outputKey'), placeholder: t('profile.scheduler.ph.outputKey') })}`}

    ${kind === 'agent_task' && html`
      ${lockedAgent
        ? html`<${Field} label=${t('profile.scheduler.field.agent')} value=${lockedAgent} disabled=${true} />`
        : html`<${Field} type="select" label=${t('profile.scheduler.field.agent')} value=${form.agent_name} onChange=${e => set('agent_name', e.target.value)}
            options=${[{ value: '', label: t('profile.scheduler.ph.agent') }, ...agents.map(a => ({ value: a.name, label: a.name }))]} />`}
      ${field('task_title', t('profile.scheduler.field.taskTitle'))}
      ${field('task_description', t('profile.scheduler.field.taskDescription'), { type: 'textarea', rows: 4 })}`}

    ${kind === 'extension' && html`
      ${field('extension_name', t('profile.scheduler.field.extensionName'))}
      ${field('action_id', t('profile.scheduler.field.actionId'))}`}

    ${field('purpose', t('profile.scheduler.field.purpose'), { placeholder: t('profile.scheduler.ph.purpose') })}

    <${Stack} density="compact">
      <${Text} kind="label">${t('profile.scheduler.constraints')}<//>
      <${Columns} layout="equal" collapse="600" density="compact">
        <${Stack} density="compact">
          <${Field} type="checkbox" label=${t('profile.scheduler.maxRuns')} value=${maxRuns.enabled} onChange=${e => setMaxRuns(s => ({ ...s, enabled: e.target.checked }))} />
          <${Field} type="number" min="1" value=${maxRuns.limit} disabled=${!maxRuns.enabled} onInput=${e => setMaxRuns(s => ({ ...s, limit: e.target.value }))} />
        <//>
        <${Stack} density="compact">
          <${Field} type="checkbox" label=${t('profile.scheduler.dailyLimit')} value=${dailyLimit.enabled} onChange=${e => setDailyLimit(s => ({ ...s, enabled: e.target.checked }))} />
          <${Field} type="number" min="0" step="0.1" value=${dailyLimit.limit} disabled=${!dailyLimit.enabled} onInput=${e => setDailyLimit(s => ({ ...s, limit: e.target.value }))} />
        <//>
      <//>
    <//>

    <${Stack} direction="horizontal" align="start">
      <${Action} kind="primary" disabled=${saving} onClick=${submit}>${saving ? t('profile.scheduler.saving') : t('profile.scheduler.create')}<//>
      ${onCancel ? html`<${Action} onClick=${onCancel}>${t('profile.scheduler.close')}<//>` : null}
    <//>
  <//>`;
}
