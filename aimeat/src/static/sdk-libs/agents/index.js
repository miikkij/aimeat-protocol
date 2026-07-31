/**
 * @file agents/index.js
 * @description The aimeat-agents library (SDK-libs migration Phase 1). Exposes AIMEAT.agents — the
 *   owner-side helper an AIMEAT app uses to commission and observe the owner's agents: list/get,
 *   createTask/run, getTask/tasks/events, watch (SSE + poll fallback), deliverable/memory,
 *   pendingPrompts/answerPrompt, and cooperative cancelTask/cancelRun/cancelledTaskIds. All over the
 *   AIMEAT.auth session. Componentized ESM source esbuild bundles to the IIFE served, unchanged, at
 *   /v1/libs/aimeat-agents.js. Ported verbatim from lib-agents.ts.
 * @structure imports authFetch (session) + attach (namespace); unwrap() envelope helper; the
 *   `agents` object; attach('agents', …). Errors throw with a `.code` (NOT_FOUND/FORBIDDEN/UNKNOWN/TIMEOUT).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-agents.js"></script>
 *   const { task, deliverable } = await AIMEAT.agents.run('my-agent', { description: '…' });
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-agents.ts (SDK-libs migration Phase 1).
 *   v1.2.1 — 2026-07-31 — Forward idempotencyKey/allowDuplicate to the node's own live-commission
 *     guard and surface its answer as task.deduplicated (+ reason), so an app can say "already
 *     running" after a reload instead of claiming it queued a second run.
 *   v1.2.0 — 2026-07-31 — Spend guard: an identical commission in flight (and for 60s after it
 *     succeeded) returns THAT task instead of queueing a second one, so a double-click no longer
 *     buys two agent runs; createTask/run take { confirm, allowDuplicate, dedupeMs }.
 *   v1.1.0 — 2026-07-25 — createTask() forwards scope/verification/rules/resources (previously it
 *     sent only title+description+status, so an app could not tag its own runs through this library
 *     and had to hand-roll the POST). deliverable() falls back to the `task:<id>` memory tag when the
 *     agent never set task.deliverableKey. Additive.
 */
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-agents.js');
import { attach } from '../_core/namespace.js';
import { once, keyOf, confirmSpend, cancelledError, attachSpend } from '../_core/spend.js';

// A second identical commission this soon after the first is a double-click, not a second job.
var DEDUPE_MS = 60000;

var enc = encodeURIComponent;

// session.fetch returns the parsed AIMEAT envelope { ok, data, error }.
function unwrap(r, action) {
  if (!r || !r.ok) {
    var err = /** @type {Error & { code?: string }} */ (new Error((r && r.error && r.error.message) || (action + ' failed')));
    err.code = (r && r.error && r.error.code) || 'UNKNOWN';
    throw err;
  }
  return r.data;
}

// 30s cache for list() so apps can call it on every render cheaply.
var _agentsCache = null;
// 10s cache for the cancelled-task-id set.
var _cancelSetCache = null;

var agents = {
  /** List the owner's agents. opts.activeOnly filters to ones seen recently.
   *  opts.fresh bypasses the 30s cache. */
  async list(opts) {
    var now = Date.now();
    if (!(opts && opts.fresh) && _agentsCache && (now - _agentsCache.t) < 30000) return _agentsCache.v;
    var data = unwrap(await authFetch('/v1/agents'), 'list agents');
    var v = data.agents || [];
    _agentsCache = { v: v, t: now };
    return (opts && opts.activeOnly) ? v.filter(function (a) { return !!a.last_seen; }) : v;
  },

  /** One agent by name (or GAII), or null. */
  async get(name) {
    var all = await agents.list();
    return all.find(function (a) { return a.name === name || a.gaii === name; }) || null;
  },

  /** Commission a task for an agent. Returns the created task ({ id, status, ... }).
   *  Created 'queued' by default; task-runner agents auto-activate it.
   *
   *  task.scope: [{ name, value, type }] — app-defined tags stored ON the task. This is how
   *  an app finds its own runs again later: filter `tasks({status:'done'})` on a tag you set,
   *  instead of trying to parse the agent's memory-key slug. Pass the same array in a
   *  schedule's `task_template.scope` so scheduled runs carry it too.
   *  task.verification: { user_expects, technical_checks } — what a good result looks like.
   *  Both were silently dropped before v1.1.0.
   *
   *  A commission costs the owner real work (an agent run, its model spend), so repeats are
   *  collapsed by default: while an identical commission (same agent + title + description) is in
   *  flight — and for 60s after it succeeded — every further call returns THAT task instead of
   *  queueing another. Five clicks = one task.
   *  The NODE runs the same guard where this page cannot see — across a reload, a second tab, a
   *  retrying script: while an identical commission is still open it returns THAT task and marks it
   *  `task.deduplicated === true` (+ `task.deduplicated_reason`). Show that instead of "queued!".
   *
   *  opts: { confirm, allowDuplicate, dedupeMs, idempotencyKey }
   *    confirm       — true (or an object for AIMEAT.spend.confirm) asks the user first; a cancel
   *                    rejects with `.code === 'SPEND_CANCELLED'`
   *    allowDuplicate— genuinely commission the same thing twice (skips both guards)
   *    dedupeMs      — widen/narrow the 60s settle window (this page only)
   *    idempotencyKey— name the job yourself (a form submit id, a row id) instead of letting the
   *                    node fingerprint title+description */
  async createTask(name, task, opts) {
    if (!task || !task.description) throw new Error('createTask requires { description }');
    var body = {
      title: task.title || task.description.slice(0, 80),
      description: task.description,
      status: task.status || 'queued',
    };
    if (Array.isArray(task.scope) && task.scope.length) {
      body.scope = task.scope.map(function (s) {
        return { name: s.name, value: String(s.value), type: s.type || 'text',
          ...(s.description ? { description: s.description } : {}) };
      });
    }
    if (task.verification) {
      // Accept either casing; the route reads snake_case.
      var v = task.verification;
      body.verification = {
        user_expects: v.user_expects != null ? v.user_expects : (v.userExpects || ''),
        technical_checks: v.technical_checks || v.technicalChecks || [],
      };
    }
    if (task.rules) body.rules = task.rules;
    if (task.resources) body.resources = task.resources;
    var o = opts || {};
    if (o.idempotencyKey) body.idempotency_key = o.idempotencyKey;
    if (o.allowDuplicate) body.allow_duplicate = true;
    var commission = async function () {
      if (o.confirm) {
        var c = typeof o.confirm === 'object' ? o.confirm : {};
        var okToSpend = await confirmSpend({
          what: c.what || ('Commission ' + name + ': ' + body.title),
          detail: c.detail !== undefined ? c.detail : body.description,
          estimate: c.estimate, remaining: c.remaining,
          okLabel: c.okLabel, cancelLabel: c.cancelLabel, remember: c.remember,
        });
        if (!okToSpend) throw cancelledError('The commission');
      }
      var data = unwrap(await authFetch('/v1/agents/' + enc(name) + '/tasks', {
        method: 'POST', body: JSON.stringify(body),
      }), 'create task');
      // The node runs the same guard across reloads and tabs, where this page's in-flight map is
      // empty. When it answers "you already have this one running", say so on the returned task —
      // an app that reports "queued!" for a run it did not queue is lying to the user.
      if (data.deduplicated && data.task) {
        data.task.deduplicated = true;
        data.task.deduplicated_reason = data.deduplicated_reason;
      }
      return data.task;
    };
    if (o.allowDuplicate) return commission();
    return once(keyOf(['agents.createTask', name, body.title, body.description]), commission, {
      ttlMs: typeof o.dedupeMs === 'number' ? o.dedupeMs : DEDUPE_MS,
    });
  },

  /** Get a single task. */
  async getTask(name, id) {
    return unwrap(await authFetch('/v1/agents/' + enc(name) + '/tasks/' + enc(id)), 'get task').task;
  },

  /** List an agent's tasks. opts.status filters (queued|active|done|failed|...). */
  async tasks(name, opts) {
    var q = '?per_page=100' + (opts && opts.status ? ('&status=' + enc(opts.status)) : '');
    return unwrap(await authFetch('/v1/agents/' + enc(name) + '/tasks' + q), 'list tasks').tasks || [];
  },

  /** The task's event log (oldest-first). */
  async events(name, id) {
    return unwrap(await authFetch('/v1/agents/' + enc(name) + '/tasks/' + enc(id) + '/events'), 'list events').events || [];
  },

  /** Live-watch a task: calls onUpdate(task, events) on every server change
   *  (SSE) plus a periodic poll as a safety net. Returns an unsubscribe fn. */
  watch(name, id, onUpdate, opts) {
    var stopped = false, es = null, pollTimer = null, debTimer = null;
    var pollMs = (opts && opts.pollMs) || 15000;
    async function refresh() {
      if (stopped) return;
      try {
        var task = await agents.getTask(name, id);
        var events = await agents.events(name, id);
        if (!stopped && typeof onUpdate === 'function') onUpdate(task, events);
      } catch { /* transient; the poll/next tick retries */ }
    }
    function debounced() { clearTimeout(debTimer); debTimer = setTimeout(refresh, 400); }
    refresh();
    pollTimer = setInterval(refresh, pollMs);
    (async function () {
      try {
        var tk = unwrap(await authFetch('/v1/events/ticket', { method: 'POST' }), 'open event stream');
        if (stopped || !tk || !tk.ticket) return;
        es = new EventSource('/v1/events?ticket=' + enc(tk.ticket));
        es.onmessage = debounced;
      } catch { /* SSE unavailable — poll fallback already running */ }
    })();
    return function unsubscribe() {
      stopped = true;
      if (es) { try { es.close(); } catch { /* already closed */ } es = null; }
      clearInterval(pollTimer); clearTimeout(debTimer);
    };
  },

  /** Read the task's published deliverable (task.deliverableKey) from the
   *  agent's memory. Returns { key, value } | { key, gone:true } | null. */
  async deliverable(name, id) {
    var task = await agents.getTask(name, id);
    if (!task) return null;
    var key = task.deliverableKey;
    if (key) {
      var data = unwrap(await authFetch('/v1/memory?agent=' + enc(task.agentGaii) + '&prefix=' + enc(key) + '&per_page=20'), 'read deliverable');
      var found = (data.items || []).find(function (i) { return i.key === key; });
      return found ? { key: key, value: found.value } : { key: key, gone: true };
    }
    // deliverableKey is OPTIONAL and plenty of task-runner agents never set it — they just
    // publish their output and tag the record `task:<taskId>`. Requiring the field made those
    // results look like "no deliverable", so fall back to the tag.
    var byTag = unwrap(await authFetch('/v1/memory?agent=' + enc(task.agentGaii) +
      '&tags=' + enc('task:' + id) + '&per_page=20'), 'read deliverable by tag');
    var items = (byTag.items || []).slice().sort(function (a, b) {
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
    if (items.length) return { key: items[0].key, value: items[0].value, viaTag: true };
    return null;
  },

  /** Read a specific memory entry under an agent's namespace (or null). */
  async memory(name, key) {
    var a = await agents.get(name);
    var gaii = (a && a.gaii) || name;
    var data = unwrap(await authFetch('/v1/memory?agent=' + enc(gaii) + '&prefix=' + enc(key) + '&per_page=20'), 'read agent memory');
    var items = data.items || [];
    var found = items.find(function (i) { return i.key === key; });
    return found ? found.value : null;
  },

  /** Agent questions awaiting an answer: outbound option-prompts with no reply
   *  yet. Each is { message_id, prompt_id, question, options, allow_other }. */
  async pendingPrompts(name) {
    var data = unwrap(await authFetch('/v1/agents/' + enc(name) + '/messages?per_page=100'), 'list messages');
    var msgs = data.messages || [];
    var answered = {};
    msgs.forEach(function (m) {
      var pa = m.metadata && (m.metadata.promptAnswer || m.metadata.prompt_answer);
      var pid = pa && (pa.promptId || pa.prompt_id);
      if (pid) answered[pid] = true;
    });
    var out = [];
    msgs.forEach(function (m) {
      if (m.direction !== 'outbound') return;
      var p = m.metadata && m.metadata.prompt;
      if (!p) return;
      var pid = p.promptId || p.prompt_id;
      if (!pid || answered[pid]) return;
      out.push({
        message_id: m.id,
        prompt_id: pid,
        question: p.question,
        options: p.options || [],
        allow_other: (p.allowOther != null ? p.allowOther : p.allow_other) !== false,
      });
    });
    return out;
  },

  /** Answer an agent's option-prompt (owner -> agent). choice is the chosen
   *  option text, or free text when is_other is true. */
  async answerPrompt(name, ans) {
    if (!ans || !ans.prompt_id || !ans.choice) throw new Error('answerPrompt requires { prompt_id, choice }');
    return unwrap(await authFetch('/v1/agents/' + enc(name) + '/messages', {
      method: 'POST',
      body: JSON.stringify({
        content: ans.choice,
        direction: 'inbound',
        metadata: { prompt_answer: { prompt_id: ans.prompt_id, choice: ans.choice, is_other: !!ans.is_other } },
      }),
    }), 'answer prompt');
  },

  /** Commission + watch until done/failed/stalled, then resolve
   *  { task, deliverable }. Best for task-runner agents (which auto-activate).
   *  opts: { onProgress(task, events), timeoutMs, pollMs } plus createTask's spend options
   *  ({ confirm, allowDuplicate, dedupeMs }), which are forwarded — so a second run() of the same
   *  job attaches to the FIRST task rather than commissioning a second one. */
  async run(name, task, opts) {
    var created = await agents.createTask(name, task, opts);
    var id = created.id;
    return await new Promise(function (resolve, reject) {
      var done = false, to = null;
      var stop = agents.watch(name, id, async function (t, events) {
        if (opts && opts.onProgress) { try { opts.onProgress(t, events); } catch { /* progress callback errors are non-fatal */ } }
        if (!done && (t.status === 'done' || t.status === 'failed' || t.status === 'stalled')) {
          done = true; if (to) clearTimeout(to); stop();
          var deliverable = t.status === 'done' ? await agents.deliverable(name, id).catch(function () { return null; }) : null;
          resolve({ task: t, deliverable: deliverable });
        }
      }, opts);
      if (opts && opts.timeoutMs > 0) {
        to = setTimeout(function () {
          if (!done) { done = true; stop(); var e = /** @type {Error & { code?: string, taskId?: string }} */ (new Error('run() timed out')); e.code = 'TIMEOUT'; e.taskId = id; reject(e); }
        }, opts.timeoutMs);
      }
    });
  },

  /** Cooperative-cancel a task. Writes a cancel marker the worker daemon
   *  honours before its next kickoff (so abandoned/speculative subtasks never
   *  start), AND, for immediate effect, natively pauses an active task or
   *  deletes a queued one (owner-only ops; best-effort). Returns
   *  { marked:true, native:'paused'|'deleted'|null }. */
  async cancelTask(name, taskId, opts) {
    await authFetch('/v1/memory', { method: 'POST', body: JSON.stringify({
      key: 'agents.cancel.task.' + taskId,
      value: [taskId],
      visibility: 'owner',
    }) });
    var native = null;
    try {
      var t = await agents.getTask(name, taskId);
      var st = t && t.status;
      if (st === 'active') {
        var r = await authFetch('/v1/agents/' + enc(name) + '/tasks/' + enc(taskId) + '/pause', { method: 'POST' });
        if (r && r.ok) native = 'paused';
      } else if (st === 'queued' || st === 'draft') {
        var r2 = await authFetch('/v1/agents/' + enc(name) + '/tasks/' + enc(taskId), { method: 'DELETE' });
        if (r2 && r2.ok) native = 'deleted';
      }
    } catch { /* native stop is best-effort; the marker still applies */ }
    if (opts && opts.invalidate !== false) _cancelSetCache = null;
    return { marked: true, native: native };
  },

  /** Cancel a whole run/batch: write one marker listing many task ids
   *  (key agents.cancel.run.<run>). Workers union all agents.cancel.* markers. */
  async cancelRun(run, taskIds) {
    if (!run || !Array.isArray(taskIds)) throw new Error('cancelRun requires (run, taskIds[])');
    await authFetch('/v1/memory', { method: 'POST', body: JSON.stringify({
      key: 'agents.cancel.run.' + run,
      value: taskIds.map(String),
      visibility: 'owner',
    }) });
    _cancelSetCache = null;
    return { marked: true, count: taskIds.length };
  },

  /** The set (array) of task ids cancelled via any agents.cancel.* marker
   *  visible to the owner. 10s cache. */
  async cancelledTaskIds(opts) {
    var now = Date.now();
    if (!(opts && opts.fresh) && _cancelSetCache && (now - _cancelSetCache.t) < 10000) return _cancelSetCache.v;
    var data = unwrap(await authFetch('/v1/memory?owner_scope=true&prefix=' + enc('agents.cancel.') + '&per_page=100'), 'read cancel markers');
    var set = {};
    (data.items || []).forEach(function (it) {
      var v = it.value;
      if (Array.isArray(v)) v.forEach(function (x) { set[String(x)] = true; });
      else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { set[k] = true; });
    });
    var v = Object.keys(set);
    _cancelSetCache = { v: v, t: now };
    return v;
  },

  /** Clear the cached agent list (call after creating/deleting an agent). */
  invalidateCache() { _agentsCache = null; _cancelSetCache = null; },
};

attach('agents', agents);
attachSpend();
