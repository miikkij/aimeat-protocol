import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

const VALID_TARGET_TYPES = ['memory', 'board_post', 'action', 'agent'] as const;
const VALID_REASONS = ['unreliable', 'inappropriate', 'illegal', 'spam', 'other'] as const;
const VALID_REVIEW_STATUSES = ['dismissed', 'actioned'] as const;

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

export function flagsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // ── POST /v1/flags — Create a flag (auth required) ──
    router.post('/v1/flags', requireAuth(), async (req, res) => {
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

        // Phase 2.4 — Auto-hide: check flag count against threshold
        const AUTO_HIDE_THRESHOLD = 5;
        const activeFlags = await storage.getFlagsByTarget(targetType, targetId);
        const activeFlagCount = activeFlags.filter(f => f.status === 'active').length;
        const hidden = activeFlagCount >= AUTO_HIDE_THRESHOLD;

        res.status(201).json(success(config.nodeId, { ...flag, hidden }, [
            { description: 'View flag summary for this target', method: 'GET', url: `/v1/flags/summary/${targetType}/${targetId}` },
            ...(hidden ? [{ description: 'Appeal this flag', method: 'POST', url: `/v1/flags/${id}/appeal` }] : []),
        ]));
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

        // Phase 2.4 — include hidden status based on active flag count
        const AUTO_HIDE_THRESHOLD = 5;
        const activeFlags = await storage.getFlagsByTarget(targetType, targetId);
        const activeFlagCount = activeFlags.filter(f => f.status === 'active').length;
        const hidden = activeFlagCount >= AUTO_HIDE_THRESHOLD;

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

    // ── PUT /v1/flags/:id — Update flag status (operator only) ──
    router.put('/v1/flags/:id', requireAuth(), requireRole('operator'), async (req, res) => {
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
    });

    return router;
}
