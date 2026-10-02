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
 *   v2.15.0 -- 2026-10-02 -- The daily AI spend limit shows, and goes into the request, only for the AI kind: the server checks it on no other kind (src/services/schedule-constraints.ts).
 *   v2.14.0 -- 2026-10-02 -- The question marks that explain the schedule and its limits: schedule.cron, schedule.timezone on their TextFields, schedule.max_runs, schedule.daily_limit on their Checks (components/HelpTip.js).
 *   v2.13.0 --2026-09-26 -- The form is the Field family (page group G5): who does it is the boxed Choice, the cadences the Choice's filter tone, each field a TextField, TextArea or Select with its row label over it (the label beside the field, .sc-form-k, becomes the label over it, as on every other form), the limits the Check with its number field, the foot FormActions; it writes no class. The agent picker keeps its first "choose" line (Select placeholder).
 *   v2.12.0 -- 2026-09-26 -- The run limits beside their check boxes are the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v2.11.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.10.0 -- 2026-09-26 -- A grey line that explains is the Hint (.poster-hint); the rule that drew it here goes and its place stays (a unification: the look most tabs use).
 *   v2.9.0 -- 2026-09-25 -- A road or an option you choose is the Choice tile (.poster-choice), a unification: the look most tabs use.
 *   v2.8.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v2.7.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v2.6.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v2.5.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v2.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v2.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v2.2.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
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
import { cronWords, timeOfCron, withTime } from './cron-words.js';
import { resolvedTimeZone } from '/js/display-prefs.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Choice } from '/components/Choice.js';
import { Row, Stack, Split } from '/components/Layout.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';

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
    // The server checks daily_limit only on an ai-kind fire (schedule-constraints.ts), so the
    // form offers and sends it only for that kind.
    if (kind === 'ai' && dailyLimit.enabled) out.push({ type: 'daily_limit', enabled: true, params: { limit: Number(dailyLimit.limit) } });
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

  return html`
    <${Fields}>
      <${Choice} boxed cols=${3} label=${c('kWho')} value=${kind} onChange=${(k) => setKind(k)}
        options=${KINDS.map(k => ({ value: k, label: t('profile.scheduler.kind.' + k), hint: t('profile.scheduler.kindHint.' + k) }))} />

      <${TextField} label=${t('profile.scheduler.field.displayName')} value=${form.display_name} onInput=${v => set('display_name', v)} placeholder=${t('profile.scheduler.ph.displayName')} />

      <${Field} label=${c('kWhen')} hint=${c('kWhenSub')} group>
        <${Stack}>
          <${Choice} tone="filter" ariaLabel=${c('kWhen')} value=${preset} onChange=${(p) => onPreset(p)}
            options=${CRON_PRESETS.map(p => ({ value: p.key, label: t('profile.scheduler.preset.' + p.key) }))} />
          <${Row} wrap gap="large" align="end">
            <${TextField} type="time" size="short" label=${c('kTime')} value=${time} disabled=${!time} onInput=${(v) => onTime(v)} />
            <${TextField} label=${c('kZone')} help="schedule.timezone" value=${form.timezone} onInput=${v => set('timezone', v)} placeholder=${t('profile.scheduler.ph.timezone')} />
            <${TextField} code label=${c('kCron')} help="schedule.cron" value=${form.cron} onInput=${v => { set('cron', v); setPreset('custom'); }} placeholder="0 7 * * *" />
          <//>
          ${words && words !== form.cron ? html`<${Note}>${words}${form.timezone ? ` · ${form.timezone}` : ''}<//>` : null}
        <//>
      <//>

      ${kind === 'ai' && html`
        <${TextArea} label=${t('profile.scheduler.field.prompt')} rows=${4} value=${form.prompt} onInput=${v => set('prompt', v)} placeholder=${t('profile.scheduler.ph.prompt')} />
        <${TextField} label=${t('profile.scheduler.reads')} hint=${t('profile.scheduler.field.inputKeys')} value=${form.input_keys} onInput=${v => set('input_keys', v)} placeholder=${t('profile.scheduler.ph.inputKeys')} />
        <${TextField} label=${t('profile.scheduler.writes')} hint=${t('profile.scheduler.field.outputKey')} value=${form.output_key} onInput=${v => set('output_key', v)} placeholder=${t('profile.scheduler.ph.outputKey')} />`}

      ${kind === 'agent_task' && html`
        ${lockedAgent
          ? html`<${TextField} label=${t('profile.scheduler.field.agent')} value=${lockedAgent} disabled />`
          : html`<${Select} label=${t('profile.scheduler.field.agent')} value=${form.agent_name} onChange=${v => set('agent_name', v)}
              placeholder=${t('profile.scheduler.ph.agent')} options=${agents.map(a => [a.name, a.name])} />`}
        <${TextField} label=${t('profile.scheduler.field.taskTitle')} value=${form.task_title} onInput=${v => set('task_title', v)} />
        <${TextArea} label=${t('profile.scheduler.field.taskDescription')} rows=${4} value=${form.task_description} onInput=${v => set('task_description', v)} />`}

      ${kind === 'extension' && html`
        <${TextField} label=${t('profile.scheduler.field.extensionName')} value=${form.extension_name} onInput=${v => set('extension_name', v)} />
        <${TextField} label=${t('profile.scheduler.field.actionId')} value=${form.action_id} onInput=${v => set('action_id', v)} />`}

      <${TextField} label=${t('profile.scheduler.field.purpose')} value=${form.purpose} onInput=${v => set('purpose', v)} placeholder=${t('profile.scheduler.ph.purpose')} />

      <${Field} label=${t('profile.scheduler.constraints')} group>
        <${Row} wrap gap="large">
          <${Check} checked=${maxRuns.enabled} help="schedule.max_runs" onChange=${on => setMaxRuns(s => ({ ...s, enabled: on }))}>
            ${t('profile.scheduler.maxRuns')}
            <${TextField} type="number" size="short" min="1" value=${maxRuns.limit} disabled=${!maxRuns.enabled} ariaLabel=${t('profile.scheduler.maxRuns')} onInput=${v => setMaxRuns(s => ({ ...s, limit: v }))} />
          <//>
          ${kind === 'ai' ? html`<${Check} checked=${dailyLimit.enabled} help="schedule.daily_limit" onChange=${on => setDailyLimit(s => ({ ...s, enabled: on }))}>
            ${t('profile.scheduler.dailyLimit')}
            <${TextField} type="number" size="short" min="0" step="0.1" value=${dailyLimit.limit} disabled=${!dailyLimit.enabled} ariaLabel=${t('profile.scheduler.dailyLimit')} onInput=${v => setDailyLimit(s => ({ ...s, limit: v }))} />
          <//>` : null}
        <//>
      <//>

      <${Split} heavy above="none" pad="large">
        <${FormActions}>
          <${Loud} control disabled=${saving} onClick=${submit}>${saving ? t('profile.scheduler.saving') : t('profile.scheduler.create')}<//>
          ${onCancel ? html`<${Action} small soft onClick=${onCancel}>${t('profile.scheduler.close')}<//>` : null}
        <//>
      <//>
    <//>`;
}
