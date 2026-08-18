/**
 * @file agents-tasks-subtab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Task queue sub-tab for agent detail view.
 *   Shows queued, active, and completed tasks with todo plans,
 *   "Start this task" approval button, and progress tracking.
 *   Filter pills allow switching between all/active/queued/completed/failed views.
 * @structure
 *   - AgentTasksSubtab (default export) -- main component with filter pills + create form
 *   - TaskCreateForm -- plain create form (description + optional title)
 *   - TaskItem + its helpers (status labels, JSON tree, memory entry, RequestChangesModal,
 *     blur preference) now live in ./agents/task-item.js (extracted for max-file-lines)
 * @version-history
 *   v4.13.0 -- 2026-07-13 -- Split (max-file-lines): moved TaskItem and its helper renderers
 *     (statusLabel/todoStatusIcon/formatScopeEntry/todoProgress, parseMemoryValue/JsonNode/
 *     TaskMemoryEntry, RequestChangesModal, blur-preference helpers) into ./agents/task-item.js.
 *     No behaviour change.
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
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { listTasks, createTask } from '/js/services/agent-tasks.js';
import { setMaxConcurrentTasks } from '/js/services/agents.js';
import { TaskItem } from './agents/task-item.js';

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
