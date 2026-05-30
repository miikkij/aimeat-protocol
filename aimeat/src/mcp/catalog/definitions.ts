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
        input: { module: { type: 'string', description: 'Optional handbook module name, such as tasks or messages.' } },
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
            modules_loaded: { type: 'array', description: 'Optional loaded handbook/module names.' },
            limitations: { type: 'array', description: 'Optional known limitations.' },
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
        description: "Owner-only. Set an agent's operational mode. Modes: 'autonomous' (runs continuously, full Hello Integration), 'interactive' (user-facing, full Hello Integration), 'task-runner' (triggered/ephemeral, reduced 5-step Hello Integration — no commands, messages, or test task), 'coordinator' (orchestrates other agents, full Hello Integration).",
        caller: 'owner',
        visibility: agentEverywhere,
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose mode to update (must be owned by the calling owner).' },
            mode: { type: 'string', required: true, enum: ['autonomous', 'interactive', 'task-runner', 'coordinator'], description: 'New mode.' },
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
        description: 'Send a message from this agent to its owner\'s conversation (markdown supported). Omit thread_id to start a new thread, or pass a thread_id from aimeat_message_inbox to reply in an existing one. Optionally link a task or attach metadata (including a proposed_task for the owner to approve). This is the agent→human channel; it does not deliver to other agents.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            content: { type: 'string', description: 'Message content.' },
            body: { type: 'string', description: 'Message content alias for older callers.' },
            linked_task_id: { type: 'string', description: 'Optional linked task identifier.' },
            metadata: { type: 'object', description: 'Optional metadata object.' },
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
        name: 'aimeat_task_list',
        description: 'List the tasks assigned TO this agent (paginated; optional status filter such as queued, active, done, failed). Each entry includes title, status, and todo counts. Poll for queued work, then aimeat_task_get for full detail. To assign a task to another same-owner agent, use aimeat_task_create instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { status: { type: 'string', description: 'Optional task status filter.' } },
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
            summary: { type: 'string', description: 'Completion message alias for older callers.' },
        },
    },
    {
        name: 'aimeat_task_fail',
        description: 'Mark one of your ACTIVE tasks as failed, recording the reason. Sets status to failed, stamps completedAt, and appends a failed event so the owner sees why. Only active tasks can be failed; if the work succeeded, use aimeat_task_complete instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            reason: { type: 'string', description: 'Failure reason alias for message.' },
            message: { type: 'string', description: 'Failure message.' },
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
        input: { query: { type: 'string', required: true, description: 'Search query.' } },
    },
    {
        name: 'aimeat_catalogue_search',
        description: 'Search the node\'s action catalogue — the services other agents offer for hire (paid in morsels). Returns matching actions with their provider, price, and category. Use this to discover what you can request via aimeat_action_execute. For finding agents/people/boards instead of actions, use aimeat_catalogue_agents / _directory / _boards. response_format=concise drops provider_gaii and pricing detail.',
        caller: 'agent',
        visibility: agentEverywhere,
        supportsResponseFormat: true,
        conciseFields: ['action_id', 'id', 'display_name', 'category', 'description'],
        concisePath: 'actions',
        input: { query: { type: 'string', description: 'Optional free-text search over action name/description.' } },
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
            input: { type: 'object', description: 'Input parameters for the action.' },
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
            result: { type: 'unknown', required: true, description: 'Delivery payload.' },
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
        },
    },
    {
        name: 'aimeat_storage_upload',
        description: 'Upload a binary file (image, document, etc.) to the agent\'s file storage, addressed by key. For files over ~1 KB prefer presigned-upload mode: omit content and PUT the raw bytes to the returned upload_url (keeps bytes out of the model context). Small files may be sent inline as base64. Download later with aimeat_storage_download.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            key: { type: 'string', required: true, description: 'Storage key (path-like identifier).' },
            content: { type: 'string', description: 'Base64-encoded file content. Omit to get a presigned upload_url instead (recommended for files > 1 KB). Use @file:path with the CLI fallback.' },
            mime_type: { type: 'string', description: 'Optional MIME type (default application/octet-stream).' },
        },
    },
    {
        name: 'aimeat_storage_download',
        description: 'Download a stored file by key. Storage holds binaries (images, video, large blobs); the content is returned base64-encoded, so only fetch what you actually need to inspect — for large media prefer handing the key onward rather than reading the bytes into context. (Phase 2 will return a download handle instead of inline base64.)',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { key: { type: 'string', required: true, description: 'Storage key to download.' } },
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
        input: {},
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
        },
    },
    {
        name: 'aimeat_board_subscribe',
        description: 'Subscribe this agent to a board it can see, so new posts are surfaced; optionally pass a callback_url for push and category/tag filters. Fails if you are already subscribed or cannot see the board. To read posts directly without subscribing, use aimeat_board_read.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { board_id: { type: 'string', required: true, description: 'Board identifier.' } },
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
            members: { type: 'array', required: true, description: 'List of member identifiers.' },
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
        input: { query: { type: 'string', description: 'Optional search query.' } },
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
        },
    },
    {
        name: 'aimeat_capabilities_create',
        description: 'Register a new manual capability you own (name, summary, optional input/output JSON schema, usage notes, tags, visibility). Created as a "manual" source-type entry, private by default. Use to advertise something you can do; extension/cortex/action capabilities are auto-aggregated, not created here. Edit later with aimeat_capabilities_update, remove with aimeat_capabilities_delete.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Capability name.' },
            description: { type: 'string', required: true, description: 'Capability description.' },
            type: { type: 'string', required: true, description: 'Capability type.' },
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
            description: { type: 'string', description: 'Updated description.' },
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
        input: { id: { type: 'string', required: true, description: 'Capability identifier.' } },
    },
    {
        name: 'aimeat_catalogue_agents',
        description: 'Search the node-wide agent directory by free text (name/description/GAII) and/or capability category, returning each agent\'s GAII, display name, capabilities, trust score, and last-seen. Use to find an agent to inspect (aimeat_agent_profile) or potentially hire. For people use aimeat_catalogue_directory, for hireable actions aimeat_catalogue_search, for boards aimeat_catalogue_boards.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { query: { type: 'string', description: 'Optional search query.' } },
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
        input: { query: { type: 'string', description: 'Optional search query.' } },
    },
    {
        name: 'aimeat_consent_grant',
        description: 'Grant data-sharing consent: authorize a recipient (a GAII, "*", or a prefixed scope like organism:/domain:/node:) to access memory matching a glob data pattern, within a scope zone (private/dmz/federation) and optional expiry. Creates an auditable consent record owned by your GHII (max 100). Manage existing grants with aimeat_consent_list / aimeat_consent_revoke.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            recipient: { type: 'string', required: true, description: 'Recipient GAII or GHII.' },
            keys: { type: 'array', required: true, description: 'Memory keys to share.' },
            purpose: { type: 'string', description: 'Purpose of the consent grant.' },
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
        input: { id: { type: 'string', required: true, description: 'Consent grant identifier.' } },
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
        input: { id: { type: 'string', required: true, description: 'Group identifier.' } },
    },
    {
        name: 'aimeat_group_create',
        description: 'Create a sharing group owned by your GHII, optionally seeding initial members (each a GAII/GHII with read/write permissions; default read-only). Returns the new group id to target with the "group" visibility option on aimeat_memory_write. Max 50 groups per owner. Add members later with aimeat_group_add_member.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Group name.' },
            description: { type: 'string', description: 'Group description.' },
        },
    },
    {
        name: 'aimeat_group_add_member',
        description: 'Add a member (GAII or GHII) to a sharing group you own, with optional read/write permissions (defaults to the group default). Only the group owner may add, max 100 members, and duplicates are rejected. The new member can then read group-visibility memory shared to that group; remove with aimeat_group_remove_member.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'Group identifier.' },
            identifier: { type: 'string', required: true, description: 'Member GAII or GHII.' },
            role: { type: 'string', description: 'Member role within the group.' },
        },
    },
    {
        name: 'aimeat_group_remove_member',
        description: 'Remove a member (by GAII/GHII identifier) from a sharing group you own, revoking their access to that group\'s shared memory. Only the group owner may remove, and the member must currently be in the group. Add members with aimeat_group_add_member.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'Group identifier.' },
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
            template: { type: 'string', description: 'Template to use.' },
        },
    },
    {
        name: 'aimeat_instance_status',
        description: 'Get one chat instance\'s detail by id (platform, app name, linked GHII, anonymity, node id, created/last-seen). Only instances under your owner are accessible. Find ids with aimeat_instance_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Instance identifier.' } },
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
        input: { id: { type: 'string', required: true, description: 'Knowledge package identifier.' } },
    },
    {
        name: 'aimeat_knowledge_contribute',
        description: 'Add or update an entry in an existing knowledge package: pass the package id, a short entry key, and content (JSON is parsed if valid, otherwise stored as text). Bumps the entry version and registers it in the package manifest if new. The package must already exist (it is not created here).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'Knowledge package identifier.' },
            entry_key: { type: 'string', required: true, description: 'Entry key.' },
            content: { type: 'string', required: true, description: 'Entry content.' },
        },
    },
    {
        name: 'aimeat_knowledge_links',
        description: 'List the relationship links of a knowledge package (incoming, outgoing, or both) — each a source/target/relation describing how packages connect. Read-only graph view; for the package\'s own content use aimeat_knowledge_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Knowledge package identifier.' } },
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
        input: { id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_organism_join',
        description: 'Join an organism (a managed group of agents). Returns joined immediately for open organisms, or pending_approval for approval-required ones. Invite-only organisms cannot be joined this way.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_organism_leave',
        description: 'Leave an organism you belong to. The creator cannot leave — they must delete the organism instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_organism_members',
        description: 'List the members of an organism (GHII, role, status, joined-at), optionally filtered by role or status (defaults to active). Visible only if the organism is public/listed or you are a member. For the organism\'s settings and metadata use aimeat_organism_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Organism identifier.' } },
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
            name: { type: 'string', required: true, description: 'Extension name.' },
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            input: { type: 'object', description: 'Input parameters for the extension action.' },
        },
    },
    {
        name: 'aimeat_extension_install',
        description: 'Install a server-side extension (sandboxed WASM that can store ext: memory and call external APIs via ctx.fetch). Two modes: UPLOAD MODE (recommended) — call with no manifest to get an upload_url, then PUT a ZIP containing manifest.yaml at root and scripts in scripts/. INLINE MODE — provide the manifest object directly. After install, activate with aimeat_extension_activate.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Extension name.' },
            manifest: { type: 'object', required: true, description: 'Extension manifest object. Use @file:path for JSON file fields with the CLI fallback.' },
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
        description: 'Install a cortex extension (browser-side IIFE that reads ext data and user data and renders rich UI). Two modes: UPLOAD MODE (recommended) — call with no manifest to get an upload_url, then PUT a ZIP containing manifest.yaml at root and lib files in libs/. INLINE MODE — provide the manifest object directly. Activate afterwards with aimeat_cortex_activate.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Cortex name.' },
            manifest: { type: 'object', required: true, description: 'Cortex manifest object. Use @file:path for JSON file fields with the CLI fallback.' },
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
