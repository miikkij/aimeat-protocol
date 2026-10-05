/**
 * @file src/tool-catalog/definitions/agent-v2.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The A2A v2 message, push and task tools.
 *   Moved unchanged out of agent-messaging.ts, which would have passed its 800 lines when its definitions took
 *   their exact schemas, annotations, scopes and surfaces (secaudit 2026-10, M3). Spread back in place there,
 *   so the catalog order is what it was.
 * @usage imported by ./agent-messaging.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — Extracted from agent-messaging.ts (pure extraction; no behavior change).
 */
import { partsSchema } from '../input-schemas.js';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const agentV2Tools = [
    // -- Agent v2 messaging: a turn between two principals of one account --
    //
    // Distinct from every messaging tool above it, and deliberately so. aimeat_message_* is this
    // agent and ITS OWN OWNER in a dashboard thread; aimeat_dm_* is a person reaching another
    // person across the federation. These carry a turn between two PRINCIPALS about one piece of
    // work -- my agent and my editor -- with text, a file and a structured payload in the same
    // turn. The three above keep working exactly as they did.
    {
        name: 'aimeat_v2_message_send',
        description: 'Send one turn to another principal on this same account: an agent, an ecosystem app, or the owner. A turn carries an ordered list of parts, so one send can say something, point at a file and hand over a structured payload together. Group turns with context_id: pass the same one to continue an exchange, omit it to start a new one and the answer tells you the id it got. The recipient hears about it on its tunnel if it is connected and on its registered delivery target if it is not, and can always read it back with aimeat_v2_message_list whatever happened. To reach a PERSON, use aimeat_dm_send; to reach your own owner in the dashboard thread, aimeat_message_send.',
        caller: 'agent',
        visibility: agentEverywhere,
        // Not openWorld: every one of these stays inside the account. The delivery target is the one
        // thing that reaches outward, and it is a configuration, not a call — the outbound POST happens
        // later, from the node, and goes through safeFetch.
        annotations: { title: 'Send a Turn', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // Agent v2 messaging. Same words as the doors behind them, and the same words the DM tools take:
        // sending on this account's behalf is one permission however the turn is shaped. Registering a
        // delivery target rides agent:write, not a messaging word, because it configures a PRINCIPAL and
        // what it configures is where this node makes an outbound call carrying a secret — the same
        // class of act as setting an agent's webhook.
        scope: 'messages:send',
        // On `agent`: A turn between two principals of ONE account, beside the owner thread and the federated
        // DM above it rather than instead of either. Agent surface only: the service surface carries
        // no messaging at all, and the primitives surface reaches these through aimeat_invoke.
        surfaces: ['agent'],
        input: {
            to: { type: 'string', required: true, description: 'The recipient principal on this account: an agent GAII (claude#alice@node), an ecosystem app (eco:drum#alice@node) or the owner GHII (alice@node).' },
            parts: { type: 'array', required: true, description: 'Ordered parts. Each is {kind:"text",text} or {kind:"file",file:{uri,name?,mimeType?}} or {kind:"data",data:{...}}. A file part carries a URI, never bytes.', zod: partsSchema },
            role: { type: 'string', enum: ['user', 'agent'], description: 'Send "user" if you are asking and "agent" if you are answering. Default "user". It is not a principal type.' },
            context_id: { type: 'string', description: 'The exchange this turn belongs to. Omit on the first turn.' },
            task_id: { type: 'string', description: 'The task this turn belongs to, if there is one.' },
            metadata: { type: 'object', description: 'Anything you want carried along. Never read by the node.' },
        },
    },
    {
        name: 'aimeat_v2_message_list',
        description: 'Read turns back, oldest first. Narrow by context_id for one exchange, by task_id for the turns of one task, by to/from for one party, or by since (an ISO timestamp) for everything that arrived while you were away, which is how a principal catches up after being offline. Reads only this account\'s turns.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Turns', readOnlyHint: true },
        scope: 'messages:read',
        surfaces: ['agent'],
        supportsResponseFormat: true,
        conciseFields: ['messageId', 'role', 'from', 'to', 'createdAt'],
        concisePath: 'messages',
        input: {
            context_id: { type: 'string', description: 'One exchange.' },
            task_id: { type: 'string', description: 'The turns of one task.' },
            to: { type: 'string', description: 'Turns addressed to this principal.' },
            from: { type: 'string', description: 'Turns sent by this principal.' },
            since: { type: 'string', description: 'ISO timestamp, exclusive: turns created after it.' },
            limit: { type: 'number', description: 'Max turns to return (default 50, max 200).' },
        },
    },
    {
        name: 'aimeat_v2_push_set',
        description: 'Register where to reach you when you are not connected: an https address this node POSTs a turn to. Optionally a token it echoes back so you can tell the POST came from a target you registered, and an authentication block ({schemes:["Bearer"],credentials:"..."}) whose credentials this node sends in the Authorization header and never returns to anyone, including you. Pass the id of a target you already registered to replace it; omit id for a new one. The account holder may register a target for another principal by naming it in principal.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Register a Delivery Target', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'agent:write',
        surfaces: ['agent'],
        input: {
            url: { type: 'string', required: true, description: 'The https address to POST a turn to.' },
            token: { type: 'string', description: 'An opaque string echoed back inside every delivery.' },
            authentication: { type: 'object', description: 'A block shaped { schemes: ["Bearer"], credentials: "..." }. The credentials are stored and sent, never returned.' },
            id: { type: 'string', description: 'Replace this existing target. It must be one already registered on this account.' },
            principal: { type: 'string', description: 'Whose deliveries these are. Defaults to you; naming another principal is for the account holder.' },
        },
    },
    {
        name: 'aimeat_v2_push_list',
        description: 'What delivery targets are registered: their addresses, tokens, authentication schemes, and whether the node has been able to reach them. The stored credentials are never returned. An agent sees its own targets; the account holder sees every target on the account, or one principal\'s by naming it.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Delivery Targets', readOnlyHint: true },
        scope: 'messages:read',
        surfaces: ['agent'],
        input: {
            principal: { type: 'string', description: 'Account holder only: whose targets to list. Omit for all of them.' },
        },
    },
    {
        name: 'aimeat_v2_push_delete',
        description: 'Stop delivering to one registered target. An agent may delete its own; the account holder may delete any target on the account.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Remove a Delivery Target', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'agent:write',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'The target id, from aimeat_v2_push_list.' },
        },
    },

    // -- Agent v2 tasks: the handle a caller holds while work runs --
    //
    // Not the dashboard work item above (aimeat_task_*), which has a title, todos, an approval step
    // and an SLA and is not going anywhere. This is MCP's task shape, which A2A also reads: a
    // taskId, five statuses, a poll interval. The status word stored is always the MCP one and the
    // A2A state is derived beside it, because `cancelled` and `canceled` differ by one letter.
    {
        name: 'aimeat_v2_task_create',
        description: 'Ask another principal on this account to do something, and get back a handle you poll. This is the MCP task shape: a taskId, a status that is one of working / input_required / completed / failed / cancelled, and a poll interval. Distinct from aimeat_task_create, which makes the owner an item in their dashboard with a title, todos and an approval step; this one is the handle a long call runs behind. Group it with a conversation by passing the same context_id you use for turns.',
        caller: 'agent',
        visibility: agentEverywhere,
        // -- Agent v2 tasks (the polling handle, not the dashboard work item) --
        // Cancelling is destructive in the sense that matters here: it ends the work, and it cannot be
        // undone because a terminal task never moves again.
        annotations: { title: 'Ask For Work', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // Agent v2 tasks ride task:write, the word the existing task routes take. Creating work,
        // reporting on it and cancelling it are one authority over work on this account; the reads are
        // ungated for the same reason the existing task reads are.
        scope: 'task:write',
        surfaces: ['agent'],
        input: {
            assigned_to: { type: 'string', required: true, description: 'The principal that is to do this: an agent GAII, an ecosystem app, or the owner GHII.' },
            input: { type: 'array', required: true, description: 'What is being asked, as parts: {kind:"text",text} or {kind:"file",file:{uri}} or {kind:"data",data:{...}}. The same shape a turn carries.', zod: partsSchema },
            context_id: { type: 'string', description: 'The exchange this work belongs to. Omit and the task names itself.' },
            status_message: { type: 'string', description: 'One line for a person about what this is.' },
            ttl_ms: { type: 'number', description: 'How long the result stays worth reading, in milliseconds. Advice, not a deletion.' },
            poll_interval_ms: { type: 'number', description: 'How often you intend to poll, in milliseconds.' },
            metadata: { type: 'object', description: 'Carried along, never read by the node.' },
        },
    },
    {
        name: 'aimeat_v2_task_list',
        description: 'The task roster, newest first. Narrow by assigned_to for what a worker has been given, created_by for what you asked for, context_id for one conversation, or status for what is still open. An unrecognised status is refused rather than ignored, because a filter that does not filter returns everything and reads as a working query.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Tasks', readOnlyHint: true },
        surfaces: ['agent'],
        supportsResponseFormat: true,
        conciseFields: ['taskId', 'status', 'assignedTo', 'createdBy', 'lastUpdatedAt'],
        concisePath: 'tasks',
        input: {
            assigned_to: { type: 'string', description: 'Tasks given to this principal.' },
            created_by: { type: 'string', description: 'Tasks this principal asked for.' },
            context_id: { type: 'string', description: 'Tasks in one exchange.' },
            status: { type: 'string', description: 'One status or a comma-separated list: working, input_required, completed, failed, cancelled.' },
            limit: { type: 'number', description: 'Max tasks to return (default 50, max 200).' },
        },
    },
    {
        name: 'aimeat_v2_task_get',
        description: 'One task, with everything a poll needs: its MCP status, whether that status is terminal, the A2A state the same task reports on that protocol, the result if it completed and the error if it did not. A terminal task never changes again, so the first settled read you see is the last one you need.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read One Task', readOnlyHint: true },
        surfaces: ['agent'],
        input: {
            task_id: { type: 'string', required: true, description: 'The task id.' },
        },
    },
    {
        name: 'aimeat_v2_task_status',
        description: 'Report where you have got to with work you were given. Only the assignee and the account holder may: a task\'s status is the worker\'s testimony about the work, so whoever asked for it cannot write it. Completing requires a result, failing requires a code and a message, and a task that has already settled refuses to move. To stop work you asked for, cancel it instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Report Task Status', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'task:write',
        surfaces: ['agent'],
        input: {
            task_id: { type: 'string', required: true, description: 'The task id.' },
            status: { type: 'string', enum: ['working', 'input_required', 'completed', 'failed'], required: true, description: 'Where it has got to.' },
            status_message: { type: 'string', description: 'One line for a person.' },
            result: { type: 'array', description: 'What came back, as parts. Required when completing.', zod: partsSchema },
            error: { type: 'object', description: '{ code, message }. Required when failing.' },
            ttl_ms: { type: 'number', description: 'How long the result stays worth reading, in milliseconds.' },
            poll_interval_ms: { type: 'number', description: 'How often the caller should poll from here, in milliseconds.' },
        },
    },
    {
        name: 'aimeat_v2_task_cancel',
        description: 'Stop work you asked for. Only whoever created the task and the account holder may: a worker that will not do the work reports it failed with a reason, which is a different thing and is recorded as one. A task that has already settled refuses to move.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Cancel Work', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'task:write',
        surfaces: ['agent'],
        input: {
            task_id: { type: 'string', required: true, description: 'The task id.' },
            reason: { type: 'string', description: 'Why, in one line.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
