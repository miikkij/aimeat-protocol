// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/agents/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-agents.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/session.js
  function getSession(libLabel) {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before " + (libLabel || "this library"));
    }
    const s = auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }
  function authFetch(path, opts, libLabel) {
    return getSession(libLabel).fetch(path, opts);
  }
  function makeSession(libLabel) {
    return {
      getSession: () => getSession(libLabel),
      authFetch: (path, opts) => authFetch(path, opts, libLabel)
    };
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

  // src/static/sdk-libs/_core/spend.js
  var ARM_MS = 400;
  function state() {
    const ns = namespace();
    if (!ns.__spend) {
      ns.__spend = { inflight: /* @__PURE__ */ new Map(), settled: /* @__PURE__ */ new Map(), remembered: {}, budget: null };
    }
    return ns.__spend;
  }
  function keyOf(parts) {
    const s = parts.map((p) => p == null ? "" : String(p)).join("\0");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return (parts[0] == null ? "k" : String(parts[0])) + ":" + h.toString(36);
  }
  function once(key, fn, opts) {
    const s = state();
    const ttl = opts && opts.ttlMs || 0;
    const running = s.inflight.get(key);
    if (running) return running;
    if (ttl > 0) {
      const done = s.settled.get(key);
      if (done && Date.now() - done.t < ttl) return Promise.resolve(done.v);
      if (done) s.settled.delete(key);
    }
    const p = Promise.resolve().then(fn).then(
      (v) => {
        s.inflight.delete(key);
        if (ttl > 0) s.settled.set(key, { v, t: Date.now() });
        return v;
      },
      (e) => {
        s.inflight.delete(key);
        throw e;
      }
    );
    s.inflight.set(key, p);
    return p;
  }
  function isBusy(key) {
    return state().inflight.has(key);
  }
  function forget(key) {
    state().settled.delete(key);
  }
  function lastBudget() {
    return state().budget;
  }
  function cancelledError(what) {
    const e = (
      /** @type {Error & { code?: string }} */
      new Error((what || "The action") + " was cancelled")
    );
    e.code = "SPEND_CANCELLED";
    return e;
  }
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }
  function lang() {
    try {
      const a = window.AIMEAT && window.AIMEAT.auth;
      const l = a && a.getLang && a.getLang();
      if (l === "fi" || l === "en") return l;
    } catch {
    }
    try {
      return (navigator.language || "").toLowerCase().startsWith("fi") ? "fi" : "en";
    } catch {
      return "en";
    }
  }
  var STRINGS = {
    en: {
      title: "Confirm",
      cost: "This spends from your own account.",
      ok: "Continue",
      cancel: "Cancel",
      remember: "Don't ask again in this session",
      budget: "AI budget today",
      left: "left"
    },
    fi: {
      title: "Vahvista",
      cost: "Tämä kuluttaa omalta tililtäsi.",
      ok: "Jatka",
      cancel: "Peruuta",
      remember: "Älä kysy uudelleen tässä istunnossa",
      budget: "AI-budjetti tänään",
      left: "jäljellä"
    }
  };
  function ensureStyles() {
    if (document.getElementById("aimeat-spend-css")) return;
    const st = document.createElement("style");
    st.id = "aimeat-spend-css";
    st.textContent = [
      ".aim-spend::backdrop{background:rgba(9,11,16,.62)}",
      ".aim-spend{border:0;padding:0;background:transparent;max-width:min(440px,calc(100vw - 24px));",
      "max-height:calc(100dvh - 24px);overflow:visible}",
      ".aim-spend-box{box-sizing:border-box;max-height:calc(100dvh - 24px);overflow:auto;",
      "padding:20px 20px 16px;border-radius:14px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;",
      "background:#fff;color:#12151c;border:1px solid #e2e5ea;box-shadow:0 18px 48px rgba(9,11,16,.28)}",
      ".aim-spend-box h3{margin:0 0 6px;font-size:17px;font-weight:700;letter-spacing:-.01em}",
      ".aim-spend-what{margin:0 0 10px;font-size:14.5px;line-height:1.45}",
      ".aim-spend-detail{margin:0 0 10px;font-size:13px;line-height:1.5;opacity:.78;white-space:pre-wrap}",
      ".aim-spend-meta{margin:0 0 14px;font-size:12.5px;line-height:1.6;opacity:.72}",
      ".aim-spend-meta b{font-weight:650;opacity:.95}",
      ".aim-spend-remember{display:flex;align-items:center;gap:7px;margin:0 0 14px;font-size:12.5px;opacity:.8;cursor:pointer}",
      // Sticky footer: on a short viewport the detail text scrolls inside the box, and both actions
      // stay reachable without scrolling to find them.
      ".aim-spend-btns{position:sticky;bottom:-16px;margin-bottom:-16px;padding:12px 0 16px;background:inherit;",
      "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}",
      ".aim-spend-btns button{font:inherit;font-size:14px;font-weight:600;padding:9px 16px;border-radius:9px;cursor:pointer;border:1px solid transparent}",
      ".aim-spend-cancel{background:transparent;color:inherit;border-color:#d3d7de}",
      ".aim-spend-cancel:hover{background:rgba(9,11,16,.05)}",
      ".aim-spend-ok{background:#E8564A;color:#fff}",
      ".aim-spend-ok:hover{background:#d54539}",
      ".aim-spend-ok[disabled]{opacity:.5;cursor:progress}",
      "@media (prefers-color-scheme:dark){",
      ".aim-spend-box{background:#161a21;color:#e8eaee;border-color:#2b313b;box-shadow:0 18px 48px rgba(0,0,0,.6)}",
      ".aim-spend-cancel{border-color:#39414d}",
      ".aim-spend-cancel:hover{background:rgba(255,255,255,.06)}",
      "}",
      ':root[data-theme="dark"] .aim-spend-box{background:#161a21;color:#e8eaee;border-color:#2b313b}',
      ':root[data-theme="dark"] .aim-spend-cancel{border-color:#39414d}',
      ':root[data-theme="light"] .aim-spend-box{background:#fff;color:#12151c;border-color:#e2e5ea}',
      ':root[data-theme="light"] .aim-spend-cancel{border-color:#d3d7de}',
      "@media (max-width:420px){.aim-spend-btns{flex-direction:column-reverse}.aim-spend-btns button{width:100%}}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }
  function confirmSpend(opts) {
    const o = opts || {};
    const s = state();
    if (o.remember && s.remembered[o.remember]) return Promise.resolve(true);
    if (typeof document === "undefined" || !document.body) return Promise.resolve(true);
    const t = STRINGS[lang()] || STRINGS.en;
    ensureStyles();
    let remaining = o.remaining;
    if (!remaining) {
      const b = s.budget;
      if (b && typeof b.remaining_usd === "number" && typeof b.daily_budget_usd === "number") {
        remaining = "$" + b.remaining_usd.toFixed(2) + " / $" + b.daily_budget_usd.toFixed(2) + " " + t.left;
      }
    }
    const dlg = document.createElement("dialog");
    dlg.className = "aim-spend";
    dlg.innerHTML = '<div class="aim-spend-box" role="document"><h3>' + esc(t.title) + '</h3><p class="aim-spend-what">' + esc(o.what || t.cost) + "</p>" + (o.detail ? '<p class="aim-spend-detail">' + esc(o.detail) + "</p>" : "") + (o.estimate || remaining ? '<p class="aim-spend-meta">' + (o.estimate ? esc(t.cost) + " <b>" + esc(o.estimate) + "</b>" : esc(t.cost)) + (remaining ? "<br>" + esc(t.budget) + ": <b>" + esc(remaining) + "</b>" : "") + "</p>" : "") + (o.remember ? '<label class="aim-spend-remember"><input type="checkbox" class="aim-spend-rem"><span>' + esc(t.remember) + "</span></label>" : "") + '<div class="aim-spend-btns"><button type="button" class="aim-spend-cancel">' + esc(o.cancelLabel || t.cancel) + '</button><button type="button" class="aim-spend-ok" disabled>' + esc(o.okLabel || t.ok) + "</button></div></div>";
    document.body.appendChild(dlg);
    return new Promise((resolve) => {
      let settled = false;
      const rem = (
        /** @type {HTMLInputElement|null} */
        dlg.querySelector(".aim-spend-rem")
      );
      const ok = (
        /** @type {HTMLButtonElement} */
        dlg.querySelector(".aim-spend-ok")
      );
      const cancel = (
        /** @type {HTMLButtonElement} */
        dlg.querySelector(".aim-spend-cancel")
      );
      function finish(answer) {
        if (settled) return;
        settled = true;
        if (answer && o.remember && rem && rem.checked) s.remembered[o.remember] = true;
        try {
          dlg.close();
        } catch {
        }
        dlg.remove();
        resolve(answer);
      }
      cancel.addEventListener("click", () => finish(false));
      ok.addEventListener("click", () => finish(true));
      dlg.addEventListener("cancel", (e) => {
        e.preventDefault();
        finish(false);
      });
      dlg.addEventListener("click", (e) => {
        if (e.target === dlg) finish(false);
      });
      try {
        dlg.showModal();
      } catch {
        dlg.setAttribute("open", "");
      }
      try {
        cancel.focus({ preventScroll: true });
      } catch {
        cancel.focus();
      }
      const boxEl = dlg.querySelector(".aim-spend-box");
      if (boxEl) boxEl.scrollTop = 0;
      setTimeout(() => {
        ok.disabled = false;
      }, ARM_MS);
    });
  }
  var spend = {
    confirm: confirmSpend,
    once,
    key: keyOf,
    isBusy,
    forget,
    budget: lastBudget,
    /** Clear every "don't ask again" answer — e.g. when the user signs out. */
    resetRemembered() {
      state().remembered = {};
    }
  };
  function attachSpend() {
    attach("spend", spend);
  }

  // src/static/sdk-libs/agents/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-agents.js");
  var DEDUPE_MS = 6e4;
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
      var data = unwrap(await authFetch2("/v1/agents"), "list agents");
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
      if (!task || !task.description) throw new Error("createTask requires { description }");
      var body = {
        title: task.title || task.description.slice(0, 80),
        description: task.description,
        status: task.status || "queued"
      };
      if (Array.isArray(task.scope) && task.scope.length) {
        body.scope = task.scope.map(function(s) {
          return {
            name: s.name,
            value: String(s.value),
            type: s.type || "text",
            ...s.description ? { description: s.description } : {}
          };
        });
      }
      if (task.verification) {
        var v = task.verification;
        body.verification = {
          user_expects: v.user_expects != null ? v.user_expects : v.userExpects || "",
          technical_checks: v.technical_checks || v.technicalChecks || []
        };
      }
      if (task.rules) body.rules = task.rules;
      if (task.resources) body.resources = task.resources;
      var o = opts || {};
      if (o.idempotencyKey) body.idempotency_key = o.idempotencyKey;
      if (o.allowDuplicate) body.allow_duplicate = true;
      var commission = async function() {
        if (o.confirm) {
          var c = typeof o.confirm === "object" ? o.confirm : {};
          var okToSpend = await confirmSpend({
            what: c.what || "Commission " + name + ": " + body.title,
            detail: c.detail !== void 0 ? c.detail : body.description,
            estimate: c.estimate,
            remaining: c.remaining,
            okLabel: c.okLabel,
            cancelLabel: c.cancelLabel,
            remember: c.remember
          });
          if (!okToSpend) throw cancelledError("The commission");
        }
        var data = unwrap(await authFetch2("/v1/agents/" + enc(name) + "/tasks", {
          method: "POST",
          body: JSON.stringify(body)
        }), "create task");
        if (data.deduplicated && data.task) {
          data.task.deduplicated = true;
          data.task.deduplicated_reason = data.deduplicated_reason;
        }
        return data.task;
      };
      if (o.allowDuplicate) return commission();
      return once(keyOf(["agents.createTask", name, body.title, body.description]), commission, {
        ttlMs: typeof o.dedupeMs === "number" ? o.dedupeMs : DEDUPE_MS
      });
    },
    /** Get a single task. */
    async getTask(name, id) {
      return unwrap(await authFetch2("/v1/agents/" + enc(name) + "/tasks/" + enc(id)), "get task").task;
    },
    /** List an agent's tasks. opts.status filters (queued|active|done|failed|...). */
    async tasks(name, opts) {
      var q = "?per_page=100" + (opts && opts.status ? "&status=" + enc(opts.status) : "");
      return unwrap(await authFetch2("/v1/agents/" + enc(name) + "/tasks" + q), "list tasks").tasks || [];
    },
    /** The task's event log (oldest-first). */
    async events(name, id) {
      return unwrap(await authFetch2("/v1/agents/" + enc(name) + "/tasks/" + enc(id) + "/events"), "list events").events || [];
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
          var tk = unwrap(await authFetch2("/v1/events/ticket", { method: "POST" }), "open event stream");
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
      if (!task) return null;
      var key = task.deliverableKey;
      if (key) {
        var data = unwrap(await authFetch2("/v1/memory?agent=" + enc(task.agentGaii) + "&prefix=" + enc(key) + "&per_page=20"), "read deliverable");
        var found = (data.items || []).find(function(i) {
          return i.key === key;
        });
        return found ? { key, value: found.value } : { key, gone: true };
      }
      var byTag = unwrap(await authFetch2("/v1/memory?agent=" + enc(task.agentGaii) + "&tags=" + enc("task:" + id) + "&per_page=20"), "read deliverable by tag");
      var items = (byTag.items || []).slice().sort(function(a, b) {
        return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
      });
      if (items.length) return { key: items[0].key, value: items[0].value, viaTag: true };
      return null;
    },
    /** Read a specific memory entry under an agent's namespace (or null). */
    async memory(name, key) {
      var a = await agents.get(name);
      var gaii = a && a.gaii || name;
      var data = unwrap(await authFetch2("/v1/memory?agent=" + enc(gaii) + "&prefix=" + enc(key) + "&per_page=20"), "read agent memory");
      var items = data.items || [];
      var found = items.find(function(i) {
        return i.key === key;
      });
      return found ? found.value : null;
    },
    /** Agent questions awaiting an answer: outbound option-prompts with no reply
     *  yet. Each is { message_id, prompt_id, question, options, allow_other }. */
    async pendingPrompts(name) {
      var data = unwrap(await authFetch2("/v1/agents/" + enc(name) + "/messages?per_page=100"), "list messages");
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
      return unwrap(await authFetch2("/v1/agents/" + enc(name) + "/messages", {
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
     *  opts: { onProgress(task, events), timeoutMs, pollMs } plus createTask's spend options
     *  ({ confirm, allowDuplicate, dedupeMs }), which are forwarded — so a second run() of the same
     *  job attaches to the FIRST task rather than commissioning a second one. */
    async run(name, task, opts) {
      var created = await agents.createTask(name, task, opts);
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
      await authFetch2("/v1/memory", { method: "POST", body: JSON.stringify({
        key: "agents.cancel.task." + taskId,
        value: [taskId],
        visibility: "owner"
      }) });
      var native = null;
      try {
        var t = await agents.getTask(name, taskId);
        var st = t && t.status;
        if (st === "active") {
          var r = await authFetch2("/v1/agents/" + enc(name) + "/tasks/" + enc(taskId) + "/pause", { method: "POST" });
          if (r && r.ok) native = "paused";
        } else if (st === "queued" || st === "draft") {
          var r2 = await authFetch2("/v1/agents/" + enc(name) + "/tasks/" + enc(taskId), { method: "DELETE" });
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
      await authFetch2("/v1/memory", { method: "POST", body: JSON.stringify({
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
      var data = unwrap(await authFetch2("/v1/memory?owner_scope=true&prefix=" + enc("agents.cancel.") + "&per_page=100"), "read cancel markers");
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
  attachSpend();
})();
