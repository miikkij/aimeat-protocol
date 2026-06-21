/**
 * @file organisms.ts
 * @description MCP organisms tools and resource registrations. Provides 5 tools for organism
 *   management (list, get, join, leave, members) and 1 resource template for reading organism
 *   details + members via the MCP resource protocol.
 * @structure
 *   - registerOrganismsTools() — registers all organism tools and resources on an McpServer instance
 * @usage
 *   import { registerOrganismsTools } from './organisms.js';
 *   registerOrganismsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
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
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { exportOrganism } from '../services/organism-export.js';
import { importOrganism } from '../services/organism-import.js';
import { notify } from '../services/notify.js';
import { searchOrganismContent } from '../services/organism-search.js';
import { canAccessWorkspaceComments, addComment, listComments } from '../services/organism-comments.js';
import { setOrganismReadme } from '../services/organism-readme.js';
import { emitChange } from '../services/event-bus.js';
import { ZipSecurityError } from '../services/safe-zip.js';
import { recordSecurityIncident } from '../services/security-incident.js';

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
                const organisms = await storage.listOrganisms({ visibility: 'public' });
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
            const members = await storage.listMembers(id, { status: 'active' });
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
                        creator_ghii: organism.creatorGhii,
                        admins: organism.admins,
                        interests: organism.interests,
                        location: organism.location,
                        member_count: members.length,
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
            // Get public organisms
            const publicOrgs = await storage.listOrganisms({ visibility: 'public' });
            // Get organisms the owner is a member of (may include private ones)
            const memberOrgs = await storage.listOrganisms({ member: ownerName });
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

            const members = await storage.listMembers(organism_id, { status: 'active' });

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
                        creator_ghii: organism.creatorGhii,
                        admins: organism.admins,
                        interests: organism.interests,
                        location: organism.location,
                        member_count: members.length,
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
            if (organism.visibility === 'private' && !(await canSeeOrganism(organism))) {
                return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            }

            const ownerName = getOwnerName();

            // Check if already a member
            const existing = await storage.getMembership(organism_id, ownerName);
            if (existing && existing.status === 'banned') {
                return { content: [{ type: 'text' as const, text: 'You have been blocked from this organism' }], isError: true };
            }
            if (existing && existing.status === 'active') {
                return { content: [{ type: 'text' as const, text: 'Already a member of this organism' }], isError: true };
            }
            if (existing && existing.status === 'pending') {
                return { content: [{ type: 'text' as const, text: 'Already have a pending join request' }], isError: true };
            }
            if (existing && existing.status === 'invited') {
                return { content: [{ type: 'text' as const, text: 'You have a pending invitation — accept it with aimeat_organism_invitation_respond instead' }], isError: true };
            }

            // Check capacity
            const members = await storage.listMembers(organism_id, { status: 'active' });
            if (members.length >= organism.maxMembers) {
                return { content: [{ type: 'text' as const, text: 'Organism has reached maximum members' }], isError: true };
            }

            if (organism.joinPolicy === 'invite_only') {
                return { content: [{ type: 'text' as const, text: 'This organism requires an invitation to join' }], isError: true };
            }

            const now = new Date().toISOString();

            if (organism.joinPolicy === 'open') {
                await storage.createMembership({
                    id: uuidv4(),
                    organismId: organism_id,
                    ghii: ownerName,
                    role: 'member',
                    status: 'active',
                    joinedAt: now,
                });
                await storage.updateOrganism(organism_id, {
                    members: [...organism.members, ownerName],
                    updatedAt: now,
                });

                emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ status: 'joined', organism_id }, null, 2),
                    }],
                };
            } else {
                // approval_required
                await storage.createJoinRequest({
                    id: uuidv4(),
                    organismId: organism_id,
                    ghii: ownerName,
                    message: message || undefined,
                    status: 'pending',
                    createdAt: now,
                });

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ status: 'pending_approval', organism_id }, null, 2),
                    }],
                };
            }
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

            const ownerName = getOwnerName();

            if (organism.creatorGhii === ownerName) {
                return { content: [{ type: 'text' as const, text: 'Creator cannot leave. Delete the organism instead.' }], isError: true };
            }

            const membership = await storage.getMembership(organism_id, ownerName);
            if (!membership || membership.status !== 'active') {
                return { content: [{ type: 'text' as const, text: 'Not a member of this organism' }], isError: true };
            }

            await storage.deleteMembership(membership.id);

            const updates: Record<string, unknown> = {
                members: organism.members.filter(m => m !== ownerName),
                updatedAt: new Date().toISOString(),
            };
            if (organism.admins.includes(ownerName)) {
                updates.admins = organism.admins.filter(a => a !== ownerName);
            }
            await storage.updateOrganism(organism_id, updates);

            emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ left: true, organism_id }, null, 2),
                }],
            };
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

            const members = await storage.listMembers(organism_id, {
                role,
                status: status || 'active',
            });

            // Same-owner agents inherit a member's access implicitly — list them per member so
            // "who can touch this organism" is enumerable (matches the REST members route). Only
            // an ACTIVE member's agent sees the agent rosters; public visibility alone does not.
            const callerMembership = await storage.getMembership(organism_id, getOwnerName());
            const canSeeAgents = callerMembership?.status === 'active';
            const agentsByOwner = new Map<string, { gaii: string; name: string }[]>();
            if (canSeeAgents) {
                for (const m of members) {
                    const ownerName = (m.ghii.includes('#') ? m.ghii.split('#')[1] : m.ghii).split('@')[0];
                    if (!agentsByOwner.has(ownerName)) {
                        agentsByOwner.set(ownerName, (await storage.getAgentsByOwner(ownerName)).map(a => ({ gaii: a.gaii, name: a.name })));
                    }
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

    // ── Tool: aimeat_organism_invite ──
    // Mirrors POST /v1/organisms/:id/invitations. Creator/admin invites an owner by bare name;
    // creates a membership row with status 'invited' + invitedBy and notifies the invitee.
    mcp.tool(
        'aimeat_organism_invite',
        descriptionFor('aimeat_organism_invite'),
        {
            organism_id: z.string().describe('The organism ID'),
            invitee: z.string().describe('Bare owner name to invite'),
        },
        annotationsFor('aimeat_organism_invite'),
        async ({ organism_id, invitee }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            const ownerName = getOwnerName();
            if (organism.creatorGhii !== ownerName && !organism.admins.includes(ownerName)) {
                return { content: [{ type: 'text' as const, text: 'Only the creator or an admin can invite members' }], isError: true };
            }
            const existing = await storage.getMembership(organism_id, invitee);
            if (existing && existing.status === 'active') return { content: [{ type: 'text' as const, text: 'That owner is already a member' }], isError: true };
            if (existing && existing.status === 'invited') return { content: [{ type: 'text' as const, text: 'That owner already has a pending invitation' }], isError: true };
            if (existing && existing.status === 'banned') return { content: [{ type: 'text' as const, text: 'That owner is blocked — lift the block before inviting' }], isError: true };

            const now = new Date().toISOString();
            await storage.createMembership({ id: uuidv4(), organismId: organism_id, ghii: invitee, role: 'member', status: 'invited', invitedBy: ownerName, joinedAt: now });
            await notify(storage, `${invitee}@${config.nodeId}`, {
                type: 'organism_invitation',
                title: `${ownerName} invited you to join "${organism.name}"`,
                link: '/v1/profile#organisms',
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'invited', organism_id, invitee }, null, 2) }] };
        },
    );

    // ── Tool: aimeat_organism_invitations ── (your own pending invitations across organisms)
    mcp.tool(
        'aimeat_organism_invitations',
        descriptionFor('aimeat_organism_invitations'),
        {},
        annotationsFor('aimeat_organism_invitations'),
        async () => {
            const ownerName = getOwnerName();
            const memberships = (await storage.listMembershipsByGhii(ownerName)).filter(m => m.status === 'invited');
            const out = [];
            for (const m of memberships) {
                const org = await storage.getOrganism(m.organismId);
                if (org) out.push({ organism_id: org.id, name: org.name, type: org.type, invited_by: m.invitedBy });
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
        },
    );

    // ── Tool: aimeat_organism_invitation_respond ── (accept | decline your invitation)
    mcp.tool(
        'aimeat_organism_invitation_respond',
        descriptionFor('aimeat_organism_invitation_respond'),
        {
            organism_id: z.string().describe('The organism ID you were invited to'),
            decision: z.enum(['accept', 'decline']).describe('accept or decline'),
        },
        annotationsFor('aimeat_organism_invitation_respond'),
        async ({ organism_id, decision }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            const ownerName = getOwnerName();
            const membership = await storage.getMembership(organism_id, ownerName);
            if (!membership || membership.status !== 'invited') {
                return { content: [{ type: 'text' as const, text: 'You have no pending invitation to this organism' }], isError: true };
            }
            const now = new Date().toISOString();
            if (decision === 'decline') {
                await storage.deleteMembership(membership.id);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'declined', organism_id }, null, 2) }] };
            }
            await storage.updateMembership(membership.id, { status: 'active', joinedAt: now });
            await storage.updateOrganism(organism_id, { members: [...new Set([...organism.members, ownerName])], updatedAt: now });
            if (membership.invitedBy) {
                await notify(storage, `${membership.invitedBy}@${config.nodeId}`, {
                    type: 'organism_invitation_accepted',
                    title: `${ownerName} accepted your invitation to "${organism.name}"`,
                    link: '/v1/profile#organisms',
                });
            }
            emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'joined', organism_id }, null, 2) }] };
        },
    );

    // ── Tool: aimeat_organism_search ── (content search across readable workspaces)
    mcp.tool(
        'aimeat_organism_search',
        descriptionFor('aimeat_organism_search'),
        {
            organism_id: z.string().describe('The organism ID'),
            q: z.string().describe('Search text (min 2 characters)'),
            ws: z.string().optional().describe('Optional: limit to a single workspace id'),
        },
        annotationsFor('aimeat_organism_search'),
        async ({ organism_id, q, ws }) => {
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
            const { results, truncated } = await searchOrganismContent(storage, config, organism, agentGaii, query, ws);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ query, results, total: results.length, truncated }, null, 2) }] };
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
        },
        annotationsFor('aimeat_workspace_comment'),
        async ({ organism_id, ws, space, instance_id, body, anchor, parent_id }) => {
            if (typeof body !== 'string' || !body.trim()) return { content: [{ type: 'text' as const, text: 'A non-empty body is required' }], isError: true };
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            const ownerName = getOwnerName();
            if (!(await canAccessWorkspaceComments(storage, config, organism, agentGaii, ownerName, agentGaii, ws))) {
                return { content: [{ type: 'text' as const, text: 'You cannot comment in this workspace' }], isError: true };
            }
            const comment = await addComment(storage, organism_id, agentGaii, { ws, space, instanceId: instance_id, body, anchor, parentId: parent_id });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ comment }, null, 2) }] };
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
            if (!name || name.trim().length < 2) {
                return { content: [{ type: 'text' as const, text: 'Name is required (min 2 characters)' }], isError: true };
            }
            const parsed = parseGAII(agentGaii);
            const ownerName = parsed ? parsed.owner : agentGaii;          // bare — membership/members/creator
            const ownerGhiiFull = `${ownerName}@${config.nodeId}`;        // full GHII — board owner
            const orgType = ['community', 'team', 'club', 'cooperative', 'project'].includes(type ?? '') ? (type as string) : 'community';
            const policy = ['open', 'approval_required', 'invite_only'].includes(join_policy ?? '') ? (join_policy as string) : 'open';
            const vis = ['public', 'listed', 'private'].includes(visibility ?? '') ? (visibility as string) : 'public';
            const id = uuidv4();
            const now = new Date().toISOString();
            const boardId = `org-${id}`;
            await storage.createBoard({
                id: boardId, name: `${name.trim()} — Discussion`, description: `Discussion board for ${name.trim()}`,
                visibility: vis === 'public' ? 'public' : 'shared', ownerGaii: ownerGhiiFull, allowedGaiis: [], createdAt: now,
            });
            const record = await storage.createOrganism({
                id, name: name.trim(), description: description || '', type: orgType as 'community' | 'team' | 'club' | 'cooperative' | 'project', location: {}, interests: [],
                creatorGhii: ownerName, admins: [ownerName], members: [ownerName], agentGaiis: [],
                boardId, joinPolicy: policy as 'open' | 'approval_required' | 'invite_only', maxMembers: 500, visibility: vis as 'public' | 'listed' | 'private',
                moderationConfig: { flagsEnabled: true, autoHideThreshold: 3, appealsEnabled: true },
                memoryNamespace: `organism.${id}`, createdAt: now, updatedAt: now,
            });
            await storage.createMembership({ id: uuidv4(), organismId: id, ghii: ownerName, role: 'creator', status: 'active', joinedAt: now });
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
            readme: z.string().optional().describe('Free-form markdown README (mermaid allowed); shown at the top of the organism home'),
            interests: z.array(z.string()).optional().describe('Interest tags'),
            join_policy: z.string().optional().describe('open | approval_required | invite_only'),
            visibility: z.string().optional().describe('public | listed | private'),
        },
        annotationsFor('aimeat_organism_update'),
        async ({ organism_id, name, description, readme, interests, join_policy, visibility }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            const ownerName = getOwnerName();
            if (organism.creatorGhii !== ownerName && !organism.admins.includes(ownerName)) {
                return { content: [{ type: 'text' as const, text: 'Only the creator or an admin can update this organism' }], isError: true };
            }
            const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
            if (name !== undefined) updates.name = name;
            if (description !== undefined) updates.description = description;
            if (interests !== undefined) updates.interests = interests;
            if (join_policy !== undefined && ['open', 'approval_required', 'invite_only'].includes(join_policy)) updates.joinPolicy = join_policy;
            if (visibility !== undefined && ['public', 'listed', 'private'].includes(visibility)) updates.visibility = visibility;
            if (typeof readme === 'string') await setOrganismReadme(storage, config, organism_id, readme, organism.creatorGhii);
            const updated = await storage.updateOrganism(organism_id, updates);
            emitChange('organisms');
            emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ updated: true, organism_id, name: updated?.name ?? organism.name, readme_set: typeof readme === 'string' }, null, 2) }] };
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
            const role = m && m.status === 'active' ? m.role : null;
            if (role !== 'creator' && role !== 'admin') return { content: [{ type: 'text' as const, text: 'Only the organism creator or an admin can export.' }], isError: true };
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
