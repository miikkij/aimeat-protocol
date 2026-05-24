/**
 * @file agents-tasks-subtab.js
 * @description Task queue sub-tab for agent detail view.
 *   Shows queued, active, and completed tasks with todo plans,
 *   "Start this task" approval button, and progress tracking.
 *   Filter pills allow switching between all/active/queued/completed/failed views.
 * @structure
 *   - AgentTasksSubtab (default export) -- main component with filter pills
 *   - TaskItem -- task row with expand/collapse, todo list, start button
 * @version-history
 *   v3.2.0 -- 2026-05-24 -- Add interactive filter pills, scope/rules display, migrate to pf-agd- CSS prefix
 *   v3.1.0 -- 2026-05-24 -- Fix: use correct locale key for empty state
 *   v3.0.0 -- 2026-05-22 -- Replace TaskCreateForm with TaskCreationBuilder (design spec split-panel)
 *   v2.1.0 -- 2026-05-22 -- Fix: use camelCase field names from API; add task and todo timestamps
 *   v2.0.0 -- 2026-05-22 -- Add todo rendering, Start button, progress tracking
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { listTasks, deleteTask, startTask, listEvents } from '/js/services/agent-tasks.js';
import TaskCreationBuilder from './agents-task-builder.js';

const TASK_FILTERS = ['all', 'active', 'queued', 'completed', 'failed'];

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
  return '⬜';
}

function todoProgress(todos) {
  if (!todos || todos.length === 0) return null;
  const done = todos.filter(td => td.status === 'done').length;
  return `${done}/${todos.length}`;
}

function TaskItem({ task, agentName, showToast, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [starting, setStarting] = useState(false);

  async function handleExpand(e) {
    e.stopPropagation();
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (!events) {
      setLoadingEvents(true);
      try {
        const resp = await listEvents(agentName, task.id);
        setEvents(resp?.data?.events || []);
      } catch { setEvents([]); }
      setLoadingEvents(false);
    }
  }

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

  async function handleDelete(e) {
    e.stopPropagation();
    try {
      await deleteTask(agentName, task.id);
      showToast(t('profile.agents.tasks.taskDeleted'));
      onRefresh();
    } catch (err) {
      showToast(err.message || t('profile.agents.tasks.deleteError'), true);
    }
  }

  const todos = task.todos || [];
  const hasTodos = todos.length > 0;
  const progress = todoProgress(todos);
  const isQueued = task.status === 'queued' || task.status === 'draft';
  const isActive = task.status === 'active';
  const canStart = isQueued && hasTodos;
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
            ${(isQueued || task.status === 'draft') && html`
              <button class="btn-danger btn-sm" onClick=${handleDelete}>${t('profile.agents.tasks.delete')}</button>
            `}
          </div>
        </div>
      `}
    </div>
  `;
}

export default function AgentTasksSubtab({ agentName, session, showToast }) {
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
      case 'queued': return task.status === 'queued' || task.status === 'draft';
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
        <${TaskCreationBuilder} agentName=${agentName} session=${session} showToast=${showToast} onClose=${handleCreated} />
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
