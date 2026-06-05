/**
 * @file schedule-item.js
 * @description Shared, editable card for one managed schedule — used by both the
 *   Profile › Scheduler master view and the per-agent Schedules sub-tab. Shows the
 *   schedule meta (kind, cron, timezone, agent, last/next run, runs), the full
 *   "what it dispatches each run" content on its own row (agent_task title+desc,
 *   ai prompt+keys, or extension action), and an inline editor (cron, name,
 *   timezone, purpose + the kind-specific payload). Handles pause/resume, run-now,
 *   edit (PATCH), and cancel itself; calls onChanged() to let the parent refetch.
 * @version-history
 *   v1.0.0 -- 2026-06-03 -- Initial editable schedule card
 *   v1.1.0 -- 2026-06-05 -- "Run now" reads the trigger outcome and reports it:
 *     a warning toast when no task was created (a previous run is still active,
 *     or a run limit was reached) instead of a misleading "started" success.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { setScheduleEnabled, triggerSchedule, deleteSchedule, updateSchedule } from '/js/services/schedules.js';

const html = htm.bind(h);

const KIND_BADGE = {
  ai: 'sch-badge--ai', agent_task: 'sch-badge--agent', extension: 'sch-badge--ext', core: 'sch-badge--core',
};
const KIND_LABEL = {
  ai: 'profile.scheduler.kind.ai', agent_task: 'profile.scheduler.kind.agent_task',
  extension: 'profile.scheduler.kind.extension', core: 'profile.scheduler.kind.core',
};

/** Human "time until" for a future ISO timestamp (e.g. "20h 48min", "45min 30s"). */
export function formatUntil(iso) {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '—';
  if (ms <= 0) return t('profile.scheduler.soon');
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(d + 'd');
  if (h) parts.push(h + 'h');
  if (m) parts.push(m + 'min');
  if (!d && !h) parts.push(sec + 's'); // seconds only when under an hour
  return parts.join(' ') || '0s';
}

/** What a schedule produces each fire (title + body) for display. */
function describeDispatch(s) {
  if (s.type === 'agent_task') {
    const tmpl = (s.input && s.input.taskTemplate) || {};
    return { title: tmpl.title || '', body: tmpl.description || '' };
  }
  if (s.type === 'ai') {
    const c = s.input || {};
    const io = `${(c.inputKeys || []).join(', ') || '—'} → ${c.outputKey || t('profile.scheduler.autoKey')}`;
    return { title: c.prompt || '', body: io };
  }
  if (s.type === 'extension') {
    return { title: `${s.extensionName || ''}${s.actionId ? ' / ' + s.actionId : ''}`, body: '' };
  }
  return { title: '', body: '' };
}

export default function ScheduleItem({ schedule: s, onChanged, showToast }) {
  const [editing, setEditing] = useState(false);
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

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); onChanged?.(); } catch (e) { showToast?.(e.message, true); } finally { setBusy(false); }
  };
  const onToggle = () => run(() => setScheduleEnabled(s.id, !s.enabled));
  // "Run now" surfaces what actually happened: agent_task schedules can decline
  // to create a task (a previous run is still active, or a run limit is reached),
  // which used to look like success. Map the backend outcome to a clear toast.
  const onTrigger = () => run(async () => {
    const res = await triggerSchedule(s.id);
    const d = res?.data || {};
    if (d.outcome === 'created') showToast?.(t('profile.scheduler.runCreated'));
    else if (d.outcome === 'busy') showToast?.(t('profile.scheduler.runBusy'), true);
    else if (d.outcome === 'limited') showToast?.(t('profile.scheduler.runLimited'), true);
    else if (d.outcome === 'error') showToast?.(d.reason || t('profile.scheduler.runError'), true);
    else showToast?.(t('profile.scheduler.triggered')); // 'ran' (ai/extension) or older server
  });
  const onCancel = () => { if (window.confirm(t('profile.scheduler.confirmCancel'))) run(() => deleteSchedule(s.id)); };

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
    try { await updateSchedule(s.id, patch); showToast?.(t('profile.scheduler.saved')); setEditing(false); onChanged?.(); }
    catch (e) { showToast?.(e.message, true); }
    finally { setBusy(false); }
  };

  const d = describeDispatch(s);

  return html`
    <div class="sch-card">
      <div class="sch-card-head">
        <div class="sch-card-title">
          <span class="sch-badge ${KIND_BADGE[s.type] || KIND_BADGE.core}">${t(KIND_LABEL[s.type] || KIND_LABEL.core)}</span>
          <span class="sch-name">${s.displayName || s.name}</span>
          ${s.createdByAgent ? html`<span class="sch-tag">${t('profile.scheduler.byAgent')}</span>` : null}
        </div>
        <div class="sch-actions">
          <button class="btn-ghost sch-btn" disabled=${busy} onClick=${onToggle}>${s.enabled ? t('profile.scheduler.pause') : t('profile.scheduler.resume')}</button>
          <button class="btn-ghost sch-btn" disabled=${busy} onClick=${onTrigger}>${t('profile.scheduler.runNow')}</button>
          <button class="btn-ghost sch-btn" disabled=${busy} onClick=${() => setEditing(e => !e)}>${editing ? t('profile.scheduler.close') : t('profile.scheduler.edit')}</button>
          <button class="btn-danger sch-btn" disabled=${busy} onClick=${onCancel}>${t('profile.scheduler.cancel')}</button>
        </div>
      </div>

      <div class="sch-card-meta">
        <span><span class="sch-meta-k">${t('profile.scheduler.col.cron')}:</span> <code class="sch-cron">${s.cron}</code>${s.timezone ? ' · ' + s.timezone : ''}</span>
        ${s.agentName ? html`<span><span class="sch-meta-k">${t('profile.scheduler.col.agent')}:</span> ${s.agentName}</span>` : null}
        <span><span class="sch-meta-k">${t('profile.scheduler.col.lastRun')}:</span> ${s.lastRunAt ? timeAgo(s.lastRunAt) : t('profile.scheduler.never')}${s.lastRunResult ? html` <span class="sch-badge ${s.lastRunResult === 'error' ? 'sch-badge--err' : 'sch-badge--ok'}">${s.lastRunResult}</span>` : ''}</span>
        <span><span class="sch-meta-k">${t('profile.scheduler.col.nextRun')}:</span> ${s.enabled ? formatUntil(s.nextRunAt) : t('profile.scheduler.paused')}</span>
        <span><span class="sch-meta-k">${t('profile.scheduler.col.runs')}:</span> ${s.runCount ?? 0}</span>
      </div>

      ${(d.title || d.body) && html`
        <div class="sch-card-dispatch">
          <div class="sch-dispatch-label">${t('profile.scheduler.dispatches')}</div>
          ${d.title ? html`<div class="sch-dispatch-title">${d.title}</div>` : null}
          ${d.body ? html`<div class="sch-dispatch-body">${d.body}</div>` : null}
        </div>`}

      ${s.purpose && !editing ? html`<div class="sch-muted sch-purpose">${s.purpose}</div>` : null}

      ${editing && html`
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
            <button class="btn-outline btn-sm" disabled=${busy} onClick=${() => setEditing(false)}>${t('profile.scheduler.close')}</button>
          </div>
        </div>`}
    </div>`;
}
