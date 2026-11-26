/**
 * @file src/services/organism-read/waiting.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What waits in the organisms a person belongs to: pending approvals (per workspace), the
 *   open join requests of the organisms they manage, and the invitations sent to them.
 *
 *   ONE IMPLEMENTATION, TWO CALLERS. GET /v1/organisms/waiting answers organismWaitingFor, the list as
 *   that route has always given it: every pending approval of a member organism is counted, whoever
 *   may decide it. The list of everything that waits for a person (services/home/waiting.ts) asks
 *   approvalsToDecideFor and joinRequestsToReviewFor, which keep only what this person can decide,
 *   because that list says "this needs your yes or no".
 *
 *   WHO MAY DECIDE AN APPROVAL. The rule of the route that decides it (POST
 *   /v1/organisms/:id/approvals/:aid): the member's role satisfies the approval's approverRole. A
 *   member's suggested workspace change has its own rule (services/workspace/suggestions.ts): the
 *   workspace's creator or an organism admin, never the member who made it. An overdue approval is
 *   left out here and never written: expiring it is the deciding route's and the list route's work.
 *
 *   A TEAM'S APPROVALS ARE NOT REPEATED. approvalsToDecideFor leaves out an organism that is a team,
 *   because services/team/waiting.ts names its approvals and the list above counts them once there.
 *
 *   STATEMENTS. The organisms once, the pending approvals of all of them in one read, the workspace
 *   names in one read; a team record per organism that has something to decide, and the workspace's
 *   registration per workspace that holds a suggestion a plain member might decide. Join requests are
 *   read per managed organism, as before.
 * @structure ReviewRow · JoinRow · InviteRow · organismWaitingFor · approvalsToDecideFor ·
 *   joinRequestsToReviewFor
 * @usage const items = await organismWaitingFor({ storage, config }, { owner, principal });
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial: the read of GET /v1/organisms/waiting moved out of
 *     routes/organisms/crud.ts unchanged, and the two reads the home's waiting list asks.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, OrganismRecord, PendingApprovalRecord, JoinRequestRecord } from '../../storage/interface.js';
import { expireOverdueApprovals, isOverdue } from '../gate-expiry.js';
import { createOrganismGate } from '../organism/gate.js';
import { agentBarred, organismsAdmitting } from '../organism/agent-access.js';
import { isOrganismOwner } from '../organism/ownership.js';
import { roleSatisfies } from '../organism/record-helpers.js';
import { openJoinRequests } from '../organism-join-requests/requests.js';
import { isMemberChangeAction, ownerNameOf } from '../workspace/suggestion-notices.js';
import { findWorkspaceRegistration } from '../workspace/meta.js';
import { readTeamRecord } from '../team/record.js';

interface Deps { storage: Storage; config: AimeatConfig }

/** The person the list is for, and the principal that asks in their name (an agent may be barred from an organism). */
export interface WaitingWho { owner: string; principal: string }

export interface ReviewRow { kind: 'review'; n: number; orgId: string; orgName: string; wsId: string; wsName: string }
export interface JoinRow { kind: 'join'; n: number; orgId: string; orgName: string }
export interface InviteRow { kind: 'invite'; orgName: string; organismId: string }

/** Pending approvals of one workspace that this person can decide; `at` is when the newest began to wait. */
export interface ApprovalsToDecide { orgId: string; orgName: string; wsId: string; wsName: string; n: number; at: string }

const wsOf = (a: PendingApprovalRecord) => (a.arguments as { ws?: string } | undefined)?.ws ?? '';

/** The organisms the person is a member of and the asking principal is admitted to. */
async function admittedOrganisms(deps: Deps, who: WaitingWho): Promise<OrganismRecord[]> {
    return organismsAdmitting(await deps.storage.listOrganisms({ member: who.owner }), who.principal);
}

/** Pending approvals grouped per workspace, with the workspace's name from the registry. */
async function reviewRows(deps: Deps, orgs: OrganismRecord[], byOrg: Record<string, PendingApprovalRecord[]>): Promise<ReviewRow[]> {
    const H = createOrganismGate(deps.config, deps.storage);
    const namesByOrg = await H.workspaceNamesByOrg(orgs.filter(o => (byOrg[o.id]?.length)).map(o => o.id));
    const reviews: ReviewRow[] = [];
    for (const org of orgs) {
        const aps = byOrg[org.id] ?? [];
        if (!aps.length) continue;
        const byWs: Record<string, number> = {};
        for (const a of aps) { const w = wsOf(a); byWs[w] = (byWs[w] ?? 0) + 1; }
        const names = namesByOrg.get(org.id);
        for (const [wsId, n] of Object.entries(byWs)) reviews.push({ kind: 'review', n, orgId: org.id, orgName: org.name, wsId, wsName: names?.get(wsId) || wsId });
    }
    return reviews;
}

/** The organisms whose join requests this person reviews: its owners and admins. */
const managedBy = (orgs: OrganismRecord[], owner: string) =>
    orgs.filter(org => isOrganismOwner(org, owner) || (org.admins ?? []).includes(owner));

/**
 * Everything across the person's member organisms that waits, as GET /v1/organisms/waiting gives it:
 * pending approvals per workspace, open join requests per managed organism, incoming invitations.
 */
export async function organismWaitingFor(deps: Deps, who: WaitingWho): Promise<Array<ReviewRow | JoinRow | InviteRow>> {
    const { storage } = deps;
    await expireOverdueApprovals(storage, new Date().toISOString());
    // An organism that admits only listed agents is left out for an agent it does not admit, as the
    // MCP organism list leaves it out (secaudit2026oct22): its name and its waiting items are its own.
    const orgs = await admittedOrganisms(deps, who);
    // Pending approvals for EVERY member org in one batched read, then the ws-name registry lookup
    // for just the orgs that have approvals in one batched cross-owner read.
    const reviews = await reviewRows(deps, orgs, await storage.listPendingApprovalsForOrgs(orgs.map(o => o.id), { status: 'pending' }));
    // Join requests only for orgs the caller manages (creator/admin), per org (typically few managed).
    const joinRequests: JoinRow[] = [];
    await Promise.all(managedBy(orgs, who.owner).map(async (org) => {
        const jr = await openJoinRequests(deps, org);
        if (jr.length) joinRequests.push({ kind: 'join', n: jr.length, orgId: org.id, orgName: org.name });
    }));
    const invited = (await storage.listMembershipsByGhii(who.owner)).filter(m => m.status === 'invited');
    const invitations: InviteRow[] = [];
    for (const m of invited) {
        const org = await storage.getOrganism(m.organismId);
        if (org && !agentBarred(org, who.principal)) invitations.push({ kind: 'invite', orgName: org.name, organismId: org.id });
    }
    return [...reviews, ...joinRequests, ...invitations];
}

/**
 * The pending approvals this person can decide, per workspace, outside their teams. Reads only:
 * an overdue approval is left out, never expired here.
 */
export async function approvalsToDecideFor(deps: Deps, who: WaitingWho): Promise<ApprovalsToDecide[]> {
    const { storage } = deps;
    const nowIso = new Date().toISOString();
    const orgs = await admittedOrganisms(deps, who);
    if (!orgs.length) return [];
    const pending = await storage.listPendingApprovalsForOrgs(orgs.map(o => o.id), { status: 'pending' });
    const waiting = orgs.filter(o => pending[o.id]?.length);
    if (!waiting.length) return [];
    const roleOf = new Map((await storage.listMembershipsByGhii(who.owner)).filter(m => m.status === 'active').map(m => [m.organismId, m.role as string]));
    const mine: Record<string, PendingApprovalRecord[]> = {};
    for (const org of waiting) {
        const role = roleOf.get(org.id);
        if (!role) continue;
        const manages = role === 'creator' || role === 'admin';
        const createdByMe = new Map<string, boolean>();
        const kept: PendingApprovalRecord[] = [];
        for (const a of pending[org.id]!) {
            if (isOverdue(a, nowIso)) continue;
            if (!isMemberChangeAction(a.action)) {
                if (roleSatisfies(a.approverRole, role)) kept.push(a);
                continue;
            }
            const ws = wsOf(a);
            if (!ws || ownerNameOf(a.actor) === who.owner) continue;
            if (!manages && !createdByMe.has(ws)) createdByMe.set(ws, (await findWorkspaceRegistration(storage, org.id, ws))?.creator === who.owner);
            if (manages || createdByMe.get(ws)) kept.push(a);
        }
        // A team's approvals are named by the team's own waiting read (services/team/waiting.ts).
        if (kept.length && !(await readTeamRecord(storage, org.id))) mine[org.id] = kept;
    }
    const rows = await reviewRows(deps, waiting, mine);
    return rows.map(r => ({
        orgId: r.orgId, orgName: r.orgName, wsId: r.wsId, wsName: r.wsName, n: r.n,
        at: mine[r.orgId]!.filter(a => wsOf(a) === r.wsId).reduce((newest, a) => (a.createdAt > newest ? a.createdAt : newest), ''),
    }));
}

/** The open join requests of every organism this person owns or administers. */
export async function joinRequestsToReviewFor(deps: Deps, who: WaitingWho): Promise<Array<{ organism: OrganismRecord; requests: JoinRequestRecord[] }>> {
    const managed = managedBy(await admittedOrganisms(deps, who), who.owner);
    const read = await Promise.all(managed.map(async organism => ({ organism, requests: await openJoinRequests(deps, organism) })));
    return read.filter(r => r.requests.length);
}
