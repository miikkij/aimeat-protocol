/**
 * @file src/routes/feedback.ts
 * @description Node Feedback Channel REST API — authenticated principals (GHII/GAII/GEAI) report
 *   platform bugs/blockers/ideas to the node operator and read the operator's replies; the
 *   operator triages via the /v1/admin/feedback inbox. Distinct from /v1/flags (content
 *   moderation): feedback is about the PLATFORM itself. Core logic lives in
 *   src/services/feedback.ts, shared with the MCP tools.
 * @structure
 *   - POST /v1/feedback — open a thread (any authenticated principal, rate-limited)
 *   - GET  /v1/feedback/mine — caller's threads + operator replies
 *   - GET  /v1/feedback/:id — one own thread (operator: any)
 *   - POST /v1/feedback/:id/reply — sender or operator reply
 *   - GET  /v1/admin/feedback — operator inbox (status/category filters + paging)
 *   - PATCH /v1/admin/feedback/:id — operator status triage
 * @usage app.use(feedbackRouter(config, storage)) in routes-loader
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: Node Feedback Channel v1.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { FEEDBACK_STATUSES } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { resolveIdentity } from '../utils/gaii.js';
import { createFeedbackThread, replyToFeedback } from '../services/feedback.js';
import { emitChange } from '../services/event-bus.js';

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

const CODE_STATUS: Record<string, number> = { VALIDATION_ERROR: 400, NOT_FOUND: 404, LIMIT_REACHED: 409 };

export function feedbackRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    const isOperator = (req: { auth?: { roles?: string[] } }): boolean =>
        req.auth?.roles?.includes('operator') ?? false;

    // ── POST /v1/feedback — open a platform-feedback thread (any authenticated principal) ──
    router.post('/v1/feedback',
        requireAuth(),
        rateLimit({ windowMs: 86_400_000, max: 20 }),
        async (req, res) => {
            const sender = resolveIdentity(req.auth!, config.nodeId);
            const { category, title, body, context } = req.body ?? {};
            const result = await createFeedbackThread(storage, config, { sender, category, title, body, context });
            if (!result.ok) {
                res.status(CODE_STATUS[result.code]).json(error(config.nodeId, result.code, result.message));
                return;
            }
            res.status(201).json(success(config.nodeId, result.record, [
                { description: 'Your feedback threads + operator replies', method: 'GET', url: '/v1/feedback/mine' },
                { description: 'Add to this thread', method: 'POST', url: `/v1/feedback/${result.record.id}/reply` },
            ]));
        });

    // ── GET /v1/feedback/mine — caller's own threads, newest first ──
    router.get('/v1/feedback/mine', requireAuth(), async (req, res) => {
        const sender = resolveIdentity(req.auth!, config.nodeId);
        const threads = await storage.listFeedbackBySender(sender);
        res.json(success(config.nodeId, { threads }, [
            { description: 'Open a new feedback thread', method: 'POST', url: '/v1/feedback' },
        ]));
    });

    // ── GET /v1/feedback/:id — one thread (own; operator sees all; foreign → 404) ──
    router.get('/v1/feedback/:id', requireAuth(), async (req, res) => {
        const record = await storage.getFeedback(param(req.params.id));
        const actor = resolveIdentity(req.auth!, config.nodeId);
        if (!record || (!isOperator(req) && record.sender !== actor)) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Feedback thread not found'));
            return;
        }
        res.json(success(config.nodeId, record));
    });

    // ── POST /v1/feedback/:id/reply — sender adds to own thread; operator replies to any ──
    router.post('/v1/feedback/:id/reply', requireAuth(), rateLimit({ windowMs: 3_600_000, max: 30 }), async (req, res) => {
        const actor = resolveIdentity(req.auth!, config.nodeId);
        const result = await replyToFeedback(storage, {
            id: param(req.params.id), actor, isOperator: isOperator(req), body: req.body?.body,
        });
        if (!result.ok) {
            res.status(CODE_STATUS[result.code]).json(error(config.nodeId, result.code, result.message));
            return;
        }
        res.json(success(config.nodeId, result.record));
    });

    // ── GET /v1/admin/feedback — operator inbox ──
    router.get('/v1/admin/feedback', requireAuth(), requireRole('operator'), async (req, res) => {
        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string, 10) || 50));
        const threads = await storage.listFeedback({
            status: (req.query.status as string) || undefined,
            category: (req.query.category as string) || undefined,
            page, perPage,
        });
        res.json(success(config.nodeId, { threads }, [
            { description: 'Set a thread status', method: 'PATCH', url: '/v1/admin/feedback/:id' },
            { description: 'Reply to a thread', method: 'POST', url: '/v1/feedback/:id/reply' },
        ], { page, per_page: perPage }));
    });

    // ── PATCH /v1/admin/feedback/:id — operator status triage ──
    router.patch('/v1/admin/feedback/:id', requireAuth(), requireRole('operator'), async (req, res) => {
        const status = String(req.body?.status ?? '');
        if (!(FEEDBACK_STATUSES as readonly string[]).includes(status)) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
                `Invalid status: "${status}". Must be one of: ${FEEDBACK_STATUSES.join(', ')}`));
            return;
        }
        const updated = await storage.updateFeedback(param(req.params.id), {
            status: status as (typeof FEEDBACK_STATUSES)[number], updatedAt: new Date().toISOString(),
        });
        if (!updated) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Feedback thread not found'));
            return;
        }
        emitChange('feedback');
        res.json(success(config.nodeId, updated));
    });

    return router;
}
