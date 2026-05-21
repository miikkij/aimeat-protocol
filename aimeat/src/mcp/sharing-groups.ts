/**
 * @file sharing-groups.ts
 * @description MCP tools for sharing group management (list, get, create, add/remove members)
 * @structure
 *   - registerSharingGroupTools() -- registers all sharing group tools on an McpServer instance
 * @usage
 *   import { registerSharingGroupTools } from './sharing-groups.js';
 *   registerSharingGroupTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, SharingGroupMember } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';

export function registerSharingGroupTools(
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

    // ── Tool 1: aimeat_group_list ──
    mcp.tool(
        'aimeat_group_list',
        'List sharing groups you are a member of or own',
        {},
        async () => {
            const ownerGhii = getOwnerGhii();

            // Get groups the owner owns
            const owned = await storage.listSharingGroups(ownerGhii);
            // Get groups where the owner is a member
            const memberOf = await storage.listSharingGroupsByMember(ownerGhii);

            // Also check by agent GAII
            const agentMemberOf = await storage.listSharingGroupsByMember(agentGaii);

            // Merge and deduplicate by id
            const seen = new Set<string>();
            const all = [...owned, ...memberOf, ...agentMemberOf].filter(g => {
                if (seen.has(g.id)) return false;
                seen.add(g.id);
                return true;
            });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(all.map(g => ({
                        id: g.id,
                        name: g.name,
                        description: g.description,
                        owner_gaii: g.ownerGaii,
                        member_count: g.members.length,
                        default_permissions: g.defaultPermissions,
                        created_at: g.createdAt,
                        updated_at: g.updatedAt,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_group_get ──
    mcp.tool(
        'aimeat_group_get',
        'Get details of a specific sharing group including its members',
        {
            group_id: z.string().describe('The sharing group ID'),
        },
        async ({ group_id }) => {
            const group = await storage.getSharingGroup(group_id);
            if (!group) return { content: [{ type: 'text' as const, text: 'Sharing group not found' }], isError: true };

            const ownerGhii = getOwnerGhii();

            // Must be owner or member
            const isOwner = group.ownerGaii === ownerGhii;
            const isMember = group.members.some(m => m.identifier === ownerGhii || m.identifier === agentGaii);

            if (!isOwner && !isMember) {
                return { content: [{ type: 'text' as const, text: 'Access denied' }], isError: true };
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: group.id,
                        name: group.name,
                        description: group.description,
                        owner_gaii: group.ownerGaii,
                        members: group.members.map(m => ({
                            identifier: m.identifier,
                            identifier_type: m.identifierType,
                            permissions: m.permissions,
                            added_at: m.addedAt,
                            added_by: m.addedBy,
                        })),
                        default_permissions: group.defaultPermissions,
                        created_at: group.createdAt,
                        updated_at: group.updatedAt,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_group_create ──
    mcp.tool(
        'aimeat_group_create',
        'Create a new sharing group. You become the owner.',
        {
            name: z.string().describe('Group name'),
            description: z.string().optional().describe('Group description'),
            members: z.array(z.object({
                identifier: z.string().describe('GAII or GHII of the member'),
                identifier_type: z.enum(['gaii', 'ghii']).describe('Type of identifier'),
                permissions: z.object({
                    read: z.boolean(),
                    write: z.boolean(),
                }).optional().describe('Member permissions (defaults to read:true, write:false)'),
            })).optional().describe('Initial members to add'),
        },
        async ({ name, description, members }) => {
            const ownerGhii = getOwnerGhii();

            // Max 50 groups per owner
            const existing = await storage.listSharingGroups(ownerGhii);
            if (existing.length >= 50) {
                return { content: [{ type: 'text' as const, text: 'Maximum 50 sharing groups per owner' }], isError: true };
            }

            const now = new Date().toISOString();
            const id = uuidv4();

            const defaultPermissions = { read: true, write: false };
            const storageMembers: SharingGroupMember[] = (members ?? []).map(m => ({
                identifier: m.identifier,
                identifierType: m.identifier_type,
                permissions: m.permissions ?? defaultPermissions,
                addedAt: now,
                addedBy: ownerGhii,
            }));

            const record = await storage.createSharingGroup({
                id,
                name: name.trim(),
                description: description?.trim(),
                ownerGaii: ownerGhii,
                members: storageMembers,
                defaultPermissions,
                createdAt: now,
                updatedAt: now,
            });

            emitResourceListChanged(agentGaii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        created: true,
                        group: {
                            id: record.id,
                            name: record.name,
                            description: record.description,
                            owner_gaii: record.ownerGaii,
                            member_count: record.members.length,
                            default_permissions: record.defaultPermissions,
                            created_at: record.createdAt,
                        },
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 4: aimeat_group_add_member ──
    mcp.tool(
        'aimeat_group_add_member',
        'Add a member to a sharing group. Only the group owner can add members.',
        {
            group_id: z.string().describe('The sharing group ID'),
            identifier: z.string().describe('GAII or GHII of the member to add'),
            identifier_type: z.enum(['gaii', 'ghii']).describe('Type of identifier'),
            permissions: z.object({
                read: z.boolean(),
                write: z.boolean(),
            }).optional().describe('Member permissions (defaults to group default)'),
        },
        async ({ group_id, identifier, identifier_type, permissions }) => {
            const ownerGhii = getOwnerGhii();

            const group = await storage.getSharingGroup(group_id);
            if (!group) return { content: [{ type: 'text' as const, text: 'Sharing group not found' }], isError: true };

            if (group.ownerGaii !== ownerGhii) {
                return { content: [{ type: 'text' as const, text: 'Only the group owner can add members' }], isError: true };
            }

            if (group.members.length >= 100) {
                return { content: [{ type: 'text' as const, text: 'Maximum 100 members per group' }], isError: true };
            }

            // Check for duplicate
            if (group.members.some(m => m.identifier === identifier)) {
                return { content: [{ type: 'text' as const, text: 'Member already exists in this group' }], isError: true };
            }

            const now = new Date().toISOString();
            const newMember: SharingGroupMember = {
                identifier,
                identifierType: identifier_type,
                permissions: permissions ?? group.defaultPermissions,
                addedAt: now,
                addedBy: ownerGhii,
            };

            const updatedMembers = [...group.members, newMember];
            await storage.updateSharingGroup(group_id, {
                members: updatedMembers,
                updatedAt: now,
            });

            emitResourceUpdated(agentGaii, `aimeat://groups/${encodeURIComponent(group_id)}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        added: true,
                        group_id,
                        member: {
                            identifier: newMember.identifier,
                            identifier_type: newMember.identifierType,
                            permissions: newMember.permissions,
                        },
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 5: aimeat_group_remove_member ──
    mcp.tool(
        'aimeat_group_remove_member',
        'Remove a member from a sharing group. Only the group owner can remove members.',
        {
            group_id: z.string().describe('The sharing group ID'),
            identifier: z.string().describe('GAII or GHII of the member to remove'),
        },
        async ({ group_id, identifier }) => {
            const ownerGhii = getOwnerGhii();

            const group = await storage.getSharingGroup(group_id);
            if (!group) return { content: [{ type: 'text' as const, text: 'Sharing group not found' }], isError: true };

            if (group.ownerGaii !== ownerGhii) {
                return { content: [{ type: 'text' as const, text: 'Only the group owner can remove members' }], isError: true };
            }

            const memberIdx = group.members.findIndex(m => m.identifier === identifier);
            if (memberIdx === -1) {
                return { content: [{ type: 'text' as const, text: 'Member not found in this group' }], isError: true };
            }

            const updatedMembers = group.members.filter(m => m.identifier !== identifier);
            const now = new Date().toISOString();
            await storage.updateSharingGroup(group_id, {
                members: updatedMembers,
                updatedAt: now,
            });

            emitResourceUpdated(agentGaii, `aimeat://groups/${encodeURIComponent(group_id)}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        removed: true,
                        group_id,
                        identifier,
                    }, null, 2),
                }],
            };
        },
    );
}
