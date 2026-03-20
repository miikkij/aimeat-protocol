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
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';

export function registerOrganismsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    /** Resolve the owner's GHII (owner@nodeId) from the agent's GAII. */
    function getOwnerGhii(): string {
        const parsed = parseGAII(agentGaii);
        if (parsed) return `${parsed.owner}@${config.nodeId}`;
        // Fallback: treat agentGaii as an owner name
        return `${agentGaii}@${config.nodeId}`;
    }

    /** Check if an organism is visible to the current agent. */
    async function canSeeOrganism(organism: { visibility: string; members: string[] }): Promise<boolean> {
        if (organism.visibility === 'public' || organism.visibility === 'listed') return true;
        const ownerGhii = getOwnerGhii();
        return organism.members.includes(ownerGhii);
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
        'List organisms visible to the agent (public and organisms the owner is a member of)',
        {},
        async () => {
            const ownerGhii = getOwnerGhii();
            // Get public organisms
            const publicOrgs = await storage.listOrganisms({ visibility: 'public' });
            // Get organisms the owner is a member of (may include private ones)
            const memberOrgs = await storage.listOrganisms({ member: ownerGhii });
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
        'Get details of a specific organism including its members',
        {
            organism_id: z.string().describe('The organism ID'),
        },
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
        'Join an organism. Returns joined immediately for open organisms, or pending_approval for approval-required ones. Invite-only organisms cannot be joined this way.',
        {
            organism_id: z.string().describe('The organism ID to join'),
            message: z.string().optional().describe('Optional message for join requests (used when approval is required)'),
        },
        async ({ organism_id, message }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            if (organism.visibility === 'private' && !(await canSeeOrganism(organism))) {
                return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            }

            const ownerGhii = getOwnerGhii();

            // Check if already a member
            const existing = await storage.getMembership(organism_id, ownerGhii);
            if (existing && existing.status === 'active') {
                return { content: [{ type: 'text' as const, text: 'Already a member of this organism' }], isError: true };
            }
            if (existing && existing.status === 'pending') {
                return { content: [{ type: 'text' as const, text: 'Already have a pending join request' }], isError: true };
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
                    ghii: ownerGhii,
                    role: 'member',
                    status: 'active',
                    joinedAt: now,
                });
                await storage.updateOrganism(organism_id, {
                    members: [...organism.members, ownerGhii],
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
                    ghii: ownerGhii,
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
        'Leave an organism. The creator cannot leave — they must delete the organism instead.',
        {
            organism_id: z.string().describe('The organism ID to leave'),
        },
        async ({ organism_id }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };

            const ownerGhii = getOwnerGhii();

            if (organism.creatorGhii === ownerGhii) {
                return { content: [{ type: 'text' as const, text: 'Creator cannot leave. Delete the organism instead.' }], isError: true };
            }

            const membership = await storage.getMembership(organism_id, ownerGhii);
            if (!membership || membership.status !== 'active') {
                return { content: [{ type: 'text' as const, text: 'Not a member of this organism' }], isError: true };
            }

            await storage.deleteMembership(membership.id);

            const updates: Record<string, unknown> = {
                members: organism.members.filter(m => m !== ownerGhii),
                updatedAt: new Date().toISOString(),
            };
            if (organism.admins.includes(ownerGhii)) {
                updates.admins = organism.admins.filter(a => a !== ownerGhii);
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
        'List members of an organism',
        {
            organism_id: z.string().describe('The organism ID'),
            role: z.string().optional().describe('Filter by role: creator, admin, member'),
            status: z.string().optional().describe('Filter by status: active, pending, banned (default: active)'),
        },
        async ({ organism_id, role, status }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: 'Organism not found' }], isError: true };
            if (!(await canSeeOrganism(organism))) return { content: [{ type: 'text' as const, text: 'Access denied' }], isError: true };

            const members = await storage.listMembers(organism_id, {
                role,
                status: status || 'active',
            });

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
                    })), null, 2),
                }],
            };
        },
    );
}
