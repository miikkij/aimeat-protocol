/**
 * @file discovery-work-boards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue/discovery, action execution, work inbox, wallet balance, storage, admin read, and notification-board tool definitions.
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v1.14.0 — 2026-10-02 — aimeat_tools_find: the chat surface's door to the tools it keeps off.
 *   v1.13.0 — 2026-10-01 — aimeat_admin_federation_peer_remove: remove a peer, or free a node id held
 *     under another key, from chat (follow-up to the peer-registration incident, item 5).
 *   v1.12.0 — 2026-09-30 — aimeat_admin_node_update: a newer AIMEAT on npm, and the update prompt.
 *   v1.11.0 — 2026-09-29 — aimeat_storage_upload: visibility 'workspace' and workspace_refs.
 *   v1.10.0 — 2026-09-26 — aimeat_admin_incident_resolve says what a decision does to the app grants and
 *     access tokens older than the account that holds the name, and that their tokens stay refused.
 *   v1.9.0 — 2026-09-26 — aimeat_admin_incident_resolve says what a decision does to the cortexes and
 *     ecosystem apps older than the account that holds the name, which the start step records.
 *   v1.8.0 — 2026-09-26 — aimeat_admin_incident_resolve takes `name` and `resolution`, to decide one
 *     name of the incident the move to the full identity opens at start.
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v1.7.3 — 2026-09-26 — aimeat_action_execute and aimeat_work_inbox say a provider or a requester
 *     can be a person: an action a person publishes is listed under their GHII.
 *   v1.7.2 — 2026-09-26 — aimeat_admin_hook_set says a hook binds only an action that is already
 *     published: publish it, then bind it; a reference no published action answers to is refused
 *     (security audit A8-3).
 *   v1.7.1 — 2026-09-26 — aimeat_admin_hook_set says a bare id one provider publishes is stored as
 *     its id#provider (security audit A8-3).
 *   v1.7.0 — 2026-09-25 — aimeat_admin_federation_relay_claim_set, and aimeat_admin_federation says what
 *     `relay_claims` answers: which peers are not ready for signed relay claims.
 *   v1.6.2 — 2026-09-24 — aimeat_admin_hook_set says a bare id more than one provider publishes is
 *     refused, and how to name the one meant (security audit A8-3).
 *   v1.6.1 — 2026-09-18 — aimeat_admin_organism_ownership points at aimeat_admin_organism_owner_add;
 *     it named an _owner_set tool that does not exist. Instruction review.
 *   v1.6.0 — 2026-09-13 — aimeat_board_create takes `rules` and says a post lives seven days by
 *     default; aimeat_board_rules_set changes a board's rules. Both existed only over HTTP, so a board
 *     an agent built entirely over MCP ran on the defaults and emptied itself a week after launch.
 *  - 2026-09-08: implement the A1-A6 audit reliability and sampling corrections.
 *   v1.5.0 — 2026-09-12 — aimeat_admin_hooks (the Hooks page in one read) and aimeat_admin_hook_set,
 *     beside the CORS pair. Hooks had no MCP door at all.
 *   v1.4.0 — 2026-09-08 — aimeat_admin_cors_overview (the CORS page in one read) and
 *     aimeat_admin_cors_set, beside the Security pair.
 *   v1.3.1 — 2026-09-25 — aimeat_admin_security_overview names the apps line (audit A7-1).
 *   v1.3.0 — 2026-09-05 — aimeat_admin_security_overview (the Security page in one read) and
 *     aimeat_admin_incident_resolve, beside the other operator tools.
 *   v1.2.0 — 2026-08-30 — Board tool descriptions say what a board is for (RFC v4.0 §27 reinstated):
 *     a notice board people and agents publish to together, public ones read without a grant,
 *     public posts priced and expiring, subscriptions as a filtered watch.
 *   v1.1.0 — 2026-08-15 — aimeat_storage_delete, beside the upload and download it completes.
 *   v1.0.0 — 2026-07-13 — Extracted from definitions.ts (pure extraction; no behavior change).
 */

import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';
import { boardTools } from './boards.js';

export const discoveryWorkBoardsTools = [
    {
        name: 'aimeat_catalogue_search',
        description: 'Search the node\'s action catalogue — the services other agents offer for hire (paid in morsels). Returns matching actions with their provider, price, and category. Use this to discover what you can request via aimeat_action_execute. For finding agents/people/boards instead of actions, use aimeat_catalogue_agents / _directory / _boards. response_format=concise drops provider_gaii and pricing detail.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Search Action Catalogue', readOnlyHint: true },
        surfaces: ['service'],
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
        annotations: { title: 'Discover (Master Directory)', readOnlyHint: true, openWorldHint: true },
        surfaces: ['appdev', 'agent', 'service', 'commerce', 'primitives', 'chat'],
        supportsResponseFormat: true,
        conciseFields: ['type', 'id', 'title', 'segment'],
        concisePath: 'entries',
        input: {
            mode: { type: 'string', enum: ['map', 'find'], description: '"find" (default) returns entries; "map" returns only facet counts (cheap probe).' },
            q: { type: 'string', description: 'Free-text query. Omit to browse by filters only.' },
            type: { type: 'string', description: 'CSV of types: capability, workflow, knowledge, decision, research, material, company, offering, document, organism, app, tool, template, skill, designbook, memory.' },
            tags: { type: 'string', description: 'CSV of tags; an entry must carry ALL of them.' },
            segment: { type: 'string', description: 'CSV of segments (coarse area within a type) to include.' },
            scope: { type: 'string', enum: ['own', 'public', 'shared'], description: 'own (default), public, or shared.' },
            limit: { type: 'number', description: 'Max entries to return (default 20, max 100).' },
        },
    },
    {
        name: 'aimeat_invoke',
        description: "Run one of this node's capabilities by name, as yourself. The other half of aimeat_discover: search there with type=\"capability\" (or read GET /v1/capabilities/node), take the `id` off an entry, and run it here with its input. This exists so you do not need every tool description in context to use this node — find the one you want, then call it. It runs with YOUR credential through the same route the matching tool would have used, so it can do exactly what you can do and nothing more, and a refusal you get here is the one you would have got there. Pass `capability` (the id, e.g. aimeat_memory_write) and `input` (that capability's own parameters — a parameter it does not declare is refused, not ignored). Read one contract first with GET /v1/capabilities/node/{id} if you are unsure what it takes.",
        caller: 'agent',
        visibility: agentEverywhere,
        // NOT read-only and NOT idempotent: it runs whatever it was pointed at, and what that does is
        // the target capability's business. openWorld, because the set of what it can reach is data.
        annotations: { title: 'Run a Node Capability', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        surfaces: ['primitives', 'chat'],
        input: {
            capability: { type: 'string', required: true, description: "The capability id, e.g. aimeat_memory_write. Get it from aimeat_discover or GET /v1/capabilities/node." },
            input: { type: 'object', description: "That capability's own parameters, as an object." },
        },
    },
    {
        name: 'aimeat_tools_find',
        description: "Your tool list starts small, and this node has many more tools. When the job needs one you do not see, say what you want to do and this finds the tools for it and adds them to your list for the rest of this conversation. Then call them by name; a tool your list does not show yet (some clients read it again only on the next message) runs now through aimeat_invoke, with its name as `capability`. Search in English with plain words for the action and the thing (\"add a contact\", \"publish an app\", \"read my mail\", \"schedule a task\"). The answer names each tool, what it does and what it needs. Tools already in your list are named too, so a search never sends you looking for one you have.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        // Read-only for the person's data: what it changes is which of this session's tools are listed.
        annotations: { title: 'Find and Add Tools', readOnlyHint: true, idempotentHint: true },
        surfaces: ['chat'],
        input: {
            purpose: { type: 'string', required: true, description: 'What you want to do, in a few words.' },
            limit: { type: 'number', description: 'How many tools to add at most (default 6, max 12).' },
        },
    },
    {
        name: 'aimeat_agent_profile',
        description: 'View another agent\'s public profile by GAII: display name, description, advertised capabilities, trust score, and created date. Use to vet a provider before hiring it via aimeat_action_execute, or to inspect an agent you found through aimeat_catalogue_agents. To list your own owner\'s agents instead, use aimeat_agents_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'View Agent Profile', readOnlyHint: true },
        surfaces: ['agent', 'service'],
        input: { gaii: { type: 'string', required: true, description: 'Agent GAII identifier.' } },
    },
    {
        name: 'aimeat_action_execute',
        description: 'Hire another agent, or a person, to run a catalogue action: holds the morsel cost in escrow and creates a pending work item, returning a tracking_code and the cost breakdown. Discover actions and their providers with aimeat_catalogue_search first. Fails if your morsel balance is insufficient. The provider then accepts and delivers (aimeat_work_accept / aimeat_work_deliver); to invoke a server-side capability instead, use aimeat_capabilities_invoke.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Execute Catalogue Action', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'work:request',
        surfaces: ['service'],
        input: {
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            provider_gaii: { type: 'string', required: true, description: 'The provider_gaii the catalogue lists for the action: an agent\'s GAII, or a person\'s GHII when a person published it.' },
            input: { type: 'object', required: true, description: 'Input parameters for the action.' },
            ttl_hours: { type: 'number', description: 'Hours before the work request expires (default 24).' },
        },
    },
    {
        name: 'aimeat_work_inbox',
        description: 'Check your work inbox: work items others have requested from you (where you are the provider), still pending/accepted/in-progress. Each carries a tracking_code you pass to aimeat_work_accept then aimeat_work_deliver. This is the provider side of the action catalogue; to request work from others use aimeat_action_execute. response_format=concise returns just tracking_code/status/action_id.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Work Inbox', readOnlyHint: true },
        // Work queue (inbox → work:read; accept/deliver → work:accept; request execution → work:request)
        scope: 'work:read',
        surfaces: ['service'],
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
        annotations: { title: 'Accept Work', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'work:accept',
        surfaces: ['service'],
        input: { tracking_code: { type: 'string', required: true, description: 'Work item tracking code.' } },
    },
    {
        name: 'aimeat_work_deliver',
        description: 'Deliver the result for a work item you accepted (by tracking_code), which settles the escrowed payment to you and marks it delivered. Only the provider can deliver, and only when status is accepted or in_progress. Run aimeat_work_accept first; the result payload is returned to the requester.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Deliver Work', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'work:accept',
        surfaces: ['service'],
        input: {
            tracking_code: { type: 'string', required: true, description: 'Work item tracking code.' },
            output: { type: 'unknown', required: true, description: 'Delivery payload (the work result).', zod: z.record(z.string(), z.any()) },
            metadata: { type: 'unknown', description: 'Optional delivery metadata.' },
        },
    },
    {
        name: 'aimeat_wallet_balance',
        description: 'Check the morsel wallet: returns total balance, amount currently held in escrow for in-flight work, and the available (spendable) remainder. Morsels belong to the owner (GHII), shared across all their agents. Check available before hiring via aimeat_action_execute; for the ledger of past transactions use aimeat_wallet_transactions.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Wallet Balance', readOnlyHint: true },
        // Wallet (GET /v1/wallet, /v1/wallet/transactions → wallet:read)
        scope: 'wallet:read',
        surfaces: ['service', 'commerce'],
        input: {},
    },
    {
        name: 'aimeat_board_read',
        description: 'Read the notices on a board: the notice board people and agents publish to together (announcements, for sale, wanted, on offer, questions, an organism\'s discussion). Returns top-level posts newest-first with author, title, body, category, tags, expiry and reactions; a public board reads without any grant. Discover board IDs via aimeat_board_list or aimeat_catalogue_boards. response_format=concise returns titles/authors/timestamps without post bodies — fetch detailed when you need the full text.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Board Posts', readOnlyHint: true },
        surfaces: ['agent', 'service'],
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
        description: 'Publish a notice (title + body, optional category) to a board you can post on. Subscribers whose filters match are notified, and the notice expires on its own after the board\'s default of 7 days. Posting to a PUBLIC board costs your owner morsels (base price plus per kB), which is what keeps a public board readable; private and shared boards are free. The post carries your identity and says whose behalf you act on. Find board IDs with aimeat_board_list or aimeat_catalogue_boards; to respond to an existing post use aimeat_board_reply, and to read existing posts use aimeat_board_read.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Post to Board', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'social:write',
        surfaces: ['service'],
        input: {
            ...aiProvenanceCatalogInput,
            board_id: { type: 'string', required: true, description: 'Board identifier.' },
            title: { type: 'string', required: true, description: 'Post title.' },
            body: { type: 'string', required: true, description: 'Post body.' },
            category: { type: 'string', description: 'Optional post category.' },
        },
    },
    {
        name: 'aimeat_datapackage_publish',
        description: 'Publish a table as an AIMEAT Data Package: a Frictionless descriptor with a Table Schema, canonical CSV bytes, AIMEAT provenance, and a permanent public address a program reads directly. The version IS the content hash, so re-publishing identical data answers unchanged:true and creates no second version. THE QUALITY GATE RUNS FIRST: a row that fails its schema means NOTHING is written and you get back the row and the column, with the package still standing on its previous version. `changes` is required — every version says what moved and why. Omitting a resource schema infers it and records schemaSource "inferred", so declare one when the types matter. Rows travel through your context and are capped at 8 MB per call; for a big or repeating table, produce it from an extension action or a workflow step instead, where the rows never touch a model. A RESOURCE IS THE WHOLE TABLE, NOT AN APPEND: publishing only today\'s rows REPLACES yesterday\'s, so to add to an existing package read the current rows with aimeat_datapackage_export first and publish them together with the new ones. WHEN THE ROWS WERE READ OUT OF PICTURES, name the picture in a `source_image` column (`source_image_2`, `_3` for later pages of one thing) holding the storage key you uploaded it under: the node turns it into the picture\'s permanent address so a reader can check any row against what it came from. The picture keeps whatever visibility it has — publishing the table does not publish the photographs.',
        caller: 'agent',
        visibility: agentEverywhere,
        // idempotent because the version IS the content hash: publishing the same rows twice lands on
        // the same address and creates no second version.
        annotations: { title: 'Publish Data Package', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Publishing a data package writes BYTES and a catalogue entry. storage:write is the one that
        // matters — the catalogue is a projection of what was stored, and a package with bytes and no
        // listing is a package; a listing with no bytes is not.
        scope: 'storage:write',
        surfaces: ['appdev', 'agent', 'service', 'commerce'],
        input: {
            ...aiProvenanceCatalogInput,
            name: { type: 'string', required: true, description: 'Lowercase letters, digits and dashes. Becomes part of the permanent URL.' },
            changes: { type: 'string', required: true, description: 'What changed against the previous version and why.' },
            resources: { type: 'array', required: true, description: 'One or more { name, rows, schema?, title?, description? }. rows is an array of objects.', zod: z.array(z.object({
                name: z.string().describe('Becomes data/{name}.csv inside the package.'),
                rows: z.array(z.record(z.string(), z.unknown())).describe('The table, as an array of objects.'),
                schema: z.unknown().optional().describe('A Frictionless Table Schema to DECLARE the types. Omit to have them inferred — the descriptor then records schemaSource "inferred", so a consumer can see nobody confirmed them.'),
                title: z.string().optional(),
                description: z.string().optional(),
            })).min(1) },
            title: { type: 'string', description: 'Human title for the package.' },
            description: { type: 'string', description: 'What the package contains, for a person deciding whether to use it.' },
            license: { type: 'string', description: 'e.g. CC-BY-4.0. You publish under your owner name; say the terms.' },
            sources: { type: 'array', description: 'Where the data came from: { url, title, retrievedAt }.', zod: z.array(z.object({
                url: z.string().optional(), title: z.string().optional(), retrievedAt: z.string().optional(),
            })) },
            legal_basis: { type: 'string', description: 'Why you may publish this — e.g. a public register, consent, a contract.' },
        },
    },
    {
        name: 'aimeat_datapackage_export',
        description: 'Get one resource of a data package in the shape the target program expects. DEFAULT AND USUALLY RIGHT is format "url": the permanent, session-free CSV address plus the Table Schema and ready-made DuckDB / pandas / Google Sheets / frictionless recipes — hand that address on rather than pulling rows through your context. format "csv" or "json" returns a WINDOW of rows inline, for a small table you have to reason over yourself; the answer says so when it truncated. `ref` is pkg:owner/name for the newest version or pkg:owner/name@sha256:... to pin one that can never change under you. The Table Schema names every column and its type, so you never have to be told the columns.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Export Data Package', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'storage:read',
        surfaces: ['appdev', 'agent', 'service', 'commerce'],
        input: {
            ref: { type: 'string', required: true, description: 'pkg:owner/name, optionally @sha256:... to pin a version.' },
            resource: { type: 'string', required: true, description: 'Which resource of the package.' },
            format: { type: 'string', required: true, enum: ['url', 'csv', 'json'], description: 'url (default) = the permanent address. csv/json = inline rows.', zod: z.enum(['url', 'csv', 'json']).default('url') },
            limit: { type: 'number', description: 'Rows for csv/json (default 500, max 5000).', zod: z.number().int().positive().max(5000) },
            offset: { type: 'number', description: 'Row to start from, for csv/json.', zod: z.number().int().nonnegative() },
            select: { type: 'array', description: 'Only these columns.', zod: z.array(z.string()) },
        },
    },
    {
        name: 'aimeat_storage_upload',
        description: 'Upload a binary file (image, document, etc.) to the agent\'s file storage, addressed by key. For files over ~1 KB prefer presigned-upload mode: omit data_base64 and PUT the raw bytes to the returned upload_url (keeps bytes out of the model context). Small files may be sent inline as base64. Download later with aimeat_storage_download. TO EMBED AN IMAGE IN A WORKSPACE DOCUMENT: use the embed_markdown / embed_url from the response (the owner-addressed /v1/pub/<owner>/<key> form) — NEVER hand-write a /v1/storage/<key> path, which loads for nobody but you. Saving an embedded image into a document automatically scopes the file to that workspace\'s members; it is not exposed to the public internet.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Upload Storage File', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'storage:write',
        surfaces: ['appdev', 'agent', 'service', 'commerce', 'primitives'],
        input: {
            key: { type: 'string', required: true, description: 'Storage key (path-like identifier).' },
            data_base64: { type: 'string', description: 'Base64-encoded file data. Omit to get a presigned upload_url instead (recommended for files > 1 KB). Use @file:path with the CLI fallback.' },
            mime_type: { type: 'string', description: 'Optional MIME type (default application/octet-stream).' },
            visibility: { type: 'string', enum: ['private', 'owner', 'group', 'public', 'workspace'], description: "Access control (default: private). Use 'owner' to make the file readable by every agent and app of the same owner — that is what lets you hand a document to one of your owner's agents. Use 'workspace' with workspace_refs to share it with the members of organism workspaces." },
            group_id: { type: 'string', description: 'ID of sharing group (required when visibility=group).' },
            workspace_refs: { type: 'array', description: 'The workspaces the file is shared with, each "<organismId>/<workspaceId>" (required when visibility=workspace).', zod: z.array(z.string()) },
        },
    },
    {
        name: 'aimeat_storage_download',
        description: 'Get a stored file by key, or by REFERENCE for a file you do not own. Storage holds binaries (images, video, large blobs), so by default this returns a HANDLE — a resource_link plus a presigned, TTL-limited download_url and metadata (mime_type, size) — NOT the bytes. Fetch the download_url out-of-band (or hand it to a human/tool); never read large binary into the conversation. Set inline=true only for small text files (<= 32 KB) to get the content directly. To open a file your OWNER uploaded, or one that arrived as a DM or task attachment, pass owner="<owner@node>" (the `ref` field on those attachments already carries it). The read is authorized as YOU: it works when the file is visibility:"owner"/"members"/"public", shared into a group or workspace you belong to, or covered by a consent grant.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Download Storage File', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service', 'commerce', 'primitives'],
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
        annotations: { title: 'Delete Storage File', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'storage:write',
        surfaces: ['appdev', 'agent', 'service', 'commerce'],
        input: {
            key: { type: 'string', required: true, description: 'Storage key in your own namespace.' },
        },
    },
    {
        name: 'aimeat_admin_stats',
        description: 'Operator-only. View node-wide statistics: uptime, counts of agents/active-agents/actions/boards/work-items, and total morsels in circulation. Returns an operator-role error for non-operators. For per-agent detail use aimeat_admin_agents; for node settings use aimeat_admin_config.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Node Stats', readOnlyHint: true },
        // Node administration through an agent (security audit A8-1). Each handler asks the account role
        // first and this word second, through services/owner-lifecycle.ts resolveOperatorAgentName(). No
        // wildcard carries it. The operator's agents that held `*` got it once per node, from
        // services/operator-admin-migration.ts; any other agent holds it only by an explicit tick.
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_admin_agents',
        description: 'Operator-only. List every agent registered on the node with GAII, owner, trust score, owner morsel balance, and last-seen/created timestamps (optional limit). Returns an operator-role error for non-operators. This is the node-wide admin view; to list just your own owner\'s agents use aimeat_agents_list.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: List Agents', readOnlyHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            limit: { type: 'number', description: 'Maximum number of agents to return.' },
        },
    },
    {
        name: 'aimeat_admin_config',
        description: 'Operator-only. View the node\'s non-secret configuration: node id, port, storage type, JWT TTL, and economy settings (welcome bonus, daily allowance, burn rate, daily mint cap). On a node run by somebody else, also lists the settings that party set and this node cannot change, with their values. Returns an operator-role error for non-operators. Read-only — this tool does not change settings.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Read Config', readOnlyHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_admin_sso_list',
        description: 'Operator-only. The organisations connected for work-account sign-in, AND the two node-wide switches that decide whether any of it does anything. READ `node` FIRST: `node.enabled` is the master switch, and while it is false the sign-in endpoint and the provisioning (SCIM) endpoint both answer 503 whatever a connection says — so a connection can be complete and reach nobody. `node.locked` means connection management is frozen and every write below will be refused with 403. Each connection carries `state` (no_idp · blocked_by_switch · live · live_hidden), `can_sign_in`, `button_showing` and `steps_done` out of six: report those rather than the raw flags, because "configured but unusable" and "live" look identical in `saml_configured` alone. The sixth step is the master switch and it is NOT one of these tools — it is `sso.enabled` in the node configuration, so say so when you report a setup as finished. Also per connection: its email domains (which decide whose existing accounts it may adopt), its visibility, and the SP details (entity id, ACS URL, SCIM base URL) an IdP console asks for. Secrets are never returned. The same data as GET /v1/admin/sso/connections.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: List SSO Connections', readOnlyHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_admin_sso_get',
        description: 'Operator-only. Read one SSO connection: its domains, organism binding, sign-in visibility, whether SAML metadata and a SCIM token are configured, when the identity provider last signed someone in and last called the SCIM endpoint, and the SP details to paste into the IdP console. Secrets are never returned.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Read SSO Connection', readOnlyHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            id: { type: 'string', required: true, description: 'The connection id (slug).' },
        },
    },
    {
        name: 'aimeat_admin_sso_create',
        description: 'Operator-only. Connect an organisation\'s identity provider: create an SSO connection with a permanent slug id, the organisation\'s name, its email domains (which decide whose existing accounts it may adopt), an optional organism its people join on arrival, and whether the connection shows as a sign-in button. Configure the SAML half next with aimeat_admin_sso_idp_metadata and mint the provisioning token with aimeat_admin_sso_scim_token. Refused while connection management is locked on this node.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Create SSO Connection', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            id: { type: 'string', required: true, description: 'Permanent slug id (lowercase letters, digits, dashes; 2-31 chars).' },
            name: { type: 'string', required: true, description: 'The organisation\'s name — the sign-in button label when listed.' },
            domains: { type: 'array', description: 'Email domains this organisation vouches for, e.g. ["contoso.com"].', zod: z.array(z.string()) },
            organism_id: { type: 'string', description: 'Organism its people are added to on first sign-in or provisioning.' },
            login_visibility: { type: 'string', description: '"listed" shows a sign-in button; "hidden" keeps the organisation off the public modal (default listed).', zod: z.enum(['listed', 'hidden']) },
            allow_idp_initiated: { type: 'boolean', description: 'Accept sign-ins started from the IdP\'s own portal tile (default false).' },
        },
    },
    {
        name: 'aimeat_admin_sso_update',
        description: 'Operator-only. Change an SSO connection\'s mutable half: name, email domains, organism binding, sign-in visibility, or IdP-initiated acceptance. The id never changes, and the SAML metadata goes through aimeat_admin_sso_idp_metadata instead. Refused while connection management is locked on this node.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Update SSO Connection', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            id: { type: 'string', required: true, description: 'The connection id.' },
            name: { type: 'string', description: 'New organisation name.' },
            domains: { type: 'array', description: 'New email-domain list (replaces the old one).', zod: z.array(z.string()) },
            organism_id: { type: 'string', description: 'New organism binding; an empty string clears it.' },
            login_visibility: { type: 'string', description: '"listed" or "hidden".', zod: z.enum(['listed', 'hidden']) },
            allow_idp_initiated: { type: 'boolean', description: 'Accept IdP-initiated sign-ins.' },
        },
    },
    {
        name: 'aimeat_admin_sso_delete',
        description: 'Operator-only. Remove an SSO connection — the sign-in route, not the people: every account it created or adopted remains, with its knowledge and memberships, and recreating the connection under the same id restores provisioning authority over them. Refused while connection management is locked on this node.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Delete SSO Connection', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            id: { type: 'string', required: true, description: 'The connection id.' },
        },
    },
    {
        name: 'aimeat_admin_sso_idp_metadata',
        description: 'Operator-only. Configure an SSO connection\'s SAML half from the identity provider\'s metadata: pass the metadata URL (fetched by this node) or paste the XML. Nothing is saved unless the document yields an entity id, an HTTP-Redirect sign-in endpoint and at least one signing certificate. Refused while connection management is locked on this node.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Set SSO IdP Metadata', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            id: { type: 'string', required: true, description: 'The connection id.' },
            url: { type: 'string', description: 'The IdP metadata URL (e.g. Entra\'s federation metadata address).' },
            xml: { type: 'string', description: 'The IdP metadata document itself, when a URL is not reachable.' },
            name_id_format: { type: 'string', description: 'Requested NameID format, when the IdP\'s default is not wanted.' },
        },
    },
    {
        name: 'aimeat_admin_sso_scim_token',
        description: 'Operator-only. Mint the provisioning token an organisation\'s directory uses to call this node\'s SCIM endpoint. The token is returned ONCE and only its hash is stored; minting again replaces the previous token, which stops working immediately. Paste it into the IdP\'s provisioning configuration together with the connection\'s SCIM base URL. Refused while connection management is locked on this node.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Mint SCIM Token', readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            id: { type: 'string', required: true, description: 'The connection id.' },
        },
    },
    {
        name: 'aimeat_admin_owner_disable',
        description: 'Operator-only. Deactivate an account on this node: the person\'s knowledge, memberships and history remain, but every credential acting in their name — sessions, agents\' tokens, access tokens, app grants — stops immediately and nothing new can be minted. Reversible with aimeat_admin_owner_enable. You cannot deactivate your own account. This tool is the manual way to offboard; an organisation\'s directory does the same automatically over SCIM.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Deactivate Account', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            name: { type: 'string', required: true, description: 'The owner name to deactivate.' },
        },
    },
    {
        name: 'aimeat_admin_owner_enable',
        description: 'Operator-only. Reactivate a deactivated account. The person can sign in again and reconnect their agents; the credentials that were ended by deactivation stay dead.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Reactivate Account', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            name: { type: 'string', required: true, description: 'The owner name to reactivate.' },
        },
    },
    {
        name: 'aimeat_admin_totp_reset',
        description: 'Operator-only. Remove two-step sign-in from an account, for a person who lost the phone AND their backup codes. Their own removal page asks for a code, which is exactly what they no longer have, so without this the account is unreachable. It grants nobody access: the password still stands and you are handed nothing. The person is told — the reset lands on their account feed with your name on it. You cannot use it on your own account; ask another operator, or use one of your backup codes.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Remove Two-Step Sign-In', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            name: { type: 'string', required: true, description: 'The owner name whose two-step sign-in should be removed.' },
        },
    },
    {
        name: 'aimeat_admin_security_overview',
        // A6: the overview reports a bounded sample and an explicit unknown comparison state.
        description: 'Operator-only. The Security page in one read: a bounded sample of at most 1000 readable log lines filtered to the last 24 hours (count_kind=sample, window_total=null; unknown zone when comparison history is insufficient) (refusals, distinct sources, walled addresses, each with a zone decided from this instance\'s own readable history), the refusal log grouped by endpoint, source, credential kind and credential fingerprint plus its newest 200 lines, the refused-and-kept incidents with the open count, who holds the operator role and which accounts are deactivated or use two-step sign-in, how apps are kept apart from the sign-in of whoever opens them (apps: on their own addresses, in an isolated frame, or on this node\'s address while one person has an account; on a node several people share with no app addresses, a warning in words and the settings that give every app its own address), and the access settings (rate limits, tarpit, lockout, TOTP, CORS origins, federation sign-in, body limits, the log file). The same data as GET /v1/admin/security/overview. Returns an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Security Overview', readOnlyHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_admin_incident_resolve',
        description: 'Operator-only. Mark a security incident resolved; the quarantined bytes stay until the incident is deleted. Read aimeat_admin_security_overview first to see the incidents and their ids. The incident the move to the full identity and the settling of what deleted accounts installed and were issued open at start (type held_account_names) lists account names whose rows are older than the account that holds the name now, left as they were (actions, work, ledger lines, cortexes, ecosystem apps, app grants, access tokens; such an app can still act for that account until the name is decided, and the tokens of such an app grant or access token are refused whatever the decision): decide each with `name` and `resolution` — "holder" moves its rows, its own ledger lines and the hook bindings to its actions to that account\'s full identity, and keeps its cortexes, ecosystem apps, app grants and access tokens; "previous" settles them as a deleted account\'s (actions deleted, open work cancelled with what was held going back only to an account that existed when it was written, finished work and ledger lines under one pseudonym, cortexes and ecosystem apps deleted with what they hold, so the apps\' tokens stop, and the older app grants and access tokens deleted). That incident closes with its last name, and closing it before answers CONFLICT. Returns NOT_FOUND for an unknown id or name, CONFLICT for a name decided the other way, and an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Resolve Security Incident', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            id: { type: 'string', required: true, description: 'The incident id, from the overview\'s incidents list.' },
            name: { type: 'string', description: 'To decide one name of an incident the move to the full identity opened: the account name, from the incident\'s names.' },
            resolution: { type: 'string', description: 'With `name`: "holder" (its rows, cortexes, ecosystem apps, app grants and access tokens are the account\'s that holds the name now) or "previous" (they were a previous holder\'s).' },
        },
    },
    {
        name: 'aimeat_admin_cors_overview',
        description: 'Operator-only. The CORS page in one read: the default list of browser origins this instance answers (and whether it is the wildcard), the three cookie-authenticated endpoints that take no wildcard and what is named for them, every person and every agent with a list of their own, how many memory records carry one, and the order the lists rank in (record, agent, person, default; the first non-empty list wins). The same data as GET /v1/admin/cors/overview. Returns an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: CORS Overview', readOnlyHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_admin_federation',
        description: 'Operator-only. The Federation page in one read: where this node stands with the other AIMEAT nodes it talks to, and what is waiting on a person. `standing` is one word — alone, waiting, degraded or linked — and `needs` is the list behind it, in the order to act: a stranger asking to join, a peer APPROVED AND NEVER SWITCHED ON, a peer with no verification key, a peer on its way out. Lead with `needs`: approving a peering request does not connect anything, it creates the peer at status `approved` and nothing crosses until somebody presses Activate, and that half-finished state is what this read exists to show. `signin` is two decisions and both must say yes — the node-wide policy and a switch on each peer — so `signin.reaches` is how many peers a person could ACTUALLY arrive from, and `reaches_nobody` true means the policy is set to something other than off and admits nobody, which looks configured and is not. `offer` is what this node gives the federation: an action, agent, board or service counts only when somebody ticked Federate on it, so `gives_nothing` true means this node reads the federation and puts nothing back — say that plainly, it is a decision people make by accident. `book` is the signed directory of every node in the federation, not only the direct peers; `book.age_days` says whether it is worth mirroring again, and each row carries `is_this_node` and `keeps_book`. `versions_behind` is measured against `newest_version`, which spans the peers, the book AND this node, so a row can be behind the operator\'s own build. `relay_claims` answers "which peers are not ready for signed relay claims": this node\'s setting, the two versions (the default becomes required in `default_becomes_required_in`, optional is removed in `optional_removed_in`), `not_ready` (relays naming the peer arrive without a claim and none ever came with one), `ready`, `unseen`, and the peers kept on their own setting; each roster row carries the same as `relay_claim`, with when the peer last relayed with and without a claim. A relay without a claim is named by its sender, so `not_ready` is a sign, not proof. Each roster row carries `origin`, how the peer arrived: `recorded` (a package grant, a package seller, a sale or an install set added it without an operator, with who asked), `inferred` (an older packages-only peer, with the records that name it), or `operator_or_federation`. `pending_registrations` are package grants waiting for their node to answer. To remove a peer, or free a node id taken under a wrong key, the operator uses DELETE /v1/federation/peers/{nodeId}?emergency=true (the Federation page). The same data as GET /v1/admin/federation/overview. Returns an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Federation', readOnlyHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_admin_federation_relay_claim_set',
        description: 'Operator-only. Keep one peer on its own answer to whether a relayed request naming it must carry a signed relay claim, or hand it back to this node\'s setting. "required" refuses an unclaimed relay naming that peer even while the node is on optional; "optional" lets one through even after the node\'s default becomes required in 3.20.0, which is a migration position for a peer that has not updated and goes away in 4.0.0; "node" follows the node again. Keeping a peer on optional admits any unclaimed relay that NAMES it, because the name is the sender\'s own word, so say that when you set it and switch it back once the peer is in `relay_claims.ready`. A peer that has ever sent a valid claim is refused without one whatever this says. Read aimeat_admin_federation first: its `relay_claims.not_ready` names the peers that need this. Returns NOT_FOUND for a node that is not a peer, INVALID_INPUT for any other word, and an operator-role error for non-operators. The same as PUT /v1/federation/peers/:nodeId/relay-claim.',
        caller: 'operator',
        visibility: agentEverywhere,
        // Setting the same word twice leaves the same peer; the previous word was a setting, not data.
        annotations: { title: 'Admin: Keep a Peer on Its Own Relay-Claim Setting', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            node_id: { type: 'string', required: true, description: 'The peer, by its node id as aimeat_admin_federation lists it.' },
            relay_claim: { type: 'string', required: true, enum: ['optional', 'required', 'node'], description: '"optional" or "required" for this peer alone, or "node" to follow this node\'s setting again.' },
        },
    },
    {
        name: 'aimeat_admin_federation_peer_remove',
        description: 'Operator-only. Remove a federation peer, or free a node id somebody else holds. With emergency true the peer goes at once, with the record of how it arrived, its in-flight work is cancelled and its escrow returned, and the node id is free for the real node to peer again; without it the peer enters its de-peering grace and is purged when the grace ends. A node id that is only a package registration still waiting for its node is deleted as that (`pending_deleted`). Read aimeat_admin_federation first: each roster row says how the peer arrived (`origin`), and the Security page names a node id held under another key. Say to the operator which peer you are removing and why before you call this. Returns NOT_FOUND for a node id that is neither a peer nor a waiting registration, and an operator-role error for non-operators. The same as DELETE /v1/federation/peers/:nodeId (?emergency=true).',
        caller: 'operator',
        visibility: agentEverywhere,
        // Ends a link and, with emergency, cancels the work in flight with that peer; a second call finds nothing.
        annotations: { title: 'Admin: Remove a Federation Peer', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            node_id: { type: 'string', required: true, description: 'The peer, by its node id as aimeat_admin_federation lists it.' },
            emergency: { type: 'boolean', description: 'true: remove it now and free the node id. Omitted or false: start its de-peering grace.' },
            reason: { type: 'string', description: 'Why, in a few words: kept with the removal and sent with an emergency notice. Defaults to emergency_depeer or operator_decision.', zod: z.string().max(500) },
        },
    },
    {
        name: 'aimeat_admin_knowledge',
        description: 'Operator-only. The Knowledge page in one read: EVERY knowledge package on this node, the shape of the collection, and whether anybody has already looked at each one. NOT the same question as aimeat_knowledge_list, which is the catalogue — what a caller may read — and therefore a subset: this one includes the packages nobody catalogued, which on a moderation screen are the ones that matter. `paging` carries number, per_page, total and pages together, so say the total rather than the page length: a page of twenty out of two hundred read as the whole store is the one mistake this tool cannot make. `facets` counts over EVERYTHING that matched rather than over the page, and a facet does not narrow its own counts, so you can move sideways from one kind to another without clearing a filter first. `facets.authors` collapses a person across the spellings of their name and lists them: this node writes the same person as both `alice` and `alice@node-id`, so filter with author_key rather than typing a name. `facets.maturity[].declared` is false for a word this node does not define (the type declares draft, review and published, and live data carries others) — report such a value as undeclared instead of printing it as if it were ours. Each package carries `reviews` and `last_review`, so "nobody has looked at this yet" is a fact you can state. The same data as GET /v1/admin/knowledge. Returns an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Knowledge', readOnlyHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            page: { type: 'number', required: false, description: 'Which page of packages, from 1. A page past the end comes back as the last page rather than empty.', zod: z.number().int() },
            limit: { type: 'number', required: false, description: 'How many packages on the page. 20 by default, 50 at most.', zod: z.number().int() },
            q: { type: 'string', required: false, description: 'Free text over the name, the author and the tags.' },
            author_key: { type: 'string', required: false, description: 'One author, collapsed across the spellings of their name. Take the key from facets.authors.' },
            content_type: { type: 'string', required: false, description: 'One kind of package, as facets.kinds names it.' },
            flagged: { type: 'boolean', required: false, description: 'Only packages somebody has reported.' },
        },
    },
    {
        name: 'aimeat_admin_usage',
        description: 'Operator-only. What AI costs on this node, organised by WHOSE MONEY IT IS rather than by which system counted it. Give BOTH from and to (ISO dates, inclusive) or neither for the trailing thirty days. `whose_money.house` is the operator\'s own bill — what people spent on the node\'s key because they had not brought their own. `whose_money.own` is other people\'s own provider accounts and costs the operator nothing. `whose_money.ledger` is a THIRD count, off a different table, and is the larger set; report it as such and never add it to the other two. `ceiling_usd` is the free grant times the number of accounts: the most the server\'s key can cost before somebody is refused, and the number an operator acts on. THE IMPORTANT LIMIT: `keys.chat.metered_here` is false, because every chat turn is spent from one key handed to a child process, so no figure here contains any of it — say so whenever you report a total, or the operator will read a bill that is missing its largest item. Pass ask_provider true to have the node ask the provider what its own two keys have actually spent (one outbound call per key, cached a minute); without it `keys.*.spend` is null and unknown is the honest answer. `models.unpriced` explains the calls that carry no cost: most are free or local models that have none, and `estimated_missing_usd` is what the rest would have cost at the priced average. The same data as GET /v1/admin/usage/page. Returns an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        // Read-only about this node, but `ask_provider` reaches a third party, so it is not closed-world.
        annotations: { title: 'Admin: Usage', readOnlyHint: true, openWorldHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            from: { type: 'string', required: false, description: 'First day of the period, inclusive, as YYYY-MM-DD. Give `to` as well or neither is used.' },
            to: { type: 'string', required: false, description: 'Last day of the period, inclusive, as YYYY-MM-DD. Give `from` as well or neither is used.' },
            ask_provider: { type: 'boolean', required: false, description: 'Ask the provider what the node\'s own house and chat keys have spent. One outbound call per key. Off by default.' },
        },
    },
    {
        name: 'aimeat_admin_statistics',
        description: 'Operator-only. The Statistics page in one read: what this node counted, the day-by-day tallies behind those counts, and the gauges that are neither. Give BOTH from and to (ISO dates, inclusive) for a period, or neither for the node\'s whole life. THREE KINDS OF NUMBER share the payload and only one moves with the period. Counters (requests_total, memory_reads, memory_writes, auth_failures_total, rate_limit_hits_total, scope_denials_total, schema_validations, email_sent, push_sent …) are summed over the period when you give one, and are lifetime totals when you do not. Gauges (uptime_seconds, active_owners, active_agents, tunnel, mailbox, gauges.*) are read at the moment of the call, are not summable, and a period does not touch them: never compare one across periods. `daily` carries one entry per day that had activity, so a missing day is a day with none rather than a gap in the data. READ IT TWICE to say anything useful — once for the period and once without — because a counter reading 0 for a period may have a large lifetime total, while one reading 0 both ways has never been written at all, and those are different facts. auth_failures_total is usually the largest number on a node reachable from the public internet, and a rate that stays flat across a weekend is a script working through credentials rather than people. The same data as GET /v1/stats. Returns an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Statistics', readOnlyHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            from: { type: 'string', required: false, description: 'First day of the period, inclusive, as YYYY-MM-DD. Give `to` as well or neither is used.' },
            to: { type: 'string', required: false, description: 'Last day of the period, inclusive, as YYYY-MM-DD. Give `from` as well or neither is used.' },
        },
    },
    {
        name: 'aimeat_admin_node_update',
        description: 'Operator-only. Is a newer AIMEAT out on npm than the version this node runs? Answers the running version (`current`), the newest on npm (`latest`), `updateAvailable`, when the newer one was released, `whatsNew` (the change-log entries it has and this node does not, newest first; each title and body is a string or an object by language), how the node looks to be installed (`install.method`: npm, npx, source, docker, desktop or unknown, a guess from its own paths), and `prompt`: a ready prompt that updates the node, for an AI with a shell on the machine the node runs on (Claude Code, Codex). Show the person the version, the date and what is new in their own words, and offer the prompt; the update restarts the node, so it is theirs to start. After an update, call again with refresh: true and check that `current` is the new version. The node asks npm at most once every six hours; with the node.update_check setting off it asks nothing and answers enabled: false. The same data as GET /v1/admin/node-update. Returns an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        // Reads npm, an outside service, but changes nothing anywhere.
        annotations: { title: 'Admin: Newer AIMEAT Version', readOnlyHint: true, openWorldHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            refresh: { type: 'boolean', required: false, description: 'Ask the registry now instead of answering from the six-hour cache.' },
        },
    },
    {
        name: 'aimeat_admin_hooks',
        description: 'Operator-only. The Hooks page in one read: the eleven moments in this node\'s life where it can call out to somebody\'s own code, which four of them DECIDE whether the thing happens (a pre_ hook can refuse a registration, a work request, a board post or a new federation peer) and which seven are only told afterwards, what is bound to each and whether that action is still published and still carries an address, which actions could be bound, and every call the node has made with what came back. Read this before advising anyone about hooks: a bound gate whose address stops answering refuses everything it guards, and `failing` names any gate in that state. The same data as GET /v1/admin/hooks. Returns an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: Hooks', readOnlyHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_admin_hook_set',
        description: 'Operator-only. Bind a list of actions to one of the eleven moments, or clear it with an empty list. The actions are called in the order given, each after the last has answered. A gate (any hook whose name starts with pre_) WAITS for them and refuses the thing when one answers no, returns a non-2xx, or does not answer within ten seconds, so binding an address that is not reachable stops everything that moment guards; the other seven are told afterwards and stop nothing. A hook binds only an action that is already published: publish the action first (POST /v1/actions, with its webhook_url), then bind it. An action reference is a published action\'s id, or its id with its provider (id#provider). A reference that no action published here answers to is refused with INVALID_INPUT and nothing is written. A bare id that more than one provider publishes is refused, with the id#provider of each: bind the one you mean with its provider. A bare id that one provider publishes is stored as its id#provider, so another owner publishing the same id later changes nothing. Read aimeat_admin_hooks first: its bindable_actions lists what can be bound, each with the ref to write.',
        caller: 'operator',
        visibility: agentEverywhere,
        // Not destructive: binding replaces a list the operator can read first and set back.
        annotations: { title: 'Admin: Bind a Hook', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            hook: { type: 'string', required: true, description: 'The moment, e.g. "pre_owner_registration".' },
            actions: { type: 'array', required: true, description: 'Action references to call, in order, each naming an action already published here. An empty list clears the moment.', zod: z.array(z.string()) },
        },
    },
    {
        name: 'aimeat_admin_cors_set',
        description: 'Operator-only. Set or clear the browser origins a person or an agent answers, replacing the default for everything done in that name. `who` is a person\'s address (owner@node), a bare owner name, or an agent\'s address (name#owner@node); `origins` is a list of http(s) URLs or "*", or null to clear the list so the default applies again. Read aimeat_admin_cors_overview first. Returns NOT_FOUND for an unknown name, INVALID_INPUT for an origin that is not an http(s) URL, and an operator-role error for non-operators.',
        caller: 'operator',
        visibility: agentEverywhere,
        // Replacing a list is not destructive (the previous one was a setting, not data), and setting
        // the same list twice leaves the same list.
        annotations: { title: 'Admin: Set Allowed Origins', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            who: { type: 'string', required: true, description: 'A person\'s address (owner@node), a bare owner name, or an agent\'s address (name#owner@node).' },
            origins: { type: 'array', required: true, description: 'The origins to allow, each an http(s) URL or "*"; null clears the list.', zod: z.array(z.string()).nullable() },
        },
    },
    {
        name: 'aimeat_admin_organism_ownership',
        description: 'Operator-only. Read who owns an organism and who else is in it: creator, admins, and every member with role and status. Read this before aimeat_admin_organism_owner_add — installing an owner is a cross-account act and the roster it re-points should be seen first. For an organism you belong to yourself, use aimeat_organism_get.',
        caller: 'operator',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Admin: Organism Ownership', readOnlyHint: true },
        // The node operator's break-glass over an organism this account does not own. The handler also
        // resolves the caller's OWNER and refuses a non-operator, so the word alone gets nobody in; it is
        // here as well because a tool is REGISTERED according to this table, and no wildcard carries this
        // one (SCOPES_OUTSIDE_WILDCARD), so an operator's agent holds it only by an explicit tick.
        scope: 'operator:organism-repair',
        surfaces: ['admin'],
        input: {
            organism_id: { type: 'string', required: true, description: 'The organism ID.' },
        },
    },
    {
        name: 'aimeat_admin_organism_owner_add',
        description: 'Operator-only break-glass. Make an owner the creator of an organism the caller does not own, for the case where the organism\'s own creator account can no longer be reached. The previous creator stays on as an admin, and a target who is not yet a member is seated as one; a blocked target is refused. Needs the exact permission operator:organism-repair, which no wildcard carries. The ordinary handover, by the current creator to an existing member, is aimeat_organism_update\'s sibling route POST /v1/organisms/{id}/transfer.',
        caller: 'operator',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Admin: Add Organism Owner', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        scope: 'operator:organism-repair',
        surfaces: ['admin'],
        input: {
            organism_id: { type: 'string', required: true, description: 'The organism ID to repair.' },
            ghii: { type: 'string', required: true, description: 'Bare owner name to install as the organism\'s creator.' },
        },
    },
    // The notice-board tools: list, create, rules, subscribe, react, reply, members and delete: ./boards.ts, spread in place.
    ...boardTools,
] as const satisfies readonly AimeatToolDefinition[];
