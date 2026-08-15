/**
 * @file src/mcp/organisms-email-invites.ts
 * @description MCP email-invitation tools for organisms (invite_email, invitations_email,
 *   invitation_email_cancel) plus the shared creator/admin gate. Extracted from organisms.ts to
 *   satisfy max-file-lines.
 * @structure registerOrganismEmailInviteTools() — orgForAdmin() gate + aimeat_organism_invite_email,
 *   aimeat_organism_invitations_email, aimeat_organism_invitation_email_cancel.
 * @usage registerOrganismEmailInviteTools(mcp, storage, config, getOwnerName);
 * @version-history
 *   v1.1.0 — 2026-08-11 — invitation_email_cancel calls cancelEmailInvitation() instead of flipping
 *     the record itself, so it and the REST cancel route share one write (August 2026 MCP audit
 *     step 8).
 *   v1.0.0 — 2026-07-13 — Extracted from mcp/organisms.ts (max-file-lines)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { createEmailInvitation, cancelEmailInvitation, invitePublic, normalizeOrgRole, normalizeWorkspaceGrants, InvitationError } from '../services/invitations.js';
import { emitChange } from '../services/event-bus.js';
import { isOrganismOwner } from '../services/organism-ownership.js';

export function registerOrganismEmailInviteTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getOwnerName: () => string,
): void {
    /** Creator/admin gate shared by the email-invitation tools. Returns the organism or an error result. */
    async function orgForAdmin(organism_id: string): Promise<{ organism: Awaited<ReturnType<typeof storage.getOrganism>> } | { error: string }> {
        const organism = await storage.getOrganism(organism_id);
        if (!organism) return { error: 'Organism not found' };
        const ownerName = getOwnerName();
        if (!isOrganismOwner(organism, ownerName) && !organism.admins.includes(ownerName)) {
            return { error: 'Only the creator or an admin can manage invitations' };
        }
        return { organism };
    }

    // ── Tool: aimeat_organism_invite_email ── (invite an external email into an organism + workspaces)
    // Mirrors POST /v1/organisms/:id/invitations/email. Creator/admin only. The org-admin gate implies
    // the right to grant any of the organism's workspaces, so grants pass straight to the shared core.
    mcp.tool(
        'aimeat_organism_invite_email',
        descriptionFor('aimeat_organism_invite_email'),
        {
            organism_id: z.string().describe('The organism ID'),
            email: z.string().describe('Email address of the person to invite'),
            org_role: z.enum(['member', 'admin']).optional().describe('Organism role granted on accept (default member)'),
            workspaces: z.array(z.object({ ws: z.string(), role: z.enum(['viewer', 'contributor']) })).optional().describe('Optional per-workspace grants'),
            message: z.string().optional().describe('Optional personal note included in the email'),
            expires_in_days: z.number().optional().describe('Days until the invitation expires (1–30, default 7)'),
        },
        annotationsFor('aimeat_organism_invite_email'),
        async ({ organism_id, email, org_role, workspaces, message, expires_in_days }) => {
            const gate = await orgForAdmin(organism_id);
            if ('error' in gate) return { content: [{ type: 'text' as const, text: gate.error }], isError: true };
            try {
                // Its sibling _cancel emits; this one did not, so an invitation an agent sent did
                // not show in the organism's pending list until a reload.
                emitChange('organisms');
                const { invitation, acceptUrl, emailSent } = await createEmailInvitation(storage, config, {
                    organism: gate.organism!,
                    inviterGhii: getOwnerName(),
                    email,
                    orgRole: normalizeOrgRole(org_role),
                    workspaces: normalizeWorkspaceGrants(workspaces),
                    message,
                    expiresInDays: expires_in_days,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'invited', invitation: invitePublic(invitation), email_sent: emailSent, accept_url: acceptUrl }, null, 2) }] };
            } catch (e) {
                if (e instanceof InvitationError) return { content: [{ type: 'text' as const, text: e.message }], isError: true };
                throw e;
            }
        },
    );

    // ── Tool: aimeat_organism_invitations_email ── (list pending email invitations for an organism)
    mcp.tool(
        'aimeat_organism_invitations_email',
        descriptionFor('aimeat_organism_invitations_email'),
        { organism_id: z.string().describe('The organism ID') },
        annotationsFor('aimeat_organism_invitations_email'),
        async ({ organism_id }) => {
            const gate = await orgForAdmin(organism_id);
            if ('error' in gate) return { content: [{ type: 'text' as const, text: gate.error }], isError: true };
            const invitations = (await storage.listInvitationsByOrganism(organism_id, { status: 'pending' })).map(invitePublic);
            return { content: [{ type: 'text' as const, text: JSON.stringify(invitations, null, 2) }] };
        },
    );

    // ── Tool: aimeat_organism_invitation_email_cancel ── (cancel a pending email invitation)
    mcp.tool(
        'aimeat_organism_invitation_email_cancel',
        descriptionFor('aimeat_organism_invitation_email_cancel'),
        {
            organism_id: z.string().describe('The organism ID'),
            invitation_id: z.string().describe('The invitation id to cancel'),
        },
        annotationsFor('aimeat_organism_invitation_email_cancel'),
        async ({ organism_id, invitation_id }) => {
            const gate = await orgForAdmin(organism_id);
            if ('error' in gate) return { content: [{ type: 'text' as const, text: gate.error }], isError: true };
            try {
                // Shared with POST /:id/invitations/email/:invId/cancel (services/invitations.ts).
                await cancelEmailInvitation(storage, { organismId: organism_id, invitationId: invitation_id });
            } catch (e) {
                if (e instanceof InvitationError) return { content: [{ type: 'text' as const, text: e.message }], isError: true };
                throw e;
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'cancelled', organism_id, invitation_id }, null, 2) }] };
        },
    );
}
