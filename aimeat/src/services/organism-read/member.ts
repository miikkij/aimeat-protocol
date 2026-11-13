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
 * @structure MemberGate · organismMemberGate(storage, id, who) · organismForActiveMember(storage, id, who)
 * @usage const gate = await organismMemberGate(storage, id, { sub: req.auth!.sub, owner: req.auth!.owner });
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from the workspace routes and mcp/workspaces.ts, which each held a copy
 *     (structure programme 2026-11, unit 2b). organismMemberGate also from the organism search route
 *     and tool; organismForActiveMember from the export route and tool, the same day.
 */
import type { Storage, OrganismRecord } from '../../storage/interface.js';
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

/** The organism and the caller's role in it, when the caller is in it. */
export async function organismMemberGate(storage: Storage, organismId: string, who: { sub?: string; owner?: string }): Promise<MemberGate> {
    const organism = await storage.getOrganism(organismId);
    if (!organism) return { ok: false, code: 'NOT_FOUND' };
    const role = await memberRoleOf(storage, organism, organismId, who);
    return role ? { ok: true, organism, role } : { ok: false, code: 'NOT_A_MEMBER' };
}
