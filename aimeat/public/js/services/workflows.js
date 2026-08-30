/**
 * @file workflows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend API service for Agent Workflows (Profile › Workflows tab). Wraps the
 *   /v1/workflows endpoints (list / get / blueprint / runs / run / health / preflight / pending
 *   inputs / answer) and the three workflow prompts. All functions return the AIMEAT envelope;
 *   callers read `res.data`.
 * @usage import { listWorkflows, getBlueprint, runWorkflow, preflight } from '/js/services/workflows.js';
 * @version-history
 *   v1.1.0 -- 2026-08-30 -- listRuns takes { checks }, runWorkflow takes { sandbox }; preflight,
 *     pendingInputs, answerStep, getPrompt (the three prompts for a person's own AI).
 *   v1.0.0 -- 2026-06-13 -- Phase 9: initial workflows service for the profile tab.
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

const enc = encodeURIComponent;

/** Create/update a workflow definition (PUT /v1/workflows/:id). Returns the envelope. */
export async function putWorkflow(id, def) {
  return apiPut(`/v1/workflows/${enc(id)}`, def);
}

export async function deleteWorkflow(id) {
  return apiDelete(`/v1/workflows/${enc(id)}`);
}

/** Read one agent's published offers (to pick a workflow-compatible offer in the form). */
export async function getAgentOffers(agentName) {
  return apiGet(`/v1/agents/${enc(agentName)}/offers`);
}

/** List the owner's workflow definitions: { workflows, count }. opts.include='health' attaches each
 *  workflow's run-health inline (avoids a per-workflow getHealth fan-out in the list view). */
export async function listWorkflows(opts = {}) {
  return apiGet(`/v1/workflows${opts.include ? `?include=${enc(opts.include)}` : ''}`);
}

export async function getWorkflow(id) {
  return apiGet(`/v1/workflows/${enc(id)}`);
}

/** Derived structural graph: { workflowId, nodes, edges }. */
export async function getBlueprint(id) {
  return apiGet(`/v1/workflows/${enc(id)}/blueprint`);
}

/** Run-health trend over recent runs: { sample, lastStatus, steps:[{stepId,green,red}] , … }. */
export async function getHealth(id) {
  return apiGet(`/v1/workflows/${enc(id)}/health`);
}

/**
 * List runs (newest first): { runs, count, checks }. A check (signals-only) is not a run and is
 * left out unless `checks` is 'include' or 'only'.
 * @param {string} id
 * @param {{ checks?: 'exclude' | 'include' | 'only', limit?: number }} [opts]
 */
export async function listRuns(id, opts = {}) {
  const q = new URLSearchParams();
  if (opts.checks === 'only') q.set('only', 'checks');
  if (opts.checks === 'include') q.set('include', 'checks');
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return apiGet(`/v1/workflows/${enc(id)}/runs${qs ? '?' + qs : ''}`);
}

export async function getRun(id, runId) {
  return apiGet(`/v1/workflows/${enc(id)}/runs/${enc(runId)}`);
}

/**
 * Start a run. mode: 'signals-only' (a check: reads memory, dispatches nothing) | 'full'.
 * @param {string} id
 * @param {'signals-only' | 'full'} mode
 * @param {Record<string, string>} [vars]
 * @param {{ sandbox?: boolean }} [opts]
 */
export async function runWorkflow(id, mode, vars, opts = {}) {
  return apiPost(`/v1/workflows/${enc(id)}/run`, {
    mode,
    ...(mode === 'full' && opts.sandbox ? { target: 'sandbox' } : {}),
    ...(vars ? { vars } : {}),
  });
}

/** What a run would do now: agents, steps already satisfied, the longest timeout chain, the last run, vars. */
export async function preflight(id) {
  return apiGet(`/v1/workflows/${enc(id)}/preflight`);
}

/** Cancel an in-flight run (stuck / gone wrong). */
export async function cancelRun(id, runId) {
  return apiPost(`/v1/workflows/${enc(id)}/runs/${enc(runId)}/cancel`, {});
}

/** Every step across the owner's active runs that waits for a person: { inputs, count }. */
export async function pendingInputs() {
  return apiGet('/v1/workflows/pending-inputs');
}

/** Answer a waiting step: { picks: string[], other?: string }. */
export async function answerStep(id, runId, stepId, answer) {
  return apiPost(`/v1/workflows/${enc(id)}/runs/${enc(runId)}/steps/${enc(stepId)}/answer`, answer);
}

/**
 * One of the three prompts for a person's own AI: 'improve-mcp' (needs the workflow id),
 * 'create-mcp', 'create-chat'. Returns the envelope; `data.prompt` is the text.
 * @param {'improve-mcp' | 'create-mcp' | 'create-chat'} kind
 * @param {string} [id]
 */
export async function getPrompt(kind, id) {
  return apiGet(`/v1/templates/workflow-${kind}${id ? `?id=${enc(id)}` : ''}`);
}
