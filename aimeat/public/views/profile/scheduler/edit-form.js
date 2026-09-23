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
 *   v1.1.0 -- 2026-09-22 -- Composed from the shared Field, Stack and Action; no own CSS. Same fields, same PATCH.
 *   v1.0.0 — 2026-08-30 — Extracted from schedule-item.js v1.2.0; no behaviour change.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { updateSchedule } from '/js/services/schedules.js';
import { Stack, Field, Action } from '/components/poster-parts.js';

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

  const field = (key, label, extra = {}) => html`<${Field} label=${label} value=${f[key]} onInput=${e => set(key, e.target.value)} ...${extra} />`;
  return html`<${Stack}>
    ${field('display_name', t('profile.scheduler.field.displayName'))}
    ${field('cron', `${t('profile.scheduler.field.schedule')} (cron)`, { placeholder: '0 7 * * *' })}
    ${field('timezone', t('profile.scheduler.ph.timezone'), { placeholder: 'Europe/Helsinki' })}
    ${s.type === 'agent_task' && html`
      ${field('task_title', t('profile.scheduler.field.taskTitle'))}
      ${field('task_description', t('profile.scheduler.field.taskDescription'), { type: 'textarea', rows: 3 })}`}
    ${s.type === 'ai' && html`
      ${field('input_keys', t('profile.scheduler.field.inputKeys'), { placeholder: t('profile.scheduler.ph.inputKeys') })}
      ${field('prompt', t('profile.scheduler.field.prompt'), { type: 'textarea', rows: 3 })}
      ${field('output_key', t('profile.scheduler.field.outputKey'), { placeholder: t('profile.scheduler.ph.outputKey') })}`}
    ${field('purpose', t('profile.scheduler.field.purpose'))}
    <${Stack} direction="horizontal" align="start">
      <${Action} kind="primary" disabled=${busy} onClick=${onSave}>${busy ? t('profile.scheduler.saving') : t('profile.scheduler.save')}<//>
      <${Action} disabled=${busy} onClick=${onClose}>${t('profile.scheduler.close')}<//>
    <//>
  <//>`;
}
