/**
 * @file sharing-groups.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for sharing groups: the audience (list, get, create, add/remove members)
 *   and what it reaches (share create/list/revoke).
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
 *   v1.4.0 -- 2026-08-11 -- aimeat_share_create / _list / _revoke: the agent surface for key-space
 *     shares, calling the same services/group-shares.ts the REST routes call. Without them an agent
 *     could assemble an audience over MCP and then have nothing to give it.
 *   v1.3.0 -- 2026-08-11 -- The three writes go through services/sharing-group-members.ts instead of
 *     storage: validation, the member's address, the record build and the change event are the same
 *     ones POST /v1/groups applies. These tools render the answer and nothing else.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { GroupShareRecord, Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { emitChange } from '../services/event-bus.js';
import {
    createSharingGroup,
    addSharingGroupMember,
    removeSharingGroupMember,
} from '../services/sharing-group-members.js';
import {
    createShare,
    revokeShare,
    listOutgoingShares,
    listIncomingShares,
} from '../services/group-shares.js';

export function registerSharingGroupTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
    sessionScopes: string[] = [],
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

    // ── Key-space shares ──
    // The group says WHO; a share says WHAT. Without these an agent could assemble an audience over
    // MCP and then have nothing to give it, which is the shape the whole feature was stuck in.

    const shareJson = (s: GroupShareRecord) => ({
        id: s.id,
        group_id: s.groupId,
        owner_gaii: s.ownerGaii,
        key_pattern: s.keyPattern,
        note: s.note ?? null,
        expires_at: s.expiresAt ?? null,
        created_at: s.createdAt,
    });
    const caller = () => ({
        ownerGaii: getOwnerGhii(),
        principal: agentGaii,
        scopes: sessionScopes,
        roles: ['agent'],
    });

    // ── Tool 6: aimeat_share_create ──
    mcp.tool(
        'aimeat_share_create',
        descriptionFor('aimeat_share_create'),
        {
            group_id: z.string().describe('The sharing group whose members should be able to read'),
            key_pattern: z.string().describe('A key or a pattern, e.g. "deliveries.abc.**". `*` is one segment, `**` is the whole subtree. Keys written later are covered automatically.'),
            note: z.string().optional().describe('A reminder for the owner\'s own list. The reader never sees it.'),
            expires_at: z.string().optional().describe('ISO timestamp when the share stops granting. Omit for "until revoked".'),
        },
        annotationsFor('aimeat_share_create'),
        async ({ group_id, key_pattern, note, expires_at }) => {
            const created = await createShare(
                { storage, newId: () => randomUUID(), now: () => new Date().toISOString() },
                caller(),
                { groupId: group_id, keyPattern: key_pattern, note, expiresAt: expires_at ?? null },
            );
            if (!created.ok) return { content: [{ type: 'text' as const, text: created.message }], isError: true };
            emitResourceUpdated(agentGaii, `aimeat://groups/${encodeURIComponent(group_id)}`);
            emitChange('groups');
            return { content: [{ type: 'text' as const, text: JSON.stringify({ share: shareJson(created.value) }, null, 2) }] };
        },
    );

    // ── Tool 7: aimeat_share_list ──
    mcp.tool(
        'aimeat_share_list',
        descriptionFor('aimeat_share_list'),
        {
            direction: z.enum(['outgoing', 'incoming']).default('outgoing')
                .describe('outgoing = what your owner shares with others; incoming = what others have shared with your owner (and with you)'),
        },
        annotationsFor('aimeat_share_list'),
        async ({ direction }) => {
            const shares = direction === 'incoming'
                ? await listIncomingShares(storage, agentGaii)
                : await listOutgoingShares(storage, getOwnerGhii());
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ direction, shares: shares.map(shareJson), total: shares.length }, null, 2),
                }],
            };
        },
    );

    // ── Tool 8: aimeat_share_revoke ──
    mcp.tool(
        'aimeat_share_revoke',
        descriptionFor('aimeat_share_revoke'),
        { share_id: z.string().describe('The share to withdraw. Reads stop at once; copies already taken are not recalled.') },
        annotationsFor('aimeat_share_revoke'),
        async ({ share_id }) => {
            const revoked = await revokeShare({ storage }, caller(), share_id);
            if (!revoked.ok) return { content: [{ type: 'text' as const, text: revoked.message }], isError: true };
            emitResourceUpdated(agentGaii, `aimeat://groups/${encodeURIComponent(revoked.value.groupId)}`);
            emitChange('groups');
            return { content: [{ type: 'text' as const, text: JSON.stringify({ revoked: true, share: shareJson(revoked.value) }, null, 2) }] };
        },
    );
}
