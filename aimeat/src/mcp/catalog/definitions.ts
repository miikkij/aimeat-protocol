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
}

const agentEverywhere: ToolVisibility = {
    publicMcp: true,
    connectorMcp: true,
    cliFallback: true,
};

export const CLI_FALLBACK_TOOL_DEFINITIONS: AimeatToolDefinition[] = [
    {
        name: 'aimeat_handbook_get',
        description: 'Get the agent operating handbook or one handbook module.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { module: { type: 'string', description: 'Optional handbook module name, such as tasks or messages.' } },
    },
    {
        name: 'aimeat_onboarding_status',
        description: 'View required Hello Integration status and next-step hints.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_onboarding_identify_platform',
        description: 'Confirm the connected agent runtime/platform for Hello Integration.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            platform: { type: 'string', required: true, description: 'Runtime/platform name, for example hermes, claude, vscode, or generic.' },
            platform_version: { type: 'string', description: 'Runtime/platform version if known.' },
        },
    },
    {
        name: 'aimeat_onboarding_confirm_skill_installed',
        description: 'Confirm the local skill bundle is available for Hello Integration.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            platform: { type: 'string', required: true, description: 'Runtime/platform using the bundle.' },
            version: { type: 'string', required: true, description: 'Bundle version, or local when no version is shown.' },
        },
    },
    {
        name: 'aimeat_onboarding_confirm_directives_read',
        description: 'Confirm the agent has read its AIMEAT handbook/directives.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { confirmed: { type: 'boolean', description: 'Set true after reading the handbook/directives.' } },
    },
    {
        name: 'aimeat_onboarding_declare_services',
        description: 'Optionally declare services/capabilities exposed by this agent.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { services: { type: 'array', description: 'Optional array of service objects with name and description.' } },
    },
    {
        name: 'aimeat_agent_capabilities_report',
        description: 'Report technical and domain capabilities to the node.',
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
        description: 'View agent activity statistics.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            days: { type: 'number', description: 'Number of days of history to retrieve.' },
            granularity: { type: 'string', enum: ['daily', 'hourly'], description: 'History granularity.' },
        },
    },
    {
        name: 'aimeat_agent_telemetry_report',
        description: 'Report agent telemetry to the node.',
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
        description: "Owner-only. Replace the tag list on one of your agents. Convention: 'crew:<name>', 'source:<name>', 'role:<name>', 'project:<name>'. Max 20 tags.",
        caller: 'owner',
        visibility: agentEverywhere,
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose tags to update (must be owned by the calling owner).' },
            tags: { type: 'array', required: true, description: 'Replacement tag list. Empty array clears all tags.' },
        },
    },
    {
        name: 'aimeat_agent_mode_set',
        description: "Owner-only. Set an agent's operational mode. Modes: 'autonomous', 'interactive', 'task-runner' (reduced 5-step Hello Integration), 'coordinator'.",
        caller: 'owner',
        visibility: agentEverywhere,
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose mode to update (must be owned by the calling owner).' },
            mode: { type: 'string', required: true, enum: ['autonomous', 'interactive', 'task-runner', 'coordinator'], description: 'New mode.' },
        },
    },
    {
        name: 'aimeat_message_inbox',
        description: 'Get pending inbound messages.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_message_send',
        description: 'Send an outbound message from the connected agent to the owner conversation.',
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
        name: 'aimeat_task_list',
        description: 'List tasks for the connected agent.',
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
        description: 'Get task detail.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { task_id: { type: 'string', required: true, description: 'Task identifier.' } },
    },
    {
        name: 'aimeat_task_propose_todos',
        description: 'Propose TODOs for a queued task before owner approval or onboarding auto-start.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            todos: { type: 'array', required: true, description: 'Array of TODOs with title, optional description, verification, and estimate_minutes.' },
        },
    },
    {
        name: 'aimeat_task_event',
        description: 'Append a progress event to a task.',
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
        description: 'Update a TODO item status within a task.',
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
        description: 'Complete an active task.',
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
        description: 'Fail an active task with a reason.',
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
        description: 'Read a memory entry by key.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { key: { type: 'string', required: true, description: 'Memory entry key.' } },
    },
    {
        name: 'aimeat_memory_write',
        description: 'Write a memory entry.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            key: { type: 'string', required: true, description: 'Memory entry key.' },
            value: { type: 'unknown', required: true, description: 'Value to store.' },
            visibility: { type: 'string', description: 'Visibility level, defaulting to private.' },
            tags: { type: 'array', description: 'Optional tags for filtering or shared memory areas.' },
            ttl_hours: { type: 'number', description: 'Optional time-to-live in hours.' },
        },
    },
    {
        name: 'aimeat_memory_list',
        description: 'List memory entries.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            prefix: { type: 'string', description: 'Key prefix filter.' },
            visibility: { type: 'string', description: 'Optional visibility filter.' },
            tags: { type: 'array', description: 'Optional tag filters.' },
            owner_scope: { type: 'boolean', description: 'When true, list same-owner GHII and agent memory.' },
            limit: { type: 'number', description: 'Maximum entries to return.' },
        },
    },
    {
        name: 'aimeat_memory_search',
        description: 'Search memory entries by query.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { query: { type: 'string', required: true, description: 'Search query.' } },
    },
    {
        name: 'aimeat_catalogue_search',
        description: 'Search the action catalogue.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { query: { type: 'string', description: 'Optional search query.' } },
    },
    {
        name: 'aimeat_agent_profile',
        description: 'View an agent public profile.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { gaii: { type: 'string', required: true, description: 'Agent GAII identifier.' } },
    },
    {
        name: 'aimeat_action_execute',
        description: 'Request execution of an action.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            input: { type: 'object', description: 'Input parameters for the action.' },
        },
    },
    {
        name: 'aimeat_work_inbox',
        description: 'Check the work inbox for pending work items.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_work_accept',
        description: 'Accept a work item.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { tracking_code: { type: 'string', required: true, description: 'Work item tracking code.' } },
    },
    {
        name: 'aimeat_work_deliver',
        description: 'Deliver a work result.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            tracking_code: { type: 'string', required: true, description: 'Work item tracking code.' },
            result: { type: 'unknown', required: true, description: 'Delivery payload.' },
        },
    },
    {
        name: 'aimeat_wallet_balance',
        description: 'Check morsel wallet balance.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_board_read',
        description: 'Read board posts.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { board_id: { type: 'string', required: true, description: 'Board identifier.' } },
    },
    {
        name: 'aimeat_board_post',
        description: 'Post to a board.',
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
        description: 'Upload a file to storage.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            key: { type: 'string', required: true, description: 'Storage key.' },
            content: { type: 'string', required: true, description: 'Base64-encoded file content.' },
            mime_type: { type: 'string', description: 'Optional MIME type.' },
        },
    },
    {
        name: 'aimeat_storage_download',
        description: 'Download a file from storage.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { key: { type: 'string', required: true, description: 'Storage key.' } },
    },
    {
        name: 'aimeat_admin_stats',
        description: 'View node statistics. Requires operator permission.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_admin_agents',
        description: 'List all agents on the node. Requires operator permission.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_admin_config',
        description: 'View node configuration. Requires operator permission.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_board_list',
        description: 'List visible boards.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_board_create',
        description: 'Create a new board.',
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
        description: 'Subscribe to a board.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { board_id: { type: 'string', required: true, description: 'Board identifier.' } },
    },
    {
        name: 'aimeat_board_react',
        description: 'React to a board post with an emoji.',
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
        description: 'Reply to a board post.',
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
        description: 'Update board member list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            members: { type: 'array', required: true, description: 'List of member identifiers.' },
        },
    },
    {
        name: 'aimeat_board_delete',
        description: 'Delete a board.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { board_id: { type: 'string', required: true, description: 'Board identifier.' } },
    },
    {
        name: 'aimeat_capabilities_list',
        description: 'List registered capabilities.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { query: { type: 'string', description: 'Optional search query.' } },
    },
    {
        name: 'aimeat_capabilities_get',
        description: 'Get capability detail.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Capability identifier.' } },
    },
    {
        name: 'aimeat_capabilities_invoke',
        description: 'Invoke a capability.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'Capability identifier.' },
            input: { type: 'object', description: 'Input parameters.' },
        },
    },
    {
        name: 'aimeat_capabilities_create',
        description: 'Create a new capability.',
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
        description: 'Update a capability.',
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
        description: 'Delete a capability.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Capability identifier.' } },
    },
    {
        name: 'aimeat_capabilities_vouch',
        description: 'Vouch for a capability.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Capability identifier.' } },
    },
    {
        name: 'aimeat_catalogue_agents',
        description: 'Search the agent directory.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { query: { type: 'string', description: 'Optional search query.' } },
    },
    {
        name: 'aimeat_catalogue_boards',
        description: 'Browse public boards.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_catalogue_directory',
        description: 'Search the people directory.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { query: { type: 'string', description: 'Optional search query.' } },
    },
    {
        name: 'aimeat_consent_grant',
        description: 'Grant data-sharing consent to a recipient.',
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
        description: 'List active consent grants.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_consent_revoke',
        description: 'Revoke a consent grant.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Consent grant identifier.' } },
    },
    {
        name: 'aimeat_flag_report',
        description: 'Report content for moderation.',
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
        description: 'List sharing groups.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_group_get',
        description: 'Get group detail.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Group identifier.' } },
    },
    {
        name: 'aimeat_group_create',
        description: 'Create a sharing group.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Group name.' },
            description: { type: 'string', description: 'Group description.' },
        },
    },
    {
        name: 'aimeat_group_add_member',
        description: 'Add a member to a group.',
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
        description: 'Remove a member from a group.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'Group identifier.' },
            identifier: { type: 'string', required: true, description: 'Member GAII or GHII.' },
        },
    },
    {
        name: 'aimeat_instance_list',
        description: 'List instances.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_instance_create',
        description: 'Create a new instance.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Instance name.' },
            template: { type: 'string', description: 'Template to use.' },
        },
    },
    {
        name: 'aimeat_instance_status',
        description: 'Get instance status.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Instance identifier.' } },
    },
    {
        name: 'aimeat_knowledge_list',
        description: 'List knowledge packages.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_knowledge_get',
        description: 'Get a knowledge package by ID.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Knowledge package identifier.' } },
    },
    {
        name: 'aimeat_knowledge_contribute',
        description: 'Contribute an entry to a knowledge package.',
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
        description: 'Get links for a knowledge package.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Knowledge package identifier.' } },
    },
    {
        name: 'aimeat_memory_read_public',
        description: 'Read another agent or owner public memory entry.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            gaii: { type: 'string', required: true, description: 'Target agent or owner GAII/GHII.' },
            key: { type: 'string', required: true, description: 'Memory entry key.' },
        },
    },
    {
        name: 'aimeat_organism_list',
        description: 'List organisms.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_organism_get',
        description: 'Get organism detail.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_organism_join',
        description: 'Join an organism.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_organism_leave',
        description: 'Leave an organism.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_organism_members',
        description: 'List organism members.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_wallet_transactions',
        description: 'View morsel wallet transaction history.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { limit: { type: 'number', description: 'Maximum transactions to return.' } },
    },
    {
        name: 'aimeat_app_publish',
        description: 'Publish an app package.',
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
        description: 'List available apps.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { query: { type: 'string', description: 'Optional search query.' } },
    },
    {
        name: 'aimeat_app_get',
        description: 'Get app detail by group ID.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { group_id: { type: 'string', required: true, description: 'App group identifier.' } },
    },
    {
        name: 'aimeat_app_delete',
        description: 'Archive an app version.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'App group identifier.' },
            version: { type: 'string', required: true, description: 'Version to archive.' },
        },
    },
    {
        name: 'aimeat_app_versions',
        description: 'List app version history.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { group_id: { type: 'string', required: true, description: 'App group identifier.' } },
    },
    {
        name: 'aimeat_extension_list',
        description: 'List installed extensions.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_extension_invoke',
        description: 'Invoke an extension action.',
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
        description: 'Install an extension from a manifest.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Extension name.' },
            manifest: { type: 'object', required: true, description: 'Extension manifest object. Use @file:path for JSON file fields with the CLI fallback.' },
        },
    },
    {
        name: 'aimeat_extension_activate',
        description: 'Activate an installed extension.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_deactivate',
        description: 'Deactivate an extension.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_delete',
        description: 'Uninstall an extension.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_get',
        description: 'Get extension details.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_cortex_list',
        description: 'List installed cortex models.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_cortex_install',
        description: 'Install a cortex model from a manifest.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Cortex name.' },
            manifest: { type: 'object', required: true, description: 'Cortex manifest object. Use @file:path for JSON file fields with the CLI fallback.' },
        },
    },
    {
        name: 'aimeat_cortex_activate',
        description: 'Activate a cortex model.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
    {
        name: 'aimeat_cortex_deactivate',
        description: 'Deactivate a cortex model.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
    {
        name: 'aimeat_cortex_delete',
        description: 'Delete a cortex model.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
];

const definitionByName = new Map(CLI_FALLBACK_TOOL_DEFINITIONS.map(definition => [definition.name, definition]));

export function getAimeatToolDefinition(name: string): AimeatToolDefinition | undefined {
    return definitionByName.get(name);
}
