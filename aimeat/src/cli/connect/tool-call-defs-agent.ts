/**
 * @file cli/connect/tool-call-defs-agent.ts
 * @description Onboarding, agent, message, DM and task connect-call tool definitions. Extracted from cli/connect/tool-call.ts to satisfy max-file-lines.
 * @version-history
 *   v1.4.0 -- 2026-08-14 -- aimeat_task_create takes `scope` here too.
 *   v1.3.0 -- 2026-08-13 -- Add the aimeat_agent_console_set handler (PATCH
 *     /v1/agents/:name/console-url).
 *   v1.2.0 -- 2026-07-19 -- Add shell handlers for operator_agent_configure + operator_ai_config so an
 *     operator-privileged principal can configure the system via `aimeat connect call`. Direct-apply
 *     through the per-field routes (PATCH /v1/agents/:name/{mode,tags,scopes}, POST /v1/ai/settings);
 *     scopes is requireRole('owner') which the role hierarchy also admits operators — a plain agent 403s.
 *   v1.1.0 -- 2026-07-19 -- Connector reachability: shell handlers for message_history, dm_send_as_owner,
 *     — thin REST proxies (contacts stay connector-MCP-only, not cliFallback).
 *   v1.0.0 -- 2026-07-13 -- Extracted from tool-call.ts (max-file-lines)
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, optionalString, requiredString, optionalArray, optionalRecord, optionalNumber, taskTodoPayload } from './tool-call-helpers.js';

export const agentTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_handbook_get',
        description: 'Get the agent operating handbook or one handbook module.',
        input: {
            module: { type: 'string', description: 'Optional handbook module name, such as tasks or messages.' },
            surface: { type: 'string', description: 'Which surface the handbook is for. The catalog has published this since the surfaces split; this door read only `module`, so asking for one was the same as asking for none.' },
        },
        handler: ({ client }, input) => {
            const module = optionalString(input, 'module');
            const q = query({ surface: optionalString(input, 'surface') });
            return client.get(module ? `/v1/agents/me/handbook/${encodeURIComponent(module)}${q}` : `/v1/agents/me/handbook${q}`);
        },
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
            model: { type: 'string', description: 'Primary LLM model driving the agent (e.g. claude-haiku-4.5). Self-reported, indicative only.' },
        },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/onboarding/step/identify_platform`, {
            platform: requiredString(input, 'platform'),
            ...(optionalString(input, 'platform_version') ? { platform_version: optionalString(input, 'platform_version') } : {}),
            ...(optionalString(input, 'model') ? { model: optionalString(input, 'model') } : {}),
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
        // P3: the agent's OWN performance + per-context review rollups. Exposed as a connect-call tool
        // so a crew's periodic reputation rollup rides the existing tunnel (one loopback POST over the
        // open WS) instead of a direct node GET — removing the last periodic node call for an idle crew.
        name: 'aimeat_agent_statistics',
        description: "Get this agent's own performance + per-context review rollups (recomputed from its tasks).",
        input: {},
        handler: ({ client, agentPath }) => client.get(`/v1/agents/${agentPath}/statistics`),
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
        description: "Owner-only. Set an agent's operational mode. Modes: 'autonomous', 'interactive', 'task-runner' (reduced 7-step Hello Integration), 'coordinator', 'workstation' (node-visiting MCP agent, narrowest 4-step Hello Integration).",
        input: {
            target_agent_name: { type: 'string', description: 'Agent whose mode to update.' },
            mode: { type: 'string', enum: ['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation'], description: 'New mode.' },
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
        name: 'aimeat_agent_console_set',
        description: "Record where an agent is managed by whatever HOSTS it (its settings or brain page in the fleet runtime it runs in), so the owner's profile can link straight to it. Absolute http(s) URL; '' clears it.",
        input: {
            target_agent_name: { type: 'string', description: 'Agent whose console address to set.' },
            console_url: { type: 'string', description: "Absolute http(s) URL of that agent's page in its host, or '' to clear it." },
        },
        handler: ({ client }, input) => {
            const target = optionalString(input, 'target_agent_name');
            if (!target) throw new Error('target_agent_name is required');
            return client.patch(`/v1/agents/${encodeURIComponent(target)}/console-url`, {
                console_url: optionalString(input, 'console_url') ?? '',
            });
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
        // ── Federated direct messages (the inbox / "Postilaatikko"), distinct from the agent↔owner
        //    aimeat_message_* tools above. Thin REST wrappers so no-LLM crews can send/read DMs via
        //    `aimeat connect call` without an MCP client. Server-side scopes (messages:send/read) + the
        //    first-contact gate are unchanged. ──
        name: 'aimeat_dm_send',
        description: 'Send a federated direct message from this agent to any person (owner@node), agent (agent#owner@node) or app (eco:app#owner@node) on the network. Upload files first via aimeat_storage_upload, then pass storage keys in attachments.',
        input: {
            to: { type: 'string', required: true, description: 'Recipient: owner@node, agent#owner@node, or eco:app#owner@node.' },
            body: { type: 'string', description: 'Message body (markdown). Optional if attachments are given.' },
            reply_to: { type: 'string', description: 'Id of a message you are replying to (keeps the thread).' },
            subject: { type: 'string', description: 'Open a NEW topic thread with this title.' },
            conversation_id: { type: 'string', description: 'Continue a specific existing thread by id.' },
            attachments: { type: 'array', description: 'Up to 20 { storage_key, mime, kind, size, name } descriptors.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = { to: requiredString(input, 'to') };
            const text = optionalString(input, 'body'); if (text) body.body = text;
            const replyTo = optionalString(input, 'reply_to'); if (replyTo) body.reply_to = replyTo;
            const subject = optionalString(input, 'subject'); if (subject) body.subject = subject;
            const conversationId = optionalString(input, 'conversation_id'); if (conversationId) body.conversation_id = conversationId;
            const attachments = optionalArray(input, 'attachments'); if (attachments) body.attachments = attachments;
            return client.post('/v1/messages', body);
        },
    },
    {
        name: 'aimeat_dm_ask',
        handler: ({ client }, input) => {
            const questions = optionalArray(input, 'questions');
            if (!questions) throw new Error('Missing required array field: questions');
            const submitLabel = optionalString(input, 'submit_label');
            const body: JsonObject = {
                to: requiredString(input, 'to'),
                interactive: { role: 'questions', v: 1, questions, ...(submitLabel ? { submitLabel } : {}) },
            };
            const intro = optionalString(input, 'body'); if (intro) body.body = intro;
            const subject = optionalString(input, 'subject'); if (subject) body.subject = subject;
            const conversationId = optionalString(input, 'conversation_id'); if (conversationId) body.conversation_id = conversationId;
            return client.post('/v1/messages', body);
        },
    },
    {
        name: 'aimeat_dm_inbox',
        description: 'Read recent federated DMs addressed to this agent (replies + messages people sent you), newest first.',
        input: {
            page: { type: 'number', description: 'Page number (default 1).' },
            per_page: { type: 'number', description: 'Messages per page (default 20, max 100).' },
        },
        handler: ({ client }, input) => client.get(`/v1/messages/agent-inbox${query({ page: optionalNumber(input, 'page'), per_page: optionalNumber(input, 'per_page') })}`),
    },
    {
        name: 'aimeat_dm_thread',
        description: "Read a full federated DM thread as this agent sees it (your sent + the messages addressed to you), for one conversation_id.",
        input: {
            conversation_id: { type: 'string', required: true, description: 'Conversation id (from aimeat_dm_inbox or aimeat_dm_send).' },
            page: { type: 'number', description: 'Page number (default 1).' },
            per_page: { type: 'number', description: 'Messages per page (default 50, max 200).' },
        },
        handler: ({ client }, input) => client.get(`/v1/messages/agent-thread/${encodeURIComponent(requiredString(input, 'conversation_id'))}${query({ page: optionalNumber(input, 'page'), per_page: optionalNumber(input, 'per_page') })}`),
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
        input: {
            status: { type: 'string', description: 'Optional task status filter.' },
            page: { type: 'number', description: 'Page number (default 1).' },
            per_page: { type: 'number', description: 'Results per page (default 20, max 100).' },
        },
        // Without page/per_page a fleet with more than one page of history could not reach the rest
        // of it from this door at all: the first 20 were the only 20 that existed.
        handler: ({ client, agentPath }, input) => client.get(`/v1/agents/${agentPath}/tasks${query({
            status: optionalString(input, 'status'),
            page: optionalNumber(input, 'page'),
            per_page: optionalNumber(input, 'per_page'),
        })}`),
    },
    {
        name: 'aimeat_task_create',
        description: "Queue a task for one of your owner's agents (yourself or any same-owner agent). The owner sees it in their dashboard.",
        input: {
            target_agent: { type: 'string', required: true, description: 'Name of the agent the task is FOR (must share the calling agent\'s owner).' },
            title: { type: 'string', required: true, description: 'Short human-readable title.' },
            description: { type: 'string', required: true, description: 'The actual prompt / instruction.' },
            status: { type: 'string', enum: ['draft', 'queued'], description: 'Default "queued".' },
            scope: { type: 'array', description: 'Named parameters the receiving runner dispatches on: [{ name, value, type?, description? }]. A fleet runner recognises work by a `kind` entry here, not by the title.' },
            files: { type: 'array', description: 'Files the target agent needs, by REFERENCE: "<owner@node>/<storage key>" each (a bare key means a file the calling agent owns).' },
        },
        handler: ({ client }, input) => {
            const target = requiredString(input, 'target_agent');
            const scope = (optionalArray(input, 'scope') ?? []).map((entry) => {
                const o = (entry && typeof entry === 'object' && !Array.isArray(entry)) ? entry as JsonObject : {};
                return { ...o, type: typeof o.type === 'string' ? o.type : 'text' };
            });
            // Attachments. The connector's MCP twin has taken these since August; this door dropped
            // them, so a task commissioned here arrived without the files it was about.
            const files = (optionalArray(input, 'files') ?? []).map(ref => ({ ref }));
            return client.post(`/v1/agents/${encodeURIComponent(target)}/tasks`, {
                title: requiredString(input, 'title'),
                description: requiredString(input, 'description'),
                status: optionalString(input, 'status') ?? 'queued',
                ...(scope.length ? { scope } : {}),
                ...(files.length ? { resources: { files } } : {}),
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
            deliverable_key: { type: 'string', description: "The memory key, under the agent's own namespace, where the result was published. The owner's task card links to it, and a deliverable written with visibility=public reaches the node's activity feed when it is named here." },
        },
        // `deliverable_key` appeared zero times in this whole file set while both MCP doors had it,
        // so a completion from a fleet agent reported done and lost the pointer to its own output.
        handler: ({ client, agentPath }, input) => {
            const body: JsonObject = {
                message: optionalString(input, 'message') ?? optionalString(input, 'summary') ?? 'Task completed',
            };
            const deliverableKey = optionalString(input, 'deliverable_key');
            if (deliverableKey) body.deliverable_key = deliverableKey;
            return client.post(`/v1/agents/${agentPath}/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}/complete`, body);
        },
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
        // → GET /v1/agents/:name/messages[?thread_id=&page=&per_page=] — full agent↔owner thread history.
        name: 'aimeat_message_history',
        description: 'Read the agent↔owner conversation history (a thread, or recent messages across threads), oldest-first per page.',
        input: {
            thread_id: { type: 'string', description: 'Conversation thread to read (omit for recent across all threads).' },
            page: { type: 'number', description: 'Page number (default 1).' },
            per_page: { type: 'number', description: 'Messages per page (default 20, max 100).' },
        },
        handler: ({ client, agentPath }, input) => client.get(`/v1/agents/${agentPath}/messages${query({
            thread_id: optionalString(input, 'thread_id'), page: optionalNumber(input, 'page'), per_page: optionalNumber(input, 'per_page'),
        })}`),
    },
    {
        // Send a federated DM AS THE OWNER (consented delegation). No send-as-owner REST route exists;
        // POST /v1/messages sends as the connector's own principal, so this shell path delegates to the
        // standard send (the server MCP tool remains the way to speak strictly as the owner from an agent).
        name: 'aimeat_dm_send_as_owner',
        description: 'Send a federated direct message on the owner\'s behalf (Reply-with-AI). Sends via the standard message route as the connected principal.',
        input: {
            to: { type: 'string', required: true, description: 'Recipient: owner@node, agent#owner@node, or eco:app#owner@node.' },
            body: { type: 'string', description: 'Message body (markdown). Optional if attachments are given.' },
            reply_to: { type: 'string', description: 'Id of a message you are replying to (keeps the thread).' },
            subject: { type: 'string', description: 'Open a NEW topic thread with this title.' },
            conversation_id: { type: 'string', description: 'Continue a specific existing thread by id.' },
            attachments: { type: 'array', description: 'Up to 20 { storage_key, mime, kind, size, name } descriptors.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = { to: requiredString(input, 'to') };
            const text = optionalString(input, 'body'); if (text) body.body = text;
            const replyTo = optionalString(input, 'reply_to'); if (replyTo) body.reply_to = replyTo;
            const subject = optionalString(input, 'subject'); if (subject) body.subject = subject;
            const conversationId = optionalString(input, 'conversation_id'); if (conversationId) body.conversation_id = conversationId;
            const attachments = optionalArray(input, 'attachments'); if (attachments) body.attachments = attachments;
            return client.post('/v1/messages', body);
        },
    },
    // NOTE: the owner contacts (aimeat_contact_*) are NOT cliFallback — they are exposed on the connector
    // MCP surface (mcp/tools/contacts.ts) but intentionally have no `aimeat connect call` shell handler,
    // so no orphan handler is added here.
    {
        // Operator config-enactment. The server MCP tool runs propose-then-confirm with no single REST
        // route; the shell path APPLIES DIRECTLY through the per-field routes that exist —
        // PATCH /v1/agents/:name/{mode,tags,scopes}. Those routes carry the real authz (scopes is
        // requireRole('owner'); mode/tags are same-owner), so only an owner/operator principal can enact
        // a change — a plain agent token gets 403. display_name/description have no route (shell-unsupported).
        name: 'aimeat_operator_agent_configure',
        handler: async ({ client }, input) => {
            const target = requiredString(input, 'agent_name');
            const applied: JsonObject = {};
            const unsupported: string[] = [];
            const mode = optionalString(input, 'mode');
            if (mode !== undefined) applied.mode = (await client.patch(`/v1/agents/${encodeURIComponent(target)}/mode`, { mode })).data ?? 'ok';
            const tags = optionalArray(input, 'tags');
            if (tags !== undefined) applied.tags = (await client.patch(`/v1/agents/${encodeURIComponent(target)}/tags`, { tags })).data ?? 'ok';
            const scopes = optionalArray(input, 'scopes');
            if (scopes !== undefined) applied.scopes = (await client.patch(`/v1/agents/${encodeURIComponent(target)}/scopes`, { scopes })).data ?? 'ok';
            if (optionalString(input, 'display_name') !== undefined) unsupported.push('display_name');
            if (optionalString(input, 'description') !== undefined) unsupported.push('description');
            return { ok: true as const, data: { agent: target, applied, ...(unsupported.length ? { unsupported, note: 'These fields have no REST route — use the server MCP tool or the profile UI.' } : {}) } };
        },
    },
    {
        // Owner AI budget/routing. daily_budget_usd applies via POST /v1/ai/settings (owner-gated);
        // model routing has no REST route (shell-unsupported — set it via the profile UI or server MCP).
        name: 'aimeat_operator_ai_config',
        handler: async ({ client }, input) => {
            const applied: JsonObject = {};
            const unsupported: string[] = [];
            const budget = optionalNumber(input, 'daily_budget_usd');
            if (budget !== undefined) applied.ai_settings = (await client.post('/v1/ai/settings', { daily_budget_usd: budget })).data ?? 'ok';
            for (const k of ['model', 'reasoning_model', 'execution_model']) if (optionalString(input, k) !== undefined) unsupported.push(k);
            return { ok: true as const, data: { applied, ...(unsupported.length ? { unsupported, note: 'Model routing has no REST route — set it via the profile UI or the server MCP tool.' } : {}) } };
        },
    },
];
