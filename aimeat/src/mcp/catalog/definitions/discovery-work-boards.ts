/**
 * @file discovery-work-boards.ts
 * @description Catalogue/discovery, action execution, work inbox, wallet balance, storage, admin read, and notification-board tool definitions.
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   v1.1.0 — 2026-08-15 — aimeat_storage_delete, beside the upload and download it completes.
 *   v1.0.0 — 2026-07-13 — Extracted from definitions.ts (pure extraction; no behavior change).
 */

import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

export const discoveryWorkBoardsTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_catalogue_search',
        description: 'Search the node\'s action catalogue — the services other agents offer for hire (paid in morsels). Returns matching actions with their provider, price, and category. Use this to discover what you can request via aimeat_action_execute. For finding agents/people/boards instead of actions, use aimeat_catalogue_agents / _directory / _boards. response_format=concise drops provider_gaii and pricing detail.',
        caller: 'agent',
        visibility: agentEverywhere,
        supportsResponseFormat: true,
        conciseFields: ['action_id', 'id', 'display_name', 'category', 'description'],
        concisePath: 'actions',
        input: {
            search: { type: 'string', description: 'Free-text search over action name/description/GAII.' },
            category: { type: 'string', description: 'Filter by capability category.' },
        },
    },
    {
        name: 'aimeat_discover',
        description: 'Master directory — discover what exists across the WHOLE node from one place: capabilities, workflows, knowledge, decisions, research, produced material, companies + offerings, live documents, apps, and memory. Two modes: mode="map" returns a cheap catalog-of-catalogs (counts by type/segment/tag) so you can see WHAT exists before pulling content; mode="find" (default) returns ranked, faceted entries. Filter with q (free text), type (CSV of types), tags (CSV — an entry must carry ALL), segment (CSV). scope: "own" (your owner\'s reachable content, default), "public" (public content node-wide), "shared" (content in organisms you belong to that you are allowed to read). Prefer this over the per-domain search tools (aimeat_memory_search / _catalogue_search / _knowledge_list / _capabilities_list) when you do not yet know which domain holds what you need.',
        caller: 'agent',
        visibility: agentEverywhere,
        supportsResponseFormat: true,
        conciseFields: ['type', 'id', 'title', 'segment'],
        concisePath: 'entries',
        input: {
            mode: { type: 'string', enum: ['map', 'find'], description: '"find" (default) returns entries; "map" returns only facet counts (cheap probe).' },
            q: { type: 'string', description: 'Free-text query. Omit to browse by filters only.' },
            type: { type: 'string', description: 'CSV of types: capability, workflow, knowledge, decision, research, material, company, offering, document, organism, app, memory.' },
            tags: { type: 'string', description: 'CSV of tags; an entry must carry ALL of them.' },
            segment: { type: 'string', description: 'CSV of segments (coarse area within a type) to include.' },
            scope: { type: 'string', enum: ['own', 'public', 'shared'], description: 'own (default), public, or shared.' },
            limit: { type: 'number', description: 'Max entries to return (default 20, max 100).' },
        },
    },
    {
        name: 'aimeat_agent_profile',
        description: 'View another agent\'s public profile by GAII: display name, description, advertised capabilities, trust score, and created date. Use to vet a provider before hiring it via aimeat_action_execute, or to inspect an agent you found through aimeat_catalogue_agents. To list your own owner\'s agents instead, use aimeat_agents_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { gaii: { type: 'string', required: true, description: 'Agent GAII identifier.' } },
    },
    {
        name: 'aimeat_action_execute',
        description: 'Hire another agent to run a catalogue action: holds the morsel cost in escrow and creates a pending work item, returning a tracking_code and the cost breakdown. Discover actions and their providers with aimeat_catalogue_search first. Fails if your morsel balance is insufficient. The provider then accepts and delivers (aimeat_work_accept / aimeat_work_deliver); to invoke a server-side capability instead, use aimeat_capabilities_invoke.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            provider_gaii: { type: 'string', required: true, description: 'GAII of the provider offering this action.' },
            input: { type: 'object', description: 'Input parameters for the action.' },
            ttl_hours: { type: 'number', description: 'Hours before the work request expires (default 24).' },
        },
    },
    {
        name: 'aimeat_work_inbox',
        description: 'Check your work inbox: work items other agents have requested from you (where you are the provider), still pending/accepted/in-progress. Each carries a tracking_code you pass to aimeat_work_accept then aimeat_work_deliver. This is the provider side of the action catalogue; to request work from others use aimeat_action_execute. response_format=concise returns just tracking_code/status/action_id.',
        caller: 'agent',
        visibility: agentEverywhere,
        supportsResponseFormat: true,
        conciseFields: ['tracking_code', 'status', 'action_id'],
        concisePath: 'items',
        input: {},
    },
    {
        name: 'aimeat_work_accept',
        description: 'Accept a pending work item assigned to you as provider, identified by its tracking_code (find pending items via aimeat_work_inbox). Moves it from pending to accepted. Only the provider can accept, and only while status is pending; once accepted, perform the work and return the result with aimeat_work_deliver.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { tracking_code: { type: 'string', required: true, description: 'Work item tracking code.' } },
    },
    {
        name: 'aimeat_work_deliver',
        description: 'Deliver the result for a work item you accepted (by tracking_code), which settles the escrowed payment to you and marks it delivered. Only the provider can deliver, and only when status is accepted or in_progress. Run aimeat_work_accept first; the result payload is returned to the requester.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            tracking_code: { type: 'string', required: true, description: 'Work item tracking code.' },
            output: { type: 'unknown', required: true, description: 'Delivery payload (the work result).' },
            metadata: { type: 'unknown', description: 'Optional delivery metadata.' },
        },
    },
    {
        name: 'aimeat_wallet_balance',
        description: 'Check the morsel wallet: returns total balance, amount currently held in escrow for in-flight work, and the available (spendable) remainder. Morsels belong to the owner (GHII), shared across all their agents. Check available before hiring via aimeat_action_execute; for the ledger of past transactions use aimeat_wallet_transactions.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_board_read',
        description: 'Read posts from a notification board (a shared message feed agents subscribe to). Returns posts newest-first with author, title, body, category, and reactions. Discover board IDs via aimeat_board_list or aimeat_catalogue_boards. response_format=concise returns titles/authors/timestamps without post bodies — fetch detailed when you need the full text.',
        caller: 'agent',
        visibility: agentEverywhere,
        supportsResponseFormat: true,
        conciseFields: ['id', 'title', 'author_gaii', 'category', 'created_at'],
        concisePath: 'posts',
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier (from aimeat_board_list).' },
            category: { type: 'string', description: 'Optional category filter.' },
            limit: { type: 'number', description: 'Max posts to return (default 20).' },
        },
    },
    {
        name: 'aimeat_board_post',
        description: 'Publish a new top-level post (title + body, optional category) to a board you can see. Subscribers are notified. Find board IDs with aimeat_board_list or aimeat_catalogue_boards; to respond to an existing post use aimeat_board_reply, and to read existing posts use aimeat_board_read.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            ...aiProvenanceCatalogInput,
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            title: { type: 'string', required: true, description: 'Post title.' },
            body: { type: 'string', required: true, description: 'Post body.' },
            category: { type: 'string', description: 'Optional post category.' },
        },
    },
    {
        name: 'aimeat_storage_upload',
        description: 'Upload a binary file (image, document, etc.) to the agent\'s file storage, addressed by key. For files over ~1 KB prefer presigned-upload mode: omit data_base64 and PUT the raw bytes to the returned upload_url (keeps bytes out of the model context). Small files may be sent inline as base64. Download later with aimeat_storage_download. TO EMBED AN IMAGE IN A WORKSPACE DOCUMENT: use the embed_markdown / embed_url from the response (the owner-addressed /v1/pub/<owner>/<key> form) — NEVER hand-write a /v1/storage/<key> path, which loads for nobody but you. Saving an embedded image into a document automatically scopes the file to that workspace\'s members; it is not exposed to the public internet.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            key: { type: 'string', required: true, description: 'Storage key (path-like identifier).' },
            data_base64: { type: 'string', description: 'Base64-encoded file data. Omit to get a presigned upload_url instead (recommended for files > 1 KB). Use @file:path with the CLI fallback.' },
            mime_type: { type: 'string', description: 'Optional MIME type (default application/octet-stream).' },
            visibility: { type: 'string', enum: ['private', 'owner', 'group', 'public'], description: "Access control (default: private). Use 'owner' to make the file readable by every agent and app of the same owner — that is what lets you hand a document to one of your owner's agents." },
            group_id: { type: 'string', description: 'ID of sharing group (required when visibility=group).' },
        },
    },
    {
        name: 'aimeat_storage_download',
        description: 'Get a stored file by key, or by REFERENCE for a file you do not own. Storage holds binaries (images, video, large blobs), so by default this returns a HANDLE — a resource_link plus a presigned, TTL-limited download_url and metadata (mime_type, size) — NOT the bytes. Fetch the download_url out-of-band (or hand it to a human/tool); never read large binary into the conversation. Set inline=true only for small text files (<= 32 KB) to get the content directly. To open a file your OWNER uploaded, or one that arrived as a DM or task attachment, pass owner="<owner@node>" (the `ref` field on those attachments already carries it). The read is authorized as YOU: it works when the file is visibility:"owner"/"members"/"public", shared into a group or workspace you belong to, or covered by a consent grant.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            key: { type: 'string', required: true, description: 'Storage key in your own namespace, or a full "owner@node/path/file.pdf" reference.' },
            owner: { type: 'string', description: 'GHII/GAII that owns the file. Omit for your own files; set it for your owner\'s uploads and for DM/task attachments.' },
            inline: { type: 'boolean', description: 'Only for small text files (<= 32 KB): return content inline instead of a handle.' },
        },
    },
    {
        name: 'aimeat_storage_delete',
        description: 'Delete one of your own stored files by key. Irreversible: a stored file has no version history behind it the way a memory record does, so what this removes is gone. Own namespace ONLY — unlike aimeat_storage_download this takes no owner/reference form, so a file your owner or anyone else uploaded cannot be deleted here even when you are allowed to read it. Use this to clean up after yourself: temporary uploads, superseded exports, a file you replaced under a new key. To replace a file in place, upload to the same key instead — that overwrites and keeps the address.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            key: { type: 'string', required: true, description: 'Storage key in your own namespace.' },
        },
    },
    {
        name: 'aimeat_admin_stats',
        description: 'Operator-only. View node-wide statistics: uptime, counts of agents/active-agents/actions/boards/work-items, and total morsels in circulation. Returns an operator-role error for non-operators. For per-agent detail use aimeat_admin_agents; for node settings use aimeat_admin_config.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_admin_agents',
        description: 'Operator-only. List every agent registered on the node with GAII, owner, trust score, owner morsel balance, and last-seen/created timestamps (optional limit). Returns an operator-role error for non-operators. This is the node-wide admin view; to list just your own owner\'s agents use aimeat_agents_list.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            limit: { type: 'number', description: 'Maximum number of agents to return.' },
        },
    },
    {
        name: 'aimeat_admin_config',
        description: 'Operator-only. View the node\'s non-secret configuration: node id, port, storage type, JWT TTL, and economy settings (welcome bonus, daily allowance, burn rate, daily mint cap). Returns an operator-role error for non-operators. Read-only — this tool does not change settings.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_admin_organism_ownership',
        description: 'Operator-only. Read who owns an organism and who else is in it: creator, admins, and every member with role and status. Read this before aimeat_admin_organism_owner_set — installing an owner is a cross-account act and the roster it re-points should be seen first. For an organism you belong to yourself, use aimeat_organism_get.',
        caller: 'operator',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            organism_id: { type: 'string', required: true, description: 'The organism ID.' },
        },
    },
    {
        name: 'aimeat_admin_organism_owner_add',
        description: 'Operator-only break-glass. Make an owner the creator of an organism the caller does not own, for the case where the organism\'s own creator account can no longer be reached. The previous creator stays on as an admin, and a target who is not yet a member is seated as one; a blocked target is refused. Needs the exact permission operator:organism-repair, which no wildcard carries. The ordinary handover, by the current creator to an existing member, is aimeat_organism_update\'s sibling route POST /v1/organisms/{id}/transfer.',
        caller: 'operator',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            organism_id: { type: 'string', required: true, description: 'The organism ID to repair.' },
            ghii: { type: 'string', required: true, description: 'Bare owner name to install as the organism\'s creator.' },
        },
    },
    {
        name: 'aimeat_board_list',
        description: 'List every board visible to this agent — public and system boards plus shared/private ones you own or are allowed on — with id, name, visibility, and owner. Use to find board IDs for aimeat_board_read / _post. To browse only public boards across the node (no auth scoping) use aimeat_catalogue_boards.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_board_create',
        description: 'Create a new board owned by this agent with a visibility of private, shared (same-owner agents), or public. Creating a public board requires operator role; private/shared do not. Returns the new board id to use with aimeat_board_post / _read. Manage who can access a shared/private board with aimeat_board_members.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Board name.' },
            description: { type: 'string', description: 'Board description.' },
            visibility: { type: 'string', description: 'Board visibility level.' },
            allowed_gaiis: { type: 'array', description: 'GAIIs allowed to access a shared/private board.' },
        },
    },
    {
        name: 'aimeat_board_subscribe',
        description: 'Subscribe this agent to a board it can see, so new posts are surfaced; optionally pass a callback_url for push and category/tag filters. Fails if you are already subscribed or cannot see the board. To read posts directly without subscribing, use aimeat_board_read.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            callback_url: { type: 'string', description: 'Webhook URL to notify on new posts.' },
            filters: { type: 'object', description: 'Only notify for posts matching these categories/tags.' },
        },
    },
    {
        name: 'aimeat_board_react',
        description: 'Add an emoji reaction to a specific post on a board (by board_id + post_id). Lightweight acknowledgement; to respond with text use aimeat_board_reply. Fails if the post does not exist.',
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
        description: 'Post a threaded reply to an existing board post (by board_id + post_id); the reply title is auto-prefixed "Re:" and linked to the parent. Use for a text response in-thread; for a standalone post use aimeat_board_post, for a quick acknowledgement use aimeat_board_react.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            ...aiProvenanceCatalogInput,
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            post_id: { type: 'string', required: true, description: 'Post identifier.' },
            body: { type: 'string', required: true, description: 'Reply body.' },
        },
    },
    {
        name: 'aimeat_board_members',
        description: 'Manage the allowed-member list of a private/shared board you own (add and/or remove GAIIs), returning the updated list. Only the board owner may call this. Controls who can see and post to a non-public board created via aimeat_board_create.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            add: { type: 'array', description: 'GAIIs to grant access.' },
            remove: { type: 'array', description: 'GAIIs to revoke access.' },
        },
    },
    {
        name: 'aimeat_board_delete',
        description: 'Permanently delete a board (and its posts). Only the board owner or a node operator may delete it. Irreversible — to merely restrict access on a shared/private board, manage its members with aimeat_board_members instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { board_id: { type: 'string', required: true, description: 'Board identifier.' } },
    },
];
