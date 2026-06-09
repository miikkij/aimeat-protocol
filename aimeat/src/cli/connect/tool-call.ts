/**
 * @file tool-call.ts
 * @description Shell fallback for connector tools. Provides `aimeat connect tools`,
 *   `aimeat connect schema`, and `aimeat connect call` for runtimes that can run
 *   commands but cannot use MCP directly.
 * @structure
 *   - CONNECT_CLI_TOOLS -- initial REST-backed tool catalog for Hello Integration
 *   - runToolList() -- prints CLI-callable tool names
 *   - runToolSchema() -- prints plain JSON input schema metadata
 *   - runToolCall() -- loads JSON input and invokes the matching REST-backed handler
 * @usage
 *   aimeat connect tools
 *   aimeat connect schema aimeat_onboarding_status
 *   aimeat connect call aimeat_message_send --json input.json
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Add initial shell fallback for agent lifecycle tools
 *   v1.1.0 -- 2026-05-28 -- Read public tool metadata from the shared MCP catalog
 *   v1.2.0 -- 2026-05-28 -- Add app, extension, and cortex CLI fallback handlers
 *   v1.3.0 -- 2026-05-28 -- Add core memory, work, wallet, board, storage, and admin handlers
 *   v1.4.0 -- 2026-05-28 -- Add remaining connector MCP handlers to CLI fallback
 *   v1.5.0 -- 2026-05-28 -- Add memory tags and owner-scope listing support
 *   v1.6.0 -- 2026-06-09 -- Add organism WORKSPACE + organism create/backup shell handlers
 *     (workspace_list/read/write/publish/update/create/object_delete/access/transfer +
 *     organism_create/export/import), so no-LLM CrewAI crews can read/write organism workspaces via
 *     `aimeat connect call`. Thin REST wrappers, server-side authz unchanged. Guarded by
 *     test/unit/connector-cli-parity.test.ts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { CLI_FALLBACK_TOOL_DEFINITIONS, getAimeatToolDefinition, type ToolInputField } from '../../mcp/catalog/definitions.js';
import type { AimeatClient, ApiResponse } from './api-client.js';
import { AimeatClient as Client } from './api-client.js';
import { loadConfig, loadAgentByName, type AimeatConnectConfig } from './config.js';

type JsonObject = Record<string, unknown>;

interface ConnectCliToolDefinition {
    name: string;
    description?: string;
    input?: Record<string, ToolInputField>;
    handler: (ctx: ToolCallContext, input: JsonObject) => Promise<ApiResponse>;
}

interface ToolCallContext {
    client: AimeatClient;
    config: AimeatConnectConfig;
    agentPath: string;
}

function requiredString(input: JsonObject, key: string): string {
    const value = input[key];
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing required string field: ${key}`);
    return value;
}

function optionalString(input: JsonObject, key: string): string | undefined {
    const value = input[key];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNumber(input: JsonObject, key: string): number | undefined {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function optionalBoolean(input: JsonObject, key: string): boolean | undefined {
    const value = input[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return undefined;
}

function requiredValue(input: JsonObject, key: string): unknown {
    if (!(key in input)) throw new Error(`Missing required field: ${key}`);
    return input[key];
}

function optionalRecord(input: JsonObject, key: string): JsonObject | undefined {
    const value = input[key];
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function requiredRecord(input: JsonObject, key: string): JsonObject {
    const value = input[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as JsonObject;
    if (typeof value === 'string') {
        const parsed = JSON.parse(value) as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as JsonObject;
    }
    throw new Error(`Missing required object field: ${key}`);
}

function optionalArray(input: JsonObject, key: string): unknown[] | undefined {
    const value = input[key];
    return Array.isArray(value) ? value : undefined;
}

function requiredArray(input: JsonObject, key: string): unknown[] {
    const value = input[key];
    if (Array.isArray(value)) return value;
    throw new Error(`Missing required array field: ${key}`);
}

function query(params: Record<string, string | number | boolean | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) search.set(key, String(value));
    }
    const serialized = search.toString();
    return serialized ? `?${serialized}` : '';
}

// ── Workspace helpers (shared with the workspace_* shell handlers below) ──
const wsRoot = (orgId: string, ws: string) => `organism.${orgId}.w.${ws}`;
/** Parse a possibly-JSON-stringified object param (value/manifest/schemas) back to an object. */
function coerceObject(value: unknown): unknown {
    if (typeof value === 'string') { try { const p = JSON.parse(value) as unknown; if (p && typeof p === 'object') return p; } catch { /* leave as-is */ } }
    return value;
}
/** A draft value should be an object; tolerate a JSON-string, then stamp the instance id. */
function stampValue(value: unknown, id: string): unknown {
    const v = coerceObject(value);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(v as JsonObject), id } : v;
}
function genDocId(): string {
    return 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function genWsId(): string {
    return 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function taskTodoPayload(input: JsonObject): JsonObject {
    const todos = optionalArray(input, 'todos') ?? [];
    return {
        todos: todos.map((rawTodo, index) => {
            const todo = typeof rawTodo === 'object' && rawTodo !== null ? rawTodo as JsonObject : {};
            const title = typeof todo.title === 'string' ? todo.title : `TODO ${index + 1}`;
            return {
                id: `todo-${index + 1}`,
                order: index + 1,
                title,
                description: typeof todo.description === 'string' ? todo.description : '',
                environment: 'agent',
                environment_reason: 'The connected agent can perform this step through AIMEAT tools.',
                verification: typeof todo.verification === 'string' ? todo.verification : '',
                estimate_minutes: typeof todo.estimate_minutes === 'number' ? todo.estimate_minutes : undefined,
                status: 'pending',
            };
        }),
    };
}

export const CONNECT_CLI_TOOLS: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_handbook_get',
        description: 'Get the agent operating handbook or one handbook module.',
        input: { module: { type: 'string', description: 'Optional handbook module name, such as tasks or messages.' } },
        handler: ({ client }, input) => client.get(optionalString(input, 'module')
            ? `/v1/agents/me/handbook/${encodeURIComponent(optionalString(input, 'module')!)}`
            : '/v1/agents/me/handbook'),
    },
    {
        name: 'aimeat_onboarding_status',
        description: 'View required Hello Integration status and next-step hints.',
        input: {},
        handler: ({ client, agentPath }) => client.get(`/v1/agents/${agentPath}/onboarding`),
    },
    {
        name: 'aimeat_onboarding_identify_platform',
        description: 'Confirm the connected agent runtime/platform for Hello Integration.',
        input: {
            platform: { type: 'string', required: true, description: 'Runtime/platform name, for example hermes, claude, vscode, or generic.' },
            platform_version: { type: 'string', description: 'Runtime/platform version if known.' },
        },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/onboarding/step/identify_platform`, {
            platform: requiredString(input, 'platform'),
            ...(optionalString(input, 'platform_version') ? { platform_version: optionalString(input, 'platform_version') } : {}),
        }),
    },
    {
        name: 'aimeat_onboarding_confirm_skill_installed',
        description: 'Confirm the local skill bundle is available for Hello Integration.',
        input: {
            platform: { type: 'string', required: true, description: 'Runtime/platform using the bundle.' },
            version: { type: 'string', required: true, description: 'Bundle version, or local when no version is shown.' },
        },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/onboarding/step/install_skill`, {
            platform: requiredString(input, 'platform'),
            version: requiredString(input, 'version'),
        }),
    },
    {
        name: 'aimeat_onboarding_confirm_directives_read',
        description: 'Confirm the agent has read its AIMEAT handbook/directives.',
        input: { confirmed: { type: 'boolean', description: 'Set true after reading the handbook/directives.' } },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/onboarding/step/read_directives`, {
            confirmed: typeof input.confirmed === 'boolean' ? input.confirmed : true,
        }),
    },
    {
        name: 'aimeat_onboarding_declare_services',
        description: 'Optionally declare services/capabilities exposed by this agent.',
        input: { services: { type: 'array', description: 'Optional array of service objects with name and description.' } },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/onboarding/step/declare_services`, {
            services: optionalArray(input, 'services') ?? [],
        }),
    },
    {
        name: 'aimeat_agent_capabilities_report',
        description: 'Report technical and domain capabilities to the node.',
        input: {
            technical: { type: 'array', description: "Array of { name: string, type: 'mcp'|'skill'|'tool' }. Type is enforced as an enum -- other values are rejected with INVALID_INPUT." },
            domain: { type: 'array', description: 'Array of domain expertise strings.' },
            languages: { type: 'array', description: 'Array of language codes (BCP-47 short form), e.g. ["en","fi"]. Stored separately from domain.' },
            modules_loaded: { type: 'array', description: 'Optional loaded handbook/module names.' },
            limitations: { type: 'array', description: 'Optional known limitations.' },
        },
        handler: ({ client, agentPath }, input) => client.put(`/v1/agents/${agentPath}/capabilities`, {
            technical: optionalArray(input, 'technical') ?? [],
            domain: optionalArray(input, 'domain') ?? [],
            ...(optionalArray(input, 'languages') ? { languages: optionalArray(input, 'languages') } : {}),
            ...(optionalArray(input, 'modules_loaded') ? { modules_loaded: optionalArray(input, 'modules_loaded') } : {}),
            ...(optionalArray(input, 'limitations') ? { limitations: optionalArray(input, 'limitations') } : {}),
        }),
    },
    {
        name: 'aimeat_agent_activity',
        description: 'View agent activity statistics.',
        input: {
            days: { type: 'number', description: 'Number of days of history to retrieve.' },
            granularity: { type: 'string', enum: ['daily', 'hourly'], description: 'History granularity.' },
        },
        handler: ({ client, agentPath }, input) => client.get(`/v1/agents/${agentPath}/activity${query({
            days: typeof input.days === 'number' ? input.days : undefined,
            granularity: optionalString(input, 'granularity'),
        })}`),
    },
    {
        name: 'aimeat_agent_tags_set',
        description: "Owner-only. Replace the tag list on an agent. Convention: 'crew:<name>', 'source:<name>', 'role:<name>', 'project:<name>'.",
        input: {
            target_agent_name: { type: 'string', description: 'Agent whose tags to update.' },
            tags: { type: 'array', description: 'Replacement tag list. Empty array clears all tags. Max 20.' },
        },
        handler: ({ client }, input) => {
            const target = optionalString(input, 'target_agent_name');
            if (!target) throw new Error('target_agent_name is required');
            return client.patch(`/v1/agents/${encodeURIComponent(target)}/tags`, {
                tags: optionalArray(input, 'tags') ?? [],
            });
        },
    },
    {
        name: 'aimeat_agent_mode_set',
        description: "Owner-only. Set an agent's operational mode. Modes: 'autonomous', 'interactive', 'task-runner' (reduced 5-step Hello Integration), 'coordinator'.",
        input: {
            target_agent_name: { type: 'string', description: 'Agent whose mode to update.' },
            mode: { type: 'string', enum: ['autonomous', 'interactive', 'task-runner', 'coordinator'], description: 'New mode.' },
        },
        handler: ({ client }, input) => {
            const target = optionalString(input, 'target_agent_name');
            const mode = optionalString(input, 'mode');
            if (!target) throw new Error('target_agent_name is required');
            if (!mode) throw new Error('mode is required');
            return client.patch(`/v1/agents/${encodeURIComponent(target)}/mode`, { mode });
        },
    },
    {
        name: 'aimeat_agent_telemetry_report',
        description: 'Report agent telemetry to the node.',
        input: {
            type: { type: 'string', enum: ['llm_call', 'tool_call', 'agent_report'], description: 'Telemetry event type.' },
            data: { type: 'object', description: 'Telemetry data such as tokens, duration, or tool name.' },
            session_id: { type: 'string', description: 'Optional runtime session identifier.' },
            task_id: { type: 'string', description: 'Optional related AIMEAT task id.' },
        },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/telemetry`, {
            type: optionalString(input, 'type') ?? 'agent_report',
            data: optionalRecord(input, 'data') ?? {},
            ...(optionalString(input, 'session_id') ? { session_id: optionalString(input, 'session_id') } : {}),
            ...(optionalString(input, 'task_id') ? { task_id: optionalString(input, 'task_id') } : {}),
        }),
    },
    {
        name: 'aimeat_message_inbox',
        description: 'Get pending inbound messages.',
        input: {},
        handler: ({ client, agentPath }) => client.get(`/v1/agents/${agentPath}/messages/inbox`),
    },
    {
        name: 'aimeat_message_send',
        description: 'Send an outbound message from the connected agent to the owner conversation.',
        input: {
            content: { type: 'string', description: 'Message content.' },
            body: { type: 'string', description: 'Message content alias for older callers.' },
            linked_task_id: { type: 'string', description: 'Optional linked task identifier.' },
            metadata: { type: 'object', description: 'Optional metadata object.' },
        },
        handler: ({ client, agentPath }, input) => {
            const content = optionalString(input, 'content') ?? optionalString(input, 'body');
            if (!content) throw new Error('Missing required field: content');
            return client.post(`/v1/agents/${agentPath}/messages`, {
                content,
                direction: 'outbound',
                ...(optionalString(input, 'linked_task_id') ? { linked_task_id: optionalString(input, 'linked_task_id') } : {}),
                ...(optionalRecord(input, 'metadata') ? { metadata: optionalRecord(input, 'metadata') } : {}),
            });
        },
    },
    {
        name: 'aimeat_agents_list',
        description: "List the calling owner's agents on the node (name, mode, capabilities, tags, last_seen, ...). Use this to discover delegation targets for aimeat_task_create.",
        input: {},
        handler: ({ client }) => client.get('/v1/agents'),
    },
    {
        name: 'aimeat_task_list',
        description: 'List tasks for the connected agent.',
        input: { status: { type: 'string', description: 'Optional task status filter.' } },
        handler: ({ client, agentPath }, input) => client.get(`/v1/agents/${agentPath}/tasks${query({ status: optionalString(input, 'status') })}`),
    },
    {
        name: 'aimeat_task_create',
        description: "Queue a task for one of your owner's agents (yourself or any same-owner agent). The owner sees it in their dashboard.",
        input: {
            target_agent: { type: 'string', required: true, description: 'Name of the agent the task is FOR (must share the calling agent\'s owner).' },
            title: { type: 'string', required: true, description: 'Short human-readable title.' },
            description: { type: 'string', required: true, description: 'The actual prompt / instruction.' },
            status: { type: 'string', enum: ['draft', 'queued'], description: 'Default "queued".' },
        },
        handler: ({ client }, input) => {
            const target = requiredString(input, 'target_agent');
            return client.post(`/v1/agents/${encodeURIComponent(target)}/tasks`, {
                title: requiredString(input, 'title'),
                description: requiredString(input, 'description'),
                status: optionalString(input, 'status') ?? 'queued',
                verification: { user_expects: '', technical_checks: [] },
                todos: [],
            });
        },
    },
    {
        name: 'aimeat_task_get',
        description: 'Get task detail.',
        input: { task_id: { type: 'string', required: true, description: 'Task identifier.' } },
        handler: ({ client, agentPath }, input) => client.get(`/v1/agents/${agentPath}/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}`),
    },
    {
        name: 'aimeat_task_propose_todos',
        description: 'Propose TODOs for a queued task, or re-propose after the owner has requested changes. The server preserves prior proposals as outdated history.',
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            todos: { type: 'array', required: true, description: 'Array of TODOs with title, optional description, verification, and estimate_minutes.' },
        },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}/propose-todos`, taskTodoPayload(input)),
    },
    {
        name: 'aimeat_task_request_changes',
        description: "Owner-only: ask an agent to revise its proposed TODO plan. Marks the existing todos as outdated, flips the task status to 'revision_requested', and pushes a linked message carrying the owner's free-text change request.",
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier (must be a queued task with existing proposed todos).' },
            message: { type: 'string', required: true, description: "Owner's free-text change request." },
        },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}/request-changes`, {
            message: requiredString(input, 'message'),
        }),
    },
    {
        name: 'aimeat_task_event',
        description: 'Append a progress event to a task.',
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            type: { type: 'string', required: true, description: 'Event type.' },
            message: { type: 'string', required: true, description: 'Event message.' },
            details: { type: 'object', description: 'Optional event details.' },
        },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}/event`, {
            type: requiredString(input, 'type'),
            message: requiredString(input, 'message'),
            ...(optionalRecord(input, 'details') ? { details: optionalRecord(input, 'details') } : {}),
        }),
    },
    {
        name: 'aimeat_task_todo',
        description: 'Update a TODO item status within a task.',
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            todo_id: { type: 'string', required: true, description: 'TODO item identifier.' },
            status: { type: 'string', required: true, enum: ['pending', 'active', 'done', 'failed', 'skipped'], description: 'New TODO status.' },
        },
        handler: ({ client, agentPath }, input) => client.patch(
            `/v1/agents/${agentPath}/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}/todos/${encodeURIComponent(requiredString(input, 'todo_id'))}`,
            { status: requiredString(input, 'status') },
        ),
    },
    {
        name: 'aimeat_task_complete',
        description: 'Complete an active task.',
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            message: { type: 'string', description: 'Completion message.' },
            summary: { type: 'string', description: 'Completion message alias for older callers.' },
        },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}/complete`, {
            message: optionalString(input, 'message') ?? optionalString(input, 'summary') ?? 'Task completed',
        }),
    },
    {
        name: 'aimeat_task_fail',
        description: 'Fail an active task with a reason.',
        input: {
            task_id: { type: 'string', required: true, description: 'Task identifier.' },
            reason: { type: 'string', description: 'Failure reason alias for message.' },
            message: { type: 'string', description: 'Failure message.' },
        },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}/fail`, {
            message: optionalString(input, 'message') ?? optionalString(input, 'reason') ?? 'Task failed',
        }),
    },
    {
        name: 'aimeat_memory_read',
        handler: ({ client }, input) => client.get(`/v1/memory/${encodeURIComponent(requiredString(input, 'key'))}`),
    },
    {
        name: 'aimeat_memory_write',
        handler: ({ client }, input) => {
            const body: JsonObject = { key: requiredString(input, 'key'), value: requiredValue(input, 'value') };
            const visibility = optionalString(input, 'visibility');
            const ttlHours = optionalNumber(input, 'ttl_hours');
            if (visibility) body.visibility = visibility;
            const tags = optionalArray(input, 'tags');
            if (tags) body.tags = tags;
            if (ttlHours !== undefined) body.ttl_hours = ttlHours;
            return client.post('/v1/memory', body);
        },
    },
    {
        name: 'aimeat_memory_list',
        handler: ({ client }, input) => {
            const tags = optionalArray(input, 'tags')?.filter((tag): tag is string => typeof tag === 'string');
            return client.get(`/v1/memory${query({
                prefix: optionalString(input, 'prefix'),
                visibility: optionalString(input, 'visibility'),
                tags: tags?.length ? tags.join(',') : undefined,
                owner_scope: optionalBoolean(input, 'owner_scope') ? 'true' : undefined,
                limit: optionalNumber(input, 'limit'),
            })}`);
        },
    },
    {
        name: 'aimeat_memory_search',
        handler: ({ client }, input) => client.get(`/v1/memory/search${query({ q: requiredString(input, 'query') })}`),
    },
    {
        name: 'aimeat_catalogue_search',
        handler: ({ client }, input) => client.get(`/v1/catalogue${query({ q: optionalString(input, 'query') })}`),
    },
    {
        name: 'aimeat_agent_profile',
        handler: ({ client }, input) => client.get(`/v1/agents/${encodeURIComponent(requiredString(input, 'gaii'))}`),
    },
    {
        name: 'aimeat_action_execute',
        handler: ({ client }, input) => {
            const body: JsonObject = { action_id: requiredString(input, 'action_id') };
            const actionInput = optionalRecord(input, 'input');
            if (actionInput) body.input = actionInput;
            return client.post('/v1/work/request', body);
        },
    },
    {
        name: 'aimeat_work_inbox',
        handler: ({ client }) => client.get('/v1/work/inbox'),
    },
    {
        name: 'aimeat_work_accept',
        handler: ({ client }, input) => client.post(`/v1/work/${encodeURIComponent(requiredString(input, 'tracking_code'))}/accept`),
    },
    {
        name: 'aimeat_work_deliver',
        handler: ({ client }, input) => client.post(
            `/v1/work/${encodeURIComponent(requiredString(input, 'tracking_code'))}/deliver`,
            { result: requiredValue(input, 'result') },
        ),
    },
    {
        name: 'aimeat_wallet_balance',
        handler: ({ client }) => client.get('/v1/wallet'),
    },
    {
        name: 'aimeat_board_read',
        handler: ({ client }, input) => client.get(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts`),
    },
    {
        name: 'aimeat_board_post',
        handler: ({ client }, input) => client.post(
            `/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts`,
            { title: requiredString(input, 'title'), body: requiredString(input, 'body') },
        ),
    },
    {
        name: 'aimeat_storage_upload',
        handler: ({ client }, input) => {
            const body: JsonObject = { key: requiredString(input, 'key'), content: requiredString(input, 'content') };
            const mimeType = optionalString(input, 'mime_type');
            if (mimeType) body.mime_type = mimeType;
            return client.post('/v1/storage', body);
        },
    },
    {
        name: 'aimeat_storage_download',
        handler: ({ client }, input) => client.get(`/v1/storage/${encodeURIComponent(requiredString(input, 'key'))}`),
    },
    {
        name: 'aimeat_admin_stats',
        handler: ({ client }) => client.get('/v1/admin/stats'),
    },
    {
        name: 'aimeat_admin_agents',
        handler: ({ client }) => client.get('/v1/admin/agents'),
    },
    {
        name: 'aimeat_admin_config',
        handler: ({ client }) => client.get('/v1/admin/config'),
    },
    {
        name: 'aimeat_board_list',
        handler: ({ client }) => client.get('/v1/boards'),
    },
    {
        name: 'aimeat_board_create',
        handler: ({ client }, input) => {
            const body: JsonObject = { name: requiredString(input, 'name') };
            const description = optionalString(input, 'description');
            const visibility = optionalString(input, 'visibility');
            if (description) body.description = description;
            if (visibility) body.visibility = visibility;
            return client.post('/v1/boards', body);
        },
    },
    {
        name: 'aimeat_board_subscribe',
        handler: ({ client }, input) => client.post(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/subscribe`),
    },
    {
        name: 'aimeat_board_react',
        handler: ({ client }, input) => client.post(
            `/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts/${encodeURIComponent(requiredString(input, 'post_id'))}/react`,
            { emoji: requiredString(input, 'emoji') },
        ),
    },
    {
        name: 'aimeat_board_reply',
        handler: ({ client }, input) => client.post(
            `/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts/${encodeURIComponent(requiredString(input, 'post_id'))}/replies`,
            { body: requiredString(input, 'body') },
        ),
    },
    {
        name: 'aimeat_board_members',
        handler: ({ client }, input) => client.patch(
            `/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/members`,
            { members: requiredArray(input, 'members') },
        ),
    },
    {
        name: 'aimeat_board_delete',
        handler: ({ client }, input) => client.delete(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}`),
    },
    {
        name: 'aimeat_capabilities_list',
        handler: ({ client }, input) => client.get(`/v1/capabilities${query({ q: optionalString(input, 'query') })}`),
    },
    {
        name: 'aimeat_capabilities_get',
        handler: ({ client }, input) => client.get(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_capabilities_invoke',
        handler: ({ client }, input) => client.post(
            `/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}/invoke`,
            optionalRecord(input, 'input') ?? {},
        ),
    },
    {
        name: 'aimeat_capabilities_create',
        handler: ({ client }, input) => client.post('/v1/capabilities', {
            name: requiredString(input, 'name'),
            description: requiredString(input, 'description'),
            type: requiredString(input, 'type'),
        }),
    },
    {
        name: 'aimeat_capabilities_update',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const name = optionalString(input, 'name');
            const description = optionalString(input, 'description');
            if (name) body.name = name;
            if (description) body.description = description;
            return client.put(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}`, body);
        },
    },
    {
        name: 'aimeat_capabilities_delete',
        handler: ({ client }, input) => client.delete(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_capabilities_vouch',
        handler: ({ client }, input) => client.post(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}/vouch`, {}),
    },
    {
        name: 'aimeat_catalogue_agents',
        handler: ({ client }, input) => client.get(`/v1/catalogue/agents${query({ q: optionalString(input, 'query') })}`),
    },
    {
        name: 'aimeat_catalogue_boards',
        handler: ({ client }) => client.get('/v1/catalogue/boards'),
    },
    {
        name: 'aimeat_catalogue_directory',
        handler: ({ client }, input) => client.get(`/v1/catalogue/directory${query({ q: optionalString(input, 'query') })}`),
    },
    {
        name: 'aimeat_consent_grant',
        handler: ({ client }, input) => {
            const body: JsonObject = { recipient: requiredString(input, 'recipient'), keys: requiredArray(input, 'keys') };
            const purpose = optionalString(input, 'purpose');
            if (purpose) body.purpose = purpose;
            return client.post('/v1/consent', body);
        },
    },
    {
        name: 'aimeat_consent_list',
        handler: ({ client }) => client.get('/v1/consent'),
    },
    {
        name: 'aimeat_consent_revoke',
        handler: ({ client }, input) => client.delete(`/v1/consent/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_flag_report',
        handler: ({ client }, input) => client.post('/v1/flags', {
            target_type: requiredString(input, 'target_type'),
            target_id: requiredString(input, 'target_id'),
            reason: requiredString(input, 'reason'),
        }),
    },
    {
        name: 'aimeat_group_list',
        handler: ({ client }) => client.get('/v1/groups'),
    },
    {
        name: 'aimeat_group_get',
        handler: ({ client }, input) => client.get(`/v1/groups/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_group_create',
        handler: ({ client }, input) => {
            const body: JsonObject = { name: requiredString(input, 'name') };
            const description = optionalString(input, 'description');
            if (description) body.description = description;
            return client.post('/v1/groups', body);
        },
    },
    {
        name: 'aimeat_group_add_member',
        handler: ({ client }, input) => {
            const body: JsonObject = { identifier: requiredString(input, 'identifier') };
            const role = optionalString(input, 'role');
            if (role) body.role = role;
            return client.post(`/v1/groups/${encodeURIComponent(requiredString(input, 'id'))}/members`, body);
        },
    },
    {
        name: 'aimeat_group_remove_member',
        handler: ({ client }, input) => client.delete(`/v1/groups/${encodeURIComponent(requiredString(input, 'id'))}/members/${encodeURIComponent(requiredString(input, 'identifier'))}`),
    },
    {
        name: 'aimeat_instance_list',
        handler: ({ client }) => client.get('/v1/instances'),
    },
    {
        name: 'aimeat_instance_create',
        handler: ({ client }, input) => {
            const body: JsonObject = { name: requiredString(input, 'name') };
            const template = optionalString(input, 'template');
            if (template) body.template = template;
            return client.post('/v1/instances', body);
        },
    },
    {
        name: 'aimeat_instance_status',
        handler: ({ client }, input) => client.get(`/v1/instances/${encodeURIComponent(requiredString(input, 'id'))}/status`),
    },
    {
        name: 'aimeat_knowledge_list',
        handler: ({ client }) => client.get('/v1/catalogue/knowledge'),
    },
    {
        name: 'aimeat_knowledge_get',
        handler: ({ client }, input) => client.get(`/v1/knowledge/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_knowledge_contribute',
        handler: ({ client }, input) => client.post(`/v1/knowledge/${encodeURIComponent(requiredString(input, 'id'))}/contribute`, {
            entry_key: requiredString(input, 'entry_key'),
            content: requiredString(input, 'content'),
        }),
    },
    {
        name: 'aimeat_knowledge_links',
        handler: ({ client }, input) => client.get(`/v1/knowledge/${encodeURIComponent(requiredString(input, 'id'))}/links`),
    },
    {
        name: 'aimeat_memory_read_public',
        handler: ({ client }, input) => client.get(`/v1/memory/${encodeURIComponent(requiredString(input, 'gaii'))}/${encodeURIComponent(requiredString(input, 'key'))}`),
    },
    {
        name: 'aimeat_organism_list',
        handler: ({ client }) => client.get('/v1/organisms'),
    },
    {
        name: 'aimeat_organism_get',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_organism_join',
        handler: ({ client }, input) => client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'id'))}/join`),
    },
    {
        name: 'aimeat_organism_leave',
        handler: ({ client }, input) => client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'id'))}/leave`),
    },
    {
        name: 'aimeat_organism_members',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'id'))}/members`),
    },
    // ── Organism create / backup (parity with the appdev MCP surface; thin REST wrappers, authz server-side) ──
    {
        name: 'aimeat_organism_create',
        handler: ({ client }, input) => {
            const body: JsonObject = { name: requiredString(input, 'name') };
            const description = optionalString(input, 'description'); if (description) body.description = description;
            const type = optionalString(input, 'type'); if (type) body.type = type;
            const joinPolicy = optionalString(input, 'join_policy'); if (joinPolicy) body.join_policy = joinPolicy;
            const visibility = optionalString(input, 'visibility'); if (visibility) body.visibility = visibility;
            return client.post('/v1/organisms', body);
        },
    },
    {
        name: 'aimeat_organism_export',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/export${query({ format: 'base64' })}`),
    },
    {
        name: 'aimeat_organism_import',
        handler: ({ client }, input) => client.post('/v1/organisms/import', { zip_base64: requiredString(input, 'zip_base64') }),
    },
    // ── Organism WORKSPACES (parity with the appdev MCP surface; the routes enforce membership,
    //    schema validation, the creator-gate, and the publish gate — so authz is unchanged here) ──
    {
        name: 'aimeat_workspace_list',
        // The membership-gated discovery route aggregates the registry across ALL member identities and
        // resolves access by owner — a raw /v1/memory prefix read is caller-scoped, so a sub-agent (whose
        // identity ≠ the owner that wrote the registry) would see an empty list.
        handler: async ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const resp = await client.get(`/v1/organisms/${encodeURIComponent(orgId)}/workspaces`);
            if (!resp.ok) return resp;
            const workspaces = (resp.data as { workspaces?: unknown[] } | undefined)?.workspaces ?? [];
            return { ok: true, data: { organism_id: orgId, workspaces } };
        },
    },
    {
        name: 'aimeat_workspace_read',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace${query({ ws: requiredString(input, 'ws') })}`),
    },
    {
        name: 'aimeat_workspace_write',
        handler: async ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const ws = requiredString(input, 'ws');
            const space = requiredString(input, 'space');
            const wsResp = await client.get(`/v1/organisms/${encodeURIComponent(orgId)}/workspace${query({ ws })}`);
            if (!wsResp.ok) return wsResp;
            const ot = ((wsResp.data as { manifest?: { objectTypes?: { name: string; namespace?: string; mode?: string }[] } } | undefined)?.manifest?.objectTypes ?? []).find(o => o.name === space);
            if (!ot || !ot.namespace) return { ok: false, error: { code: 'NO_SPACE', message: `No space named "${space}" in this workspace.` } };
            const isDoc = ot.mode === 'document';
            const v0 = coerceObject(requiredValue(input, 'value'));
            let instanceId = optionalString(input, 'id') ?? (v0 && typeof v0 === 'object' && !Array.isArray(v0) ? String((v0 as JsonObject).id ?? '').trim() : '');
            if (!instanceId && isDoc) instanceId = genDocId();
            if (!instanceId) return { ok: false, error: { code: 'NO_ID', message: 'A records write needs an id (pass id, or include id in value).' } };
            const v = stampValue(v0, instanceId);
            const key = `${wsRoot(orgId, ws)}.${ot.namespace}.${instanceId}.draft`;
            const wr = await client.post('/v1/memory', { key, value: v, visibility: 'private' });
            if (!wr.ok) return wr;
            const section = optionalString(input, 'section');
            if (isDoc && section) {
                const secKey = `${wsRoot(orgId, ws)}.meta.sections.${ot.name}`;
                const secResp = await client.get(`/v1/memory${query({ prefix: secKey })}`);
                const sections = (secResp.data as { items?: { key: string; value?: { sections?: { id: string; name?: string; documents?: string[] }[] } }[] } | undefined)?.items?.find(i => i.key === secKey)?.value?.sections ?? [];
                const targetSec = sections.find(s => s.id === section || s.name === section);
                if (targetSec) { targetSec.documents = [...(targetSec.documents ?? []).filter(d => d !== instanceId), instanceId]; await client.post('/v1/memory', { key: secKey, value: { sections }, visibility: 'private' }); }
            }
            return { ok: true, data: { written: key, id: instanceId, space, mode: ot.mode ?? 'records', section: section ?? null } };
        },
    },
    {
        name: 'aimeat_workspace_publish',
        handler: ({ client }, input) => client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/publish`, {
            ws: requiredString(input, 'ws'), namespace: requiredString(input, 'namespace'), id: requiredString(input, 'id'),
        }),
    },
    {
        name: 'aimeat_workspace_update',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            if (typeof input.name === 'string') body.name = input.name;
            if (typeof input.readme === 'string') body.readme = input.readme;
            if (input.manifest !== undefined) body.manifest = coerceObject(input.manifest);
            if (input.schemas !== undefined) body.schemas = coerceObject(input.schemas);
            if (Object.keys(body).length === 0) throw new Error('Provide a name, readme, manifest and/or schemas.');
            return client.put(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace${query({ ws: requiredString(input, 'ws') })}`, body);
        },
    },
    {
        name: 'aimeat_workspace_create',
        handler: async ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const name = requiredString(input, 'name');
            const man = coerceObject(input.manifest) as JsonObject | undefined;
            if (!man || typeof man !== 'object' || !Array.isArray(man.objectTypes)) return { ok: false, error: { code: 'INVALID_MANIFEST', message: 'manifest must be an object with an objectTypes array.' } };
            const schemaMap = (coerceObject(input.schemas) ?? {}) as Record<string, Record<string, unknown>>;
            const wsId = genWsId();
            const base = wsRoot(orgId, wsId);
            const now = new Date().toISOString();
            // PUT schema is owner/operator-only — an agent token may lack permission, so failures are
            // reported (not fatal); the owner can lock schemas later, matching the appdev MCP behavior.
            const schemaResults: { namespace: string; locked: boolean; error?: string }[] = [];
            for (const [namespace, schema] of Object.entries(schemaMap)) {
                if (!schema || typeof schema !== 'object') continue;
                const r = await client.put(`/v1/memory/${encodeURIComponent(`${base}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'strict' });
                schemaResults.push({ namespace, locked: r.ok, ...(r.ok ? {} : { error: r.error?.message }) });
            }
            const manifestValue = { ...man, id: orgId, status: man.status || 'active' };
            const mr = await client.post('/v1/memory', { key: `${base}.meta.manifest`, value: manifestValue, visibility: 'private' });
            if (!mr.ok) return mr;
            const summary = man.summary;
            const readme = optionalString(input, 'readme');
            await client.post('/v1/memory', { key: `${base}.meta.readme`, value: readme || `# ${String(man.name || name)}\n\n${typeof summary === 'string' ? summary : ''}`, visibility: 'private' });
            const regKey = `organism.${orgId}.meta.workspaces`;
            const regResp = await client.get(`/v1/memory${query({ prefix: regKey })}`);
            const workspaces = ((regResp.data as { items?: { key: string; value?: { workspaces?: unknown[] } }[] } | undefined)?.items?.find(i => i.key === regKey)?.value?.workspaces) ?? [];
            await client.post('/v1/memory', { key: regKey, value: { workspaces: [...workspaces, { id: wsId, name: String(name || 'Workspace').trim() || 'Workspace', createdAt: now }] }, visibility: 'private' });
            return { ok: true, data: { created: true, ws: wsId, types: (man.objectTypes as { name: string }[]).map(o => o.name), schemas: schemaResults } };
        },
    },
    {
        name: 'aimeat_workspace_object_delete',
        handler: async ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const ws = requiredString(input, 'ws');
            const namespace = requiredString(input, 'namespace');
            const id = requiredString(input, 'id');
            const base = `${wsRoot(orgId, ws)}.${namespace}.${id}`;
            const listed = await client.get(`/v1/memory${query({ prefix: base + '.' })}`);
            if (!listed.ok) return listed;
            const items = (listed.data as { items?: { key: string }[] } | undefined)?.items ?? [];
            let deleted = 0;
            for (const it of items) {
                const role = it.key.slice(base.length + 1);
                if (role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role)) {
                    const dr = await client.delete(`/v1/memory/${encodeURIComponent(it.key)}`);
                    if (dr.ok) deleted++;
                }
            }
            if (deleted === 0) return { ok: false, error: { code: 'NOT_FOUND', message: `Nothing to delete at ${base} (no draft/latest/version).` } };
            // Best-effort: unfile the id from the document section tree (find the type by namespace).
            const wsResp = await client.get(`/v1/organisms/${encodeURIComponent(orgId)}/workspace${query({ ws })}`);
            const ot = ((wsResp.data as { manifest?: { objectTypes?: { name: string; namespace?: string }[] } } | undefined)?.manifest?.objectTypes ?? []).find(o => o.namespace === namespace);
            if (ot) {
                const secKey = `${wsRoot(orgId, ws)}.meta.sections.${ot.name}`;
                const secResp = await client.get(`/v1/memory${query({ prefix: secKey })}`);
                const sections = (secResp.data as { items?: { key: string; value?: { sections?: { documents?: string[] }[] } }[] } | undefined)?.items?.find(i => i.key === secKey)?.value?.sections;
                if (sections) {
                    let changed = false;
                    for (const s of sections) { if ((s.documents ?? []).includes(id)) { s.documents = (s.documents ?? []).filter(d => d !== id); changed = true; } }
                    if (changed) await client.post('/v1/memory', { key: secKey, value: { sections }, visibility: 'private' });
                }
            }
            return { ok: true, data: { deleted: base, keys: deleted } };
        },
    },
    {
        name: 'aimeat_workspace_access',
        handler: ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const ws = requiredString(input, 'ws');
            const action = requiredString(input, 'action');
            const orgPath = `/v1/organisms/${encodeURIComponent(orgId)}/workspace-access`;
            if (action === 'list') return client.get(`${orgPath}${query({ ws })}`);
            if (action === 'decide') {
                const requester = optionalString(input, 'requester');
                if (!requester) throw new Error("action='decide' needs a requester.");
                return client.post(`${orgPath}/decision`, { ws, requester, decision: optionalString(input, 'decision') === 'deny' ? 'deny' : 'approve' });
            }
            if (action === 'request') {
                const body: JsonObject = { ws };
                const message = optionalString(input, 'message'); if (message != null) body.message = message;
                return client.post(orgPath, body);
            }
            throw new Error("action must be 'request', 'list' or 'decide'.");
        },
    },
    {
        name: 'aimeat_workspace_transfer',
        handler: ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const direction = requiredString(input, 'direction');
            if (direction === 'export') return client.get(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/export${query({ ws: requiredString(input, 'ws'), format: 'base64' })}`);
            if (direction === 'import') return client.post(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/import`, { zip_base64: requiredString(input, 'zip_base64') });
            throw new Error("direction must be 'export' or 'import'.");
        },
    },
    {
        name: 'aimeat_wallet_transactions',
        handler: ({ client }, input) => client.get(`/v1/wallet/transactions${query({ limit: optionalNumber(input, 'limit') })}`),
    },
    {
        name: 'aimeat_app_publish',
        description: 'Publish an app package.',
        input: {
            name: { type: 'string', required: true, description: 'App name.' },
            description: { type: 'string', required: true, description: 'App description.' },
            content: { type: 'string', required: true, description: 'App content.' },
        },
        handler: ({ client }, input) => client.post('/v1/packages', {
            name: requiredString(input, 'name'),
            description: requiredString(input, 'description'),
            content: requiredString(input, 'content'),
        }),
    },
    {
        name: 'aimeat_app_list',
        description: 'List available apps.',
        input: { query: { type: 'string', description: 'Search query.' } },
        handler: ({ client }, input) => client.get(`/v1/packages${query({ q: optionalString(input, 'query') })}`),
    },
    {
        name: 'aimeat_app_get',
        description: 'Get app detail by group ID.',
        input: { group_id: { type: 'string', required: true, description: 'App group identifier.' } },
        handler: ({ client }, input) => client.get(`/v1/packages/${encodeURIComponent(requiredString(input, 'group_id'))}`),
    },
    {
        name: 'aimeat_app_delete',
        description: 'Archive an app version.',
        input: {
            group_id: { type: 'string', required: true, description: 'App group identifier.' },
            version: { type: 'string', required: true, description: 'Version to archive.' },
        },
        handler: ({ client }, input) => client.delete(`/v1/packages/${encodeURIComponent(requiredString(input, 'group_id'))}/versions/${encodeURIComponent(requiredString(input, 'version'))}`),
    },
    {
        name: 'aimeat_app_versions',
        description: 'List app version history.',
        input: { group_id: { type: 'string', required: true, description: 'App group identifier.' } },
        handler: ({ client }, input) => client.get(`/v1/packages/${encodeURIComponent(requiredString(input, 'group_id'))}/versions`),
    },
    {
        name: 'aimeat_extension_list',
        description: 'List installed extensions.',
        input: {},
        handler: ({ client }) => client.get('/v1/extensions'),
    },
    {
        name: 'aimeat_extension_invoke',
        description: 'Invoke an extension action.',
        input: {
            name: { type: 'string', required: true, description: 'Extension name.' },
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            input: { type: 'object', description: 'Input parameters.' },
        },
        handler: ({ client }, input) => client.post(
            `/v1/ext/${encodeURIComponent(requiredString(input, 'name'))}/${encodeURIComponent(requiredString(input, 'action_id'))}`,
            optionalRecord(input, 'input') ?? {},
        ),
    },
    {
        name: 'aimeat_extension_install',
        description: 'Install an extension from a manifest.',
        input: {
            name: { type: 'string', required: true, description: 'Extension name.' },
            manifest: { type: 'object', required: true, description: 'Extension manifest object.' },
        },
        handler: ({ client }, input) => client.post('/v1/extensions', {
            name: requiredString(input, 'name'),
            manifest: requiredRecord(input, 'manifest'),
        }),
    },
    {
        name: 'aimeat_extension_activate',
        description: 'Activate an installed extension.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.post(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}/activate`),
    },
    {
        name: 'aimeat_extension_deactivate',
        description: 'Deactivate an extension.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.post(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}/deactivate`),
    },
    {
        name: 'aimeat_extension_delete',
        description: 'Uninstall an extension.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.delete(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}`),
    },
    {
        name: 'aimeat_extension_get',
        description: 'Get extension details.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.get(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}`),
    },
    {
        name: 'aimeat_cortex_list',
        description: 'List installed cortex models.',
        input: {},
        handler: ({ client }) => client.get('/v1/cortex'),
    },
    {
        name: 'aimeat_cortex_install',
        description: 'Install a cortex model from a manifest.',
        input: {
            name: { type: 'string', required: true, description: 'Cortex name.' },
            manifest: { type: 'object', required: true, description: 'Cortex manifest object.' },
        },
        handler: ({ client }, input) => client.post('/v1/cortex', {
            name: requiredString(input, 'name'),
            manifest: requiredRecord(input, 'manifest'),
        }),
    },
    {
        name: 'aimeat_cortex_activate',
        description: 'Activate a cortex model.',
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
        handler: ({ client }, input) => client.post(`/v1/cortex/${encodeURIComponent(requiredString(input, 'name'))}/activate`),
    },
    {
        name: 'aimeat_cortex_deactivate',
        description: 'Deactivate a cortex model.',
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
        handler: ({ client }, input) => client.post(`/v1/cortex/${encodeURIComponent(requiredString(input, 'name'))}/deactivate`),
    },
    {
        name: 'aimeat_cortex_delete',
        description: 'Delete a cortex model.',
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
        handler: ({ client }, input) => client.delete(`/v1/cortex/${encodeURIComponent(requiredString(input, 'name'))}`),
    },
];

function getTool(name: string): ConnectCliToolDefinition | undefined {
    return CONNECT_CLI_TOOLS.find(tool => tool.name === name);
}

function getCliToolMetadata(name: string) {
    const definition = getAimeatToolDefinition(name);
    return definition?.visibility.cliFallback ? definition : undefined;
}

function printJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
}

function loadJsonSource(flags: Record<string, string>): string | null {
    if (flags.stdin === 'true') return null;
    const source = flags.json ?? flags.data;
    if (!source || source === 'true') return '{}';
    const trimmed = source.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
    if (!existsSync(source)) throw new Error(`Input JSON file not found: ${source}`);
    return readFileSync(source, 'utf-8');
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
}

function expandFileReferences(value: unknown): unknown {
    if (typeof value === 'string' && value.startsWith('@file:')) {
        return readFileSync(value.slice('@file:'.length), 'utf-8');
    }
    if (Array.isArray(value)) return value.map(item => expandFileReferences(item));
    if (typeof value === 'object' && value !== null) {
        const expanded: JsonObject = {};
        for (const [key, child] of Object.entries(value)) expanded[key] = expandFileReferences(child);
        return expanded;
    }
    return value;
}

async function readInput(flags: Record<string, string>): Promise<JsonObject> {
    const raw = flags.stdin === 'true' ? await readStdin() : loadJsonSource(flags);
    const trimmed = raw?.trim() ?? '{}';
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Tool input must be a JSON object.');
    }
    return expandFileReferences(parsed) as JsonObject;
}

export function runToolList(flags: Record<string, string>): void {
    const tools = CLI_FALLBACK_TOOL_DEFINITIONS
        .filter(tool => tool.visibility.cliFallback)
        .map(tool => ({ name: tool.name, description: tool.description }));
    if (flags.json === 'true') {
        printJson({ tools });
        return;
    }
    for (const tool of tools) console.log(`${tool.name}\n  ${tool.description}`);
}

export function runToolSchema(toolName: string | undefined): void {
    if (!toolName) {
        console.error('Usage: aimeat connect schema <tool-name>');
        process.exitCode = 1;
        return;
    }
    const tool = getCliToolMetadata(toolName);
    if (!tool || !getTool(toolName)) {
        console.error(`Unknown CLI-callable tool: ${toolName}`);
        process.exitCode = 1;
        return;
    }
    printJson(tool);
}

export async function runToolCall(toolName: string | undefined, flags: Record<string, string>): Promise<void> {
    if (!toolName) {
        console.error('Usage: aimeat connect call <tool-name> --json input.json');
        process.exitCode = 1;
        return;
    }
    const tool = getTool(toolName);
    const metadata = getCliToolMetadata(toolName);
    if (!tool || !metadata) {
        console.error(`Unknown CLI-callable tool: ${toolName}`);
        process.exitCode = 1;
        return;
    }

    try {
        // Per-agent selection: if --agent is passed, route the call through THAT agent's
        // token + node URL. Without --agent, fall back to the global "primary" config
        // for backward compatibility with single-agent installs. Without this, every
        // `connect call --agent foo` silently used the primary's token and the primary's
        // agent name in the REST path -- so a multi-agent install could not target a
        // specific agent at all (the call always ran as the primary).
        let agentName: string;
        let owner: string;
        let client: AimeatClient;
        let config: AimeatConnectConfig | { agent: string; owner: string; node_url: string };

        if (flags.agent) {
            const loaded = await loadAgentByName(flags.agent, flags.owner || undefined);
            if (!loaded) {
                throw new Error(`Agent "${flags.agent}" not found in connector. Run: aimeat connect list`);
            }
            agentName = loaded.agent;
            owner = loaded.owner;
            client = new Client(loaded.config.node_url, loaded.token);
            config = { agent: loaded.agent, owner: loaded.owner, node_url: loaded.config.node_url };
        } else {
            const cfg = loadConfig();
            if (!cfg) throw new Error('Not configured. Run: npx aimeat connect');
            agentName = cfg.agent;
            owner = cfg.owner;
            client = await Client.fromConfig();
            config = cfg;
        }

        void owner; // reserved for future per-tool authorization checks
        const input = await readInput(flags);
        const response = await tool.handler({ client, config, agentPath: encodeURIComponent(agentName) }, input);
        if (!response.ok) {
            console.error(JSON.stringify(response.error ?? response, null, 2));
            process.exitCode = 1;
            return;
        }
        printJson(response.data ?? response);
    } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
    }
}