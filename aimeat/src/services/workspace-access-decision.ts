/**
 * @file src/services/workspace-access-decision.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Deciding a member's request for access to a workspace: approve grants the role,
 *   deny revokes every role; the decision is written on the request record, and the requester is told.
 *   The body of POST /v1/organisms/:id/workspace-access/decision, moved here unchanged so the MCP
 *   aimeat_workspace_access decide path runs it too.
 *
 *   WHY. The MCP decide path granted or revoked the role and stopped there: it wrote no decision on
 *   the request record and told nobody. So a request an admin's agent denied went on reading as
 *   pending in the reviewer's panel (the status is written, not computed, since 2026-08-15), and the
 *   member whose access an agent approved never heard of it. Same decision, two answers, depending on
 *   which door the decider used.
 * @structure
 *   - requestStatus() — what a request record says about itself, with the pre-2026-08-15 fallback
 *   - recordRequestDecision() — write the outcome on the requester's request record
 *   - decideAccessRequest() — grant or revoke, record, notify
 * @usage
 *   await decideAccessRequest({ storage, config }, { orgId, ws, wsName, creator, requester, decision: 'approve', role, decidedBy });
 * @version-history
 *   v1.0.0 — 2026-09-25 — Moved from routes/organisms/workspace-access.ts, and the MCP decide path
 *     calls it.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { grantWorkspaceRole, revokeWorkspaceRole, type WsRole } from './workspace-roles.js';
import { notify } from './notify.js';
import { emitChange } from './event-bus.js';

/**
 * What a request record says about itself, with the pre-2026-08-15 fallback.
 *
 * The status used to be COMPUTED — `roles.has(requester) ? 'approved' : 'pending'` — and that
 * expression has two values while the flow has four. A denied request produces no grant, so it read
 * back as `pending` and returned to the reviewer's panel every time, for good: a request denied on
 * 2026-07-11 was still sitting there a month later, and denying it again changed nothing. Same for a
 * request whose author was removed from the organism. The decision is written down now; a record
 * without one is old, and falls back to the grant it either has or does not.
 */
export function requestStatus(v: { status?: string }, requester: string, roles: Map<string, unknown>): string {
    if (v.status === 'approved' || v.status === 'denied' || v.status === 'withdrawn') return v.status;
    return roles.has(requester) ? 'approved' : 'pending';
}

/**
 * Write the outcome onto the request record. The record is OWNED by the requester (their namespace,
 * their key), and the person deciding is somebody else, so this is a server-side write that keeps
 * the owner: the status is the node's answer about organism plumbing, not a claim the requester made
 * about themselves. Returns false when there is no request to decide, which a direct grant produces.
 */
export async function recordRequestDecision(
    storage: Storage, orgId: string, ws: string, requester: string,
    status: 'approved' | 'denied' | 'withdrawn', decidedBy: string,
): Promise<boolean> {
    const key = `organism.${orgId}.w.${ws}.access.request.${requester}`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
    const rec = items.find(r => r.key === key);
    if (!rec) return false;
    const now = new Date().toISOString();
    await storage.setMemory({
        ...rec,
        value: { ...(rec.value as Record<string, unknown>), status, decidedBy, decidedAt: now },
        updatedAt: now,
    });
    return true;
}

/**
 * Approve or deny one access request. Grants are owned by the WORKSPACE CREATOR (not the deciding
 * admin), so reads resolve via the creator who owns the content. Approve assigns `role` (default
 * contributor); deny revokes every workspace-role grant for the requester. Who may decide is the
 * caller's question: the workspace's creator or an organism admin.
 */
export async function decideAccessRequest(
    deps: { storage: Storage; config: AimeatConfig },
    args: { orgId: string; ws: string; wsName: string; creator: string; requester: string; decision: 'approve' | 'deny'; role?: WsRole; decidedBy: string },
): Promise<{ status: 'approved'; role: WsRole } | { status: 'denied' }> {
    const { storage, config } = deps;
    const { orgId, ws, wsName, creator, requester, decidedBy } = args;
    const creatorGhii = `${creator}@${config.nodeId}`;
    if (args.decision === 'approve') {
        const role: WsRole = args.role === 'viewer' ? 'viewer' : 'contributor';
        await grantWorkspaceRole(storage, config, { creatorGhii, orgId, ws, grantee: requester, role, source: 'request', grantedBy: decidedBy });
        await recordRequestDecision(storage, orgId, ws, requester, 'approved', decidedBy);
        await notify(storage, `${requester}@${config.nodeId}`, {
            type: 'workspace_access_approved',
            title: `Your access to "${wsName}" was approved (${role})`,
            link: '/v1/profile#organisms',
            i18n: { key: 'workspace_access_approved', vars: { ws: wsName, role } },
        });
        emitChange('notifications');
        emitChange('organisms');
        return { status: 'approved', role };
    }
    await revokeWorkspaceRole(storage, config, { creatorGhii, orgId, ws, grantee: requester });
    // Without this the denial had nowhere to live: no grant is exactly what "never asked" looks
    // like, so the request came straight back to the reviewer's panel as pending.
    await recordRequestDecision(storage, orgId, ws, requester, 'denied', decidedBy);
    await notify(storage, `${requester}@${config.nodeId}`, {
        type: 'workspace_access_denied',
        title: `Your access request to "${wsName}" was declined`,
        link: '/v1/profile#organisms',
        i18n: { key: 'workspace_access_denied', vars: { ws: wsName } },
    });
    emitChange('notifications');
    emitChange('organisms');
    return { status: 'denied' };
}
