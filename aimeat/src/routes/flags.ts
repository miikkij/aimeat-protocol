/**
 * @file src/routes/flags.ts
 * @description Content-flagging (moderation report) API. Lets authenticated principals flag
 *   memory, board posts, actions, or agents with a reason, and moderators review flags —
 *   resolving organism-scoped moderation config when a flagged memory key belongs to an organism.
 *
 * @structure
 *   - VALID_REVIEW_STATUSES: the statuses a reviewer may set
 *   - flagsRouter(config, storage): POST /v1/flags plus flag listing/review routes
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-08-11 — The flag write moves to services/moderation-flags.ts, which the MCP tool
 *     now calls too (August 2026 audit step 8). The valid target types and reasons, the organism
 *     lookup and the auto-hide weighting come from there; this file renders the HTTP answer.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { FlagCreateSchema, validateBody } from '../models/schemas.js';
import {
    FLAG_TARGET_TYPES,
    createModerationFlag,
    resolveOrganismForFlag,
} from '../services/moderation-flags.js';

const VALID_REVIEW_STATUSES = ['dismissed', 'actioned'] as const;

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

export function flagsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // ── POST /v1/flags — Create a flag (auth required) ──
    // validateBody rejects a malformed body with the zod detail an HTTP client expects; everything
    // the flag itself decides is in createModerationFlag, which the MCP tool calls too.
    router.post('/v1/flags', requireAuth(), validateBody(FlagCreateSchema, config.nodeId), async (req, res) => {
        const { targetType, targetId, reason, description } = req.body ?? {};

        const out = await createModerationFlag({ storage, config }, req.auth!.sub, {
            targetType, targetId, reason, description,
        });
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }

        res.status(201).json(success(config.nodeId, { ...out.flag, hidden: out.hidden }, [
            { description: 'View flag summary for this target', method: 'GET', url: `/v1/flags/summary/${targetType}/${targetId}` },
            ...(out.hidden ? [{ description: 'Appeal this flag', method: 'POST', url: `/v1/flags/${out.flag.id}/appeal` }] : []),
        ]));
    });

    // ── GET /v1/flags/summary/:targetType/:targetId — Public flag summary (Tier 0) ──
    // Must be registered before parameterized /:id route
    router.get('/v1/flags/summary/:targetType/:targetId', async (req, res) => {
        const targetType = param(req.params.targetType);
        const targetId = param(req.params.targetId);

        if (!(FLAG_TARGET_TYPES as readonly string[]).includes(targetType)) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
                `Invalid targetType: "${targetType}". Must be one of: ${FLAG_TARGET_TYPES.join(', ')}`));
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
        const organism = await resolveOrganismForFlag(storage, targetType, targetId);
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
            const organism = await resolveOrganismForFlag(storage, existing.targetType, existing.targetId);
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
