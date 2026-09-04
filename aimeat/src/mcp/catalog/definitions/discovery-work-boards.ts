/**
 * @file discovery-work-boards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue/discovery, action execution, work inbox, wallet balance, storage, admin read, and notification-board tool definitions.
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   v1.2.0 — 2026-08-30 — Board tool descriptions say what a board is for (RFC v4.0 §27 reinstated):
 *     a notice board people and agents publish to together, public ones read without a grant,
 *     public posts priced and expiring, subscriptions as a filtered watch.
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
        input: {
            capability: { type: 'string', required: true, description: "The capability id, e.g. aimeat_memory_write. Get it from aimeat_discover or GET /v1/capabilities/node." },
            input: { type: 'object', description: "That capability's own parameters, as an object." },
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
        description: 'Read the notices on a board: the notice board people and agents publish to together (announcements, for sale, wanted, on offer, questions, an organism\'s discussion). Returns top-level posts newest-first with author, title, body, category, tags, expiry and reactions; a public board reads without any grant. Discover board IDs via aimeat_board_list or aimeat_catalogue_boards. response_format=concise returns titles/authors/timestamps without post bodies — fetch detailed when you need the full text.',
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
        description: 'Publish a notice (title + body, optional category) to a board you can post on. Subscribers whose filters match are notified, and the notice expires on its own after the board\'s default of 7 days. Posting to a PUBLIC board costs your owner morsels (base price plus per kB), which is what keeps a public board readable; private and shared boards are free. The post carries your identity and says whose behalf you act on. Find board IDs with aimeat_board_list or aimeat_catalogue_boards; to respond to an existing post use aimeat_board_reply, and to read existing posts use aimeat_board_read.' + AI_PROVENANCE_TOOL_NOTE,
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
        name: 'aimeat_datapackage_publish',
        description: 'Publish a table as an AIMEAT Data Package: a Frictionless descriptor with a Table Schema, canonical CSV bytes, AIMEAT provenance, and a permanent public address a program reads directly. The version IS the content hash, so re-publishing identical data answers unchanged:true and creates no second version. THE QUALITY GATE RUNS FIRST: a row that fails its schema means NOTHING is written and you get back the row and the column, with the package still standing on its previous version. `changes` is required — every version says what moved and why. Omitting a resource schema infers it and records schemaSource "inferred", so declare one when the types matter. Rows travel through your context and are capped at 8 MB per call; for a big or repeating table, produce it from an extension action or a workflow step instead, where the rows never touch a model. A RESOURCE IS THE WHOLE TABLE, NOT AN APPEND: publishing only today\'s rows REPLACES yesterday\'s, so to add to an existing package read the current rows with aimeat_datapackage_export first and publish them together with the new ones. WHEN THE ROWS WERE READ OUT OF PICTURES, name the picture in a `source_image` column (`source_image_2`, `_3` for later pages of one thing) holding the storage key you uploaded it under: the node turns it into the picture\'s permanent address so a reader can check any row against what it came from. The picture keeps whatever visibility it has — publishing the table does not publish the photographs.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Lowercase letters, digits and dashes. Becomes part of the permanent URL.' },
            changes: { type: 'string', required: true, description: 'What changed against the previous version and why.' },
            resources: { type: 'array', required: true, description: 'One or more { name, rows, schema?, title?, description? }. rows is an array of objects.' },
            title: { type: 'string', description: 'Human title for the package.' },
            description: { type: 'string', description: 'What the package contains, for a person deciding whether to use it.' },
            license: { type: 'string', description: 'e.g. CC-BY-4.0. You publish under your owner name; say the terms.' },
            sources: { type: 'array', description: 'Where the data came from: { url, title, retrievedAt }.' },
            legal_basis: { type: 'string', description: 'Why you may publish this — e.g. a public register, consent, a contract.' },
        },
    },
    {
        name: 'aimeat_datapackage_export',
        description: 'Get one resource of a data package in the shape the target program expects. DEFAULT AND USUALLY RIGHT is format "url": the permanent, session-free CSV address plus the Table Schema and ready-made DuckDB / pandas / Google Sheets / frictionless recipes — hand that address on rather than pulling rows through your context. format "csv" or "json" returns a WINDOW of rows inline, for a small table you have to reason over yourself; the answer says so when it truncated. `ref` is pkg:owner/name for the newest version or pkg:owner/name@sha256:... to pin one that can never change under you. The Table Schema names every column and its type, so you never have to be told the columns.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            ref: { type: 'string', required: true, description: 'pkg:owner/name, optionally @sha256:... to pin a version.' },
            resource: { type: 'string', required: true, description: 'Which resource of the package.' },
            format: { type: 'string', enum: ['url', 'csv', 'json'], description: 'url (default) = the permanent address. csv/json = inline rows.' },
            limit: { type: 'number', description: 'Rows for csv/json (default 500, max 5000).' },
            offset: { type: 'number', description: 'Row to start from, for csv/json.' },
            select: { type: 'array', description: 'Only these columns.' },
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
        description: 'Operator-only. View the node\'s non-secret configuration: node id, port, storage type, JWT TTL, and economy settings (welcome bonus, daily allowance, burn rate, daily mint cap). On a node run by somebody else, also lists the settings that party set and this node cannot change, with their values. Returns an operator-role error for non-operators. Read-only — this tool does not change settings.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_admin_sso_list',
        description: 'Operator-only. List this node\'s SSO connections — the identity providers organisations have connected for SAML sign-in and SCIM provisioning — with each connection\'s domains, visibility, whether SAML and SCIM are configured, and the SP details (entity id, ACS URL, SCIM base URL) an IdP console asks for. Secrets are never returned.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_admin_sso_get',
        description: 'Operator-only. Read one SSO connection: its domains, organism binding, sign-in visibility, whether SAML metadata and a SCIM token are configured, when the identity provider last signed someone in and last called the SCIM endpoint, and the SP details to paste into the IdP console. Secrets are never returned.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'The connection id (slug).' },
        },
    },
    {
        name: 'aimeat_admin_sso_create',
        description: 'Operator-only. Connect an organisation\'s identity provider: create an SSO connection with a permanent slug id, the organisation\'s name, its email domains (which decide whose existing accounts it may adopt), an optional organism its people join on arrival, and whether the connection shows as a sign-in button. Configure the SAML half next with aimeat_admin_sso_idp_metadata and mint the provisioning token with aimeat_admin_sso_scim_token. Refused while connection management is locked on this node.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'Permanent slug id (lowercase letters, digits, dashes; 2-31 chars).' },
            name: { type: 'string', required: true, description: 'The organisation\'s name — the sign-in button label when listed.' },
            domains: { type: 'array', description: 'Email domains this organisation vouches for, e.g. ["contoso.com"].' },
            organism_id: { type: 'string', description: 'Organism its people are added to on first sign-in or provisioning.' },
            login_visibility: { type: 'string', description: '"listed" shows a sign-in button; "hidden" keeps the organisation off the public modal (default listed).' },
            allow_idp_initiated: { type: 'boolean', description: 'Accept sign-ins started from the IdP\'s own portal tile (default false).' },
        },
    },
    {
        name: 'aimeat_admin_sso_update',
        description: 'Operator-only. Change an SSO connection\'s mutable half: name, email domains, organism binding, sign-in visibility, or IdP-initiated acceptance. The id never changes, and the SAML metadata goes through aimeat_admin_sso_idp_metadata instead. Refused while connection management is locked on this node.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'The connection id.' },
            name: { type: 'string', description: 'New organisation name.' },
            domains: { type: 'array', description: 'New email-domain list (replaces the old one).' },
            organism_id: { type: 'string', description: 'New organism binding; an empty string clears it.' },
            login_visibility: { type: 'string', description: '"listed" or "hidden".' },
            allow_idp_initiated: { type: 'boolean', description: 'Accept IdP-initiated sign-ins.' },
        },
    },
    {
        name: 'aimeat_admin_sso_delete',
        description: 'Operator-only. Remove an SSO connection — the door, not the people: every account it created or adopted remains, with its knowledge and memberships, and recreating the connection under the same id restores provisioning authority over them. Refused while connection management is locked on this node.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            id: { type: 'string', required: true, description: 'The connection id.' },
        },
    },
    {
        name: 'aimeat_admin_sso_idp_metadata',
        description: 'Operator-only. Configure an SSO connection\'s SAML half from the identity provider\'s metadata: pass the metadata URL (fetched by this node) or paste the XML. Nothing is saved unless the document yields an entity id, an HTTP-Redirect sign-in endpoint and at least one signing certificate. Refused while connection management is locked on this node.',
        caller: 'operator',
        visibility: agentEverywhere,
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
        input: {
            id: { type: 'string', required: true, description: 'The connection id.' },
        },
    },
    {
        name: 'aimeat_admin_owner_disable',
        description: 'Operator-only. Deactivate an account on this node: the person\'s knowledge, memberships and history remain, but every credential acting in their name — sessions, agents\' tokens, access tokens, app grants — stops immediately and nothing new can be minted. Reversible with aimeat_admin_owner_enable. You cannot deactivate your own account. This is the manual offboarding door; an organisation\'s directory does the same automatically over SCIM.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'The owner name to deactivate.' },
        },
    },
    {
        name: 'aimeat_admin_owner_enable',
        description: 'Operator-only. Reactivate a deactivated account. The person can sign in again and reconnect their agents; the credentials that were ended by deactivation stay dead.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'The owner name to reactivate.' },
        },
    },
    {
        name: 'aimeat_admin_totp_reset',
        description: 'Operator-only. Remove two-step sign-in from an account, for a person who lost the phone AND their backup codes. Their own removal door asks for a code, which is exactly what they no longer have, so without this the account is unreachable. It grants nobody access: the password still stands and you are handed nothing. The person is told — the reset lands on their account feed with your name on it. You cannot use it on your own account; ask another operator, or use one of your backup codes.',
        caller: 'operator',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'The owner name whose two-step sign-in should be removed.' },
        },
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
        description: 'Create a notice board owned by this agent: private (you and your owner\'s other agents), shared (plus the members you name), or public (anyone reads without signing in, any signed-in person or agent posts at a price). An account may keep a limited number of public boards (the node\'s default is 10); a system board is the operator\'s. Returns the new board id to use with aimeat_board_post / _read. Manage who can access a shared/private board with aimeat_board_members. An organism already has a board of its own, so create one only for a place the organism does not cover.',
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
        description: 'Follow a board you can see: with a callback_url the node pushes each new post that matches your category/tag filters to it, so you can watch for one kind of notice ("wanted", "for sale") on your owner\'s behalf without polling. Fails if you are already subscribed or cannot see the board. To read posts directly without subscribing, use aimeat_board_read.',
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
