/**
 * @file agents-tasks-subtab.js
 * @description Task queue sub-tab for agent detail view.
 *   Shows queued, active, and completed tasks with todo plans,
 *   "Start this task" approval button, and progress tracking.
 *   Filter pills allow switching between all/active/queued/completed/failed views.
 * @structure
 *   - AgentTasksSubtab (default export) -- main component with filter pills
 *   - TaskItem -- task row with expand/collapse, todo list, start button
 *   - RequestChangesModal -- inline modal for owner to send a free-text change request
 * @version-history
 *   v3.2.0 -- 2026-05-24 -- Add interactive filter pills, scope/rules display, migrate to pf-agd- CSS prefix
 *   v3.1.0 -- 2026-05-24 -- Fix: use correct locale key for empty state
 *   v3.0.0 -- 2026-05-22 -- Replace TaskCreateForm with TaskCreationBuilder (design spec split-panel)
 *   v2.1.0 -- 2026-05-22 -- Fix: use camelCase field names from API; add task and todo timestamps
 *   v2.0.0 -- 2026-05-22 -- Add todo rendering, Start button, progress tracking
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 *   v3.3.0 -- 2026-05-29 -- Add delete confirmation, "Request changes" modal for the revise-proposed-todos flow, outdated-todo history rendering, and revision_requested status.
 *   v3.3.1 -- 2026-05-30 -- Re-fetch the event log on every live-update tick while a task card is expanded. Without this, the parent refreshed the task object (todos + status) but the events list under it stayed frozen until the user closed and re-opened the card.
 *   v4.1.0 -- 2026-05-31 -- Show a completed task's deliverable: link to the
 *     agent-memory key it was published to (task.deliverableKey), fetch + preview
 *     the value on demand, and show "no longer exists" if the entry is gone.
 *   v4.0.0 -- 2026-05-30 -- Replace the split-panel TaskCreationBuilder with a
 *     plain create form (TaskCreateForm). The builder simulated a live chat
 *     ("Agent is analyzing your request...") that never happened -- the agent
 *     is an async daemon that picks the task up later -- and reopening the tab
 *     showed a completely different (queued-card) view, which was misleading.
 *     The form now creates the task queued and the list updates immediately, so
 *     the create state and the reopened state look the same.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { apiGet } from '/js/api.js';
import { listTasks, deleteTask, startTask, listEvents, requestChanges, createTask } from '/js/services/agent-tasks.js';
import { useConfirm, Modal } from '/components/Modal.js';

const TASK_FILTERS = ['all', 'active', 'queued', 'completed', 'failed'];

// Character limits -- keep in sync with AgentTaskCreateSchema in
// src/models/agent-task-schemas.ts (title max 256, description max 10000).
// The agent crew reads task.description as its prompt, so that is the field
// that needs room; title is just a short label for lists/cards.
const TITLE_MAX = 256;
const DESC_MAX = 10000;

// Build a short task title from the (longer) description when the owner leaves
// the title blank. Display-only; the full text lives in the description.
function deriveTitle(text) {
  const firstLine = text.split('\n').map(l => l.trim()).find(Boolean) || text.trim();
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine;
}

// Plain create form: description (what the agent reads) + optional short title.
// On submit the task is created 'queued' and the parent reloads the list, so
// the new task appears as a normal queued card -- no fake "analyzing" state.
function TaskCreateForm({ agentName, showToast, onCreated, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    const desc = description.trim();
    if (!desc) {
      showToast(t('profile.agents.tasks.descRequired'), true);
      return;
    }
    setCreating(true);
    try {
      await createTask(agentName, {
        title: (title.trim() || deriveTitle(desc)).slice(0, TITLE_MAX),
        description: desc,
        status: 'queued',
      });
      showToast(t('profile.agents.tasks.taskCreated'));
      onCreated();
    } catch (err) {
      showToast(err.message || t('profile.agents.tasks.createError'), true);
    }
    setCreating(false);
  }

  return html`
    <div class="pf-agd-create-form">
      <div class="pf-agd-form-field">
        <label>${t('profile.agents.tasks.descLabel')}</label>
        <textarea
          placeholder=${t('profile.agents.tasks.builder.placeholder')}
          value=${description}
          maxlength=${DESC_MAX}
          onInput=${e => setDescription(e.target.value)}
          rows="6"
        ></textarea>
        <div class=${`agd-chat-charcount ${description.length >= DESC_MAX ? 'agd-chat-charcount-max' : ''}`}>
          ${description.length} / ${DESC_MAX}
        </div>
      </div>
      <div class="pf-agd-form-field">
        <label>${t('profile.agents.tasks.titleLabel')}</label>
        <input
          type="text"
          maxlength=${TITLE_MAX}
          placeholder=${t('profile.agents.tasks.titlePlaceholder')}
          value=${title}
          onInput=${e => setTitle(e.target.value)}
        />
      </div>
      <div class="pf-agd-form-actions">
        <button class="btn-primary btn-sm" onClick=${handleCreate} disabled=${creating || !description.trim()}>
          ${creating ? t('profile.agents.tasks.starting') : t('profile.agents.tasks.createTask')}
        </button>
        <button class="btn-outline btn-sm" onClick=${onCancel} disabled=${creating}>
          ${t('profile.agents.tasks.cancel')}
        </button>
      </div>
    </div>
  `;
}

function statusLabel(status) {
  const key = `profile.agents.tasks.${status}`;
  const val = t(key);
  return val !== key ? val : status.charAt(0).toUpperCase() + status.slice(1);
}

function todoStatusIcon(status) {
  if (status === 'done') return '✅';
  if (status === 'failed') return '❌';
  if (status === 'skipped') return '⏭';
  if (status === 'active') return '▶';
  if (status === 'outdated') return '·';
  return '⬜';
}

function todoProgress(todos) {
  if (!todos || todos.length === 0) return null;
  const active = todos.filter(td => td.status !== 'outdated');
  if (active.length === 0) return null;
  const done = active.filter(td => td.status === 'done').length;
  return `${done}/${active.length}`;
}

// Modal where the owner types the change request shown to the agent. Kept
// inline here (rather than in /components) because the textarea-with-send
// pattern is specific to this view; if a second caller needs it later, lift
// it into a shared component.
function RequestChangesModal({ open, onClose, onSubmit, submitting }) {
  const [message, setMessage] = useState('');
  useEffect(() => { if (open) setMessage(''); }, [open]);
  function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('profile.agents.tasks.requestChangesTitle')}>
    <p class="pf-agd-modal-help">${t('profile.agents.tasks.requestChangesHelp')}</p>
    <textarea
      class="pf-agd-revision-textarea"
      placeholder=${t('profile.agents.tasks.requestChangesPlaceholder')}
      value=${message}
      onInput=${e => setMessage(e.target.value)}
      rows=${6}
    ></textarea>
    <div class="modal-footer">
      <button class="btn-ghost" onClick=${onClose} disabled=${submitting}>${t('common.cancel') || 'Cancel'}</button>
      <button class="btn-primary" onClick=${handleSend} disabled=${submitting || !message.trim()}>
        ${submitting ? t('profile.agents.tasks.requestChangesSending') : t('profile.agents.tasks.requestChangesSend')}
      </button>
    </div>
  <//>`;
}

function TaskItem({ task, agentName, showToast, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [sendingRevision, setSendingRevision] = useState(false);
  const [showOutdated, setShowOutdated] = useState(false);
  // Deliverable preview: null = not requested, {loading}|{notFound}|{value}.
  const [deliverable, setDeliverable] = useState(null);
  const { confirm, ConfirmUI } = useConfirm();

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
      const v = found.value;
      setDeliverable({ value: typeof v === 'string' ? v : JSON.stringify(v, null, 2) });
    } catch {
      setDeliverable({ notFound: true });
    }
  }

  async function fetchEvents({ silent = false } = {}) {
    if (!silent) setLoadingEvents(true);
    try {
      const resp = await listEvents(agentName, task.id);
      setEvents(resp?.data?.events || []);
    } catch { setEvents([]); }
    if (!silent) setLoadingEvents(false);
  }

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
    const handler = () => fetchEvents({ silent: true });
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [expanded, task.id, agentName]);

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

  function handleOpenRevision(e) {
    e.stopPropagation();
    setShowRevisionModal(true);
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
  const canStart = isQueued && hasTodos;
  const canRequestChanges = task.status === 'queued' && hasTodos;
  const totalMinutes = todos.reduce((sum, td) => sum + (td.estimateMinutes || 0), 0);
  const aimeatSteps = todos.filter(td => td.environment === 'aimeat').length;
  const agentSteps = todos.filter(td => td.environment === 'agent').length;

  function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' +
           d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return html`
    <div>
      <div class="pf-agd-task-item" onClick=${handleExpand}>
        <div class="pf-agd-task-title-row">
          <span class="pf-agd-task-title">${task.title || task.id}</span>
          ${progress && html`<span class="pf-agd-todo-progress">${progress}</span>`}
        </div>
        <div class="pf-agd-task-meta">
          ${task.createdAt && html`<span class="pf-agd-task-time">${timeAgo(task.createdAt)}</span>`}
          <span class="pf-agd-status pf-agd-status-${task.status || 'draft'}">${statusLabel(task.status || 'draft')}</span>
        </div>
      </div>
      ${expanded && html`
        <div class="pf-agd-task-expanded">
          ${task.description && html`<div class="pf-agd-task-desc">${task.description}</div>`}

          ${task.deliverableKey && html`
            <div class="pf-agd-deliverable">
              <span class="pf-agd-deliverable-label">${t('profile.agents.tasks.deliverable')}:</span>
              <code class="pf-agd-deliverable-key">${task.deliverableKey}</code>
              <button class="btn-ghost btn-sm" onClick=${(e) => { e.stopPropagation(); fetchDeliverable(); }}>
                ${t('profile.agents.tasks.viewDeliverable')}
              </button>
            </div>
            ${deliverable && html`
              ${deliverable.loading
                ? html`<div class="pf-agd-empty">${t('profile.loading')}</div>`
                : deliverable.notFound
                  ? html`<div class="pf-agd-deliverable-gone">${t('profile.agents.tasks.deliverableGone')}</div>`
                  : html`<pre class="pf-agd-memory-preview">${deliverable.value}</pre>`}
            `}
          `}

          ${task.scope && html`
            <div class="pf-agd-info-row">
              <span class="pf-agd-info-label">${t('profile.agents.detail.tasks.scope')}</span>
              <span class="pf-agd-info-value">${Array.isArray(task.scope) ? task.scope.join(', ') : task.scope}</span>
            </div>
          `}
          ${task.rules && task.rules.length > 0 && html`
            <div class="pf-agd-info-row">
              <span class="pf-agd-info-label">${t('profile.agents.detail.tasks.rules')}</span>
              <span class="pf-agd-info-value">
                ${Array.isArray(task.rules) ? task.rules.map(r => html`<div key=${r}>${r}</div>`) : task.rules}
              </span>
            </div>
          `}

          <div class="pf-agd-task-timestamps">
            ${task.createdAt && html`<span>${t('profile.agents.tasks.created')}: ${formatDateTime(task.createdAt)}</span>`}
            ${task.updatedAt && task.updatedAt !== task.createdAt && html`<span>${t('profile.agents.tasks.updated')}: ${formatDateTime(task.updatedAt)}</span>`}
            ${task.completedAt && html`<span>${t('profile.agents.tasks.completed')}: ${formatDateTime(task.completedAt)}</span>`}
          </div>

          ${hasTodos && html`
            <div class="pf-agd-todo-section">
              <div class="pf-agd-todo-header">
                <strong>${t('profile.agents.tasks.todoLabel')}</strong>
                <span class="pf-agd-todo-summary">
                  ${aimeatSteps > 0 && html`<span class="pf-agd-env-badge pf-agd-env-aimeat">${t('profile.agents.tasks.envAimeat')}: ${aimeatSteps}</span>`}
                  ${agentSteps > 0 && html`<span class="pf-agd-env-badge pf-agd-env-agent">${t('profile.agents.tasks.envAgent')}: ${agentSteps}</span>`}
                  ${totalMinutes > 0 && html`<span class="pf-agd-todo-time">~${totalMinutes} ${t('profile.agents.tasks.minuteShort')}</span>`}
                </span>
              </div>
              <div class="pf-agd-todo-list">
                ${todos.map((td, i) => html`
                  <div class="pf-agd-todo-item pf-agd-todo-${td.status || 'pending'}" key=${td.id || i}>
                    <span class="pf-agd-todo-icon">${todoStatusIcon(td.status || 'pending')}</span>
                    <div class="pf-agd-todo-content">
                      <div class="pf-agd-todo-title">
                        ${td.title}
                        <span class="pf-agd-env-badge pf-agd-env-${td.environment || 'agent'}">${td.environment === 'aimeat' ? t('profile.agents.tasks.envAimeat') : t('profile.agents.tasks.envAgent')}</span>
                        ${td.estimateMinutes && html`
                          <span class="pf-agd-todo-est">${td.estimateMinutes} ${t('profile.agents.tasks.minuteShort')}</span>
                        `}
                      </div>
                      ${td.description && html`<div class="pf-agd-todo-desc">${td.description}</div>`}
                      ${td.environmentReason && html`
                        <div class="pf-agd-todo-reason">${td.environmentReason}</div>
                      `}
                      ${td.verification && html`<div class="pf-agd-todo-verify">${td.verification}</div>`}
                      ${td.completedAt && html`<div class="pf-agd-todo-completed-at">${formatDateTime(td.completedAt)}</div>`}
                    </div>
                  </div>
                `)}
              </div>
            </div>
          `}

          ${!hasTodos && isQueued && html`
            <div class="pf-agd-todo-waiting">
              ${t('profile.agents.tasks.builder.waitingTodos')}
            </div>
          `}

          ${isRevisionRequested && html`
            <div class="pf-agd-todo-waiting">
              ${t('profile.agents.tasks.revisionWaiting')}
            </div>
          `}

          ${outdatedTodos.length > 0 && html`
            <div class="pf-agd-todo-history">
              <button class="pf-agd-todo-history-toggle" onClick=${(e) => { e.stopPropagation(); setShowOutdated(v => !v); }}>
                ${showOutdated ? '▼' : '▶'} ${t('profile.agents.tasks.outdatedTodos')} (${outdatedTodos.length})
              </button>
              ${showOutdated && html`
                <div class="pf-agd-todo-list pf-agd-todo-list-outdated">
                  ${outdatedTodos.map((td, i) => html`
                    <div class="pf-agd-todo-item pf-agd-todo-outdated" key=${td.id || 'old-' + i}>
                      <span class="pf-agd-todo-icon">${todoStatusIcon('outdated')}</span>
                      <div class="pf-agd-todo-content">
                        <div class="pf-agd-todo-title">${td.title}</div>
                        ${td.description && html`<div class="pf-agd-todo-desc">${td.description}</div>`}
                      </div>
                    </div>
                  `)}
                </div>
              `}
            </div>
          `}

          ${loadingEvents && html`<div class="pf-agd-empty">${t('profile.loading')}</div>`}
          ${events && events.length > 0 && html`
            <div class="pf-agd-event-log">
              ${events.map(ev => html`
                <div class="pf-agd-event-item" key=${ev.id || ev.timestamp}>
                  <span class="pf-agd-event-time">${ev.timestamp ? timeAgo(ev.timestamp) : ''}</span>
                  <span class="pf-agd-event-type">${ev.type || ''}</span>
                  <span>${ev.message || ''}</span>
                </div>
              `)}
            </div>
          `}
          ${events && events.length === 0 && !isQueued && html`
            <div class="pf-agd-empty">${t('profile.agents.tasks.noEventsRecorded')}</div>
          `}

          <div class="pf-agd-task-actions">
            ${canStart && html`
              <button class="btn-primary btn-sm" onClick=${handleStart} disabled=${starting}>
                ${starting ? t('profile.agents.tasks.starting') : t('profile.agents.tasks.startThisTask')}
              </button>
            `}
            ${canRequestChanges && html`
              <button class="btn-outline btn-sm" onClick=${handleOpenRevision}>
                ${t('profile.agents.tasks.requestChanges')}
              </button>
            `}
            ${(isQueued || task.status === 'draft' || isRevisionRequested) && html`
              <button class="btn-danger btn-sm" onClick=${handleDelete}>${t('profile.agents.tasks.delete')}</button>
            `}
          </div>
          <${ConfirmUI} />
          <${RequestChangesModal}
            open=${showRevisionModal}
            onClose=${() => setShowRevisionModal(false)}
            onSubmit=${handleSubmitRevision}
            submitting=${sendingRevision}
          />
        </div>
      `}
    </div>
  `;
}

export default function AgentTasksSubtab({ agentName, showToast }) {
  const [tasks, setTasks] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  async function loadTasks() {
    try {
      const resp = await listTasks(agentName);
      setTasks(resp?.data?.tasks || []);
      setError(null);
    } catch (err) {
      setError(err.message);
      setTasks([]);
    }
  }

  useEffect(() => { loadTasks(); }, [agentName]);

  const loadRef = useRef(loadTasks);
  loadRef.current = loadTasks;
  useEffect(() => {
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  function handleCreated() {
    setShowCreate(false);
    loadTasks();
  }

  if (tasks === null) {
    return html`<div class="pf-agd-empty">${t('profile.loading')}</div>`;
  }

  const filtered = filter === 'all' ? tasks : tasks.filter(task => {
    switch (filter) {
      case 'active': return task.status === 'active';
      // 'revision_requested' lives under the queued filter -- the task is
      // waiting for the agent to re-propose, which is conceptually the same
      // "awaiting action before run" bucket the owner already monitors here.
      case 'queued': return task.status === 'queued' || task.status === 'draft' || task.status === 'revision_requested';
      case 'completed': return task.status === 'done';
      case 'failed': return task.status === 'failed' || task.status === 'stalled';
      default: return true;
    }
  });

  return html`
    <div>
      <div class="pf-agd-section-header">
        <span class="pf-agd-section-title">
          ${t('profile.agents.tasks.title')}${tasks.length > 0 ? ` (${tasks.length})` : ''}
        </span>
        <button class="btn-outline btn-sm" onClick=${() => setShowCreate(!showCreate)}>
          ${showCreate ? '-' : '+'} ${t('profile.agents.tasks.newTask')}
        </button>
      </div>

      ${showCreate && html`
        <${TaskCreateForm} agentName=${agentName} showToast=${showToast} onCreated=${handleCreated} onCancel=${() => setShowCreate(false)} />
      `}

      ${error && html`<div class="pf-agd-empty">${error}</div>`}

      <div class="pf-agd-filter-bar">
        ${TASK_FILTERS.map(f => html`
          <button key=${f}
                  class="pf-agd-filter-pill ${filter === f ? 'pf-agd-filter-pill--active' : ''}"
                  onClick=${() => setFilter(f)}>
            ${t(`profile.agents.detail.tasks.filter.${f}`)}
          </button>
        `)}
      </div>

      ${filtered.length > 0 ? filtered.map(task => html`
        <${TaskItem} key=${task.id} task=${task} agentName=${agentName} showToast=${showToast} onRefresh=${loadTasks} />
      `) : html`
        <div class="pf-agd-empty">${t('profile.agents.detail.empty.tasks')}</div>
      `}
    </div>
  `;
}
