/**
 * @file cli/connect/tool-call-defs-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Onboarding, agent, message, DM and task connect-call tool definitions. Extracted from cli/connect/tool-call.ts to satisfy max-file-lines.
 * @version-history
 *   2026-10-02 -- aimeat_task_create forwards `start`; aimeat_task_start and aimeat_agent_task_start_set:
 *     whether a task starts on its own or waits for the owner's OK (services/agent-task-rules.ts).
 *   2026-10-02 -- aimeat_agent_propose says when to use it, to read the person's workspaces first and
 *     to hand over approval_url, as the catalog description does.
 *   2026-10-01 -- `tier` names "features" and "features/<id>", the feature map in parts.
 *   2026-09-27 -- Agent-facing texts use industry terms: door and surface became tool and interface (docs/coding-guidelines/shell-and-git.md).
 *   2026-09-19 — The `tier` description of aimeat_handbook_get names the Atelier specification
 *     first.
 *   v1.11.0 -- 2026-09-18 -- aimeat_handbook_get takes `tier` here too, so "build-app" reaches the
 *     layered build specification on this door as it does on the node's own MCP tool.
 *   v1.10.0 -- 2026-09-13 -- aimeat_dm_archive_as_owner / aimeat_dm_organize_as_owner on the CLI
 *     dispatch, over POST /v1/messages/organize/archive and GET/PUT /v1/messages/organize.
 *   v1.9.0 -- 2026-09-12 -- aimeat_dm_inbox_as_owner / aimeat_dm_thread_as_owner on the CLI dispatch,
 *     over GET /v1/messages/overview and /conversations/:id (messages:read-as-owner).
 *   v1.8.0 -- 2026-09-08 -- aimeat_agent_propose, and the sixteen v2 agent-plane tools move to
 *     tool-call-defs-agent-v2.ts unchanged, because adding one pushed this file past 800 lines.
 *   v1.7.0 -- 2026-09-06 -- aimeat_agent_mode_set declares its two parameters required, which is
 *     what it always enforced by throwing. The schema said they could be omitted.
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
import { agentV2CliTools } from './tool-call-defs-agent-v2.js';
import { query, optionalString, requiredString, optionalArray, requiredArray, optionalRecord, optionalNumber, optionalBoolean, taskTodoPayload } from './tool-call-helpers.js';
import { organizePatchBody } from './tool-call-helpers-organize.js';
import { handbookTierPath } from './handbook-path.js';

export const agentTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_handbook_get',
        description: 'Get the agent operating handbook or one handbook module.',
        input: {
            module: { type: 'string', description: 'Optional handbook module name, such as tasks or messages.' },
            surface: { type: 'string', description: 'Which interface the handbook is for. The catalog has published this since the interfaces split; this tool read only `module`, so asking for one was the same as asking for none.' },
            tier: { type: 'string', description: 'A prompt by id. "build-app-atelier" is the first part of the Atelier build specification, the track an app is built on unless there is a reason not to, and "build-app-atelier/<id>" is one of the parts it lists. "build-app" and "build-app/<id>" do the same for the Classic specification. "features" lists what this node can do, by area, and "features/<id>" is one area: read it once you know what the person needs, to offer the one thing that fits.' },
        },
        handler: ({ client }, input) => {
            const tier = optionalString(input, 'tier');
            if (tier) return client.get(handbookTierPath(tier));
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
        description: "Replace the tag list on an agent: your own with no permission word, a same-owner sibling's with agent:write. Convention: 'crew:<name>', 'source:<name>', 'role:<name>', 'project:<name>'.",
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
        // Both were declared optional and then thrown on when absent, so the published schema said a
        // caller could omit what the handler demands. `required: true` says the same thing the throw
        // did, before the call is made rather than after.
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose mode to update.' },
            mode: { type: 'string', required: true, enum: ['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation'], description: 'New mode.' },
        },
        handler: ({ client }, input) => client.patch(
            `/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/mode`,
            { mode: requiredString(input, 'mode') },
        ),
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
        name: 'aimeat_agent_propose',
        description: "How a new agent is made on this node: when the person asks for one, propose it here, never through an outside agent builder or another product. First read what it will work on (aimeat_organism_list, aimeat_workspace_list) and name that data in purpose and crew_def. Scopes: what the job needs plus memory:write, which the crew runtime writes its result with; no agent:write unless the job is making or changing agents. Creates nothing: only their own press creates it, seeds its definition and hands it to their connector. Then give them approval_url from the answer. Send crew_def with it whenever you can: an agent approved without one exists and cannot run.",
        input: {
            name: { type: 'string', required: true, description: 'The agent name: 3 to 40 characters, lowercase letters, digits and hyphens, starting with a letter.' },
            purpose: { type: 'string', required: true, description: 'What this agent is for, in a sentence the owner can decide from.' },
            display_name: { type: 'string', description: 'The name shown to the person. Defaults to the agent name.' },
            scopes: { type: 'array', description: 'Exactly what it may do. Never more than you hold yourself.' },
            mode: { type: 'string', description: 'Task handling: task-runner, autonomous, interactive, coordinator or workstation.' },
            run_mode: { type: 'string', description: "'spawn' (a worker per piece of work) or 'resident' (stays up)." },
            crew_def: { type: 'object', description: 'What it would BE, in the crewaimeat crew_def shape.' },
        },
        handler: ({ client }, input) => client.post('/v1/agents/v2/agent-proposals', {
            name: requiredString(input, 'name'),
            purpose: requiredString(input, 'purpose'),
            display_name: optionalString(input, 'display_name'),
            scopes: input.scopes,
            mode: optionalString(input, 'mode'),
            run_mode: optionalString(input, 'run_mode'),
            crew_def: input.crew_def,
        }),
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
    ...agentV2CliTools,
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
        // THE THIRD SURFACE, and the one a fleet actually calls. A tool that exists on the two MCP
        // doors and not here is a tool a fleet daemon cannot reach at all.
        name: 'aimeat_dm_delete_as_owner',
        description: "Remove one message from the OWNER's mailbox, as the owner. No undo; the other side keeps their copy. Requires the messages:delete-as-owner scope.",
        input: {
            message_id: { type: 'string', required: true, description: 'Id of the message to remove (from aimeat_dm_inbox or aimeat_dm_thread).' },
        },
        handler: ({ client }, input) => client.delete(`/v1/messages/${encodeURIComponent(requiredString(input, 'message_id'))}`),
    },
    {
        name: 'aimeat_dm_inbox_as_owner',
        description: "Read the OWNER's own mailbox, as the owner: conversations newest first with unread counts, the waiting contact requests and display names. Reading marks nothing as read. Requires the messages:read-as-owner scope.",
        input: {
            limit: { type: 'number', description: 'At most this many conversations, newest first (default 30, max 200).' },
            unread_only: { type: 'boolean', description: 'Only conversations with something unread.' },
        },
        handler: ({ client }, input) => client.get(`/v1/messages/overview${query({
            limit: optionalNumber(input, 'limit') ?? 30,
            unread: optionalBoolean(input, 'unread_only') === true ? 'true' : undefined,
        })}`),
    },
    {
        name: 'aimeat_dm_thread_as_owner',
        description: "Read one conversation from the OWNER's own mailbox, as the owner. Reading marks nothing as read. Requires the messages:read-as-owner scope.",
        input: {
            conversation_id: { type: 'string', required: true, description: "The owner's conversation id (from aimeat_dm_inbox_as_owner)." },
            page: { type: 'number', description: 'Page number (default 1).' },
            per_page: { type: 'number', description: 'Messages per page (default 50, max 200).' },
        },
        handler: ({ client }, input) => client.get(`/v1/messages/conversations/${encodeURIComponent(requiredString(input, 'conversation_id'))}${query({ page: optionalNumber(input, 'page'), per_page: optionalNumber(input, 'per_page') })}`),
    },
    {
        name: 'aimeat_dm_archive_as_owner',
        description: "Archive conversations in the OWNER's Messages list, as the owner, or bring them back with restore: true. Nothing is deleted; an archived conversation comes back when somebody other than the owner's own agents writes in it. Requires the messages:organize-as-owner scope.",
        input: {
            conversation_ids: { type: 'array', required: true, description: 'Conversation ids to archive or restore (1-500), from aimeat_dm_inbox_as_owner.' },
            restore: { type: 'boolean', description: 'true brings the conversations back to the list instead of archiving them.' },
        },
        handler: ({ client }, input) => {
            const restore = optionalBoolean(input, 'restore');
            return client.post('/v1/messages/organize/archive', { conversation_ids: requiredArray(input, 'conversation_ids'), ...(restore !== undefined ? { restore } : {}) });
        },
    },
    {
        name: 'aimeat_dm_organize_as_owner',
        description: "Read or change how the OWNER's Messages list is organised: auto-archive by age for the owner's own agents, one row for copies with the same subject, and the rules that fold, group or archive. Called with nothing, it returns the current settings. Requires the messages:organize-as-owner scope.",
        input: {
            auto_archive_enabled: { type: 'boolean', description: "Archive the own agents' conversations by age." },
            auto_archive_days: { type: 'number', description: 'Days without a message before that happens (1-365).' },
            fold_same_subject: { type: 'boolean', description: 'One row for conversations one sender opened with the same subject within an hour.' },
            add_rule: { type: 'object', description: 'A rule { id?, name, enabled?, action: "fold" | "group" | "archive", match: { with?, subject?, body?, scope?, older_than_days? } }.' },
            remove_rule: { type: 'string', description: 'Id of a rule to remove.' },
            rules: { type: 'array', description: 'Replace every rule with this list.' },
        },
        handler: ({ client }, input) => {
            const body = organizePatchBody({
                auto_archive_enabled: optionalBoolean(input, 'auto_archive_enabled'),
                auto_archive_days: optionalNumber(input, 'auto_archive_days'),
                fold_same_subject: optionalBoolean(input, 'fold_same_subject'),
                add_rule: optionalRecord(input, 'add_rule'),
                remove_rule: optionalString(input, 'remove_rule'),
                rules: optionalArray(input, 'rules'),
            });
            return Object.keys(body).length ? client.put('/v1/messages/organize', body) : client.get('/v1/messages/organize');
        },
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
        description: "List the calling owner's agents on the node (name, mode, capabilities, tags, last_seen, ...). Use this to discover delegation targets for aimeat_task_create. Each agent also carries default_scopes, scope_request (what it asked for at its last approval) and refusals (calls the node refused it for a permission it still lacks).",
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
            start: { type: 'string', enum: ['automatic', 'confirm'], description: "How THIS task starts: 'confirm' waits for the owner's OK, 'automatic' lets the agent go on (needs agent:write, never your own task). Omit for the agent's own setting." },
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
                ...(optionalString(input, 'start') ? { start: optionalString(input, 'start') } : {}),
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
            todos: { type: 'array', required: true, description: "Array of TODOs with title, optional description, verification, estimate_minutes, and effects (any of 'spend', 'send_as_owner', 'delete'; such a plan waits for the owner's OK)." },
        },
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}/propose-todos`, taskTodoPayload(input)),
    },
    {
        name: 'aimeat_task_start',
        description: "Start a task that waits for the owner's OK, on the owner's word. Never your own task; a task held because its agent can spend, send or delete as the owner is refused, and only the owner can start it.",
        input: { task_id: { type: 'string', required: true, description: 'The waiting task to start.' } },
        // The route reads the task by id; the name segment is the caller's own and decides nothing.
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/tasks/${encodeURIComponent(requiredString(input, 'task_id'))}/start`, {}),
    },
    {
        name: 'aimeat_agent_task_start_set',
        description: "Set whether one of the owner's agents starts its tasks on its own ('automatic') or waits for the owner's OK on each ('confirm'); null leaves it to the agent's mode. Never for yourself.",
        input: {
            target_agent_name: { type: 'string', required: true, description: 'The agent this is about.' },
            task_start: { type: 'string', required: true, enum: ['automatic', 'confirm'], description: "'automatic', 'confirm', or null." },
        },
        // null is a VALUE here, as with run_mode above: read explicitly, the route decides the vocabulary.
        handler: ({ client }, input) => client.patch(
            `/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/task-start`,
            { task_start: input.task_start === null ? null : requiredString(input, 'task_start') },
        ),
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
