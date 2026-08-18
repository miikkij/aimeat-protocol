/**
 * @file organisms.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP organisms tools and resource registrations. Provides 5 tools for organism
 *   management (list, get, join, leave, members) and 1 resource template for reading organism
 *   details + members via the MCP resource protocol.
 * @structure
 *   - registerOrganismsTools() — registers all organism tools and resources on an McpServer instance
 * @usage
 *   import { registerOrganismsTools } from './organisms.js';
 *   registerOrganismsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.8.0 — 2026-08-11 — create/update/join/leave call services/organism-lifecycle.ts, the same
 *     writer the REST routes use (August 2026 MCP audit step 8). The tools keep their gates and their
 *     text; four side effects the copies disagreed on now happen on both surfaces: the join-request
 *     notifications, the `organisms` change-bus emit, the structure snapshot and the public feed entry.
 *   v1.6.0 — 2026-07-16 — invite carries role + workspace grants (shared services/invitations.ts core);
 *     new member_add (direct add), invitation_update, invitation_cancel tools; respond-accept applies grants.
 *   v1.2.0 — 2026-07-16 — members roster rosters agents via getAgentsByOwners (one IN, was per-member)
 *   v1.x -- 2026-07-02 -- readme param description mentions aimeat-memory live-data blocks (with mermaid).
 *   v1.0.0 — 2026-03-21 — Initial creation: 5 tools + 1 resource for organism management via MCP
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 -- 2026-06-08 -- Add aimeat_organism_create (mirrors POST /v1/organisms; membership keyed
 *     by the bare owner name, matching the route + workspace gate).
 *   v1.4.0 -- 2026-06-10 -- organism_members lists each member's agents (implicit same-owner access
 *     made enumerable — audit gap: join answered ALREADY_MEMBER but no surface showed which agents
 *     can act in the organism). Active-member callers only; matches the REST members route.
 *   v1.5.0 -- 2026-06-22 -- Add aimeat_organism_update (creator/admin): edit name/description/interests/
 *     join_policy/visibility and the free-form README (organism.{id}.meta.readme). Mirrors PUT /v1/organisms/:id.
 *   v1.7.0 -- 2026-08-01 -- TARGET-058 Phase 8b. aimeat_workspace_comment accepts an `ai_provenance`
 *     declaration and stamps the body through provenanceForWrite(); the id lands on the comment's own
 *     memory row, so a reader resolves it from the comment rather than by hash.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { exportOrganism } from '../services/organism-export.js';
import { importOrganism } from '../services/organism-import.js';
import { registerOrganismNameInviteTools } from './organisms-name-invites.js';
import { registerOrganismEmailInviteTools } from './organisms-email-invites.js';
import { searchOrganismContent } from '../services/organism-search.js';
import { archiveTarget, unarchiveTarget, type ArchiveLevel } from '../services/archive.js';
import { canAccessWorkspaceComments, addComment, listComments } from '../services/organism-comments.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';
import { provenanceForWrite } from '../services/ai-provenance.js';
import { createOrganismRecord, updateOrganismRecord, joinOrganism, leaveOrganism } from '../services/organism-lifecycle.js';
import { canSeeMembers } from '../services/organism-privacy.js';
import { emitChange } from '../services/event-bus.js';
import { ZipSecurityError } from '../services/safe-zip.js';
import { recordSecurityIncident } from '../services/security-incident.js';
import { isOrganismOwner, organismOwners } from '../services/organism-ownership.js';

export function registerOrganismsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    /** The owner's BARE name. Membership records, organism.members[], creatorGhii and admins are all
     *  keyed by the bare owner name (see aimeat_organism_create), NOT the full GHII — so visibility,
     *  list-by-member, and join/leave checks must compare against the bare name. */
    function getOwnerName(): string {
        const parsed = parseGAII(agentGaii);
        return parsed ? parsed.owner : agentGaii;
    }

    /** Check if an organism is visible to the current agent. */
    async function canSeeOrganism(organism: { visibility: string; members: string[] }): Promise<boolean> {
        if (organism.visibility === 'public' || organism.visibility === 'listed') return true;
        const ownerName = getOwnerName();
        return organism.members.includes(ownerName);
    }

    // ── Resource: organism details ──
    mcp.registerResource(
        'organism-details',
        new ResourceTemplate('aimeat://organisms/{id}', {
            list: async () => {
                const organisms = await storage.listOrganisms({ visibility: 'public', archived: 'exclude' });
                return {
                    resources: organisms.map(o => ({
                        uri: `aimeat://organisms/${encodeURIComponent(o.id)}`,
                        name: o.name,
                        mimeType: 'application/json',
                        description: `Organism: ${o.name} (${o.visibility}, ${o.type})`,
                    })),
                };
            },
        }),
        { mimeType: 'application/json', description: 'Organism details and members' },
        async (uri, variables) => {
            const id = decodeURIComponent(variables.id as string);
            const organism = await storage.getOrganism(id);
            if (!organism) return { contents: [{ uri: uri.toString(), text: 'Organism not found' }] };
            if (!(await canSeeOrganism(organism))) return { contents: [{ uri: uri.toString(), text: 'Access denied' }] };
            const allMembers = await storage.listMembers(id, { status: 'active' });
            // Roster privacy (memberVisibility): below the tier only creator/admin rows + own row.
            const canSeeRoster = await canSeeMembers(storage, organism, { ownerName: getOwnerName() });
            const members = canSeeRoster ? allMembers
                : allMembers.filter(m => m.role === 'creator' || m.role === 'admin' || m.ghii === getOwnerName());
            return {
                contents: [{
                    uri: uri.toString(),
                    text: JSON.stringify({
                        id: organism.id,
                        name: organism.name,
                        description: organism.description,
                        type: organism.type,
                        visibility: organism.visibility,
                        join_policy: organism.joinPolicy,
                        max_members: organism.maxMembers,
                        board_id: organism.boardId,
                        owners: organismOwners(organism),
                        created_by: organism.createdBy,
                        creator_ghii: organism.creatorGhii,
                        admins: organism.admins,
                        interests: organism.interests,
                        location: organism.location,
                        member_count: allMembers.length,
                        members_hidden: !canSeeRoster,
                        members: members.map(m => ({
                            id: m.id,
                            ghii: m.ghii,
                            role: m.role,
                            status: m.status,
                            joined_at: m.joinedAt,
                        })),
                        created_at: organism.createdAt,
                        updated_at: organism.updatedAt,
                    }, null, 2),
                    mimeType: 'application/json',
                }],
            };
        },
    );

    // ── Tool 1: aimeat_organism_list ──
    mcp.tool(
        'aimeat_organism_list',
        descriptionFor('aimeat_organism_list'),
        {},
        annotationsFor('aimeat_organism_list'),
        async () => {
            const ownerName = getOwnerName();
            // Get public organisms (archived ones are read-only/hidden from AI operations — excluded)
            const publicOrgs = await storage.listOrganisms({ visibility: 'public', archived: 'exclude' });
            // Get organisms the owner is a member of (may include private ones); archived excluded too
            const memberOrgs = await storage.listOrganisms({ member: ownerName, archived: 'exclude' });
            // Merge, deduplicate by id
            const seen = new Set<string>();
            const all = [...publicOrgs, ...memberOrgs].filter(o => {
                if (seen.has(o.id)) return false;
                seen.add(o.id);
                return true;
            });
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(all.map(o => ({
                        id: o.id,
                        name: o.name,
                        description: o.description,
                        type: o.type,
                        visibility: o.visibility,
                        join_policy: o.joinPolicy,
                        member_count: o.members.length,
                        board_id: o.boardId,
                        interests: o.interests,
                        location: o.location,
                        created_at: o.createdAt,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_organism_get ──
    mcp.tool(
        'aimeat_organism_get',
        descriptionFor('aimeat_organism_get'),
        {
            organism_id: z.string().describe('The organism ID'),
        },
        annotationsFor('aimeat_organism_get'),
        async ({ organism_id }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            if (!(await canSeeOrganism(organism))) return { content: [{ type: 'text' as const, text: 'Access denied' }], isError: true };

            const allMembers = await storage.listMembers(organism_id, { status: 'active' });
            // Roster privacy (memberVisibility): below the tier only creator/admin rows + own row.
            const canSeeRoster = await canSeeMembers(storage, organism, { ownerName: getOwnerName() });
            const members = canSeeRoster ? allMembers
                : allMembers.filter(m => m.role === 'creator' || m.role === 'admin' || m.ghii === getOwnerName());

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: organism.id,
                        name: organism.name,
                        description: organism.description,
                        type: organism.type,
                        visibility: organism.visibility,
                        join_policy: organism.joinPolicy,
                        max_members: organism.maxMembers,
                        board_id: organism.boardId,
                        owners: organismOwners(organism),
                        created_by: organism.createdBy,
                        creator_ghii: organism.creatorGhii,
                        admins: organism.admins,
                        interests: organism.interests,
                        location: organism.location,
                        member_count: allMembers.length,
                        members_hidden: !canSeeRoster,
                        members: members.map(m => ({
                            id: m.id,
                            ghii: m.ghii,
                            role: m.role,
                            status: m.status,
                            joined_at: m.joinedAt,
                        })),
                        created_at: organism.createdAt,
                        updated_at: organism.updatedAt,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_organism_join ──
    mcp.tool(
        'aimeat_organism_join',
        descriptionFor('aimeat_organism_join'),
        {
            organism_id: z.string().describe('The organism ID to join'),
            message: z.string().optional().describe('Optional message for join requests (used when approval is required)'),
        },
        annotationsFor('aimeat_organism_join'),
        async ({ organism_id, message }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            // A private organism an agent cannot see answers as if it did not exist. The HTTP door
            // has no such check (an id is enough there); it stays on this surface because a tool
            // call is the one that arrives without a person having navigated to the organism first.
            if (organism.visibility === 'private' && !(await canSeeOrganism(organism))) {
                return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            }

            // The membership checks, capacity, the policy branch and the approver notifications are
            // the shared writer's (services/organism-lifecycle.ts, same call POST /:id/join makes).
            const result = await joinOrganism({ storage, config }, organism, getOwnerName(), message);
            if (!result.ok) {
                // The invitation refusal names the tool that resolves it; the rest render the
                // service's own message.
                const text = result.code === 'ALREADY_INVITED'
                    ? 'You have a pending invitation — accept it with aimeat_organism_invitation_respond instead'
                    : result.message;
                return { content: [{ type: 'text' as const, text }], isError: true };
            }
            if (result.outcome === 'joined') {
                emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'joined', organism_id }, null, 2) }] };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'pending_approval', organism_id }, null, 2) }] };
        },
    );

    // ── Tool 4: aimeat_organism_leave ──
    mcp.tool(
        'aimeat_organism_leave',
        descriptionFor('aimeat_organism_leave'),
        {
            organism_id: z.string().describe('The organism ID to leave'),
        },
        annotationsFor('aimeat_organism_leave'),
        async ({ organism_id }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };

            // Shared with POST /:id/leave (services/organism-lifecycle.ts): the membership row and
            // the roster/admin sync go together.
            const result = await leaveOrganism({ storage, config }, organism, getOwnerName());
            if (!result.ok) return { content: [{ type: 'text' as const, text: result.message }], isError: true };

            emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ left: true, organism_id }, null, 2) }] };
        },
    );

    // ── Tool 5: aimeat_organism_members ──
    mcp.tool(
        'aimeat_organism_members',
        descriptionFor('aimeat_organism_members'),
        {
            organism_id: z.string().describe('The organism ID'),
            role: z.string().optional().describe('Filter by role: creator, admin, member'),
            status: z.string().optional().describe('Filter by status: active, pending, banned (default: active)'),
        },
        annotationsFor('aimeat_organism_members'),
        async ({ organism_id, role, status }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            if (!(await canSeeOrganism(organism))) return { content: [{ type: 'text' as const, text: 'Access denied' }], isError: true };

            const allMembers = await storage.listMembers(organism_id, {
                role,
                status: status || 'active',
            });

            // Roster privacy (memberVisibility): below the tier the listing shrinks to the
            // accountability rows — creator/admins + the caller's own row (matches REST /members).
            const canSeeRoster = await canSeeMembers(storage, organism, { ownerName: getOwnerName() });
            const members = canSeeRoster ? allMembers
                : allMembers.filter(m => m.role === 'creator' || m.role === 'admin' || m.ghii === getOwnerName());

            // Same-owner agents inherit a member's access implicitly — list them per member so
            // "who can touch this organism" is enumerable (matches the REST members route). Only
            // an ACTIVE member's agent sees the agent rosters; public visibility alone does not.
            const callerMembership = await storage.getMembership(organism_id, getOwnerName());
            const canSeeAgents = callerMembership?.status === 'active';
            const agentsByOwner = new Map<string, { gaii: string; name: string }[]>();
            if (canSeeAgents) {
                const ownerNames = [...new Set(members.map(m => (m.ghii.includes('#') ? m.ghii.split('#')[1] : m.ghii).split('@')[0]))];
                const batched = await storage.getAgentsByOwners(ownerNames);
                for (const name of ownerNames) {
                    agentsByOwner.set(name, (batched[name] ?? []).map(a => ({ gaii: a.gaii, name: a.name })));
                }
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(members.map(m => ({
                        id: m.id,
                        ghii: m.ghii,
                        role: m.role,
                        status: m.status,
                        joined_at: m.joinedAt,
                        invited_by: m.invitedBy,
                        ...(canSeeAgents ? { agents: agentsByOwner.get((m.ghii.includes('#') ? m.ghii.split('#')[1] : m.ghii).split('@')[0]) ?? [] } : {}),
                    })), null, 2),
                }],
            };
        },
    );

    // ── Name-invitation + direct-add tools (invite, member_add, invitation_update,
    // invitation_cancel, invitations, invitation_respond) — extracted to organisms-name-invites.ts;
    // registered here to preserve tool order.
    registerOrganismNameInviteTools(mcp, storage, config, getOwnerName, agentGaii, emitResourceUpdated);

    // ── Email-invitation tools (invite_email, invitations_email, invitation_email_cancel) ──
    // Extracted to organisms-email-invites.ts; registered here to preserve tool order.
    registerOrganismEmailInviteTools(mcp, storage, config, getOwnerName);

    // ── Tool: aimeat_organism_search ── (content search across readable workspaces)
    mcp.tool(
        'aimeat_organism_search',
        descriptionFor('aimeat_organism_search'),
        {
            organism_id: z.string().describe('The organism ID'),
            q: z.string().describe('Search text (min 2 characters)'),
            ws: z.string().optional().describe('Optional: limit to a single workspace id'),
            archived: z.enum(['exclude', 'include', 'only']).optional().describe('Archive scope: exclude (default), only (archive search), or include (both)'),
        },
        annotationsFor('aimeat_organism_search'),
        async ({ organism_id, q, ws, archived }) => {
            const query = (q ?? '').trim();
            if (query.length < 2) return { content: [{ type: 'text' as const, text: 'Query must be at least 2 characters' }], isError: true };
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            const ownerName = getOwnerName();
            // Membership gate: an org agent or an active member.
            let isMember = organism.agentGaiis.includes(agentGaii);
            if (!isMember) {
                const m = await storage.getMembership(organism_id, ownerName);
                isMember = !!m && m.status === 'active';
            }
            if (!isMember) return { content: [{ type: 'text' as const, text: 'Not an active member of this organism' }], isError: true };
            // Caller identity for the workspace read gate: the full GAII (agent) resolves via same-owner.
            const { results, truncated } = await searchOrganismContent(storage, config, organism, agentGaii, query, ws, { archived });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ query, results, total: results.length, truncated, archived: archived ?? 'exclude' }, null, 2) }] };
        },
    );

    // ── Tool: aimeat_organism_archive ── (archive/unarchive content; read-only + hidden from AI)
    mcp.tool(
        'aimeat_organism_archive',
        descriptionFor('aimeat_organism_archive'),
        {
            organism_id: z.string().describe('The organism ID'),
            action: z.enum(['archive', 'unarchive']).describe('archive or unarchive'),
            level: z.enum(['organism', 'workspace', 'space', 'record']).describe('What to (un)archive'),
            ws: z.string().optional().describe('Workspace id (required for workspace/space/record)'),
            namespace: z.string().optional().describe('objectType namespace (required for level "space")'),
            key: z.string().optional().describe('Instance base memory key (required for level "record")'),
        },
        annotationsFor('aimeat_organism_archive'),
        async ({ organism_id, action, level, ws, namespace, key }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            const ownerName = getOwnerName();
            // Creator/admin only — archiving is a structural, destructive-adjacent op that hides
            // content from every AI-facing surface.
            //
            // An ATTACHED organism agent is deliberately NOT enough, and used to be: attaching one
            // needs only that its owner be a member (routes/organisms/membership.ts), so any plain
            // member's agent could archive the whole organism, a workspace or a single record over
            // MCP. The HTTP door maps an attached agent to role 'member' and then demands creator or
            // admin (routes/organisms/shared.ts memberRole), which refuses it. The role also comes
            // from an ACTIVE membership row there, so it is read the same way here.
            const membership = await storage.getMembership(organism_id, ownerName);
            const role = membership?.status === 'active' ? membership.role : null;
            const isAdmin = role === 'creator' || role === 'admin';
            if (!isAdmin) return { content: [{ type: 'text' as const, text: `Only the creator or an admin can ${action} organism content` }], isError: true };
            // Validate required fields per level (mirrors the REST validator).
            if ((level === 'workspace' || level === 'space' || level === 'record') && !ws) return { content: [{ type: 'text' as const, text: 'ws is required for workspace/space/record' }], isError: true };
            if (level === 'space' && !namespace) return { content: [{ type: 'text' as const, text: 'namespace is required for level "space"' }], isError: true };
            if (level === 'record') {
                if (!key) return { content: [{ type: 'text' as const, text: 'key is required for level "record"' }], isError: true };
                if (!key.startsWith(`organism.${organism_id}.w.${ws}.`)) return { content: [{ type: 'text' as const, text: 'key must be inside organism.{id}.w.{ws}.' }], isError: true };
            }
            const target = { level: level as ArchiveLevel, orgId: organism_id, ws, namespace, key };
            try {
                const result = action === 'archive' ? await archiveTarget(storage, target, agentGaii) : await unarchiveTarget(storage, target, agentGaii);
                emitChange('organisms');
                return { content: [{ type: 'text' as const, text: JSON.stringify({ action, level: result.level, [action === 'archive' ? 'archived' : 'restored']: result.count, root: result.root }, null, 2) }] };
            } catch (e) {
                return { content: [{ type: 'text' as const, text: `Could not ${action}: ${(e as Error).message}` }], isError: true };
            }
        },
    );

    // ── Tool: aimeat_workspace_comment ── (add a comment/thread reply to a record or document)
    mcp.tool(
        'aimeat_workspace_comment',
        descriptionFor('aimeat_workspace_comment'),
        {
            organism_id: z.string().describe('The organism ID'),
            ws: z.string().describe('Workspace id'),
            space: z.string().describe('The objectType (space) name the target lives in'),
            instance_id: z.string().describe('The record/document id being commented on'),
            body: z.string().describe('The comment text'),
            anchor: z.object({ section: z.string().optional(), quote: z.string().optional() }).optional().describe('Optional anchor to part of a document'),
            parent_id: z.string().optional().describe('Optional id of the comment this replies to'),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_workspace_comment'),
        async ({ organism_id, ws, space, instance_id, body, anchor, parent_id, ai_provenance, ai_provenance_id }) => {
            if (typeof body !== 'string' || !body.trim()) return { content: [{ type: 'text' as const, text: 'A non-empty body is required' }], isError: true };
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            const ownerName = getOwnerName();
            if (!(await canAccessWorkspaceComments(storage, config, organism, agentGaii, ownerName, agentGaii, ws))) {
                return { content: [{ type: 'text' as const, text: 'You cannot comment in this workspace' }], isError: true };
            }
            // TARGET-058. A comment is discussion a person reads and answers — the same act as a
            // board reply, in a members-only room. The body is stored truncated to 10 000 chars, so
            // the hash is taken over the SAME slice that is stored: a record about bytes nobody kept
            // would never match a detection query.
            const aiProvenanceId = await provenanceForWrite(storage, {
                principal: agentGaii,
                content: body.slice(0, 10_000),
                declaredId: ai_provenance_id,
                declared: toDeclaredProvenance(ai_provenance),
                pipeline: 'mcp.workspace_comment',
                surface: { visibility: 'private', humanAudience: true },
                labelPolicy: config.aiLabelPublic,
                nodeId: config.nodeId,
                baseUrl: config.baseUrl,
                enabled: config.aiProvenance,
            });
            const comment = await addComment(storage, organism_id, agentGaii, { ws, space, instanceId: instance_id, body, anchor, parentId: parent_id, aiProvenanceId });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ comment, ...(await writeProvenanceEcho(storage, config, aiProvenanceId)) }, null, 2) }] };
        },
    );

    // ── Tool: aimeat_workspace_comments ── (list a target's thread)
    mcp.tool(
        'aimeat_workspace_comments',
        descriptionFor('aimeat_workspace_comments'),
        {
            organism_id: z.string().describe('The organism ID'),
            ws: z.string().describe('Workspace id'),
            space: z.string().describe('The objectType (space) name'),
            instance_id: z.string().describe('The record/document id'),
        },
        annotationsFor('aimeat_workspace_comments'),
        async ({ organism_id, ws, space, instance_id }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            const ownerName = getOwnerName();
            if (!(await canAccessWorkspaceComments(storage, config, organism, agentGaii, ownerName, agentGaii, ws))) {
                return { content: [{ type: 'text' as const, text: 'You cannot read this workspace' }], isError: true };
            }
            const comments = await listComments(storage, organism_id, ws, space, instance_id);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ comments, total: comments.length }, null, 2) }] };
        },
    );

    // ── Tool 6: aimeat_organism_create ──
    // Mirrors POST /v1/organisms. Membership is keyed by the BARE owner name (the canonical
    // convention used by the route + the workspace tools' membership gate) — NOT the full GHII.
    mcp.tool(
        'aimeat_organism_create',
        descriptionFor('aimeat_organism_create'),
        {
            name: z.string().describe('Organism name (min 2 chars)'),
            description: z.string().optional(),
            type: z.string().optional().describe('community | team | club | cooperative | project'),
            join_policy: z.string().optional().describe('open | approval_required | invite_only'),
            visibility: z.string().optional().describe('public | listed | private'),
        },
        annotationsFor('aimeat_organism_create'),
        async ({ name, description, type, join_policy, visibility }) => {
            // Validation, the board, the record, the creator membership and the feed/timeline side
            // effects are the shared writer's (services/organism-lifecycle.ts, same call
            // POST /v1/organisms makes).
            const result = await createOrganismRecord({ storage, config }, getOwnerName(), {
                name, description, type, joinPolicy: join_policy, visibility,
            });
            if (!result.ok) return { content: [{ type: 'text' as const, text: result.message }], isError: true };
            const record = result.organism;
            emitResourceListChanged(agentGaii);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        created: true,
                        organism: { id: record.id, name: record.name, board_id: record.boardId, visibility: record.visibility, join_policy: record.joinPolicy },
                    }, null, 2),
                }],
            };
        },
    );

    const ownerOf = () => { const p = parseGAII(agentGaii); return p ? p.owner : agentGaii; };

    // ── Tool: aimeat_organism_update ──
    // Mirrors PUT /v1/organisms/:id. Creator/admin updates meta fields and/or the free-form README
    // (a markdown body stored as organism.{id}.meta.readme, shown at the top of the organism home).
    // The README is the primary agent-fill target — distinct from the short description and the
    // deterministic structure overview/mindmap.
    mcp.tool(
        'aimeat_organism_update',
        descriptionFor('aimeat_organism_update'),
        {
            organism_id: z.string().describe('The organism ID'),
            name: z.string().optional().describe('New organism name'),
            description: z.string().optional().describe('Short tagline shown under the name'),
            readme: z.string().optional().describe('Free-form markdown README (mermaid + aimeat-memory live-data blocks allowed); shown at the top of the organism home'),
            interests: z.array(z.string()).optional().describe('Interest tags'),
            join_policy: z.string().optional().describe('open | approval_required | invite_only'),
            visibility: z.string().optional().describe('public | listed | private'),
        },
        annotationsFor('aimeat_organism_update'),
        async ({ organism_id, name, description, readme, interests, join_policy, visibility }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            const ownerName = getOwnerName();
            if (!isOrganismOwner(organism, ownerName) && !organism.admins.includes(ownerName)) {
                return { content: [{ type: 'text' as const, text: 'Only the creator or an admin can update this organism' }], isError: true };
            }
            // Shared with PUT /v1/organisms/:id (services/organism-lifecycle.ts): the field
            // validation, the record update and the README key. An unrecognised join_policy or
            // visibility is refused here rather than dropped, so "updated" means it was.
            const result = await updateOrganismRecord({ storage, config }, organism, {
                name, description, readme, interests, joinPolicy: join_policy, visibility,
            });
            if (!result.ok) return { content: [{ type: 'text' as const, text: result.message }], isError: true };
            emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ updated: true, organism_id, name: result.organism.name, readme_set: result.readmeSet }, null, 2) }] };
        },
    );

    // ── Tool 7: aimeat_organism_export ──
    mcp.tool('aimeat_organism_export', descriptionFor('aimeat_organism_export'),
        { organism_id: z.string() },
        annotationsFor('aimeat_organism_export'),
        async ({ organism_id }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            const ownerName = ownerOf();
            const m = await storage.getMembership(organism_id, ownerName);
            // Any active member: the bundle holds only what the member reads live (gate matches the
            // read model — the REST route applies the same policy).
            if (!m || m.status !== 'active') return { content: [{ type: 'text' as const, text: 'Only an active member of the organism can export it.' }], isError: true };
            const { buffer, filename, workspaces } = await exportOrganism(storage, config, { orgId: organism_id, exporterGaii: `${ownerName}@${config.nodeId}`, exportedAt: new Date().toISOString() });
            if (buffer.length > 1_500_000) return { content: [{ type: 'text' as const, text: `Organism too large for inline export (${buffer.length} bytes) — download it from the UI/REST instead.` }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ filename, size_bytes: buffer.length, workspaces, zip_base64: buffer.toString('base64') }, null, 2) }] };
        });

    // ── Tool 8: aimeat_organism_import ──
    mcp.tool('aimeat_organism_import', descriptionFor('aimeat_organism_import'),
        { zip_base64: z.string() },
        annotationsFor('aimeat_organism_import'),
        async ({ zip_base64 }) => {
            const ownerName = ownerOf();
            const buf = Buffer.from(zip_base64, 'base64');
            if (!buf.length) return { content: [{ type: 'text' as const, text: 'zip_base64 is empty or invalid.' }], isError: true };
            try {
                const result = await importOrganism(storage, config, { importerGaii: `${ownerName}@${config.nodeId}`, importerOwner: ownerName, zip: buf });
                emitResourceListChanged(agentGaii);
                return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
            } catch (e) {
                if (e instanceof ZipSecurityError) {
                    const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: `${ownerName}@${config.nodeId}`, actorName: ownerName, detail: e.message, source: 'organism_import_mcp', blob: buf });
                    return { content: [{ type: 'text' as const, text: `Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).` }], isError: true };
                }
                return { content: [{ type: 'text' as const, text: (e as Error).message || 'Import failed' }], isError: true };
            }
        });
}
