/**
 * @file public/views/profile/scheduler/edit-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The inline editor for one managed schedule: name, cron, timezone, purpose and the
 *   kind-specific payload (an agent task's title and description, an AI job's prompt and keys).
 *   Saves with PATCH and tells the caller. Extracted from schedule-item.js so the schedule's own
 *   page and the old card edit through the same form.
 * @structure ScheduleEditForm
 * @usage <${ScheduleEditForm} schedule=${s} showToast=${showToast} onSaved=${reload} onClose=${close} />
 * @version-history
 *   v1.7.0 — 2026-09-26 — The form is the Field family (Fields, TextField and TextArea with their labels, FormActions at the right) and the Action family; it writes no class (page group G5).
 *   v1.6.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.5.0 — 2026-09-25 — The last labels over a field or a group wear .poster-label: the classic AI settings, the presence dialog, the scope groups, the ecosystem's trigger and sample, the scheduler's edit form, P&L's fields, the task runner's name; a place keeps its layout (Jouni's decision "Row label", a unification).
 *   v1.4.0 — 2026-09-25 — Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.3.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   v1.0.0 — 2026-08-30 — Extracted from schedule-item.js v1.2.0; no behaviour change.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { updateSchedule } from '/js/services/schedules.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Action, Loud } from '/components/Action.js';

const html = htm.bind(h);

export function ScheduleEditForm({ schedule: s, showToast, onSaved, onClose }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(() => {
    const c = s.input || {};
    const tmpl = c.taskTemplate || {};
    return {
      display_name: s.displayName || '', cron: s.cron || '', timezone: s.timezone || '', purpose: s.purpose || '',
      task_title: tmpl.title || '', task_description: tmpl.description || '',
      prompt: c.prompt || '', input_keys: (c.inputKeys || []).join(', '), output_key: c.outputKey || '',
    };
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const onSave = async () => {
    const patch = {
      display_name: f.display_name.trim(), cron: f.cron.trim(),
      timezone: f.timezone.trim() || undefined, purpose: f.purpose.trim() || undefined,
    };
    if (s.type === 'agent_task') {
      patch.input = { ...(s.input || {}), taskTemplate: { title: f.task_title.trim(), description: f.task_description.trim() } };
    } else if (s.type === 'ai') {
      patch.input = {
        ...(s.input || {}),
        prompt: f.prompt.trim(),
        inputKeys: f.input_keys.split(',').map(x => x.trim()).filter(Boolean),
        outputKey: f.output_key.trim() || undefined,
      };
    }
    setBusy(true);
    try { await updateSchedule(s.id, patch); showToast?.(t('profile.scheduler.saved')); onSaved?.(); }
    catch (e) { showToast?.(e.message, true); }
    finally { setBusy(false); }
  };

  return html`
    <${Fields}>
      <${TextField} label=${t('profile.scheduler.field.displayName')} value=${f.display_name} onInput=${v => set('display_name', v)} />
      <${TextField} label=${`${t('profile.scheduler.field.schedule')} (cron)`} value=${f.cron} onInput=${v => set('cron', v)} placeholder="0 7 * * *" />
      <${TextField} label=${t('profile.scheduler.ph.timezone')} value=${f.timezone} onInput=${v => set('timezone', v)} placeholder="Europe/Helsinki" />

      ${s.type === 'agent_task' && html`
        <${TextField} label=${t('profile.scheduler.field.taskTitle')} value=${f.task_title} onInput=${v => set('task_title', v)} />
        <${TextArea} label=${t('profile.scheduler.field.taskDescription')} rows=${3} value=${f.task_description} onInput=${v => set('task_description', v)} />
      `}
      ${s.type === 'ai' && html`
        <${TextField} label=${t('profile.scheduler.field.inputKeys')} value=${f.input_keys} onInput=${v => set('input_keys', v)} placeholder=${t('profile.scheduler.ph.inputKeys')} />
        <${TextArea} label=${t('profile.scheduler.field.prompt')} rows=${3} value=${f.prompt} onInput=${v => set('prompt', v)} />
        <${TextField} label=${t('profile.scheduler.field.outputKey')} value=${f.output_key} onInput=${v => set('output_key', v)} placeholder=${t('profile.scheduler.ph.outputKey')} />
      `}

      <${TextField} label=${t('profile.scheduler.field.purpose')} value=${f.purpose} onInput=${v => set('purpose', v)} />

      <${FormActions} end>
        <${Loud} control disabled=${busy} onClick=${onSave}>${busy ? t('profile.scheduler.saving') : t('profile.scheduler.save')}<//>
        <${Action} small disabled=${busy} onClick=${onClose}>${t('profile.scheduler.close')}<//>
      <//>
    <//>`;
}
