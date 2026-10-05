/**
 * @file agent-messaging.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Handbook/onboarding, agent self-management (capabilities, activity, telemetry, tags, mode), owner-agent messaging, and federated direct-message (DM) tool definitions, plus aimeat_agents_list.
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   2026-10-03 — aimeat_handbook_get's `tier`: "settings" also holds the system's words in plain language ("settings/concept.<id>").
 *   2026-10-02 — aimeat_handbook_get's `tier` names "settings" and "settings/<term>", the setting explanations in parts.
 *   2026-10-02 — aimeat_agent_propose: the node adds memory:read and memory:write itself.
 *   2026-10-02 — aimeat_handbook_get's `surface` names `chat`.
 *   2026-10-02 — aimeat_agent_propose gives the smallest crew_def that runs. A chat model with only
 *     "the crewaimeat crew_def shape" spent 23 s guessing it and was refused once over {{ctx.prompt}}.
 *   2026-10-02 — aimeat_agent_runtime_report takes `llm` ('node' | 'machine').
 *   2026-10-02 — aimeat_agent_propose opens with when to use it: read the person's organisms and
 *     workspaces first, hand them approval_url afterwards, and never send them to an outside builder.
 *   2026-10-01 — aimeat_handbook_get's `tier` names "features" and "features/<id>", the feature map in parts.
 *   2026-10-01 — aimeat_contact_list says it takes contacts:read, as GET /v1/contacts does, and which
 *     columns stay empty for a caller that may not read the owner's mailbox or organisms.
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   2026-09-26 — aimeat_contact_invite says it takes messages:send, as POST /v1/contacts/invite now
 *     does for an agent.
 *   2026-09-26 — aimeat_contact_invite says an invitation counts against the same 20 lookups per
 *     account in 10 minutes (secaudit 2026-09, A5-2).
 *   2026-09-25 — aimeat_contact_add and aimeat_contact_resolve_email say a save by email counts
 *     against the same 20 lookups per account in 10 minutes.
 *   2026-09-25 — aimeat_contact_resolve_email answers an agent holding messages:read, and says one
 *     account has 20 lookups in 10 minutes, the owner and all their agents together.
 *   2026-09-24 — aimeat_contact_resolve_email says the lookup is the account holder's own and
 *     throttled, as POST /v1/contacts/resolve is, so an agent session is refused (audit A5-2).
 *   2026-09-19 — aimeat_handbook_get: the `tier` description names the Atelier specification first.
 *   v1.5.1 — 2026-09-18 — aimeat_dm_send declares `subject` and `conversation_id`. The node's tool and
 *     the connector's dispatch have both taken them all along; only this shared definition did
 *     not, so the one place an agent reads the tool's fields said it had no way to title a thread,
 *     while every instruction tells it to send a subject to support@operators. Found by building
 *     the cold-agent runner against a real node.
 *   v1.5.0 — 2026-09-13 — aimeat_dm_archive_as_owner and aimeat_dm_organize_as_owner: archiving the
 *     owner's conversations and the rules for their Messages list, on messages:organize-as-owner.
 *   v1.4.0 — 2026-09-12 — aimeat_dm_inbox_as_owner and aimeat_dm_thread_as_owner: reading the owner's
 *     own mailbox as the owner, on the new messages:read-as-owner word.
 *   v1.3.0 — 2026-09-01 — The five Agent v2 task tools (V5), in MCP's task shape.
 *   v1.2.0 — 2026-09-01 — The five Agent v2 messaging tools (V4): a turn between two
 *     principals of one account, and the delivery target that reaches an absent one.
 *   v1.1.0 — 2026-08-13 — aimeat_agent_console_set: an agent that creates a sibling in a fleet
 *     runtime reports back where the owner can go and look at it.
 *   v1.0.0 — 2026-07-13 — Extracted from definitions.ts (pure extraction; no behavior change).
 */

import { OWNER_REPORTS } from '../../models/tool-input-vocabulary.js';
import { InteractiveQuestionSchema, MessageAttachmentInputSchema } from '../../models/message-schemas.js';
import { CONVERSATION_ID, InboxRuleInputSchema } from '../../models/inbox-organize-schemas.js';
import { LinkSchema } from '../input-schemas.js';
import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';
import { agentV2Tools } from './agent-v2.js';

export const agentMessagingTools = [
    {
        name: 'aimeat_handbook_get',
        description: 'This node\'s operating guide. Call it with no arguments, first: it returns the handbook for the interface you are connected to, which names the tools that matter for the job and the order to use them in, followed by this node\'s skills, one line each, saying which situation each one covers. When a line matches what the person asked for, load that skill with aimeat_skill_get before you start. Pass `surface` only to read another interface\'s handbook. Before building an app, pass `tier: "build-app"`: it returns the first part of the build specification every app follows, and lists the other parts and the sections for particular situations, each read with "build-app/<id>". An agent working over HTTP can ask for a tier handbook by id ("tier1", "tier2") or a managed prompt by its id; that answer carries the prompt name, description, content and variables.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Agent Handbook', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service', 'commerce', 'chat'],
        input: {
            module: { type: 'string', description: 'Optional handbook module name, such as tasks or messages.' },
            tier: { type: 'string', description: 'A prompt by id. "build-app-atelier" is the first part of the Atelier build specification, the track an app is built on unless there is a reason not to, and "build-app-atelier/<id>" is one of the parts it lists. "build-app" and "build-app/<id>" do the same for the Classic specification. "features" lists what this node can do, by area, and "features/<id>" is one area: read it once you know what the person needs, to offer the one thing that fits. "settings" lists, first, the words this system uses (organism, agent, morsel and others), each in plain language, then the settings the pages explain behind a question mark, by area. "settings/<term>" is one of them in English, Finnish and Spanish. "settings/concept.<id>" is a word, for example "settings/concept.organism": read it before you use the word with the person or when they ask what it is, and give the word that meaning, which every page and tool uses too. Any other term is a setting: read it when the person asks what it means or which value to pick.' },
            surface: { type: 'string', enum: ['appdev', 'agent', 'service', 'admin', 'commerce', 'primitives', 'chat', 'full'], description: 'Another interface\'s handbook than your own. Leave it out to get the one for the interface you are connected to.' },
        },
    },
    {
        name: 'aimeat_onboarding_status',
        description: 'Check this agent\'s Hello Integration onboarding progress: which steps have passed, which are still pending, and a next_step hint pointing to the tool to call next. Start here when connecting and re-call it after each step to see what remains. Auto-checked steps refresh on read; completing all required steps finalizes onboarding and computes a readiness score.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Check Onboarding Status', readOnlyHint: true },
        surfaces: ['agent', 'service'],
        input: {},
    },
    {
        name: 'aimeat_onboarding_identify_platform',
        description: 'Complete the "identify platform" onboarding step by declaring which runtime you are (e.g. claude, openclaw, hermes, vscode, generic). Records the platform on the agent record and marks the step passed. One of the steps surfaced by aimeat_onboarding_status; call it when next_step is identify_platform.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Identify Runtime Platform', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent', 'service'],
        input: {
            platform: { type: 'string', required: true, description: 'Runtime/platform name, for example hermes, claude, vscode, or generic.' },
            platform_version: { type: 'string', description: 'Runtime/platform version if known.' },
            model: { type: 'string', description: 'Primary LLM model driving this agent, for example claude-haiku-4.5 or kimi-k2.6. Self-reported and indicative — used for attribution and filtering, never auditing', zod: z.string().max(64) },
        },
    },
    {
        name: 'aimeat_onboarding_confirm_skill_installed',
        description: 'Complete the "install skill" onboarding step by confirming the local AIMEAT skill bundle is available, passing the platform and bundle version (use "local" when no version is shown). Marks the step passed. One of the steps surfaced by aimeat_onboarding_status.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Confirm Skill Installed', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent', 'service'],
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
        annotations: { title: 'Confirm Directives Read', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent', 'service'],
        input: { confirmed: { type: 'boolean', description: 'Set true after reading the handbook/directives.' } },
    },
    {
        name: 'aimeat_onboarding_declare_services',
        description: 'Complete the optional "declare services" onboarding step by listing services this agent offers (name + optional description). An empty list is allowed. Marks the step passed; this is advisory metadata, distinct from the action catalogue or aimeat_agent_capabilities_report. One of the steps surfaced by aimeat_onboarding_status.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Declare Agent Services', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent', 'service'],
        input: { services: { type: 'array', description: 'Optional array of service objects with name and description.', zod: z.array(z.object({
            name: z.string().describe('Service name'),
            description: z.string().optional().describe('Short service description'),
        })) } },
    },
    {
        name: 'aimeat_agent_capabilities_report',
        description: 'Self-report this agent\'s capabilities so other agents can discover it: technical capabilities (MCP servers, skills, tools — MCP-type entries are auto-marked verified), domain expertise, and human languages. Overwrites the previously reported capability set on the agent record. Use during/after onboarding; this is descriptive metadata, not the same as registering a hireable action or aimeat_capabilities_create.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Report Agent Capabilities', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent', 'service'],
        input: {
            technical: { type: 'array', description: 'Array of technical capabilities: { name, type }.', zod: z.array(z.object({
                name: z.string().describe('Capability name (e.g. "playwright", "git", "python")'),
                type: z.enum(['mcp', 'skill', 'tool']).describe('Capability type'),
            })) },
            domain: { type: 'array', description: 'Array of domain expertise strings.', zod: z.array(z.string()) },
            languages: { type: 'array', description: 'Array of language codes.', zod: z.array(z.string()) },
        },
    },
    {
        name: 'aimeat_agent_activity',
        description: 'View this agent\'s own activity statistics plus a time-series history (default last 30 days, daily granularity). Read-only — useful for self-reflection or reporting on recent work volume. For raw telemetry events you push, use aimeat_agent_telemetry_report; for task-level progress use aimeat_task_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Agent Activity', readOnlyHint: true },
        surfaces: ['agent', 'service'],
        input: {
            days: { type: 'number', description: 'Number of days of history to retrieve.' },
            granularity: { type: 'string', enum: ['daily', 'hourly'], description: 'History granularity.' },
        },
    },
    {
        name: 'aimeat_usage_report',
        description: 'Answer "what did we actually use, and what did it cost" for the owner behind this session: spend per model, per app, per agent, per day, plus which tools get called and which of them refuse or fail. Reads a precomputed layer, so it is cheap however large the history is, and it says how fresh it is. Scoped to this owner and to nobody else. Use it for a spend or usage question; use aimeat_agent_activity for one agent own counters.',
        // 'agent' in the catalog's sense (the caller is a session principal), though an owner session
        // reaches it too — both resolve to the same human account, which is the only account it can
        // report on.
        caller: 'agent',
        // publicMcp + connectorMcp, no cliFallback: there is no `aimeat connect` handler for it, and
        // claiming one would fail the parity gate rather than quietly not work.
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: false },
        annotations: { title: 'Usage Report', readOnlyHint: true },
        // Usage reports (GET /v1/usage/summary → wallet:read). The same word as the route it calls,
        // because the tool IS that door: a permission enforced on one surface and not the other is a
        // permission the owner was told they had.
        scope: 'wallet:read',
        surfaces: ['agent', 'service'],
        input: {
            report: { type: 'string', required: true, enum: ['day', 'model', 'app', 'agent', 'tool', 'surface', 'apps-used', 'activity', 'sold'], description: 'Which report to read.', zod: z.enum(Object.keys(OWNER_REPORTS) as [string, ...string[]]).default('day') },
            from: { type: 'string', description: 'Inclusive start day, YYYY-MM-DD. Defaults to 30 days ago.' },
            to: { type: 'string', description: 'Inclusive end day, YYYY-MM-DD. Defaults to today.' },
            grain: { type: 'string', enum: ['day', 'hour'], description: 'Bucket size, where the report has one.' },
            limit: { type: 'number', description: 'Maximum groups to return.' },
        },
    },
    {
        // Connector-CLI-only convenience (no MCP surface): the loopback serve daemon / a no-LLM crew
        // reads its own rollups over `aimeat connect call` instead of a periodic node GET. Excluded
        // from the v2 MCP surfaces (V2_EXCLUDED); cliFallback only.
        name: 'aimeat_agent_statistics',
        description: "Get this agent's own performance + per-context review rollups (recomputed from its tasks).",
        caller: 'agent',
        visibility: { publicMcp: false, connectorMcp: false, cliFallback: true },
        annotations: { title: 'Get Agent Statistics', readOnlyHint: true },
        input: {},
    },
    {
        name: 'aimeat_agent_telemetry_report',
        description: 'Append one telemetry event (llm_call, tool_call, or agent_report) recording metrics such as tokens, duration, or tool name; optionally tie it to a session or AIMEAT task. Feeds the node\'s activity stats (viewable via aimeat_agent_activity). Use for fine-grained runtime metrics — for task lifecycle/progress use the aimeat_task_* tools instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Report Agent Telemetry', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent', 'service'],
        input: {
            type: { type: 'string', required: true, enum: ['llm_call', 'tool_call', 'agent_report'], description: 'Telemetry event type.', zod: z.enum(['llm_call', 'tool_call', 'agent_report']).default('agent_report') },
            data: { type: 'object', description: 'Telemetry data such as tokens, duration, or tool name.' },
            session_id: { type: 'string', description: 'Optional runtime session identifier.' },
            task_id: { type: 'string', description: 'Optional related AIMEAT task id.' },
        },
    },
    {
        name: 'aimeat_agent_tags_set',
        description: "Replace (set) the tag list on a same-owner agent. An agent may tag itself with no permission word, and a same-owner sibling with agent:write; an owner may tag any of their agents. Convention: 'crew:<name>', 'source:<name>', 'role:<name>', 'project:<name>' — but any lowercase string of alphanumerics plus `._:-` is accepted (no `@`). Max 20 tags. Empty array clears all tags.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Set Agent Tags', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent', 'service', 'admin'],
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose tags to update (must be owned by the same owner as the caller). Pass the calling agent\'s own name to self-tag.' },
            tags: { type: 'array', required: true, description: 'Replacement tag list. Empty array clears all tags.', zod: z.array(z.string()) },
        },
    },
    {
        name: 'aimeat_agent_mode_set',
        description: "Owner-only. Set an agent's operational mode. Modes: 'autonomous' (runs continuously, full Hello Integration), 'interactive' (user-facing, full Hello Integration), 'task-runner' (triggered/ephemeral, reduced 7-step Hello Integration — no commands or messages), 'coordinator' (orchestrates other agents, full Hello Integration), 'workstation' (node-visiting agent in the user's own env like VSCode or Claude Desktop, uses MCP directly; not node-resident, so narrowest 4-step Hello Integration — auth, platform, capabilities, directives).",
        caller: 'owner',
        visibility: agentEverywhere,
        annotations: { title: 'Set Agent Mode', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'agent:write',
        surfaces: ['admin'],
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose mode to update (must be owned by the calling owner).' },
            mode: { type: 'string', required: true, enum: ['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation'], description: 'New mode.' },
        },
    },
    {
        name: 'aimeat_agent_description_set',
        description: "Say what one of your agents IS, in a sentence — the line a stranger reads on its A2A card and the one on its page here. Set it when what the agent does changes: it was fixed at registration and editable by nobody until 2026-09-03, so an agent whose job moved went on describing its old one. Send an empty string to clear it. The agent's NAME cannot be changed here or anywhere, because it is part of its identity; a description carries none.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Set Agent Description', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'agent:write',
        surfaces: ['admin'],
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose description to set (same owner as the caller). Pass your own name to describe yourself.' },
            description: { type: 'string', required: true, description: 'What this agent is, in a sentence or two. Up to 2000 characters; empty clears it.' },
        },
    },
    {
        name: 'aimeat_agent_run_mode_set',
        description: "Set how one of your agents is meant to be RUN: 'spawn' (the agent is data on the node until work arrives, and its runtime starts a worker for the job which then unwinds) or 'resident' (the runtime keeps it up). Works on ANY agent you own, whatever runs it — an agent whose behaviour lives in code rather than in a definition on this node is not a lesser agent, and this is the switch that puts it on a spawner's roster (GET /v1/agents?run_mode=spawn). The node records it and the runtime honours it; the node never enforces it, exactly as with mode and max concurrent tasks.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Set Agent Run Mode', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'agent:write',
        surfaces: ['admin'],
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose run mode to set (must be owned by the same owner as the caller). Pass your own name to set your own.' },
            run_mode: { type: 'string', required: true, enum: ['spawn', 'resident'], description: "'spawn' = started per job and unwound after; 'resident' = kept running; null takes it back to nobody-has-said, so a spawner leaves the agent alone.", zod: z.enum(['spawn', 'resident']).nullable() },
        },
    },
    {
        name: 'aimeat_agent_runtime_report',
        description: "Say what code is running this agent, so a run can be audited afterwards. A crew whose definition lives on this node is already answerable — the definition is versioned here — but a code-backed crew has none, and then nothing can say what ran. Send the file, its hash, the commit it came from and which runtime read it; send null to clear. The node records the claim and stamps its own time on it, and never checks it: it does not run the process and cannot read the disk. Say in `llm` where the crew's model calls go. An agent reports its own with no permission word; a same-owner sibling's needs agent:write.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Report What Code Runs This Agent', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['admin'],
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent this is about (same owner as the caller). Pass your own name to report your own.' },
            kind: { type: 'string', required: true, description: "What kind of thing runs, e.g. 'python' for a code-backed crew or 'crew-def' for a JSON one." },
            file: { type: 'string', description: "Path to the file that runs, relative to your own root, e.g. 'crews/web_researcher_crew.py'." },
            sha256: { type: 'string', description: "Hash of that file's contents — the only field that changes when the code changes and nothing else does." },
            commit: { type: 'string', description: 'Commit the file came from.' },
            runtime: { type: 'string', description: "Which runtime read it, e.g. 'crewaimeat 0.7.0'." },
            definition_revision: { type: 'number', description: 'For a JSON crew: which revision of the definition on this node was live.' },
            llm: { type: 'string', enum: ['node', 'machine'], description: "Where the crew's model calls go: 'node' when they go through this node's /v1/llm with the agent's own token (the owner's own key then pays before the node's), 'machine' when the crew calls its provider with a key on its own machine. The owner's AI settings read it to say whether their own key reaches this agent." },
        },
    },
    {
        name: 'aimeat_agent_console_set',
        description: "Record where an agent is managed by whatever HOSTS it: its settings or brain page in the fleet runtime it runs in. Call this after creating and starting an agent somewhere the node cannot see — a fleet cockpit, your own daemon's UI — so the owner's profile can link straight to it. Without it the person is told their agent is running and has nowhere to go and look at it. Must be an absolute http(s) URL; send an empty string to clear it. Display only: the node links this address and never fetches it.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Set Agent Console Address', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'agent:write',
        surfaces: ['admin'],
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose console address to set (must be owned by the same owner as the caller). Pass your own name to record your own.' },
            console_url: { type: 'string', required: true, description: "Absolute http(s) URL of that agent's page in its host, or '' to clear it." },
        },
    },
    {
        name: 'aimeat_agent_basics_get',
        description: "What this account would get from the one-press basic agents, and whether it can happen right now. Returns the two agents (concierge, which answers what arrives and routes the rest; workflow-manager, which orders work from the owner's other agents), the permissions each would hold, which already exist, and whether the owner's connector is running. READ ONLY: you cannot create them. Creating agents changes the account, so the person does it themselves. Hand them `approval_url` and say `next_step` — it is already written for them and true for this account's current state — then call this again to see `enrolled` turn true. To propose a DIFFERENT agent, one you have designed for a job these two do not cover, use aimeat_agent_propose: it puts the proposal in front of the owner and creates nothing until they approve.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Basic Agents: What and Whether', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['agent', 'admin'],
        input: {},
    },
    {
        name: 'aimeat_agent_basics_request',
        description: "Ask your owner to set up the basic agents. Puts ONE line on their open-items list — the list they already read — saying which agents are missing, and that line retires itself the moment they press the button, so nobody has to tick it off. Call aimeat_agent_basics_get first: if they are already there this answers requested:false with reason 'already_there' and writes nothing, and if you (or another of the owner's agents) already asked, it answers 'already_asked' with the standing item's id rather than printing a second line. This does NOT create the agents; creating them changes the account and the person does that themselves on the page in approval_url. Needs memory:write, because an open item is a record in the owner's own namespace.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Ask the Owner for the Basic Agents', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent', 'admin'],
        input: {
            note: { type: 'string', description: 'Optional: one short phrase on why you are asking, shown to the person with the request.', zod: z.string().max(300) },
        },
    },
    {
        name: 'aimeat_agent_propose',
        description: "How a new agent is made on this node. When the person asks you for an agent (\"an agent that every morning…\", \"something that watches…\", a helper for one job the basic agents do not cover), propose it here: this node creates it, gives it its instructions, credentials it and runs it on the person's own connector, so never point them to an outside agent builder or another product for this. BEFORE you propose, read what of theirs it will work on: aimeat_organism_list and aimeat_workspace_list (or aimeat_discover with scope \"shared\") show the organisms and workspaces they keep, such as their CRM or their notes. Name that data in `purpose` and in the `crew_def` tasks. Scopes: what the job needs. The node adds memory:read and memory:write itself, because a crew runtime reads its own definition and writes its result with them. It needs no agent:write to report about itself, and agent:write lets an agent approve new agents, so add it only when that is the job. CREATES NOTHING: the proposal waits for the person, and only their own press creates the agent, because adding a principal to an account is theirs to decide. AFTER: give the person `approval_url` from the answer and say `next_step`. Send `crew_def` whenever you can: an agent approved without one exists and cannot run, and a new agent has no runtime to publish one to, so the definition you attach here is the one it starts with. It is checked before the proposal is written, so a broken one is refused now. The smallest crew_def that runs: {\"agents\":[{\"role\":\"Reader\",\"goal\":\"…\",\"backstory\":\"…\",\"tools\":[\"memory\"]}],\"tasks\":[{\"id\":\"main\",\"agent\":\"Reader\",\"description\":\"… {{ctx.prompt}} …\",\"expected_output\":\"…\"}]}; each task's `agent` is one of the agents' role (or name), and at least one task's description contains {{ctx.prompt}}, which becomes each run's own task text. `scopes` may not exceed what you hold yourself. A name already waiting returns the standing proposal. For work on a clock, propose the agent first and schedule its task (aimeat_schedule_create, kind agent_task) once it exists.",
        caller: 'agent',
        visibility: agentEverywhere,
        // Idempotent because proposing a name that is already waiting returns the standing proposal
        // rather than writing a second one.
        annotations: { title: 'Propose a New Agent', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // A proposal IS a memory write — a record under `agents.proposals.` plus a line on the owner's
        // open items — and the same word the sibling ask-route takes. Creating the agent is a different
        // door with a different gate: the owner in person.
        scope: 'memory:write',
        surfaces: ['agent', 'admin', 'chat'],
        input: {
            name: { type: 'string', required: true, description: 'The agent name: 3 to 40 characters, lowercase letters, digits and hyphens, starting with a letter.' },
            purpose: { type: 'string', required: true, description: 'What this agent is for, in a sentence the owner can decide from. This is what they read.' },
            display_name: { type: 'string', description: 'The name shown to the person. Defaults to the agent name.' },
            scopes: { type: 'array', description: 'Exactly what it may do, e.g. ["memory:read","memory:write"]. Never more than you hold yourself.', zod: z.array(z.string()) },
            mode: { type: 'string', description: "How the node treats its tasks: 'task-runner' activates a queued task without asking the owner each time; also autonomous, interactive, coordinator, workstation." },
            run_mode: { type: 'string', description: "'spawn' starts a worker per piece of work (right for bursty jobs); 'resident' stays up (right for an agent that answers people as they write, at a few seconds of cold start saved)." },
            crew_def: { type: 'object', description: 'What it would BE, in the crewaimeat crew_def shape — the same document aimeat_crew_publish takes. Strongly recommended.' },
        },
    },
    {
        name: 'aimeat_message_inbox',
        description: 'Fetch this agent\'s pending inbound messages from its owner (each with id, thread_id, sender, content, timestamp). Poll this to pick up new instructions or replies from the human; reply with aimeat_message_send (pass the same thread_id to stay in the conversation). For delegated work use the aimeat_task_* tools instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Message Inbox', readOnlyHint: true },
        surfaces: ['agent', 'primitives'],
        input: {},
    },
    {
        name: 'aimeat_message_send',
        description: 'Send a message from this agent to its owner\'s conversation (markdown supported). Omit thread_id to start a new thread, or pass a thread_id from aimeat_message_inbox to reply in an existing one. Optionally link a task or attach metadata. Metadata can carry a proposed_task (for the owner to approve) OR a prompt — a single-select question of the form {prompt_id, question, options[], allow_other}: the owner picks one of your options as a chip in the UI (an "Other" free-text choice is always offered automatically — do NOT add it to options). Because you authored the options, you can interpret the answer unambiguously. Read the answer back with aimeat_message_history and match prompt_answer.prompt_id to your prompt_id. This is the agent→human channel; it does not deliver to other agents.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Send Agent Message', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        surfaces: ['agent', 'primitives'],
        input: {
            ...aiProvenanceCatalogInput,
            content: { type: 'string', required: true, description: 'Message content (markdown supported).', zod: z.string().min(1).max(200_000) },
            thread_id: { type: 'string', description: 'Thread ID to reply in (omit to start a new conversation).', zod: z.string().uuid() },
            linked_task_id: { type: 'string', description: 'Optional linked task identifier.', zod: z.string().uuid() },
            metadata: { type: 'object', description: 'Optional metadata object. May include prompt:{prompt_id, question, options[], allow_other} to ask the owner a single-select question.', zod: z.object({
                tokens_used: z.number().optional().describe('Tokens consumed for this response'),
                processing_ms: z.number().optional().describe('Processing time in ms'),
                proposed_task: z.object({
                    title: z.string().min(1).max(256),
                    description: z.string().max(10_000),
                }).optional().describe('Propose a task for user approval'),
            }) },
        },
    },
    {
        name: 'aimeat_message_history',
        description: 'Read the full message history for a conversation — both your messages and the owner\'s, oldest-first — so you have complete context, not just the unread items aimeat_message_inbox returns. Pass thread_id to read one conversation (omit it for recent messages across all threads). Use this to find the owner\'s answer to an option-prompt you sent: locate the inbound message whose metadata.prompt_answer.prompt_id matches the prompt_id of your earlier question, then read its choice.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Message Thread History', readOnlyHint: true },
        surfaces: ['agent'],
        input: {
            thread_id: { type: 'string', description: 'Conversation thread to read (omit for recent messages across all threads).' },
            page: { type: 'number', description: 'Page number (default 1).', zod: z.number().int().positive() },
            per_page: { type: 'number', description: 'Messages per page (default 20, max 100).', zod: z.number().int().positive().max(100) },
        },
    },
    {
        name: 'aimeat_notify',
        description: "Tell your OWN owner that something happened: a line in their header bell and, if they turned push on, a notification on their devices; a click opens `link`. Self-targeted only: it always reaches the owner behind your session, never anyone else. Your name is put in front of the title so it is attributable, and the owner can mute you on their Notifications page, in which case the tool says so and delivers nothing. Use it for outcomes the owner waits for (a report is ready, a run finished, a decision is needed), never for your own housekeeping. Requires the notifications:send scope.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Notify Your Owner', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'notifications:send',
        surfaces: ['agent'],
        input: {
            title: { type: 'string', required: true, description: 'What happened, in one line (max 200).', zod: z.string().max(200) },
            body: { type: 'string', description: 'The detail, a few lines at most.', zod: z.string().max(10_000) },
            link: { type: 'string', description: 'Where a click leads: a path on this AIMEAT starting with "/". Default: the Agents page.', zod: z.string().max(500) },
            type: { type: 'string', description: 'A short machine word for the kind of event, e.g. report_ready.', zod: z.string().max(64) },
        },
    },
    {
        name: 'aimeat_dm_send',
        description: 'Send a direct message across the AIMEAT federation FROM this agent TO any person (owner@node), agent (agent#owner@node) or app (eco:app#owner@node) — this is the federation-wide inbox ("Postilaatikko"), NOT the agent↔owner channel (that is aimeat_message_send). The recipient sees it is from you, the agent. A message to an agent/app is delivered to that identity\'s owner inbox. First contact lands in the recipient\'s requests until they accept. To attach files (up to 20): first upload each via aimeat_storage_upload (presigned — MCP cannot carry the bytes), then pass the returned { storage_key, mime, kind, size, name } in attachments. Requires the messages:send scope.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Send Federated Direct Message', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        // Federated direct messages / inbox (REST: POST /v1/messages → messages:send). Distinct from the
        // agent-dashboard aimeat_message_* tools, which are not scope-gated (agent↔own-owner only).
        scope: 'messages:send',
        surfaces: ['agent'],
        input: {
            ...aiProvenanceCatalogInput,
            to: { type: 'string', description: 'Recipient: owner@node, agent#owner@node, or eco:app#owner@node.', zod: z.string().min(3).max(256) },
            body: { type: 'string', description: 'Message body (GFM markdown). Optional only if you attach ≥1 file.', zod: z.string().max(50000) },
            reply_to: { type: 'string', description: 'Id of a message you are replying to (keeps the same thread).', zod: z.string().uuid() },
            subject: { type: 'string', description: 'Open a NEW topic thread with this title, instead of one endless thread with the recipient. Give one when you write to support@operators, so the operators see what the thread is about.', zod: z.string().min(1).max(200) },
            conversation_id: { type: 'string', description: 'Continue a specific existing thread by its id: the one a send returned, or one from aimeat_dm_inbox.', zod: z.string().min(8).max(64) },
            attachments: { type: 'array', description: 'Up to 20 attachment descriptors { storage_key, mime, kind, size, name }, each pre-uploaded via aimeat_storage_upload.', zod: z.array(MessageAttachmentInputSchema).max(20) },
        },
    },
    {
        name: 'aimeat_dm_broadcast',
        description: 'Tell MANY people or agents the same thing in ONE call, instead of looping aimeat_dm_send. Every copy is an ordinary 1:1 thread the recipient can answer privately, and every copy carries one shared broadcast id — which is what lets their inbox fold the copies into a single row instead of one row per recipient. Use this for an announcement, a status notice, or a question put to a whole fleet; use aimeat_dm_send when you are writing to one person. `subject` titles the thread each recipient sees, so name the actual thing. `mode` "announcement" makes the copies read-only (nobody can reply); "broadcast" (the default) lets each recipient answer you in their own thread. Recipients come from `to` (a list), `group_id` (a Share Group as a distribution list), or `audience` (every human on this node, or across the federation — operator only). The reply is a broadcast_id you read results with. Requires the messages:send scope.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Send One Message to Many', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'messages:send',
        input: {
            ...aiProvenanceCatalogInput,
            to: { type: 'array', description: 'Recipient identities (owner@node, agent#owner@node, eco:app#owner@node), up to 500.', zod: z.array(z.string().min(3).max(256)).max(500) },
            group_id: { type: 'string', description: 'A Share Group whose members are the audience — a reusable distribution list.', zod: z.string().min(1).max(64) },
            audience: { type: 'string', description: '"node-users" (every human on this node) or "federation-users" (that plus every owner on each active peer). OPERATOR ONLY.', zod: z.enum(['node-users', 'federation-users']) },
            mode: { type: 'string', description: '"broadcast" (default, each recipient can reply) or "announcement" (read-only, replies disabled).', zod: z.enum(['broadcast', 'announcement']) },
            subject: { type: 'string', description: 'Titles the thread each recipient sees. Without it the copies land in the nameless per-pair thread.', zod: z.string().min(1).max(200) },
            body: { type: 'string', description: 'Message body (GFM markdown). Optional only if you attach a file or send questions.', zod: z.string().max(200_000) },
            attachments: { type: 'array', description: 'Up to 20 attachment descriptors { storage_key, mime, kind, size, name }, each pre-uploaded via aimeat_storage_upload.', zod: z.array(MessageAttachmentInputSchema).max(20) },
            interactive: { type: 'object', description: 'A question set { role:"questions", v:1, questions:[…] } — makes it a poll fanned out to everyone.', zod: z.object({
                role: z.literal('questions'), v: z.literal(1),
                questions: z.array(InteractiveQuestionSchema).min(1).max(20),
                submitLabel: z.string().max(60).optional(),
            }) },
        },
    },
    {
        name: 'aimeat_dm_send_as_owner',
        description: 'Send a federated direct message AS THE OWNER (a consented delegation), not as your own agent identity — this is how you reply to the owner\'s "Postilaatikko" conversations on their behalf so the reply comes FROM the owner, in the owner\'s existing thread. The recipient sees it as from the owner (the human), exactly as if they had sent it from the AIMEAT UI. Requires the messages:send-as-owner scope, which the owner grants explicitly; without it this tool is not available and you should hand the drafted reply back for the owner to send themselves. The sender is always your OWN owner (derived server-side) — you can never send as anyone else. Pass the owner\'s conversation_id (from the reply context) so it lands in the right thread. Attach files via aimeat_storage_upload first. Prefer this over aimeat_dm_send when the human asked you to reply for them.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Send Federated Direct Message As Owner', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        // Delegated "reply as me": send a federated DM AS THE OWNER. Its own scope so the owner grants it
        // deliberately (it is part of the full '*' bundle; granular agents opt in separately). The sender is
        // still derived server-side from the agent's owner, so the scope never enables cross-owner sends.
        scope: 'messages:send-as-owner',
        surfaces: ['agent'],
        input: {
            ...aiProvenanceCatalogInput,
            to: { type: 'string', required: true, description: 'Recipient: owner@node, agent#owner@node, or eco:app#owner@node.', zod: z.string().min(3).max(256) },
            body: { type: 'string', description: 'Message body (GFM markdown). Optional only if you attach ≥1 file.', zod: z.string().max(50000) },
            reply_to: { type: 'string', description: 'Id of a message you are replying to (keeps the same thread).', zod: z.string().uuid() },
            subject: { type: 'string', description: 'Open a NEW topic thread with this title (else the default thread / conversation_id).', zod: z.string().min(1).max(200) },
            conversation_id: { type: 'string', description: 'The owner\'s existing thread with the recipient, so the reply lands there.', zod: z.string().min(8).max(64) },
            attachments: { type: 'array', description: 'Up to 20 attachment descriptors { storage_key, mime, kind, size, name }, each pre-uploaded via aimeat_storage_upload.', zod: z.array(MessageAttachmentInputSchema).max(20) },
        },
    },
    {
        name: 'aimeat_dm_delete_as_owner',
        description: "Remove one message from the OWNER's mailbox, as the owner \u2014 the same delete a person makes from the Messages page. Use it when the human asks you to clear something out of their inbox: a thread they are done with, a message they do not want kept. It removes the owner's copy only; the other side keeps theirs, and there is no undo, so name what you are about to remove and let them say yes before you call this. The mailbox is always your OWN owner's (derived server-side), so you can never reach another account's messages. Requires the messages:delete-as-owner scope, which the owner grants on its own tick \u2014 \"Full access\" does not carry it, and without it this tool is not available and you should hand back the message id for the owner to remove themselves.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: "Delete a Message From the Owner's Mailbox", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        // Removing one message from the owner's mailbox, as the owner. A word of its own rather than
        // send-as-owner: that one is already granted and is what "Reply with AI" runs on, so reusing it
        // would hand every agent holding it the power to destroy the owner's correspondence with nobody
        // asked. NOT part of the '*' bundle either (utils/scope-coverage.ts) -- it costs its own tick.
        scope: 'messages:delete-as-owner',
        input: {
            message_id: { type: 'string', required: true, description: "Id of the message to remove, from aimeat_dm_inbox or aimeat_dm_thread.", zod: z.string().min(1).max(200) },
        },
    },
    {
        name: 'aimeat_dm_inbox_as_owner',
        description: "Read the OWNER's own mailbox, as the owner: their conversations newest first, each with the other party, the last message and how many are unread, plus the first-contact requests waiting for them and a display name for everyone listed. Use it when the human asks what is in their inbox, or before you reply for them, to find the thread. aimeat_dm_inbox is different: it reads the messages sent to YOU. This shows the owner's own threads only (not the threads their other agents had), and reading marks nothing as read. The mailbox is always your OWN owner's (derived server-side). Requires the messages:read-as-owner scope, which the owner grants on its own tick (\"Full access\" does not carry it); without it this tool is not available.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: "Read the Owner's Mailbox", readOnlyHint: true },
        // Reading the owner's own mailbox, as the owner. `messages:read` on an agent is the agent's own
        // messages (aimeat_dm_inbox below), so this is its own word, and NOT part of the '*' bundle: a
        // read leaves nothing behind for the owner to see. Same doors as REST (GET /v1/messages/overview
        // and /conversations/:id) through services/owner-mailbox-reads.ts.
        scope: 'messages:read-as-owner',
        surfaces: ['agent'],
        input: {
            limit: { type: 'number', description: 'At most this many conversations, newest first (default 30, max 200). conversations_total says how many there are.', zod: z.number().int().positive().max(200) },
            unread_only: { type: 'boolean', description: 'Only conversations with something unread.' },
        },
    },
    {
        name: 'aimeat_dm_thread_as_owner',
        description: "Read one conversation from the OWNER's own mailbox, as the owner, oldest first: every message the owner sent and received in it, with attachments and how each message was made. Use it to read the thread you are about to answer with aimeat_dm_send_as_owner, so the reply fits what was already said. Get the conversation_id from aimeat_dm_inbox_as_owner or from the reply context. Reading marks nothing as read. The mailbox is always your OWN owner's (derived server-side). Requires the messages:read-as-owner scope, which the owner grants on its own tick (\"Full access\" does not carry it); without it this tool is not available.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: "Read a Thread From the Owner's Mailbox", readOnlyHint: true },
        scope: 'messages:read-as-owner',
        surfaces: ['agent'],
        input: {
            conversation_id: { type: 'string', required: true, description: "The owner's conversation id.", zod: z.string().min(8).max(64) },
            page: { type: 'number', description: 'Page number (default 1).', zod: z.number().int().positive() },
            per_page: { type: 'number', description: 'Messages per page (default 50, max 200).', zod: z.number().int().positive().max(200) },
        },
    },
    {
        name: 'aimeat_dm_archive_as_owner',
        description: "Archive conversations in the OWNER's Messages list, as the owner, or bring them back with restore: true. Use it when the human asks you to tidy their inbox: \"archive my agents' coordination threads\", \"put those announcements away\". Nothing is deleted. An archived conversation moves to the Archive section at the bottom of the list, and comes back by itself when somebody other than the owner's own agents writes in it; one of their agents writing (an acknowledgement, a heartbeat) leaves it archived. Restoring keeps a conversation in the list, so no rule and no age limit archives it again on its own. Get conversation ids from aimeat_dm_inbox_as_owner, whose rows say which section each is in. The list is always your OWN owner's (derived server-side). Tell the human what you archived. Requires the messages:organize-as-owner scope, which the owner grants on its own tick (\"Full access\" does not carry it); without it this tool is not available.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: "Archive or Restore the Owner's Conversations", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Organising the owner's Messages list: archiving and restoring conversations, and the rules that
        // fold, group or archive them. Its own word, NOT part of the '*' bundle: archiving deletes nothing
        // but is how a message stops being seen. Same doors as REST (GET/PUT /v1/messages/organize and
        // POST /v1/messages/organize/archive) through services/inbox-organize/record.ts.
        scope: 'messages:organize-as-owner',
        surfaces: ['agent'],
        input: {
            conversation_ids: { type: 'array', required: true, description: 'Conversation ids to archive or restore (1-500), from aimeat_dm_inbox_as_owner.', zod: z.array(z.string().regex(CONVERSATION_ID)).min(1).max(500) },
            restore: { type: 'boolean', description: 'true brings the conversations back to the list instead of archiving them.' },
        },
    },
    {
        name: 'aimeat_dm_organize_as_owner',
        description: "Read or change how the OWNER's Messages list is organised, as the owner. Called with nothing, it returns the current settings and rules. The list has sections: people, the owner's own agents (conversations between the owner and their agents, and between those agents), one heading per group rule, and the archive. auto_archive_enabled and auto_archive_days archive the own agents' conversations after that many days without a message, unless a message to the owner in them is unread (on by default, 14 days). fold_same_subject shows conversations that one sender opened with the same subject within an hour as one row; a conversation somebody answered gets its own row back, except between the owner's own agents. add_rule adds a rule { name, action, match }: action \"fold\" makes the matching conversations one row, \"group\" puts them under a heading of their own (the rule's name), \"archive\" sends them to the archive; match takes with (part of an identity in the conversation), subject (text the subject contains), body (text the newest message contains), older_than_days, and scope \"agents\" (default: only the own agents' conversations) or \"all\". The first enabled rule that matches decides. An archived conversation comes back when somebody other than the owner's own agents writes in it after the rule was made. Give add_rule an existing id to edit that rule; remove_rule takes an id; rules replaces the whole list. Say what you changed in words the human uses. The list is always your OWN owner's. Requires the messages:organize-as-owner scope, which the owner grants on its own tick (\"Full access\" does not carry it).",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: "Organise the Owner's Messages List", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'messages:organize-as-owner',
        surfaces: ['agent'],
        input: {
            auto_archive_enabled: { type: 'boolean', description: "Archive the own agents' conversations by age." },
            auto_archive_days: { type: 'number', description: 'Days without a message before that happens (1-365).', zod: z.number().int().min(1).max(365) },
            fold_same_subject: { type: 'boolean', description: 'One row for conversations one sender opened with the same subject within an hour.' },
            add_rule: { type: 'object', description: 'A rule { id?, name, enabled?, action: "fold" | "group" | "archive", match: { with?, subject?, body?, scope?: "agents" | "all", older_than_days? } }.', zod: InboxRuleInputSchema },
            remove_rule: { type: 'string', description: 'Id of a rule to remove.', zod: z.string().regex(/^[a-z0-9-]{1,40}$/) },
            rules: { type: 'array', description: 'Replace every rule with this list (same shape as add_rule).', zod: z.array(InboxRuleInputSchema).max(50) },
        },
    },
    {
        name: 'aimeat_dm_ask',
        description: 'Ask a person a STRUCTURED question through the federated inbox — a federated AskUserQuestion. Instead of free text, you send option-based questions the human answers by tapping choices (radio for single-select, checkboxes for multiSelect) plus an always-available "Other" freeform, then Send. Use this to map intent / clarify BEFORE acting. Send one or more questions; for adaptive follow-ups, send another aimeat_dm_ask after reading the answer. The answer comes back as a normal reply you read via aimeat_dm_inbox / aimeat_dm_thread, where interactive.answers is the machine-readable result keyed by your question id. Same recipients + threading as aimeat_dm_send. Requires the messages:send scope.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Ask a Structured Question (Federated)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'messages:send',
        surfaces: ['agent'],
        input: {
            ...aiProvenanceCatalogInput,
            to: { type: 'string', required: true, description: 'Recipient: owner@node, agent#owner@node, or eco:app#owner@node.', zod: z.string().min(3).max(256) },
            questions: { type: 'array', required: true, description: '1–20 questions, each { id, header (short chip), prompt, options:[{id,label}], multiSelect?, allowOther? (default true), required? }.', zod: z.array(InteractiveQuestionSchema).min(1).max(20) },
            body: { type: 'string', description: 'Optional intro text shown above the questions (GFM markdown).', zod: z.string().max(50000) },
            subject: { type: 'string', description: 'Open a NEW topic thread with this title (else the default thread / conversation_id).', zod: z.string().min(1).max(200) },
            conversation_id: { type: 'string', description: 'Continue a specific existing thread by id.', zod: z.string().min(8).max(64) },
            submit_label: { type: 'string', description: 'Optional label for the submit button (default localized "Send answers").', zod: z.string().min(1).max(80) },
        },
    },
    {
        name: 'aimeat_dm_inbox',
        description: 'Read recent federated direct messages addressed to THIS agent (across the inbox / "Postilaatikko") — replies and messages people sent you, newest first. A reply to an agent is delivered to its owner\'s inbox, so this lists messages where you are the recipient. Each item has id, conversation_id, subject, from, body, attachments, interactive (a question spec or the human\'s answers) and created_at. Use aimeat_dm_thread for a full conversation. Distinct from aimeat_message_inbox (the agent↔owner dashboard channel). Requires the messages:read scope.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Federated DM Inbox', readOnlyHint: true },
        scope: 'messages:read',
        surfaces: ['agent'],
        input: {
            page: { type: 'number', description: 'Page number (default 1).', zod: z.number().int().positive() },
            per_page: { type: 'number', description: 'Messages per page (default 20, max 100).', zod: z.number().int().positive().max(100) },
        },
    },
    {
        name: 'aimeat_dm_thread',
        description: 'Read a full federated direct-message thread as THIS agent sees it (your sent messages + the messages addressed to you), oldest-first, for one conversation_id (from aimeat_dm_inbox or aimeat_dm_send). Requires the messages:read scope.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Federated DM Thread', readOnlyHint: true },
        scope: 'messages:read',
        surfaces: ['agent'],
        input: {
            conversation_id: { type: 'string', required: true, description: 'Conversation id to read.', zod: z.string().min(8).max(64) },
            page: { type: 'number', description: 'Page number (default 1).', zod: z.number().int().positive() },
            per_page: { type: 'number', description: 'Messages per page (default 50, max 200).', zod: z.number().int().positive().max(200) },
        },
    },
    {
        // ── Contacts (address book) — server MCP only, like the email-invite tools. ──
        name: 'aimeat_contact_list',
        description: "The owner's address book: everyone they saved, everyone they have exchanged direct messages with, and every PERSON they wrote down who has no account on this node. Each entry carries kind (ghii = a person here, gaii = an agent, geai = an app, mail = a person with no account here), the name to show, their email when one is known, and origin ('saved' vs 'message'). Use it as the identity source when granting access — pair a ghii contact with aimeat_organism_invite, aimeat_organism_member_add, or aimeat_workspace_member_grant. A 'mail' contact cannot be granted anything until they join; invite them with aimeat_organism_invite_email. It takes contacts:read, here and on GET /v1/contacts alike. The conversation columns (last message, who wrote it, when, how many, the conversation id) are empty unless you may also read the owner's mailbox (messages:read-as-owner), and include \"together\" is answered only with organism:read.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'List Contacts', readOnlyHint: true },
        // Listing the book has its own word since 2026-10-01: contacts:read, the word GET /v1/contacts
        // asks, which the tool calls. The conversation fields on each row stay empty unless the caller
        // may also read the owner's mailbox (messages:read-as-owner for an agent).
        scope: 'contacts:read',
        surfaces: ['agent'],
        input: {
            q: { type: 'string', description: 'Filter by id, name or email (case-insensitive substring).' },
            state: { type: 'string', enum: ['pending', 'accepted', 'blocked'], description: 'Narrow to one consent state (default hides blocked). Only identities have one, so this excludes saved people.' },
            include: { type: 'string', description: 'Comma-separated extras. "together": the organisms each person and the owner share, on every ghii row. "invites": the owner\'s open invitation on every person without an account.' },
        },
    },
    {
        name: 'aimeat_contact_invite',
        description: "Invite a person to join this AIMEAT with no organism behind it: they get an email in the owner's name with a link that opens an account here, and if the owner wrote them down as a contact, that entry becomes them when they arrive. Refused when the address already has an account (add them with aimeat_contact_add instead), when the owner's own invitation to it is still open, or when the owner has too many open. To invite someone INTO an organism, use aimeat_organism_invite_email. Send one only when the owner asks: it is an email in their name. It takes messages:send, here and on POST /v1/contacts/invite alike. An invitation counts as an address lookup: one account has 20 in 10 minutes, the owner and all their agents together, and past that the answer is RATE_LIMITED with the seconds to wait.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Invite a Person by Email', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'messages:send',
        surfaces: ['agent'],
        input: {
            email: { type: 'string', required: true, description: 'The address to invite.', zod: z.string().max(200) },
            message: { type: 'string', description: 'A short message from the owner, carried in the email.', zod: z.string().max(1000) },
        },
    },
    {
        name: 'aimeat_contact_add',
        description: "Save someone to the owner's address book, in one of two ways. An IDENTITY on some node: pass contact_id (a bare local owner name, a GHII, a GAII or a GEAI); a local one that does not exist is refused. A PERSON who has no account here: pass name + email, plus anything else the owner knows (note, tags, links, relation) — that is how you record someone they follow, someone they mean to invite, or a plain email contact. If that address later belongs to a verified account here, the entry becomes that person automatically and nothing the owner wrote is lost. A blocked contact stays blocked (unblock via the Messages flow first). Saving a person by email counts as an address lookup: one account has 20 in 10 minutes, the owner and all their agents together, and past that the answer is RATE_LIMITED with the seconds to wait.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Add Contact', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'messages:send',
        surfaces: ['agent'],
        input: {
            contact_id: { type: 'string', description: 'An identity: bare local owner name, owner@node, agent#owner@node, or eco:app#owner@node. Omit when saving a person by name + email.' },
            name: { type: 'string', description: "A person's name, as the owner would write it. Required with email.", zod: z.string().max(140) },
            email: { type: 'string', description: "A person's email address. Required with name. This is what links them to an account if they join later.", zod: z.string().max(200) },
            note: { type: 'string', description: 'Anything the owner wants to remember about this person.', zod: z.string().max(1000) },
            tags: { type: 'array', description: "The owner's own labels for this person: an array of strings.", zod: z.array(z.string().max(40)).max(20) },
            links: { type: 'array', description: 'Where else this person is: an array of { label, url }. http(s) addresses only.', zod: z.array(LinkSchema).max(12) },
            relation: { type: 'string', description: "The owner's own word for the relationship (for example: following, to invite, colleague).", zod: z.string().max(40) },
        },
    },
    {
        name: 'aimeat_contact_remove',
        description: "Remove a contact from the owner's address book WITHOUT disturbing the direct-message first-contact gate: a contact with message history keeps its messaging state (only the 'saved' mark is dropped); a pure saved contact is deleted. Removing a saved person deletes what the owner wrote about them; anything already sent to them stays in the send log.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Remove Contact', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'messages:send',
        surfaces: ['agent'],
        input: {
            contact_id: { type: 'string', required: true, description: 'The contact id to remove (from aimeat_contact_list).' },
        },
    },
    {
        name: 'aimeat_contact_resolve_email',
        description: 'Look up a LOCAL owner by email — EXACT match only (privacy-preserving hash; no enumeration or substring search). Found → their GHII + display name (add with aimeat_contact_add, or grant access directly). Not found → can_invite signals whether an email invitation could be sent instead (aimeat_organism_invite_email). The same endpoint as POST /v1/contacts/resolve, on the messages:read permission. One account has 20 lookups in 10 minutes, the owner and all their agents together, and saving a person by email with aimeat_contact_add counts as one; past that the answer is RATE_LIMITED with the seconds to wait.',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Resolve Email to Owner', readOnlyHint: true },
        scope: 'messages:read',
        surfaces: ['agent'],
        input: {
            email: { type: 'string', required: true, description: 'Email address to look up (exact match).' },
        },
    },
    {
        name: 'aimeat_agents_list',
        description: "List the calling owner's agents on the node (name, mode, capabilities, tags, last_seen, etc.). Use this to discover which agents you can delegate to via aimeat_task_create. Each agent also carries its permissions (default_scopes), what it asked for at its last approval (scope_request), and `refusals`: calls the node refused it for a missing permission that is still missing. A refusal is often why an agent's tasks do not move; tell the owner which permission to grant.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List My Agents', readOnlyHint: true },
        surfaces: ['agent', 'service', 'chat'],
        input: {},
    },

    // The A2A v2 message, push and task tools: ./agent-v2.ts, spread in place.
    ...agentV2Tools,
] as const satisfies readonly AimeatToolDefinition[];
