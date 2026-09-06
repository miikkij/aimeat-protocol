/**
 * @file cli/connect/tool-call-defs-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Onboarding, agent, message, DM and task connect-call tool definitions. Extracted from cli/connect/tool-call.ts to satisfy max-file-lines.
 * @version-history
 *   v1.6.0 -- 2026-09-06 -- aimeat_dm_broadcast on the CLI dispatch, the third surface.
 *   v1.5.0 -- 2026-08-28 -- The five aimeat_crew_* tools as thin proxies onto /v1/agents/:name/crew*;
 *     try waits locally by polling, so wait_seconds is consumed here rather than forwarded.
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
import { agentCrewCliTools } from './tool-call-defs-agent-crew.js';
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
        name: 'aimeat_agent_description_set',
        description: "Say what one of your agents IS, in a sentence — the line a stranger reads on its A2A card. Send an empty string to clear it. The agent's NAME cannot be changed, because it is part of its identity.",
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose description to set.' },
            description: { type: 'string', required: true, description: 'What this agent is. Up to 2000 characters; empty clears it.' },
        },
        handler: ({ client }, input) => client.patch(
            `/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/description`,
            { description: optionalString(input, 'description') ?? '' },
        ),
    },
    {
        name: 'aimeat_agent_run_mode_set',
        description: "Set how one of your agents is RUN: 'spawn' (data on the node until work arrives; a worker starts per job and unwinds after), 'resident' (kept up), or null to take it back to nobody-has-said so a spawner leaves it alone. Works on ANY agent you own, whatever runs it — an agent whose behaviour lives in code is not a lesser agent. Recorded here and honoured by the runtime; the node never enforces it.",
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose run mode to set.' },
            run_mode: { type: 'string', required: true, enum: ['spawn', 'resident'], description: "'spawn', 'resident', or null to leave it unset." },
        },
        // `requiredString` cannot carry this one: null is a VALUE here, not a missing field, and it
        // would throw on the only surface a fleet daemon actually calls. That is the three-surfaces
        // trap in its usual shape — the node MCP and the connector MCP take a change and this
        // dispatch quietly does not. Read explicitly, and let anything else fail at the route,
        // which is where the vocabulary is decided.
        handler: ({ client }, input) => client.patch(
            `/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/run-mode`,
            { run_mode: input.run_mode === null ? null : requiredString(input, 'run_mode') },
        ),
    },
    {
        name: 'aimeat_agent_runtime_report',
        description: "Say what code runs this agent, so a run can be audited afterwards: the file, its hash, the commit and which runtime read it. A JSON crew is answerable through its definition on the node; a code-backed one has none, and without this nothing can say what ran. Recorded and never checked.",
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent this is about.' },
            kind: { type: 'string', required: true, description: "e.g. 'python' or 'crew-def'." },
            file: { type: 'string', description: 'Path to the file that runs, relative to your own root.' },
            sha256: { type: 'string', description: "Hash of that file's contents." },
            commit: { type: 'string', description: 'Commit the file came from.' },
            runtime: { type: 'string', description: "Which runtime read it, e.g. 'crewaimeat 0.7.0'." },
            definition_revision: { type: 'number', description: 'For a JSON crew: which definition revision was live.' },
        },
        handler: ({ client }, input) => {
            const src: JsonObject = { kind: requiredString(input, 'kind') };
            for (const k of ['file', 'sha256', 'commit', 'runtime'] as const) {
                const v = optionalString(input, k); if (v) src[k] = v;
            }
            const rev = optionalNumber(input, 'definition_revision');
            if (rev !== undefined) src.definition_revision = rev;
            return client.patch(
                `/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/runtime-source`,
                { runtime_source: src },
            );
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
        name: 'aimeat_agent_basics_get',
        description: "What this account would get from the one-press basic agents, and whether it can happen right now. Read only: creating them is the owner's own press on their Agents page.",
        input: {},
        handler: ({ client }) => client.get('/v1/agents/v2/basic-agents'),
    },
    {
        name: 'aimeat_agent_basics_request',
        description: "Ask your owner to set up the basic agents. Puts one line on their open-items list; it retires itself once they press. Creates nothing.",
        input: {
            note: { type: 'string', description: 'One short phrase on why you are asking, shown to the person with the request.' },
        },
        handler: ({ client }, input) => client.post('/v1/agents/v2/basic-agents/request', { note: optionalString(input, 'note') }),
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
    // ── Agent v2 messaging: a turn between two principals of ONE account ──
    //
    // The third door onto the same capability, and the one a fleet daemon actually calls. A
    // parameter that exists on the two MCP surfaces and not here is DROPPED IN SILENCE, so the call
    // succeeds having done less than it was asked — the same defect this repository paid for three
    // times in one week. Every parameter below is proved to leave the process by
    // test/unit/cli-tool-param-forwarding.test.ts, and the dispatch refuses one it does not declare.
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
        name: 'aimeat_dm_broadcast',
        description: 'Tell MANY people or agents the same thing in ONE call instead of looping aimeat_dm_send. Every copy is an ordinary 1:1 thread the recipient can answer, and every copy shares one broadcast id, which is what folds them into a single row in the recipient list.',
        input: {
            to: { type: 'array', description: 'Recipient identities (owner@node, agent#owner@node, eco:app#owner@node), up to 500.' },
            group_id: { type: 'string', description: 'A Share Group whose members are the audience.' },
            audience: { type: 'string', description: '"node-users" or "federation-users". OPERATOR-ONLY.' },
            mode: { type: 'string', description: '"broadcast" (default, repliable) or "announcement" (read-only).' },
            subject: { type: 'string', description: 'Titles the thread each recipient sees.' },
            body: { type: 'string', description: 'Message body (markdown). Optional with attachments or questions.' },
            attachments: { type: 'array', description: 'Up to 20 { storage_key, mime, kind, size, name } descriptors.' },
            interactive: { type: 'object', description: 'A question set { role:"questions", v:1, questions:[…] } — makes it a poll.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const to = optionalArray(input, 'to'); if (to) body.to = to;
            const groupId = optionalString(input, 'group_id'); if (groupId) body.group_id = groupId;
            const audience = optionalString(input, 'audience'); if (audience) body.audience = audience;
            const mode = optionalString(input, 'mode'); if (mode) body.mode = mode;
            const subject = optionalString(input, 'subject'); if (subject) body.subject = subject;
            const text = optionalString(input, 'body'); if (text) body.body = text;
            const attachments = optionalArray(input, 'attachments'); if (attachments) body.attachments = attachments;
            const interactive = optionalRecord(input, 'interactive'); if (interactive) body.interactive = interactive;
            return client.post('/v1/messages/broadcast', body);
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
    ...agentCrewCliTools,
];
