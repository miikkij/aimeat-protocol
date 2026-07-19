// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/agents/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-agents.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/session.js
  function getSession() {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before this library.");
    }
    const s = auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }
  function authFetch(path, opts) {
    return getSession().fetch(path, opts);
  }

  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns = namespace();
    ns[key] = value;
    return ns;
  }

  // src/static/sdk-libs/agents/index.js
  var enc = encodeURIComponent;
  function unwrap(r, action) {
    if (!r || !r.ok) {
      var err = (
        /** @type {Error & { code?: string }} */
        new Error(r && r.error && r.error.message || action + " failed")
      );
      err.code = r && r.error && r.error.code || "UNKNOWN";
      throw err;
    }
    return r.data;
  }
  var _agentsCache = null;
  var _cancelSetCache = null;
  var agents = {
    /** List the owner's agents. opts.activeOnly filters to ones seen recently.
     *  opts.fresh bypasses the 30s cache. */
    async list(opts) {
      var now = Date.now();
      if (!(opts && opts.fresh) && _agentsCache && now - _agentsCache.t < 3e4) return _agentsCache.v;
      var data = unwrap(await authFetch("/v1/agents"), "list agents");
      var v = data.agents || [];
      _agentsCache = { v, t: now };
      return opts && opts.activeOnly ? v.filter(function(a) {
        return !!a.last_seen;
      }) : v;
    },
    /** One agent by name (or GAII), or null. */
    async get(name) {
      var all = await agents.list();
      return all.find(function(a) {
        return a.name === name || a.gaii === name;
      }) || null;
    },
    /** Commission a task for an agent. Returns the created task ({ id, status, ... }).
     *  Created 'queued' by default; task-runner agents auto-activate it. */
    async createTask(name, task) {
      if (!task || !task.description) throw new Error("createTask requires { description }");
      var body = {
        title: task.title || task.description.slice(0, 80),
        description: task.description,
        status: task.status || "queued"
      };
      var data = unwrap(await authFetch("/v1/agents/" + enc(name) + "/tasks", {
        method: "POST",
        body: JSON.stringify(body)
      }), "create task");
      return data.task;
    },
    /** Get a single task. */
    async getTask(name, id) {
      return unwrap(await authFetch("/v1/agents/" + enc(name) + "/tasks/" + enc(id)), "get task").task;
    },
    /** List an agent's tasks. opts.status filters (queued|active|done|failed|...). */
    async tasks(name, opts) {
      var q = "?per_page=100" + (opts && opts.status ? "&status=" + enc(opts.status) : "");
      return unwrap(await authFetch("/v1/agents/" + enc(name) + "/tasks" + q), "list tasks").tasks || [];
    },
    /** The task's event log (oldest-first). */
    async events(name, id) {
      return unwrap(await authFetch("/v1/agents/" + enc(name) + "/tasks/" + enc(id) + "/events"), "list events").events || [];
    },
    /** Live-watch a task: calls onUpdate(task, events) on every server change
     *  (SSE) plus a periodic poll as a safety net. Returns an unsubscribe fn. */
    watch(name, id, onUpdate, opts) {
      var stopped = false, es = null, pollTimer = null, debTimer = null;
      var pollMs = opts && opts.pollMs || 15e3;
      async function refresh() {
        if (stopped) return;
        try {
          var task = await agents.getTask(name, id);
          var events = await agents.events(name, id);
          if (!stopped && typeof onUpdate === "function") onUpdate(task, events);
        } catch {
        }
      }
      function debounced() {
        clearTimeout(debTimer);
        debTimer = setTimeout(refresh, 400);
      }
      refresh();
      pollTimer = setInterval(refresh, pollMs);
      (async function() {
        try {
          var tk = unwrap(await authFetch("/v1/events/ticket", { method: "POST" }), "open event stream");
          if (stopped || !tk || !tk.ticket) return;
          es = new EventSource("/v1/events?ticket=" + enc(tk.ticket));
          es.onmessage = debounced;
        } catch {
        }
      })();
      return function unsubscribe() {
        stopped = true;
        if (es) {
          try {
            es.close();
          } catch {
          }
          es = null;
        }
        clearInterval(pollTimer);
        clearTimeout(debTimer);
      };
    },
    /** Read the task's published deliverable (task.deliverableKey) from the
     *  agent's memory. Returns { key, value } | { key, gone:true } | null. */
    async deliverable(name, id) {
      var task = await agents.getTask(name, id);
      var key = task && task.deliverableKey;
      if (!key) return null;
      var data = unwrap(await authFetch("/v1/memory?agent=" + enc(task.agentGaii) + "&prefix=" + enc(key) + "&per_page=20"), "read deliverable");
      var items = data.items || [];
      var found = items.find(function(i) {
        return i.key === key;
      });
      return found ? { key, value: found.value } : { key, gone: true };
    },
    /** Read a specific memory entry under an agent's namespace (or null). */
    async memory(name, key) {
      var a = await agents.get(name);
      var gaii = a && a.gaii || name;
      var data = unwrap(await authFetch("/v1/memory?agent=" + enc(gaii) + "&prefix=" + enc(key) + "&per_page=20"), "read agent memory");
      var items = data.items || [];
      var found = items.find(function(i) {
        return i.key === key;
      });
      return found ? found.value : null;
    },
    /** Agent questions awaiting an answer: outbound option-prompts with no reply
     *  yet. Each is { message_id, prompt_id, question, options, allow_other }. */
    async pendingPrompts(name) {
      var data = unwrap(await authFetch("/v1/agents/" + enc(name) + "/messages?per_page=100"), "list messages");
      var msgs = data.messages || [];
      var answered = {};
      msgs.forEach(function(m) {
        var pa = m.metadata && (m.metadata.promptAnswer || m.metadata.prompt_answer);
        var pid = pa && (pa.promptId || pa.prompt_id);
        if (pid) answered[pid] = true;
      });
      var out = [];
      msgs.forEach(function(m) {
        if (m.direction !== "outbound") return;
        var p = m.metadata && m.metadata.prompt;
        if (!p) return;
        var pid = p.promptId || p.prompt_id;
        if (!pid || answered[pid]) return;
        out.push({
          message_id: m.id,
          prompt_id: pid,
          question: p.question,
          options: p.options || [],
          allow_other: (p.allowOther != null ? p.allowOther : p.allow_other) !== false
        });
      });
      return out;
    },
    /** Answer an agent's option-prompt (owner -> agent). choice is the chosen
     *  option text, or free text when is_other is true. */
    async answerPrompt(name, ans) {
      if (!ans || !ans.prompt_id || !ans.choice) throw new Error("answerPrompt requires { prompt_id, choice }");
      return unwrap(await authFetch("/v1/agents/" + enc(name) + "/messages", {
        method: "POST",
        body: JSON.stringify({
          content: ans.choice,
          direction: "inbound",
          metadata: { prompt_answer: { prompt_id: ans.prompt_id, choice: ans.choice, is_other: !!ans.is_other } }
        })
      }), "answer prompt");
    },
    /** Commission + watch until done/failed/stalled, then resolve
     *  { task, deliverable }. Best for task-runner agents (which auto-activate).
     *  opts: { onProgress(task, events), timeoutMs, pollMs }. */
    async run(name, task, opts) {
      var created = await agents.createTask(name, task);
      var id = created.id;
      return await new Promise(function(resolve, reject) {
        var done = false, to = null;
        var stop = agents.watch(name, id, async function(t, events) {
          if (opts && opts.onProgress) {
            try {
              opts.onProgress(t, events);
            } catch {
            }
          }
          if (!done && (t.status === "done" || t.status === "failed" || t.status === "stalled")) {
            done = true;
            if (to) clearTimeout(to);
            stop();
            var deliverable = t.status === "done" ? await agents.deliverable(name, id).catch(function() {
              return null;
            }) : null;
            resolve({ task: t, deliverable });
          }
        }, opts);
        if (opts && opts.timeoutMs > 0) {
          to = setTimeout(function() {
            if (!done) {
              done = true;
              stop();
              var e = (
                /** @type {Error & { code?: string, taskId?: string }} */
                new Error("run() timed out")
              );
              e.code = "TIMEOUT";
              e.taskId = id;
              reject(e);
            }
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
      await authFetch("/v1/memory", { method: "POST", body: JSON.stringify({
        key: "agents.cancel.task." + taskId,
        value: [taskId],
        visibility: "owner"
      }) });
      var native = null;
      try {
        var t = await agents.getTask(name, taskId);
        var st = t && t.status;
        if (st === "active") {
          var r = await authFetch("/v1/agents/" + enc(name) + "/tasks/" + enc(taskId) + "/pause", { method: "POST" });
          if (r && r.ok) native = "paused";
        } else if (st === "queued" || st === "draft") {
          var r2 = await authFetch("/v1/agents/" + enc(name) + "/tasks/" + enc(taskId), { method: "DELETE" });
          if (r2 && r2.ok) native = "deleted";
        }
      } catch {
      }
      if (opts && opts.invalidate !== false) _cancelSetCache = null;
      return { marked: true, native };
    },
    /** Cancel a whole run/batch: write one marker listing many task ids
     *  (key agents.cancel.run.<run>). Workers union all agents.cancel.* markers. */
    async cancelRun(run, taskIds) {
      if (!run || !Array.isArray(taskIds)) throw new Error("cancelRun requires (run, taskIds[])");
      await authFetch("/v1/memory", { method: "POST", body: JSON.stringify({
        key: "agents.cancel.run." + run,
        value: taskIds.map(String),
        visibility: "owner"
      }) });
      _cancelSetCache = null;
      return { marked: true, count: taskIds.length };
    },
    /** The set (array) of task ids cancelled via any agents.cancel.* marker
     *  visible to the owner. 10s cache. */
    async cancelledTaskIds(opts) {
      var now = Date.now();
      if (!(opts && opts.fresh) && _cancelSetCache && now - _cancelSetCache.t < 1e4) return _cancelSetCache.v;
      var data = unwrap(await authFetch("/v1/memory?owner_scope=true&prefix=" + enc("agents.cancel.") + "&per_page=100"), "read cancel markers");
      var set = {};
      (data.items || []).forEach(function(it) {
        var v2 = it.value;
        if (Array.isArray(v2)) v2.forEach(function(x) {
          set[String(x)] = true;
        });
        else if (v2 && typeof v2 === "object") Object.keys(v2).forEach(function(k) {
          set[k] = true;
        });
      });
      var v = Object.keys(set);
      _cancelSetCache = { v, t: now };
      return v;
    },
    /** Clear the cached agent list (call after creating/deleting an agent). */
    invalidateCache() {
      _agentsCache = null;
      _cancelSetCache = null;
    }
  };
  attach("agents", agents);
})();
