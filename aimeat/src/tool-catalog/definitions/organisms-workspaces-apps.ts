/**
 * @file organisms-workspaces-apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Public memory reads, organism + workspace lifecycle, wallet transactions, HTML apps, extensions, IAM design, and cortex tool definitions (incl. operator-only aimeat_admin_mint).
 *   One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by definitions.ts.
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   2026-10-01 — aimeat_organism_create takes `shape` and `lang` (starting shapes with their workspaces).
 *   2026-09-30 — aimeat_workspace_comment_delete; aimeat_organism_invite_email takes `locale`.
 *   2026-09-28 — aimeat_organism_invite_email takes `return_url`, where the invitee lands after accepting;
 *     aimeat_organism_update takes `agent_access`.
 *   2026-09-28 — aimeat_image_generate takes `role`, the AI role the call runs as.
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v1.9.0 — 2026-09-27 — aimeat_app_versions, _screenshot, _seo_set, _marks_set, _legal_set and _audit
 *     moved into aimeat_app_manage (definitions/app-manage.ts) as actions with the same fields.
 *   v1.8.1 — 2026-09-26 — aimeat_memory_read_public says a Design Book part is read through the Design
 *     Book, and that it answers DESIGN_BOOK_PART naming that door.
 *   v1.8.0 — 2026-09-25 — aimeat_workspace_update takes `member_changes`; the three member change
 *     tools (./workspace-member-changes.ts) are spread in right after it.
 *   v1.7.3 — 2026-09-26 — aimeat_app_legal_set says what the named reviewer does to the label on a
 *     strict node (it stays and names the reviewer) instead of promising it is lifted everywhere.
 *   v1.7.2 — 2026-09-18 — Two descriptions sent an agent to aimeat_workspace_write_draft, which is
 *     not a tool; the tool is aimeat_workspace_write. Instruction review.
 *   v1.7.1 — 2026-09-13 — aimeat_app_publish declares cortex_agents, which the node's tool has taken
 *     since 2026-07-16 and no other surface did.
 *   v1.7.0 — 2026-09-06 — workspace_access.action/decision/role, workspace_member_grant.role and
 *     workspace_transfer.direction declare their enums. Every one of them names its allowed values
 *     in prose and published `type: string`, so a caller reading the schema had to guess and the
 *     handler threw.
 *   v1.6.0 — 2026-09-03 — aimeat_workspace_read's index carries the locked `schemas`, and
 *     aimeat_workspace_update's `schemas` now points at that read instead of at
 *     GET /v1/memory/{key}/schema — a REST call an MCP-only agent cannot make, which left the tool
 *     telling every caller to do the impossible before an overwrite.
 *   v1.5.0 — 2026-09-02 — aimeat_app_audit takes `playtest`: the node opens the app in a real
 *     browser and answers with what it saw, which is how an agent with no screen looks at the game
 *     it just published.
 *   v1.4.0 — 2026-08-29 — aimeat_app_legal_set (the app's own legal pages; money, never morsels, makes
 *     a shop; ai_provenance on the write) and aimeat_app_audit (its log).
 *   v1.3.0 — 2026-08-29 — aimeat_app_marks_set: the badge and install-chip switches on one app.
 *   v1.2.0 — 2026-08-16 — the four incremental app-draft tools (write/replace/read/seed), reachable
 *     from all three doors. `content` is plain text here where aimeat_app_draft_save takes base64:
 *     a caller composing HTML is not moving a file, and base64 would inflate every chunk by a third.
 *   v1.5.0 — 2026-09-14 — aimeat_workspace_update's `add_spaces` documents the ROW shape
 *     (backing:'rows' + indexOn, no mode), which the memory-only description had hidden.
 *   v1.1.0 — 2026-07-31 — aimeat_workspace_write documents its `items` batch (space/value become
 *     optional; one call carries a whole migration).
 *   v1.0.0 — 2026-07-13 — Extracted from definitions.ts (pure extraction; no behavior change).
 */

import { wsGrantShape } from '../input-schemas.js';
import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';
// Documents and rows: the two surfaces that edit PART of a workspace object rather than replace
// one. Spread in place below, so the catalog order is exactly what it was before the extraction.
import { workspaceSpaceTools } from './workspace-spaces.js';
import { workspaceMemberChangeTools } from './workspace-member-changes.js';
import { appPublishTools } from './apps-publish.js';

export const organismsWorkspacesAppsTools = [
    {
        name: 'aimeat_memory_read_public',
        description: 'Read a single public memory entry belonging to another agent or owner, by their GAII/GHII and the exact key. Only entries with public visibility are returned; private/owner/group entries are access-denied. Use for cross-identity reads; for your own memory use aimeat_memory_read. A Design Book part (a key starting "atelier.book.part." under the node\'s own system identity) is read with aimeat_designbook_get, the one tool that reads it: this tool answers DESIGN_BOOK_PART and names that tool.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Public Memory', readOnlyHint: true },
        scope: 'memory:read',
        surfaces: ['agent', 'service', 'commerce'],
        input: {
            gaii: { type: 'string', required: true, description: 'Target agent or owner GAII/GHII.' },
            key: { type: 'string', required: true, description: 'Memory entry key.' },
        },
    },
    {
        name: 'aimeat_organism_list',
        description: 'List organisms (managed groups of agents) visible to you: all public ones plus any your owner belongs to, with name, type, visibility, join policy, and member count. Use to find organisms to inspect (aimeat_organism_get) or join (aimeat_organism_join). An organism is distinct from a sharing group (aimeat_group_list).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Organisms', readOnlyHint: true },
        // On `chat`: What their groups know. Writing to a workspace is found when it is needed: its description
        // alone is 6 500 characters, which every round would pay for.
        surfaces: ['appdev', 'agent', 'service', 'chat'],
        input: {},
    },
    {
        name: 'aimeat_organism_get',
        description: 'Get one organism\'s full detail by id: description, type, visibility, join policy, capacity, linked board, creator/admins, interests/location, and active members. Visible only if public/listed or you are a member. Check join policy here before calling aimeat_organism_join; for just the roster use aimeat_organism_members.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get Organism', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service'],
        input: { organism_id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_organism_join',
        description: 'Join an organism (a managed group of agents). Returns joined immediately for open organisms, or pending_approval for approval-required ones. Invite-only organisms cannot be joined this way.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Join Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'social:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            message: { type: 'string', description: 'Optional message to organism admins (for approval-required organisms).' },
        },
    },
    {
        name: 'aimeat_organism_leave',
        description: 'Leave an organism you belong to. The creator cannot leave — they must delete the organism instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Leave Organism', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: { organism_id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_organism_members',
        description: 'List the members of an organism (GHII, role, status, joined-at), optionally filtered by role or status (defaults to active). Visible only if the organism is public/listed or you are a member. For the organism\'s settings and metadata use aimeat_organism_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Organism Members', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            role: { type: 'string', description: 'Filter members by role (e.g. admin, member).' },
            status: { type: 'string', description: 'Filter members by status (defaults to active).' },
        },
    },
    {
        name: 'aimeat_organism_invite',
        description: 'Invite an owner to an organism by their bare owner name, optionally with an organism role (member/admin) and per-workspace grants applied when they accept. Creator/admin only. Creates a pending invitation and notifies the invitee, who accepts or declines (aimeat_organism_invitation_respond); edit a pending one with aimeat_organism_invitation_update, withdraw with aimeat_organism_invitation_cancel. To add an existing owner IMMEDIATELY without the accept step use aimeat_organism_member_add. Distinct from aimeat_organism_join (which the joiner calls).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Invite to Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            invitee: { type: 'string', required: true, description: 'Bare owner name to invite (e.g. "alice").' },
            role: { type: 'string', enum: ['member', 'admin'], description: 'Organism role granted on accept (default "member").' },
            workspaces: { type: 'array', description: 'Optional per-workspace grants applied on accept: [{ ws, role }] where role is "viewer" or "contributor".', zod: wsGrantShape },
        },
    },
    {
        name: 'aimeat_organism_member_add',
        description: 'DIRECTLY add an already-registered local owner to an organism as an ACTIVE member — no invitation round-trip. Creator/admin only. Applies the organism role and any per-workspace grants immediately; the new member is notified and can leave at any time. Use aimeat_organism_invite instead when the person should approve joining first.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Add Organism Member', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ghii: { type: 'string', required: true, description: 'Bare owner name to add (e.g. "alice").' },
            role: { type: 'string', enum: ['member', 'admin'], description: 'Organism role (default "member").' },
            workspaces: { type: 'array', description: 'Optional per-workspace grants applied immediately: [{ ws, role }] where role is "viewer" or "contributor".', zod: wsGrantShape },
        },
    },
    {
        name: 'aimeat_organism_member_remove',
        description: 'Take a member off an organism: their membership goes, their agents drop off the organism, and their per-workspace grants are revoked, all in one step. Creator/admin only; an admin can only be removed by the creator, and the creator cannot be removed at all (delete the organism instead). Plain removal lets them be invited again — pass ban to refuse a later invitation or direct add as well, which is what to use when someone keeps being re-added. Removing a member does NOT withdraw a pending invitation to them: withdraw that with aimeat_organism_invitation_cancel.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Remove Organism Member', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ghii: { type: 'string', required: true, description: 'Bare owner name to remove (e.g. "alice").' },
            ban: { type: 'boolean', description: 'Also block them from re-joining, being invited or being added again (default false).' },
        },
    },
    {
        name: 'aimeat_organism_owner_add',
        description: 'Make an existing active member a co-owner of an organism you own. ADDITIVE: you keep everything you had, and an organism can have several owners. That is the point — ownership used to move in one irreversible step, so an organism whose single owner became unreachable could not be recovered by anyone. A blocked target is refused; someone who already owns it is ALREADY_OWNER. To hand it over and step back in one call instead, use the transfer route.',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: false },
        annotations: { title: 'Add Organism Owner', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'The organism ID.' },
            ghii: { type: 'string', required: true, description: 'Bare owner name of an active member to make a co-owner.' },
        },
    },
    {
        name: 'aimeat_organism_owner_remove',
        description: 'Take an owner off an organism you own; they stay on as an admin. Any owner may remove any other. The LAST owner cannot be removed (LAST_OWNER) — an organism with no owner is the one state nobody inside it can repair, so add another owner first or delete the organism.',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: false },
        annotations: { title: 'Remove Organism Owner', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'The organism ID.' },
            ghii: { type: 'string', required: true, description: 'Bare owner name to take off the owners.' },
        },
    },
    {
        name: 'aimeat_organism_invitation_update',
        description: 'Edit a PENDING name invitation\'s organism role and/or workspace grants before the invitee accepts (creator/admin only). The invitee lands with the edited rights the moment they accept.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Edit Pending Invitation', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            invitee: { type: 'string', required: true, description: 'Bare owner name whose pending invitation to edit.' },
            role: { type: 'string', enum: ['member', 'admin'], description: 'New organism role.' },
            workspaces: { type: 'array', description: 'Replacement per-workspace grants: [{ ws, role }] where role is "viewer" or "contributor".', zod: wsGrantShape },
        },
    },
    {
        name: 'aimeat_organism_invitation_cancel',
        description: 'Withdraw a PENDING name invitation before it is accepted (creator/admin only). The invitee is notified that the invitation was withdrawn.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Withdraw Invitation', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        // Changes WHO ELSE can read the owner's knowledge. A different promise than changing
        // the knowledge, which is why it is not organism:write.
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            invitee: { type: 'string', required: true, description: 'Bare owner name whose pending invitation to withdraw.' },
        },
    },
    {
        name: 'aimeat_organism_invitations',
        description: 'List your own pending organism invitations across all organisms — each with a brief organism summary. Respond to one with aimeat_organism_invitation_respond.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List My Invitations', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service'],
        input: {},
    },
    {
        name: 'aimeat_organism_invitation_respond',
        description: 'Accept or decline an invitation to an organism that was extended to you. Accepting makes you an active member; declining removes the invitation.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Respond to Invitation', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier you were invited to.' },
            decision: { type: 'string', required: true, enum: ['accept', 'decline'], description: 'accept or decline.' },
        },
    },
    {
        // Server-only: an owner/admin inviting people not yet on the node by email. Not on the connector/CLI surface.
        name: 'aimeat_organism_invite_email',
        description: 'Invite a person who is NOT yet on this node into an organism by EMAIL. Creator/admin only. Sends a single-use, expiring link that lets the recipient register a new account and join in one step — granting the chosen organism role plus optional per-workspace roles. Distinct from aimeat_organism_invite (which targets an already-registered owner by name). Returns the accept URL so you can share it manually when email is not configured. Cancel a pending one with aimeat_organism_invitation_email_cancel.',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Invite to Organism by Email', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            email: { type: 'string', required: true, description: 'Email address of the person to invite.' },
            org_role: { type: 'string', enum: ['member', 'admin'], description: 'Organism role granted on accept (default "member").' },
            workspaces: { type: 'array', description: 'Optional per-workspace grants: [{ ws, role }] where role is "viewer" or "contributor".', zod: z.array(z.object({ ws: z.string(), role: z.enum(['viewer', 'contributor']) })) },
            message: { type: 'string', description: 'Optional personal note included in the invitation email.' },
            expires_in_days: { type: 'number', description: 'Days until the invitation expires (1–30, default 7).' },
            return_url: { type: 'string', description: 'Where the invitee lands after accepting: an app slug on this node (e.g. "my-app") or a full URL on this node or its app subdomains. Anything else is dropped and the invitee lands on their profile; return_url in the result says what was kept.' },
            locale: { type: 'string', description: 'Language of the invitation email: en, fi or es. Without it the email uses the recipient\'s account language when the address already has an account here, else yours. email_locale in the result says which one went out.' },
        },
    },
    {
        name: 'aimeat_organism_invitations_email',
        description: 'List the PENDING email invitations for an organism (creator/admin only) — each invitee email, organism role, workspace grants, and expiry. These are the outstanding invites you can cancel with aimeat_organism_invitation_email_cancel.',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'List Email Invitations', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
        },
    },
    {
        name: 'aimeat_organism_invitation_email_cancel',
        description: 'Cancel a PENDING email invitation before it is used (creator/admin only). Invalidates the link so it can no longer be accepted.',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Cancel Email Invitation', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            invitation_id: { type: 'string', required: true, description: 'The invitation id (from aimeat_organism_invitations_email).' },
        },
    },
    {
        name: 'aimeat_organism_search',
        description: 'Search the records + documents across an organism\'s workspaces by text (case-insensitive substring). Returns matches with the workspace, space (objectType), instance id, title, and a snippet around the hit. Searches only workspaces you may read; scope to one with `ws`. By default ARCHIVED content is excluded (it is hidden from normal operation); pass `archived: "only"` to search the archive, or `archived: "include"` to search both. Use this to FIND content before reading it with aimeat_workspace_read.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Search Organism Content', readOnlyHint: true },
        // The words GET /v1/organisms/:id/search asks (secaudit 2026-10 follow-up, A4).
        scope: 'organism:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            q: { type: 'string', required: true, description: 'Search text (min 2 characters).' },
            ws: { type: 'string', description: 'Optional: limit the search to a single workspace id.' },
            archived: { type: 'string', description: 'Archive scope: "exclude" (default — active only), "only" (archive search), or "include" (both).', zod: z.enum(['exclude', 'include', 'only']) },
        },
    },
    {
        name: 'aimeat_workspace_comment',
        description: 'Add a comment to a workspace object (a record or a document) — for discussion/review threads. Target it by ws + space (objectType) + instance_id. Optionally anchor it to part of a document via `anchor` ({ section } or { quote }), leave it general (no anchor), or reply to another comment via `parent_id` to thread. Agents and humans both comment here. Read a thread with aimeat_workspace_comments. Member-only.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Comment on Workspace Object', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            ...aiProvenanceCatalogInput,
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The objectType (space) name the target lives in.' },
            instance_id: { type: 'string', required: true, description: 'The id of the record/document being commented on.' },
            body: { type: 'string', required: true, description: 'The comment text.' },
            anchor: { type: 'object', description: 'Optional anchor to part of a document: { section } or { quote }.', zod: z.object({ section: z.string().optional(), quote: z.string().optional() }) },
            parent_id: { type: 'string', description: 'Optional id of the comment this replies to (threading).' },
        },
    },
    {
        name: 'aimeat_workspace_comments',
        description: 'List the comment thread on one workspace object (record or document), oldest first, with each comment\'s author, body, anchor (if any), and parent (for replies). Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Workspace Comments', readOnlyHint: true },
        // The words GET /v1/organisms/:id/comments asks (secaudit 2026-10 follow-up, A4).
        scope: 'organism:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The objectType (space) name.' },
            instance_id: { type: 'string', required: true, description: 'The record/document id.' },
        },
    },
    {
        name: 'aimeat_workspace_comment_delete',
        description: 'Delete one comment from a workspace object\'s thread. The comment\'s author may delete it, and so may the organism\'s creator or an admin, for example to remove a wrong comment or test traces. Take the comment id from aimeat_workspace_comments. Replies to the deleted comment stay.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete Workspace Comment', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The objectType (space) name.' },
            instance_id: { type: 'string', required: true, description: 'The record/document id the comment is on.' },
            comment_id: { type: 'string', required: true, description: 'The comment id (from aimeat_workspace_comments).' },
        },
    },
    {
        name: 'aimeat_workspace_list',
        description: 'List the WORKSPACES inside an organism. An organism holds one or more workspaces — each a self-describing space of documents (free-form markdown wiki) and/or records (schema-locked lists), declared by a manifest. Returns each workspace\'s id + name. Use the id with aimeat_workspace_read. You must be a member of the organism.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Workspaces', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service', 'chat'],
        input: { organism_id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_workspace_read',
        description: 'Read one workspace in TWO steps so you never pull a huge blob. DEFAULT (no `ids`) returns the INDEX: the manifest (the objectTypes it declares — each a records space with a JSON schema, or a document space of markdown pages), the JSON Schemas currently LOCKED on the records spaces as `schemas` (keyed by namespace, in the shape aimeat_workspace_update takes back — read this before you change one, because that update REPLACES rather than merges), plus, per space, EVERY instance as { id, title, updated, version, bytes, published, has_draft } — titles only, NO bodies — so it stays small however many/large the documents are. Scan the index (or aimeat_workspace_overview for the same as a Markdown map), pick the ids that likely hold what you need, then call this again with `ids:[...]` to BATCH-OPEN just those instances\' full values. Version history (.version.N) is never returned here — read a specific version via the memory API. Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Workspace', readOnlyHint: true },
        // The words GET /v1/organisms/:id/workspace asks (secaudit 2026-10 follow-up, A4).
        scope: 'organism:read',
        // On `primitives`: Know things together.
        surfaces: ['appdev', 'agent', 'service', 'primitives', 'chat'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id (from aimeat_workspace_list).' },
            ids: { type: 'array', description: 'Batch-open: return the FULL value of ONLY these instance ids (from the index). A full memory key, which is the id aimeat_discover gives a workspace record, is taken as well. Omit for the lightweight index.', zod: z.array(z.string()) },
            space: { type: 'string', description: 'With `ids`: optionally restrict the lookup to this space (objectType name or namespace).' },
            include_archived: { type: 'boolean', description: 'Include archived (hidden) content. Default false.' },
        },
    },
    {
        name: 'aimeat_organism_overview',
        description: 'Get a fast, OKF-style STRUCTURE MAP of a whole organism as Markdown — every workspace, its space breakdown (objectType → instance count), and totals. SHALLOW by design: read this ONE call FIRST to grasp the whole organism and decide where to drill in, instead of listing + reading each workspace. Then call aimeat_workspace_overview(ws) for the detailed map of the workspace you picked, and aimeat_workspace_read to pull the actual content. Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Organism Structure Overview', readOnlyHint: true },
        // The words GET /v1/organisms/:id/overview asks (secaudit 2026-10 follow-up, A4).
        scope: 'organism:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: { organism_id: { type: 'string', required: true, description: 'Organism identifier.' } },
    },
    {
        name: 'aimeat_workspace_overview',
        description: 'Get a fast, OKF-style STRUCTURE MAP of ONE workspace as Markdown — per space, the most-recently-updated entries (up to 10) with their instance id + title, and the total count of each space. Read this to find WHICH id you need, then call aimeat_workspace_read (or the memory API) to pull that record. Cheaper than reading the whole workspace when you only need to navigate. Same read access as aimeat_workspace_read; if you lack access the map says so. Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Workspace Structure Overview', readOnlyHint: true },
        // The words GET /v1/organisms/:id/workspace/overview asks (secaudit 2026-10 follow-up, A4).
        scope: 'organism:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id (from aimeat_workspace_list).' },
        },
    },
    {
        name: 'aimeat_workspace_write',
        description: "Create or overwrite DRAFT items in a workspace — records OR documents — in one tool. ONE item: pass `space` + `value`. MANY: pass `items: [{ value, space?, id?, section? }]` (up to 50) and they are all written in a SINGLE call — do this for any migration or multi-page import, because your client asks the human to approve every tool CALL, so twenty separate writes are twenty approval prompts and one unanswered prompt leaves the job half-done. A batch is all-or-nothing: every item is checked first, and one bad item writes nothing (the error names its index). Items inherit the top-level `space`/`section` unless they carry their own. Give the space NAME (the objectType, e.g. 'feature' or 'notes'); the tool resolves whether it is a records or document space and writes accordingly. For a records space, `value` is the record (validated against its schema, rejected if invalid) and needs an `id`. For a document space, `value` is { title, markdown }, the `id` is auto-generated, and you can file it under a `section`. Document markdown renders rich: ```mermaid fenced blocks become diagrams, and ```aimeat-memory fenced blocks become LIVE data (body lines `key: <memory key>`, optional `view: table|props|list`, `fields: a,b`, `title: …`) — the document shows the key's CURRENT value on every open, so for data that changes, write it with aimeat_memory_write as an array of objects and embed the key instead of pasting a static table. Drafts are NOT live until published (aimeat_workspace_publish). Embed images by uploading with aimeat_storage_upload and using the embed_markdown / embed_url it returns (the owner-addressed /v1/pub form) — NOT a hand-written /v1/storage/<key> path, which loads only for you. On save the embedded image is scoped to this workspace's members (not the public internet). Member-only." + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Write Workspace Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['appdev', 'agent', 'service', 'primitives'],
        input: {
            ...aiProvenanceCatalogInput,
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', description: "The objectType (space) NAME from the manifest, e.g. 'feature' or 'notes'. Required for a single write; with `items` it is the default each item inherits." },
            value: { type: 'object', description: 'The content object for a SINGLE write. Records: the record (matching its schema). Documents: { title, markdown }. Omit when using `items`.', zod: z.any() },
            id: { type: 'string', description: 'Instance id. Required for a records space (or include id in value); auto-generated for a document.' },
            section: { type: 'string', description: 'Document spaces only: section id/name to file the document under.' },
            items: { type: 'array', description: 'BATCH: [{ value, space?, id?, section? }] — up to 50 items written in one call (one approval prompt for the whole migration). All-or-nothing.', zod: z.any() },
        },
    },
    {
        name: 'aimeat_workspace_publish',
        description: 'Publish a draft → snapshots it to a new immutable .version.N + the live .latest and consumes the draft. Schema-validated. If the workspace\'s publish gate is on, this refuses and asks you to leave the draft for human review instead. Do not publish without the owner\'s go-ahead unless told to run autonomously. Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Publish Workspace Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // The words POST /v1/organisms/:id/publish asks (secaudit 2026-10 follow-up, A4).
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            namespace: { type: 'string', required: true, description: 'The instance namespace.' },
            id: { type: 'string', required: true, description: 'The instance id whose .draft to publish.' },
        },
    },
    {
        name: 'aimeat_workspace_revert_to_draft',
        description: 'Reopen a PUBLISHED record for editing — copies its .latest back into .draft so you can amend it and re-publish via aimeat_workspace_write + aimeat_workspace_publish. The published .latest stays live until you re-publish. Refuses if a draft already exists (edit that draft instead). Use this when a published record needs a change. Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Reopen Published Record', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // The words POST /v1/organisms/:id/revert asks (secaudit 2026-10 follow-up, A4).
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            namespace: { type: 'string', required: true, description: 'The instance namespace.' },
            id: { type: 'string', required: true, description: 'The instance id of the published record to reopen.' },
        },
    },
    {
        name: 'aimeat_workspace_object_delete',
        description: 'Permanently remove ONE object (record or document) from a workspace — its draft, its published .latest, and all .version.N history — and unfile it from any document section. Use this to retract a mistake or clean up a duplicate. Irreversible; member-only. To replace content instead, overwrite with aimeat_workspace_write.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete Workspace Object', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        // Removes a stored record.
        // Removes a record for good, no grace window: its own word since 2026-10-02, held on the
        // task-start floor (services/agent-task-rules.ts). memory:delete stays the undoable delete.
        scope: 'memory:purge',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            namespace: { type: 'string', required: true, description: "The objectType's namespace, e.g. shared.deliverables." },
            id: { type: 'string', required: true, description: 'The instance id to delete (draft + latest + all versions).' },
        },
    },
    ...workspaceSpaceTools,
    {
        name: 'aimeat_workspace_update',
        description: "Update a workspace IN PLACE — its name, readme, and/or its STRUCTURE — without changing its id (so nothing referencing it gets orphaned). To ADD spaces, pass `add_spaces` (an ARRAY of objectTypes): the server UNIONS them into the manifest, skips any whose name/namespace already exists, and fills sensible defaults — the safe, deterministic way to provision (no need to resend the whole manifest). To rename/remove a space, toggle the publish gate (policy.alwaysGate), or change settings, pass a full replacement `manifest`. Pass `schemas` to lock a records space's JSON Schema, and `member_changes` to set how the workspace takes its members' changes. Creator-only (or an org admin); a member who is neither adds a space with aimeat_workspace_space_add and changes sections with aimeat_workspace_sections_set, under the workspace's rule. The single tool for restructuring a workspace — no separate remove-space or set-gate tool.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Update Workspace', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            name: { type: 'string', required: false, description: 'New workspace name (synced to manifest + registry).' },
            readme: { type: 'string', required: false, description: 'New markdown readme/intro (replaces the current one).' },
            add_spaces: { type: 'array', required: false, description: 'ADDITIVE: objectTypes to UNION into the manifest (skip-if-exists). Pass just { name, namespace, mode } (+ a schema in `schemas`); defaults are filled. A ROW space is { name, namespace, backing:"rows", indexOn:[…] } and takes no mode: rows keep no version history and are neither records nor documents, and those defaults are filled for you too. Preferred over `manifest` for adding spaces. Returns { added, skipped }. Cannot remove/rename.' },
            manifest: { type: 'object', required: false, description: 'Full replacement manifest (objectTypes + policy/gate + settings) — for restructuring (rename/remove a space, change the gate). The id is preserved and the manifest is schema-validated. To only ADD spaces, prefer add_spaces. May also carry an optional top-level objectives[] (the measurability convention: why the organism exists + KPIs with kind value/cost/roi/outcome/quality and a source that can sum/count the organism\'s own records) and an objectType servesObjective linking a space to an objective; both optional — see "Recording purpose & value" in docs/agent-workspace-contracts.md.' },
            schemas: { type: 'object', required: false, description: "Map of namespace → JSON Schema (object) to lock (strict) for a records space. READ THE CURRENT SCHEMAS FIRST: this REPLACES the locked schema, it does not merge into it, so a schema you write without having read drops whatever else the old one said. aimeat_workspace_read (the default index call) returns them as `schemas`, keyed by namespace, in exactly this shape — read, edit the one entry, send the map back. And do not invent a maxLength: the real ceiling is the memory value budget the node enforces on the whole record (1024 kB by default), and a field cap smaller than that is a number somebody guessed, which is how a notes field filled up at 4000 characters for no reason anyone could name." },
            member_changes: { type: 'string', required: false, enum: ['direct', 'suggest'], description: "How this workspace takes a change from a member who is neither its creator nor an organism admin (aimeat_workspace_space_add, aimeat_workspace_sections_set): 'direct' = it lands at once with their name on it; 'suggest' = it waits until the creator or an admin approves it (the default)." },
        },
    },
    ...workspaceMemberChangeTools,
    {
        name: 'aimeat_organism_create',
        description: 'Create a new ORGANISM (a shared, governed container for people + agents): one place every AI the person connects and every person they invite reads and writes. You become its creator/admin/member, and it gets a discussion board. Give a `shape` to start it with ready workspaces (own-work, team, company, family, club, project; GET /v1/organisms/shapes lists what each makes), or add workspaces afterwards with aimeat_workspace_create. Use this to bootstrap a collaboration space from scratch.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Create Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            name: { type: 'string', required: true, description: 'Organism name (min 2 chars).' },
            description: { type: 'string', description: 'What this organism is for.' },
            type: { type: 'string', description: 'community | team | club | cooperative | project | company | family (default community, or the shape\'s).' },
            join_policy: { type: 'string', description: 'open | approval_required | invite_only (default open, or the shape\'s).' },
            visibility: { type: 'string', description: 'public | listed | private (default public, or the shape\'s).' },
            shape: { type: 'string', description: 'A starting shape that also creates its workspaces: own-work | team | company | family | club | project.' },
            lang: { type: 'string', description: 'Language of the shape\'s workspace names and readme: en | fi | es.' },
        },
    },
    {
        name: 'aimeat_organism_update',
        description: 'Update an ORGANISM in place (creator/admin only): its name, description (the short tagline), interests, join policy, visibility, and/or its free-form README — a markdown body (mermaid diagrams + aimeat-memory live-data blocks allowed) shown at the top of the organism home that explains what the organism is about and is kept up to date. The README is distinct from both the short description and the deterministic structure overview/mindmap. Pass only the fields you want to change.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Update Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            name: { type: 'string', required: false, description: 'New organism name.' },
            description: { type: 'string', required: false, description: 'Short tagline shown under the name.' },
            readme: { type: 'string', required: false, description: 'Free-form markdown README (mermaid + aimeat-memory live-data blocks allowed) describing the organism; shown at the top of the organism home. Replaces the current one.' },
            interests: { type: 'array', required: false, description: 'Interest tags.', zod: z.array(z.string()) },
            join_policy: { type: 'string', required: false, description: 'open | approval_required | invite_only.' },
            visibility: { type: 'string', required: false, description: 'public | listed | private.' },
            agent_access: { type: 'string', required: false, enum: ['all', 'listed'], description: 'Which members\' agents may act here: "all" (every member\'s agents, the default) or "listed" (only the agents in the Agents section of the organism\'s page; any other agent is refused as a non-member). An agent can set "listed"; only the owner signed in can set "all" again.' },
        },
    },
    {
        name: 'aimeat_organism_archive',
        description: 'ARCHIVE or UNARCHIVE organism content (creator/admin only). Archived content becomes READ-ONLY and is hidden from normal operation — it drops out of overviews, workspace reads, and search — so the working set stays focused; it stays findable via archive search (aimeat_organism_search with archived:"only") and remains restorable. Choose the level: "organism" (the whole organism), "workspace" (one workspace + its records), "space" (one record-table/document-space namespace), or "record" (one instance). Archiving a container CASCADES to its contents; unarchiving uses smart restore (it restores only what THAT archival flagged, leaving separately-archived items archived). Use action:"unarchive" to reverse.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Archive / Unarchive Organism Content', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Create a workspace, write and publish in one, comment, transfer.
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            action: { type: 'string', required: true, description: '"archive" or "unarchive".', zod: z.enum(['archive', 'unarchive']) },
            level: { type: 'string', required: true, description: '"organism" | "workspace" | "space" | "record".', zod: z.enum(['organism', 'workspace', 'space', 'record']) },
            ws: { type: 'string', required: false, description: 'Workspace id (required for workspace/space/record).' },
            namespace: { type: 'string', required: false, description: 'The objectType namespace (required for level "space"), e.g. "shared.tasks".' },
            key: { type: 'string', required: false, description: 'The instance base memory key (required for level "record"), e.g. "organism.{id}.w.{ws}.shared.tasks.{instance}".' },
        },
    },
    {
        name: 'aimeat_workspace_create',
        description: 'Create a new WORKSPACE inside an organism from a CUSTOM MANIFEST you supply — its objectTypes (each a records space with a JSON schema, or a document/wiki space) plus the per-namespace schemas. Registers it, locks the schemas, writes the manifest + readme. This is how an agent bootstraps a structured space; then fill it with aimeat_workspace_write (records and documents alike) and publish with aimeat_workspace_publish. Member-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Create Workspace', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism to create the workspace in.' },
            name: { type: 'string', required: true, description: 'Workspace name.' },
            manifest: { type: 'object', required: true, description: 'The manifest. You really only need its `objectTypes` array — the envelope (manifestVersion, id, name, kind, status) is BACKFILLED for you when omitted, so an objectTypes-only manifest is accepted on the first call (name defaults from this tool\'s `name` param, kind to "project"). Full shape: { objectTypes: [{ name, namespace, mode:"records"|"document", schemaRef, writeRole, cardinality, versioned }], policy? }. Each space is backing:"memory" (the default) — "rows" is the ROW STORE for a stream that arrives in volume and does not stop (appended, no version history, charged to the organism, filtered on up to three fields named in `indexOn`, and read through the rows tools rather than the record ones), "tasks" only declares a pointer to the task system, and "storage"/"knowledge" are rejected: files and knowledge packages attach via workspace Sources or embedded document images, never as a backed space. The test for memory versus rows is one multiplication: if keys_per_day × 365 exceeds 1000, use rows.', zod: z.any() },
            schemas: { type: 'object', description: 'Map of namespace → JSON Schema for each records objectType, e.g. { "shared.tasks": { type:"object", required:["id","title"], properties:{...} } }.', zod: z.any() },
            readme: { type: 'string', description: 'Optional markdown intro (defaults to the manifest name + summary).' },
        },
    },
    {
        name: 'aimeat_workspace_access',
        description: "REQUEST/REVIEW flow for a gated workspace, via `action`: 'request' = ask the creator for access to a workspace you can see but not read (org membership lets you DISCOVER workspaces; a workspace's CONTENT is gated by its creator); 'list' = (creator/admin) see who has requested (pending/approved) plus current members + roles; 'decide' = (creator/admin) approve or deny a request (approve grants 'contributor' by default; pass role='viewer' for read-only). Member-only; list/decide are creator-or-admin. To add a member PROACTIVELY (no prior request), or to add to MANY workspaces at once, use aimeat_workspace_member_grant.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Manage Workspace Access', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            action: { type: 'string', required: true, enum: ['request', 'list', 'decide'], description: "'request' | 'list' | 'decide'." },
            message: { type: 'string', description: "action='request': optional note to the creator." },
            requester: { type: 'string', description: "action='decide': the requester's owner name (from action='list')." },
            decision: { type: 'string', enum: ['approve', 'deny'], description: "action='decide': 'approve' (default) or 'deny'.", zod: z.string() },
            role: { type: 'string', enum: ['viewer', 'contributor'], description: "action='decide' approve: 'viewer' (read) or 'contributor' (read+write). Omit for the default (contributor)." },
        },
    },
    {
        name: 'aimeat_workspace_member_grant',
        description: "Directly grant an EXISTING organism member a workspace role — no prior access request needed. Grant to ONE workspace (`ws`) or MANY at once (`workspaces`: e.g. every workspace from aimeat_workspace_list), so 'add this member to all workspaces' is one call. `grantee` may be an owner name, GHII (owner@node), or GAII (agent#owner@node) — the grant applies to the OWNER, so all their agents inherit it. role: 'viewer' (read) | 'contributor' (read+write). Authorized for the workspace creator or an org admin. Per-workspace result: granted / skipped_creator / forbidden_or_not_found. Each grant is auditable (a creator-owned consent stamped with its source).",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Grant Workspace Role', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', description: 'A single workspace id (use this and/or `workspaces`).' },
            workspaces: { type: 'array', description: 'Many workspace ids to grant in one call.', zod: z.array(z.string()) },
            grantee: { type: 'string', required: true, description: 'Owner name, GHII, or GAII to grant. Applies to the owner (agents inherit).' },
            role: { type: 'string', required: true, enum: ['viewer', 'contributor'], description: "'viewer' (read) or 'contributor' (read+write)." },
        },
    },
    {
        name: 'aimeat_workspace_member_revoke',
        description: "Remove a member's workspace role on ONE workspace (`ws`) or MANY (`workspaces`). `grantee` may be an owner name, GHII, or GAII (resolved to the owner). To DOWNGRADE (e.g. contributor → viewer) rather than remove, call aimeat_workspace_member_grant with the lower role instead. Authorized for the workspace creator or an org admin. Per-workspace result: revoked / not_a_member / forbidden_or_not_found.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Revoke Workspace Role', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', description: 'A single workspace id (use this and/or `workspaces`).' },
            workspaces: { type: 'array', description: 'Many workspace ids to revoke in one call.', zod: z.array(z.string()) },
            grantee: { type: 'string', required: true, description: 'Owner name, GHII, or GAII to revoke.' },
        },
    },
    {
        name: 'aimeat_workspace_members',
        description: "List a workspace's members with their role ('viewer' | 'contributor'), the grant's source (grant | request | invite), who granted it, and when. Authorized for the workspace creator or an org admin. For the organism-wide roster (all members + org roles) use aimeat_organism_members instead.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Workspace Members', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id (from aimeat_workspace_list).' },
        },
    },
    {
        name: 'aimeat_workspace_transfer',
        description: "Back up or restore a workspace, via `direction`. 'export' = a full-fidelity base64 ZIP (manifest, locked schemas, all object versions/drafts, sections, sources, image binaries) for backup or to move it; size-capped inline, very large workspaces download via UI/REST; creator/admin. 'import' = restore a base64 ZIP as a NEW workspace (record/document ids preserved so links stay valid, schemas re-locked, images deduped, image URLs rewritten); you become the new workspace's creator; member of the target organism.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Export / Import Workspace', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // The words GET .../workspace/export and POST .../workspace/import asks (secaudit 2026-10 follow-up, A4).
        scope: ['organism:read', 'organism:write'],
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier (source for export, target for import).' },
            direction: { type: 'string', required: true, enum: ['export', 'import'], description: "'export' or 'import'." },
            ws: { type: 'string', description: "direction='export': the workspace id to export." },
            zip_base64: { type: 'string', description: "direction='import': the workspace export ZIP, base64-encoded." },
        },
    },
    {
        name: 'aimeat_organism_export',
        description: 'Export a whole organism (its settings + every workspace you can read) as one base64 ZIP backup. Organism creator or admin. Size-capped for inline use — very large organisms should be downloaded via the UI/REST.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Export Organism', readOnlyHint: true },
        // The words GET /v1/organisms/:id/export asks (secaudit 2026-10 follow-up, A4).
        scope: 'organism:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism to export.' },
        },
    },
    {
        name: 'aimeat_organism_import',
        description: 'Import an organism bundle (base64 ZIP from aimeat_organism_export) as a NEW organism — you become its creator, and every workspace inside is restored (ids remapped, schemas re-locked, images re-created). Membership/board from the source are not restored, only settings + workspace content.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Import Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            zip_base64: { type: 'string', required: true, description: 'The organism export ZIP, base64-encoded (from aimeat_organism_export).' },
        },
    },
    {
        name: 'aimeat_wallet_transactions',
        description: 'View recent morsel transactions for your owner\'s wallet (id, type, amount, counterparty, tracking code, timestamp; default 20, max 200). Transactions are keyed to the owner GHII, shared across agents. For the current balance/escrow snapshot use aimeat_wallet_balance.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Wallet Transactions', readOnlyHint: true },
        scope: 'wallet:read',
        surfaces: ['service', 'commerce'],
        input: { limit: { type: 'number', description: 'Maximum transactions to return.', zod: z.number().int().min(1).max(200) } },
    },
    // The app publishing and draft tools, SEO, image generation and the admin mint: ./apps-publish.ts,
    // spread in place.
    ...appPublishTools,
] as const satisfies readonly AimeatToolDefinition[];
