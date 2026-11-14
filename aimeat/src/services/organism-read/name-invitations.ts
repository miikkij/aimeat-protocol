/**
 * @file src/services/organism-read/name-invitations.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The caller's own name invitations (a membership row with status `invited`), read with
 *   the rule both surfaces put around them (structure programme 2026-11, unit 2b):
 *
 *   - nameInvitationsOf: every pending invitation of the caller's account, with the organism it is
 *     to; an invitation whose organism is gone is left out. GET /v1/organisms/invitations/mine and
 *     aimeat_organism_invitations.
 *   - nameInvitationTo: the organism and the caller's pending invitation to it, or which of the two
 *     is missing. POST /v1/organisms/:id/invitations/accept and aimeat_organism_invitation_respond.
 *
 *   WHO. `who.owner` is the account the caller acts in (req.auth.owner, or the session's owner name
 *   over MCP), the name both surfaces asked by before the move. Whether the caller may ACCEPT in
 *   person stays with each surface, after this read, as it was.
 * @structure nameInvitationsOf(storage, who) · nameInvitationTo(storage, id, who)
 * @usage const inv = await nameInvitationTo(storage, id, { owner: req.auth!.owner }); if (!inv.ok) refuse(inv.code);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/organisms/membership.ts and mcp/organisms-name-invites.ts,
 *     which each held a copy (structure programme 2026-11, unit 2b).
 */
import type { Storage, OrganismRecord, OrganismMembershipRecord } from '../../storage/interface.js';

/** The caller's pending name invitations, each with its organism, in the store's order. */
export async function nameInvitationsOf(
    storage: Storage, who: { owner: string },
): Promise<Array<{ membership: OrganismMembershipRecord; organism: OrganismRecord }>> {
    const memberships = (await storage.listMembershipsByGhii(who.owner)).filter(m => m.status === 'invited');
    const out: Array<{ membership: OrganismMembershipRecord; organism: OrganismRecord }> = [];
    for (const membership of memberships) {
        const organism = await storage.getOrganism(membership.organismId);
        if (organism) out.push({ membership, organism });
    }
    return out;
}

/** The organism and the caller's pending invitation to it, or which one is missing. */
export async function nameInvitationTo(
    storage: Storage, organismId: string, who: { owner: string },
): Promise<
    | { ok: true; organism: OrganismRecord; membership: OrganismMembershipRecord }
    | { ok: false; code: 'NOT_FOUND' | 'NO_INVITATION' }
> {
    const organism = await storage.getOrganism(organismId);
    if (!organism) return { ok: false, code: 'NOT_FOUND' };
    const membership = await storage.getMembership(organismId, who.owner);
    if (!membership || membership.status !== 'invited') return { ok: false, code: 'NO_INVITATION' };
    return { ok: true, organism, membership };
}
