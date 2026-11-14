/**
 * @file src/services/organism-read/member.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism read with the membership rule around it: the organism, and the caller's
 *   role in it (services/workspace/share.ts memberRoleOf: the owner's active membership first, else
 *   an agent on the organism's agent list is a member), or which of the two is missing. The workspace
 *   routes (requireMember, routes/organisms/shared.ts) and the workspace MCP tools (denyReason and
 *   the meta.* role, mcp/workspaces.ts) each read the organism and asked the same question; they ask
 *   this function now (structure programme 2026-11, unit 2b).
 *
 *   WHO. `sub` is the session's subject (the agent's GAII over MCP), `owner` the account it acts in.
 *   The refusal is a code; each surface keeps its own sentence for it.
 * @structure MemberGate · organismMemberGate(storage, id, who) · organismForActiveMember(storage, id, who) ·
 *   organismShownTo(storage, id, who) · organismRosterFor(storage, id, who, filter) · organismToJoin(storage, id, who)
 * @usage const gate = await organismMemberGate(storage, id, { sub: req.auth!.sub, owner: req.auth!.owner });
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from the workspace routes and mcp/workspaces.ts, which each held a copy
 *     (structure programme 2026-11, unit 2b). organismMemberGate also from the organism search route
 *     and tool; organismForActiveMember from the export route and tool, the same day.
 *   v1.1.0 — 2026-11-14 — organismShownTo: the private-organism rule of GET /v1/organisms/:id, which
 *     aimeat_organism_get and the organism resource now ask instead of the organism's members list
 *     (one answer per caller, parity section ORG-READ; structure programme 2026-11, unit 2b phase B).
 *   v1.2.0 — 2026-11-14 — organismRosterFor: the same rule for a private organism's member list, which
 *     GET /v1/organisms/:id/members and aimeat_organism_members ask; the operator's agent is refused
 *     (developer approval 2026-11-14, parity section ROSTER-PRIVATE).
 *   v1.3.0 — 2026-11-14 — organismToJoin: a private organism answers a join from outside as not
 *     found on REST as on MCP (developer approval 2026-11-14, parity section JOIN-PRIVATE).
 */
import type { Storage, OrganismRecord, OrganismMembershipRecord } from '../../storage/interface.js';
import { memberRoleOf } from '../workspace/share.js';

export type MemberGate =
    | { ok: true; organism: OrganismRecord; role: string }
    | { ok: false; code: 'NOT_FOUND' | 'NOT_A_MEMBER' };

/**
 * The organism, when the caller's ACCOUNT holds an active membership in it. An agent on the
 * organism's agent list whose owner is not a member is refused: the bundle an export builds reads
 * as the owner. GET /v1/organisms/:id/export and aimeat_organism_export.
 */
export async function organismForActiveMember(
    storage: Storage, organismId: string, who: { owner: string | undefined },
): Promise<{ ok: true; organism: OrganismRecord } | { ok: false; code: 'NOT_FOUND' | 'NOT_A_MEMBER' }> {
    const organism = await storage.getOrganism(organismId);
    if (!organism) return { ok: false, code: 'NOT_FOUND' };
    const m = who.owner ? await storage.getMembership(organismId, who.owner) : null;
    if (!m || m.status !== 'active') return { ok: false, code: 'NOT_A_MEMBER' };
    return { ok: true, organism };
}

/**
 * The organism and its active members, when the caller may read it: a private organism is there only
 * for an account with an active membership in it; the other visibilities for anyone. GET
 * /v1/organisms/:id, aimeat_organism_get and the aimeat://organisms resource.
 */
export async function organismShownTo(
    storage: Storage, organismId: string, who: { owner: string | undefined },
): Promise<{ ok: true; organism: OrganismRecord; members: OrganismMembershipRecord[] } | { ok: false; code: 'NOT_FOUND' | 'HIDDEN' }> {
    return organismRosterFor(storage, organismId, who, {});
}

/**
 * The organism and its member rows (role and status filters; active by default), when the caller may
 * read it: the rule of organismShownTo, so a private organism's member list is for its active members
 * only. The operator's agent is refused like anyone else who is not in it (developer approval
 * 2026-11-14). `operatorInPerson` keeps the operator signed in in person reading a private roster on
 * the REST route, as it did before (e2e-own-reach-oct26 MEMBERS); an MCP session never is one.
 * GET /v1/organisms/:id/members and aimeat_organism_members.
 */
export async function organismRosterFor(
    storage: Storage, organismId: string, who: { owner: string | undefined; operatorInPerson?: boolean },
    filter: { role?: string; status?: string },
): Promise<{ ok: true; organism: OrganismRecord; members: OrganismMembershipRecord[] } | { ok: false; code: 'NOT_FOUND' | 'HIDDEN' }> {
    const organism = await storage.getOrganism(organismId);
    if (!organism) return { ok: false, code: 'NOT_FOUND' };
    if (organism.visibility === 'private' && !who.operatorInPerson) {
        const m = who.owner ? await storage.getMembership(organismId, who.owner) : null;
        if (!m || m.status !== 'active') return { ok: false, code: 'HIDDEN' };
    }
    const members = await storage.listMembers(organismId, { ...(filter.role ? { role: filter.role } : {}), status: filter.status || 'active' });
    return { ok: true, organism, members };
}

/**
 * The organism a caller may ask to join: a private organism is there only for an account already in
 * it (which joinOrganism then answers ALREADY_MEMBER); for anyone else it answers as one that does
 * not exist, so an id alone opens no private organism to an agent. POST /v1/organisms/:id/join and
 * aimeat_organism_join (developer approval 2026-11-14, parity section JOIN-PRIVATE).
 *
 * `inPerson`: the account holder signed in in person still joins a private organism with an open
 * policy by its id on REST, as before. Some forty E2E suites set up their members that way, and the
 * tool's own reason for the rule was the agent arriving without a person having opened the
 * organism first. An MCP session is never in person.
 */
export async function organismToJoin(
    storage: Storage, organismId: string, who: { owner: string | undefined; inPerson?: boolean },
): Promise<{ ok: true; organism: OrganismRecord } | { ok: false; code: 'NOT_FOUND' }> {
    const organism = await storage.getOrganism(organismId);
    if (!organism) return { ok: false, code: 'NOT_FOUND' };
    if (organism.visibility === 'private' && !who.inPerson) {
        const m = who.owner ? await storage.getMembership(organismId, who.owner) : null;
        if (!m || m.status !== 'active') return { ok: false, code: 'NOT_FOUND' };
    }
    return { ok: true, organism };
}

/** The organism and the caller's role in it, when the caller is in it. */
export async function organismMemberGate(storage: Storage, organismId: string, who: { sub?: string; owner?: string }): Promise<MemberGate> {
    const organism = await storage.getOrganism(organismId);
    if (!organism) return { ok: false, code: 'NOT_FOUND' };
    const role = await memberRoleOf(storage, organism, organismId, who);
    return role ? { ok: true, organism, role } : { ok: false, code: 'NOT_A_MEMBER' };
}
