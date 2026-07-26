/**
 * @file public/views/profile/agents/task-item.js
 * @description Single task row for the agent Tasks sub-tab: expand/collapse, todo plan,
 *   deliverable + per-task memory preview, start/cancel/delete/rate/triage actions, plus its
 *   helper renderers (status labels, JSON tree, memory entry, request-changes modal, blur
 *   preference). Extracted from ../agents-tasks-subtab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from views/profile/agents-tasks-subtab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { apiGet, apiPost } from '/js/api.js';
import { deleteTask, startTask, listEvents, requestChanges, rateTask, setTaskTriage } from '/js/services/agent-tasks.js';
import { useConfirm, Modal } from '/components/Modal.js';
import { Markdown } from '/components/Markdown.js';
import { detectImage, ImageView, DeliverableBody } from '/components/ImageDeliverable.js';
import RateModal from './rate-modal.js';
import { swallowed } from '/js/swallowed.js';

// Per-browser "blur the title" preference. Used when screen-recording the tab
// so sensitive task titles can be hidden without affecting other viewers or
// the server. Stored as an array of task IDs in localStorage; survives reloads
// but never leaves this browser.
const BLUR_STORAGE_KEY = 'aimeat.blurredTaskTitles';

function readBlurredSet() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BLUR_STORAGE_KEY));
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch { return new Set(); }
}

function isTaskBlurred(taskId) {
  return readBlurredSet().has(taskId);
}

function setTaskBlurred(taskId, blurred) {
  const set = readBlurredSet();
  if (blurred) set.add(taskId); else set.delete(taskId);
  // eslint-disable-next-line aimeat/no-silent-catch -- storage full/blocked -- preference just won't persist
  try { localStorage.setItem(BLUR_STORAGE_KEY, JSON.stringify([...set])); } catch { /* storage full/blocked -- preference just won't persist */ }
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

// Render one task scope entry as readable text. Scope is an array whose entries
// may be plain strings (legacy free-text scopes) or structured provenance objects
// stamped by the scheduler, e.g.
//   { name:'schedule', value:'0 9 * * *', type:'cron', description:'Uutisputki – aamukirjoitus' }
// A naive join()/String() prints "[object Object]" for the structured form, so
// format the parts we know into e.g. "schedule: 0 9 * * * — Uutisputki – aamukirjoitus".
function formatScopeEntry(s) {
  if (s == null) return '';
  if (typeof s !== 'object') return String(s);
  const head = s.name || s.type || '';
  const val = s.value != null && s.value !== '' ? String(s.value) : '';
  const lead = [head, val].filter(Boolean).join(': ');
  const desc = s.description ? ` — ${s.description}` : '';
  const out = `${lead}${desc}`.trim();
  return out || JSON.stringify(s);
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

// Parse a memory value into structured JSON when possible. Returns { json } for
// objects (or strings that parse as JSON), or { raw } for plain text/markdown.
function parseMemoryValue(value) {
  if (value === null || value === undefined) return { raw: '' };
  if (typeof value === 'object') return { json: value };
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && (trimmed[0] === '{' || trimmed[0] === '[')) {
      try { return { json: JSON.parse(trimmed) }; }
      // eslint-disable-next-line aimeat/no-silent-catch -- not JSON after all -- show raw
      catch { /* not JSON after all -- show raw */ }
    }
    return { raw: value };
  }
  return { raw: String(value) };
}

// Recursive structured JSON renderer: objects/arrays become indented key/value
// rows, primitives get type-coloured values. Far easier to scan than raw JSON.
function JsonNode({ value }) {
  if (value === null) return html`<span class="pf-agd-json-null">null</span>`;
  const t = typeof value;
  if (t === 'string') return html`<span class="pf-agd-json-str">${value}</span>`;
  if (t === 'number') return html`<span class="pf-agd-json-num">${value}</span>`;
  if (t === 'boolean') return html`<span class="pf-agd-json-bool">${value ? 'true' : 'false'}</span>`;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value || {});
  if (entries.length === 0) return html`<span class="pf-agd-json-empty">${Array.isArray(value) ? '[ ]' : '{ }'}</span>`;
  return html`
    <div class="pf-agd-json-block">
      ${entries.map(([k, v]) => {
        const nested = v !== null && typeof v === 'object';
        return html`
          <div class=${`pf-agd-json-row ${nested ? 'pf-agd-json-row--nested' : ''}`} key=${k}>
            <span class="pf-agd-json-key">${k}</span>
            <${JsonNode} value=${v} />
          </div>
        `;
      })}
    </div>
  `;
}

// One collapsible memory entry. Header (key + JSON badge) toggles the body, which
// renders a structured JSON view when the value is JSON, raw text otherwise.
function TaskMemoryEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const { json, raw } = parseMemoryValue(entry.value);
  const isJson = json !== undefined;
  // A memory value that IS an image (a /v1/pub URL string, or a { url, mime:image/* } object such as
  // crews.image-maker.images.<id>) renders as a thumbnail instead of a JSON/text blob.
  const image = detectImage(isJson ? json : raw, entry.key);
  return html`
    <div class="pf-agd-task-memory-entry">
      <button class="pf-agd-task-memory-head" onClick=${(e) => { e.stopPropagation(); setOpen(o => !o); }} aria-expanded=${open}>
        <span class="pf-agd-task-memory-caret">${open ? '▼' : '▶'}</span>
        <code class="pf-agd-task-memory-key">${entry.key}</code>
        ${image ? html`<span class="pf-agd-task-memory-badge">IMG</span>` : isJson && html`<span class="pf-agd-task-memory-badge">JSON</span>`}
      </button>
      ${open && html`
        <div class="pf-agd-task-memory-body">
          ${image
            ? html`<${ImageView} desc=${image} />`
            : isJson
              ? html`<${JsonNode} value=${json} />`
              // Non-JSON values (e.g. an agent's latest_output) are usually
              // markdown — render them formatted via the shared safe Markdown
              // component instead of raw text.
              : html`<div class="pf-agd-task-memory-md"><${Markdown} text=${raw} /></div>`}
        </div>
      `}
    </div>
  `;
}

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
  // task ID in localStorage; see helpers at top of file.
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

  function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' +
           d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return html`
    <div ref=${taskRef}>
      <div class="pf-agd-task-item" onClick=${handleExpand}>
        <div class="pf-agd-task-title-row">
          <button
            class=${`pf-agd-blur-toggle ${blurred ? 'pf-agd-blur-toggle--on' : ''}`}
            onClick=${handleToggleBlur}
            title=${blurred ? t('profile.agents.tasks.unblurTitle') : t('profile.agents.tasks.blurTitle')}
            aria-pressed=${blurred}
          >${blurred ? '🙈' : '👁'}</button>
          <span class=${`pf-agd-task-title ${blurred ? 'pf-agd-task-title--blurred' : ''}`}>${task.title || task.id}</span>
          ${progress && html`<span class="pf-agd-todo-progress">${progress}</span>`}
        </div>
        <div class="pf-agd-task-meta">
          ${task.createdAt && html`<span class="pf-agd-task-time">${timeAgo(task.createdAt)}</span>`}
          <span class="pf-agd-status pf-agd-status-${task.status || 'draft'}">${statusLabel(task.status || 'draft')}</span>
        </div>
      </div>
      ${expanded && html`
        <div class="pf-agd-task-expanded">
          ${task.description && html`<div class="pf-agd-task-desc"><${Markdown} text=${task.description} /></div>`}

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
                  : html`<div class="pf-agd-memory-preview"><${DeliverableBody} value=${deliverable.value} alt=${task.title || task.description} /></div>`}
            `}
          `}

          <div class="pf-agd-task-memory">
            <button class="btn-ghost btn-sm" onClick=${(e) => { e.stopPropagation(); fetchTaskMemory(); }}>
              ${t('profile.agents.tasks.memory.show')}
            </button>
            ${taskMemory && (taskMemory.loading
              ? html`<div class="pf-agd-empty">${t('profile.loading')}</div>`
              : taskMemory.items.length === 0
                ? html`<div class="pf-agd-empty">${t('profile.agents.tasks.memory.none')}</div>`
                : html`
                  <div class="pf-agd-task-memory-list">
                    ${taskMemory.items.map(it => html`<${TaskMemoryEntry} key=${it.key} entry=${it} />`)}
                  </div>
                `)}
          </div>

          ${isDone && html`
            <div class="pf-agd-rate-row">
              ${rating
                ? html`
                  <span class="pf-agd-rate-current">
                    <span class="pf-agd-rate-current-stars">${'★★★★★'.slice(0, rating.stars)}${'☆☆☆☆☆'.slice(0, 5 - rating.stars)}</span>
                    <span class="pf-agd-rate-current-ctx">${t(`profile.agents.detail.quality.contexts.${rating.context}`)}</span>
                    ${rating.comment && html`<span class="pf-agd-rate-current-comment">${rating.comment}</span>`}
                  </span>
                  <button class="btn-ghost btn-sm" onClick=${handleOpenRate}>${t('profile.agents.tasks.rate.rerate')}</button>
                `
                : html`<button class="btn-outline btn-sm" onClick=${handleOpenRate}>${t('profile.agents.tasks.rate.button')}</button>`}
            </div>
          `}

          ${task.scope && (!Array.isArray(task.scope) || task.scope.length > 0) && html`
            <div class="pf-agd-info-row">
              <span class="pf-agd-info-label">${t('profile.agents.detail.tasks.scope')}</span>
              <span class="pf-agd-info-value">
                ${Array.isArray(task.scope)
                  ? task.scope.map((s, i) => html`<div key=${i}>${formatScopeEntry(s)}</div>`)
                  : formatScopeEntry(task.scope)}
              </span>
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
            ${(isActive || task.status === 'stalled') && html`
              <button class="btn-danger btn-sm" onClick=${handleCancel}>${t('profile.agents.tasks.cancel')}</button>
            `}
            ${canDelete && html`
              <button class="btn-danger btn-sm" onClick=${handleDelete}>${t('profile.agents.tasks.delete')}</button>
            `}
            <span class="pf-agd-task-actions-spacer"></span>
            ${task.triage !== 'kept' && html`
              <button class="btn-ghost btn-sm" onClick=${(e) => handleTriage(e, 'kept')} title=${t('profile.agents.tasks.triage.keepHint')}>★ ${t('profile.agents.tasks.triage.keep')}</button>
            `}
            ${task.triage !== 'archived' && html`
              <button class="btn-ghost btn-sm" onClick=${(e) => handleTriage(e, 'archived')} title=${t('profile.agents.tasks.triage.archiveHint')}>${t('profile.agents.tasks.triage.archive')}</button>
            `}
            ${task.triage && html`
              <button class="btn-ghost btn-sm" onClick=${(e) => handleTriage(e, null)}>${t('profile.agents.tasks.triage.restore')}</button>
            `}
          </div>
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
        </div>
      `}
    </div>
  `;
}
