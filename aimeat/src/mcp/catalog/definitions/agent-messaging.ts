/**
 * @file agent-messaging.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Handbook/onboarding, agent self-management (capabilities, activity, telemetry, tags, mode), owner-agent messaging, and federated direct-message (DM) tool definitions, plus aimeat_agents_list.
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   v1.1.0 — 2026-08-13 — aimeat_agent_console_set: an agent that creates a sibling in a fleet
 *     runtime reports back where the owner can go and look at it.
 *   v1.0.0 — 2026-07-13 — Extracted from definitions.ts (pure extraction; no behavior change).
 */

import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

export const agentMessagingTools: AimeatToolDefinition[] = [
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
        name: 'aimeat_usage_report',
        description: 'Answer "what did we actually use, and what did it cost" for the owner behind this session: spend per model, per app, per agent, per day, plus which tools get called and which of them refuse or fail. Reads a precomputed layer, so it is cheap however large the history is, and it says how fresh it is. Scoped to this owner and to nobody else. Use it for a spend or usage question; use aimeat_agent_activity for one agent own counters.',
        // 'agent' in the catalog's sense (the caller is a session principal), though an owner session
        // reaches it too — both resolve to the same human account, which is the only account it can
        // report on.
        caller: 'agent',
        // publicMcp + connectorMcp, no cliFallback: there is no `aimeat connect` handler for it, and
        // claiming one would fail the parity gate rather than quietly not work.
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: false },
        input: {
            report: { type: 'string', enum: ['day', 'model', 'app', 'agent', 'tool', 'surface', 'apps-used', 'activity', 'sold'], description: 'Which report to read.' },
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
        input: {},
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
        description: "Replace (set) the tag list on a same-owner agent. An agent may tag itself (or a same-owner sibling); an owner may tag any of their agents. Convention: 'crew:<name>', 'source:<name>', 'role:<name>', 'project:<name>' — but any lowercase string of alphanumerics plus `._:-` is accepted (no `@`). Max 20 tags. Empty array clears all tags.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose tags to update (must be owned by the same owner as the caller). Pass the calling agent\'s own name to self-tag.' },
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
        name: 'aimeat_agent_console_set',
        description: "Record where an agent is managed by whatever HOSTS it: its settings or brain page in the fleet runtime it runs in. Call this after creating and starting an agent somewhere the node cannot see — an agent hatchery instance, a cockpit, your own daemon's UI — so the owner's profile can link straight to it. Without it the person is told their agent is running and has nowhere to go and look at it. Must be an absolute http(s) URL; send an empty string to clear it. Display only: the node links this address and never fetches it.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            target_agent_name: { type: 'string', required: true, description: 'Agent whose console address to set (must be owned by the same owner as the caller). Pass your own name to record your own.' },
            console_url: { type: 'string', required: true, description: "Absolute http(s) URL of that agent's page in its host, or '' to clear it." },
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
        description: 'Send a message from this agent to its owner\'s conversation (markdown supported). Omit thread_id to start a new thread, or pass a thread_id from aimeat_message_inbox to reply in an existing one. Optionally link a task or attach metadata. Metadata can carry a proposed_task (for the owner to approve) OR a prompt — a single-select question of the form {prompt_id, question, options[], allow_other}: the owner picks one of your options as a chip in the UI (an "Other" free-text choice is always offered automatically — do NOT add it to options). Because you authored the options, you can interpret the answer unambiguously. Read the answer back with aimeat_message_history and match prompt_answer.prompt_id to your prompt_id. This is the agent→human channel; it does not deliver to other agents.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            ...aiProvenanceCatalogInput,
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
        name: 'aimeat_dm_send',
        description: 'Send a direct message across the AIMEAT federation FROM this agent TO any person (owner@node), agent (agent#owner@node) or app (eco:app#owner@node) — this is the federation-wide inbox ("Postilaatikko"), NOT the agent↔owner channel (that is aimeat_message_send). The recipient sees it is from you, the agent. A message to an agent/app is delivered to that identity\'s owner inbox. First contact lands in the recipient\'s requests until they accept. To attach files (up to 20): first upload each via aimeat_storage_upload (presigned — MCP cannot carry the bytes), then pass the returned { storage_key, mime, kind, size, name } in attachments. Requires the messages:send scope.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            ...aiProvenanceCatalogInput,
            to: { type: 'string', required: true, description: 'Recipient: owner@node, agent#owner@node, or eco:app#owner@node.' },
            body: { type: 'string', description: 'Message body (GFM markdown). Optional only if you attach ≥1 file.' },
            reply_to: { type: 'string', description: 'Id of a message you are replying to (keeps the same thread).' },
            attachments: { type: 'array', description: 'Up to 20 attachment descriptors { storage_key, mime, kind, size, name }, each pre-uploaded via aimeat_storage_upload.' },
        },
    },
    {
        name: 'aimeat_dm_send_as_owner',
        description: 'Send a federated direct message AS THE OWNER (a consented delegation), not as your own agent identity — this is how you reply to the owner\'s "Postilaatikko" conversations on their behalf so the reply comes FROM the owner, in the owner\'s existing thread. The recipient sees it as from the owner (the human), exactly as if they had sent it from the AIMEAT UI. Requires the messages:send-as-owner scope, which the owner grants explicitly; without it this tool is not available and you should hand the drafted reply back for the owner to send themselves. The sender is always your OWN owner (derived server-side) — you can never send as anyone else. Pass the owner\'s conversation_id (from the reply context) so it lands in the right thread. Attach files via aimeat_storage_upload first. Prefer this over aimeat_dm_send when the human asked you to reply for them.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            ...aiProvenanceCatalogInput,
            to: { type: 'string', required: true, description: 'Recipient: owner@node, agent#owner@node, or eco:app#owner@node.' },
            body: { type: 'string', description: 'Message body (GFM markdown). Optional only if you attach ≥1 file.' },
            reply_to: { type: 'string', description: 'Id of a message you are replying to (keeps the same thread).' },
            subject: { type: 'string', description: 'Open a NEW topic thread with this title (else the default thread / conversation_id).' },
            conversation_id: { type: 'string', description: 'The owner\'s existing thread with the recipient, so the reply lands there.' },
            attachments: { type: 'array', description: 'Up to 20 attachment descriptors { storage_key, mime, kind, size, name }, each pre-uploaded via aimeat_storage_upload.' },
        },
    },
    {
        name: 'aimeat_dm_ask',
        description: 'Ask a person a STRUCTURED question through the federated inbox — a federated AskUserQuestion. Instead of free text, you send option-based questions the human answers by tapping choices (radio for single-select, checkboxes for multiSelect) plus an always-available "Other" freeform, then Send. Use this to map intent / clarify BEFORE acting. Send one or more questions; for adaptive follow-ups, send another aimeat_dm_ask after reading the answer. The answer comes back as a normal reply you read via aimeat_dm_inbox / aimeat_dm_thread, where interactive.answers is the machine-readable result keyed by your question id. Same recipients + threading as aimeat_dm_send. Requires the messages:send scope.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            ...aiProvenanceCatalogInput,
            to: { type: 'string', required: true, description: 'Recipient: owner@node, agent#owner@node, or eco:app#owner@node.' },
            questions: { type: 'array', required: true, description: '1–20 questions, each { id, header (short chip), prompt, options:[{id,label}], multiSelect?, allowOther? (default true), required? }.' },
            body: { type: 'string', description: 'Optional intro text shown above the questions (GFM markdown).' },
            subject: { type: 'string', description: 'Open a NEW topic thread with this title (else the default thread / conversation_id).' },
            conversation_id: { type: 'string', description: 'Continue a specific existing thread by id.' },
            submit_label: { type: 'string', description: 'Optional label for the submit button (default localized "Send answers").' },
        },
    },
    {
        name: 'aimeat_dm_inbox',
        description: 'Read recent federated direct messages addressed to THIS agent (across the inbox / "Postilaatikko") — replies and messages people sent you, newest first. A reply to an agent is delivered to its owner\'s inbox, so this surfaces messages where you are the recipient. Each item has id, conversation_id, subject, from, body, attachments, interactive (a question spec or the human\'s answers) and created_at. Use aimeat_dm_thread for a full conversation. Distinct from aimeat_message_inbox (the agent↔owner dashboard channel). Requires the messages:read scope.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            page: { type: 'number', description: 'Page number (default 1).' },
            per_page: { type: 'number', description: 'Messages per page (default 20, max 100).' },
        },
    },
    {
        name: 'aimeat_dm_thread',
        description: 'Read a full federated direct-message thread as THIS agent sees it (your sent messages + the messages addressed to you), oldest-first, for one conversation_id (from aimeat_dm_inbox or aimeat_dm_send). Requires the messages:read scope.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            conversation_id: { type: 'string', required: true, description: 'Conversation id to read.' },
            page: { type: 'number', description: 'Page number (default 1).' },
            per_page: { type: 'number', description: 'Messages per page (default 50, max 200).' },
        },
    },
    {
        // ── Contacts (address book) — server MCP only, like the email-invite tools. ──
        name: 'aimeat_contact_list',
        description: "The owner's address book: everyone they saved, everyone they have exchanged direct messages with, and every PERSON they wrote down who has no account on this node. Each entry carries kind (ghii = a person here, gaii = an agent, geai = an app, mail = a person with no account here), the name to show, their email when one is known, and origin ('saved' vs 'message'). Use it as the identity source when granting access — pair a ghii contact with aimeat_organism_invite, aimeat_organism_member_add, or aimeat_workspace_member_grant. A 'mail' contact cannot be granted anything until they join; invite them with aimeat_organism_invite_email.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            q: { type: 'string', description: 'Filter by id, name or email (case-insensitive substring).' },
            state: { type: 'string', enum: ['pending', 'accepted', 'blocked'], description: 'Narrow to one consent state (default hides blocked). Only identities have one, so this excludes saved people.' },
        },
    },
    {
        name: 'aimeat_contact_add',
        description: "Save someone to the owner's address book, in one of two ways. An IDENTITY on some node: pass contact_id (a bare local owner name, a GHII, a GAII or a GEAI); a local one that does not exist is refused. A PERSON who has no account here: pass name + email, plus anything else the owner knows (note, tags, links, relation) — that is how you record someone they follow, someone they mean to invite, or a plain email contact. If that address later belongs to a verified account here, the entry becomes that person automatically and nothing the owner wrote is lost. A blocked contact stays blocked (unblock via the Messages flow first).",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            contact_id: { type: 'string', description: 'An identity: bare local owner name, owner@node, agent#owner@node, or eco:app#owner@node. Omit when saving a person by name + email.' },
            name: { type: 'string', description: "A person's name, as the owner would write it. Required with email." },
            email: { type: 'string', description: "A person's email address. Required with name. This is what links them to an account if they join later." },
            note: { type: 'string', description: 'Anything the owner wants to remember about this person.' },
            tags: { type: 'array', description: "The owner's own labels for this person: an array of strings." },
            links: { type: 'array', description: 'Where else this person is: an array of { label, url }. http(s) addresses only.' },
            relation: { type: 'string', description: "The owner's own word for the relationship (for example: following, to invite, colleague)." },
        },
    },
    {
        name: 'aimeat_contact_remove',
        description: "Remove a contact from the owner's address book WITHOUT disturbing the direct-message first-contact gate: a contact with message history keeps its messaging state (only the 'saved' mark is dropped); a pure saved contact is deleted. Removing a saved person deletes what the owner wrote about them; anything already sent to them stays in the send log.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            contact_id: { type: 'string', required: true, description: 'The contact id to remove (from aimeat_contact_list).' },
        },
    },
    {
        name: 'aimeat_contact_resolve_email',
        description: 'Look up a LOCAL owner by email — EXACT match only (privacy-preserving hash; no enumeration or substring search). Found → their GHII + display name (add with aimeat_contact_add, or grant access directly). Not found → can_invite signals whether an email invitation could be sent instead (aimeat_organism_invite_email).',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            email: { type: 'string', required: true, description: 'Email address to look up (exact match).' },
        },
    },
    {
        name: 'aimeat_agents_list',
        description: "List the calling owner's agents on the node (name, mode, capabilities, tags, last_seen, etc.). Use this to discover which agents you can delegate to via aimeat_task_create.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
];
