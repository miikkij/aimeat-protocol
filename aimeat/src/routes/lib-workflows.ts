/**
 * @file src/routes/lib-workflows.ts
 * @description Server-side generator for the browser client library aimeat-workflows.js. Returns
 *   the JS source (as a string) exposing AIMEAT.workflows — the Agent Workflows client: list/get/
 *   save/remove definitions, run (signals-only | full, sandbox|live), runs + health + blueprint
 *   reads, run cancel, and the human-in-the-loop surface (pendingInputs + answer + watchRun).
 *   Calls /v1/workflows using the AIMEAT.auth session; an app needs the workflow:read /
 *   workflow:write grant scopes.
 *
 * @structure
 *   - aimeatWorkflowsLib(config): returns the IIFE source string, stamped with node id
 *   - emitted AIMEAT.workflows.{list,get,save,remove,run,runs,getRun,cancel,health,blueprint,
 *     pendingInputs,answer,watchRun}
 *
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: full /v1/workflows client incl. human-input answer loop.
 */
import type { AimeatConfig } from '../config.js';

/**
 * aimeat-workflows.js — Agent Workflows client library
 * Depends on AIMEAT.auth being loaded first; pairs with aimeat-live for live run updates.
 */
export function aimeatWorkflowsLib(config: AimeatConfig): string {
    return `// aimeat-workflows.js — AIMEAT Agent Workflows Library
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first. Scopes: workflow:read (reads), workflow:write (save/run/answer).
// Usage:
//   const { workflows } = await AIMEAT.workflows.list({ includeHealth: true });
//   const { runId } = await AIMEAT.workflows.run('my-flow', { mode: 'full', sandbox: true });
//   const stop = AIMEAT.workflows.watchRun('my-flow', runId, run => render(run));
//   const { inputs } = await AIMEAT.workflows.pendingInputs();
//   await AIMEAT.workflows.answer('my-flow', runId, 'gate', { picks: ['approve'] });
(function(global) {
'use strict';

function getSession() {
  if (!global.AIMEAT || !global.AIMEAT.auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-workflows.js');
  }
  const s = global.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

async function call(path, opts) {
  const res = await getSession().fetch(path, opts);
  if (!res.ok) {
    const err = new Error((res.error && res.error.message) || 'Workflow request failed');
    err.code = res.error && res.error.code;
    err.details = res.error && res.error.details;
    throw err;
  }
  return res.data;
}

const workflows = {
  // ── definitions ──
  // List the owner's workflow definitions. { includeHealth: true } inlines each workflow's
  // run-health trend (avoids a per-workflow health() fan-out on list views).
  async list(opts) {
    const qs = opts && opts.includeHealth ? '?include=health' : '';
    return call('/v1/workflows' + qs);
  },
  async get(id) { return call('/v1/workflows/' + encodeURIComponent(id)); },
  // Create or update. def = { title, description, trigger, vars, steps, on_step_fail:'inspect', ... }.
  // Rejected (error.details.errors[]) unless the graph is a DAG and every agent step's offer is
  // workflow-compatible. Steps may also be actions: export-out / trigger-geai / human-input.
  async save(id, def) { return call('/v1/workflows/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(def) }); },
  async remove(id, opts) {
    const qs = opts && opts.withRuns ? '?withRuns=true' : '';
    return call('/v1/workflows/' + encodeURIComponent(id) + qs, { method: 'DELETE' });
  },
  // The derived structural graph (nodes + edges + memory keys each step reads/writes) — feed a canvas.
  async blueprint(id) { return call('/v1/workflows/' + encodeURIComponent(id) + '/blueprint'); },
  async health(id) { return call('/v1/workflows/' + encodeURIComponent(id) + '/health'); },

  // ── runs ──
  // mode: 'signals' (evaluate signals only, no dispatch — instant health check) | 'full' (execute).
  // sandbox: true namespaces every key under wf-test.<runId>. so a test run never clobbers prod.
  async run(id, opts) {
    const body = {
      mode: opts && opts.mode === 'full' ? 'full' : 'signals-only',
      target: opts && opts.sandbox ? 'sandbox' : 'live',
      vars: (opts && opts.vars) || undefined,
    };
    return call('/v1/workflows/' + encodeURIComponent(id) + '/run', { method: 'POST', body: JSON.stringify(body) });
  },
  async runs(id) { return call('/v1/workflows/' + encodeURIComponent(id) + '/runs'); },
  async getRun(id, runId) { return call('/v1/workflows/' + encodeURIComponent(id) + '/runs/' + encodeURIComponent(runId)); },
  async cancel(id, runId) { return call('/v1/workflows/' + encodeURIComponent(id) + '/runs/' + encodeURIComponent(runId) + '/cancel', { method: 'POST' }); },

  // ── human-in-the-loop ──
  // Every step across the owner's active runs currently waiting for a human answer:
  // [{ workflowId, runId, stepId, workflowTitle, question:{prompt,options,...}, askedAt, deadline }].
  async pendingInputs() { return call('/v1/workflows/pending-inputs'); },
  // Answer a waiting-human step. answer = { picks: ['option-id'], other?: 'free text' }. 409 when the
  // step is not parked (already answered / timed out); the run advances on success.
  async answer(id, runId, stepId, answer) {
    return call('/v1/workflows/' + encodeURIComponent(id) + '/runs/' + encodeURIComponent(runId)
      + '/steps/' + encodeURIComponent(stepId) + '/answer', { method: 'POST', body: JSON.stringify(answer) });
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
      } catch (e) { /* transient — keep watching */ }
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (unsub) try { unsub(); } catch (e) { /* noop */ }
      if (timer) clearInterval(timer);
    };
    if (global.AIMEAT.live && typeof global.AIMEAT.live.subscribe === 'function') {
      unsub = global.AIMEAT.live.subscribe(['workflows'], pull);
    } else {
      timer = setInterval(pull, (opts && opts.pollMs) || 5000);
    }
    pull();
    return stop;
  },
};

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.workflows = workflows;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
