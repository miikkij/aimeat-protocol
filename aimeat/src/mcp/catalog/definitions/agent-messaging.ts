/**
 * @file agent-messaging.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Handbook/onboarding, agent self-management (capabilities, activity, telemetry, tags, mode), owner-agent messaging, and federated direct-message (DM) tool definitions, plus aimeat_agents_list.
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   v1.3.0 — 2026-09-01 — The five Agent v2 task tools (V5), in MCP's task shape.
 *   v1.2.0 — 2026-09-01 — The five Agent v2 messaging tools (V4): a turn between two
 *     principals of one account, and the delivery target that reaches an absent one.
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
        name: 'aimeat_agent_basics_get',
        description: "What this account would get from the one-press basic agents, and whether it can happen right now. Returns the three agents (concierge, which answers and routes; crew-forge, which makes more agents; workflow-manager, which orders work from the others), the permissions each would hold, which already exist, and whether the owner's connector is running. READ ONLY: you cannot create them. Creating agents changes the account, so the person does it themselves. Hand them `approval_url` and say `next_step` — it is already written for them and true for this account's current state — then call this again to see `enrolled` turn true.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_agent_basics_request',
        description: "Ask your owner to set up the basic agents. Puts ONE line on their open-items list — the list they already read — saying which agents are missing, and that line retires itself the moment they press the button, so nobody has to tick it off. Call aimeat_agent_basics_get first: if they are already there this answers requested:false with reason 'already_there' and writes nothing, and if you (or another of the owner's agents) already asked, it answers 'already_asked' with the standing item's id rather than printing a second line. This does NOT create the agents; creating them changes the account and the person does that themselves on the page in approval_url. Needs memory:write, because an open item is a record in the owner's own namespace.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            note: { type: 'string', description: 'Optional: one short phrase on why you are asking, shown to the person with the request.' },
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
        name: 'aimeat_notify',
        description: "Tell your OWN owner that something happened: a line in their header bell and, if they turned push on, a notification on their devices; a click opens `link`. Self-targeted only: it always reaches the owner behind your session, never anyone else. Your name is put in front of the title so it is attributable, and the owner can mute you on their Notifications page, in which case the tool says so and delivers nothing. Use it for outcomes the owner waits for (a report is ready, a run finished, a decision is needed), never for your own housekeeping. Requires the notifications:send scope.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            title: { type: 'string', required: true, description: 'What happened, in one line (max 200).' },
            body: { type: 'string', description: 'The detail, a few lines at most.' },
            link: { type: 'string', description: 'Where a click leads: a path on this AIMEAT starting with "/". Default: the Agents page.' },
            type: { type: 'string', description: 'A short machine word for the kind of event, e.g. report_ready.' },
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
            include: { type: 'string', description: 'Comma-separated extras. "together": the organisms each person and the owner share, on every ghii row. "invites": the owner\'s open invitation on every person without an account.' },
        },
    },
    {
        name: 'aimeat_contact_invite',
        description: "Invite a person to join this AIMEAT with no organism behind it: they get an email in the owner's name with a link that opens an account here, and if the owner wrote them down as a contact, that entry becomes them when they arrive. Refused when the address already has an account (add them with aimeat_contact_add instead), when the owner's own invitation to it is still open, or when the owner has too many open. To invite someone INTO an organism, use aimeat_organism_invite_email. Send one only when the owner asks: it is an email in their name.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            email: { type: 'string', required: true, description: 'The address to invite.' },
            message: { type: 'string', description: 'A short message from the owner, carried in the email.' },
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
        input: {
            to: { type: 'string', required: true, description: 'The recipient principal on this account: an agent GAII (claude#alice@node), an ecosystem app (eco:drum#alice@node) or the owner GHII (alice@node).' },
            parts: { type: 'array', required: true, description: 'Ordered parts. Each is {kind:"text",text} or {kind:"file",file:{uri,name?,mimeType?}} or {kind:"data",data:{...}}. A file part carries a URI, never bytes.' },
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
        input: {
            principal: { type: 'string', description: 'Account holder only: whose targets to list. Omit for all of them.' },
        },
    },
    {
        name: 'aimeat_v2_push_delete',
        description: 'Stop delivering to one registered target. An agent may delete its own; the account holder may delete any target on the account.',
        caller: 'agent',
        visibility: agentEverywhere,
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
        input: {
            assigned_to: { type: 'string', required: true, description: 'The principal that is to do this: an agent GAII, an ecosystem app, or the owner GHII.' },
            input: { type: 'array', required: true, description: 'What is being asked, as parts: {kind:"text",text} or {kind:"file",file:{uri}} or {kind:"data",data:{...}}. The same shape a turn carries.' },
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
        input: {
            task_id: { type: 'string', required: true, description: 'The task id.' },
        },
    },
    {
        name: 'aimeat_v2_task_status',
        description: 'Report where you have got to with work you were given. Only the assignee and the account holder may: a task\'s status is the worker\'s testimony about the work, so whoever asked for it cannot write it. Completing requires a result, failing requires a code and a message, and a task that has already settled refuses to move. To stop work you asked for, cancel it instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            task_id: { type: 'string', required: true, description: 'The task id.' },
            status: { type: 'string', enum: ['working', 'input_required', 'completed', 'failed'], required: true, description: 'Where it has got to.' },
            status_message: { type: 'string', description: 'One line for a person.' },
            result: { type: 'array', description: 'What came back, as parts. Required when completing.' },
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
        input: {
            task_id: { type: 'string', required: true, description: 'The task id.' },
            reason: { type: 'string', description: 'Why, in one line.' },
        },
    },
];
