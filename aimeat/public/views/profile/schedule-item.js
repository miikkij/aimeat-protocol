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
 *   v1.14.0 — 2026-09-26 — The row is the List's Row (its name, words and doors cells, the edit form in its opened panel; the anchor id sch-card-{id} on the first cell), the kind and by-agent tags the Mark, the facts a wrapping Row, what it sends the JobPrompt; the file writes no class (page group G5). Its caller keeps the List around it.
 *   v1.13.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.12.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 — 2026-09-26 — An agent's schedules are the Listing (css/components/listing.css): the kind, name and by-agent tags in the name cell, the facts, the copy box and the purpose in the words cell, the actions in the doors, the edit form the open panel; the classic card's rules go (a unification: the look most tabs use).
 *   v1.10.0 — 2026-09-25 — A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.9.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.8.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.7.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.5.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.4.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
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
import { duration } from '/js/format.js';
import { setScheduleEnabled, triggerSchedule, deleteSchedule } from '/js/services/schedules.js';
import { ScheduleEditForm } from './scheduler/edit-form.js';
import { Row, Name, Desc, Doors } from '/components/List.js';
import { Row as LRow, Stack } from '/components/Layout.js';
import { Action } from '/components/Action.js';
import { Mark, Code } from '/components/Mark.js';
import { JobPrompt } from '/components/JobPrompt.js';

const html = htm.bind(h);

const KIND_LABEL = {
  ai: 'profile.scheduler.kind.ai', agent_task: 'profile.scheduler.kind.agent_task',
  extension: 'profile.scheduler.kind.extension', core: 'profile.scheduler.kind.core',
};

/**
 * Human "time until" for a future ISO timestamp — "20t 48min", "45min 30s" — in the reader's words.
 *
 * `max: 2` keeps the old shape: the two biggest units and no more, so a countdown three days out
 * does not also spell its minutes. Under an hour that is minutes and seconds, which is what the
 * hand-built version special-cased and what falling out of the unit list gives for free.
 */
export function formatUntil(iso) {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '—';
  if (ms <= 0) return t('profile.scheduler.soon');
  return duration(ms, { max: 2 });
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
    <${Row} id=${'sch-card-' + s.id} open=${editing}
      panel=${html`<${ScheduleEditForm} schedule=${s} showToast=${showToast}
        onSaved=${() => { setEditing(false); onChanged?.(); }} onClose=${() => setEditing(false)} />`}>
      <${Name} before=${html`<${Mark}>${t(KIND_LABEL[s.type] || KIND_LABEL.core)}<//>`}
        tag=${s.createdByAgent ? html`<${Mark} tone="coral">${t('profile.scheduler.byAgent')}<//>` : null}>${s.displayName || s.name}<//>
      <${Desc}>
        <${Stack}>
          <${LRow} wrap gap="medium">
            <span>${t('profile.scheduler.col.cron')}: <${Code}>${s.cron}<//>${s.timezone ? ' · ' + s.timezone : ''}</span>
            ${s.agentName ? html`<span>${t('profile.scheduler.col.agent')}: ${s.agentName}</span>` : null}
            <span>${t('profile.scheduler.col.lastRun')}: ${s.lastRunAt ? timeAgo(s.lastRunAt) : t('profile.scheduler.never')}${s.lastRunResult ? html` <${Mark} kind="status" tone=${s.lastRunResult === 'error' ? 'danger' : 'fine'}>${s.lastRunResult}<//>` : ''}</span>
            <span>${t('profile.scheduler.col.nextRun')}: ${s.enabled ? formatUntil(s.nextRunAt) : t('profile.scheduler.paused')}</span>
            <span>${t('profile.scheduler.col.runs')}: ${s.runCount ?? 0}</span>
          <//>

          <${JobPrompt} label=${t('profile.scheduler.dispatches')} title=${d.title} body=${d.body} />

          ${/* WHAT IT READS AND WHAT IT WRITES, said in words. An `ai` schedule has carried these all
                along and showed them only inside the edit form, appended to the prompt as an arrow. A
                job that writes into your store every night should say so on its face. */ ''}
          ${io && html`
            <${LRow} wrap gap="large">
              <span>${t('profile.scheduler.reads')}: ${io.reads}</span>
              <span>${t('profile.scheduler.writes')}: ${io.writes}</span>
            <//>`}

          ${s.purpose && !editing ? html`<span>${s.purpose}</span>` : null}
        <//>
      <//>
      <${Doors}>
        <${Action} small row disabled=${busy} onClick=${onToggle}>${s.enabled ? t('profile.scheduler.pause') : t('profile.scheduler.resume')}<//>
        <${Action} small row disabled=${busy} onClick=${onTrigger}>${t('profile.scheduler.runNow')}<//>
        <${Action} small row disabled=${busy} expanded=${editing} onClick=${() => setEditing(e => !e)}>${editing ? t('profile.scheduler.close') : t('profile.scheduler.edit')}<//>
        <${Action} small row tone="danger" disabled=${busy} onClick=${onCancel}>${t('profile.scheduler.cancel')}<//>
      <//>
    <//>`;
}
