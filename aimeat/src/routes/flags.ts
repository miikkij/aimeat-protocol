/**
 * @file src/routes/flags.ts
 * @description Content-flagging (moderation report) API. Lets authenticated principals flag
 *   memory, board posts, actions, or agents with a reason, and moderators review flags —
 *   resolving organism-scoped moderation config when a flagged memory key belongs to an organism.
 *
 * @structure
 *   - VALID_TARGET_TYPES / VALID_REASONS / VALID_REVIEW_STATUSES: input enums
 *   - resolveOrganismConfig(): derives organism moderation settings from a flagged memory key
 *   - flagsRouter(config, storage): POST /v1/flags plus flag listing/review routes
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { FlagCreateSchema, validateBody } from '../models/schemas.js';
import { logger } from '../utils/logger.js';

const VALID_TARGET_TYPES = ['memory', 'board_post', 'action', 'agent'] as const;
const VALID_REASONS = ['unreliable', 'inappropriate', 'illegal', 'spam', 'other'] as const;
const VALID_REVIEW_STATUSES = ['dismissed', 'actioned'] as const;

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

// Phase 2.4 — DRY helper: resolve organism moderation config from flag target
async function resolveOrganismConfig(storage: Storage, targetType: string, targetId: string) {
    if (targetType !== 'memory' || !targetId.includes('::')) return null;
    const [, ...keyParts] = targetId.split('::');
    const memoryKey = keyParts.join('::');
    const orgMatch = memoryKey.match(/^organism\.([^.]+)\./);
    if (!orgMatch) return null;
    return storage.getOrganism(orgMatch[1]);
}

export function flagsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // ── POST /v1/flags — Create a flag (auth required) ──
    router.post('/v1/flags', requireAuth(), validateBody(FlagCreateSchema, config.nodeId), async (req, res) => {
        const { targetType, targetId, reason, description } = req.body ?? {};

        // Validate required fields
        if (!targetType || !targetId || !reason) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing required fields: targetType, targetId, reason'));
            return;
        }

        // Validate targetType
        if (!(VALID_TARGET_TYPES as readonly string[]).includes(targetType)) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
                `Invalid targetType: "${targetType}". Must be one of: ${VALID_TARGET_TYPES.join(', ')}`));
            return;
        }

        // Validate reason
        if (!(VALID_REASONS as readonly string[]).includes(reason)) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
                `Invalid reason: "${reason}". Must be one of: ${VALID_REASONS.join(', ')}`));
            return;
        }

        const flaggedBy = req.auth!.sub;

        // Check if already flagged by same user
        const existing = await storage.getFlagByUser(targetType, targetId, flaggedBy);
        if (existing) {
            res.status(409).json(error(config.nodeId, 'ALREADY_FLAGGED', 'You have already flagged this target'));
            return;
        }

        // Phase 2.4 — Check organism moderation config if target is organism memory
        const organism = await resolveOrganismConfig(storage, targetType, targetId);
        if (organism && !organism.moderationConfig.flagsEnabled) {
            res.status(403).json(error(config.nodeId, 'FLAGS_DISABLED',
                'Flagging is disabled for this organism\'s content'));
            return;
        }

        const now = new Date().toISOString();
        const id = `flag-${randomBytes(8).toString('hex')}`;

        const flag = await storage.createFlag({
            id,
            targetType,
            targetId,
            flaggedBy,
            reason,
            description: description ?? undefined,
            status: 'active',
            createdAt: now,
        });

        // Increment flagCount on the associated memory record
        if (targetType === 'memory') {
            try {
                if (targetId.includes('::')) {
                    const [ownerGaii, ...keyParts] = targetId.split('::');
                    const key = keyParts.join('::');
                    await storage.incrementMemoryFlagCount(ownerGaii, key);
                }
            } catch (err) {
                // Flag creation still succeeds even if memory increment fails
              logger.warn('POST /v1/flags: continuing after a suppressed failure', { error: String(err) });
            }
        }

        // Phase 2.4 — Auto-hide: use per-organism threshold if applicable
        // SECURITY P3-11: Weight flags by reporter's trust score and account age
        const activeFlags = await storage.getFlagsByTarget(targetType, targetId);
        let weightedFlagCount = 0;
        for (const f of activeFlags) {
            if (f.status !== 'active') continue;
            const reporter = await storage.getAgent(f.flaggedBy);
            if (!reporter) { weightedFlagCount += 0.5; continue; }
            const trustFactor = Math.max(0.1, (reporter.trustScore ?? 50) / 100);
            const owner = await storage.getOwner(reporter.owner);
            const ageDays = owner ? Math.floor((Date.now() - new Date(owner.createdAt).getTime()) / 86_400_000) : 0;
            const ageFactor = Math.min(1, ageDays / 30); // Full weight after 30 days
            weightedFlagCount += Math.max(0.1, trustFactor * Math.max(0.2, ageFactor));
        }
        const autoHideThreshold = organism
            ? organism.moderationConfig.autoHideThreshold
            : config.autoHideThreshold;
        const hidden = weightedFlagCount >= autoHideThreshold;

        res.status(201).json(success(config.nodeId, { ...flag, hidden }, [
            { description: 'View flag summary for this target', method: 'GET', url: `/v1/flags/summary/${targetType}/${targetId}` },
            ...(hidden ? [{ description: 'Appeal this flag', method: 'POST', url: `/v1/flags/${id}/appeal` }] : []),
        ]));
        emitChange('flags');
    });

    // ── GET /v1/flags/summary/:targetType/:targetId — Public flag summary (Tier 0) ──
    // Must be registered before parameterized /:id route
    router.get('/v1/flags/summary/:targetType/:targetId', async (req, res) => {
        const targetType = param(req.params.targetType);
        const targetId = param(req.params.targetId);

        if (!(VALID_TARGET_TYPES as readonly string[]).includes(targetType)) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
                `Invalid targetType: "${targetType}". Must be one of: ${VALID_TARGET_TYPES.join(', ')}`));
            return;
        }

        const summary = await storage.getFlagSummary(targetType, targetId);

        if (!summary) {
            res.json(success(config.nodeId, {
                targetType,
                targetId,
                totalFlags: 0,
                byReason: {},
                latestFlag: null,
                hidden: false,
            }));
            return;
        }

        // Phase 2.4 — include hidden status based on active flag count (per-organism threshold)
        const activeFlags = await storage.getFlagsByTarget(targetType, targetId);
        const activeFlagCount = activeFlags.filter(f => f.status === 'active').length;
        const organism = await resolveOrganismConfig(storage, targetType, targetId);
        const autoHideThreshold = organism
            ? organism.moderationConfig.autoHideThreshold
            : config.autoHideThreshold;
        const hidden = activeFlagCount >= autoHideThreshold;

        res.json(success(config.nodeId, { ...summary, hidden }));
    });

    // ── GET /v1/flags — List flags (operator only) ──
    router.get('/v1/flags', requireAuth(), requireRole('operator'), async (req, res) => {
        const status = req.query.status as string | undefined;
        const targetType = req.query.targetType as string | undefined;
        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string, 10) || 20));

        const flags = await storage.listFlags({ status, targetType, page, perPage });

        res.json(success(config.nodeId, flags, [
            { description: 'Create a new flag', method: 'POST', url: '/v1/flags' },
        ], { page, per_page: perPage }));
    });

    // ── PUT /v1/flags/:id — Update flag status (operator or organism admin) ──
    router.put('/v1/flags/:id', requireAuth(), async (req, res) => {
        const id = param(req.params.id);
        const { status: newStatus } = req.body ?? {};

        if (!newStatus || !(VALID_REVIEW_STATUSES as readonly string[]).includes(newStatus)) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
                `Invalid status. Must be one of: ${VALID_REVIEW_STATUSES.join(', ')}`));
            return;
        }

        const existing = await storage.getFlag(id);
        if (!existing) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Flag not found: ${id}`));
            return;
        }

        // Phase 2.4 — Allow organism admins to moderate flags within their organism
        const isOperator = req.auth!.roles.includes('operator');
        let isOrganismAdmin = false;
        if (!isOperator) {
            const organism = await resolveOrganismConfig(storage, existing.targetType, existing.targetId);
            if (organism) {
                const ghiiRecord = await storage.getGHIIByOwner(req.auth!.owner);
                if (ghiiRecord && organism.admins.includes(ghiiRecord.ghii)) {
                    isOrganismAdmin = true;
                }
            }
        }

        if (!isOperator && !isOrganismAdmin) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                'Only operators or organism admins can moderate flags'));
            return;
        }

        const now = new Date().toISOString();
        const updated = await storage.updateFlag(id, {
            status: newStatus,
            reviewedBy: req.auth!.sub,
            reviewedAt: now,
        });

        res.json(success(config.nodeId, updated, [
            { description: 'View all flags', method: 'GET', url: '/v1/flags' },
            { description: 'View flag summary for this target', method: 'GET', url: `/v1/flags/summary/${existing.targetType}/${existing.targetId}` },
        ]));
        emitChange('flags');
    });

    return router;
}
