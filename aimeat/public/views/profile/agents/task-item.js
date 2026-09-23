/**
 * @file public/views/profile/agents/task-item.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Single task row for the agent Tasks sub-tab: the closed four-column row (name,
 *   to-do progress, when, status chip) and the opened record with its parts -- to do, what
 *   happened, details, memory entries, rating -- plus the actions row (start, request changes,
 *   triage, cancel, delete). The helpers it is built from live in ./task-item-parts.js.
 * @version-history
 *   v3.0.1 — 2026-09-22 — A blurred title is blurred again (ListRow concealed) instead of replaced by
 *     the task id; the opened title is the small heading; Cancel and Delete carry the danger tone.
 *   v3.0.0 — 2026-09-22 — Composed from the shared component set: the closed row is a ListRow (the
 *     eye as an icon action, progress and age as the mono detail, the status as a Chip, the arrow),
 *     the opened task is a record Surface under the row, to-dos and the event log are ListRows
 *     with markers, details are KeyValue rows, and every button is an Action. The rating shows as
 *     "n / 5" instead of star glyphs, and Keep loses its star. A blurred title shows the task id
 *     until ListRow can conceal a name. No behaviour change.
 *   v2.0.0 — 2026-09-14 — The Tasks tab wears the poster face: agt- markup against
 *     css/views/agent-tasks-poster.css, the record box for an open task, the eye icon in place of
 *     the two emoji, doors and a slab in place of the old button classes. No behaviour change. The
 *     helpers, the request-changes modal and the memory viewer moved to ./task-item-parts.js.
 *   v1.0.1 — 2026-09-13 — The request-changes dialog's actions sit in its footer.
 *   v1.0.0 — 2026-07-13 — Extracted from views/profile/agents-tasks-subtab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t, tOr } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { apiGet, apiPost } from '/js/api.js';
import { deleteTask, startTask, listEvents, requestChanges, rateTask, setTaskTriage } from '/js/services/agent-tasks.js';
import { useConfirm } from '/components/Modal.js';
import { Markdown } from '/components/Markdown.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import RateModal from './rate-modal.js';
import { ListRow, Surface, Stack, Text, Chip, Action, KeyValue } from '/components/poster-parts.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate, time as fmtTime } from '/js/format.js';
import {
  isTaskBlurred,
  setTaskBlurred,
  statusLabel,
  statusChipTone,
  todoMarker,
  formatScopeEntry,
  todoProgress,
  EyeIcon,
  RequestChangesModal,
  TaskMemoryEntry,
} from './task-item-parts.js';

export function TaskItem({ task, agentName, showToast, onRefresh, autoOpen = 0 }) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState(null);
  // Deep-link target: the parent bumps `autoOpen` (a nonce) when this exact task
  // should be opened. taskRef scrolls it into view.
  const taskRef = useRef(null);
  const autoOpenedNonce = useRef(0);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [sendingRevision, setSendingRevision] = useState(false);
  const [showRateModal, setShowRateModal] = useState(false);
  const [sendingRate, setSendingRate] = useState(false);
  const [showOutdated, setShowOutdated] = useState(false);
  // Deliverable preview: null = not requested, {loading}|{notFound}|{value}.
  const [deliverable, setDeliverable] = useState(null);
  // This task's memory entries: null = not requested, {loading}|{items}.
  const [taskMemory, setTaskMemory] = useState(null);
  // Local-only "hide the title" toggle (for screen recordings). Persisted per
  // task ID in localStorage; see the helpers in ./task-item-parts.js.
  const [blurred, setBlurred] = useState(() => isTaskBlurred(task.id));
  const { confirm, ConfirmUI } = useConfirm();

  function handleToggleBlur(e) {
    e.stopPropagation();
    const next = !blurred;
    setBlurred(next);
    setTaskBlurred(task.id, next);
  }

  // Fetch the task's published deliverable from the agent's memory namespace.
  // Uses the owner list endpoint (?agent=<gaii>&prefix=<key>) which returns the
  // value inline; if the exact key is gone, show that it no longer exists.
  async function fetchDeliverable() {
    const gaii = task.agentGaii;
    const key = task.deliverableKey;
    if (!gaii || !key) { setDeliverable({ notFound: true }); return; }
    setDeliverable({ loading: true });
    try {
      const resp = await apiGet(`/v1/memory?agent=${encodeURIComponent(gaii)}&prefix=${encodeURIComponent(key)}&per_page=20`);
      const items = resp?.data?.items || resp?.data || [];
      const found = Array.isArray(items) ? items.find(i => i.key === key) : null;
      if (!found) { setDeliverable({ notFound: true }); return; }
      // Keep the RAW value (string OR object) so the shared image detector can recognise an
      // image deliverable (e.g. { url, mime:"image/*" }); DeliverableBody handles the display.
      setDeliverable({ value: found.value });
    } catch (err) {
      swallowed('task-item: fetchDeliverable', err);
      setDeliverable({ notFound: true });
    }
  }

  // Fetch the memory entries that belong to this task. The canonical handle is
  // the `task:<full-id>` tag (the runner tags every write: deliverable, live,
  // delegated deliverable + evalctx) -- the deliverable key embeds a SHORT id so
  // it can't be matched by key substring, which is exactly why the tag exists.
  // Two extra fallbacks make it robust for tasks written before the tag landed:
  // the live-status key prefix (full id) and the task's own recorded
  // deliverableKey. Rolling/public stats (statistics.custom.*) are NOT per-task
  // tagged, so they never appear here. Deduped by key.
  async function fetchTaskMemory() {
    const gaii = task.agentGaii;
    if (!gaii) { setTaskMemory({ items: [] }); return; }
    setTaskMemory({ loading: true });
    try {
      const tag = `task:${task.id}`;
      const livePrefix = `agents.${agentName}.tasks.${task.id}.`;
      const fetches = [
        apiGet(`/v1/memory?agent=${encodeURIComponent(gaii)}&tags=${encodeURIComponent(tag)}&per_page=50`).catch(err => { swallowed('task-item: fetchTaskMemory', err); return null; }),
        apiGet(`/v1/memory?agent=${encodeURIComponent(gaii)}&prefix=${encodeURIComponent(livePrefix)}&per_page=20`).catch(err => { swallowed('task-item: fetchTaskMemory', err); return null; }),
      ];
      if (task.deliverableKey) {
        fetches.push(apiGet(`/v1/memory?agent=${encodeURIComponent(gaii)}&prefix=${encodeURIComponent(task.deliverableKey)}&per_page=5`).catch(err => { swallowed('task-item: fetchTaskMemory', err); return null; }));
      }
      const results = await Promise.all(fetches);
      const items = [];
      const seen = new Set();
      for (const resp of results) {
        const list = resp?.data?.items || resp?.data || [];
        for (const it of (Array.isArray(list) ? list : [])) {
          if (it.key && !seen.has(it.key)) { seen.add(it.key); items.push(it); }
        }
      }
      setTaskMemory({ items });
    } catch (err) {
      swallowed('task-item: fetchTaskMemory', err);
      setTaskMemory({ items: [] });
    }
  }

  const fetchEvents = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadingEvents(true);
    try {
      const resp = await listEvents(agentName, task.id);
      setEvents(resp?.data?.events || []);
    } catch (err) { swallowed('task-item', err); setEvents([]); }
    if (!silent) setLoadingEvents(false);
  }, [agentName, task.id]);

  async function handleExpand(e) {
    e.stopPropagation();
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (!events) await fetchEvents();
  }

  // While the task card is expanded, refresh its event log when the global
  // live-update signal fires (server-side: agent appends an event, todo flips,
  // status changes, etc.). The parent's loadTasks() refreshes the task itself
  // -- including todos -- via re-render with new props, but events are
  // fetched separately and would otherwise stay stale until the user closes
  // and re-opens the card. Silent fetch so the in-place log doesn't flash a
  // loading state on every tick.
  useEffect(() => {
    if (!expanded) return;
    return onLiveUpdate(['agent-tasks'], () => fetchEvents({ silent: true }));
  }, [expanded, fetchEvents]);

  // Deep-link from the fleet "running now" panel: when autoOpen bumps to a new
  // nonce for this task, expand it, load its events, and scroll it into view.
  useEffect(() => {
    if (!autoOpen || autoOpen === autoOpenedNonce.current) return;
    autoOpenedNonce.current = autoOpen;
    setExpanded(true);
    // Always refresh the event log on a fresh deep-link open (don't gate on the
    // possibly-stale `events` closure — the task's log may have moved on since a
    // previous open).
    fetchEvents();
    requestAnimationFrame(() => {
      taskRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [autoOpen, fetchEvents]);

  async function handleStart(e) {
    e.stopPropagation();
    setStarting(true);
    try {
      await startTask(agentName, task.id);
      showToast(t('profile.agents.tasks.taskStarted'));
      onRefresh();
    } catch (err) {
      showToast(err.message || t('profile.agents.tasks.startError'), true);
    }
    setStarting(false);
  }

  function handleDelete(e) {
    e.stopPropagation();
    confirm(
      t('profile.agents.tasks.deleteConfirm') + ': ' + (task.title || task.id) + '?',
      async () => {
        try {
          await deleteTask(agentName, task.id);
          showToast(t('profile.agents.tasks.taskDeleted'));
          onRefresh();
        } catch (err) {
          showToast(err.message || t('profile.agents.tasks.deleteError'), true);
        }
      },
      { danger: true, confirmLabel: t('profile.agents.tasks.delete') },
    );
  }

  // Cooperative cancel for a running/queued subtask: write an
  // `agents.cancel.task.<id>` marker (owner_scope-visible, so the worker daemon
  // self-skips before its next kickoff) AND, for immediate effect, natively
  // pause an active task. Covers the "coordinator over-delegated; stop the work
  // nobody is waiting for" case.
  function handleCancel(e) {
    e.stopPropagation();
    confirm(
      t('profile.agents.tasks.cancelConfirm') + ': ' + (task.title || task.id) + '?',
      async () => {
        try {
          await apiPost('/v1/memory', { key: 'agents.cancel.task.' + task.id, value: [task.id], visibility: 'owner' });
          // Immediate native stop (owner-only): pause active tasks.
          if (task.status === 'active') {
            try { await apiPost(`/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(task.id)}/pause`, {}); } catch (err) { swallowed('task-item: handleCancel', err); }
          }
          showToast(t('profile.agents.tasks.cancelled'));
          onRefresh();
        } catch (err) {
          showToast(err.message || t('profile.agents.tasks.cancelError'), true);
        }
      },
      { danger: true },
    );
  }

  function handleOpenRevision(e) {
    e.stopPropagation();
    setShowRevisionModal(true);
  }

  function handleOpenRate(e) {
    e.stopPropagation();
    setShowRateModal(true);
  }

  async function handleTriage(e, triage) {
    e.stopPropagation();
    try {
      await setTaskTriage(agentName, task.id, triage);
      showToast(t(triage === 'kept' ? 'profile.agents.tasks.triage.kept'
        : triage === 'archived' ? 'profile.agents.tasks.triage.archived'
        : 'profile.agents.tasks.triage.restored'));
      onRefresh();
    } catch (err) {
      showToast(err.message || t('profile.agents.tasks.triage.error'), true);
    }
  }

  async function handleSubmitRate(body) {
    setSendingRate(true);
    try {
      await rateTask(agentName, task.id, body);
      showToast(t('profile.agents.tasks.rate.success'));
      setShowRateModal(false);
      onRefresh();
    } catch (err) {
      showToast(err.message || t('profile.agents.tasks.rate.error'), true);
    }
    setSendingRate(false);
  }

  async function handleSubmitRevision(message) {
    setSendingRevision(true);
    try {
      await requestChanges(agentName, task.id, message);
      showToast(t('profile.agents.tasks.requestChangesSent'));
      setShowRevisionModal(false);
      onRefresh();
    } catch (err) {
      showToast(err.message || t('profile.agents.tasks.requestChangesError'), true);
    }
    setSendingRevision(false);
  }

  const allTodos = task.todos || [];
  const activeTodos = allTodos.filter(td => td.status !== 'outdated');
  const outdatedTodos = allTodos.filter(td => td.status === 'outdated');
  const todos = activeTodos; // keep existing variable name for downstream render
  const hasTodos = activeTodos.length > 0;
  const progress = todoProgress(allTodos);
  const isQueued = task.status === 'queued' || task.status === 'draft';
  const isRevisionRequested = task.status === 'revision_requested';
  const isActive = task.status === 'active';
  const isDone = task.status === 'done';
  // Any non-active task can be deleted (done/failed/paused/stalled/queued/draft/
  // revision_requested). An active task uses Cancel instead -- the owner stops
  // the running work first, then deletes it. Delete also cleans the task's
  // operational traces server-side (event log, live-status keys, cancel marker).
  const canDelete = !isActive;
  const rating = task.rating;
  const canStart = isQueued && hasTodos;
  const canRequestChanges = task.status === 'queued' && hasTodos;
  const totalMinutes = todos.reduce((sum, td) => sum + (td.estimateMinutes || 0), 0);
  const aimeatSteps = todos.filter(td => td.environment === 'aimeat').length;
  const agentSteps = todos.filter(td => td.environment === 'agent').length;
  const doneTodos = todos.filter(td => td.status === 'done').length;
  const status = task.status || 'draft';
  const hasScope = task.scope && (!Array.isArray(task.scope) || task.scope.length > 0);
  const hasRules = task.rules && task.rules.length > 0;
  const hasDetails = Boolean(task.deliverableKey) || hasScope || hasRules;

  function formatDateTime(iso) {
    if (!iso) return '';
    return fmtDate(iso, { day: 'numeric', month: 'short' }) + ' '
      + fmtTime(iso, { hour: '2-digit', minute: '2-digit' });
  }

  // One mono line: created … · updated … · completed …
  const stamps = [
    task.createdAt && `${t('profile.agents.tasks.created')} ${formatDateTime(task.createdAt)}`,
    task.updatedAt && task.updatedAt !== task.createdAt && `${t('profile.agents.tasks.updated')} ${formatDateTime(task.updatedAt)}`,
    task.completedAt && `${t('profile.agents.tasks.completed')} ${formatDateTime(task.completedAt)}`,
  ].filter(Boolean).join(' · ');

  // The env badges of the old face, as the plan's one mono line: agent 2 · about 5 min
  const planLine = [
    aimeatSteps > 0 && `${t('profile.agents.tasks.envAimeat')} ${aimeatSteps}`,
    agentSteps > 0 && `${t('profile.agents.tasks.envAgent')} ${agentSteps}`,
    totalMinutes > 0 && tOr('profile.agents.tasks.aboutMinutes', 'about {n} min', { n: totalMinutes }),
  ].filter(Boolean).join(' · ');

  // A fresh vnode per call: the closed row and the open record both show the chip at once.
  const statusChip = () => html`<${Chip} tone=${statusChipTone(status)}>${statusLabel(status)}<//>`;
  const stars = Math.max(0, Math.min(5, Math.round(rating?.stars || 0)));
  // The log part only appears once there is a log, a fetch in flight, or a recorded emptiness.
  const showLog = loadingEvents || (events && (events.length > 0 || !isQueued));

  // A part of the opened record: a coral label (with an optional mono note at the right) over its content.
  const part = (label, note, body) => html`<${Stack} density="compact">
    ${note ? html`<${Stack} direction="wrap" align="between" density="compact">
      <${Text} kind="label">${label}<//><${Text} kind="mono" tone="muted">${note}<//>
    <//>` : html`<${Text} kind="label">${label}<//>`}
    ${body}
  <//>`;
  const envWord = (td) => (td.environment === 'aimeat' ? t('profile.agents.tasks.envAimeat') : t('profile.agents.tasks.envAgent'));
  const todoDetail = (td) => [
    td.estimateMinutes && `${td.estimateMinutes} ${t('profile.agents.tasks.minuteShort')}`,
    td.completedAt && formatDateTime(td.completedAt),
  ].filter(Boolean).join(' · ');

  return html`
    <div ref=${taskRef}>
      <${ListRow}
        mark=${html`<${Action} kind="icon" onClick=${handleToggleBlur} selected=${blurred}
          title=${blurred ? t('profile.agents.tasks.unblurTitle') : t('profile.agents.tasks.blurTitle')}><${EyeIcon} hidden=${blurred} /><//>`}
        name=${task.title || task.id} concealed=${blurred}
        onOpen=${handleExpand}
        detail=${[progress, task.createdAt ? timeAgo(task.createdAt) : ''].filter(Boolean).join(' · ')}
        value=${statusChip()}
        arrow=${true}
        selected=${expanded}
        density="compact" />
      ${/* The opened record sits UNDER the row, not in its body: a selected row sets the sun's ink
            as its text colour, and the record inherited it, which left words dark on the dark card
            in the dark theme. */''}
      ${expanded && html`
        <${Surface} kind="record">
          <${Stack}>
          <${Stack} direction="wrap" align="between" density="compact">
            <${Text} kind="heading" size="small">${task.title || task.id}<//>
            ${statusChip()}
          <//>
          ${task.description && html`<div><${Markdown} text=${task.description} /></div>`}
          ${stamps && html`<${Text} kind="mono" tone="muted">${stamps}<//>`}

          ${hasTodos && part(
            `${t('profile.agents.tasks.todoLabel')} · ${tOr('profile.agents.tasks.todoCount', '{done} of {total}', { done: doneTodos, total: todos.length })}`,
            planLine,
            html`
              ${todos.map((td, i) => {
                const mk = todoMarker(td.status || 'pending');
                return html`
                  <${ListRow} key=${td.id || i} marker=${mk.tone} live=${mk.live} density="compact"
                    name=${td.title} detail=${todoDetail(td)} value=${html`<${Chip} tone="muted">${envWord(td)}<//>`}>
                    ${(td.description || td.environmentReason || td.verification) && html`<${Stack} density="compact">
                      ${td.description && html`<${Text} kind="caption" tone="muted">${td.description}<//>`}
                      ${td.environmentReason && html`<${Text} kind="caption" tone="muted">${td.environmentReason}<//>`}
                      ${td.verification && html`<${Text} kind="caption" tone="muted">${td.verification}<//>`}
                    <//>`}
                  <//>
                `;
              })}
              ${outdatedTodos.length > 0 && html`
                <${Stack} density="compact">
                  <${Action} kind="text" onClick=${(e) => { e.stopPropagation(); setShowOutdated(v => !v); }} expanded=${showOutdated}>
                    ${t('profile.agents.tasks.outdatedTodos')} ${outdatedTodos.length}
                  <//>
                  ${showOutdated && outdatedTodos.map((td, i) => html`
                    <${ListRow} key=${td.id || 'old-' + i} marker="muted" density="compact"
                      name=${td.title} detail=${td.description} detailKind="text" />
                  `)}
                <//>
              `}
            `)}

          ${!hasTodos && isQueued && html`<${Text} tone="muted">${t('profile.agents.tasks.builder.waitingTodos')}<//>`}
          ${isRevisionRequested && html`<${Text} tone="muted">${t('profile.agents.tasks.revisionWaiting')}<//>`}

          ${showLog && part(tOr('profile.agents.tasks.whatHappened', 'What happened'), null, html`
            ${loadingEvents && html`<${Text} tone="muted">${t('profile.loading')}<//>`}
            ${events && events.length > 0 && events.map(ev => html`
              ${/* The time is the mono detail and the message the row's body, not ListRow's fixed
                    time column: that column leaves a phone-width message a few words wide. */''}
              <${ListRow} key=${ev.id || ev.timestamp} kind="chronology" density="compact" marker="muted"
                name=${ev.type || ''} detail=${ev.timestamp ? timeAgo(ev.timestamp) : ''}>
                ${ev.message && html`<${Text} kind="caption">${ev.message}<//>`}
              <//>
            `)}
            ${events && events.length === 0 && !isQueued && html`<${Text} tone="muted">${t('profile.agents.tasks.noEventsRecorded')}<//>`}
          `)}

          ${hasDetails && part(tOr('profile.agents.tasks.detailsLabel', 'Details'), null, html`
            ${task.deliverableKey && html`
              <${KeyValue} label=${t('profile.agents.tasks.deliverable')} value=${html`
                <${Stack} direction="wrap" density="compact">
                  <${Text} kind="mono">${task.deliverableKey}<//>
                  <${Action} kind="text" onClick=${(e) => { e.stopPropagation(); fetchDeliverable(); }}>
                    ${t('profile.agents.tasks.viewDeliverable')}
                  <//>
                <//>`} />
            `}
            ${hasScope && html`
              <${KeyValue} label=${t('profile.agents.detail.tasks.scope')} value=${html`<${Stack} density="compact">
                ${Array.isArray(task.scope)
                  ? task.scope.map((s, i) => html`<${Text} key=${i}>${formatScopeEntry(s)}<//>`)
                  : html`<${Text}>${formatScopeEntry(task.scope)}<//>`}
              <//>`} />
            `}
            ${hasRules && html`
              <${KeyValue} label=${t('profile.agents.detail.tasks.rules')} value=${html`<${Stack} density="compact">
                ${Array.isArray(task.rules) ? task.rules.map(r => html`<${Text} key=${r}>${r}<//>`) : html`<${Text}>${task.rules}<//>`}
              <//>`} />
            `}
            ${deliverable && html`
              ${deliverable.loading
                ? html`<${Text} tone="muted">${t('profile.loading')}<//>`
                : deliverable.notFound
                  ? html`<${Text} tone="muted">${t('profile.agents.tasks.deliverableGone')}<//>`
                  : html`<div><${DeliverableBody} value=${deliverable.value} alt=${task.title || task.description} /></div>`}
            `}
          `)}

          ${taskMemory && part(t('profile.agents.tasks.memory.show'), null, taskMemory.loading
            ? html`<${Text} tone="muted">${t('profile.loading')}<//>`
            : taskMemory.items.length === 0
              ? html`<${Text} tone="muted">${t('profile.agents.tasks.memory.none')}<//>`
              : html`<${Stack} density="compact">
                  ${taskMemory.items.map(it => html`<${TaskMemoryEntry} key=${it.key} entry=${it} />`)}
                <//>`)}

          ${rating && part(t('profile.agents.tasks.rate.rated'), null, html`
            <${Stack} direction="wrap" density="compact" align="center">
              <${Text} kind="number" size="small">${stars} / 5<//>
              <${Text} kind="mono" tone="muted">${t(`profile.agents.detail.quality.contexts.${rating.context}`)}<//>
              ${rating.comment && html`<${Text}>${rating.comment}<//>`}
            <//>
          `)}

          <${Stack} direction="wrap" align="center">
            ${task.triage !== 'kept' && html`
              <${Action} onClick=${(e) => handleTriage(e, 'kept')} title=${t('profile.agents.tasks.triage.keepHint')}>${t('profile.agents.tasks.triage.keep')}<//>
            `}
            ${task.triage !== 'archived' && html`
              <${Action} onClick=${(e) => handleTriage(e, 'archived')} title=${t('profile.agents.tasks.triage.archiveHint')}>${t('profile.agents.tasks.triage.archive')}<//>
            `}
            ${task.triage && html`
              <${Action} onClick=${(e) => handleTriage(e, null)}>${t('profile.agents.tasks.triage.restore')}<//>
            `}
            <${Action} onClick=${(e) => { e.stopPropagation(); fetchTaskMemory(); }}>
              ${t('profile.agents.tasks.memory.show')}
            <//>
            ${isDone && html`
              <${Action} onClick=${handleOpenRate}>
                ${rating ? t('profile.agents.tasks.rate.rerate') : t('profile.agents.tasks.rate.button')}
              <//>
            `}
            ${canRequestChanges && html`
              <${Action} onClick=${handleOpenRevision}>${t('profile.agents.tasks.requestChanges')}<//>
            `}
            ${canStart && html`
              <${Action} kind="primary" onClick=${handleStart} disabled=${starting}>
                ${starting ? t('profile.agents.tasks.starting') : t('profile.agents.tasks.startThisTask')}
              <//>
            `}
            ${(isActive || task.status === 'stalled') && html`
              <${Action} kind="text" tone="danger" onClick=${handleCancel}>${t('profile.agents.tasks.cancel')}<//>
            `}
            ${canDelete && html`
              <${Action} kind="text" tone="danger" onClick=${handleDelete}>${t('profile.agents.tasks.delete')}<//>
            `}
          <//>
          <//>
          <${ConfirmUI} />
          <${RequestChangesModal}
            open=${showRevisionModal}
            onClose=${() => setShowRevisionModal(false)}
            onSubmit=${handleSubmitRevision}
            submitting=${sendingRevision}
          />
          <${RateModal}
            open=${showRateModal}
            onClose=${() => setShowRateModal(false)}
            onSubmit=${handleSubmitRate}
            submitting=${sendingRate}
            existing=${rating}
          />
        <//>
      `}
    </div>
  `;
}
