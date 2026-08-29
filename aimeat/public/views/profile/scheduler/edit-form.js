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
 *   v1.0.0 — 2026-08-30 — Extracted from schedule-item.js v1.2.0; no behaviour change.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { updateSchedule } from '/js/services/schedules.js';

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
    <div class="sch-edit">
      <div class="sch-form-row"><label>${t('profile.scheduler.field.displayName')}</label>
        <input type="text" value=${f.display_name} onInput=${e => set('display_name', e.target.value)} /></div>
      <div class="sch-form-row"><label>${t('profile.scheduler.field.schedule')} (cron)</label>
        <input type="text" class="sch-cron-input" value=${f.cron} onInput=${e => set('cron', e.target.value)} placeholder="0 7 * * *" /></div>
      <div class="sch-form-row"><label>${t('profile.scheduler.ph.timezone')}</label>
        <input type="text" value=${f.timezone} onInput=${e => set('timezone', e.target.value)} placeholder="Europe/Helsinki" /></div>

      ${s.type === 'agent_task' && html`
        <div class="sch-form-row"><label>${t('profile.scheduler.field.taskTitle')}</label>
          <input type="text" value=${f.task_title} onInput=${e => set('task_title', e.target.value)} /></div>
        <div class="sch-form-row"><label>${t('profile.scheduler.field.taskDescription')}</label>
          <textarea rows="3" value=${f.task_description} onInput=${e => set('task_description', e.target.value)}></textarea></div>
      `}
      ${s.type === 'ai' && html`
        <div class="sch-form-row"><label>${t('profile.scheduler.field.inputKeys')}</label>
          <input type="text" value=${f.input_keys} onInput=${e => set('input_keys', e.target.value)} placeholder=${t('profile.scheduler.ph.inputKeys')} /></div>
        <div class="sch-form-row"><label>${t('profile.scheduler.field.prompt')}</label>
          <textarea rows="3" value=${f.prompt} onInput=${e => set('prompt', e.target.value)}></textarea></div>
        <div class="sch-form-row"><label>${t('profile.scheduler.field.outputKey')}</label>
          <input type="text" value=${f.output_key} onInput=${e => set('output_key', e.target.value)} placeholder=${t('profile.scheduler.ph.outputKey')} /></div>
      `}

      <div class="sch-form-row"><label>${t('profile.scheduler.field.purpose')}</label>
        <input type="text" value=${f.purpose} onInput=${e => set('purpose', e.target.value)} /></div>

      <div class="sch-form-actions">
        <button class="btn-primary btn-sm" disabled=${busy} onClick=${onSave}>${busy ? t('profile.scheduler.saving') : t('profile.scheduler.save')}</button>
        <button class="btn-outline btn-sm" disabled=${busy} onClick=${onClose}>${t('profile.scheduler.close')}</button>
      </div>
    </div>`;
}
