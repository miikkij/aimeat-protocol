/**
 * @file schedules-tasks-memory.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Schedule, workflow, task lifecycle, and agent memory (read/write/list/search) tool definitions.
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   2026-10-04 — aimeat_task_decline; aimeat_task_fail points to it for a refusal.
 *   2026-10-02 — aimeat_task_create takes `start`, propose_todos takes `effects` and says what to do
 *     next; aimeat_task_start and aimeat_agent_task_start_set.
 *   2026-09-29 — aimeat_schedule_create takes kind "refinery" (one mail refinery batch each fire, input { prefix }).
 *   2026-09-27 — aimeat_schedule_list takes detail (each schedule's prompt); aimeat_schedule_update takes prompt.
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v1.7.5 — 2026-09-26 — aimeat_workflow_save says an ai step's call holds its share of maxCostUsd
 *     until it answers, the share is one attempt, and a step expected to cost more than the whole cap
 *     starts alone (secaudit 2026-09, A6-11).
 *   v1.7.4 — 2026-09-26 — aimeat_workflow_save says how maxCostUsd holds when ai steps run side by
 *     side: each holds what it is expected to cost before it starts (secaudit 2026-09, A6-11).
 *   v1.7.3 — 2026-09-26 — aimeat_workflow_save says maxCostUsd counts the judging of a run's llm
 *     signals too, and that past the cap an llm signal passes unjudged (secaudit 2026-09, A6-11).
 *   v1.7.2 — 2026-09-26 — aimeat_schedule_create's input_keys and output_key say a record the node
 *     keeps for itself is refused with RESERVED_KEY (services/ai-job-keys.ts).
 *   v1.7.1 — 2026-09-26 — aimeat_workflow_save says costCapMorsels is removed in 4.0.0.
 *   v1.7.0 — 2026-09-25 — aimeat_workflow_save names work:request, the word an agent step costs.
 *   v1.6.0 — 2026-09-25 — aimeat_workflow_save says a trigger's run answers to whoever saved the
 *     workflow, and aimeat_workflow_get says a stopped or refused run carries its reason.
 *   v1.5.0 — 2026-09-25 — aimeat_workflow_save names maxCostUsd, the per-run cap on what a run's ai
 *     steps spend in US dollars, and says costCapMorsels does nothing.
 *   v1.4.2 — 2026-09-24 — aimeat_workflow_save says a workflow reading the owner's records costs memory:read.
 *   v1.4.1 — 2026-09-24 — aimeat_workflow_save names the permission each kind of step costs.
 *   v1.4.0 — 2026-09-05 — aimeat_schedule_create publishes `input` and `instance_id`, the two fields
 *     POST /v1/schedules has stored for an extension schedule since it was written and no tool
 *     surface sent. THE SAME DEFECT AS v1.3.0 BELOW, thirteen days later and in this same file: a
 *     route reads a field, no tool declares it, and the capability is invisible to everyone who only
 *     has the tools. What it cost this time: the AI Music Charts radar could only ever be put on a
 *     clock with its built-in thirty search terms, so it found the same tracks for six nights and
 *     added nothing, while the same action with a wider term list found sixty-three the bank had
 *     never held. The lesson, now in docs/pitfalls.md: when a route takes a field, grep the three
 *     tool surfaces for it before assuming the gap is in the route.
 *   v1.3.0 — 2026-08-30 — aimeat_workflow_run publishes `vars` and `target`, the two fields
 *     POST /v1/workflows/:id/run has always read and no tool surface sent.
 *   v1.2.0 — 2026-08-30 — aimeat_workflow_run and _get say that a signals-only check is not a run:
 *     it costs nothing and is kept apart from the run history and the health.
 *   v1.1.0 — 2026-08-14 — aimeat_task_create gains `scope`: the named parameters a receiving
 *     runner dispatches on, which the tool had no way to send.
 *   v1.0.0 — 2026-07-13 — Extracted from definitions.ts (pure extraction; no behavior change).
 */

import { flexibleBoolean } from '../input-schemas.js';
import { MEMORY_LIST_MAX_LIMIT } from '../../models/tool-input-vocabulary.js';
import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

export const schedulesTasksMemoryTools = [
    {
        name: 'aimeat_schedule_create',
        description: 'Create a recurring schedule the AIMEAT server runs on a cron clock (survives your disconnect; the owner can pause/cancel it any time). FIRST, if a person asked for an AGENT that does something regularly ("every morning", "each week", "keep track of"), load the skill `node:aimeat-recurring-work` and follow it instead of assembling this yourself: they may already have an agent that does this, and a schedule you build here over a key nothing writes looks finished and stays empty. kind="ai" runs a server-side OpenRouter completion over predefined owner memory keys and stores the result (use for "translate the news every morning"); kind="agent_task" queues a task into your own queue each fire (for work needing your tools); kind="extension" runs an installed extension action with zero tokens (for fetch+store); kind="refinery" runs one batch of a mail refinery definition each fire (input: { prefix }, the definition being the owner\'s `<prefix>.config`; needs connections:read-through, ai:use, organism:rows and memory:write, and runs as you, so its mailbox must be one you connected). Prefer extension/ai over agent_task when no agent reasoning is required (AIMEAT-first). Pass a timezone for daily schedules.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Create Schedule', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // Creates work that will run.
        scope: 'task:write',
        surfaces: ['agent'],
        input: {
            kind: { type: 'string', required: true, description: 'ai | agent_task | extension | refinery', enum: ['ai', 'agent_task', 'extension', 'refinery'] },
            cron: { type: 'string', required: true, description: 'Cron expression, e.g. "0 7 * * *".' },
            display_name: { type: 'string', required: true, description: 'Human-readable label.' },
            timezone: { type: 'string', description: 'IANA timezone, e.g. "Europe/Helsinki".' },
            purpose: { type: 'string', description: 'Why this runs (shown to the owner).' },
            prompt: { type: 'string', description: 'ai: instruction applied to the input memory values.' },
            input_keys: { type: 'array', description: 'ai: owner memory keys fed in as context. Each one goes to the model provider, so a key naming a record this node keeps for itself (an AI key, a payout setting, a spend limit) is refused with RESERVED_KEY.', zod: z.array(z.string()) },
            output_key: { type: 'string', description: 'ai: memory key for the result (auto-generated if omitted). A record this node keeps for itself is refused with RESERVED_KEY.' },
            task_title: { type: 'string', description: 'agent_task: title of the task created each fire.' },
            extension_name: { type: 'string', description: 'extension: installed extension name.' },
            action_id: { type: 'string', description: 'extension: action id to run.' },
            input: { type: 'object', description: 'refinery: { prefix }, the definition to run. extension: the action\'s own parameters, passed on every fire. Without this the action runs on its built-in defaults, which is rarely what a clock is for: the AI Music Charts radar searched the same thirty terms every night for six days and added nothing, while the same action given a wider term list found sixty-three tracks it had never seen.' },
            instance_id: { type: 'string', description: 'extension: run the action on one named instance of the extension rather than the default one.' },
            task_description: { type: 'string', description: 'agent_task: the instruction for each created task.' },
            model: { type: 'string', description: '' },
            system_prompt: { type: 'string', description: '' },
            target_agent: { type: 'string', description: 'agent_task only: target agent name (defaults to yourself; must be same owner).' },
            description: { type: 'string', description: '' },
        },
    },
    {
        name: 'aimeat_schedule_list',
        description: 'List the schedules you created (id, kind, cron, enabled, last/next run, run count). Use before updating or deleting one. With detail: true each schedule also carries what it tells the model or the agent on every fire: `prompt` (an ai schedule\x27s instruction, or the description of the task an agent_task schedule creates), `system_prompt`, `task_title`, and its description, purpose and input.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Schedules', readOnlyHint: true },
        surfaces: ['agent'],
        input: {
            detail: { type: 'boolean', description: 'true also returns each schedule\x27s prompt, system prompt or task title, description, purpose and input.' },
        },
    },
    {
        name: 'aimeat_schedule_update',
        description: 'Update one of your schedules: pause/resume (enabled=false/true), change the cron, timezone, display name, or prompt. A new prompt replaces an ai schedule\x27s instruction or the description of the task an agent_task schedule creates, and keeps the rest of its input; other kinds have no prompt and refuse NO_PROMPT. Read the current one first with aimeat_schedule_list detail: true. Re-arms the live cron immediately.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Update Schedule', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Changes something that runs on its own afterwards.
        scope: 'workflow:write',
        surfaces: ['agent'],
        input: {
            schedule_id: { type: 'string', required: true, description: 'The schedule id.' },
            enabled: { type: 'boolean', description: 'false = pause, true = resume.' },
            cron: { type: 'string', description: 'New cron expression.' },
            timezone: { type: 'string', description: 'New IANA timezone.' },
            display_name: { type: 'string', description: 'New label.' },
            prompt: { type: 'string', description: 'New prompt: an ai schedule\x27s instruction, or the description of the task an agent_task schedule creates.' },
        },
    },
    {
        name: 'aimeat_schedule_delete',
        description: 'Cancel and remove one of your schedules. Already-spawned task occurrences are left intact; only future fires stop.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete Schedule', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: { schedule_id: { type: 'string', required: true, description: 'The schedule id.' } },
    },
    {
        name: 'aimeat_schedule_trigger',
        description: 'Run one of your schedules once, right now, without waiting for its cron. Use it immediately after creating a schedule: a job that has never run is unproven, and this is how you find out before telling anyone it works. The reply says what actually happened — "created" queued a task, "ran" executed a server-side job, "busy" means a previous run is still going, "limited" means a constraint stopped it, "error" means it ran and failed. Only "created" and "ran" are success. Then read the key the job writes to and check there is content in it; that, not this reply, is the proof.',
        caller: 'agent',
        visibility: agentEverywhere,
        // Not idempotent: each call is another real run of the job, with whatever that job does to the
        // world. openWorld because the job it runs may itself reach outside the node (ai, extension).
        annotations: { title: 'Run Schedule Now', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        // Running a schedule now creates the same work its cron would, only sooner.
        scope: 'task:write',
        surfaces: ['agent'],
        input: { schedule_id: { type: 'string', required: true, description: 'The schedule id.' } },
    },
    {
        name: 'aimeat_schedule_report_internal',
        description: 'If you run your OWN recurring jobs outside AIMEAT (your own cron/heartbeat), report them here so the owner sees them in the scheduler. Pass your full current set each time (it replaces the previous report). AIMEAT only displays these — it does not run them.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Report Internal Schedules', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            entries: { type: 'array', required: true, description: 'Array of {name, description?, purpose?, cron?, timezone?, schedule?, status?, kind?}.', zod: z.array(z.object({
        id: z.string().optional(),
        name: z.string(),
        description: z.string().optional(),
        purpose: z.string().optional(),
        cron: z.string().optional(),
        timezone: z.string().optional(),
        schedule: z.string().optional().describe('Human-readable schedule if no cron, e.g. "Every day 07:00".'),
        status: z.enum(['active', 'paused']).optional(),
        kind: z.string().optional(),
      })) },
        },
    },
    {
        name: 'aimeat_workflow_save',
        description: 'Create or update an Agent Workflow: a declared, ordered set of steps with per-step input (required_to_function) and output (success_signal) signals, run by ONE trigger, with the signal checked after each step (so you see "did it produce", not just "did it fire"). Use instead of chaining separate schedules when steps depend on each other. Pass the whole descriptor as `definition`; each step names an agent + offer and inherits that offer\'s signals + deliverable location. Rejected at save if the after-graph is not a DAG or an offer is not workflow-compatible (must publish success_signal + required_to_function + deliverable.location). A schedule trigger creates one backing cron; an event trigger fires on a matching memory write / offer order. A step costs the permission its own endpoint asks, at save and again at a full run: work:request for an agent step (giving an agent work; a workflow saved before 2026-09-25 keeps its agent steps free), ai:use for an ai step or llm.approved, ext:invoke for an extension step, memory:read + storage:write + memory:write for a datapackage step, memory:read + work:request for export-out, work:request for trigger-geai, and memory:read for a workflow that reads the owner\'s records (every signal leaf and every agent step reads one; a signals-only check needs it too); without it the answer is SCOPE_DENIED naming the permission. maxCostUsd caps what one run may spend on AI, in US dollars, counting its ai steps and the node\'s model judging its llm signals. Before an ai step\'s model call starts, the node sets aside what one attempt is expected to cost (the most one attempt cost in the workflow\'s last ten finished runs, else an equal share of the cap nobody holds) and starts it only when that fits beside what the run has spent and what its open calls hold, so ai steps that fit together still run side by side. A call holds its share until it answers, also after a timeout or a retry moved its step on. A step that does not fit waits while a call is open; with none open, the run stops with status "stopped" and says why. A step expected to cost more than the whole cap starts alone while the run has spent less. Past the cap an llm signal is not judged and passes. costCapMorsels does nothing (a morsel is not money) and is removed in 4.0.0; a save that sets it answers with warnings. The save records you as the workflow\'s saver: a run its own trigger starts answers to you, and does not start (status "refused", the owner told once) when you are disconnected or no longer hold a permission its steps need.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Save Workflow', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Agent Workflows (REST: PUT/run → workflow:write; GET → workflow:read)
        scope: 'workflow:write',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'Workflow id (lowercase slug); existing id = update.' },
            definition: { type: 'object', required: true, description: 'The descriptor: { title, description, trigger, vars[], steps[], on_step_fail:"inspect", llm?{approved}, notify_on_finish?, resume?, fresh?, skip_done?, parallel?, maxCostUsd? }. parallel:true lets two or more live runs of this workflow overlap; use it when the keys carry a run-distinguishing var (a case reference in vars, or the built-in {run}); without it a second start while one is in flight is skipped and says so. Refused together with fresh. maxCostUsd (US dollars, per run) caps what a run spends on AI, its ai steps and the judging of its llm signals together: an ai step\'s model call starts only when what one attempt is expected to cost fits in what is left, and holds that share until the call answers, also after a timeout or a retry; otherwise the step waits for the open calls or stops the run. A step expected to cost more than the whole cap starts alone while the run has spent less.' },
            propose: { type: 'boolean', description: 'Operator flow (server MCP only): return a diff vs the current definition + a single-use confirm_token WITHOUT saving.' },
            confirm_token: { type: 'string', description: 'Token from the propose step — applies exactly the proposed definition.' },
        },
    },
    {
        name: 'aimeat_workflow_get',
        description: 'Inspect workflows. Omit id to list all your workflows; pass an id for its definition + the derived blueprint (the whole input→output flow + the memory keys each step touches) + recent runs. The recent runs are the ones that dispatched agents; a signals-only check is not a run and is not listed among them. A run the node ended itself carries a reason: "stopped" at its spending limit (maxCostUsd), or "refused" when its trigger found the workflow\'s saver disconnected or short of a permission (the owner can run it once as themselves from the notification, or approve the permission again). Use before editing or running, and to read a run\'s outcome.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get Workflow', readOnlyHint: true },
        scope: 'workflow:read',
        surfaces: ['agent'],
        input: { id: { type: 'string', description: 'Omit to list; pass for one workflow\'s detail.' } },
    },
    {
        name: 'aimeat_workflow_run',
        description: 'Run a workflow. mode="signals-only" is a CHECK: it evaluates every step\'s signals against existing memory with NO dispatch, costs nothing, returns each step\'s verdict inline, and is kept apart from the runs (it does not appear in the run history or the health); mode="full" executes the steps live (dispatches the agent tasks, which takes time and spends their budget; poll aimeat_workflow_get for progress). Use signals-only to validate a workflow or to see what is already in memory before a full run. A full start while a live run of the same workflow is in flight starts NOTHING unless the definition sets parallel:true: the answer then carries skipped:true and the id of the run that is running, not a new one. Read the flag before treating the id as yours.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Run Workflow', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'workflow:write',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'The workflow id.' },
            mode: { type: 'string', required: true, description: 'signals-only | full', enum: ['signals-only', 'full'] },
            vars: { type: 'object', description: 'The run\'s input, as { varName: value } over the vars the workflow declares. A workflow that takes input is a constant without this. Anything it does not declare is ignored, and a declared var left out falls back to its default.', zod: z.record(z.string(), z.string()) },
            target: { type: 'string', description: 'With mode="full": "sandbox" writes every key behind a per-run prefix so a trial cannot touch what a live run produced. Default "live".', enum: ['live', 'sandbox'] },
        },
    },
    {
        name: 'aimeat_workflow_pending_inputs',
        description: 'List every workflow step currently WAITING FOR HUMAN INPUT across the owner\'s active runs: the pinned question (prompt + options), when it was asked, and the deadline after which the step\'s timeout policy fires. Use to list "things waiting on the owner" — then relay the owner\'s decision with aimeat_workflow_answer.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Pending Workflow Inputs', readOnlyHint: true },
        surfaces: ['agent'],
        input: {},
    },
    {
        name: 'aimeat_workflow_answer',
        description: 'Answer a workflow step that is waiting for human input (state "waiting-human") ON THE OWNER\'S BEHALF — only relay a decision the owner actually made (e.g. from a conversation or an inbox reply); never invent one. Picks are validated against the question pinned at ask time. The answer is written to the step\'s answer_to_key so downstream steps branch on it; the run then advances.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Answer Workflow Input', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'workflow:write',
        surfaces: ['agent'],
        input: {
            workflow_id: { type: 'string', required: true, description: 'The workflow id.' },
            run_id: { type: 'string', required: true, description: 'The run id (from aimeat_workflow_pending_inputs).' },
            step_id: { type: 'string', required: true, description: 'The waiting step id.' },
            picks: { type: 'array', required: true, description: 'Option ids from the pinned question (may be empty when answering with `other` alone).', zod: z.array(z.string()) },
            other: { type: 'string', description: 'Free-text answer; only when the question allows it.' },
        },
    },
    {
        name: 'aimeat_task_list',
        description: 'List the tasks assigned TO this agent (paginated; optional status filter such as queued, active, done, failed, declined). Each entry includes title, status, and todo counts. Poll for queued work, then aimeat_task_get for full detail. To assign a task to another same-owner agent, use aimeat_task_create instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Tasks', readOnlyHint: true },
        surfaces: ['agent', 'primitives', 'chat'],
        input: {
            status: { type: 'string', description: 'Optional task status filter.', zod: z.enum(['draft', 'queued', 'active', 'stalled', 'done', 'failed', 'declined']) },
            page: { type: 'number', description: 'Page number (default 1).' },
            per_page: { type: 'number', description: 'Results per page (default 20, max 100).' },
        },
    },
    {
        name: 'aimeat_task_create',
        description: 'Queue a task for one of your owner\'s agents (yourself or any same-owner agent). The owner sees it in their dashboard. Use this to ask another crew or worker to do something. Pass `files` to hand the target agent documents to work on (an invoice PDF, a form, a dataset) — references only, never bytes; it reads them as presigned URLs via aimeat_task_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Create Task', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'task:write',
        surfaces: ['agent', 'chat'],
        input: {
            target_agent: { type: 'string', required: true, description: 'Name of the agent the task is FOR. Must be owned by the same owner as the calling agent.' },
            title: { type: 'string', required: true, description: 'Short human-readable title for the task.' },
            description: { type: 'string', required: true, description: 'The actual prompt / instruction for the target agent.' },
            status: { type: 'string', enum: ['draft', 'queued'], description: 'Default "queued" (visible to target immediately). Use "draft" for owner-review-first.' },
            files: { type: 'array', description: 'Up to 20 file REFERENCES the target agent needs: "<owner@node>/<storage key>" each (a bare key means one of your own files). You must be able to read each file yourself.', zod: z.array(z.string()).max(20) },
            scope: { type: 'array', description: 'Named parameters the receiving runner DISPATCHES on, each { name, value, type?, description? }. A fleet runner recognises work by a `kind` entry here and takes its pointers (a memory key, an app id) from the others; the description is prose for a model, and a pointer put in the title is the standard way to build a task nothing picks up.', zod: z.array(z.object({
                name: z.string().describe('Field name the receiving runner reads, e.g. "kind", "memory_key", "app_id".'),
                value: z.string(),
                type: z.enum(['text', 'url', 'memory_key', 'number', 'cron']).optional()
                    .describe('How to read the value. Defaults to "text".'),
                description: z.string().optional().describe('What this field is for, for whoever reads the task.'),
            })).max(20) },
            start: { type: 'string', enum: ['automatic', 'confirm'], description: "How THIS task starts. 'confirm' = it waits for the owner's OK; 'automatic' = the agent proposes its plan and goes on (needs agent:write, never for your own task). Leave it out to use the agent's own setting. The answer's `start` says whether it runs now or waits, and why: tell the person." },
        },
    },
    {
        name: 'aimeat_task_get',
        description: 'Get the full detail of one task assigned to this agent: description, scope, rules, verification criteria, resources (including any attached FILES, each with a presigned download_url to fetch out-of-band), and the ordered todo list with per-todo status. Only the agent the task belongs to may read it. Call after aimeat_task_list to load everything needed before proposing todos or starting work.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get Task', readOnlyHint: true },
        surfaces: ['agent', 'chat'],
        input: { task_id: { type: 'string', required: true, description: 'Task identifier.' } },
    },
    {
        name: 'aimeat_task_propose_todos',
        description: "Propose TODOs for a queued task, a task that started on its own and has no plan yet (e.g. the Hello Integration test task), or re-propose after the owner has requested changes. The server preserves the prior proposal as outdated history. Mark each step that spends money, sends mail or a message in the owner's name, or deletes the owner's data with `effects`: such a plan waits for the owner's OK whatever the agent's setting. The answer's `next` says what to do: 'go_on' (the task is active, carry out the plan) or 'wait_for_owner' (the owner has been told; do nothing until the task is active).",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Propose Task TODOs', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent'],
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            todos: { type: 'array', required: true, description: "Array of TODOs with title, optional description, verification, estimate_minutes, and effects (any of 'spend', 'send_as_owner', 'delete').", zod: z.array(z.object({
                title: z.string().describe('TODO title'),
                description: z.string().optional().describe('TODO details'),
                verification: z.string().optional().describe('How completion can be verified'),
                estimate_minutes: z.number().optional().describe('Estimated work time in minutes'),
                effects: z.array(z.enum(['spend', 'send_as_owner', 'delete'])).optional()
                    .describe("Declare what this step does that the owner must see first: 'spend' (money), 'send_as_owner' (mail or a message in the owner's name), 'delete' (removes the owner's data). A plan with any of these waits for the owner's OK."),
            })) },
        },
    },
    {
        name: 'aimeat_task_start',
        description: "Start a task that waits for the owner's OK, because the owner told you to (\"go ahead\", \"start it\"). Only on the owner's word, and only for another of their agents: never your own task. A task held because its agent can spend money, send mail as the owner or delete as the owner, or because its plan says it will, is refused: tell the person to press Start in the notification they got or in Tasks.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Start a Waiting Task', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // Starts work that was waiting for the owner's OK, on the owner's word.
        scope: 'task:write',
        surfaces: ['agent'],
        input: { task_id: { type: 'string', required: true, description: 'The waiting task to start.' } },
    },
    {
        name: 'aimeat_agent_scope_narrow',
        description: "Replace one of the owner's agents' \"all permissions\" (*) with the named permissions it actually used, as the node recorded them. Use it when the person agrees after you showed them the list (aimeat_agents_list: task_start_wildcard.proposal). An agent with * has every task wait for the owner's OK once two weeks of its use are on record; narrowed, it starts on its own again if its setting says so. Refused when nothing it used is on record yet. Needs agent:permissions.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Narrow an Agent to What It Used', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Takes an agent's * away for the words it used: changing a sibling's permissions, the word
        // POST /v1/agents/:name/scope-narrowing asks too.
        scope: 'agent:permissions',
        surfaces: ['agent'],
        input: { target_agent_name: { type: 'string', required: true, description: 'The agent holding * to narrow (same owner as you).' } },
    },
    {
        name: 'aimeat_agent_task_start_set',
        description: "Set whether one of the owner's agents starts its tasks on its own ('automatic': it proposes its plan and goes on, and the owner sees what was done) or waits for the owner's OK on each ('confirm'). Use it when the person says so (\"let the concierge start its tasks by itself\"). null leaves it to the agent's mode again. Never for yourself. An agent that can spend money, send mail as the owner or delete as the owner always waits whatever this says; the answer's task_start_held_by names those permissions.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Set How an Agent\'s Tasks Start', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Changes whether an agent's work starts without asking: the agent:write word, like its mode.
        scope: 'agent:write',
        surfaces: ['agent'],
        input: {
            target_agent_name: { type: 'string', required: true, description: 'The agent this is about (same owner as you, never yourself).' },
            task_start: { type: 'string', required: true, enum: ['automatic', 'confirm'], description: "'automatic' or 'confirm'; null = leave it to the agent's mode.", zod: z.enum(['automatic', 'confirm']).nullable() },
        },
    },
    {
        name: 'aimeat_task_request_changes',
        description: "Owner-only: ask an agent to revise its proposed TODO plan for a queued task. Marks the existing todos as outdated, flips the task status to 'revision_requested', and pushes a linked message to the agent's inbox carrying the owner's free-text change request.",
        caller: 'owner',
        visibility: agentEverywhere,
        annotations: { title: 'Request TODO Plan Changes', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier (must be a queued task with existing proposed todos).' },
            message: { type: 'string', required: true, description: "Owner's free-text change request." },
        },
    },
    {
        name: 'aimeat_task_event',
        description: 'Append a progress event (e.g. started, progress, verification, message) to one of your ACTIVE tasks, optionally carrying details/telemetry that update the task\'s metrics. Use this to narrate work as it happens so the owner can follow along. Events can only be appended while the task is active; to flip individual todos use aimeat_task_todo, and to finish use aimeat_task_complete / aimeat_task_fail.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Append Task Event', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        surfaces: ['agent'],
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            type: { type: 'string', required: true, description: 'Event type.', zod: z.enum([
                'started', 'progress', 'todo_completed', 'todo_failed',
                'memory_write', 'extension_install', 'app_publish',
                'verification', 'completed', 'failed', 'message',
            ]) },
            message: { type: 'string', required: true, description: 'Event message.' },
            details: { type: 'object', description: 'Optional event details.' },
        },
    },
    {
        name: 'aimeat_task_todo',
        description: 'Update the status of one TODO item within an ACTIVE task (pending, active, done, failed, skipped). Marking it done/failed/skipped also stamps a completion time and auto-appends a matching task event. Works only on active tasks; to first lay out the plan use aimeat_task_propose_todos.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Update Task TODO', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent'],
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            todo_id: { type: 'string', required: true, description: 'TODO item identifier.' },
            status: { type: 'string', required: true, enum: ['pending', 'active', 'done', 'failed', 'skipped'], description: 'New TODO status.' },
        },
    },
    {
        name: 'aimeat_task_complete',
        description: 'Mark one of your ACTIVE or STALLED tasks as done, with an optional completion message and an optional deliverable_key naming the memory record you produced. Sets status to done, stamps completedAt, appends a completed event, and runs everything a completion sets off: the workflow step advances, the open item closes, your counters move, and a PUBLIC deliverable reaches the node feed. A stalled task counts because an agent that crashed and came back still finished the work. If it could not be done, use aimeat_task_fail instead.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Complete Task', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent', 'primitives'],
        input: {
            ...aiProvenanceCatalogInput,
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            message: { type: 'string', description: 'Completion message.' },
            deliverable_key: { type: 'string', description: "The memory key, under the agent's own namespace, where the result was published. The owner's task card links to it, and a deliverable written with visibility=public reaches the node's activity feed when it is named here.", zod: z.string().max(256) },
        },
    },
    {
        name: 'aimeat_task_fail',
        description: 'Mark one of your ACTIVE or STALLED tasks as failed, recording the reason. Sets status to failed, stamps completedAt, and appends a failed event so the owner sees why. A stalled task counts: an agent that crashed is exactly the one that needs to report a failure. If the work succeeded, use aimeat_task_complete instead. If you chose not to do the work because the request is not one you should take, use aimeat_task_decline: a refusal is not a failure.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Fail Task', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent'],
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            reason: { type: 'string', required: true, description: 'Reason for failure.' },
        },
    },
    {
        name: 'aimeat_task_decline',
        description: "Decline one of your QUEUED, ACTIVE or STALLED tasks because the request is not one you should take (off your topic, against your rules, outside what the owner allowed), with the reason. The task ends as declined, not failed: the owner's task list shows your reason as a refusal, and none of your failure counts move. Use aimeat_task_fail when you tried and could not do it.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Decline Task', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent'],
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            reason: { type: 'string', required: true, description: 'Why you decline the request, in a sentence the owner reads (at most 2000 characters).' },
        },
    },
    {
        name: 'aimeat_memory_read',
        description: 'Read one memory entry by its exact key for the calling agent. Use when you already know the key (from aimeat_memory_list or a prior write); for discovery use aimeat_memory_list, for content search use aimeat_memory_search. Returns the stored value plus visibility, tags, and version. The value may be any JSON type. response_format=concise returns only key+value.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Memory Entry', readOnlyHint: true },
        // Memory (GET /v1/memory/:key → memory:read; POST/PUT → memory:write)
        scope: 'memory:read',
        surfaces: ['agent', 'service', 'commerce', 'primitives', 'chat'],
        supportsResponseFormat: true,
        conciseFields: ['key', 'value'],
        input: {
            key: { type: 'string', required: true, description: 'Exact memory entry key (hierarchical, slash-separated).' },
            owner_scope: { type: 'boolean', description: "Also look in the OWNER's namespace and your sibling agents', not only your own.", zod: flexibleBoolean },
        },
    },
    {
        name: 'aimeat_memory_write',
        description: 'Write (create or update) a memory entry for the calling agent. The value can be any JSON: string, number, boolean, object, or array. Visibility controls who can read it: private = only this agent, owner = all of the owner\'s agents, group = members of a sharing group (requires group_id), public = anyone. Re-writing the same key bumps its version. Use tags to group entries for later filtering with aimeat_memory_list. TIP: workspace documents can embed a key LIVE (an ```aimeat-memory fenced block naming the key shows its current value on every open) — store table-like data as an array of objects with consistent field names and re-write the SAME key to update every document embedding it.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Write Memory Entry', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent', 'service', 'commerce', 'primitives', 'chat'],
        input: {
            ...aiProvenanceCatalogInput,
            key: { type: 'string', required: true, description: 'Memory entry key (hierarchical, slash-separated, e.g. "project/acme/notes").' },
            value: { type: 'unknown', required: true, description: 'Value to store — any JSON type.' },
            visibility: { type: 'string', enum: ['private', 'owner', 'group', 'members', 'public'], description: 'Who can read it (members = any logged-in user of this node). Default: private.' },
            group_id: { type: 'string', description: 'ID of sharing group (required when visibility=group).' },
            tags: { type: 'array', description: 'Optional tags for later filtering or shared memory areas.' },
            ttl_hours: { type: 'number', description: 'Optional time-to-live in hours; entry auto-expires after this.' },
            owner_scope: { type: 'boolean', description: 'Write under the OWNER instead of yourself. Requires the memory:write-as-owner scope.' },
            expected_version: { type: 'number', description: 'Optimistic lock: the version you read. Refused with VERSION_CONFLICT if the record changed since. Pass 0 to assert the key does not exist yet. Omit for last-write-wins.' },
        },
    },
    {
        name: 'aimeat_memory_delete',
        description: 'Delete one of your memory entries. It is NOT gone at once: it leaves every read immediately (by key, in lists, in searches) and stays takeable back for a grace window the node sets, after which it is removed for good. The answer tells you the moment that window closes. Use aimeat_memory_restore to change your mind. This node deliberately had no delete for a long time - a value could be emptied but never removed - and the window is how that caution survives.',
        caller: 'agent',
        visibility: agentEverywhere,
        // destructiveHint TRUE even though a delete is takeable back for the grace window: the client
        // showing this hint is asking whether to warn a person, and "it can be undone for a few days"
        // is not the same promise as "nothing is lost". Restore is the opposite — it only ever puts
        // something back — and repeating it changes nothing, so it is idempotent.
        annotations: { title: 'Delete Memory Entry', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        // `memory:delete` finally reaches a tool. It was a scope an owner could grant that no tool
        // anywhere asked for, so granting it did nothing for an agent using tools.
        scope: 'memory:delete',
        input: {
            key: { type: 'string', required: true, description: 'Exact memory entry key to delete.' },
            owner_scope: { type: 'boolean', description: "Also reach the OWNER's namespace and your sibling agents', not only your own.", zod: flexibleBoolean },
        },
    },
    {
        name: 'aimeat_memory_restore',
        description: 'Put back a memory entry you deleted, whole, as long as the grace window has not closed. Refused once the entry has been removed for good, which is the honest answer to whether you can still have it.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Restore Deleted Memory Entry', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // RESTORE IS A WRITE, not a delete. Putting a record back into the working set is making it
        // exist again, and an agent trusted to remove things is not automatically trusted to make
        // them reappear under a name someone else may now be using.
        scope: 'memory:write',
        input: {
            key: { type: 'string', required: true, description: 'Exact memory entry key to put back.' },
            owner_scope: { type: 'boolean', description: "Also reach the OWNER's namespace and your sibling agents'.", zod: flexibleBoolean },
        },
    },
    {
        name: 'aimeat_memory_list',
        description: 'List memory entries for the calling agent (metadata only, not full values — use aimeat_memory_read for a value). Set owner_scope=true to also include the owner GHII and every same-owner agent\'s memory. Filter with prefix (key prefix), visibility, and tags. Always pass limit on large stores. response_format=concise drops owner_gaii/version noise.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Memory Entries', readOnlyHint: true },
        scope: 'memory:read',
        surfaces: ['agent', 'service', 'commerce', 'chat'],
        supportsResponseFormat: true,
        conciseFields: ['key', 'visibility', 'tags', 'updated_at'],
        concisePath: 'items',
        input: {
            prefix: { type: 'string', description: 'Key prefix filter, e.g. "project/".' },
            visibility: { type: 'string', enum: ['private', 'owner', 'group', 'members', 'public'], description: 'Optional visibility filter.', zod: z.string() },
            tags: { type: 'array', description: 'Optional tag filters.', zod: z.array(z.string()) },
            owner_scope: { type: 'boolean', description: 'When true, list same-owner GHII and all same-owner agent memory.', zod: flexibleBoolean },
            limit: { type: 'number', description: 'Maximum entries to return (recommended on large stores).', zod: z.number().int().positive().max(MEMORY_LIST_MAX_LIMIT) },
        },
    },
    {
        name: 'aimeat_memory_search',
        description: 'Full-text search across this agent\'s own memory entries (optionally filtered by visibility). Returns a SNIPPET per hit (a short window around the match) + key/bytes/tags — NOT the full value, so a broad query stays a sane size. Capped at `limit` hits (default 50) and skips `.version.N` history by default. Read a hit\'s full value with aimeat_memory_read on its exact key. Use when you know roughly what you stored but not the exact key; to browse keys by prefix/tag use aimeat_memory_list. `type` narrows to what a record IS rather than what it says — a semantic type such as schema:Person or aimeat:Task, several separated by commas, or a full IRI; it matches whichever spelling the writer used, so schema:Person finds a record written as https://schema.org/Person. Give a single `type` with no `query` to list records of that type; give both to search within one type. GET /v1/ns lists the types this node names for itself.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Search Memory', readOnlyHint: true },
        scope: 'memory:read',
        surfaces: ['agent', 'service', 'commerce', 'primitives', 'chat'],
        input: {
            query: { type: 'string', description: 'Search query. Optional when `type` names a single type.' },
            type: { type: 'string', description: 'Semantic type(s) to narrow to, comma-separated: schema:Person, aimeat:Task, or a full IRI.' },
            visibility: { type: 'string', enum: ['private', 'owner', 'group', 'members', 'public'], description: 'Optional visibility filter.' },
            limit: { type: 'number', description: 'Max hits to return (default 50, max 200).' },
            include_versions: { type: 'boolean', description: 'Include `.version.N` history snapshots (skipped by default).' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
