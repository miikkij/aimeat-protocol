/**
 * @file src/mcp/organisms-email-invites.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP email-invitation tools for organisms (invite_email, invitations_email,
 *   invitation_email_cancel) plus the shared creator/admin gate. Extracted from organisms.ts to
 *   satisfy max-file-lines.
 * @structure registerOrganismEmailInviteTools() — orgForAdmin() gate + aimeat_organism_invite_email,
 *   aimeat_organism_invitations_email, aimeat_organism_invitation_email_cancel.
 * @usage registerOrganismEmailInviteTools(mcp, storage, config, getOwnerName);
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.3.0 — 2026-09-30 — aimeat_organism_invite_email takes `locale` for the email's language and
 *     answers `email_locale`, as the REST route does.
 *   v1.2.0 — 2026-09-28 — aimeat_organism_invite_email takes return_url, as the REST route does, and
 *     answers with the return target it kept. Without it an invitation sent over MCP always landed the
 *     invitee on the profile page instead of in the app they were invited to work in.
 *   v1.1.0 — 2026-08-11 — invitation_email_cancel calls cancelEmailInvitation() instead of flipping
 *     the record itself, so it and the REST cancel route share one write (August 2026 MCP audit
 *     step 8).
 *   v1.0.0 — 2026-07-13 — Extracted from mcp/organisms.ts (max-file-lines)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { createEmailInvitation, cancelEmailInvitation, invitePublic, normalizeOrgRole, normalizeWorkspaceGrants, InvitationError } from '../services/invitations.js';
import { emitChange } from '../services/event-bus.js';
import { isOrganismOwner } from '../services/organism-ownership.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

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
        zodShapeFor('aimeat_organism_invite_email'),
        annotationsFor('aimeat_organism_invite_email'),
        async ({ organism_id, email, org_role, workspaces, message, expires_in_days, return_url, locale }) => {
            const gate = await orgForAdmin(organism_id);
            if ('error' in gate) return { content: [{ type: 'text' as const, text: gate.error }], isError: true };
            try {
                // Its sibling _cancel emits; this one did not, so an invitation an agent sent did
                // not show in the organism's pending list until a reload.
                emitChange('organisms');
                const { invitation, acceptUrl, emailSent, emailLocale } = await createEmailInvitation(storage, config, {
                    organism: gate.organism!,
                    inviterGhii: getOwnerName(),
                    email,
                    orgRole: normalizeOrgRole(org_role),
                    workspaces: normalizeWorkspaceGrants(workspaces),
                    message,
                    expiresInDays: expires_in_days,
                    returnUrl: return_url, // allowlisted in createEmailInvitation, as on the REST route
                    locale, // validated in createEmailInvitation, as on the REST route
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'invited', invitation: invitePublic(invitation), email_sent: emailSent, email_locale: emailLocale, accept_url: acceptUrl, return_url: invitation.returnUrl ?? null }, null, 2) }] };
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
        zodShapeFor('aimeat_organism_invitations_email'),
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
        zodShapeFor('aimeat_organism_invitation_email_cancel'),
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
