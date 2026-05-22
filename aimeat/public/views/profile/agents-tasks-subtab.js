/**
 * @file agents-tasks-subtab.js
 * @description Task queue sub-tab for agent detail view.
 *   Shows queued, active, and completed tasks with todo plans,
 *   "Start this task" approval button, and progress tracking.
 * @structure
 *   - AgentTasksSubtab (default export) -- main component
 *   - TaskItem -- task row with expand/collapse, todo list, start button
 *   - TaskCreateForm -- inline task creation form
 * @version-history
 *   v2.0.0 -- 2026-05-22 -- Add todo rendering, Start button, progress tracking
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { listTasks, createTask, deleteTask, startTask, listEvents } from '/js/services/agent-tasks.js';

function statusLabel(status) {
  const key = `profile.agents.tasks.status.${status}`;
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
      showToast('Task started');
      onRefresh();
    } catch (err) {
      showToast(err.message || 'Failed to start task', true);
    }
    setStarting(false);
  }

  async function handleDelete(e) {
    e.stopPropagation();
    try {
      await deleteTask(agentName, task.id);
      showToast('Task deleted');
      onRefresh();
    } catch (err) {
      showToast(err.message || 'Failed to delete task', true);
    }
  }

  const todos = task.todos || [];
  const hasTodos = todos.length > 0;
  const progress = todoProgress(todos);
  const isQueued = task.status === 'queued' || task.status === 'draft';
  const isActive = task.status === 'active';
  const canStart = isQueued && hasTodos;
  const totalMinutes = todos.reduce((sum, td) => sum + (td.estimateMinutes || td.estimate_minutes || 0), 0);
  const aimeatSteps = todos.filter(td => td.environment === 'aimeat').length;
  const agentSteps = todos.filter(td => td.environment === 'agent').length;

  return html`
    <div>
      <div class="agd-task-item" onClick=${handleExpand}>
        <div style="flex:1;display:flex;align-items:center;gap:0.5rem">
          <span class="agd-task-title">${task.title || task.id}</span>
          ${progress && html`<span class="agd-todo-progress">${progress}</span>`}
        </div>
        <div class="agd-task-meta">
          ${task.created_at && html`<span class="agd-task-time">${timeAgo(task.created_at)}</span>`}
          <span class="agd-status agd-status-${task.status || 'draft'}">${statusLabel(task.status || 'draft')}</span>
        </div>
      </div>
      ${expanded && html`
        <div class="agd-task-expanded">
          ${task.description && html`<div class="agd-task-desc">${task.description}</div>`}

          ${hasTodos && html`
            <div class="agd-todo-section">
              <div class="agd-todo-header">
                <strong>TODO</strong>
                <span class="agd-todo-summary">
                  ${aimeatSteps > 0 && html`<span class="agd-env-badge agd-env-aimeat">AIMEAT: ${aimeatSteps}</span>`}
                  ${agentSteps > 0 && html`<span class="agd-env-badge agd-env-agent">Agent: ${agentSteps}</span>`}
                  ${totalMinutes > 0 && html`<span class="agd-todo-time">~${totalMinutes} min</span>`}
                </span>
              </div>
              <div class="agd-todo-list">
                ${todos.map((td, i) => html`
                  <div class="agd-todo-item agd-todo-${td.status || 'pending'}" key=${td.id || i}>
                    <span class="agd-todo-icon">${todoStatusIcon(td.status || 'pending')}</span>
                    <div class="agd-todo-content">
                      <div class="agd-todo-title">
                        ${td.title}
                        <span class="agd-env-badge agd-env-${td.environment || 'agent'}">${(td.environment || 'agent').toUpperCase()}</span>
                        ${(td.estimateMinutes || td.estimate_minutes) && html`
                          <span class="agd-todo-est">${td.estimateMinutes || td.estimate_minutes} min</span>
                        `}
                      </div>
                      ${td.description && html`<div class="agd-todo-desc">${td.description}</div>`}
                      ${(td.environmentReason || td.environment_reason) && html`
                        <div class="agd-todo-reason">${td.environmentReason || td.environment_reason}</div>
                      `}
                      ${td.verification && html`<div class="agd-todo-verify">${td.verification}</div>`}
                    </div>
                  </div>
                `)}
              </div>
            </div>
          `}

          ${!hasTodos && isQueued && html`
            <div class="agd-todo-waiting">
              Waiting for agent to propose a plan...
            </div>
          `}

          ${loadingEvents && html`<div class="agd-empty">${t('profile.loading')}</div>`}
          ${events && events.length > 0 && html`
            <div class="agd-event-log">
              ${events.map(ev => html`
                <div class="agd-event-item" key=${ev.id || ev.timestamp}>
                  <span class="agd-event-time">${ev.timestamp ? timeAgo(ev.timestamp) : ''}</span>
                  <span class="agd-event-type">${ev.type || ''}</span>
                  <span>${ev.message || ''}</span>
                </div>
              `)}
            </div>
          `}
          ${events && events.length === 0 && !isQueued && html`
            <div class="agd-empty">No events recorded</div>
          `}

          <div class="agd-task-actions">
            ${canStart && html`
              <button class="btn-primary btn-sm" onClick=${handleStart} disabled=${starting}>
                ${starting ? 'Starting...' : 'Start this task'}
              </button>
            `}
            ${(isQueued || task.status === 'draft') && html`
              <button class="btn-danger btn-sm" onClick=${handleDelete}>Delete</button>
            `}
          </div>
        </div>
      `}
    </div>
  `;
}

function TaskCreateForm({ agentName, showToast, onCreated, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('queued');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createTask(agentName, {
        title: title.trim(),
        description: description.trim() || undefined,
        status,
      });
      showToast('Task created');
      onCreated();
    } catch (err) {
      showToast(err.message || 'Failed to create task', true);
    }
    setSaving(false);
  }

  return html`
    <form class="agd-create-form" onSubmit=${handleSubmit}>
      <div class="agd-form-field">
        <label>Title</label>
        <input type="text" value=${title} onInput=${(e) => setTitle(e.target.value)}
               placeholder="What should the agent do?" required />
      </div>
      <div class="agd-form-field">
        <label>Description</label>
        <textarea value=${description} onInput=${(e) => setDescription(e.target.value)}
                  placeholder="Detailed instructions (optional)"></textarea>
      </div>
      <div class="agd-form-field">
        <label>Initial status</label>
        <select value=${status} onChange=${(e) => setStatus(e.target.value)}>
          <option value="draft">${statusLabel('draft')}</option>
          <option value="queued">${statusLabel('queued')}</option>
        </select>
      </div>
      <div class="agd-form-actions">
        <button type="submit" class="btn-primary btn-sm" disabled=${saving || !title.trim()}>
          ${saving ? 'Creating...' : 'Create Task'}
        </button>
        <button type="button" class="btn-outline btn-sm" onClick=${onCancel}>Cancel</button>
      </div>
    </form>
  `;
}

export default function AgentTasksSubtab({ agentName, session, showToast }) {
  const [tasks, setTasks] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState(null);

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
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  const active = tasks.filter(t => t.status === 'active');
  const queued = tasks.filter(t => t.status === 'queued' || t.status === 'draft');
  const completed = tasks.filter(t => t.status === 'done' || t.status === 'failed' || t.status === 'stalled');

  return html`
    <div>
      <div class="agd-section-header">
        <span class="agd-section-title">
          TASK QUEUE${tasks.length > 0 ? ` (${tasks.length})` : ''}
        </span>
        <button class="btn-outline btn-sm" onClick=${() => setShowCreate(!showCreate)}>
          ${showCreate ? '-' : '+'} New Task
        </button>
      </div>

      ${showCreate && html`
        <${TaskCreateForm} agentName=${agentName} showToast=${showToast} onCreated=${handleCreated} onCancel=${() => setShowCreate(false)} />
      `}

      ${error && html`<div class="agd-empty">${error}</div>`}

      ${active.length > 0 && html`
        <div class="agd-section-title" style="margin-top:0.5rem;margin-bottom:0.25rem">ACTIVE</div>
        ${active.map(task => html`<${TaskItem} key=${task.id} task=${task} agentName=${agentName} showToast=${showToast} onRefresh=${loadTasks} />`)}
      `}

      ${queued.length > 0 && html`
        <div class="agd-section-title" style="margin-top:0.5rem;margin-bottom:0.25rem">QUEUED</div>
        ${queued.map(task => html`<${TaskItem} key=${task.id} task=${task} agentName=${agentName} showToast=${showToast} onRefresh=${loadTasks} />`)}
      `}

      ${completed.length > 0 && html`
        <div class="agd-section-title" style="margin-top:0.5rem;margin-bottom:0.25rem">COMPLETED</div>
        ${completed.map(task => html`<${TaskItem} key=${task.id} task=${task} agentName=${agentName} showToast=${showToast} onRefresh=${loadTasks} />`)}
      `}

      ${tasks.length === 0 && !showCreate && html`
        <div class="agd-empty">No tasks yet. Create one to get started.</div>
      `}
    </div>
  `;
}
