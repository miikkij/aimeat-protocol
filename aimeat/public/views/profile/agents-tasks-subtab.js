/**
 * @file agents-tasks-subtab.js
 * @description Task queue sub-tab for agent detail view.
 *   Shows queued, active, and completed tasks with inline creation form.
 *   Listens for live updates to refresh task data automatically.
 * @structure
 *   - AgentTasksSubtab (default export) -- main component
 *   - TaskItem -- individual task row with expand/collapse
 *   - TaskCreateForm -- inline task creation form
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { listTasks, createTask, deleteTask, listEvents } from '/js/services/agent-tasks.js';

function statusLabel(status) {
  const key = `profile.agents.tasks.status.${status}`;
  const val = t(key);
  // Fallback to capitalized status if translation key not found
  return val !== key ? val : status.charAt(0).toUpperCase() + status.slice(1);
}

function TaskItem({ task, agentName, showToast }) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState(null);
  const [loadingEvents, setLoadingEvents] = useState(false);

  async function handleExpand(e) {
    e.stopPropagation();
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!events) {
      setLoadingEvents(true);
      try {
        const resp = await listEvents(agentName, task.id);
        setEvents(resp?.data?.events || []);
      } catch {
        setEvents([]);
      }
      setLoadingEvents(false);
    }
  }

  async function handleDelete(e) {
    e.stopPropagation();
    try {
      await deleteTask(agentName, task.id);
      const msg = t('profile.agents.tasks.deleted');
      showToast(msg !== 'profile.agents.tasks.deleted' ? msg : 'Task deleted');
    } catch (err) {
      showToast(err.message || 'Failed to delete task', true);
    }
  }

  return html`
    <div>
      <div class="agd-task-item" onClick=${handleExpand}>
        <span class="agd-task-title">${task.title || task.id}</span>
        <div class="agd-task-meta">
          ${task.created_at && html`<span class="agd-task-time">${timeAgo(task.created_at)}</span>`}
          <span class="agd-status agd-status-${task.status || 'draft'}">${statusLabel(task.status || 'draft')}</span>
        </div>
      </div>
      ${expanded && html`
        <div class="agd-task-expanded">
          ${task.description && html`<div class="agd-task-desc">${task.description}</div>`}
          ${task.scope && html`
            <div class="agd-task-desc">
              <strong>${t('profile.agents.tasks.scope') !== 'profile.agents.tasks.scope' ? t('profile.agents.tasks.scope') : 'Scope'}:</strong> ${Array.isArray(task.scope) ? task.scope.join(', ') : task.scope}
            </div>
          `}
          ${loadingEvents && html`<div class="agd-empty">${t('profile.loading')}</div>`}
          ${events && events.length > 0 && html`
            <div class="agd-event-log">
              ${events.map(ev => html`
                <div class="agd-event-item" key=${ev.id || ev.timestamp}>
                  <span class="agd-event-time">${ev.timestamp ? timeAgo(ev.timestamp) : ''}</span>
                  <span class="agd-event-type">${ev.type || ev.event || ''}</span>
                  <span>${ev.message || ev.data || ''}</span>
                </div>
              `)}
            </div>
          `}
          ${events && events.length === 0 && html`
            <div class="agd-empty">${t('profile.agents.tasks.noEvents') !== 'profile.agents.tasks.noEvents' ? t('profile.agents.tasks.noEvents') : 'No events recorded'}</div>
          `}
          <div class="agd-task-actions">
            <button class="btn-danger btn-sm" onClick=${handleDelete}>
              ${t('profile.agents.tasks.delete') !== 'profile.agents.tasks.delete' ? t('profile.agents.tasks.delete') : 'Delete'}
            </button>
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
      const msg = t('profile.agents.tasks.created');
      showToast(msg !== 'profile.agents.tasks.created' ? msg : 'Task created');
      onCreated();
    } catch (err) {
      showToast(err.message || 'Failed to create task', true);
    }
    setSaving(false);
  }

  return html`
    <form class="agd-create-form" onSubmit=${handleSubmit}>
      <div class="agd-form-field">
        <label>${t('profile.agents.tasks.titleLabel') !== 'profile.agents.tasks.titleLabel' ? t('profile.agents.tasks.titleLabel') : 'Title'}</label>
        <input type="text" value=${title} onInput=${(e) => setTitle(e.target.value)}
               placeholder=${t('profile.agents.tasks.titlePlaceholder') !== 'profile.agents.tasks.titlePlaceholder' ? t('profile.agents.tasks.titlePlaceholder') : 'What should the agent do?'}
               required />
      </div>
      <div class="agd-form-field">
        <label>${t('profile.agents.tasks.descriptionLabel') !== 'profile.agents.tasks.descriptionLabel' ? t('profile.agents.tasks.descriptionLabel') : 'Description'}</label>
        <textarea value=${description} onInput=${(e) => setDescription(e.target.value)}
                  placeholder=${t('profile.agents.tasks.descriptionPlaceholder') !== 'profile.agents.tasks.descriptionPlaceholder' ? t('profile.agents.tasks.descriptionPlaceholder') : 'Detailed instructions (optional)'}></textarea>
      </div>
      <div class="agd-form-field">
        <label>${t('profile.agents.tasks.initialStatus') !== 'profile.agents.tasks.initialStatus' ? t('profile.agents.tasks.initialStatus') : 'Initial status'}</label>
        <select value=${status} onChange=${(e) => setStatus(e.target.value)}>
          <option value="draft">${statusLabel('draft')}</option>
          <option value="queued">${statusLabel('queued')}</option>
        </select>
      </div>
      <div class="agd-form-actions">
        <button type="submit" class="btn-primary btn-sm" disabled=${saving || !title.trim()}>
          ${saving
            ? (t('profile.agents.tasks.creating') !== 'profile.agents.tasks.creating' ? t('profile.agents.tasks.creating') : 'Creating...')
            : (t('profile.agents.tasks.createBtn') !== 'profile.agents.tasks.createBtn' ? t('profile.agents.tasks.createBtn') : 'Create Task')}
        </button>
        <button type="button" class="btn-outline btn-sm" onClick=${onCancel}>
          ${t('profile.agents.scopeUi.cancel')}
        </button>
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

  useEffect(() => {
    loadTasks();
  }, [agentName]);

  // Live update listener
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

  // Group tasks by status category
  const active = tasks.filter(t => t.status === 'active');
  const queued = tasks.filter(t => t.status === 'queued' || t.status === 'draft');
  const completed = tasks.filter(t => t.status === 'done' || t.status === 'failed' || t.status === 'stalled');

  return html`
    <div>
      <div class="agd-section-header">
        <span class="agd-section-title">
          ${t('profile.agents.tasks.title') !== 'profile.agents.tasks.title' ? t('profile.agents.tasks.title') : 'Tasks'}
          ${tasks.length > 0 && html` (${tasks.length})`}
        </span>
        <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); setShowCreate(!showCreate); }}>
          ${showCreate ? '-' : '+'} ${t('profile.agents.tasks.newTask') !== 'profile.agents.tasks.newTask' ? t('profile.agents.tasks.newTask') : 'New Task'}
        </button>
      </div>

      ${showCreate && html`
        <${TaskCreateForm} agentName=${agentName} showToast=${showToast} onCreated=${handleCreated} onCancel=${() => setShowCreate(false)} />
      `}

      ${error && html`<div class="agd-empty">${error}</div>`}

      ${active.length > 0 && html`
        <div class="agd-section-title" style="margin-top:0.5rem;margin-bottom:0.25rem">
          ${t('profile.agents.tasks.activeSection') !== 'profile.agents.tasks.activeSection' ? t('profile.agents.tasks.activeSection') : 'Active'}
        </div>
        ${active.map(task => html`<${TaskItem} key=${task.id} task=${task} agentName=${agentName} showToast=${showToast} />`)}
      `}

      ${queued.length > 0 && html`
        <div class="agd-section-title" style="margin-top:0.5rem;margin-bottom:0.25rem">
          ${t('profile.agents.tasks.queuedSection') !== 'profile.agents.tasks.queuedSection' ? t('profile.agents.tasks.queuedSection') : 'Queued'}
        </div>
        ${queued.map(task => html`<${TaskItem} key=${task.id} task=${task} agentName=${agentName} showToast=${showToast} />`)}
      `}

      ${completed.length > 0 && html`
        <div class="agd-section-title" style="margin-top:0.5rem;margin-bottom:0.25rem">
          ${t('profile.agents.tasks.completedSection') !== 'profile.agents.tasks.completedSection' ? t('profile.agents.tasks.completedSection') : 'Completed'}
        </div>
        ${completed.map(task => html`<${TaskItem} key=${task.id} task=${task} agentName=${agentName} showToast=${showToast} />`)}
      `}

      ${tasks.length === 0 && !showCreate && html`
        <div class="agd-empty">
          ${t('profile.agents.tasks.empty') !== 'profile.agents.tasks.empty' ? t('profile.agents.tasks.empty') : 'No tasks yet. Create one to get started.'}
        </div>
      `}
    </div>
  `;
}
