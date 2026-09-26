/**
 * @file sdk-workflows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entry of aimeat-workflows.js, the Agent Workflows client. Its own file
 *   because library-packs/sdk.ts is at the line ceiling; placed where it stood in SDK_PACKS, after
 *   aimeat-agents.
 * @structure WORKFLOWS_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.1.0 — 2026-09-26 — The aiDoc says how maxCostUsd holds when ai steps run side by side, what
 *     it counts, and the run fields that show it (secaudit 2026-09, A6-11).
 *   v1.0.0 — 2026-09-26 — Moved unchanged from library-packs/sdk.ts (max-file-lines).
 */
import type { LibraryPack } from './types.js';

export const WORKFLOWS_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-workflows',
    kind: 'sdk',
    category: 'core',
    title: 'Agent Workflows',
    description: 'Agent Workflows client: list/save/run declared agent pipelines (signals-only or full, sandbox or live), read runs/health/blueprint, cancel, and the human-in-the-loop loop (pendingInputs + answer + watchRun).',
    url: '/v1/libs/aimeat-workflows.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-workflows.js"></script>'],
    requires: ['aimeat-auth'],
    license: 'MIT',
    apiSurface: 'AIMEAT.workflows',
    aiDoc: 'Agent Workflows — declared, ordered agent pipelines with per-step input/output signals ("did it produce", not just "did it fire"). list({includeHealth}), get/save/remove(id) — save validates server-side (DAG + workflow-compatible offers; errors in err.details.errors). blueprint(id) returns the derived graph { nodes:[{stepId, agents, offerId, reads, writes}], edges:[{from,to}] } — feed a canvas. run(id, {mode:"signals"|"full", sandbox, vars}) → {runId}; signals mode completes synchronously (instant health check), sandbox namespaces keys under wf-test.<runId>. so tests never touch prod data. runs(id)/getRun(id,runId) expose per-step states (pending|dispatched|green|input-red|output-red|timed-out|skipped|agent-offline|waiting-human) — render an execution log from them. HUMAN-IN-THE-LOOP: a step with action {kind:"human-input", question:{prompt, options:[{id,label}]}, answer_to_key} parks the run in waiting-human and notifies the owner; pendingInputs() lists everything waiting; answer(id, runId, stepId, {picks:["option-id"], other}) resolves it (the answer JSON lands at answer_to_key so downstream steps gate on it with json_field signals, e.g. required_to_function {kind:"deterministic", key:"<answer_to_key>", op:"json_field", path:"pick", equals:"approve"}). watchRun(id, runId, cb) re-fetches on the aimeat-live "workflows" SSE domain (polling fallback) and stops itself on a terminal run. App grant scopes: workflow:read for reads, workflow:write for save/run/answer, and each step also costs the scope its own door asks: work:request for an agent step (a workflow saved before 2026-09-25, which has no def.authority, keeps its agent steps free), ai:use for an ai step or llm.approved, ext:invoke for an extension step, memory:read + storage:write + memory:write for a datapackage step, memory:read + work:request for export-out, work:request for trigger-geai, and memory:read for a workflow that reads the owner\'s records (every signal leaf and every agent step reads one, and a signals-only check needs it too). A save or a run without it answers 403 SCOPE_DENIED naming the scope. COST: maxCostUsd on the definition caps what one run may spend on AI, in US dollars, its ai steps and the node\'s judging of its llm signals together. Before an ai step starts, the node sets aside what the step is expected to cost (step.estimateUsd, the most it cost in the workflow\'s last ten finished runs; with none, an equal share of the cap nobody holds), shown as step.reservedUsd while the step runs. The step starts only when that fits beside what the run has spent and what its running ai steps hold, so ai steps that fit together still run side by side, and one that does not fit stays pending while another ai step runs. With none running, the run ends with status "stopped", run.costCap {capUsd, spentUsd, stoppedBefore, neededUsd?} and a run.reason sentence. Each step carries its own costUsd, and run.signalCostUsd is what the judging cost. costCapMorsels does nothing (a morsel is not money) and is removed in 4.0.0; until then a save that sets it answers with data.warnings. TRIGGERS: a save records its principal as def.savedBy, and a run the workflow\'s own trigger starts answers to it; when that principal is disconnected or no longer holds a word the steps need, nothing runs: the run list shows one record with status "refused", run.refusal {saverName, missing, attempts} and a run.reason, and the owner gets one notification with "Run as me" (POST /v1/workflows/:id/runs/:runId/run-as-owner, the owner in person only) and a link to approve the permissions again.',
    changelog: [],
    tierHint: 'T2',
    interviewTriggers: ['workflow', 'pipeline', 'automation', 'mission', 'orchestrate', 'approval'],
    sizeEstimate: '~6KB',
    status: 'preview',
    modelTier: 'needs-doc',
    promptGroup: 'core',
    promptLine: '- aimeat-workflows.js — agent workflow pipelines: save/run/watch + human-approval steps (`AIMEAT.workflows`). Requires aimeat-auth.',
  },
];
