/**
 * @file cli/connect/tool-call-defs-workflows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent-workflow tools for the shell / local-call dispatch: save, get, run, answer a
 *   waiting human-input step, and list what is waiting.
 * @structure workflowTools[] -- the shell handler table, registered by tool-call.ts
 * @usage import { workflowTools } from './tool-call-defs-workflows.js';
 * @version-history
 *   v1.0.0 -- 2026-08-16 -- Pure extraction from tool-call-defs-apps.ts (max-file-lines). Handlers
 *     unchanged; aimeat_workflow_answer had just been corrected to POST { picks, other } as the
 *     route reads, instead of { answer }, which it had never accepted.
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import type { ApiResponse } from './api-client.js';
import { requiredString, optionalString, optionalArray, requiredRecord, optionalRecord } from './tool-call-helpers.js';

export const workflowTools: ConnectCliToolDefinition[] = [
    // ── Agent Workflows (shell-callable parity with the MCP + connector surfaces) ──
    {
        name: 'aimeat_workflow_save',
        description: 'Create/update a workflow. `definition` is the full descriptor (title, description, trigger, vars[], steps[], on_step_fail, llm?); validated against the offer contract + DAG on save.',
        input: {
            id: { type: 'string', required: true, description: 'Workflow id (lowercase slug); existing id = update.' },
            definition: { type: 'object', required: true, description: 'The workflow descriptor.' },
        },
        handler: ({ client }, input) => client.put(`/v1/workflows/${encodeURIComponent(requiredString(input, 'id'))}`, requiredRecord(input, 'definition')),
    },
    {
        name: 'aimeat_workflow_get',
        description: 'Inspect workflows. Omit id to list; pass an id for its definition + derived blueprint + recent runs.',
        input: { id: { type: 'string', description: 'Omit to list; pass for one workflow.' } },
        handler: async ({ client }, input) => {
            const id = optionalString(input, 'id');
            if (!id) return client.get('/v1/workflows');
            const enc = encodeURIComponent(id);
            const [def, bp, runs] = await Promise.all([
                client.get(`/v1/workflows/${enc}`),
                client.get(`/v1/workflows/${enc}/blueprint`),
                client.get(`/v1/workflows/${enc}/runs`),
            ]);
            const recentRuns = (((runs.data as { runs?: unknown[] } | undefined)?.runs) ?? []).slice(0, 5);
            return { ok: def.ok, data: { definition: def.data ?? def, blueprint: bp.ok === false ? null : (bp.data ?? null), recentRuns } } as ApiResponse;
        },
    },
    {
        name: 'aimeat_workflow_run',
        description: 'Run a workflow. mode="signals-only" evaluates signals against memory (no dispatch — instant health check); mode="full" executes the steps.',
        input: {
            id: { type: 'string', required: true, description: 'The workflow id.' },
            mode: { type: 'string', required: true, description: 'signals-only | full' },
        },
        handler: ({ client }, input) => client.post(`/v1/workflows/${encodeURIComponent(requiredString(input, 'id'))}/run`, { mode: requiredString(input, 'mode') }),
    },
    {
        // → POST /v1/workflows/:id/runs/:runId/steps/:stepId/answer — answer a paused human-input step.
        name: 'aimeat_workflow_answer',
        description: 'Answer a paused human-input step of a workflow run (resumes the run).',
        input: {
            workflow_id: { type: 'string', description: 'The workflow id. (`id` is accepted as the older spelling this door used.)' },
            id: { type: 'string', description: 'Older spelling of workflow_id.' },
            run_id: { type: 'string', required: true, description: 'The run id (from aimeat_workflow_pending_inputs).' },
            step_id: { type: 'string', required: true, description: 'The paused step id awaiting input.' },
            picks: { type: 'array', description: 'Option ids from the pinned question (may be empty when answering with `other` alone).' },
            other: { type: 'string', description: 'Free-text answer; only when the question allows it.' },
        },
        // NOT A DROPPED PARAMETER — A BROKEN TOOL. The route reads { picks, other } and this door
        // sent { answer: {...} }, so every human-input answer from /local/call was accepted as an
        // empty body and the run stayed parked. `answer` is still read, as an object carrying picks
        // and other, so a caller written against the old shape keeps working.
        handler: ({ client }, input) => {
            const workflowId = optionalString(input, 'workflow_id') ?? requiredString(input, 'id');
            const legacy = optionalRecord(input, 'answer') ?? {};
            const picks = optionalArray(input, 'picks') ?? (Array.isArray(legacy.picks) ? legacy.picks : []);
            const other = optionalString(input, 'other') ?? (typeof legacy.other === 'string' ? legacy.other : undefined);
            const body: JsonObject = { picks };
            if (other !== undefined) body.other = other;
            return client.post(
                `/v1/workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(requiredString(input, 'run_id'))}/steps/${encodeURIComponent(requiredString(input, 'step_id'))}/answer`,
                body,
            );
        },
    },
    {
        // → GET /v1/workflows/pending-inputs — every run of the caller's workflows awaiting human input.
        name: 'aimeat_workflow_pending_inputs',
        description: 'List workflow runs paused awaiting human input (answer them with aimeat_workflow_answer).',
        input: {},
        handler: ({ client }) => client.get('/v1/workflows/pending-inputs'),
    },
];
