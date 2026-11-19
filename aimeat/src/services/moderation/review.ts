/**
 * @file src/services/moderation/review.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The moderation review: the flags waiting for a decision, a decision on one, the
 *   content owner's appeal against a flag, the appeals a moderator decides, and a decision on one.
 *   GET /v1/flags, PUT /v1/flags/:id, POST /v1/flags/:flagId/appeal, GET /v1/appeals and POST
 *   /v1/appeals/:id/review run these functions, and so do the MCP tools aimeat_admin_flags,
 *   aimeat_admin_flag_review, aimeat_flag_appeal, aimeat_appeals and aimeat_appeal_review. Moved out
 *   of routes/flags.ts and routes/appeals.ts unchanged, so both surfaces decide who may act in one
 *   place.
 *
 *   WHO DECIDES. A flag: the operator (in person, or their agent holding operator:admin), or an
 *   organism admin in person for content inside the organism; never an admin's agent. An appeal:
 *   the content's owner or one of the owner's agents, or the operator. An appeal's decision: the
 *   operator, or the organism's creator or an admin, in person or through one of their own agents
 *   (services/archive.ts archiveRoleOf); an agent attached to the organism decides nothing.
 * @structure ModerationAuth · Refusal · listFlagsForReview · reviewFlag · getContentOwner ·
 *   appealFlag · listAppealsFor · reviewAppeal
 * @usage
 *   const out = await reviewAppeal({ storage, config }, req.auth!, id, { decision, note });
 *   if (!out.ok) res.status(out.status).json(error(config.nodeId, out.code, out.message));
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: moved out of routes/flags.ts and routes/appeals.ts for the MCP
 *     tools (feature audit 2026-11-19, 4.4 item 3).
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { resolveIdentity, isForeignPrincipal } from '../../utils/gaii.js';
import { isOwnerPrincipal } from '../../auth/account-security.js';
import { isOperatorCaller, operatorOverride } from '../operator/override.js';
import { archiveRoleOf } from '../archive.js';
import { resolveOrganismForFlag } from '../moderation-flags.js';

/** The caller as a token carries it: what req.auth and an MCP session's caller().auth both hold. */
export interface ModerationAuth {
    sub: string;
    owner: string;
    roles: string[];
    scopes?: string[];
    federated?: boolean;
    anonymous?: boolean;
}
interface Deps { storage: Storage; config: AimeatConfig }
export interface Refusal { ok: false; status: number; code: string; message: string }
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

export const VALID_REVIEW_STATUSES = ['dismissed', 'actioned'] as const;

/** The page of a list: page 1 and 20 a page unless asked, at most 100. */
export function pageOf(pageIn: unknown, perPageIn: unknown): { page: number; perPage: number } {
    const page = Math.max(1, parseInt(String(pageIn ?? ''), 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(String(perPageIn ?? ''), 10) || 20));
    return { page, perPage };
}

/** Every flag, filtered by status and target type. The route's operator gate admits the caller. */
export async function listFlagsForReview(
    storage: Storage, filter: { status?: string; targetType?: string; page: number; perPage: number },
) {
    return storage.listFlags(filter);
}

/** Decide one flag: dismissed (the content shows again) or actioned. */
export async function reviewFlag(deps: Deps, auth: ModerationAuth, id: string, newStatus: unknown) {
    const { storage } = deps;
    if (!newStatus || typeof newStatus !== 'string' || !(VALID_REVIEW_STATUSES as readonly string[]).includes(newStatus)) {
        return refuse(400, 'VALIDATION_ERROR', `Invalid status. Must be one of: ${VALID_REVIEW_STATUSES.join(', ')}`);
    }
    const existing = await storage.getFlag(id);
    if (!existing) return refuse(404, 'NOT_FOUND', `Flag not found: ${id}`);

    // Phase 2.4 — Allow organism admins to moderate flags within their organism
    //
    // THE ADMIN PATH ASKS WHO IS CALLING, not whose name the call carries. It read the GHII from
    // `req.auth.owner`, which every principal acting for that person carries — so the admin's
    // own agent, holding no scope for this and never granted it, moderated in their name, and a
    // visitor signed in from another node under the same name did too, on a door whose only
    // gate is requireAuth(). The owner name is not a principal (invariant 11). Found by the AI
    // triage of 2026-09-13.
    // Moderating a flag is the node's moderation work, not an act in one person's account, so
    // the operator check writes no trail.
    const isOperator = await isOperatorCaller(storage, auth);
    let isOrganismAdmin = false;
    if (!isOperator && isOwnerPrincipal(auth) && !isForeignPrincipal(auth)) {
        const organism = await resolveOrganismForFlag(storage, existing.targetType, existing.targetId);
        if (organism) {
            // admins[] holds the bare owner name everywhere it is written (organism-lifecycle,
            // membership, workspace-access), so the comparison with the GHII alone matched nobody
            // and an organism admin got 403 here until 2026-10-16. The bare name is safe to
            // compare only because the principal test above has already refused an agent, an app,
            // an ecosystem principal and a visitor from another node. The GHII form stays for a
            // record written in that form; the appeal review asks the same two questions.
            const ghiiRecord = await storage.getGHIIByOwner(auth.owner);
            if (organism.admins.includes(auth.owner)
                || (ghiiRecord && organism.admins.includes(ghiiRecord.ghii))) {
                isOrganismAdmin = true;
            }
        }
    }
    if (!isOperator && !isOrganismAdmin) return refuse(403, 'FORBIDDEN', 'Only operators or organism admins can moderate flags');

    const now = new Date().toISOString();
    const updated = await storage.updateFlag(id, { status: newStatus as typeof VALID_REVIEW_STATUSES[number], reviewedBy: auth.sub, reviewedAt: now });
    return { ok: true as const, flag: updated, existing };
}

/**
 * Determine the content owner for a flagged target.
 * Returns the GAII/GHII of whoever owns the flagged content.
 */
export async function getContentOwner(storage: Storage, targetType: string, targetId: string): Promise<string | null> {
    switch (targetType) {
        case 'memory': {
            // A flag on memory carries `${ownerGaii}::${key}` (that is what POST /v1/flags stores),
            // and until 2026-09-08 the whole string was looked up as a key, so the owner of the
            // flagged record was never found and could not appeal (e2e-appeals). A bare key is
            // still accepted and searched across every agent.
            if (targetId.includes('::')) {
                const sep = targetId.indexOf('::');
                const direct = await storage.getMemory(targetId.slice(0, sep), targetId.slice(sep + 2));
                if (direct) return direct.ownerGaii;
            }
            const agents = await storage.listAgents();
            for (const agent of agents) {
                const mem = await storage.getMemory(agent.gaii, targetId);
                if (mem) return mem.ownerGaii;
            }
            return null;
        }
        case 'board_post': {
            // targetId could be "boardId::postId" or just postId
            // Try to find by iterating boards
            const boards = await storage.listBoards();
            for (const board of boards) {
                const post = await storage.getPost(board.id, targetId);
                if (post) return post.authorGaii;
            }
            return null;
        }
        case 'action': {
            // Actions are keyed by `${providerGaii}::${id}` in storage
            // Try to find via listing
            const actions = await storage.listActions();
            for (const action of actions) {
                if (action.id === targetId) return action.providerGaii;
            }
            return null;
        }
        case 'agent': {
            const agent = await storage.getAgent(targetId);
            return agent ? agent.gaii : null;
        }
        default:
            return null;
    }
}

/** The content owner appeals a flag against their content, once. */
export async function appealFlag(deps: Deps, auth: ModerationAuth, flagId: string, reason: unknown) {
    const { storage, config } = deps;
    if (!reason || typeof reason !== 'string') return refuse(400, 'VALIDATION_ERROR', 'reason is required');
    if (reason.length > 10_000) return refuse(400, 'VALIDATION_ERROR', 'reason must be 10000 characters or fewer');

    const flag = await storage.getFlag(flagId);
    if (!flag) return refuse(404, 'NOT_FOUND', `Flag not found: ${flagId}`);

    // Verify the caller is the content owner. An owner session's `sub` is the bare account
    // name while memory is owned by the GHII, so the resolved identity is compared as well.
    const caller = auth.sub;
    const contentOwner = await getContentOwner(storage, flag.targetType, flag.targetId);

    // Also check by owner name (for owner-level tokens)
    const callerOwner = auth.owner;
    let isOwner = contentOwner === caller || contentOwner === resolveIdentity(auth, config.nodeId);

    // If content owner is an agent GAII, check if the caller's owner matches the agent's owner
    if (!isOwner && contentOwner) {
        const agent = await storage.getAgent(contentOwner);
        if (agent && agent.owner === callerOwner) isOwner = true;
    }

    // Operators can also appeal on behalf of content owners. Admission is decided here without a
    // write; the operator trail is written only once the appeal is going to be created, so a
    // refused attempt (409 below) leaves none (secaudit 2026-10-10 I5).
    if (!isOwner && !(await isOperatorCaller(storage, auth))) {
        return refuse(403, 'ACCESS_DENIED', 'Only the content owner can appeal a flag');
    }

    // Check if already appealed. Asked after the ownership check, so a non-owner never learns
    // that an appeal exists.
    const existing = await storage.getAppealByFlagId(flagId);
    if (existing) return refuse(409, 'ALREADY_APPEALED', 'This flag has already been appealed');

    // An operator's appeal for content whose owner is known writes the operator trail in that
    // owner's account; with no owner found, there is no account to write it in.
    if (!isOwner && contentOwner
        && !(await operatorOverride(storage, config, auth, { ownerOf: contentOwner, area: 'appeal', action: 'create', subject: flagId }))) {
        return refuse(403, 'ACCESS_DENIED', 'Only the content owner can appeal a flag');
    }

    const appeal = await storage.createAppeal({
        id: `appeal-${randomBytes(8).toString('hex')}`,
        flagId,
        appealedBy: caller,
        reason,
        status: 'pending',
        createdAt: new Date().toISOString(),
    });
    return { ok: true as const, appeal };
}

/** The appeals the caller decides: every one for the operator, an organism's for its creator or admins. */
export async function listAppealsFor(deps: Deps, auth: ModerationAuth, query: { status?: string; page: number; perPage: number }) {
    const { storage, config } = deps;
    const { status, page, perPage } = query;
    const isOperator = await isOperatorCaller(storage, auth);

    // Find the organisms whose appeals the caller decides: the creator or an admin, in person or
    // through one of their own agents, by the rule the review and archiving ask (services/archive.ts
    // archiveRoleOf). An agent attached to the organism is a member there and sees none. The list
    // read organism.admins for the owner name alone until 2026-10-16 (Jouni, 2026-10-16).
    let adminOrgIds: Set<string> | null = null;
    if (!isOperator) {
        adminOrgIds = new Set<string>();
        const principal = resolveIdentity(auth, config.nodeId);
        // The owner's memberships name the candidate organisms; archiveRoleOf decides the role.
        for (const m of await storage.listMembershipsByGhii(auth.owner)) {
            if (adminOrgIds.has(m.organismId)) continue;
            const org = await storage.getOrganism(m.organismId);
            if (!org) continue;
            const role = await archiveRoleOf(storage, org, { principal, ownerName: auth.owner });
            if (role === 'creator' || role === 'admin') adminOrgIds.add(org.id);
        }
    }

    // Must be operator or admin of at least one organism
    if (!isOperator && (!adminOrgIds || adminOrgIds.size === 0)) {
        return refuse(403, 'FORBIDDEN', 'Only operators or organism admins can list appeals');
    }

    // Fetch all appeals matching status filter
    const allAppeals = await storage.listAppeals({ status, page: 1, perPage: 10000 });

    // If organism admin (not operator), filter to appeals for their organism's content
    let filtered = allAppeals;
    if (!isOperator && adminOrgIds) {
        filtered = [];
        for (const appeal of allAppeals) {
            const flag = await storage.getFlag(appeal.flagId);
            if (!flag) continue;
            // Check if the flag targets content in an organism the caller admins
            if (flag.targetType === 'memory' && flag.targetId.includes('::')) {
                const [, ...keyParts] = flag.targetId.split('::');
                const memoryKey = keyParts.join('::');
                const orgMatch = memoryKey.match(/^organism\.([^.]+)\./);
                if (orgMatch && adminOrgIds.has(orgMatch[1])) filtered.push(appeal);
            }
        }
    }

    // Apply pagination manually
    const start = (page - 1) * perPage;
    return { ok: true as const, appeals: filtered.slice(start, start + perPage), total: filtered.length };
}

/** Decide one appeal: upheld (the flag stays) or overturned (the flag is dismissed, the content shows). */
export async function reviewAppeal(deps: Deps, auth: ModerationAuth, id: string, body: { decision?: unknown; note?: unknown }) {
    const { storage, config } = deps;
    const { decision, note } = body;
    if (!decision || typeof decision !== 'string' || !['upheld', 'overturned'].includes(decision)) {
        return refuse(400, 'VALIDATION_ERROR', 'decision is required and must be "upheld" or "overturned"');
    }
    const appeal = await storage.getAppeal(id);
    if (!appeal) return refuse(404, 'NOT_FOUND', `Appeal not found: ${id}`);

    // The organism's creator or an admin reviews an appeal on that organism's content, in person or
    // through one of their own agents, by the rule archiving asks (services/archive.ts
    // archiveRoleOf): an agent attached to the organism is a member there whoever its owner is,
    // and the role is read for the resolved principal, never for the owner name alone. The owner
    // name used to decide it, so an attached agent of an admin decided appeals (Jouni, 2026-10-16).
    const isOperator = await isOperatorCaller(storage, auth);
    let isOrganismAdmin = false;
    if (!isOperator) {
        const flag = await storage.getFlag(appeal.flagId);
        if (flag && flag.targetType === 'memory' && flag.targetId.includes('::')) {
            const [, ...keyParts] = flag.targetId.split('::');
            const memoryKey = keyParts.join('::');
            const orgMatch = memoryKey.match(/^organism\.([^.]+)\./);
            if (orgMatch) {
                const organism = await storage.getOrganism(orgMatch[1]);
                if (organism) {
                    const role = await archiveRoleOf(storage, organism, { principal: resolveIdentity(auth, config.nodeId), ownerName: auth.owner });
                    isOrganismAdmin = role === 'creator' || role === 'admin';
                }
            }
        }
    }
    if (!isOperator && !isOrganismAdmin) return refuse(403, 'FORBIDDEN', 'Only operators or organism admins can review appeals');

    // Must be pending
    if (appeal.status !== 'pending') {
        return refuse(409, 'ALREADY_REVIEWED', `Appeal has already been reviewed with decision: ${appeal.status}`);
    }

    const now = new Date().toISOString();
    const reviewer = auth.sub;
    if (decision === 'overturned') {
        // Flag status -> "dismissed", content is restored
        await storage.updateFlag(appeal.flagId, { status: 'dismissed', reviewedBy: reviewer, reviewedAt: now });
    }
    // If "upheld", the flag stays active (content remains hidden)
    const updated = await storage.updateAppeal(id, {
        status: decision as 'upheld' | 'overturned',
        reviewedBy: reviewer,
        reviewNote: (note as string | undefined) ?? undefined,
        reviewedAt: now,
    });
    const relatedFlag = await storage.getFlag(appeal.flagId);
    return { ok: true as const, appeal: updated, relatedFlag };
}
