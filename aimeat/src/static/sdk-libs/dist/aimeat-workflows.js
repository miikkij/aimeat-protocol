// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/workflows/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-workflows.js (with a per-node config prelude).
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

  // src/static/sdk-libs/workflows/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-workflows.js");
  async function call(path, opts) {
    const res = await authFetch2(path, opts);
    if (!res.ok) {
      const err = (
        /** @type {Error & { code?: string, details?: unknown }} */
        new Error(res.error && res.error.message || "Workflow request failed")
      );
      err.code = res.error && res.error.code;
      err.details = res.error && res.error.details;
      throw err;
    }
    return res.data;
  }
  var workflows = {
    // ── definitions ──
    // List the owner's workflow definitions. { includeHealth: true } inlines each workflow's
    // run-health trend (avoids a per-workflow health() fan-out on list views).
    async list(opts) {
      const qs = opts && opts.includeHealth ? "?include=health" : "";
      return call("/v1/workflows" + qs);
    },
    async get(id) {
      return call("/v1/workflows/" + encodeURIComponent(id));
    },
    // Create or update. def = { title, description, trigger, vars, steps, on_step_fail:'inspect', ... }.
    // Rejected (error.details.errors[]) unless the graph is a DAG and every agent step's offer is
    // workflow-compatible. Steps may also be actions: export-out / trigger-geai / human-input.
    async save(id, def) {
      return call("/v1/workflows/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(def) });
    },
    async remove(id, opts) {
      const qs = opts && opts.withRuns ? "?withRuns=true" : "";
      return call("/v1/workflows/" + encodeURIComponent(id) + qs, { method: "DELETE" });
    },
    // The derived structural graph (nodes + edges + memory keys each step reads/writes) — feed a canvas.
    async blueprint(id) {
      return call("/v1/workflows/" + encodeURIComponent(id) + "/blueprint");
    },
    async health(id) {
      return call("/v1/workflows/" + encodeURIComponent(id) + "/health");
    },
    // ── runs ──
    // mode: 'signals' (evaluate signals only, no dispatch — instant health check) | 'full' (execute).
    // sandbox: true namespaces every key under wf-test.<runId>. so a test run never clobbers prod.
    async run(id, opts) {
      const body = {
        mode: opts && opts.mode === "full" ? "full" : "signals-only",
        target: opts && opts.sandbox ? "sandbox" : "live",
        vars: opts && opts.vars || void 0
      };
      return call("/v1/workflows/" + encodeURIComponent(id) + "/run", { method: "POST", body: JSON.stringify(body) });
    },
    async runs(id) {
      return call("/v1/workflows/" + encodeURIComponent(id) + "/runs");
    },
    async getRun(id, runId) {
      return call("/v1/workflows/" + encodeURIComponent(id) + "/runs/" + encodeURIComponent(runId));
    },
    async cancel(id, runId) {
      return call("/v1/workflows/" + encodeURIComponent(id) + "/runs/" + encodeURIComponent(runId) + "/cancel", { method: "POST" });
    },
    // ── human-in-the-loop ──
    // Every step across the owner's active runs currently waiting for a human answer:
    // [{ workflowId, runId, stepId, workflowTitle, question:{prompt,options,...}, askedAt, deadline }].
    async pendingInputs() {
      return call("/v1/workflows/pending-inputs");
    },
    // Answer a waiting-human step. answer = { picks: ['option-id'], other?: 'free text' }. 409 when the
    // step is not parked (already answered / timed out); the run advances on success.
    async answer(id, runId, stepId, answer) {
      return call("/v1/workflows/" + encodeURIComponent(id) + "/runs/" + encodeURIComponent(runId) + "/steps/" + encodeURIComponent(stepId) + "/answer", { method: "POST", body: JSON.stringify(answer) });
    },
    // ── live watching ──
    // Re-fetch a run whenever the 'workflows' SSE domain ticks (via aimeat-live when loaded; falls back
    // to polling every pollMs, default 5000). cb(run) fires on every fetch; returns a stop() function.
    // Stops itself automatically when the run reaches a terminal state.
    watchRun(id, runId, cb, opts) {
      let stopped = false;
      let unsub = null;
      let timer = null;
      const TERMINAL = { done: 1, partial: 1, red: 1, cancelled: 1 };
      const pull = async () => {
        if (stopped) return;
        try {
          const run = await workflows.getRun(id, runId);
          cb(run);
          if (run && TERMINAL[run.status]) stop();
        } catch {
        }
      };
      const stop = () => {
        if (stopped) return;
        stopped = true;
        if (unsub) try {
          unsub();
        } catch {
        }
        if (timer) clearInterval(timer);
      };
      if (window.AIMEAT.live && typeof window.AIMEAT.live.subscribe === "function") {
        unsub = window.AIMEAT.live.subscribe(["workflows"], pull);
      } else {
        timer = setInterval(pull, opts && opts.pollMs || 5e3);
      }
      pull();
      return stop;
    }
  };
  attach("workflows", workflows);
})();
