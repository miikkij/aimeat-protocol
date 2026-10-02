/**
 * @file public/views/profile/agents/task-item.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Single task row for the agent Tasks sub-tab: the closed four-column row (name,
 *   to-do progress, when, status chip) and the opened record with its parts -- to do, what
 *   happened, details, memory entries, rating -- plus the actions row (start, request changes,
 *   triage, cancel, delete). The helpers it is built from live in ./task-item-parts.js.
 * @version-history
 *   v2.22.0 — 2026-10-02 — A queued task with a plan says in words that it waits for the owner's OK.
 *   v2.21.0 — 2026-09-30 — A `scope_denied` event (the server refused the task's agent a permission) is
 *     said in the reader's language and wears the trouble dot.
 *   v2.20.0 — 2026-09-26 — Every part is a component that takes data (page group G1a): the task is the
 *     List's row that opens on a press (the eye is the Icon before the name, the blurred name and the
 *     coral open name are the Name's options), the record is the List's Panel with its own title and
 *     status, the to-dos are a List with the Tick (the environment tag dim again, as on main:
 *     og-chip--dim), the parts sit under the heavy rule (Split heavy) with their row label and tally, the details
 *     are Facts, the memory entries the FoldRows, the rating the Stars, and the actions two Actions
 *     rows with what cannot be undone at the far right.
 *   v2.19.0 — 2026-09-26 — A task's description is the Markdown reader's small cut (Markdown `small`), a unification: Jouni's decision "Small reader".
 *   v2.18.0 — 2026-09-26 — An opened task's "What happened" is the home's Timeline (components/Timeline.js): the time, a dot for the kind (trouble, made, the agent's work), one line with the event and its message; the three-column table goes (a unification: Jouni's decision "Activity log").
 *   v2.17.0 — 2026-09-26 — A rated task's stars are the library's Rating stars in the shown tone (css/components/rating-stars.css): the stars not given in --text-dim instead of --border (a unification: Jouni's decision "Rating stars").
 *   v2.16.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v2.15.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.14.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v2.13.0 — 2026-09-26 — An opened task's title is the record title's small cut (.poster-record-title--small) and the runs field the Text field at its own face; the rules that restyled them go (a unification).
 *   v2.12.0 — 2026-09-25 — A task's deliverable key is inline code, the code-inline cut of the Code block, a unification: the look most tabs use.
 *   v2.11.0 — 2026-09-25 — Every mark button is the icon button (.poster-icon, its small cut), a unification: Jouni's decision Icon button.
 *   v2.10.0 — 2026-09-25 — Every small number is the Count (.poster-count tally, waiting at the limit), a unification: Jouni's decision Count.
 *   v2.9.0 — 2026-09-25 — A task's details (deliverable, scope, rules) are the Facts (css/components/facts.css), a unification: the look most tabs use.
 *   v2.8.0 — 2026-09-25 — A task's row is the Listing (css/components/listing.css), a unification: the look most tabs use. The opened record is the Listing's open panel inside the row, so a press inside it no longer reaches the row's toggle.
 *   v2.7.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v2.6.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v2.5.0 — 2026-09-25 — Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v2.4.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v2.3.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v2.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v2.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate, time as fmtTime } from '/js/format.js';
import {
  isTaskBlurred,
  setTaskBlurred,
  statusLabel,
  statusTone,
  formatScopeEntry,
  todoProgress,
  EyeIcon,
  RequestChangesModal,
  TaskMemoryEntry,
} from './task-item-parts.js';
import { TimelineList, TimelineRow } from '/components/Timeline.js';
import { Row as ListRow, Name, Cell, When, Doors, Panel, Tick, List } from '/components/List.js';
import { Action, Actions, Icon, Loud } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Folds } from '/components/Folds.js';
import { Stars } from '/components/Stars.js';
import { Row, Split, Space } from '/components/Layout.js';
import { permissionWords } from './agent-card-access.js';

/** The Timeline's dot for a task event: a failure is trouble, a thing written or installed is made,
 *  the rest is the agent's work. */
const eventDot = (type = '') => (/fail|error|denied/.test(type) ? 'trouble' : /memory_write|app_publish|extension_install/.test(type) ? 'made' : 'agent');

/** A task event's line. A refusal the server noted is said in the reader's language from its
 *  details; every other event is its type and the message its writer gave it. */
const eventText = (ev) => (ev.type === 'scope_denied' && Array.isArray(ev.details?.needed)
  ? t('profile.agents.refusals.taskEvent', { permission: permissionWords(ev.details.needed, ev.details.any_of === true) })
  : [ev.type, ev.message].filter(Boolean).join(': '));

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
    // The opened record sits inside the row (the Listing's open panel), so a press inside it
    // reaches the row too; it belongs to the record, and goes on as it did before.
    if (e.target.closest?.('.listing-open')) return;
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

  // A fresh vnode per call: the closed row and the open record both show the status at once.
  const statusChip = () => html`<${Mark} kind="status" tone=${statusTone(status)}>${statusLabel(status)}<//>`;
  // The log part only appears once there is a log, a fetch in flight, or a recorded emptiness.
  const showLog = loadingEvents || (events && (events.length > 0 || !isQueued));
  // One part of the open record: the heavy rule over it, its row label, and a tally at the right.
  // The actions at the record's foot keep what cannot be undone at the far right.
  const part = (label, tally, body) => html`
    <${Split} heavy above="large" gap="small">
      <${Row} wrap justify="between">
        <${Label}>${label}<//>
        ${tally ? html`<${Mark} kind="count" tone="tally">${tally}<//>` : null}
      <//>
      ${body}
    <//>`;
  const envWord = (td) => (td.environment === 'aimeat' ? t('profile.agents.tasks.envAimeat') : t('profile.agents.tasks.envAgent'));
  const lines = (list) => (Array.isArray(list) ? list : [list]).map((x, i) => html`<${FactLine} key=${i}>${x}<//>`);

  return html`
    <${ListRow} open=${expanded} onToggle=${handleExpand}>
      <${Name} nameRef=${taskRef} blurred=${blurred} attention=${expanded}
        before=${html`<${Icon} small pressed=${blurred} onClick=${handleToggleBlur}
          label=${blurred ? t('profile.agents.tasks.unblurTitle') : t('profile.agents.tasks.blurTitle')}><${EyeIcon} hidden=${blurred} /><//>`}>${task.title || task.id}<//>
      <${Cell}><${Mark} kind="count" tone="tally">${progress || ''}<//><//>
      <${When}>${task.createdAt ? timeAgo(task.createdAt) : ''}<//>
      <${Cell}>${statusChip()}<//>

      ${expanded && html`
        <${Panel} title=${task.title || task.id} mark=${statusChip()}>
          ${task.description && html`<${Markdown} text=${task.description} small />`}
          ${stamps && html`<div><${Mark} kind="time">${stamps}<//></div>`}

          ${hasTodos && part(
            `${t('profile.agents.tasks.todoLabel')} · ${tOr('profile.agents.tasks.todoCount', '{done} of {total}', { done: doneTodos, total: todos.length })}`,
            planLine,
            html`
              <${List} cols="mark-name-doors" keepCols>
                ${todos.map((td, i) => html`
                  <${ListRow} key=${td.id || i}>
                    <${Tick} state=${td.status || 'pending'} />
                    <${Name} tag=${html`<${Mark} tone="dim">${envWord(td)}<//>`}
                      desc=${[td.description, td.environmentReason, td.verification]}>${td.title}<//>
                    <${Doors}>
                      ${td.estimateMinutes && html`<${Mark} kind="count" tone="tally">${td.estimateMinutes} ${t('profile.agents.tasks.minuteShort')}<//>`}
                      ${td.completedAt && html`<${Mark} kind="time">${formatDateTime(td.completedAt)}<//>`}
                    <//>
                  <//>
                `)}
              <//>
              ${outdatedTodos.length > 0 && html`
                <${Actions}>
                  <${Action} small soft expanded=${showOutdated} onClick=${(e) => { e.stopPropagation(); setShowOutdated(v => !v); }}>
                    ${t('profile.agents.tasks.outdatedTodos')} <${Mark} kind="count" tone="tally">${outdatedTodos.length}<//>
                  <//>
                <//>
                ${showOutdated && html`
                  <${List} cols="mark-name-doors" keepCols>
                    ${outdatedTodos.map((td, i) => html`
                      <${ListRow} key=${td.id || 'old-' + i} faded>
                        <${Tick} state="none" />
                        <${Name} desc=${td.description}>${td.title}<//>
                        <${Cell} />
                      <//>
                    `)}
                  <//>
                `}
              `}
            `)}

          ${/* The plan is in and the task waits for the owner: said in words, because a Start button
               alone is what a new customer never found (hosted places, 2026-10-01). */''}
          ${hasTodos && task.status === 'queued' && html`<${Note} kind="hint">${t('profile.agents.tasks.waitsForYou')}<//>`}
          ${!hasTodos && isQueued && html`<${Note} kind="quiet">${t('profile.agents.tasks.builder.waitingTodos')}<//>`}
          ${isRevisionRequested && html`<${Note} kind="quiet">${t('profile.agents.tasks.revisionWaiting')}<//>`}

          ${showLog && part(tOr('profile.agents.tasks.whatHappened', 'What happened'), null, html`
            ${loadingEvents && html`<${Note} kind="loading" />`}
            ${events && events.length > 0 && html`
              <${TimelineList}>
                ${events.map(ev => html`
                  <${TimelineRow} key=${ev.id || ev.timestamp} category=${eventDot(ev.type)}
                    when=${ev.timestamp ? timeAgo(ev.timestamp) : ''}
                    text=${eventText(ev)} />
                `)}
              <//>
            `}
            ${events && events.length === 0 && !isQueued && html`<${Note} kind="quiet">${t('profile.agents.tasks.noEventsRecorded')}<//>`}
          `)}

          ${hasDetails && part(tOr('profile.agents.tasks.detailsLabel', 'Details'), null, html`
            <${Facts} rows=${[
              task.deliverableKey && {
                k: t('profile.agents.tasks.deliverable'), v: task.deliverableKey, mono: true,
                action: html`<${Action} small soft onClick=${(e) => { e.stopPropagation(); fetchDeliverable(); }}>${t('profile.agents.tasks.viewDeliverable')}<//>`,
              },
              hasScope && { k: t('profile.agents.detail.tasks.scope'), v: Array.isArray(task.scope) ? lines(task.scope.map(formatScopeEntry)) : formatScopeEntry(task.scope) },
              hasRules && { k: t('profile.agents.detail.tasks.rules'), v: Array.isArray(task.rules) ? lines(task.rules) : task.rules },
            ]} />
            ${deliverable && html`
              ${deliverable.loading
                ? html`<${Note} kind="loading" />`
                : deliverable.notFound
                  ? html`<${Note} kind="quiet">${t('profile.agents.tasks.deliverableGone')}<//>`
                  : html`<${Space} above="medium"><${DeliverableBody} value=${deliverable.value} alt=${task.title || task.description} /><//>`}
            `}
          `)}

          ${taskMemory && part(t('profile.agents.tasks.memory.show'), null, taskMemory.loading
            ? html`<${Note} kind="loading" />`
            : taskMemory.items.length === 0
              ? html`<${Note} kind="quiet">${t('profile.agents.tasks.memory.none')}<//>`
              : html`<${Folds}>${taskMemory.items.map(it => html`<${TaskMemoryEntry} key=${it.key} entry=${it} />`)}<//>`)}

          ${rating && part(t('profile.agents.tasks.rate.rated'), null, html`
            <${Row} wrap align="baseline" gap="large">
              <${Stars} value=${rating.stars} />
              <${Note} kind="meta" mono inline>${t(`profile.agents.detail.quality.contexts.${rating.context}`)}<//>
              ${rating.comment && html`<${Note} inline>${rating.comment}<//>`}
            <//>
          `)}

          <${Row} wrap justify="between" gap="large" above="large">
            <${Actions}>
              ${task.triage !== 'kept' && html`
                <${Action} small onClick=${(e) => handleTriage(e, 'kept')} title=${t('profile.agents.tasks.triage.keepHint')}>★ ${t('profile.agents.tasks.triage.keep')}<//>
              `}
              ${task.triage !== 'archived' && html`
                <${Action} small onClick=${(e) => handleTriage(e, 'archived')} title=${t('profile.agents.tasks.triage.archiveHint')}>${t('profile.agents.tasks.triage.archive')}<//>
              `}
              ${task.triage && html`
                <${Action} small onClick=${(e) => handleTriage(e, null)}>${t('profile.agents.tasks.triage.restore')}<//>
              `}
              <${Action} small onClick=${(e) => { e.stopPropagation(); fetchTaskMemory(); }}>
                ${t('profile.agents.tasks.memory.show')}
              <//>
              ${isDone && html`
                <${Action} small onClick=${handleOpenRate}>
                  ${rating ? t('profile.agents.tasks.rate.rerate') : t('profile.agents.tasks.rate.button')}
                <//>
              `}
              ${canRequestChanges && html`
                <${Action} small onClick=${handleOpenRevision}>${t('profile.agents.tasks.requestChanges')}<//>
              `}
              ${canStart && html`
                <${Loud} control onClick=${handleStart} disabled=${starting}>
                  ${starting ? t('profile.agents.tasks.starting') : t('profile.agents.tasks.startThisTask')}
                <//>
              `}
            <//>
            <${Actions}>
              ${(isActive || task.status === 'stalled') && html`
                <${Action} small tone="danger" onClick=${handleCancel}>${t('profile.agents.tasks.cancel')}<//>
              `}
              ${canDelete && html`
                <${Action} small tone="danger" onClick=${handleDelete}>${t('profile.agents.tasks.delete')}<//>
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
    <//>
  `;
}
