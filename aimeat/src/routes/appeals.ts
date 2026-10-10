/**
 * @file src/routes/appeals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Moderation appeals API. Lets a content owner appeal a flag against their
 *   content, lists appeals, and lets moderators review (dismiss/action) them. Resolves the
 *   flagged content's owner across memory, board posts, actions, and agents.
 *
 * @structure
 *   - getContentOwner(storage, targetType, targetId): resolves owning GAII/GHII of flagged content
 *   - appealsRouter(config, storage): POST /v1/flags/:flagId/appeal, GET /v1/appeals, POST /v1/appeals/:id/review
 *
 * @version-history
 *   v1.2.1 — 2026-10-10 — POST /v1/flags/:flagId/appeal decides operator admission with isOperatorCaller and writes the operator trail only after the ALREADY_APPEALED check, so a refused second appeal leaves no operator_acted event (secaudit 2026-10-10 I5).
 *   v1.2.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2).
 *   2026-09-08 — Two identities read in the wrong alphabet: the organism-admin arms compared
 *     admins[] (bare owner names) to a GHII and never matched, and a memory flag's `gaii::key`
 *     target was looked up whole as a key, so the record's owner could not appeal. Both found by
 *     e2e-appeals the first day the routes were driven.
 *   Appeal reason limit 1 000 → 10 000 — 2026-07-30 — the gate was tighter than the spec promised (2 000).
 *   v1.1.0 — 2026-07-16 — review response reads the related flag once (was getFlag twice in one hint)
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity } from '../utils/gaii.js';
import { isOperatorCaller, operatorOverride } from '../services/operator-override.js';

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

/**
 * Determine the content owner for a flagged target.
 * Returns the GAII/GHII of whoever owns the flagged content.
 */
async function getContentOwner(
    storage: Storage,
    targetType: string,
    targetId: string,
): Promise<string | null> {
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

export function appealsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // ── POST /v1/flags/:flagId/appeal — Content owner appeals a flag ──
    router.post('/v1/flags/:flagId/appeal', requireAuth(), async (req, res) => {
        const flagId = param(req.params.flagId);
        const { reason } = req.body ?? {};

        // Validate reason
        if (!reason || typeof reason !== 'string') {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'reason is required'));
            return;
        }

        if (reason.length > 10_000) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'reason must be 10000 characters or fewer'));
            return;
        }

        // Look up the flag
        const flag = await storage.getFlag(flagId);
        if (!flag) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Flag not found: ${flagId}`));
            return;
        }

        // Verify the caller is the content owner. An owner session's `sub` is the bare account
        // name while memory is owned by the GHII, so the resolved identity is compared as well.
        const caller = req.auth!.sub;
        const contentOwner = await getContentOwner(storage, flag.targetType, flag.targetId);

        // Also check by owner name (for owner-level tokens)
        const callerOwner = req.auth!.owner;
        let isOwner = contentOwner === caller || contentOwner === resolveIdentity(req.auth!, config.nodeId);

        // If content owner is an agent GAII, check if the caller's owner matches the agent's owner
        if (!isOwner && contentOwner) {
            const agent = await storage.getAgent(contentOwner);
            if (agent && agent.owner === callerOwner) {
                isOwner = true;
            }
        }

        // Operators can also appeal on behalf of content owners. Admission is decided here without a
        // write; the operator trail is written only once the appeal is going to be created, so a
        // refused attempt (409 below) leaves none (secaudit 2026-10-10 I5).
        if (!isOwner && !(await isOperatorCaller(storage, req.auth))) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
                'Only the content owner can appeal a flag'));
            return;
        }

        // Check if already appealed. Asked after the ownership check, so a non-owner never learns
        // that an appeal exists.
        const existing = await storage.getAppealByFlagId(flagId);
        if (existing) {
            res.status(409).json(error(config.nodeId, 'ALREADY_APPEALED',
                'This flag has already been appealed'));
            return;
        }

        // An operator's appeal for content whose owner is known writes the operator trail in that
        // owner's account; with no owner found, there is no account to write it in.
        if (!isOwner && contentOwner
            && !(await operatorOverride(storage, config, req.auth, { ownerOf: contentOwner, area: 'appeal', action: 'create', subject: flagId }))) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
                'Only the content owner can appeal a flag'));
            return;
        }

        const now = new Date().toISOString();
        const id = `appeal-${randomBytes(8).toString('hex')}`;

        const appeal = await storage.createAppeal({
            id,
            flagId,
            appealedBy: caller,
            reason,
            status: 'pending',
            createdAt: now,
        });

        res.status(201).json(success(config.nodeId, appeal, [
            { description: 'View all appeals', method: 'GET', url: '/v1/appeals' },
        ]));
        emitChange('appeals');
    });

    // ── GET /v1/appeals — List appeals (operator sees all; organism admin sees their organism's) ──
    router.get('/v1/appeals', requireAuth(), async (req, res) => {
        const status = req.query.status as string | undefined;
        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string, 10) || 20));

        const isOperator = await isOperatorCaller(storage, req.auth);

        // Resolve caller's GHII for organism admin check
        let callerGhii: string | null = null;
        if (!isOperator) {
            const ghiiRecord = await storage.getGHIIByOwner(req.auth!.owner);
            callerGhii = ghiiRecord?.ghii ?? null;
        }

        // Find organism IDs where the caller is an admin
        let adminOrgIds: Set<string> | null = null;
        if (!isOperator && callerGhii) {
            adminOrgIds = new Set<string>();
            const allOrganisms = await storage.listOrganisms();
            for (const org of allOrganisms) {
                // admins[] holds the bare owner name everywhere it is written (organism-lifecycle,
                // membership, workspace-access); comparing it to the GHII alone matched nothing, so
                // the organism-admin arm was unreachable until 2026-09-08 (e2e-appeals).
                if (org.admins.includes(callerGhii) || org.admins.includes(req.auth!.owner as string)) {
                    adminOrgIds.add(org.id);
                }
            }
        }

        // Must be operator or admin of at least one organism
        if (!isOperator && (!adminOrgIds || adminOrgIds.size === 0)) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                'Only operators or organism admins can list appeals'));
            return;
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
                    if (orgMatch && adminOrgIds.has(orgMatch[1])) {
                        filtered.push(appeal);
                    }
                }
            }
        }

        const total = filtered.length;

        // Apply pagination manually
        const start = (page - 1) * perPage;
        const appeals = filtered.slice(start, start + perPage);

        res.json(success(config.nodeId, { appeals, total }, [
            { description: 'Review an appeal', method: 'POST', url: '/v1/appeals/{id}/review' },
        ], { page, per_page: perPage, total }));
    });

    // ── POST /v1/appeals/:id/review — Review an appeal (operator or organism admin) ──
    router.post('/v1/appeals/:id/review', requireAuth(), async (req, res) => {
        const id = param(req.params.id);
        const { decision, note } = req.body ?? {};

        // Validate decision
        if (!decision || !['upheld', 'overturned'].includes(decision)) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
                'decision is required and must be "upheld" or "overturned"'));
            return;
        }

        // Look up the appeal
        const appeal = await storage.getAppeal(id);
        if (!appeal) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Appeal not found: ${id}`));
            return;
        }

        // Phase 2.4 — Allow organism admins to review appeals for their organism's content
        const isOperator = await isOperatorCaller(storage, req.auth);
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
                        const ghiiRecord = await storage.getGHIIByOwner(req.auth!.owner);
                        if (organism.admins.includes(req.auth!.owner as string)
                            || (ghiiRecord && organism.admins.includes(ghiiRecord.ghii))) {
                            isOrganismAdmin = true;
                        }
                    }
                }
            }
        }

        if (!isOperator && !isOrganismAdmin) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                'Only operators or organism admins can review appeals'));
            return;
        }

        // Must be pending
        if (appeal.status !== 'pending') {
            res.status(409).json(error(config.nodeId, 'ALREADY_REVIEWED',
                `Appeal has already been reviewed with decision: ${appeal.status}`));
            return;
        }

        const now = new Date().toISOString();
        const reviewer = req.auth!.sub;

        if (decision === 'overturned') {
            // Flag status -> "dismissed", content is restored
            await storage.updateFlag(appeal.flagId, {
                status: 'dismissed',
                reviewedBy: reviewer,
                reviewedAt: now,
            });
        }
        // If "upheld", the flag stays active (content remains hidden)

        const updated = await storage.updateAppeal(id, {
            status: decision,
            reviewedBy: reviewer,
            reviewNote: note ?? undefined,
            reviewedAt: now,
        });

        const relatedFlag = await storage.getFlag(appeal.flagId);
        res.json(success(config.nodeId, updated, [
            { description: 'View all appeals', method: 'GET', url: '/v1/appeals' },
            { description: 'View the related flag', method: 'GET', url: `/v1/flags/summary/${relatedFlag?.targetType}/${relatedFlag?.targetId}` },
        ]));
        emitChange('appeals');
    });

    return router;
}
