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
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 -- 2026-08-11 -- The three writes go through services/sharing-group-members.ts instead of
 *     storage: validation, the member's address, the record build and the change event are the same
 *     ones POST /v1/groups applies. These tools render the answer and nothing else.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import {
    createSharingGroup,
    addSharingGroupMember,
    removeSharingGroupMember,
} from '../services/sharing-group-members.js';

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
        descriptionFor('aimeat_group_list'),
        {},
        annotationsFor('aimeat_group_list'),
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
        descriptionFor('aimeat_group_get'),
        {
            group_id: z.string().describe('The sharing group ID'),
        },
        annotationsFor('aimeat_group_get'),
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
        descriptionFor('aimeat_group_create'),
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
        annotationsFor('aimeat_group_create'),
        async ({ name, description, members }) => {
            const ownerGhii = getOwnerGhii();

            // The ceiling, the shape limits, the member's stored address and the record build are
            // services/sharing-group-members.ts, because POST /v1/groups decides them too. The
            // service also emits the `groups` change event to the owner's open browser; the
            // notification below is the MCP session's own.
            const created = await createSharingGroup({ storage, config }, ownerGhii, { name, description, members });
            if (!created.ok) return { content: [{ type: 'text' as const, text: created.message }], isError: true };
            const record = created.group;

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
        descriptionFor('aimeat_group_add_member'),
        {
            group_id: z.string().describe('The sharing group ID'),
            identifier: z.string().describe('GAII or GHII of the member to add'),
            identifier_type: z.enum(['gaii', 'ghii']).describe('Type of identifier'),
            permissions: z.object({
                read: z.boolean(),
                write: z.boolean(),
            }).optional().describe('Member permissions (defaults to group default)'),
        },
        annotationsFor('aimeat_group_add_member'),
        async ({ group_id, identifier, identifier_type, permissions }) => {
            const ownerGhii = getOwnerGhii();

            // Ownership, the ceiling, the duplicate test, the member's stored address and the write
            // are services/sharing-group-members.ts. The HTTP door decides them too, and a sharing
            // group IS the boundary of who reads the owner's memory.
            const added = await addSharingGroupMember({ storage, config }, ownerGhii, group_id, {
                identifier,
                identifier_type,
                permissions,
            });
            if (!added.ok) return { content: [{ type: 'text' as const, text: added.message }], isError: true };
            const newMember = added.member;

            // The members view must not go stale while an agent changes it. The service has already
            // told the owner's browser; this tells the MCP session holding the resource.
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
        descriptionFor('aimeat_group_remove_member'),
        {
            group_id: z.string().describe('The sharing group ID'),
            identifier: z.string().describe('GAII or GHII of the member to remove'),
        },
        annotationsFor('aimeat_group_remove_member'),
        async ({ group_id, identifier }) => {
            const ownerGhii = getOwnerGhii();

            const removed = await removeSharingGroupMember({ storage, config }, ownerGhii, group_id, identifier);
            if (!removed.ok) return { content: [{ type: 'text' as const, text: removed.message }], isError: true };

            // The members view must not go stale while an agent changes it. The service has already
            // told the owner's browser; this tells the MCP session holding the resource.
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
