/**
 * @file src/routes/flags.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Content-flagging (moderation report) API. Lets authenticated principals flag
 *   memory, board posts, actions, or agents with a reason, and moderators review flags —
 *   resolving organism-scoped moderation config when a flagged memory key belongs to an organism.
 *
 * @structure
 *   - flagsRouter(config, storage): POST /v1/flags plus flag listing/review routes
 *
 * @version-history
 *   2026-11-19 — GET /v1/flags and PUT /v1/flags/:id run services/moderation/review.ts
 *     (listFlagsForReview, reviewFlag), which the MCP tools aimeat_admin_flags and
 *     aimeat_admin_flag_review run too; the review rules and VALID_REVIEW_STATUSES moved there
 *     unchanged (feature audit 2026-11-19, 4.4 item 3).
 *   2026-10-31 — The public summary's `hidden` counts active flags once per reporting account, as the
 *     board hide does (secaudit2026oct31w2 round 10, W2-8).
 *   v1.3.1 — 2026-10-16 — PUT /v1/flags/:id: the organism-admin branch compares admins[] with the bare owner name as well as the GHII. admins[] holds bare names, so the branch matched nobody and an organism admin in person got 403 on their organism's flags (QA audit F13-03, test/e2e-flag-review.ts).
 *   v1.3.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail. The operator routes ask requireOperator (askOperator with operator:admin) (secaudit 2026-10, C2).
 *   v1.2.1 — 2026-09-24 — The federated test is isForeignPrincipal(), the one question (secaudit 2026-09, F-1).
 *   v1.2.0 — 2026-09-14 — The organism-admin path asks which PRINCIPAL is calling, not whose name
 *     the call carries: it read the admin's GHII from `req.auth.owner`, so the admin's own agent
 *     moderated in their name and so did a same-named visitor from another node. Invariant 11.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-08-11 — The flag write moves to services/moderation-flags.ts, which the MCP tool
 *     now calls too (August 2026 audit step 8). The valid target types and reasons, the organism
 *     lookup and the auto-hide weighting come from there; this file renders the HTTP answer.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperator, requireScope } from '../auth/middleware.js';
import { listFlagsForReview, reviewFlag, pageOf } from '../services/moderation/review.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { FlagCreateSchema, validateBody } from '../models/schemas.js';
import {
    FLAG_TARGET_TYPES,
    createModerationFlag,
    resolveOrganismForFlag,
    activeReporterCount,
} from '../services/moderation-flags.js';

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

export function flagsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // ── POST /v1/flags — Create a flag (auth required) ──
    // validateBody rejects a malformed body with the zod detail an HTTP client expects; everything
    // the flag itself decides is in createModerationFlag, which the MCP tool calls too.
    router.post('/v1/flags', requireAuth(), requireScope('social:write'), validateBody(FlagCreateSchema, config.nodeId), async (req, res) => {
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

        // Phase 2.4 — include hidden status based on active flag count (per-organism threshold).
        // Counted once per reporting account, as the board hide enforces it (W2-8).
        const activeFlags = await storage.getFlagsByTarget(targetType, targetId);
        const activeFlagCount = activeReporterCount(activeFlags, config.nodeId);
        const organism = await resolveOrganismForFlag(storage, targetType, targetId);
        const autoHideThreshold = organism
            ? organism.moderationConfig.autoHideThreshold
            : config.autoHideThreshold;
        const hidden = activeFlagCount >= autoHideThreshold;

        res.json(success(config.nodeId, { ...summary, hidden }));
    });

    // ── GET /v1/flags — List flags (operator only) ──
    router.get('/v1/flags', requireAuth(), requireOperator(storage), async (req, res) => {
        const status = req.query.status as string | undefined;
        const targetType = req.query.targetType as string | undefined;
        const { page, perPage } = pageOf(req.query.page, req.query.per_page);

        const flags = await listFlagsForReview(storage, { status, targetType, page, perPage });

        res.json(success(config.nodeId, flags, [
            { description: 'Create a new flag', method: 'POST', url: '/v1/flags' },
        ], { page, per_page: perPage }));
    });

    // ── PUT /v1/flags/:id — Update flag status (operator or organism admin) ──
    router.put('/v1/flags/:id', requireAuth(), async (req, res) => {
        const id = param(req.params.id);
        // Who may decide, and the order of the checks: services/moderation/review.ts reviewFlag, which
        // aimeat_admin_flag_review runs too.
        const out = await reviewFlag({ storage, config }, req.auth!, id, req.body?.status);
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }
        const { flag: updated, existing } = out;

        res.json(success(config.nodeId, updated, [
            { description: 'View all flags', method: 'GET', url: '/v1/flags' },
            { description: 'View flag summary for this target', method: 'GET', url: `/v1/flags/summary/${existing.targetType}/${existing.targetId}` },
        ]));
        emitChange('flags');
    });

    return router;
}
