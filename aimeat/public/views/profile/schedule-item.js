/**
 * @file schedule-item.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared, editable card for one managed schedule — used by both the
 *   Profile › Scheduler master view and the per-agent Schedules sub-tab. Shows the
 *   schedule meta (kind, cron, timezone, agent, last/next run, runs), the full
 *   "what it dispatches each run" content on its own row (agent_task title+desc,
 *   ai prompt+keys, or extension action), and an inline editor (cron, name,
 *   timezone, purpose + the kind-specific payload). Handles pause/resume, run-now,
 *   edit (PATCH), and cancel itself; calls onChanged() to let the parent refetch.
 * @version-history
 *   v1.3.0 — 2026-08-30 — The inline editor moved to scheduler/edit-form.js (ScheduleEditForm) so the
 *     schedule's own page in the poster face edits through the same form; scheduleIo and
 *     describeDispatch are exported for that page. No behaviour change on the card.
 *   2026-08-25 — What a job READS and WRITES, as two named facts on the card. They were carried
 *     all along and shown only inside the edit form, appended to the prompt as an unlabelled arrow.
 *   v1.0.0 -- 2026-06-03 -- Initial editable schedule card
 *   v1.1.0 -- 2026-06-05 -- "Run now" reads the trigger outcome and reports it:
 *     a warning toast when no task was created (a previous run is still active,
 *     or a run limit was reached) instead of a misleading "started" success.
 *   v1.2.0 -- 2026-07-03 -- Card root gets id="sch-card-{id}" so the Scheduler calendar
 *     can scroll to + flash this card when its event is clicked (jumpToSchedule).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { setScheduleEnabled, triggerSchedule, deleteSchedule } from '/js/services/schedules.js';
import { ScheduleEditForm } from './scheduler/edit-form.js';

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

/**
 * What an `ai` schedule reads and writes, as two named facts.
 *
 * Only this kind: an `agent_task` writes through the agent, so its map is the agent's, and an
 * `extension` writes into its own namespace, so its map is the extension's. Inventing a third answer
 * to one question is how three surfaces end up disagreeing.
 */
export function scheduleIo(s, t) {
  if (s.type !== 'ai') return null;
  const c = s.input || {};
  const reads = (c.inputKeys || []).join(', ');
  return {
    reads: reads || t('profile.scheduler.readsNothing'),
    writes: c.outputKey || t('profile.scheduler.autoKey'),
  };
}

/** What a schedule produces each fire (title + body) for display. */
export function describeDispatch(s) {
  if (s.type === 'agent_task') {
    const tmpl = (s.input && s.input.taskTemplate) || {};
    return { title: tmpl.title || '', body: tmpl.description || '' };
  }
  if (s.type === 'ai') {
    // The keys used to be appended to the prompt as an unlabelled arrow, which reads as part of the
    // prompt. They are their own block now — see scheduleIo below.
    return { title: (s.input || {}).prompt || '', body: '' };
  }
  if (s.type === 'extension') {
    return { title: `${s.extensionName || ''}${s.actionId ? ' / ' + s.actionId : ''}`, body: '' };
  }
  return { title: '', body: '' };
}

export default function ScheduleItem({ schedule: s, onChanged, showToast }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const d = describeDispatch(s);

  const io = scheduleIo(s, t);

  return html`
    <div class="sch-card" id=${'sch-card-' + s.id}>
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

      ${/* WHAT IT READS AND WHAT IT WRITES, said in words. An `ai` schedule has carried these all
            along and showed them only inside the edit form, appended to the prompt as an arrow. A
            job that writes into your store every night should say so on its face. */ ''}
      ${io && html`
        <div class="sch-card-io">
          <div><span class="sch-meta-k">${t('profile.scheduler.reads')}:</span> ${io.reads}</div>
          <div><span class="sch-meta-k">${t('profile.scheduler.writes')}:</span> ${io.writes}</div>
        </div>`}

      ${s.purpose && !editing ? html`<div class="sch-muted sch-purpose">${s.purpose}</div>` : null}

      ${editing && html`<${ScheduleEditForm} schedule=${s} showToast=${showToast}
        onSaved=${() => { setEditing(false); onChanged?.(); }} onClose=${() => setEditing(false)} />`}
    </div>`;
}
