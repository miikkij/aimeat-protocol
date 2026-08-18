/**
 * @file organisms-name-invites.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for NAME invitations + direct member adds — already-registered local
 *   owners joining an organism. Mirrors the REST membership routes via the shared
 *   services/invitations.ts core (invite-time role + workspace grants, pending-invite edit/cancel,
 *   direct add without the accept round-trip). Extracted from mcp/organisms.ts (max-file-lines).
 * @structure registerOrganismNameInviteTools() — registers aimeat_organism_invite,
 *   aimeat_organism_member_add, aimeat_organism_invitation_update, aimeat_organism_invitation_cancel,
 *   aimeat_organism_invitations, aimeat_organism_invitation_respond.
 * @usage registerOrganismNameInviteTools(mcp, storage, config, getOwnerName, agentGaii, emitResourceUpdated);
 * @version-history
 *   v1.1.0 — 2026-08-11 — invitation_respond's decline path calls declineNameInvitation() instead of
 *     deleting the membership row itself (August 2026 MCP audit step 8), so the delete and the
 *     `organisms` emit stay together with the REST decline route.
 *   v1.0.0 — 2026-07-16 — Extracted from mcp/organisms.ts; tools now ride the shared name-invite core.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismRecord } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { isOrganismOwner, addOrganismOwner, removeOrganismOwner } from '../services/organism-ownership.js';
import {
    InvitationError, createNameInvitation, updateNameInvitation, cancelNameInvitation,
    acceptNameInvitation, declineNameInvitation, addOrganismMember,
} from '../services/invitations.js';

export function registerOrganismNameInviteTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getOwnerName: () => string,
    agentGaii: string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
): void {
    /** Creator/admin gate shared by the invite/add/edit tools. Returns the organism or an error string. */
    type InviteGate = { err: string; organism?: never; ownerName?: never } | { err?: never; organism: OrganismRecord; ownerName: string };
    const inviteAdminGate = async (organism_id: string): Promise<InviteGate> => {
        const organism = await storage.getOrganism(organism_id);
        if (!organism) return { err: 'Organism not found' };
        const ownerName = getOwnerName();
        if (!isOrganismOwner(organism, ownerName) && !organism.admins.includes(ownerName)) {
            return { err: 'Only the creator or an admin can manage members and invitations' };
        }
        return { organism, ownerName };
    };
    const invitationErrText = (e: unknown): string =>
        e instanceof InvitationError ? e.message : ((e as Error)?.message || 'Invitation operation failed');

    const wsGrantShape = z.array(z.object({
        ws: z.string().describe('Workspace id'),
        role: z.enum(['viewer', 'contributor']).describe('viewer = read only; contributor = read + write'),
    })).optional().describe('Optional per-workspace grants applied when the invitee joins');

    // ── Tool: aimeat_organism_invite ──
    // Mirrors POST /v1/organisms/:id/invitations — shared core in services/invitations.ts. Carries
    // an org role + per-workspace grants chosen at invite time, applied on accept.
    mcp.tool(
        'aimeat_organism_invite',
        descriptionFor('aimeat_organism_invite'),
        {
            organism_id: z.string().describe('The organism ID'),
            invitee: z.string().describe('Bare owner name to invite'),
            role: z.enum(['member', 'admin']).optional().describe('Organism role granted on accept (default "member")'),
            workspaces: wsGrantShape,
        },
        annotationsFor('aimeat_organism_invite'),
        async ({ organism_id, invitee, role, workspaces }) => {
            const gate = await inviteAdminGate(organism_id);
            if (gate.err !== undefined) return { content: [{ type: 'text' as const, text: gate.err }], isError: true };
            try {
                const membership = await createNameInvitation(storage, config, {
                    organism: gate.organism, inviterGhii: gate.ownerName, inviteeRaw: invitee, role, workspaces,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'invited', organism_id, invitee: membership.ghii, role: membership.role, workspaces: membership.invitedWorkspaces ?? [] }, null, 2) }] };
            } catch (e) {
                return { content: [{ type: 'text' as const, text: invitationErrText(e) }], isError: true };
            }
        },
    );

    // ── Tool: aimeat_organism_member_add ──
    // Mirrors POST /v1/organisms/:id/members — DIRECT ADD: the owner becomes an active member with
    // role + workspace grants applied immediately (no accept round-trip; they are notified and can leave).
    mcp.tool(
        'aimeat_organism_member_add',
        descriptionFor('aimeat_organism_member_add'),
        {
            organism_id: z.string().describe('The organism ID'),
            ghii: z.string().describe('Bare owner name to add as an active member'),
            role: z.enum(['member', 'admin']).optional().describe('Organism role (default "member")'),
            workspaces: wsGrantShape,
        },
        annotationsFor('aimeat_organism_member_add'),
        async ({ organism_id, ghii, role, workspaces }) => {
            const gate = await inviteAdminGate(organism_id);
            if (gate.err !== undefined) return { content: [{ type: 'text' as const, text: gate.err }], isError: true };
            try {
                const { membership, grantedWorkspaces } = await addOrganismMember(storage, config, {
                    organism: gate.organism, inviterGhii: gate.ownerName, inviteeRaw: ghii, role, workspaces,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'added', organism_id, member: membership.ghii, role: membership.role, workspaces: grantedWorkspaces }, null, 2) }] };
            } catch (e) {
                return { content: [{ type: 'text' as const, text: invitationErrText(e) }], isError: true };
            }
        },
    );

    // ── Tool: aimeat_organism_owner_add ──
    // Mirrors POST /v1/organisms/:id/owners, and calls the same service, so the membership rules and
    // the notifications cannot differ between the two doors.
    mcp.tool(
        'aimeat_organism_owner_add',
        descriptionFor('aimeat_organism_owner_add'),
        {
            organism_id: z.string().describe('The organism ID'),
            ghii: z.string().describe('Bare owner name of an active member to make a co-owner'),
        },
        annotationsFor('aimeat_organism_owner_add'),
        async ({ organism_id, ghii }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: `Organism not found: ${organism_id}` }], isError: true };
            const ownerName = getOwnerName();
            if (!isOrganismOwner(organism, ownerName)) {
                return { content: [{ type: 'text' as const, text: 'Only an owner can add an owner' }], isError: true };
            }
            const out = await addOrganismOwner(storage, config, organism, ghii, { performedBy: ownerName });
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ organism_id, added: out.added, owners: out.owners }, null, 2) }] };
        },
    );

    // ── Tool: aimeat_organism_owner_remove ──
    // Mirrors DELETE /v1/organisms/:id/owners/:ghii. The last owner cannot be removed: an organism
    // with no owner is the one state nobody inside it can repair.
    mcp.tool(
        'aimeat_organism_owner_remove',
        descriptionFor('aimeat_organism_owner_remove'),
        {
            organism_id: z.string().describe('The organism ID'),
            ghii: z.string().describe('Bare owner name to take off the owners; they stay as an admin'),
        },
        annotationsFor('aimeat_organism_owner_remove'),
        async ({ organism_id, ghii }) => {
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: `Organism not found: ${organism_id}` }], isError: true };
            const ownerName = getOwnerName();
            if (!isOrganismOwner(organism, ownerName)) {
                return { content: [{ type: 'text' as const, text: 'Only an owner can remove an owner' }], isError: true };
            }
            const out = await removeOrganismOwner(storage, config, organism, ghii, { performedBy: ownerName });
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ organism_id, removed: out.removed, owners: out.owners }, null, 2) }] };
        },
    );

    // ── Tool: aimeat_organism_invitation_update ──
    // Mirrors PATCH /v1/organisms/:id/invitations/:ghii — edit a PENDING name invitation's rights.
    mcp.tool(
        'aimeat_organism_invitation_update',
        descriptionFor('aimeat_organism_invitation_update'),
        {
            organism_id: z.string().describe('The organism ID'),
            invitee: z.string().describe('Bare owner name whose pending invitation to edit'),
            role: z.enum(['member', 'admin']).optional().describe('New organism role'),
            workspaces: wsGrantShape,
        },
        annotationsFor('aimeat_organism_invitation_update'),
        async ({ organism_id, invitee, role, workspaces }) => {
            const gate = await inviteAdminGate(organism_id);
            if (gate.err !== undefined) return { content: [{ type: 'text' as const, text: gate.err }], isError: true };
            if (role === undefined && workspaces === undefined) {
                return { content: [{ type: 'text' as const, text: 'Provide "role" and/or "workspaces" to update' }], isError: true };
            }
            try {
                const membership = await updateNameInvitation(storage, config, {
                    organism: gate.organism, inviteeRaw: invitee, role, workspaces,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'updated', organism_id, invitee: membership.ghii, role: membership.role, workspaces: membership.invitedWorkspaces ?? [] }, null, 2) }] };
            } catch (e) {
                return { content: [{ type: 'text' as const, text: invitationErrText(e) }], isError: true };
            }
        },
    );

    // ── Tool: aimeat_organism_invitation_cancel ──
    // Mirrors DELETE /v1/organisms/:id/invitations/:ghii — withdraw a PENDING name invitation.
    mcp.tool(
        'aimeat_organism_invitation_cancel',
        descriptionFor('aimeat_organism_invitation_cancel'),
        {
            organism_id: z.string().describe('The organism ID'),
            invitee: z.string().describe('Bare owner name whose pending invitation to withdraw'),
        },
        annotationsFor('aimeat_organism_invitation_cancel'),
        async ({ organism_id, invitee }) => {
            const gate = await inviteAdminGate(organism_id);
            if (gate.err !== undefined) return { content: [{ type: 'text' as const, text: gate.err }], isError: true };
            try {
                await cancelNameInvitation(storage, config, {
                    organism: gate.organism, cancellerGhii: gate.ownerName, inviteeRaw: invitee,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'cancelled', organism_id, invitee }, null, 2) }] };
            } catch (e) {
                return { content: [{ type: 'text' as const, text: invitationErrText(e) }], isError: true };
            }
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
                if (org) out.push({ organism_id: org.id, name: org.name, type: org.type, invited_by: m.invitedBy, role: m.role, workspaces: m.invitedWorkspaces ?? [] });
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
            if (decision === 'decline') {
                // Shared with POST /:id/invitations/decline (services/invitations.ts).
                try {
                    await declineNameInvitation(storage, { organismId: organism_id, inviteeOwner: ownerName });
                } catch (e) {
                    return { content: [{ type: 'text' as const, text: invitationErrText(e) }], isError: true };
                }
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'declined', organism_id }, null, 2) }] };
            }
            // Shared accept core: activates the row, syncs members/admins, applies invite-time ws grants.
            const workspaces = await acceptNameInvitation(storage, config, { organism, membership });
            emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'joined', organism_id, role: membership.role, workspaces }, null, 2) }] };
        },
    );
}
