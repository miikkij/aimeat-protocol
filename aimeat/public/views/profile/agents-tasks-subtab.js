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
 *   v4.12.0 -- 2026-06-13 -- Render image deliverables: the task deliverable preview + per-task
 *     memory entries now show image values (a /v1/pub URL or { url, mime } object) as inline
 *     thumbnails via the shared ImageDeliverable renderer; deliverable value kept raw for detection.
 *   v4.11.0 -- 2026-06-05 -- Show the Delete button on every non-active task
 *     (was queued/draft/revision_requested only) so done/failed/paused/stalled/
 *     archived tasks can be removed; active tasks still use Cancel. The backend
 *     delete also cleans the task's operational traces (events, live-status
 *     memory keys, cancel marker), preserving the deliverable.
 *   v4.10.0 -- 2026-06-03 -- Deep-link support: AgentTasksSubtab accepts
 *     openTaskId + openTaskNonce; a nonce bump resets the bucket to 'recent'
 *     (clears search/time) so the target task is visible, and TaskItem auto-opens
 *     (expand + fetch events + scroll into view). Lets the fleet "running now"
 *     panel jump straight to a specific task.
 *   v4.9.1 -- 2026-06-03 -- Fix: task Scope row rendered structured provenance
 *     entries (e.g. the scheduler's { name, value, type, description }) as
 *     "[object Object]" via a naive join(). Add formatScopeEntry() and render
 *     each entry on its own line as "name: value — description".
 *   v4.9.0 -- 2026-06-03 -- Render a task's description as Markdown via the shared
 *     safe Markdown component (headings, lists, code, line breaks) instead of a
 *     single collapsed text blob, so long agent-authored prompts are readable.
 *   v4.8.3 -- 2026-06-02 -- Render non-JSON memory values (e.g. an agent's
 *     latest_output) as Markdown via the shared safe Markdown component, instead
 *     of raw monospace text.
 *   v4.8.2 -- 2026-06-01 -- Render JSON memory values as a structured key/value
 *     tree (indented nested blocks, type-coloured values) instead of raw JSON text.
 *   v4.8.1 -- 2026-06-01 -- Per-task memory entries are now collapsible; values
 *     render as pretty-printed JSON when valid (raw otherwise). Add deliverableKey
 *     as a third lookup source alongside the task:<id> tag and live-key prefix.
 *   v4.8.0 -- 2026-06-01 -- Show a task's memory entries in the expanded view:
 *     entries tagged task:<id> + the live-status key prefix, deduped by key.
 *   v4.7.0 -- 2026-06-01 -- Triage: replace status pills with Recent/Keep/Archive
 *     buckets (server-derived, with counts), on-demand search (🔍 toggle) + time
 *     chips, and per-task Keep/Archive/Restore actions. Fetches by bucket/q/time.
 *   v4.6.0 -- 2026-06-01 -- Add "max concurrent tasks" runner config (number input,
 *     default 1) that PATCHes /v1/agents/:name/max-concurrent-tasks. Consumed by
 *     the agent's runner (e.g. a CrewAI daemon) via the integration kit.
 *   v4.5.0 -- 2026-05-31 -- Extract RateModal to shared ./agents/rate-modal.js
 *     so the Quality tab can reuse it; no behaviour change here.
 *   v4.4.0 -- 2026-05-31 -- Add owner "Rate deliverable" control on done tasks
 *     (RateModal: stars + context + source-grounded + comment) wired to
 *     POST /tasks/:id/rate; shows the current rating with a re-rate affordance.
 *   v4.3.0 -- 2026-05-31 -- Add per-task "blur title" toggle in the collapsed
 *     task row (eye icon). Hides a task title behind a CSS blur for screen
 *     recordings; preference persists per task ID in localStorage (browser-only).
 *   v3.2.0 -- 2026-05-24 -- Add interactive filter pills, scope/rules display, migrate to pf-agd- CSS prefix
 *   v3.1.0 -- 2026-05-24 -- Fix: use correct locale key for empty state
 *   v3.0.0 -- 2026-05-22 -- Replace TaskCreateForm with TaskCreationBuilder (design spec split-panel)
 *   v2.1.0 -- 2026-05-22 -- Fix: use camelCase field names from API; add task and todo timestamps
 *   v2.0.0 -- 2026-05-22 -- Add todo rendering, Start button, progress tracking
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 *   v3.3.0 -- 2026-05-29 -- Add delete confirmation, "Request changes" modal for the revise-proposed-todos flow, outdated-todo history rendering, and revision_requested status.
 *   v3.3.1 -- 2026-05-30 -- Re-fetch the event log on every live-update tick while a task card is expanded. Without this, the parent refreshed the task object (todos + status) but the events list under it stayed frozen until the user closed and re-opened the card.
 *   v4.2.0 -- 2026-05-31 -- Add owner "Cancel" on active/stalled tasks: writes an
 *     agents.cancel.task.<id> marker (worker daemons self-skip before kickoff) +
 *     natively pauses the active task for immediate effect.
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
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { apiGet, apiPost } from '/js/api.js';
import { listTasks, deleteTask, startTask, listEvents, requestChanges, createTask, rateTask, setTaskTriage } from '/js/services/agent-tasks.js';
import { setMaxConcurrentTasks } from '/js/services/agents.js';
import { useConfirm, Modal } from '/components/Modal.js';
import { Markdown } from '/components/Markdown.js';
import { detectImage, ImageView, DeliverableBody } from '/components/ImageDeliverable.js';
import RateModal from './agents/rate-modal.js';

// Tasks-tab triage buckets (server-derived) + on-demand search time chips.
const BUCKETS = ['recent', 'keep', 'archive'];
const TIME_CHIPS = ['all', 'today', '7d', '30d'];

/** Map a time chip to an `updated_after` ISO bound (undefined = no bound). */
function timeChipToAfter(chip) {
  const now = new Date();
  if (chip === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (chip === '7d') return new Date(now.getTime() - 7 * 86400000).toISOString();
  if (chip === '30d') return new Date(now.getTime() - 30 * 86400000).toISOString();
  return undefined;
}

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
  try { localStorage.setItem(BLUR_STORAGE_KEY, JSON.stringify([...set])); } catch { /* storage full/blocked -- preference just won't persist */ }
}

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

function TaskItem({ task, agentName, showToast, onRefresh, autoOpen = 0 }) {
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
    } catch {
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
        apiGet(`/v1/memory?agent=${encodeURIComponent(gaii)}&tags=${encodeURIComponent(tag)}&per_page=50`).catch(() => null),
        apiGet(`/v1/memory?agent=${encodeURIComponent(gaii)}&prefix=${encodeURIComponent(livePrefix)}&per_page=20`).catch(() => null),
      ];
      if (task.deliverableKey) {
        fetches.push(apiGet(`/v1/memory?agent=${encodeURIComponent(gaii)}&prefix=${encodeURIComponent(task.deliverableKey)}&per_page=5`).catch(() => null));
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
    } catch {
      setTaskMemory({ items: [] });
    }
  }

  const fetchEvents = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadingEvents(true);
    try {
      const resp = await listEvents(agentName, task.id);
      setEvents(resp?.data?.events || []);
    } catch { setEvents([]); }
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
            try { await apiPost(`/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(task.id)}/pause`, {}); } catch { /* marker still applies */ }
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

export default function AgentTasksSubtab({ agent, agentName, showToast, openTaskId = null, openTaskNonce = 0 }) {
  const [tasks, setTasks] = useState(null);
  const [counts, setCounts] = useState({ recent: 0, keep: 0, archive: 0 });
  const [bucket, setBucket] = useState('recent');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [timeChip, setTimeChip] = useState('all');
  // Runner concurrency config (default 1 = serial). Saved to the agent via PATCH.
  const [maxConcurrent, setMaxConcurrent] = useState(agent?.max_concurrent_tasks ?? 1);
  const [savingConcurrency, setSavingConcurrency] = useState(false);

  async function handleSaveConcurrency(next) {
    const n = Math.max(1, Math.min(20, parseInt(next, 10) || 1));
    setMaxConcurrent(n);
    if (n === (agent?.max_concurrent_tasks ?? 1)) return;
    setSavingConcurrency(true);
    try {
      await setMaxConcurrentTasks(agentName, n);
      if (agent) agent.max_concurrent_tasks = n;
      showToast?.(t('profile.agents.tasks.concurrency.saved'));
    } catch (err) {
      showToast?.(err.message || t('profile.agents.tasks.concurrency.error'), true);
    }
    setSavingConcurrency(false);
  }

  async function loadTasks() {
    try {
      const resp = await listTasks(agentName, {
        bucket,
        q: q.trim() || undefined,
        updated_after: timeChipToAfter(timeChip),
        per_page: 100,
      });
      setTasks(resp?.data?.tasks || []);
      setCounts(resp?.data?.counts || { recent: 0, keep: 0, archive: 0 });
      setError(null);
    } catch (err) {
      setError(err.message);
      setTasks([]);
    }
  }

  // Refetch on agent/bucket/time change immediately; debounce text search.
  useEffect(() => {
    const id = setTimeout(() => loadTasks(), q ? 300 : 0);
    return () => clearTimeout(id);
    // Debounced refetch driven by the query inputs; loadTasks closes over exactly
    // agentName/bucket/timeChip/q (all listed). Listing it (new identity each render)
    // would reset the debounce timer on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName, bucket, timeChip, q]);

  const loadRef = useRef(loadTasks);
  loadRef.current = loadTasks;
  useEffect(() => onLiveUpdate(['agent-tasks'], () => loadRef.current()), []);

  // Deep-link (from the fleet "running now" panel): a target task may live in a
  // bucket/filter that isn't currently shown. Reset to the default Recent view
  // (where active tasks always appear) so the target TaskItem renders and can
  // auto-open. Keyed on the nonce so repeat clicks re-trigger.
  useEffect(() => {
    if (!openTaskId || !openTaskNonce) return;
    setBucket('recent');
    setQ('');
    setTimeChip('all');
  }, [openTaskId, openTaskNonce]);

  function handleCreated() {
    setShowCreate(false);
    loadTasks();
  }

  if (tasks === null) {
    return html`<div class="pf-agd-empty">${t('profile.loading')}</div>`;
  }

  const totalTasks = counts.recent + counts.keep + counts.archive;

  return html`
    <div>
      <div class="pf-agd-section-header">
        <span class="pf-agd-section-title">
          ${t('profile.agents.tasks.title')}${totalTasks > 0 ? ` (${totalTasks})` : ''}
        </span>
        <button class="btn-outline btn-sm" onClick=${() => setShowCreate(!showCreate)}>
          ${showCreate ? '-' : '+'} ${t('profile.agents.tasks.newTask')}
        </button>
      </div>

      <div class="pf-agd-concurrency">
        <label class="pf-agd-concurrency-label" for="pf-agd-mct-${agentName}">
          ${t('profile.agents.tasks.concurrency.label')}
        </label>
        <input
          id="pf-agd-mct-${agentName}"
          class="pf-agd-concurrency-input"
          type="number"
          min="1"
          max="20"
          value=${maxConcurrent}
          disabled=${savingConcurrency}
          onChange=${e => handleSaveConcurrency(e.target.value)}
        />
        <span class="pf-agd-concurrency-hint">${t('profile.agents.tasks.concurrency.hint')}</span>
      </div>

      ${showCreate && html`
        <${TaskCreateForm} agentName=${agentName} showToast=${showToast} onCreated=${handleCreated} onCancel=${() => setShowCreate(false)} />
      `}

      ${error && html`<div class="pf-agd-empty">${error}</div>`}

      <div class="pf-agd-bucket-bar">
        ${BUCKETS.map(b => html`
          <button key=${b}
                  class="pf-agd-bucket ${bucket === b ? 'pf-agd-bucket--active' : ''}"
                  onClick=${() => setBucket(b)}>
            ${t(`profile.agents.tasks.bucket.${b}`)} <span class="pf-agd-bucket-count">${counts[b] ?? 0}</span>
          </button>
        `)}
        <span class="pf-agd-bucket-spacer"></span>
        <button class="pf-agd-search-toggle ${searchOpen ? 'pf-agd-search-toggle--on' : ''}"
                onClick=${() => setSearchOpen(o => !o)}
                title=${t('profile.agents.tasks.search.toggle')}
                aria-pressed=${searchOpen}>🔍</button>
      </div>

      ${searchOpen && html`
        <div class="pf-agd-search-bar">
          <input class="pf-agd-search-input" type="search"
                 placeholder=${t('profile.agents.tasks.search.placeholder')}
                 value=${q} onInput=${e => setQ(e.target.value)} />
          <div class="pf-agd-time-chips">
            ${TIME_CHIPS.map(c => html`
              <button key=${c}
                      class="pf-agd-time-chip ${timeChip === c ? 'pf-agd-time-chip--on' : ''}"
                      onClick=${() => setTimeChip(c)}>
                ${t(`profile.agents.tasks.search.time.${c}`)}
              </button>
            `)}
          </div>
        </div>
      `}

      ${tasks.length > 0 ? tasks.map(task => html`
        <${TaskItem} key=${task.id} task=${task} agentName=${agentName} showToast=${showToast} onRefresh=${loadTasks}
          autoOpen=${task.id === openTaskId ? openTaskNonce : 0} />
      `) : html`
        <div class="pf-agd-empty">${q ? t('profile.agents.tasks.search.noResults') : t(`profile.agents.tasks.bucket.empty.${bucket}`)}</div>
      `}
    </div>
  `;
}
