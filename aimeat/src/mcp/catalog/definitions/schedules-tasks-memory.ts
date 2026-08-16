/**
 * @file schedules-tasks-memory.ts
 * @description Schedule, workflow, task lifecycle, and agent memory (read/write/list/search) tool definitions.
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   v1.1.0 — 2026-08-14 — aimeat_task_create gains `scope`: the named parameters a receiving
 *     runner dispatches on, which the tool had no way to send.
 *   v1.0.0 — 2026-07-13 — Extracted from definitions.ts (pure extraction; no behavior change).
 */

import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

export const schedulesTasksMemoryTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_schedule_create',
        description: 'Create a recurring schedule the AIMEAT server runs on a cron clock (survives your disconnect; the owner can pause/cancel it any time). FIRST, if a person asked for an AGENT that does something regularly ("every morning", "each week", "keep track of"), load the skill `node:hatchery-agent-requests` and follow it instead of assembling this yourself — they may have a hatchery that runs real agents, and a schedule you build here over a key nothing writes looks finished and stays empty. kind="ai" runs a server-side OpenRouter completion over predefined owner memory keys and stores the result (use for "translate the news every morning"); kind="agent_task" queues a task into your own queue each fire (for work needing your tools); kind="extension" runs an installed extension action with zero tokens (for fetch+store). Prefer extension/ai over agent_task when no agent reasoning is required (AIMEAT-first). Pass a timezone for daily schedules.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            kind: { type: 'string', required: true, description: 'ai | agent_task | extension', enum: ['ai', 'agent_task', 'extension'] },
            cron: { type: 'string', required: true, description: 'Cron expression, e.g. "0 7 * * *".' },
            display_name: { type: 'string', required: true, description: 'Human-readable label.' },
            timezone: { type: 'string', description: 'IANA timezone, e.g. "Europe/Helsinki".' },
            purpose: { type: 'string', description: 'Why this runs (shown to the owner).' },
            prompt: { type: 'string', description: 'ai: instruction applied to the input memory values.' },
            input_keys: { type: 'array', description: 'ai: owner memory keys fed in as context.' },
            output_key: { type: 'string', description: 'ai: memory key for the result (auto-generated if omitted).' },
            task_title: { type: 'string', description: 'agent_task: title of the task created each fire.' },
            extension_name: { type: 'string', description: 'extension: installed extension name.' },
            action_id: { type: 'string', description: 'extension: action id to run.' },
        },
    },
    {
        name: 'aimeat_schedule_list',
        description: 'List the schedules you created (id, kind, cron, enabled, last/next run, run count). Use before updating or deleting one.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_schedule_update',
        description: 'Update one of your schedules: pause/resume (enabled=false/true), change the cron, timezone, or display name. Re-arms the live cron immediately.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            schedule_id: { type: 'string', required: true, description: 'The schedule id.' },
            enabled: { type: 'boolean', description: 'false = pause, true = resume.' },
            cron: { type: 'string', description: 'New cron expression.' },
            timezone: { type: 'string', description: 'New IANA timezone.' },
            display_name: { type: 'string', description: 'New label.' },
        },
    },
    {
        name: 'aimeat_schedule_delete',
        description: 'Cancel and remove one of your schedules. Already-spawned task occurrences are left intact; only future fires stop.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { schedule_id: { type: 'string', required: true, description: 'The schedule id.' } },
    },
    {
        name: 'aimeat_schedule_trigger',
        description: 'Run one of your schedules once, right now, without waiting for its cron. Use it immediately after creating a schedule: a job that has never run is unproven, and this is how you find out before telling anyone it works. The reply says what actually happened — "created" queued a task, "ran" executed a server-side job, "busy" means a previous run is still going, "limited" means a constraint stopped it, "error" means it ran and failed. Only "created" and "ran" are success. Then read the key the job writes to and check there is content in it; that, not this reply, is the proof.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { schedule_id: { type: 'string', required: true, description: 'The schedule id.' } },
    },
    {
        name: 'aimeat_schedule_report_internal',
        description: 'If you run your OWN recurring jobs outside AIMEAT (your own cron/heartbeat), report them here so the owner sees them in the scheduler. Pass your full current set each time (it replaces the previous report). AIMEAT only displays these — it does not run them.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            entries: { type: 'array', required: true, description: 'Array of {name, description?, purpose?, cron?, timezone?, schedule?, status?, kind?}.' },
        },
    },
    {
        name: 'aimeat_workflow_save',
        description: 'Create or update an Agent Workflow: a declared, ordered set of steps with per-step input (required_to_function) and output (success_signal) signals, run by ONE trigger, with the signal checked after each step (so you see "did it produce", not just "did it fire"). Use instead of chaining separate schedules when steps depend on each other. Pass the whole descriptor as `definition`; each step names an agent + offer and inherits that offer\'s signals + deliverable location. Rejected at save if the after-graph is not a DAG or an offer is not workflow-compatible (must publish success_signal + required_to_function + deliverable.location). A schedule trigger creates one backing cron; an event trigger fires on a matching memory write / offer order.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'Workflow id (lowercase slug); existing id = update.' },
            definition: { type: 'object', required: true, description: 'The descriptor: { title, description, trigger, vars[], steps[], on_step_fail:"inspect", llm?{approved} }.' },
            propose: { type: 'boolean', description: 'Operator flow (server MCP only): return a diff vs the current definition + a single-use confirm_token WITHOUT saving.' },
            confirm_token: { type: 'string', description: 'Token from the propose step — applies exactly the proposed definition.' },
        },
    },
    {
        name: 'aimeat_workflow_get',
        description: 'Inspect workflows. Omit id to list all your workflows; pass an id for its definition + the derived blueprint (the whole input→output flow + the memory keys each step touches) + recent runs. Use before editing or running, and to read a run\'s outcome.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', description: 'Omit to list; pass for one workflow\'s detail.' } },
    },
    {
        name: 'aimeat_workflow_run',
        description: 'Run a workflow. mode="signals-only" evaluates every step\'s signals against existing memory with NO dispatch (an instant health check — returns each step\'s verdict inline); mode="full" executes the steps live (dispatches the agent tasks; poll aimeat_workflow_get for progress). Use signals-only to validate a workflow or check a past run cheaply before a full run.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'The workflow id.' },
            mode: { type: 'string', required: true, description: 'signals-only | full', enum: ['signals-only', 'full'] },
        },
    },
    {
        name: 'aimeat_workflow_pending_inputs',
        description: 'List every workflow step currently WAITING FOR HUMAN INPUT across the owner\'s active runs: the pinned question (prompt + options), when it was asked, and the deadline after which the step\'s timeout policy fires. Use to surface "things waiting on the owner" — then relay the owner\'s decision with aimeat_workflow_answer.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_workflow_answer',
        description: 'Answer a workflow step that is waiting for human input (state "waiting-human") ON THE OWNER\'S BEHALF — only relay a decision the owner actually made (e.g. from a conversation or an inbox reply); never invent one. Picks are validated against the question pinned at ask time. The answer is written to the step\'s answer_to_key so downstream steps branch on it; the run then advances.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            workflow_id: { type: 'string', required: true, description: 'The workflow id.' },
            run_id: { type: 'string', required: true, description: 'The run id (from aimeat_workflow_pending_inputs).' },
            step_id: { type: 'string', required: true, description: 'The waiting step id.' },
            picks: { type: 'array', required: true, description: 'Option ids from the pinned question (may be empty when answering with `other` alone).' },
            other: { type: 'string', description: 'Free-text answer; only when the question allows it.' },
        },
    },
    {
        name: 'aimeat_task_list',
        description: 'List the tasks assigned TO this agent (paginated; optional status filter such as queued, active, done, failed). Each entry includes title, status, and todo counts. Poll for queued work, then aimeat_task_get for full detail. To assign a task to another same-owner agent, use aimeat_task_create instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            status: { type: 'string', description: 'Optional task status filter.' },
            page: { type: 'number', description: 'Page number (default 1).' },
            per_page: { type: 'number', description: 'Results per page (default 20, max 100).' },
        },
    },
    {
        name: 'aimeat_task_create',
        description: 'Queue a task for one of your owner\'s agents (yourself or any same-owner agent). The owner sees it in their dashboard. Use this to ask another crew or worker to do something. Pass `files` to hand the target agent documents to work on (an invoice PDF, a form, a dataset) — references only, never bytes; it reads them as presigned URLs via aimeat_task_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            target_agent: { type: 'string', required: true, description: 'Name of the agent the task is FOR. Must be owned by the same owner as the calling agent.' },
            title: { type: 'string', required: true, description: 'Short human-readable title for the task.' },
            description: { type: 'string', required: true, description: 'The actual prompt / instruction for the target agent.' },
            status: { type: 'string', enum: ['draft', 'queued'], description: 'Default "queued" (visible to target immediately). Use "draft" for owner-review-first.' },
            files: { type: 'array', description: 'Up to 20 file REFERENCES the target agent needs: "<owner@node>/<storage key>" each (a bare key means one of your own files). You must be able to read each file yourself.' },
            scope: { type: 'array', description: 'Named parameters the receiving runner DISPATCHES on, each { name, value, type?, description? }. A fleet runner recognises work by a `kind` entry here and takes its pointers (a memory key, an app id) from the others; the description is prose for a model, and a pointer put in the title is the standard way to build a task nothing picks up.' },
        },
    },
    {
        name: 'aimeat_task_get',
        description: 'Get the full detail of one task assigned to this agent: description, scope, rules, verification criteria, resources (including any attached FILES, each with a presigned download_url to fetch out-of-band), and the ordered todo list with per-todo status. Only the agent the task belongs to may read it. Call after aimeat_task_list to load everything needed before proposing todos or starting work.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { task_id: { type: 'string', required: true, description: 'Task identifier.' } },
    },
    {
        name: 'aimeat_task_propose_todos',
        description: 'Propose TODOs for a queued task, an auto-activated task that has no plan yet (e.g. the Hello Integration test task), or re-propose after the owner has requested changes. The server preserves the prior proposal as outdated history. For task-runner mode agents a proposal on a queued task auto-activates it (no owner click needed).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            todos: { type: 'array', required: true, description: 'Array of TODOs with title, optional description, verification, and estimate_minutes.' },
        },
    },
    {
        name: 'aimeat_task_request_changes',
        description: "Owner-only: ask an agent to revise its proposed TODO plan for a queued task. Marks the existing todos as outdated, flips the task status to 'revision_requested', and pushes a linked message to the agent's inbox carrying the owner's free-text change request.",
        caller: 'owner',
        visibility: agentEverywhere,
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
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            type: { type: 'string', required: true, description: 'Event type.' },
            message: { type: 'string', required: true, description: 'Event message.' },
            details: { type: 'object', description: 'Optional event details.' },
        },
    },
    {
        name: 'aimeat_task_todo',
        description: 'Update the status of one TODO item within an ACTIVE task (pending, active, done, failed, skipped). Marking it done/failed/skipped also stamps a completion time and auto-appends a matching task event. Works only on active tasks; to first lay out the plan use aimeat_task_propose_todos.',
        caller: 'agent',
        visibility: agentEverywhere,
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
        input: {
            ...aiProvenanceCatalogInput,
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            message: { type: 'string', description: 'Completion message.' },
            deliverable_key: { type: 'string', description: "The memory key, under the agent's own namespace, where the result was published. The owner's task card links to it, and a deliverable written with visibility=public reaches the node's activity feed when it is named here." },
        },
    },
    {
        name: 'aimeat_task_fail',
        description: 'Mark one of your ACTIVE or STALLED tasks as failed, recording the reason. Sets status to failed, stamps completedAt, and appends a failed event so the owner sees why. A stalled task counts: an agent that crashed is exactly the one that needs to report a failure. If the work succeeded, use aimeat_task_complete instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            reason: { type: 'string', required: true, description: 'Reason for failure.' },
        },
    },
    {
        name: 'aimeat_memory_read',
        description: 'Read one memory entry by its exact key for the calling agent. Use when you already know the key (from aimeat_memory_list or a prior write); for discovery use aimeat_memory_list, for content search use aimeat_memory_search. Returns the stored value plus visibility, tags, and version. The value may be any JSON type. response_format=concise returns only key+value.',
        caller: 'agent',
        visibility: agentEverywhere,
        supportsResponseFormat: true,
        conciseFields: ['key', 'value'],
        input: {
            key: { type: 'string', required: true, description: 'Exact memory entry key (hierarchical, slash-separated).' },
            owner_scope: { type: 'boolean', description: "Also look in the OWNER's namespace and your sibling agents', not only your own." },
        },
    },
    {
        name: 'aimeat_memory_write',
        description: 'Write (create or update) a memory entry for the calling agent. The value can be any JSON: string, number, boolean, object, or array. Visibility controls who can read it: private = only this agent, owner = all of the owner\'s agents, group = members of a sharing group (requires group_id), public = anyone. Re-writing the same key bumps its version. Use tags to group entries for later filtering with aimeat_memory_list. TIP: workspace documents can embed a key LIVE (an ```aimeat-memory fenced block naming the key shows its current value on every open) — store table-like data as an array of objects with consistent field names and re-write the SAME key to update every document embedding it.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
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
        name: 'aimeat_memory_list',
        description: 'List memory entries for the calling agent (metadata only, not full values — use aimeat_memory_read for a value). Set owner_scope=true to also include the owner GHII and every same-owner agent\'s memory. Filter with prefix (key prefix), visibility, and tags. Always pass limit on large stores. response_format=concise drops owner_gaii/version noise.',
        caller: 'agent',
        visibility: agentEverywhere,
        supportsResponseFormat: true,
        conciseFields: ['key', 'visibility', 'tags', 'updated_at'],
        concisePath: 'items',
        input: {
            prefix: { type: 'string', description: 'Key prefix filter, e.g. "project/".' },
            visibility: { type: 'string', enum: ['private', 'owner', 'group', 'members', 'public'], description: 'Optional visibility filter.' },
            tags: { type: 'array', description: 'Optional tag filters.' },
            owner_scope: { type: 'boolean', description: 'When true, list same-owner GHII and all same-owner agent memory.' },
            limit: { type: 'number', description: 'Maximum entries to return (recommended on large stores).' },
        },
    },
    {
        name: 'aimeat_memory_search',
        description: 'Full-text search across this agent\'s own memory entries (optionally filtered by visibility). Returns a SNIPPET per hit (a short window around the match) + key/bytes/tags — NOT the full value, so a broad query stays a sane size. Capped at `limit` hits (default 50) and skips `.version.N` history by default. Read a hit\'s full value with aimeat_memory_read on its exact key. Use when you know roughly what you stored but not the exact key; to browse keys by prefix/tag use aimeat_memory_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            query: { type: 'string', required: true, description: 'Search query.' },
            visibility: { type: 'string', enum: ['private', 'owner', 'group', 'members', 'public'], description: 'Optional visibility filter.' },
            limit: { type: 'number', description: 'Max hits to return (default 50, max 200).' },
            include_versions: { type: 'boolean', description: 'Include `.version.N` history snapshots (skipped by default).' },
        },
    },
];
