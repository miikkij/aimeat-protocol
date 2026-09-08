/**
 * @file cli/connect/tool-call-defs-agent-v2.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The v2 AGENT-PLANE half of the shell / local-call dispatch: the message doors, the
 *   push subscriptions and the task lifecycle that MCP's own task shape and A2A's states are read
 *   from.
 *
 *   These sixteen are a set: every one of them speaks the v2 agent plane, principal to principal on
 *   one account, rather than the agent-to-owner doors beside them. Extracted from
 *   tool-call-defs-agent.ts unchanged when aimeat_agent_propose pushed that file past the 800-line
 *   ceiling. A pure move: same definitions, same handlers, same comments, spread into agentTools
 *   beside the table they came from.
 * @structure agentV2CliTools[] — the handler table, spread by tool-call-defs-agent.ts
 * @usage import { agentV2CliTools } from './tool-call-defs-agent-v2.js';
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Extracted from tool-call-defs-agent.ts (max-file-lines).
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { optionalString, requiredString, optionalArray, optionalRecord, optionalNumber } from './tool-call-helpers.js';

export const agentV2CliTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_v2_message_send',
        description: 'Send one turn to another principal on this same account, carrying text, a file pointer and a structured payload together. Distinct from aimeat_message_send (this agent and its own owner) and aimeat_dm_send (a person reaching a person).',
        input: {
            to: { type: 'string', required: true, description: 'The recipient principal on this account: an agent GAII, an ecosystem app, or the owner GHII.' },
            parts: { type: 'array', required: true, description: 'Ordered parts. Each is {kind:"text",text} or {kind:"file",file:{uri,name?,mimeType?}} or {kind:"data",data:{...}}.' },
            role: { type: 'string', description: 'Send "user" if you are asking and "agent" if you are answering. Default "user".' },
            context_id: { type: 'string', description: 'The exchange this turn belongs to. Omit on the first turn.' },
            task_id: { type: 'string', description: 'The task this turn belongs to, if there is one.' },
            metadata: { type: 'object', description: 'Carried along, never read by the node.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = {
                to: requiredString(input, 'to'),
                parts: optionalArray(input, 'parts') ?? [],
            };
            const role = optionalString(input, 'role'); if (role) body.role = role;
            const contextId = optionalString(input, 'context_id'); if (contextId) body.contextId = contextId;
            const taskId = optionalString(input, 'task_id'); if (taskId) body.taskId = taskId;
            const metadata = optionalRecord(input, 'metadata'); if (metadata) body.metadata = metadata;
            return client.post('/v1/agents/v2/messages', body);
        },
    },
    {
        name: 'aimeat_v2_message_list',
        description: 'Read turns back, oldest first. `since` is how a principal catches up on everything that arrived while it was offline.',
        input: {
            context_id: { type: 'string', description: 'One exchange.' },
            task_id: { type: 'string', description: 'The turns of one task.' },
            to: { type: 'string', description: 'Turns addressed to this principal.' },
            from: { type: 'string', description: 'Turns sent by this principal.' },
            since: { type: 'string', description: 'ISO timestamp, exclusive: turns created after it.' },
            limit: { type: 'number', description: 'Max turns to return (default 50, max 200).' },
        },
        handler: ({ client }, input) => {
            const q = new URLSearchParams();
            const contextId = optionalString(input, 'context_id'); if (contextId) q.set('context_id', contextId);
            const taskId = optionalString(input, 'task_id'); if (taskId) q.set('task_id', taskId);
            const to = optionalString(input, 'to'); if (to) q.set('to', to);
            const from = optionalString(input, 'from'); if (from) q.set('from', from);
            const since = optionalString(input, 'since'); if (since) q.set('since', since);
            const limit = optionalNumber(input, 'limit'); if (typeof limit === 'number') q.set('limit', String(limit));
            const qs = q.toString() ? `?${q.toString()}` : '';
            return client.get(`/v1/agents/v2/messages${qs}`);
        },
    },
    {
        name: 'aimeat_v2_push_set',
        description: 'Register where to reach you when you are not connected: an https address this node POSTs a turn to. The credentials inside `authentication` are stored and sent in the Authorization header, and never returned to anyone.',
        input: {
            url: { type: 'string', required: true, description: 'The https address to POST a turn to.' },
            token: { type: 'string', description: 'An opaque string echoed back inside every delivery.' },
            authentication: { type: 'object', description: 'A block shaped { schemes: ["Bearer"], credentials: "..." }.' },
            id: { type: 'string', description: 'Replace this existing target. It must be one already registered on this account.' },
            principal: { type: 'string', description: 'Whose deliveries these are. Defaults to you.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = { url: requiredString(input, 'url') };
            const token = optionalString(input, 'token'); if (token) body.token = token;
            const auth = optionalRecord(input, 'authentication'); if (auth) body.authentication = auth;
            const id = optionalString(input, 'id'); if (id) body.id = id;
            const principal = optionalString(input, 'principal'); if (principal) body.principal = principal;
            return client.put('/v1/agents/v2/push-config', body);
        },
    },
    {
        name: 'aimeat_v2_push_list',
        description: 'What delivery targets are registered, and whether the node has been able to reach them. The stored credentials are never returned.',
        input: {
            principal: { type: 'string', description: 'Account holder only: whose targets to list. Omit for all of them.' },
        },
        handler: ({ client }, input) => {
            const principal = optionalString(input, 'principal');
            return client.get(`/v1/agents/v2/push-config${principal ? `?principal=${encodeURIComponent(principal)}` : ''}`);
        },
    },
    {
        name: 'aimeat_v2_push_delete',
        description: 'Stop delivering to one registered target.',
        input: {
            id: { type: 'string', required: true, description: 'The target id, from aimeat_v2_push_list.' },
        },
        handler: ({ client }, input) => client.delete(`/v1/agents/v2/push-config/${encodeURIComponent(requiredString(input, 'id'))}`),
    },

    // ── Agent v2 tasks: the handle a caller holds while work runs ──
    //
    // The fleet-daemon door. Every parameter here is proved to leave the process by
    // test/unit/cli-tool-param-forwarding.test.ts, and the dispatch refuses one it does not declare.
    {
        name: 'aimeat_v2_task_create',
        description: 'Ask another principal on this account to do something, and get back a handle you poll. MCP task shape; distinct from aimeat_task_create, which is the owner dashboard work item.',
        input: {
            assigned_to: { type: 'string', required: true, description: 'The principal that is to do this.' },
            input: { type: 'array', required: true, description: 'What is being asked, as parts.' },
            context_id: { type: 'string', description: 'The exchange this work belongs to.' },
            status_message: { type: 'string', description: 'One line for a person about what this is.' },
            ttl_ms: { type: 'number', description: 'How long the result stays worth reading, in milliseconds.' },
            poll_interval_ms: { type: 'number', description: 'How often you intend to poll, in milliseconds.' },
            metadata: { type: 'object', description: 'Carried along, never read by the node.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = {
                assignedTo: requiredString(input, 'assigned_to'),
                input: optionalArray(input, 'input') ?? [],
            };
            const contextId = optionalString(input, 'context_id'); if (contextId) body.contextId = contextId;
            const statusMessage = optionalString(input, 'status_message'); if (statusMessage) body.statusMessage = statusMessage;
            const ttlMs = optionalNumber(input, 'ttl_ms'); if (typeof ttlMs === 'number') body.ttlMs = ttlMs;
            const pollMs = optionalNumber(input, 'poll_interval_ms'); if (typeof pollMs === 'number') body.pollIntervalMs = pollMs;
            const metadata = optionalRecord(input, 'metadata'); if (metadata) body.metadata = metadata;
            return client.post('/v1/agents/v2/tasks', body);
        },
    },
    {
        name: 'aimeat_v2_task_list',
        description: 'The task roster, newest first. An unrecognised status is refused rather than ignored.',
        input: {
            assigned_to: { type: 'string', description: 'Tasks given to this principal.' },
            created_by: { type: 'string', description: 'Tasks this principal asked for.' },
            context_id: { type: 'string', description: 'Tasks in one exchange.' },
            status: { type: 'string', description: 'One status or a comma-separated list.' },
            limit: { type: 'number', description: 'Max tasks to return (default 50, max 200).' },
        },
        handler: ({ client }, input) => {
            const q = new URLSearchParams();
            const assignedTo = optionalString(input, 'assigned_to'); if (assignedTo) q.set('assigned_to', assignedTo);
            const createdBy = optionalString(input, 'created_by'); if (createdBy) q.set('created_by', createdBy);
            const contextId = optionalString(input, 'context_id'); if (contextId) q.set('context_id', contextId);
            const status = optionalString(input, 'status'); if (status) q.set('status', status);
            const limit = optionalNumber(input, 'limit'); if (typeof limit === 'number') q.set('limit', String(limit));
            const qs = q.toString() ? `?${q.toString()}` : '';
            return client.get(`/v1/agents/v2/tasks${qs}`);
        },
    },
    {
        name: 'aimeat_v2_task_get',
        description: 'One task, with its MCP status, whether that status is terminal, and the A2A state the same task reports on that protocol.',
        input: {
            task_id: { type: 'string', required: true, description: 'The task id.' },
        },
        handler: ({ client }, input) => client.get(`/v1/agents/v2/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}`),
    },
    {
        name: 'aimeat_v2_task_status',
        description: 'Report where you have got to with work you were given. Only the assignee and the account holder may.',
        input: {
            task_id: { type: 'string', required: true, description: 'The task id.' },
            status: { type: 'string', required: true, description: 'working, input_required, completed or failed.' },
            status_message: { type: 'string', description: 'One line for a person.' },
            result: { type: 'array', description: 'What came back, as parts. Required when completing.' },
            error: { type: 'object', description: '{ code, message }. Required when failing.' },
            ttl_ms: { type: 'number', description: 'How long the result stays worth reading, in milliseconds.' },
            poll_interval_ms: { type: 'number', description: 'How often the caller should poll from here.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = { status: requiredString(input, 'status') };
            const statusMessage = optionalString(input, 'status_message'); if (statusMessage) body.statusMessage = statusMessage;
            const result = optionalArray(input, 'result'); if (result) body.result = result;
            const err = optionalRecord(input, 'error'); if (err) body.error = err;
            const ttlMs = optionalNumber(input, 'ttl_ms'); if (typeof ttlMs === 'number') body.ttlMs = ttlMs;
            const pollMs = optionalNumber(input, 'poll_interval_ms'); if (typeof pollMs === 'number') body.pollIntervalMs = pollMs;
            return client.post(`/v1/agents/v2/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}/status`, body);
        },
    },
    {
        name: 'aimeat_v2_task_cancel',
        description: 'Stop work you asked for. Only whoever created the task and the account holder may; a worker that will not do it reports it failed with a reason.',
        input: {
            task_id: { type: 'string', required: true, description: 'The task id.' },
            reason: { type: 'string', description: 'Why, in one line.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const reason = optionalString(input, 'reason'); if (reason) body.reason = reason;
            return client.post(`/v1/agents/v2/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}/cancel`, body);
        },
    },
];
