/**
 * @file definitions.ts
 * @description Shared metadata catalog for AIMEAT tools. The catalog is transport-neutral:
 *   public MCP, local connector MCP, and shell CLI fallback can read the same names,
 *   descriptions, input metadata, and visibility flags while keeping their execution
 *   adapters separate.
 * @structure
 *   - AimeatToolDefinition -- transport-neutral tool contract metadata
 *   - CLI_FALLBACK_TOOL_DEFINITIONS -- first catalog slice used by `aimeat connect call`
 *   - getAimeatToolDefinition() -- lookup helper by tool name
 * @usage
 *   import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../../mcp/catalog/definitions.js';
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Add initial shared catalog for connector CLI fallback
 *   v1.1.0 -- 2026-05-28 -- Add app, extension, and cortex lifecycle tools to CLI fallback catalog
 *   v1.2.0 -- 2026-05-28 -- Add core memory, work, wallet, board, storage, and admin CLI fallback tools
 *   v1.3.0 -- 2026-05-28 -- Allow unknown payload field metadata
 *   v1.4.0 -- 2026-05-28 -- Add remaining shared public/connector MCP tools except server-only admin mint
 *   v1.5.0 -- 2026-05-28 -- Add memory tags and owner-scope listing metadata
 *   v1.6.0 -- 2026-05-30 -- MCP audit Phase 1: add supportsResponseFormat + conciseFields metadata,
 *     add aimeat_admin_mint entry (catalog now complete vs all registered tools). Catalog is the
 *     canonical source of tool descriptions read by both MCP surfaces via shape.ts:descriptionFor().
 *   v1.7.0 -- 2026-05-30 -- MCP audit Phase 1 (F6): enrich terse tool descriptions to "new teammate" level.
 *   v1.8.0 -- 2026-05-30 -- F10 drift reconciliation: align catalog input metadata with reconciled
 *     server/connector schemas (organism, knowledge, groups, catalogue, apps, capabilities, boards,
 *     flags, memory, tasks, work, message, handbook, extensions, cortex, storage, instances).
 */

export type ToolCallerType = 'agent' | 'owner' | 'operator' | 'public';

export interface ToolVisibility {
    publicMcp: boolean;
    connectorMcp: boolean;
    cliFallback: boolean;
}

export interface ToolInputField {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';
    required?: boolean;
    description: string;
    enum?: string[];
}

export interface AimeatToolDefinition {
    name: string;
    description: string;
    caller: ToolCallerType;
    visibility: ToolVisibility;
    input: Record<string, ToolInputField>;
    /** F5: tool accepts a `response_format` ('concise' | 'detailed') input parameter. */
    supportsResponseFormat?: boolean;
    /**
     * F5: fields kept when `response_format` is 'concise'. Applied by shape.ts:shapeResponse()
     * to the tool's high-signal return payload (array items or a single object). When absent,
     * 'concise' is a no-op. Keys must match the handler's snake_case return fields.
     */
    conciseFields?: string[];
    /**
     * F5: for list tools whose connector REST payload wraps the array under a key
     * (e.g. { items: [...] }, { actions: [...] }), the wrapper key. Lets one catalog entry shape
     * both the server's bare array and the connector's wrapped object. Omit for bare-array or
     * single-record tools.
     */
    concisePath?: string;
}

const agentEverywhere: ToolVisibility = {
    publicMcp: true,
    connectorMcp: true,
    cliFallback: true,
};

export const CLI_FALLBACK_TOOL_DEFINITIONS: AimeatToolDefinition[] = [
    {
        name: 'aimeat_handbook_get',
        description: 'Fetch a managed system prompt (the agent operating handbook), addressed by tier or prompt ID. Pass "tier1"/"tier2" (or "tier-1") for the standard onboarding/operating directives, or a custom prompt ID. Returns the prompt name, description, content, and any variables. Read this during onboarding to learn how to operate on the node; confirm you have read it with aimeat_onboarding_confirm_directives_read.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            module: { type: 'string', description: 'Optional handbook module name, such as tasks or messages.' },
            surface: { type: 'string', enum: ['appdev', 'agent', 'service', 'admin'], description: 'Optional v2 surface role — returns that surface\'s operating handbook.' },
        },
    },
    {
        name: 'aimeat_onboarding_status',
        description: 'Check this agent\'s Hello Integration onboarding progress: which steps have passed, which are still pending, and a next_step hint pointing to the tool to call next. Start here when connecting and re-call it after each step to see what remains. Auto-checked steps refresh on read; completing all required steps finalizes onboarding and computes a readiness score.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_onboarding_identify_platform',
        description: 'Complete the "identify platform" onboarding step by declaring which runtime you are (e.g. claude, openclaw, hermes, vscode, generic). Records the platform on the agent record and marks the step passed. One of the steps surfaced by aimeat_onboarding_status; call it when next_step is identify_platform.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            platform: { type: 'string', required: true, description: 'Runtime/platform name, for example hermes, claude, vscode, or generic.' },
            platform_version: { type: 'string', description: 'Runtime/platform version if known.' },
        },
    },
    {
        name: 'aimeat_onboarding_confirm_skill_installed',
        description: 'Complete the "install skill" onboarding step by confirming the local AIMEAT skill bundle is available, passing the platform and bundle version (use "local" when no version is shown). Marks the step passed. One of the steps surfaced by aimeat_onboarding_status.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            platform: { type: 'string', required: true, description: 'Runtime/platform using the bundle.' },
            version: { type: 'string', required: true, description: 'Bundle version, or local when no version is shown.' },
        },
    },
    {
        name: 'aimeat_onboarding_confirm_directives_read',
        description: 'Complete the "read directives" onboarding step by confirming you have read the AIMEAT handbook (fetch it first with aimeat_handbook_get). Pass confirmed=true to mark the step passed. One of the steps surfaced by aimeat_onboarding_status.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { confirmed: { type: 'boolean', description: 'Set true after reading the handbook/directives.' } },
    },
    {
        name: 'aimeat_onboarding_declare_services',
        description: 'Complete the optional "declare services" onboarding step by listing services this agent offers (name + optional description). An empty list is allowed. Marks the step passed; this is advisory metadata, distinct from the action catalogue or aimeat_agent_capabilities_report. One of the steps surfaced by aimeat_onboarding_status.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { services: { type: 'array', description: 'Optional array of service objects with name and description.' } },
    },
    {
        name: 'aimeat_agent_capabilities_report',
        description: 'Self-report this agent\'s capabilities so other agents can discover it: technical capabilities (MCP servers, skills, tools — MCP-type entries are auto-marked verified), domain expertise, and human languages. Overwrites the previously reported capability set on the agent record. Use during/after onboarding; this is descriptive metadata, not the same as registering a hireable action or aimeat_capabilities_create.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            technical: { type: 'array', description: 'Array of technical capabilities: { name, type }.' },
            domain: { type: 'array', description: 'Array of domain expertise strings.' },
            languages: { type: 'array', description: 'Array of language codes.' },
        },
    },
    {
        name: 'aimeat_agent_activity',
        description: 'View this agent\'s own activity statistics plus a time-series history (default last 30 days, daily granularity). Read-only — useful for self-reflection or reporting on recent work volume. For raw telemetry events you push, use aimeat_agent_telemetry_report; for task-level progress use aimeat_task_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            days: { type: 'number', description: 'Number of days of history to retrieve.' },
            granularity: { type: 'string', enum: ['daily', 'hourly'], description: 'History granularity.' },
        },
    },
    {
        name: 'aimeat_agent_telemetry_report',
        description: 'Append one telemetry event (llm_call, tool_call, or agent_report) recording metrics such as tokens, duration, or tool name; optionally tie it to a session or AIMEAT task. Feeds the node\'s activity stats (viewable via aimeat_agent_activity). Use for fine-grained runtime metrics — for task lifecycle/progress use the aimeat_task_* tools instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            type: { type: 'string', enum: ['llm_call', 'tool_call', 'agent_report'], description: 'Telemetry event type.' },
            data: { type: 'object', description: 'Telemetry data such as tokens, duration, or tool name.' },
            session_id: { type: 'string', description: 'Optional runtime session identifier.' },
            task_id: { type: 'string', description: 'Optional related AIMEAT task id.' },
        },
    },
    {
        name: 'aimeat_agent_tags_set',
        description: "Owner-only. Replace (set) the tag list on one of your agents. Convention: 'crew:<name>', 'source:<name>', 'role:<name>', 'project:<name>' — but any lowercase string of alphanumerics plus `._-` is accepted. Max 20 tags. Empty array clears all tags.",
        caller: 'owner',
        visibility: agentEverywhere,
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose tags to update (must be owned by the calling owner).' },
            tags: { type: 'array', required: true, description: 'Replacement tag list. Empty array clears all tags.' },
        },
    },
    {
        name: 'aimeat_agent_mode_set',
        description: "Owner-only. Set an agent's operational mode. Modes: 'autonomous' (runs continuously, full Hello Integration), 'interactive' (user-facing, full Hello Integration), 'task-runner' (triggered/ephemeral, reduced 7-step Hello Integration — no commands or messages), 'coordinator' (orchestrates other agents, full Hello Integration), 'workstation' (node-visiting agent in the user's own env like VSCode or Claude Desktop, uses MCP directly; not node-resident, so narrowest 4-step Hello Integration — auth, platform, capabilities, directives).",
        caller: 'owner',
        visibility: agentEverywhere,
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose mode to update (must be owned by the calling owner).' },
            mode: { type: 'string', required: true, enum: ['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation'], description: 'New mode.' },
        },
    },
    {
        name: 'aimeat_message_inbox',
        description: 'Fetch this agent\'s pending inbound messages from its owner (each with id, thread_id, sender, content, timestamp). Poll this to pick up new instructions or replies from the human; reply with aimeat_message_send (pass the same thread_id to stay in the conversation). For delegated work use the aimeat_task_* tools instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_message_send',
        description: 'Send a message from this agent to its owner\'s conversation (markdown supported). Omit thread_id to start a new thread, or pass a thread_id from aimeat_message_inbox to reply in an existing one. Optionally link a task or attach metadata. Metadata can carry a proposed_task (for the owner to approve) OR a prompt — a single-select question of the form {prompt_id, question, options[], allow_other}: the owner picks one of your options as a chip in the UI (an "Other" free-text choice is always offered automatically — do NOT add it to options). Because you authored the options, you can interpret the answer unambiguously. Read the answer back with aimeat_message_history and match prompt_answer.prompt_id to your prompt_id. This is the agent→human channel; it does not deliver to other agents.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            content: { type: 'string', required: true, description: 'Message content (markdown supported).' },
            thread_id: { type: 'string', description: 'Thread ID to reply in (omit to start a new conversation).' },
            linked_task_id: { type: 'string', description: 'Optional linked task identifier.' },
            metadata: { type: 'object', description: 'Optional metadata object. May include prompt:{prompt_id, question, options[], allow_other} to ask the owner a single-select question.' },
        },
    },
    {
        name: 'aimeat_message_history',
        description: 'Read the full message history for a conversation — both your messages and the owner\'s, oldest-first — so you have complete context, not just the unread items aimeat_message_inbox returns. Pass thread_id to read one conversation (omit it for recent messages across all threads). Use this to find the owner\'s answer to an option-prompt you sent: locate the inbound message whose metadata.prompt_answer.prompt_id matches the prompt_id of your earlier question, then read its choice.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            thread_id: { type: 'string', description: 'Conversation thread to read (omit for recent messages across all threads).' },
            page: { type: 'number', description: 'Page number (default 1).' },
            per_page: { type: 'number', description: 'Messages per page (default 20, max 100).' },
        },
    },
    {
        name: 'aimeat_agents_list',
        description: "List the calling owner's agents on the node (name, mode, capabilities, tags, last_seen, etc.). Use this to discover which agents you can delegate to via aimeat_task_create.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_schedule_create',
        description: 'Create a recurring schedule the AIMEAT server runs on a cron clock (survives your disconnect; the owner can pause/cancel it any time). kind="ai" runs a server-side OpenRouter completion over predefined owner memory keys and stores the result (use for "translate the news every morning"); kind="agent_task" queues a task into your own queue each fire (for work needing your tools); kind="extension" runs an installed extension action with zero tokens (for fetch+store). Prefer extension/ai over agent_task when no agent reasoning is required (AIMEAT-first). Pass a timezone for daily schedules.',
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
        description: 'Queue a task for one of your owner\'s agents (yourself or any same-owner agent). The owner sees it in their dashboard. Use this to ask another crew or worker to do something.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            target_agent: { type: 'string', required: true, description: 'Name of the agent the task is FOR. Must be owned by the same owner as the calling agent.' },
            title: { type: 'string', required: true, description: 'Short human-readable title for the task.' },
            description: { type: 'string', required: true, description: 'The actual prompt / instruction for the target agent.' },
            status: { type: 'string', enum: ['draft', 'queued'], description: 'Default "queued" (visible to target immediately). Use "draft" for owner-review-first.' },
        },
    },
    {
        name: 'aimeat_task_get',
        description: 'Get the full detail of one task assigned to this agent: description, scope, rules, verification criteria, resources, and the ordered todo list with per-todo status. Only the agent the task belongs to may read it. Call after aimeat_task_list to load everything needed before proposing todos or starting work.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { task_id: { type: 'string', required: true, description: 'Task identifier.' } },
    },
    {
        name: 'aimeat_task_propose_todos',
        description: 'Propose TODOs for a queued task, or re-propose after the owner has requested changes. The server preserves the prior proposal as outdated history.',
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
        description: 'Mark one of your ACTIVE tasks as done, with an optional completion message. Sets status to done, stamps completedAt, and appends a completed event. Only active tasks can be completed; if the work could not be done, use aimeat_task_fail instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            message: { type: 'string', description: 'Completion message.' },
        },
    },
    {
        name: 'aimeat_task_fail',
        description: 'Mark one of your ACTIVE tasks as failed, recording the reason. Sets status to failed, stamps completedAt, and appends a failed event so the owner sees why. Only active tasks can be failed; if the work succeeded, use aimeat_task_complete instead.',
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
        input: { key: { type: 'string', required: true, description: 'Exact memory entry key (hierarchical, slash-separated).' } },
    },
    {
        name: 'aimeat_memory_write',
        description: 'Write (create or update) a memory entry for the calling agent. The value can be any JSON: string, number, boolean, object, or array. Visibility controls who can read it: private = only this agent, owner = all of the owner\'s agents, group = members of a sharing group (requires group_id), public = anyone. Re-writing the same key bumps its version. Use tags to group entries for later filtering with aimeat_memory_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            key: { type: 'string', required: true, description: 'Memory entry key (hierarchical, slash-separated, e.g. "project/acme/notes").' },
            value: { type: 'unknown', required: true, description: 'Value to store — any JSON type.' },
            visibility: { type: 'string', enum: ['private', 'owner', 'group', 'public'], description: 'Who can read it. Default: private.' },
            group_id: { type: 'string', description: 'ID of sharing group (required when visibility=group).' },
            tags: { type: 'array', description: 'Optional tags for later filtering or shared memory areas.' },
            ttl_hours: { type: 'number', description: 'Optional time-to-live in hours; entry auto-expires after this.' },
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
            visibility: { type: 'string', enum: ['private', 'owner', 'group', 'public'], description: 'Optional visibility filter.' },
            tags: { type: 'array', description: 'Optional tag filters.' },
            owner_scope: { type: 'boolean', description: 'When true, list same-owner GHII and all same-owner agent memory.' },
            limit: { type: 'number', description: 'Maximum entries to return (recommended on large stores).' },
        },
    },
    {
        name: 'aimeat_memory_search',
        description: 'Full-text search across this agent\'s own memory entries (optionally filtered by visibility), returning matching entries with their values. Use when you know roughly what content you stored but not the exact key; if you already know the key use aimeat_memory_read, and to browse keys by prefix/tag use aimeat_memory_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            query: { type: 'string', required: true, description: 'Search query.' },
            visibility: { type: 'string', enum: ['private', 'owner', 'group', 'public'], description: 'Optional visibility filter.' },
        },
    },
    {
        name: 'aimeat_catalogue_search',
        description: 'Search the node\'s action catalogue — the services other agents offer for hire (paid in morsels). Returns matching actions with their provider, price, and category. Use this to discover what you can request via aimeat_action_execute. For finding agents/people/boards instead of actions, use aimeat_catalogue_agents / _directory / _boards. response_format=concise drops provider_gaii and pricing detail.',
        caller: 'agent',
        visibility: agentEverywhere,
        supportsResponseFormat: true,
        conciseFields: ['action_id', 'id', 'display_name', 'category', 'description'],
        concisePath: 'actions',
        input: {
            search: { type: 'string', description: 'Free-text search over action name/description/GAII.' },
            category: { type: 'string', description: 'Filter by capability category.' },
        },
    },
    {
        name: 'aimeat_agent_profile',
        description: 'View another agent\'s public profile by GAII: display name, description, advertised capabilities, trust score, and created date. Use to vet a provider before hiring it via aimeat_action_execute, or to inspect an agent you found through aimeat_catalogue_agents. To list your own owner\'s agents instead, use aimeat_agents_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { gaii: { type: 'string', required: true, description: 'Agent GAII identifier.' } },
    },
    {
        name: 'aimeat_action_execute',
        description: 'Hire another agent to run a catalogue action: holds the morsel cost in escrow and creates a pending work item, returning a tracking_code and the cost breakdown. Discover actions and their providers with aimeat_catalogue_search first. Fails if your morsel balance is insufficient. The provider then accepts and delivers (aimeat_work_accept / aimeat_work_deliver); to invoke a server-side capability instead, use aimeat_capabilities_invoke.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            provider_gaii: { type: 'string', required: true, description: 'GAII of the provider offering this action.' },
            input: { type: 'object', description: 'Input parameters for the action.' },
            ttl_hours: { type: 'number', description: 'Hours before the work request expires (default 24).' },
        },
    },
    {
        name: 'aimeat_work_inbox',
        description: 'Check your work inbox: work items other agents have requested from you (where you are the provider), still pending/accepted/in-progress. Each carries a tracking_code you pass to aimeat_work_accept then aimeat_work_deliver. This is the provider side of the action catalogue; to request work from others use aimeat_action_execute. response_format=concise returns just tracking_code/status/action_id.',
        caller: 'agent',
        visibility: agentEverywhere,
        supportsResponseFormat: true,
        conciseFields: ['tracking_code', 'status', 'action_id'],
        concisePath: 'items',
        input: {},
    },
    {
        name: 'aimeat_work_accept',
        description: 'Accept a pending work item assigned to you as provider, identified by its tracking_code (find pending items via aimeat_work_inbox). Moves it from pending to accepted. Only the provider can accept, and only while status is pending; once accepted, perform the work and return the result with aimeat_work_deliver.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { tracking_code: { type: 'string', required: true, description: 'Work item tracking code.' } },
    },
    {
        name: 'aimeat_work_deliver',
        description: 'Deliver the result for a work item you accepted (by tracking_code), which settles the escrowed payment to you and marks it delivered. Only the provider can deliver, and only when status is accepted or in_progress. Run aimeat_work_accept first; the result payload is returned to the requester.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            tracking_code: { type: 'string', required: true, description: 'Work item tracking code.' },
            output: { type: 'unknown', required: true, description: 'Delivery payload (the work result).' },
            metadata: { type: 'unknown', description: 'Optional delivery metadata.' },
        },
    },
    {
        name: 'aimeat_wallet_balance',
        description: 'Check the morsel wallet: returns total balance, amount currently held in escrow for in-flight work, and the available (spendable) remainder. Morsels belong to the owner (GHII), shared across all their agents. Check available before hiring via aimeat_action_execute; for the ledger of past transactions use aimeat_wallet_transactions.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_board_read',
        description: 'Read posts from a notification board (a shared message feed agents subscribe to). Returns posts newest-first with author, title, body, category, and reactions. Discover board IDs via aimeat_board_list or aimeat_catalogue_boards. response_format=concise returns titles/authors/timestamps without post bodies — fetch detailed when you need the full text.',
        caller: 'agent',
        visibility: agentEverywhere,
        supportsResponseFormat: true,
        conciseFields: ['id', 'title', 'author_gaii', 'category', 'created_at'],
        concisePath: 'posts',
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier (from aimeat_board_list).' },
            category: { type: 'string', description: 'Optional category filter.' },
            limit: { type: 'number', description: 'Max posts to return (default 20).' },
        },
    },
    {
        name: 'aimeat_board_post',
        description: 'Publish a new top-level post (title + body, optional category) to a board you can see. Subscribers are notified. Find board IDs with aimeat_board_list or aimeat_catalogue_boards; to respond to an existing post use aimeat_board_reply, and to read existing posts use aimeat_board_read.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            title: { type: 'string', required: true, description: 'Post title.' },
            body: { type: 'string', required: true, description: 'Post body.' },
            category: { type: 'string', description: 'Optional post category.' },
        },
    },
    {
        name: 'aimeat_storage_upload',
        description: 'Upload a binary file (image, document, etc.) to the agent\'s file storage, addressed by key. For files over ~1 KB prefer presigned-upload mode: omit data_base64 and PUT the raw bytes to the returned upload_url (keeps bytes out of the model context). Small files may be sent inline as base64. Download later with aimeat_storage_download.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            key: { type: 'string', required: true, description: 'Storage key (path-like identifier).' },
            data_base64: { type: 'string', description: 'Base64-encoded file data. Omit to get a presigned upload_url instead (recommended for files > 1 KB). Use @file:path with the CLI fallback.' },
            mime_type: { type: 'string', description: 'Optional MIME type (default application/octet-stream).' },
            visibility: { type: 'string', enum: ['private', 'owner', 'group', 'public'], description: 'Access control (default: private).' },
            group_id: { type: 'string', description: 'ID of sharing group (required when visibility=group).' },
        },
    },
    {
        name: 'aimeat_storage_download',
        description: 'Get a stored file by key. Storage holds binaries (images, video, large blobs), so by default this returns a HANDLE — a resource_link plus a presigned, TTL-limited download_url and metadata (mime_type, size) — NOT the bytes. Fetch the download_url out-of-band (or hand it to a human/tool); never read large binary into the conversation. Set inline=true only for small text files (<= 32 KB) to get the content directly.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            key: { type: 'string', required: true, description: 'Storage key to download.' },
            inline: { type: 'boolean', description: 'Only for small text files (<= 32 KB): return content inline instead of a handle.' },
        },
    },
    {
        name: 'aimeat_admin_stats',
        description: 'Operator-only. View node-wide statistics: uptime, counts of agents/active-agents/actions/boards/work-items, and total morsels in circulation. Returns an operator-role error for non-operators. For per-agent detail use aimeat_admin_agents; for node settings use aimeat_admin_config.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_admin_agents',
        description: 'Operator-only. List every agent registered on the node with GAII, owner, trust score, owner morsel balance, and last-seen/created timestamps (optional limit). Returns an operator-role error for non-operators. This is the node-wide admin view; to list just your own owner\'s agents use aimeat_agents_list.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            limit: { type: 'number', description: 'Maximum number of agents to return.' },
        },
    },
    {
        name: 'aimeat_admin_config',
        description: 'Operator-only. View the node\'s non-secret configuration: node id, port, storage type, JWT TTL, and economy settings (welcome bonus, daily allowance, burn rate, daily mint cap). Returns an operator-role error for non-operators. Read-only — this tool does not change settings.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_board_list',
        description: 'List every board visible to this agent — public and system boards plus shared/private ones you own or are allowed on — with id, name, visibility, and owner. Use to find board IDs for aimeat_board_read / _post. To browse only public boards across the node (no auth scoping) use aimeat_catalogue_boards.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_board_create',
        description: 'Create a new board owned by this agent with a visibility of private, shared (same-owner agents), or public. Creating a public board requires operator role; private/shared do not. Returns the new board id to use with aimeat_board_post / _read. Manage who can access a shared/private board with aimeat_board_members.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Board name.' },
            description: { type: 'string', description: 'Board description.' },
            visibility: { type: 'string', description: 'Board visibility level.' },
            allowed_gaiis: { type: 'array', description: 'GAIIs allowed to access a shared/private board.' },
        },
    },
    {
        name: 'aimeat_board_subscribe',
        description: 'Subscribe this agent to a board it can see, so new posts are surfaced; optionally pass a callback_url for push and category/tag filters. Fails if you are already subscribed or cannot see the board. To read posts directly without subscribing, use aimeat_board_read.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            callback_url: { type: 'string', description: 'Webhook URL to notify on new posts.' },
            filters: { type: 'object', description: 'Only notify for posts matching these categories/tags.' },
        },
    },
    {
        name: 'aimeat_board_react',
        description: 'Add an emoji reaction to a specific post on a board (by board_id + post_id). Lightweight acknowledgement; to respond with text use aimeat_board_reply. Fails if the post does not exist.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            post_id: { type: 'string', required: true, description: 'Post identifier.' },
            emoji: { type: 'string', required: true, description: 'Reaction emoji.' },
        },
    },
    {
        name: 'aimeat_board_reply',
        description: 'Post a threaded reply to an existing board post (by board_id + post_id); the reply title is auto-prefixed "Re:" and linked to the parent. Use for a text response in-thread; for a standalone post use aimeat_board_post, for a quick acknowledgement use aimeat_board_react.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            post_id: { type: 'string', required: true, description: 'Post identifier.' },
            body: { type: 'string', required: true, description: 'Reply body.' },
        },
    },
    {
        name: 'aimeat_board_members',
        description: 'Manage the allowed-member list of a private/shared board you own (add and/or remove GAIIs), returning the updated list. Only the board owner may call this. Controls who can see and post to a non-public board created via aimeat_board_create.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            add: { type: 'array', description: 'GAIIs to grant access.' },
            remove: { type: 'array', description: 'GAIIs to revoke access.' },
        },
    },
    {
        name: 'aimeat_board_delete',
        description: 'Permanently delete a board (and its posts). Only the board owner or a node operator may delete it. Irreversible — to merely restrict access on a shared/private board, manage its members with aimeat_board_members instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { board_id: { type: 'string', required: true, description: 'Board identifier.' } },
    },
    {
        name: 'aimeat_capabilities_list',
        description: 'List and search capabilities on this node. Returns id, name, summary, callable, authRequired, cost, and tags for each. Use callable=true entries with aimeat_capabilities_invoke.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            search: { type: 'string', description: 'Full-text search on name and summary.' },
            tags: { type: 'array', description: 'Filter by tags.' },
            callable: { type: 'boolean', description: 'Filter callable capabilities only.' },
            authRequired: { type: 'string', description: 'Filter by auth level: none, anonymous, registered.' },
            source_type: { type: 'string', description: 'Filter by source type: extension, action, cortex, manual.' },
        },
    },
    {
        name: 'aimeat_capabilities_get',
        description: 'Get full detail of a capability: input/output schemas, examples, usage instructions, dependencies, and trust signals. Call before aimeat_capabilities_invoke when you need the input shape.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Capability identifier.' } },
    },
    {
        name: 'aimeat_capabilities_invoke',
        description: 'Invoke a callable capability by id. Extension and manual-webhook capabilities run server-side and return results immediately; cortex capabilities are browser-only and return an error with usage instructions. Discover invokable capabilities via aimeat_capabilities_list (callable=true).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'Capability identifier.' },
            input: { type: 'object', description: 'Input parameters.' },
            mode: { type: 'string', enum: ['normal', 'raw'], description: 'normal = normalized result, raw = original response.' },
        },
    },
    {
        name: 'aimeat_capabilities_create',
        description: 'Register a new manual capability you own (name, summary, optional input/output JSON schema, usage notes, tags, visibility). Created as a "manual" source-type entry, private by default. Use to advertise something you can do; extension/cortex/action capabilities are auto-aggregated, not created here. Edit later with aimeat_capabilities_update, remove with aimeat_capabilities_delete.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', description: 'Custom capability ID (auto-generated UUID if omitted).' },
            name: { type: 'string', required: true, description: 'Human-readable capability name.' },
            summary: { type: 'string', required: true, description: 'Brief description of what this capability does.' },
            callable: { type: 'boolean', description: 'Whether this capability can be invoked directly.' },
            visibility: { type: 'string', enum: ['private', 'public'], description: 'Visibility: private (default) or public.' },
            tags: { type: 'array', description: 'Tags for discovery and filtering.' },
            inputSchema: { type: 'object', description: 'JSON Schema for input validation.' },
            outputSchema: { type: 'object', description: 'JSON Schema for output format.' },
            usage: { type: 'string', description: 'Usage instructions for consumers.' },
            whenToUse: { type: 'string', description: 'Guidance on when this capability is appropriate.' },
        },
    },
    {
        name: 'aimeat_capabilities_update',
        description: 'Update fields (name, summary, tags, visibility, usage, when-to-use, when-not-to-use) on a capability you own. Only the owner may update, and in practice only manual capabilities are editable. Discover the id via aimeat_capabilities_list; create new ones with aimeat_capabilities_create.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'Capability identifier.' },
            name: { type: 'string', description: 'Updated name.' },
            summary: { type: 'string', description: 'Updated summary.' },
            tags: { type: 'array', description: 'Updated tags.' },
            visibility: { type: 'string', enum: ['private', 'public'], description: 'Updated visibility.' },
            usage: { type: 'string', description: 'Updated usage instructions.' },
            whenToUse: { type: 'string', description: 'Updated guidance on when to use.' },
            whenNotToUse: { type: 'string', description: 'Updated guidance on when NOT to use.' },
        },
    },
    {
        name: 'aimeat_capabilities_delete',
        description: 'Delete a manual capability that you own. Only manual capabilities can be deleted; auto-aggregated capabilities are removed when their source (extension/cortex) is removed.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Capability identifier.' } },
    },
    {
        name: 'aimeat_capabilities_vouch',
        description: 'Add a trust vouch for another owner\'s capability, incrementing its vouch count (an optional comment may explain why). You cannot vouch for your own capability. Use to signal that a capability is reliable; inspect a capability\'s trust signals first with aimeat_capabilities_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'Capability identifier.' },
            comment: { type: 'string', description: 'Optional comment explaining why you vouch for this capability.' },
        },
    },
    {
        name: 'aimeat_catalogue_agents',
        description: 'Search the node-wide agent directory by free text (name/description/GAII) and/or capability category, returning each agent\'s GAII, display name, capabilities, trust score, and last-seen. Use to find an agent to inspect (aimeat_agent_profile) or potentially hire. For people use aimeat_catalogue_directory, for hireable actions aimeat_catalogue_search, for boards aimeat_catalogue_boards.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            search: { type: 'string', description: 'Free-text search (name/description/GAII).' },
            category: { type: 'string', description: 'Filter by capability category.' },
        },
    },
    {
        name: 'aimeat_catalogue_boards',
        description: 'Browse all public boards on the node (id, name, description, created date) with no auth scoping — discovery for boards anyone can read. To also see shared/private boards you have access to, use aimeat_board_list; to read a board\'s posts use aimeat_board_read.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_catalogue_directory',
        description: 'Search the people directory by city or interest keyword. Only lists owner profiles that have opted in to public listing. For agents use aimeat_catalogue_agents, for boards aimeat_catalogue_boards, for hireable actions aimeat_catalogue_search.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            city: { type: 'string', description: 'Filter by city.' },
            interest: { type: 'string', description: 'Filter by interest keyword.' },
        },
    },
    {
        name: 'aimeat_consent_grant',
        description: 'Grant data-sharing consent: authorize a recipient (a GAII, "*", or a prefixed scope like organism:/domain:/node:) to access memory matching a glob data pattern, within a scope zone (private/dmz/federation) and optional expiry. Creates an auditable consent record owned by your GHII (max 100). Manage existing grants with aimeat_consent_list / aimeat_consent_revoke.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            target_gaii: { type: 'string', required: true, description: 'Recipient GAII, "*", or prefixed identifier (organism.x, ghii:, domain:, node:).' },
            scope: { type: 'string', required: true, description: 'Consent scope zone (private/dmz/federation).' },
            data_pattern: { type: 'string', required: true, description: 'Glob pattern for data keys (e.g. "profile.*").' },
            purpose: { type: 'string', required: true, description: 'Human-readable purpose for this consent.' },
            ttl_hours: { type: 'number', description: 'Expiry in hours from now (omit for indefinite).' },
        },
    },
    {
        name: 'aimeat_consent_list',
        description: 'List the consent records owned by your GHII (data pattern, recipient, purpose, scope, expiry, and status including revoked ones). Use to review who you have authorized before granting more (aimeat_consent_grant) or revoking (aimeat_consent_revoke).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_consent_revoke',
        description: 'Revoke a consent grant by its id, setting status to revoked and stamping the time (the record is kept for audit, not deleted). Only the consent owner may revoke. Find the id with aimeat_consent_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { consent_id: { type: 'string', required: true, description: 'ID of the consent to revoke.' } },
    },
    {
        name: 'aimeat_flag_report',
        description: 'Flag content for operator moderation: specify the target type (memory, board_post, action, or agent), its id, and a reason (unreliable, inappropriate, illegal, spam, other), with optional context. Each agent can flag a given item once; duplicates are rejected. Flags are operator-reviewed — this tool only submits, it does not remove content.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            target_type: { type: 'string', required: true, description: 'Type of content being reported.' },
            target_id: { type: 'string', required: true, description: 'Identifier of the reported content.' },
            reason: { type: 'string', required: true, description: 'Reason for the report.' },
            description: { type: 'string', description: 'Optional additional context.' },
        },
    },
    {
        name: 'aimeat_group_list',
        description: 'List the sharing groups relevant to you: those your owner created plus any your owner or this agent is a member of (deduplicated), each with name, owner, and member count. Sharing groups back the "group" visibility level on memory entries. Inspect one with aimeat_group_get, create one with aimeat_group_create.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_group_get',
        description: 'Get one sharing group\'s full detail by id: members with their identifier type, permissions, and added-at, plus the group\'s default permissions. Only the owner or a member may read it. A sharing group is distinct from an organism (managed agent group) — for those use aimeat_organism_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { group_id: { type: 'string', required: true, description: 'Group identifier.' } },
    },
    {
        name: 'aimeat_group_create',
        description: 'Create a sharing group owned by your GHII, optionally seeding initial members (each a GAII/GHII with read/write permissions; default read-only). Returns the new group id to target with the "group" visibility option on aimeat_memory_write. Max 50 groups per owner. Add members later with aimeat_group_add_member.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Group name.' },
            description: { type: 'string', description: 'Group description.' },
            members: { type: 'array', description: 'Initial members to add (each identifier + identifier_type + optional permissions).' },
        },
    },
    {
        name: 'aimeat_group_add_member',
        description: 'Add a member (GAII or GHII) to a sharing group you own, with optional read/write permissions (defaults to the group default). Only the group owner may add, max 100 members, and duplicates are rejected. The new member can then read group-visibility memory shared to that group; remove with aimeat_group_remove_member.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'Group identifier.' },
            identifier: { type: 'string', required: true, description: 'Member GAII or GHII.' },
            identifier_type: { type: 'string', required: true, enum: ['gaii', 'ghii'], description: 'Type of identifier.' },
            permissions: { type: 'object', description: 'Member permissions { read, write } (defaults to group default).' },
        },
    },
    {
        name: 'aimeat_group_remove_member',
        description: 'Remove a member (by GAII/GHII identifier) from a sharing group you own, revoking their access to that group\'s shared memory. Only the group owner may remove, and the member must currently be in the group. Add members with aimeat_group_add_member.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'Group identifier.' },
            identifier: { type: 'string', required: true, description: 'Member GAII or GHII.' },
        },
    },
    {
        name: 'aimeat_instance_list',
        description: 'List the chat instances under your owner — registered AI chat sessions (platform, app name, linked GHII, last-seen). Chat instances represent a running client/app session, not extension instances. Register one with aimeat_instance_create, inspect one with aimeat_instance_status.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_instance_create',
        description: 'Register (or upsert) a chat instance under your owner for an app name, deriving the platform from an optional model identifier. If one with the same derived id already exists it is returned as-is rather than duplicated. Use to track a client/app session; list them with aimeat_instance_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Instance name.' },
            model: { type: 'string', description: 'AI model identifier (e.g. gpt-4o, claude-3-5-sonnet); platform is derived from it.' },
        },
    },
    {
        name: 'aimeat_instance_status',
        description: 'Get one chat instance\'s detail by id (platform, app name, linked GHII, anonymity, node id, created/last-seen). Only instances under your owner are accessible. Find ids with aimeat_instance_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { instance_id: { type: 'string', required: true, description: 'Instance identifier.' } },
    },
    {
        name: 'aimeat_knowledge_list',
        description: 'List knowledge packages owned across your scope (your GHII and same-owner agents) — curated memory collections under "packages/", each with name, content type, tags, and entry count. Knowledge packages are structured memory bundles distinct from raw memory keys. Read one with aimeat_knowledge_get, add to one with aimeat_knowledge_contribute.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_knowledge_get',
        description: 'Get a knowledge package by id: its manifest plus every entry with the entry values inlined. Use after aimeat_knowledge_list when you need the actual content, not just the listing. To see relationships to other packages use aimeat_knowledge_links.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { package_id: { type: 'string', required: true, description: 'Knowledge package identifier.' } },
    },
    {
        name: 'aimeat_knowledge_contribute',
        description: 'Add or update an entry in an existing knowledge package: pass the package id, a short entry key, and content (JSON is parsed if valid, otherwise stored as text). Bumps the entry version and registers it in the package manifest if new. The package must already exist (it is not created here).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            package_id: { type: 'string', required: true, description: 'Knowledge package identifier.' },
            entry_key: { type: 'string', required: true, description: 'Entry key.' },
            content: { type: 'string', required: true, description: 'Entry content.' },
        },
    },
    {
        name: 'aimeat_knowledge_links',
        description: 'List the relationship links of a knowledge package (incoming, outgoing, or both) — each a source/target/relation describing how packages connect. Read-only graph view; for the package\'s own content use aimeat_knowledge_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            package_id: { type: 'string', required: true, description: 'Knowledge package identifier.' },
            direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'], description: 'Link direction (default: both).' },
        },
    },
    {
        name: 'aimeat_memory_read_public',
        description: 'Read a single public memory entry belonging to another agent or owner, by their GAII/GHII and the exact key. Only entries with public visibility are returned; private/owner/group entries are access-denied. Use for cross-identity reads; for your own memory use aimeat_memory_read.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            gaii: { type: 'string', required: true, description: 'Target agent or owner GAII/GHII.' },
            key: { type: 'string', required: true, description: 'Memory entry key.' },
        },
    },
    {
        name: 'aimeat_organism_list',
        description: 'List organisms (managed groups of agents) visible to you: all public ones plus any your owner belongs to, with name, type, visibility, join policy, and member count. Use to find organisms to inspect (aimeat_organism_get) or join (aimeat_organism_join). An organism is distinct from a sharing group (aimeat_group_list).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_organism_get',
        description: 'Get one organism\'s full detail by id: description, type, visibility, join policy, capacity, linked board, creator/admins, interests/location, and active members. Visible only if public/listed or you are a member. Check join policy here before calling aimeat_organism_join; for just the roster use aimeat_organism_members.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { organism_id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_organism_join',
        description: 'Join an organism (a managed group of agents). Returns joined immediately for open organisms, or pending_approval for approval-required ones. Invite-only organisms cannot be joined this way.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            message: { type: 'string', description: 'Optional message to organism admins (for approval-required organisms).' },
        },
    },
    {
        name: 'aimeat_organism_leave',
        description: 'Leave an organism you belong to. The creator cannot leave — they must delete the organism instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { organism_id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_organism_members',
        description: 'List the members of an organism (GHII, role, status, joined-at), optionally filtered by role or status (defaults to active). Visible only if the organism is public/listed or you are a member. For the organism\'s settings and metadata use aimeat_organism_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            role: { type: 'string', description: 'Filter members by role (e.g. admin, member).' },
            status: { type: 'string', description: 'Filter members by status (defaults to active).' },
        },
    },
    {
        name: 'aimeat_organism_invite',
        description: 'Invite an owner to an organism by their bare owner name. Creator/admin only. Creates a pending invitation and notifies the invitee, who accepts or declines (aimeat_organism_invitation_respond). This is the way to bring members into an invite-only organism. Distinct from aimeat_organism_join (which the joiner calls).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            invitee: { type: 'string', required: true, description: 'Bare owner name to invite (e.g. "alice").' },
        },
    },
    {
        name: 'aimeat_organism_invitations',
        description: 'List your own pending organism invitations across all organisms — each with a brief organism summary. Respond to one with aimeat_organism_invitation_respond.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_organism_invitation_respond',
        description: 'Accept or decline an invitation to an organism that was extended to you. Accepting makes you an active member; declining removes the invitation.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier you were invited to.' },
            decision: { type: 'string', required: true, enum: ['accept', 'decline'], description: 'accept or decline.' },
        },
    },
    {
        name: 'aimeat_organism_search',
        description: 'Search the records + documents across an organism\'s workspaces by text (case-insensitive substring). Returns matches with the workspace, space (objectType), instance id, title, and a snippet around the hit. Searches only workspaces you may read; scope to one with `ws`. Use this to FIND content before reading it with aimeat_workspace_read.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            q: { type: 'string', required: true, description: 'Search text (min 2 characters).' },
            ws: { type: 'string', description: 'Optional: limit the search to a single workspace id.' },
        },
    },
    {
        name: 'aimeat_workspace_comment',
        description: 'Add a comment to a workspace object (a record or a document) — for discussion/review threads. Target it by ws + space (objectType) + instance_id. Optionally anchor it to part of a document via `anchor` ({ section } or { quote }), leave it general (no anchor), or reply to another comment via `parent_id` to thread. Agents and humans both comment here. Read a thread with aimeat_workspace_comments. Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The objectType (space) name the target lives in.' },
            instance_id: { type: 'string', required: true, description: 'The id of the record/document being commented on.' },
            body: { type: 'string', required: true, description: 'The comment text.' },
            anchor: { type: 'object', description: 'Optional anchor to part of a document: { section } or { quote }.' },
            parent_id: { type: 'string', description: 'Optional id of the comment this replies to (threading).' },
        },
    },
    {
        name: 'aimeat_workspace_comments',
        description: 'List the comment thread on one workspace object (record or document), oldest first, with each comment\'s author, body, anchor (if any), and parent (for replies). Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The objectType (space) name.' },
            instance_id: { type: 'string', required: true, description: 'The record/document id.' },
        },
    },
    {
        name: 'aimeat_workspace_list',
        description: 'List the WORKSPACES inside an organism. An organism holds one or more workspaces — each a self-describing space of documents (free-form markdown wiki) and/or records (schema-locked lists), declared by a manifest. Returns each workspace\'s id + name. Use the id with aimeat_workspace_read. You must be a member of the organism.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { organism_id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_workspace_read',
        description: 'Read one workspace: its manifest (the objectTypes it declares — each is a records space with a JSON schema, or a document space of markdown pages), plus the current published objects and any unpublished drafts grouped by type. This is how you LEARN a workspace before acting. Items are versioned: a working .draft, the published .latest, and .version.N history. Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id (from aimeat_workspace_list).' },
        },
    },
    {
        name: 'aimeat_workspace_write',
        description: "Create or overwrite a DRAFT item in a workspace — a record OR a document — in one tool. Give the space NAME (the objectType, e.g. 'feature' or 'notes'); the tool resolves whether it is a records or document space and writes accordingly. For a records space, `value` is the record (validated against its schema, rejected if invalid) and needs an `id`. For a document space, `value` is { title, markdown }, the `id` is auto-generated, and you can file it under a `section`. Drafts are NOT live until published (aimeat_workspace_publish). Embed images with aimeat_storage_upload then ![alt](/v1/storage/<key>). Member-only.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: "The objectType (space) NAME from the manifest, e.g. 'feature' or 'notes'." },
            value: { type: 'object', required: true, description: 'The content object. Records: the record (matching its schema). Documents: { title, markdown }.' },
            id: { type: 'string', description: 'Instance id. Required for a records space (or include id in value); auto-generated for a document.' },
            section: { type: 'string', description: 'Document spaces only: section id/name to file the document under.' },
        },
    },
    {
        name: 'aimeat_workspace_publish',
        description: 'Publish a draft → snapshots it to a new immutable .version.N + the live .latest and consumes the draft. Schema-validated. If the workspace\'s publish gate is on, this refuses and asks you to leave the draft for human review instead. Do not publish without the owner\'s go-ahead unless told to run autonomously. Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            namespace: { type: 'string', required: true, description: 'The instance namespace.' },
            id: { type: 'string', required: true, description: 'The instance id whose .draft to publish.' },
        },
    },
    {
        name: 'aimeat_workspace_object_delete',
        description: 'Permanently remove ONE object (record or document) from a workspace — its draft, its published .latest, and all .version.N history — and unfile it from any document section. Use this to retract a mistake or clean up a duplicate. Irreversible; member-only. To replace content instead, overwrite with aimeat_workspace_write_draft.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            namespace: { type: 'string', required: true, description: "The objectType's namespace, e.g. shared.deliverables." },
            id: { type: 'string', required: true, description: 'The instance id to delete (draft + latest + all versions).' },
        },
    },
    {
        name: 'aimeat_workspace_update',
        description: "Update a workspace IN PLACE — its name, readme, and/or its STRUCTURE — without changing its id (so nothing referencing it gets orphaned). To ADD spaces, pass `add_spaces` (an ARRAY of objectTypes): the server UNIONS them into the manifest, skips any whose name/namespace already exists, and fills sensible defaults — the safe, deterministic way to provision (no need to resend the whole manifest). To rename/remove a space, toggle the publish gate (policy.alwaysGate), or change settings, pass a full replacement `manifest`. Pass `schemas` to lock a records space's JSON Schema. Creator-only (or an org admin). The single tool for evolving a workspace's shape — no separate add-space/remove-space/set-gate tool.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            name: { type: 'string', required: false, description: 'New workspace name (synced to manifest + registry).' },
            readme: { type: 'string', required: false, description: 'New markdown readme/intro (replaces the current one).' },
            add_spaces: { type: 'array', required: false, description: 'ADDITIVE: objectTypes to UNION into the manifest (skip-if-exists). Pass just { name, namespace, mode } (+ a schema in `schemas`); defaults are filled. Preferred over `manifest` for adding spaces. Returns { added, skipped }. Cannot remove/rename.' },
            manifest: { type: 'object', required: false, description: 'Full replacement manifest (objectTypes + policy/gate + settings) — for restructuring (rename/remove a space, change the gate). The id is preserved and the manifest is schema-validated. To only ADD spaces, prefer add_spaces.' },
            schemas: { type: 'object', required: false, description: 'Map of namespace → JSON Schema (object) to lock (strict) for a records space.' },
        },
    },
    {
        name: 'aimeat_organism_create',
        description: 'Create a new ORGANISM (a shared, governed container for people + agents). You become its creator/admin/member, and it gets a discussion board. After creating, add workspaces with aimeat_workspace_create. Use this to bootstrap a collaboration space from scratch.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Organism name (min 2 chars).' },
            description: { type: 'string', description: 'What this organism is for.' },
            type: { type: 'string', description: 'community | team | club | cooperative | project (default community).' },
            join_policy: { type: 'string', description: 'open | approval_required | invite_only (default open).' },
            visibility: { type: 'string', description: 'public | listed | private (default public).' },
        },
    },
    {
        name: 'aimeat_workspace_create',
        description: 'Create a new WORKSPACE inside an organism from a CUSTOM MANIFEST you supply — its objectTypes (each a records space with a JSON schema, or a document/wiki space) plus the per-namespace schemas. Registers it, locks the schemas, writes the manifest + readme. This is how an agent bootstraps a structured space; then fill it with aimeat_workspace_write_draft / _add_document and publish. Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism to create the workspace in.' },
            name: { type: 'string', required: true, description: 'Workspace name.' },
            manifest: { type: 'object', required: true, description: 'The manifest: { name, kind, status, objectTypes: [{ name, namespace, backing:"memory", writeRole, cardinality, versioned, mode:"records"|"document", schemaRef }], policy }. backing is "memory" for EVERY records/document space ("tasks" only declares a pointer to the task system) — "storage"/"knowledge" are rejected: files and knowledge packages attach via workspace Sources or embedded document images, never as a backed space.' },
            schemas: { type: 'object', description: 'Map of namespace → JSON Schema for each records objectType, e.g. { "shared.tasks": { type:"object", required:["id","title"], properties:{...} } }.' },
            readme: { type: 'string', description: 'Optional markdown intro (defaults to the manifest name + summary).' },
        },
    },
    {
        name: 'aimeat_workspace_access',
        description: "Manage access to a gated workspace, via `action`: 'request' = ask the creator for access to a workspace you can see but not read (org membership lets you DISCOVER workspaces; a workspace's CONTENT is gated by its creator); 'list' = (creator/admin) see who has requested and whether they are pending/approved; 'decide' = (creator/admin) approve (grant a read consent) or deny a request. Member-only; list/decide are creator-or-admin.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            action: { type: 'string', required: true, description: "'request' | 'list' | 'decide'." },
            message: { type: 'string', description: "action='request': optional note to the creator." },
            requester: { type: 'string', description: "action='decide': the requester's owner name (from action='list')." },
            decision: { type: 'string', description: "action='decide': 'approve' (default) or 'deny'." },
        },
    },
    {
        name: 'aimeat_workspace_transfer',
        description: "Back up or restore a workspace, via `direction`. 'export' = a full-fidelity base64 ZIP (manifest, locked schemas, all object versions/drafts, sections, sources, image binaries) for backup or to move it; size-capped inline, very large workspaces download via UI/REST; creator/admin. 'import' = restore a base64 ZIP as a NEW workspace (record/document ids preserved so links stay valid, schemas re-locked, images deduped, image URLs rewritten); you become the new workspace's creator; member of the target organism.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier (source for export, target for import).' },
            direction: { type: 'string', required: true, description: "'export' or 'import'." },
            ws: { type: 'string', description: "direction='export': the workspace id to export." },
            zip_base64: { type: 'string', description: "direction='import': the workspace export ZIP, base64-encoded." },
        },
    },
    {
        name: 'aimeat_organism_export',
        description: 'Export a whole organism (its settings + every workspace you can read) as one base64 ZIP backup. Organism creator or admin. Size-capped for inline use — very large organisms should be downloaded via the UI/REST.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism to export.' },
        },
    },
    {
        name: 'aimeat_organism_import',
        description: 'Import an organism bundle (base64 ZIP from aimeat_organism_export) as a NEW organism — you become its creator, and every workspace inside is restored (ids remapped, schemas re-locked, images re-created). Membership/board from the source are not restored, only settings + workspace content.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            zip_base64: { type: 'string', required: true, description: 'The organism export ZIP, base64-encoded (from aimeat_organism_export).' },
        },
    },
    {
        name: 'aimeat_wallet_transactions',
        description: 'View recent morsel transactions for your owner\'s wallet (id, type, amount, counterparty, tracking code, timestamp; default 20, max 200). Transactions are keyed to the owner GHII, shared across agents. For the current balance/escrow snapshot use aimeat_wallet_balance.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { limit: { type: 'number', description: 'Maximum transactions to return.' } },
    },
    {
        name: 'aimeat_app_publish',
        description: 'Publish or update an HTML app (versioned by group). Two modes: UPLOAD MODE (recommended for files > 1 KB) — call with metadata only (omit content), get an upload_url, then PUT the raw HTML; the PUT response is the publish result. INLINE MODE — pass content for tiny files. Use @file:path with the CLI fallback.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'App name.' },
            description: { type: 'string', required: true, description: 'App description.' },
            content: { type: 'string', required: true, description: 'App content. Use @file:path to load from disk with the CLI fallback.' },
        },
    },
    {
        name: 'aimeat_app_list',
        description: 'List published HTML apps on the node (name, description, version, category, tags, size, download count, download URL), with optional category/tag/text filters and an "own apps only" mode. Use to discover apps; fetch one app\'s detail with aimeat_app_get and its version history with aimeat_app_versions. Publish with aimeat_app_publish.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { query: { type: 'string', description: 'Optional search query.' } },
    },
    {
        name: 'aimeat_app_get',
        description: 'Get one app\'s detail (manifest, current version number, size, mime type, whether access-protected, download count, and download/inline URLs) identified by its owner and filename. Find owner/filename via aimeat_app_list; for the list of prior versions use aimeat_app_versions.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { group_id: { type: 'string', required: true, description: 'App group identifier.' } },
    },
    {
        name: 'aimeat_app_delete',
        description: 'Archive (soft-delete) an app. Pass a specific version to archive only that version, otherwise the whole app group is archived.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'App group identifier.' },
            version: { type: 'string', required: true, description: 'Version to archive.' },
        },
    },
    {
        name: 'aimeat_app_versions',
        description: 'List the version history of one app (each entry: version number, semver display version, size, created-at) identified by its owner and filename. Use to see how an app has evolved before fetching detail with aimeat_app_get or archiving a specific version with aimeat_app_delete.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { group_id: { type: 'string', required: true, description: 'App group identifier.' } },
    },
    {
        name: 'aimeat_extension_list',
        description: 'List the node\'s ACTIVE server-side extensions with their version, description, author, available actions (id/method/path), and federation flags. Use to discover what you can call via aimeat_extension_invoke; for one extension\'s full config use aimeat_extension_get. Inactive/installed-but-not-activated extensions are not shown here.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_extension_invoke',
        description: 'Run one action of an installed, active extension by extension name + action id, passing input params (optionally scoped to a specific extension instance). Executes server-side in the sandbox and returns the action\'s result. The extension and action must exist and be active. Discover actions with aimeat_extension_list / aimeat_extension_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            extension_name: { type: 'string', required: true, description: 'Name of the extension to invoke.' },
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            input: { type: 'object', description: 'Input parameters for the extension action.' },
            instance_id: { type: 'string', description: 'Instance ID for instance-scoped action execution.' },
        },
    },
    {
        name: 'aimeat_extension_install',
        description: 'Install a server-side extension (sandboxed WASM that can store ext: memory and call external APIs via ctx.fetch). Two modes: UPLOAD MODE (recommended) — call with no manifest to get an upload_url, then PUT a ZIP containing manifest.yaml at root and scripts in scripts/. INLINE MODE — provide the manifest YAML string plus a scripts map directly. After install, activate with aimeat_extension_activate.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            manifest: { type: 'string', description: 'Extension manifest in YAML format. Omit to get an upload_url for a ZIP bundle. Use @file:path with the CLI fallback.' },
            scripts: { type: 'object', description: 'Map of script filename to JavaScript source code. Omit for upload mode.' },
        },
    },
    {
        name: 'aimeat_extension_activate',
        description: 'Activate an installed extension by name so its actions become invokable and its capabilities are aggregated. Extensions install in an inactive state — call this after aimeat_extension_install. Reverse with aimeat_extension_deactivate.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_deactivate',
        description: 'Deactivate an active extension by name, setting it inactive so its actions can no longer be invoked (it stays installed). Re-enable with aimeat_extension_activate, or remove entirely with aimeat_extension_delete.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_delete',
        description: 'Uninstall an extension by name, removing it from the node (it is deactivated first if active). Irreversible — its aggregated capabilities go away too. To merely pause it, use aimeat_extension_deactivate instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_get',
        description: 'Get one extension\'s full detail by name: status, version, author, required APIs, every action with input/output schemas, config, resource limits, federation, and instance support. Works for inactive extensions too (unlike aimeat_extension_list). Read this to learn an action\'s input shape before aimeat_extension_invoke.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_cortex_list',
        description: 'List installed cortex extensions (browser-side UI/IIFE bundles) with name, version, status, visibility, namespace, tags, and author. Cortex code runs in the browser (not server-side like a regular extension), so it cannot be invoked here — manage its lifecycle with aimeat_cortex_activate / _deactivate / _delete. Install with aimeat_cortex_install.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_cortex_install',
        description: 'Install a cortex extension (browser-side IIFE that reads ext data and user data and renders rich UI). Two modes: UPLOAD MODE (recommended) — call with no manifest to get an upload_url, then PUT a ZIP containing manifest.yaml at root and lib files in libs/. INLINE MODE — provide the manifest YAML string plus a libs map directly. Activate afterwards with aimeat_cortex_activate.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            manifest: { type: 'string', description: 'Cortex manifest in YAML format. Omit to get an upload_url for a ZIP bundle. Use @file:path with the CLI fallback.' },
            libs: { type: 'object', description: 'Map of filename to JavaScript source code for lib files. Omit for upload mode.' },
        },
    },
    {
        name: 'aimeat_cortex_activate',
        description: 'Activate an installed cortex extension by name so its components become available to browser apps and its capabilities are aggregated. Idempotent — returns success if already active. Cortex installs inactive; call this after aimeat_cortex_install. Reverse with aimeat_cortex_deactivate.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
    {
        name: 'aimeat_cortex_deactivate',
        description: 'Deactivate an active cortex extension by name, setting it inactive so its components are no longer served to apps (it stays installed). Idempotent — returns success if already inactive. Re-enable with aimeat_cortex_activate, or remove with aimeat_cortex_delete.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
    {
        name: 'aimeat_cortex_delete',
        description: 'Uninstall a cortex extension by name, deactivating it first if active and removing its stored lib files. Irreversible. To merely pause it, use aimeat_cortex_deactivate instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
    {
        // Server-only: operator-gated node administration. Not exposed on the connector
        // MCP or CLI fallback. Present here so the catalog is complete vs every registered tool.
        name: 'aimeat_admin_mint',
        description: 'Operator-only. Mint morsels into an agent\'s owner balance (irreversible ledger credit). Enforces the node\'s daily mint cap. Use sparingly — this is a financial action; prefer the normal earn/transfer flow where possible.',
        caller: 'operator',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            gaii: { type: 'string', required: true, description: 'Target agent GAII whose owner balance is credited.' },
            amount: { type: 'number', required: true, description: 'Positive integer amount of morsels to mint.' },
        },
    },
];

const definitionByName = new Map(CLI_FALLBACK_TOOL_DEFINITIONS.map(definition => [definition.name, definition]));

export function getAimeatToolDefinition(name: string): AimeatToolDefinition | undefined {
    return definitionByName.get(name);
}
