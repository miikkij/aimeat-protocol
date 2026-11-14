/**
 * @file src/services/organism-read/manager.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism read with the manager rule around it, for the routes and the MCP tools
 *   that invite, add or remove people and owners (structure programme 2026-11, unit 2b). Each pair of
 *   surfaces held its own copy of the same read and the same test:
 *
 *   - organismForManager: an owner (isOrganismOwner, services/organism-ownership.ts) or an admin
 *     (organism.admins). The invitation and member routes (requireInviteAdmin, requireOrgAdmin) and
 *     the invite tools (inviteAdminGate, orgForAdmin).
 *   - organismForOwner: an owner only. POST and DELETE /v1/organisms/:id/owners and
 *     aimeat_organism_owner_add / _remove.
 *   - pendingEmailInvitationsFor: organismForManager, then the organism's pending email invitations
 *     in their public shape. GET /v1/organisms/:id/invitations/email and
 *     aimeat_organism_invitations_email.
 *
 *   WHO. `who.owner` is the account the caller acts in: req.auth.owner on REST, the session's owner
 *   name over MCP (a CallerContext passes as it is). Both surfaces asked by that name before the move,
 *   and still do. The refusal is a code; each surface keeps its own sentence for it.
 * @structure ManagerGate · organismForManager(storage, id, who) · organismForOwner(storage, id, who) ·
 *   pendingEmailInvitationsFor(storage, id, who)
 * @usage
 *   const gate = await organismForManager(storage, id, { owner: req.auth!.owner });
 *   if (!gate.ok) refuse(gate.code); else use(gate.organism);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/organisms/membership.ts, routes/organisms/shared.ts,
 *     mcp/organisms-name-invites.ts and mcp/organisms-email-invites.ts, which each held a copy
 *     (structure programme 2026-11, unit 2b). organismForOwner from routes/organisms/membership.ts and
 *     mcp/organisms-name-invites.ts the same day.
 */
import type { Storage, OrganismRecord } from '../../storage/interface.js';
import { isOrganismOwner } from '../organism-ownership.js';
import { invitePublic } from '../invitations.js';

export type ManagerGate =
    | { ok: true; organism: OrganismRecord }
    | { ok: false; code: 'NOT_FOUND' | 'ACCESS_DENIED' };

/** The organism, when the caller's account owns it or is one of its admins. */
export async function organismForManager(storage: Storage, organismId: string, who: { owner: string }): Promise<ManagerGate> {
    const organism = await storage.getOrganism(organismId);
    if (!organism) return { ok: false, code: 'NOT_FOUND' };
    if (!isOrganismOwner(organism, who.owner) && !organism.admins.includes(who.owner)) return { ok: false, code: 'ACCESS_DENIED' };
    return { ok: true, organism };
}

/** The organism, when the caller's account is one of its owners. */
export async function organismForOwner(storage: Storage, organismId: string, who: { owner: string }): Promise<ManagerGate> {
    const organism = await storage.getOrganism(organismId);
    if (!organism) return { ok: false, code: 'NOT_FOUND' };
    if (!isOrganismOwner(organism, who.owner)) return { ok: false, code: 'ACCESS_DENIED' };
    return { ok: true, organism };
}

/** The organism's pending email invitations in their public shape, when the caller manages it. */
export async function pendingEmailInvitationsFor(
    storage: Storage, organismId: string, who: { owner: string },
): Promise<{ ok: true; invitations: ReturnType<typeof invitePublic>[] } | Extract<ManagerGate, { ok: false }>> {
    const gate = await organismForManager(storage, organismId, who);
    if (!gate.ok) return gate;
    const invitations = (await storage.listInvitationsByOrganism(organismId, { status: 'pending' })).map(invitePublic);
    return { ok: true, invitations };
}
