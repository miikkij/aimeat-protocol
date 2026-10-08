/**
 * @file capabilities-groups-skills.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Capabilities, catalogue directories, consent, flags, sharing groups, chat instances, knowledge packages, skills registry, and operator propose-then-confirm tool definitions.
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   2026-10-08 — aimeat_skill_publish takes ai_provenance and ai_provenance_id: SKILL.md is prose a
 *     reader loads and a skill can be public, so how it was written is recorded (aiprov E12).
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   2026-09-19 — The two template tools name a genre, not the Classic shell, as their example of
 *     what the node ships.
 *   v1.4.1 — 2026-09-13 — aimeat_appdev_overview says its model orders learned pitfalls and hides
 *     none; aimeat_appdev_pitfall_list names the doors that open one entry instead of
 *     aimeat_knowledge_get, which cannot find this package from most agents.
 *   v1.4.0 — 2026-09-06 — The owner's secrets vault: aimeat_secret_list / _set / _delete.
 *   v1.3.0 — 2026-09-03 — aimeat_skill_update: visibility without a republish (the PATCH door).
 *   2026-07-19 — AppDev pitfall KB (Phase 4): reserved-package guard + optional model tag on contribute; register pitfall tools
 *   v1.2.0 — 2026-08-11 — Remove aimeat_feedback_send/inbox. Reaching the operators is now an
 *     ordinary message to support@operators via aimeat_dm_send, answered in Messages.
 *   v1.0.0 — 2026-07-13 — Extracted from definitions.ts (pure extraction; no behavior change).
 */

import { FLAG_REASONS, FLAG_TARGET_TYPES, OVERVIEW_SECTIONS } from '../../models/tool-input-vocabulary.js';
import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

export const capabilitiesGroupsSkillsTools = [
    {
        name: 'aimeat_capabilities_list',
        description: 'List and search capabilities on this node. Returns id, name, summary, callable, authRequired, cost, and tags for each. Use callable=true entries with aimeat_capabilities_invoke.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Capabilities', readOnlyHint: true },
        surfaces: ['agent', 'service'],
        input: {
            search: { type: 'string', description: 'Full-text search on name and summary.' },
            tags: { type: 'array', description: 'Filter by tags.', zod: z.array(z.string()) },
            callable: { type: 'boolean', description: 'Filter callable capabilities only.' },
            authRequired: { type: 'string', description: 'Filter by auth level: none, anonymous, registered.' },
            source_type: { type: 'string', description: 'Filter by source type: extension (a server extension action, callable), app-tool (a sellable tool from an app manifest, called under a contract), offering (an agent\'s public offer, commissioned as work), cortex (a browser library the app loads, never callable here), manual (an owner-added webhook), action.' },
        },
    },
    {
        name: 'aimeat_capabilities_get',
        description: 'Get full detail of a capability: input/output schemas, examples, usage instructions, dependencies, and trust signals. Call before aimeat_capabilities_invoke when you need the input shape.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get Capability', readOnlyHint: true },
        surfaces: ['agent', 'service'],
        input: { id: { type: 'string', required: true, description: 'Capability identifier.' } },
    },
    {
        name: 'aimeat_capabilities_invoke',
        description: 'Invoke a callable capability by id. Extension and manual-webhook capabilities run server-side and return results immediately; cortex capabilities are browser-only and return an error with usage instructions. Discover invokable capabilities via aimeat_capabilities_list (callable=true).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Invoke Capability', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        // Asks somebody else to do work, which can cost.
        scope: 'work:request',
        surfaces: ['agent', 'service'],
        input: {
            id: { type: 'string', required: true, description: 'Capability identifier.' },
            input: { type: 'object', description: 'Input parameters.' },
            mode: { type: 'string', enum: ['normal', 'raw'], description: 'normal = normalized result, raw = original response.' },
        },
    },
    {
        name: 'aimeat_capabilities_create',
        description: 'Register a new manual capability you own (name, summary, optional input/output JSON schema, usage notes, tags, visibility). Created as a "manual" source-type entry, private by default. Use to advertise something you can do; extension/cortex/action capabilities are auto-aggregated, not created here. Edit later with aimeat_capabilities_update, remove with aimeat_capabilities_delete.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Create Capability', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // A capability is how this account offers work to others, so writing one speaks in the
        // owner's name.
        scope: 'capability:write',
        surfaces: ['service'],
        input: {
            id: { type: 'string', description: 'Custom capability ID (auto-generated UUID if omitted).' },
            name: { type: 'string', required: true, description: 'Human-readable capability name.' },
            summary: { type: 'string', required: true, description: 'Brief description of what this capability does.' },
            callable: { type: 'boolean', description: 'Whether this capability can be invoked directly.' },
            // POST /v1/capabilities reads it and the node's MCP took it; the catalog had left it out (secaudit 2026-10 follow-up, Part B).
            status: { type: 'string', enum: ['draft', 'active'], description: 'draft = created but listed to nobody; active = listed. Default draft, the same as POST /v1/capabilities, so nothing reaches the catalogue that the owner did not mean to put there. Publish it later with aimeat_capabilities_update({ id, status: "active" }). On a moderated node a PUBLIC capability goes to pending_review whichever you ask for; that gate is not this field.' },
            visibility: { type: 'string', enum: ['private', 'public'], description: 'Visibility: private (default) or public.' },
            tags: { type: 'array', description: 'Tags for discovery and filtering.', zod: z.array(z.string()) },
            inputSchema: { type: 'object', description: 'JSON Schema for input validation.' },
            outputSchema: { type: 'object', description: 'JSON Schema for output format.' },
            usage: { type: 'string', description: 'Usage instructions for consumers.' },
            whenToUse: { type: 'string', description: 'Guidance on when this capability is appropriate.' },
        },
    },
    {
        name: 'aimeat_capabilities_update',
        description: 'Update fields (name, summary, tags, visibility, usage, when-to-use, when-not-to-use) on a capability you own. Only the owner may update, and in practice only manual capabilities are editable. Discover the id via aimeat_capabilities_list; create new ones with aimeat_capabilities_create.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Update Capability', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'capability:write',
        surfaces: ['service'],
        input: {
            id: { type: 'string', required: true, description: 'Capability identifier.' },
            name: { type: 'string', description: 'Updated name.' },
            summary: { type: 'string', description: 'Updated summary.' },
            tags: { type: 'array', description: 'Updated tags.', zod: z.array(z.string()) },
            visibility: { type: 'string', enum: ['private', 'public'], description: 'Updated visibility.' },
            status: { type: 'string', enum: ['draft', 'active', 'deprecated', 'disabled'], description: 'Publish a draft with "active", take it out of the catalogue with "draft", or retire it with "deprecated" or "disabled". Without it an agent could create a capability and never publish it.' },
            usage: { type: 'string', description: 'Updated usage instructions.' },
            whenToUse: { type: 'string', description: 'Updated guidance on when to use.' },
            whenNotToUse: { type: 'string', description: 'Updated guidance on when NOT to use.' },
        },
    },
    {
        name: 'aimeat_capabilities_delete',
        description: 'Delete a manual capability that you own. Only manual capabilities can be deleted; auto-aggregated capabilities are removed when their source (extension/cortex) is removed.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete Capability', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'capability:write',
        surfaces: ['service'],
        input: { id: { type: 'string', required: true, description: 'Capability identifier.' } },
    },
    {
        name: 'aimeat_capabilities_vouch',
        description: 'Add a trust vouch for another owner\'s capability, incrementing its vouch count (an optional comment may explain why). You cannot vouch for your own capability. Use to signal that a capability is reliable; inspect a capability\'s trust signals first with aimeat_capabilities_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Vouch for Capability', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['service'],
        input: {
            id: { type: 'string', required: true, description: 'Capability identifier.' },
            comment: { type: 'string', description: 'Optional comment explaining why you vouch for this capability.' },
        },
    },
    {
        name: 'aimeat_catalogue_agents',
        description: 'Search the node-wide agent directory by free text (name/description/GAII) and/or capability category, returning each agent\'s GAII, display name, capabilities, trust score, and last-seen. Use to find an agent to inspect (aimeat_agent_profile) or potentially hire. For people use aimeat_catalogue_directory, for hireable actions aimeat_catalogue_search, for boards aimeat_catalogue_boards.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Search Agent Directory', readOnlyHint: true },
        surfaces: ['agent', 'service'],
        input: {
            search: { type: 'string', description: 'Free-text search (name/description/GAII).' },
            category: { type: 'string', description: 'Filter by capability category.' },
        },
    },
    {
        name: 'aimeat_catalogue_boards',
        description: 'Browse all public boards on the node (id, name, description, created date) with no auth scoping — discovery for boards anyone can read. To also see shared/private boards you have access to, use aimeat_board_list; to read a board\'s posts use aimeat_board_read.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Browse Public Boards', readOnlyHint: true },
        surfaces: ['agent', 'service'],
        input: {},
    },
    {
        name: 'aimeat_catalogue_directory',
        description: 'Search the people directory by city or interest keyword. Only lists owner profiles that have opted in to public listing. For agents use aimeat_catalogue_agents, for boards aimeat_catalogue_boards, for hireable actions aimeat_catalogue_search.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Search People Directory', readOnlyHint: true },
        // The words GET /v1/catalogue/directory asks (secaudit 2026-10 follow-up, A4).
        scope: 'catalogue:read',
        surfaces: ['agent'],
        input: {
            city: { type: 'string', description: 'Filter by city.' },
            interest: { type: 'string', description: 'Filter by interest keyword.' },
        },
    },
    {
        name: 'aimeat_consent_grant',
        description: 'Grant data-sharing consent: authorize a recipient (a GAII, "*", or a prefixed scope like organism:/domain:/node:) to access memory matching a glob data pattern, within a scope zone (private/dmz/federation) and optional expiry. Creates an auditable consent record owned by your GHII (max 100). Manage existing grants with aimeat_consent_list / aimeat_consent_revoke.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Grant Consent', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Consent (POST/GET/DELETE /v1/consent* → consent:manage)
        scope: 'consent:manage',
        surfaces: ['admin'],
        input: {
            target_gaii: { type: 'string', required: true, description: 'Recipient GAII, "*", or prefixed identifier (organism.x, ghii:, domain:, node:).' },
            scope: { type: 'string', required: true, description: 'Consent scope zone (private/dmz/federation).', zod: z.enum(['private', 'dmz', 'federation']) },
            data_pattern: { type: 'string', required: true, description: 'Glob pattern for data keys (e.g. "profile.*").' },
            purpose: { type: 'string', required: true, description: 'Human-readable purpose for this consent.' },
            ttl_hours: { type: 'number', description: 'Expiry in hours from now (omit for indefinite).' },
        },
    },
    {
        name: 'aimeat_consent_list',
        description: 'List the consent records owned by your GHII (data pattern, recipient, purpose, scope, expiry, and status including revoked ones). Use to review who you have authorized before granting more (aimeat_consent_grant) or revoking (aimeat_consent_revoke).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Consents', readOnlyHint: true },
        scope: 'consent:manage',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_access_list',
        description: "Who holds a key to your owner's account, and how far each key reaches, in one answer: the apps that act in their name with the rights each one has, the tokens they minted (label, level, expiry, last use; never the token itself), the accounts connected at other services, and the sign-in state (password set, two-step on or off, passkeys, the open sessions by device and by agent). The same read the Access page shows. Read-only: nothing here revokes; the person does that on the page. Needs account:security, which no wildcard carries — the owner ticks it per agent.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Access: Who Holds a Key', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The Access page's read (GET /v1/access/overview → owner, or account:security). Every key to the
        // account in one answer, so the word that opens it is the one no wildcard carries.
        scope: 'account:security',
        // On `agent`: Who holds a key to the owner's account: the Access page's read, for the agent the owner
        // trusted with account:security. Read-only; every revoke stays on the page.
        surfaces: ['agent', 'admin'],
        input: {},
    },
    {
        name: 'aimeat_secret_list',
        description: "The named keys and passwords in your owner's vault: for each one its name, when it was first stored, when its value last changed, and which extensions have used it in the last 30 days. NEVER a value — nothing on this node reads one back, including this tool and including the owner. Use it to see what is already stored before asking a person for a key again, and to see what would break before removing one. Needs secrets:manage, which no wildcard carries — the owner ticks it per agent.",
        caller: 'agent',
        visibility: agentEverywhere,
        // set is idempotent (the same name and value twice leaves the same row) and NOT destructive,
        // even though it replaces: what it replaces is a value nobody could read, and the caller
        // supplied the new one. delete IS destructive — whatever named that secret stops working.
        annotations: { title: 'Secrets: What Is Stored', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The owner's secrets vault (GET/PUT/DELETE /v1/secrets* → secrets:manage). The same word as
        // the routes, because the tools ARE those doors: a permission enforced on one surface and not
        // the other is a permission the owner was told they had (invariant 15). One word for all three:
        // the list is names and dates, and an agent that could read a name and not set it has nothing
        // it can act on. No wildcard carries it (utils/scope-coverage.ts).
        scope: 'secrets:manage',
        // On `agent`: The owner's secrets vault. On the agent surface because setting up an integration is
        // exactly the work an owner's own agent does, and a key it stores is one the owner never
        // has to paste anywhere. It can store and remove; nothing anywhere reads a value back.
        surfaces: ['agent', 'admin'],
        input: {},
    },
    {
        name: 'aimeat_secret_set',
        description: "Store a key or password in your owner's vault under a name, or replace what is there (same call either way — replacing keeps the date it was first stored). The value goes in and comes out of nothing: no tool, route or export returns it. What it is FOR is naming it in an outbound header as {{secret:NAME}} — an extension writes the placeholder, the node fills in the value on the way out, and the script and the document that carry the placeholder never hold the key. Name: letters, digits, underscore and hyphen, up to 64. Value: up to 4 kB. Needs secrets:manage, which no wildcard carries.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Store a Secret', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'secrets:manage',
        surfaces: ['agent', 'admin'],
        input: {
            name: { type: 'string', required: true, description: 'What to call it: letters, digits, underscore and hyphen, 1 to 64 characters. This is the name written into a header as {{secret:NAME}}, so it is case-exact.' },
            value: { type: 'string', required: true, description: 'The key or password itself, up to 4 kB. It is encrypted at rest and never returned by anything.' },
        },
    },
    {
        name: 'aimeat_secret_delete',
        description: "Remove one secret from your owner's vault by name. Anything that named it in a header stops working immediately and says so by name, so check aimeat_secret_list first to see which extensions have been using it. Answers a plain not-found when the owner holds no secret of that name. Needs secrets:manage, which no wildcard carries.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Remove a Secret', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'secrets:manage',
        surfaces: ['agent', 'admin'],
        input: { name: { type: 'string', required: true, description: 'The secret to remove, exactly as it was stored.' } },
    },
    {
        name: 'aimeat_consent_revoke',
        description: 'Revoke a consent grant by its id, setting status to revoked and stamping the time (the record is kept for audit, not deleted). Only the consent owner may revoke. Find the id with aimeat_consent_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Revoke Consent', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'consent:manage',
        surfaces: ['admin'],
        input: { consent_id: { type: 'string', required: true, description: 'ID of the consent to revoke.' } },
    },
    {
        name: 'aimeat_flag_report',
        description: 'Flag content for operator moderation: specify the target type (memory, board_post, action, or agent), its id, and a reason (unreliable, inappropriate, illegal, spam, other), with optional context. Each agent can flag a given item once; duplicates are rejected. Flags are operator-reviewed — this tool only submits, it does not remove content.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Report Content for Moderation', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // Writes something other people see under the owner's name.
        scope: 'social:write',
        surfaces: ['admin'],
        input: {
            target_type: { type: 'string', required: true, description: 'Type of content being reported.', zod: z.enum(FLAG_TARGET_TYPES) },
            target_id: { type: 'string', required: true, description: 'Identifier of the reported content.' },
            reason: { type: 'string', required: true, description: 'Reason for the report.', zod: z.enum(FLAG_REASONS) },
            description: { type: 'string', description: 'Optional additional context.' },
        },
    },
    {
        name: 'aimeat_group_list',
        description: 'List the sharing groups relevant to you: those your owner created plus any your owner or this agent is a member of (deduplicated), each with name, owner, and member count. Sharing groups back the "group" visibility level on memory entries. Inspect one with aimeat_group_get, create one with aimeat_group_create.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Sharing Groups', readOnlyHint: true },
        // The words GET /v1/groups asks (secaudit 2026-10 follow-up, A4).
        scope: 'memory:read',
        surfaces: ['admin'],
        input: {},
    },
    {
        name: 'aimeat_group_get',
        description: 'Get one sharing group\'s full detail by id: members with their identifier type, permissions, and added-at, plus the group\'s default permissions. Only the owner or a member may read it. A sharing group is distinct from an organism (managed agent group) — for those use aimeat_organism_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get Sharing Group', readOnlyHint: true },
        // The words GET /v1/groups/:id asks (secaudit 2026-10 follow-up, A4).
        scope: 'memory:read',
        surfaces: ['admin'],
        input: { group_id: { type: 'string', required: true, description: 'Group identifier.' } },
    },
    {
        name: 'aimeat_group_create',
        description: 'Create a sharing group owned by your GHII, optionally seeding initial members (each a GAII/GHII with read/write permissions; default read-only). Returns the new group id to target with the "group" visibility option on aimeat_memory_write. Max 50 groups per owner. Add members later with aimeat_group_add_member.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Create Sharing Group', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'consent:groups',
        surfaces: ['admin'],
        input: {
            name: { type: 'string', required: true, description: 'Group name.' },
            description: { type: 'string', description: 'Group description.' },
            members: { type: 'array', description: 'Initial members to add (each identifier + identifier_type + optional permissions).', zod: z.array(z.object({
                identifier: z.string().describe('GAII or GHII of the member'),
                identifier_type: z.enum(['gaii', 'ghii']).describe('Type of identifier'),
                permissions: z.object({
                    read: z.boolean(),
                    write: z.boolean(),
                }).optional().describe('Member permissions (defaults to read:true, write:false)'),
            })) },
        },
    },
    {
        name: 'aimeat_group_add_member',
        description: 'Add a member (GAII or GHII) to a sharing group you own, with optional read/write permissions (defaults to the group default). Only the group owner may add, max 100 members, and duplicates are rejected. The new member can then read group-visibility memory shared to that group; remove with aimeat_group_remove_member.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Add Group Member', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // A sharing group IS a consent boundary: who may read what.
        // A sharing group IS the boundary of who reads the owner's memory. POST/PUT/DELETE
        // /v1/sharing-groups are owner-only; here it costs an explicit tick instead of being shut.
        scope: 'consent:groups',
        surfaces: ['admin'],
        input: {
            group_id: { type: 'string', required: true, description: 'Group identifier.' },
            identifier: { type: 'string', required: true, description: 'Member GAII or GHII.' },
            identifier_type: { type: 'string', required: true, enum: ['gaii', 'ghii'], description: 'Type of identifier.' },
            permissions: { type: 'object', description: 'Member permissions { read, write } (defaults to group default).', zod: z.object({
                read: z.boolean(),
                write: z.boolean(),
            }) },
        },
    },
    {
        name: 'aimeat_group_remove_member',
        description: 'Remove a member (by GAII/GHII identifier) from a sharing group you own, revoking their access to that group\'s shared memory. Only the group owner may remove, and the member must currently be in the group. Add members with aimeat_group_add_member.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Remove Group Member', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'consent:groups',
        surfaces: ['admin'],
        input: {
            group_id: { type: 'string', required: true, description: 'Group identifier.' },
            identifier: { type: 'string', required: true, description: 'Member GAII or GHII.' },
        },
    },
    {
        name: 'aimeat_share_create',
        description: 'Let a sharing group read a key space of your owner\'s memory. The group says WHO, this says WHAT: give a key or a pattern ("deliveries.abc.**"), and every key under it becomes readable by that group — including keys written later, which is what makes a subscription work without touching the share again. `*` is one segment, `**` is the whole subtree. The records stay private to everyone else; a share is an exception on top of their visibility, not a change to it. Needs the share:manage permission, which no wildcard carries. Withdraw with aimeat_share_revoke.',
        caller: 'agent',
        visibility: agentEverywhere,
        // Idempotent: the same pattern to the same group returns the share that already exists rather
        // than adding a second row that revoking the first would not undo.
        annotations: { title: 'Share a Key Space', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // A share is the other half, and a separate decision: the group is WHO, the share is WHAT they
        // reach. Assembling an audience and handing it a key space are different acts, and only the
        // second one gives anything away — so it costs its own tick and no wildcard carries it.
        scope: 'share:manage',
        surfaces: ['admin'],
        input: {
            group_id: { type: 'string', required: true, description: 'The group whose members should be able to read.' },
            key_pattern: { type: 'string', required: true, description: 'Key or pattern, e.g. "deliveries.abc.**".' },
            note: { type: 'string', description: 'A reminder for the owner\'s own list; the reader never sees it.' },
            expires_at: { type: 'string', description: 'ISO timestamp after which it stops granting. Omit for until-revoked.' },
        },
    },
    {
        name: 'aimeat_share_list',
        description: 'List key-space shares in either direction: "outgoing" is what your owner has given away and to whom, "incoming" is what other people have shared with your owner (and with you). The incoming direction is how you discover data you may read without being told the owner and the exact key by hand — take an owner_gaii and key_pattern from it and read with aimeat_memory_read_public.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Shares', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['admin'],
        input: {
            direction: { type: 'string', required: true, enum: ['outgoing', 'incoming'], description: 'Default outgoing.', zod: z.enum(['outgoing', 'incoming']).default('outgoing') },
        },
    },
    {
        name: 'aimeat_share_revoke',
        description: 'Withdraw a key-space share by id. Reads stop at once and the records fall back to their own visibility; copies the reader already took are not recalled, which no revocation anywhere can do. Removing the person from the group has the same effect for that person while leaving the share in place for everyone else in it. Needs share:manage.',
        caller: 'agent',
        visibility: agentEverywhere,
        // Destructive in the sense that matters: someone who could read loses that access.
        annotations: { title: 'Stop Sharing', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'share:manage',
        surfaces: ['admin'],
        input: { share_id: { type: 'string', required: true, description: 'The share to withdraw.' } },
    },
    {
        name: 'aimeat_instance_list',
        description: 'List the chat instances under your owner — registered AI chat sessions (platform, app name, linked GHII, last-seen). Chat instances represent a running client/app session, not extension instances. Register one with aimeat_instance_create, inspect one with aimeat_instance_status.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Chat Instances', readOnlyHint: true },
        input: {},
    },
    {
        name: 'aimeat_instance_create',
        description: 'Register (or upsert) a chat instance under your owner for an app name, deriving the platform from an optional model identifier. If one with the same derived id already exists it is returned as-is rather than duplicated. Use to track a client/app session; list them with aimeat_instance_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Create Chat Instance', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        input: {
            name: { type: 'string', required: true, description: 'Instance name.' },
            model: { type: 'string', description: 'AI model identifier (e.g. gpt-4o, claude-3-5-sonnet); platform is derived from it.' },
        },
    },
    {
        name: 'aimeat_instance_status',
        description: 'Get one chat instance\'s detail by id (platform, app name, linked GHII, anonymity, node id, created/last-seen). Only instances under your owner are accessible. Find ids with aimeat_instance_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get Chat Instance Status', readOnlyHint: true },
        // The words GET /v1/chat-instances/:id asks (secaudit 2026-10 follow-up, A4).
        scope: 'wallet:read',
        input: { instance_id: { type: 'string', required: true, description: 'Instance identifier.' } },
    },
    {
        name: 'aimeat_knowledge_list',
        description: 'List knowledge packages owned across your scope (your GHII and same-owner agents) — curated memory collections under "packages/", each with name, content type, tags, and entry count. Knowledge packages are structured memory bundles distinct from raw memory keys. Read one with aimeat_knowledge_get, add to one with aimeat_knowledge_contribute.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Knowledge Packages', readOnlyHint: true },
        surfaces: ['agent', 'service'],
        input: {},
    },
    {
        name: 'aimeat_knowledge_get',
        description: 'Get a knowledge package by id: its manifest plus every entry with the entry values inlined. Use after aimeat_knowledge_list when you need the actual content, not just the listing. To see relationships to other packages use aimeat_knowledge_links.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Knowledge Package', readOnlyHint: true },
        surfaces: ['agent', 'service'],
        input: { package_id: { type: 'string', required: true, description: 'Knowledge package identifier.' } },
    },
    {
        name: 'aimeat_knowledge_contribute',
        description: 'Add or update an entry in an existing knowledge package: pass the package id, a short entry key, and content (JSON is parsed if valid, otherwise stored as text). Bumps the entry version and registers it in the package manifest if new. The package must already exist (it is not created here). The appdev-pitfalls package is reserved — use aimeat_appdev_pitfall_report for it.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Contribute to Knowledge Package', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // These write memory records underneath, whatever the tool is called: a workspace
        // document, a skill manifest, a schedule report, a knowledge contribution.
        scope: 'memory:write',
        surfaces: ['agent', 'service'],
        input: {
            ...aiProvenanceCatalogInput,
            package_id: { type: 'string', required: true, description: 'Knowledge package identifier.' },
            entry_key: { type: 'string', required: true, description: 'Entry key.' },
            content: { type: 'string', required: true, description: 'Entry content.' },
            model: { type: 'string', description: 'Optional LLM model this knowledge came from (stored as a model: tag).', zod: z.string().max(64) },
        },
    },
    {
        name: 'aimeat_knowledge_links',
        description: 'List the relationship links of a knowledge package (incoming, outgoing, or both) — each a source/target/relation describing how packages connect. Read-only graph view; for the package\'s own content use aimeat_knowledge_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get Knowledge Links', readOnlyHint: true },
        surfaces: ['agent', 'service'],
        input: {
            package_id: { type: 'string', required: true, description: 'Knowledge package identifier.' },
            direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'], description: 'Link direction (default: both).' },
        },
    },
    {
        name: 'aimeat_appdev_overview',
        description: 'THE research call before building an app ON AIMEAT — one compact "big picture": the owner\'s existing apps (often the best template to fork/copy), library packs with per-model AEB proof summaries, T1/T2/T3 app-shell templates, loadable skills (node:aimeat-app-builder first), curated pitfalls, every active learned pitfall you can read (your own and those other owners shared, critical first), and prior template proposals. Indexes only with drill-down pointers; pass sections=[...] for a partial fetch and model=<YOUR OWN model id — self-identify, never ask the user> to mark proven packs and list the pitfalls your model wrote first (it never hides one). Flow: research (this) → frame → propose to the user → build.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'AppDev Research Overview', readOnlyHint: true },
        // The words GET /v1/appdev/overview asks (secaudit 2026-10 follow-up, A4).
        scope: 'memory:read',
        surfaces: ['appdev', 'agent'],
        input: {
            model: { type: 'string', description: 'Your primary model (indicative), e.g. claude-haiku-4.5. Marks proven packs and orders learned pitfalls; filters nothing.', zod: z.string().max(64) },
            sections: { type: 'array', description: 'Subset: apps, library_packs, app_templates, skills, pitfalls_curated, pitfalls_learned, template_proposals.', zod: z.array(z.enum(OVERVIEW_SECTIONS)) },
        },
    },
    {
        name: 'aimeat_appdev_pitfall_report',
        description: 'Record a pitfall learned while building an app ON AIMEAT (apps/extensions/cortex — never node development): what broke, what fixed it, and WHICH MODEL hit it (model is required, self-reported, indicative). Call at the end of a build for anything the next builder should know. Upserts by {category, slug} — reporting the same slug again REPLACES the entry with better wording (version bumps). status=outdated hides an entry models no longer stumble on; share=true publishes it platform-wide so other owners\' agents learn from it (default: private to your owner scope). Stored in the reserved knowledge package appdev-pitfalls.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Report AppDev Pitfall', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // AppDev pitfall KB (learned entries are memory records under packages/appdev-pitfalls/).
        // Delete gates on memory:write (not memory:delete) deliberately: it only removes the owner's
        // OWN KB entries, report can already overwrite them, and no scope profile grants memory:delete
        // — a stricter gate would just dead-end the tool for every appdev-profile agent.
        scope: 'memory:write',
        surfaces: ['appdev', 'agent'],
        input: {
            model: { type: 'string', required: true, description: 'YOUR OWN model id — the model that hit/solved this. Self-identify from your own configuration, never ask the user. Indicative attribution.', zod: z.string().min(1).max(64) },
            category: { type: 'string', required: true, description: 'Kebab-case category (auth, ext, cortex, realtime, mobile, publish, ai, data...).', zod: z.string().min(1).max(40) },
            title: { type: 'string', required: true, description: 'Short imperative title.', zod: z.string().min(3).max(160) },
            symptom: { type: 'string', required: true, description: 'What the builder observes.', zod: z.string().min(5).max(10_000) },
            resolution: { type: 'string', required: true, description: 'What to do instead.', zod: z.string().min(5).max(40_000) },
            slug: { type: 'string', description: 'Stable kebab-case slug; same {category, slug} updates the entry.', zod: z.string().max(64) },
            applies_to: { type: 'array', description: 'Areas: app, auth, ext, cortex, iam, realtime, ai, mobile, publish.', zod: z.array(z.string().max(20)).max(8) },
            severity: { type: 'string', enum: ['info', 'warn', 'critical'], description: 'Default warn.' },
            status: { type: 'string', enum: ['active', 'outdated'], description: 'outdated = kept but hidden from default lists.' },
            app_ref: { type: 'string', description: 'Related app (owner/filename.html).', zod: z.string().max(200) },
            share: { type: 'boolean', description: 'true = platform-wide public entry; default private to your owner scope.' },
        },
    },
    {
        name: 'aimeat_appdev_pitfall_list',
        description: 'List appdev pitfalls before building an app ON AIMEAT — merged from your own learned entries, the node\'s curated registry, and other owners\' shared entries. scope: own (your bubble) | platform (curated + shared) | all (default). Filter by category, applies_to area, or model; paginated (limit/offset) with total + facet counts so a large KB stays navigable. Outdated entries are hidden by default. One full learned entry: aimeat_memory_read {key, owner_scope: true} for your own, aimeat_memory_read_public {gaii: owner, key} for a shared one (the list names its owner); curated detail via GET /v1/appdev/pitfalls/{id}.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List AppDev Pitfalls', readOnlyHint: true },
        // The word GET /v1/appdev/pitfalls/index asks (secaudit 2026-10 follow-up, A4).
        scope: 'memory:read',
        surfaces: ['appdev', 'agent'],
        input: {
            scope: { type: 'string', enum: ['own', 'platform', 'all'], description: 'own = your owner\'s entries; platform = the curated registry and other owners\' shared entries; all = both (default).' },
            category: { type: 'string', description: 'Filter by category.', zod: z.string().max(40) },
            model: { type: 'string', description: 'Filter learned entries to one model (e.g. claude-haiku-4.5).', zod: z.string().max(64) },
            applies_to: { type: 'string', description: 'Filter by area (app, auth, ext, cortex, iam, realtime, ai, mobile, publish).', zod: z.string().max(20) },
            status: { type: 'string', enum: ['active', 'outdated', 'all'], description: 'Default active (outdated hidden).' },
            limit: { type: 'number', description: 'Page size, default 25 (max 100).', zod: z.number().int().min(1).max(100) },
            offset: { type: 'number', description: 'Page start, default 0.', zod: z.number().int().min(0) },
        },
    },
    {
        name: 'aimeat_appdev_pitfall_delete',
        description: 'Delete one of your learned appdev-pitfall entries entirely (removes the entry and its manifest reference). Prefer aimeat_appdev_pitfall_report with status=outdated when the pitfall merely stopped being relevant — delete is for wrong or duplicate entries.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete AppDev Pitfall', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['appdev', 'agent'],
        input: {
            category: { type: 'string', required: true, description: 'Entry category.', zod: z.string().min(1).max(40) },
            slug: { type: 'string', required: true, description: 'Entry slug.', zod: z.string().min(1).max(64) },
        },
    },
    {
        name: 'aimeat_app_template_propose',
        description: 'Record a reusable TEMPLATE distilled from an app you just built/published on this node — call after a successful publish when anything generalizes. Captures what to reuse (reuse_notes), the tier (T1 pure client / T2 +cortex / T3 +extension), the packs it relies on, how the next build should start (fork the source app vs scaffold), and WHICH MODEL built it (required, indicative). Proposing the same id again UPDATES the proposal. Owner-private in v1; the next build finds it via aimeat_appdev_overview or aimeat_discover type=template scope=own.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Propose App Template', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Template proposals are owner-GHII memory records; same reasoning as above.
        scope: 'memory:write',
        surfaces: ['appdev', 'agent'],
        input: {
            id: { type: 'string', required: true, description: 'Stable kebab-case template id (same id = update).', zod: z.string().min(1).max(64) },
            title: { type: 'string', required: true, description: 'Template title.', zod: z.string().min(3).max(160) },
            description: { type: 'string', required: true, description: 'What the template is for.', zod: z.string().min(5).max(10_000) },
            derived_from: { type: 'object', required: true, description: '{owner, filename} of YOUR published source app.', zod: z.object({ owner: z.string().min(1).describe('Your own owner name'), filename: z.string().min(1).describe('The published app this template distills') }) },
            tier: { type: 'string', required: true, enum: ['T1', 'T2', 'T3'], description: 'T1 pure client · T2 +cortex · T3 +extension.' },
            reuse_notes: { type: 'string', required: true, description: 'What generalizes — the parts a next build should copy/keep.', zod: z.string().min(10).max(40_000) },
            model: { type: 'string', required: true, description: 'YOUR OWN model id — the model that built the source app. Self-identify, never ask the user (indicative).', zod: z.string().min(1).max(64) },
            tags: { type: 'array', description: 'Discovery tags.', zod: z.array(z.string().max(30)).max(12) },
            start_mode: { type: 'string', enum: ['fork', 'scaffold', 'either'], description: 'How the next build starts (default either).' },
            start_mode_rationale: { type: 'string', description: 'Why that start mode.', zod: z.string().max(10_000) },
            model_notes: { type: 'array', description: 'Per-model observations [{model, notes, evidence?}].', zod: z.array(z.object({ model: z.string().max(64), notes: z.string().max(10_000), evidence: z.string().max(10_000).optional() })).max(10) },
            packs: { type: 'array', description: 'Library-pack ids the template relies on.', zod: z.array(z.string().max(40)).max(20) },
            composes: { type: 'array', description: 'Component template ids it composes.', zod: z.array(z.string().max(40)).max(20) },
        },
    },
    {
        name: 'aimeat_app_template_list',
        description: 'List your owner\'s agent-proposed app templates (id, title, tier, model, start mode, derived-from app, proof count). Check this BEFORE building a new app — a prior template is usually the fastest correct starting point. Full detail + how-to-start via aimeat_app_template_get. `node_templates` lists what the node itself ships by id, kind and title, the Atelier track first: the genres a new app is forked from (genre-<id>), the Atelier shells, then the Classic shells, components and use cases, for a client that cannot call GET /v1/app-templates.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List App Template Proposals', readOnlyHint: true },
        // The words GET /v1/appdev/templates asks (secaudit 2026-10 follow-up, A4).
        scope: 'memory:read',
        surfaces: ['appdev', 'agent'],
        input: {},
    },
    {
        name: 'aimeat_app_template_get',
        description: 'Read one agent-proposed template: the full manifest (reuse notes, packs, per-model notes, proofs) plus the source app\'s LIVE state (forkable, price, version, download URL) and a concrete how_to_start instruction (fork via aimeat_app_fork vs scaffold from the notes; priced apps are bought through checkout, never with morsels directly). An id the node ships (a genre such as genre-almanac, a shell, a component, a use case) returns that template with its starting file in `content`, the same as GET /v1/app-templates/{id}. A genre that grew out of a published app (source "design-book" in aimeat_app_template_list) answers the same way, with `grew_from` naming the app and the version its owner kept.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read App Template Proposal', readOnlyHint: true },
        // The words GET /v1/appdev/templates/:id asks (secaudit 2026-10 follow-up, A4).
        scope: 'memory:read',
        surfaces: ['appdev', 'agent'],
        input: {
            id: { type: 'string', required: true, description: 'Template id: a proposal, or one the node ships.', zod: z.string().min(1).max(64) },
            part: { type: 'number', description: 'Only for a template the node ships whose file is too large for one answer: which part to return (1-based). The first answer says how many parts there are.', zod: z.number().int().min(1) },
        },
    },
    {
        name: 'aimeat_app_template_delete',
        description: 'Delete one of your template proposals entirely. Prefer re-proposing (upsert) with better content when the template is merely stale — delete is for wrong or duplicate proposals.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete App Template Proposal', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['appdev', 'agent'],
        input: { id: { type: 'string', required: true, description: 'Template proposal id.', zod: z.string().min(1).max(64) } },
    },
    {
        name: 'aimeat_appdev_proof_attach',
        description: 'Attach a SELF-REPORTED per-model acceleration proof (pass/fail + evidence) to a community contribution you own: a community library pack (your public cortex lib — proofs appear on /v1/library-packs with self_reported: true) or one of your app-template proposals. Append-only ledger, duplicate (model, test_set, date) rejected; honest fails make your passes credible. This is the "proven acceleration" attribution sellers build a track record with — a node-verified badge is a separate later feature, never implied by these.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Attach Acceleration Proof', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['appdev', 'agent'],
        input: {
            subject_type: { type: 'string', required: true, enum: ['library_pack', 'app_template'], description: 'What the proof attaches to.' },
            subject_id: { type: 'string', required: true, description: 'Community pack id (cortex name) or template proposal id.', zod: z.string().min(1).max(80) },
            model: { type: 'string', required: true, description: 'Model the run was made with (indicative).', zod: z.string().min(1).max(64) },
            verdict: { type: 'string', required: true, enum: ['pass', 'fail'], description: 'Did it accelerate the run.' },
            evidence: { type: 'string', required: true, description: 'URL / storage / memory ref to the run evidence.', zod: z.string().min(3).max(500) },
            test_set: { type: 'string', description: 'Repeatable test-set id, when used.', zod: z.string().max(120) },
            tokens: { type: 'number', description: 'Output tokens the run consumed.', zod: z.number().int().min(0) },
        },
    },
    {
        name: 'aimeat_skill_publish',
        description: 'Publish or update a skill in the skills registry — a SKILL.md pack (YAML frontmatter with name + description, markdown body = the expertise) plus optional scripts/, references/, assets/ files. Pass skill_md inline for single-file skills; omit it to receive a presigned upload URL for a skill-directory ZIP. Scopes: user (default, your owner\'s registry), node (operator-only, node-wide library), workspace (organism_id + workspace_id required; membership-gated, always workspace-visible, rides workspace export/templates). Republishing the same name bumps the version. Skills are a dedicated system, distinct from knowledge packages.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Publish Skill', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            skill_md: { type: 'string', description: 'SKILL.md content (frontmatter + body). Omit for presigned ZIP upload mode.' },
            files: { type: 'object', description: 'Additional files as relative-path -> content (scripts/, references/, assets/).', zod: z.record(z.string(), z.string()) },
            scope: { type: 'string', enum: ['user', 'node', 'workspace'], description: 'Registry scope (default user).' },
            visibility: { type: 'string', enum: ['owner', 'members', 'public'], description: 'Registry visibility (node/user). Defaults: user->owner, node->members. public = federated.' },
            organism_id: { type: 'string', description: 'Workspace scope: the organism id.' },
            workspace_id: { type: 'string', description: 'Workspace scope: the workspace id.' },
            ...aiProvenanceCatalogInput,
        },
    },
    {
        name: 'aimeat_skill_list',
        description: 'Browse the skills registry without loading bodies (progressive disclosure — manifests only). view=library (default) returns everything you can load right now grouped by scope: the node-wide library, your owner\'s user registry, and the skills of every organism workspace your owner belongs to. view=linked shows the skill refs attached to an agent (default: yourself). view=mine lists only your owner\'s user-scope skills. view=workspace lists one workspace\'s skills (organism_id + workspace_id). Load a skill\'s actual content with aimeat_skill_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Browse Skills Registry', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service', 'chat'],
        input: {
            view: { type: 'string', enum: ['library', 'linked', 'mine', 'workspace'], description: 'Which listing (default library).' },
            agent_name: { type: 'string', description: 'For view=linked: which same-owner agent (default yourself).' },
            organism_id: { type: 'string', description: 'For view=workspace: the organism id.' },
            workspace_id: { type: 'string', description: 'For view=workspace: the workspace id.' },
            binding: { type: 'string', description: 'Filter to skills bound to one app: app:{owner}/{filename}. Overrides view.' },
        },
    },
    {
        name: 'aimeat_skill_get',
        description: 'Resolve one skill from the registry: manifest (name, description, version, file index) plus the file bodies (SKILL.md and any scripts/, references/, assets/). Address it by full ref (node:{name}, user:{owner}/{name}, ws:{org}/{ws}/{name}, optionally version-pinned with @{semver} — the registry retains the newest 10 snapshots) or by bare name (your own registry is searched first, then the node library). Set manifest_only=true to skip bodies. Access follows the skill\'s scope + visibility.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Resolve Skill', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service', 'chat'],
        input: {
            ref: { type: 'string', description: 'Full skill ref: node:{name}, user:{owner}/{name}, or ws:{org}/{ws}/{name}.' },
            name: { type: 'string', description: 'Bare skill name (own registry first, then node library). Ignored when ref is given.' },
            manifest_only: { type: 'boolean', description: 'Return only the manifest, no file bodies.' },
        },
    },
    {
        name: 'aimeat_skill_link',
        description: 'Attach a skill to a same-owner agent by ref. Links store references, never copies — the agent\'s consumers (e.g. a crew runtime) resolve the ref to fresh content at load time via GET /v1/agents/{name}/skills or aimeat_skill_get. The ref must be readable by your owner (own skill, node-library skill, or another user\'s public skill). Idempotent per ref.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Link Skill to Agent', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            ref: { type: 'string', required: true, description: 'Skill ref to attach: node:{name} or user:{owner}/{name}.' },
            agent_name: { type: 'string', description: 'Which same-owner agent to attach to (default yourself).' },
        },
    },
    {
        name: 'aimeat_skill_unlink',
        description: 'Detach a skill ref from a same-owner agent (default: yourself). The skill itself stays in the registry; only the agent attachment is removed. Returns the remaining links.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Unlink Skill from Agent', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            ref: { type: 'string', required: true, description: 'Skill ref to detach.' },
            agent_name: { type: 'string', description: 'Which same-owner agent to detach from (default yourself).' },
        },
    },
    {
        name: 'aimeat_skill_update',
        description: 'Change who may read a skill without publishing it again: owner (you and your agents), members (every signed-in identity on this node) or public (readable from other nodes too, and listed in the public skill index). The registry version stays as it is and nothing is snapshotted. Your owner\'s own user-scope skills; node scope is for operators. A workspace skill is always workspace-visible and is refused here.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Change Skill Visibility', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            name: { type: 'string', required: true, description: 'The skill name (the bare name from its frontmatter).' },
            visibility: { type: 'string', required: true, enum: ['owner', 'members', 'public'], description: 'Who may read it from now on.' },
            scope: { type: 'string', enum: ['user', 'node'], description: 'Which registry the skill is in (default user, your owner\'s own).' },
        },
    },
    {
        name: 'aimeat_operator_agent_configure',
        description: 'Configure a same-owner agent with PROPOSE-THEN-CONFIRM. Without confirm_token nothing is applied: the tool returns the current state, the proposed state, a field-level diff, and a single-use confirm_token (10 min TTL) bound to exactly this change — show the diff to the owner. Calling again with the same arguments plus the token applies it; changing anything invalidates the token. Configurable: display_name, description, mode, tags, scopes. Scope changes may only NARROW the granted set — adding scopes remains an owner approval in the profile UI. (Connector/CLI apply directly through the per-field routes, which carry the same owner/operator authz; display_name/description are shell-unsupported.)',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Configure Agent (Propose-then-Confirm)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Rewriting an agent's PERMISSIONS is its own word, and no wildcard carries it. PATCH
        // /v1/agents/:name/scopes is owner-only, and the propose-then-confirm dance here binds the
        // token to the CALLER — so the same agent mints and redeems it in two consecutive calls, and
        // the "show this diff to the owner" text is instruction rather than a gate.
        // The words PATCH /v1/agents/:name/mode asks (secaudit 2026-10 follow-up, A4).
        scope: ['agent:permissions', 'agent:write'],
        surfaces: ['agent', 'admin'],
        input: {
            agent_name: { type: 'string', required: true, description: 'Which same-owner agent to configure.' },
            display_name: { type: 'string', description: 'New display name.' },
            description: { type: 'string', description: 'New description.' },
            mode: { type: 'string', enum: ['interactive', 'autonomous', 'task-runner', 'coordinator', 'workstation'], description: 'New agent mode.' },
            tags: { type: 'array', description: 'Replacement tag list.', zod: z.array(z.string()) },
            scopes: { type: 'array', description: 'Replacement scope list (narrowing only).', zod: z.array(z.string()) },
            confirm_token: { type: 'string', description: 'On the node\'s own MCP: the token from the propose step; omit it to propose and see the change first. The shell and the connector apply directly, because the REST routes take no token.' },
        },
    },
    {
        name: 'aimeat_operator_ai_config',
        description: 'Inspect or change the owner\'s AI routing + daily budget with PROPOSE-THEN-CONFIRM. With no fields: returns the current safe view (daily_budget_usd, model, reasoning_model, execution_model). With fields but no confirm_token: applies NOTHING — returns current/proposed/diff + a single-use token (10 min) bound to exactly this change; show the diff to the owner. With the token: applies. The API key is stored separately and can NEVER be read or changed through this tool. (Connector/CLI apply the daily budget directly via the owner-gated route; model routing is shell-unsupported.)',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Configure AI Routing & Budget (Propose-then-Confirm)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Writes keys the server itself trusts (openrouter.*, ai-usage.*, profile.*).
        scope: 'memory:write-reserved',
        surfaces: ['agent', 'admin'],
        input: {
            daily_budget_usd: { type: 'number', description: 'Daily AI spend cap in USD (0-1000).', zod: z.number().min(0).max(1000) },
            model: { type: 'string', description: 'Default model id.' },
            reasoning_model: { type: 'string', description: 'Model for modelRole "reasoning".' },
            execution_model: { type: 'string', description: 'Model for modelRole "execution".' },
            confirm_token: { type: 'string', description: 'On the node\'s own MCP: the token from the propose step; omit it to propose and see the change first. The shell and the connector apply directly, because the REST routes take no token.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
