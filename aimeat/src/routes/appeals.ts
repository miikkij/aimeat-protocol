/**
 * @file src/routes/appeals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Moderation appeals API. Lets a content owner appeal a flag against their
 *   content, lists appeals, and lets moderators review (dismiss/action) them. Resolves the
 *   flagged content's owner across memory, board posts, actions, and agents.
 *
 * @structure
 *   - appealsRouter(config, storage): POST /v1/flags/:flagId/appeal, GET /v1/appeals, POST /v1/appeals/:id/review
 *
 * @version-history
 *   2026-11-19 — The three routes run services/moderation/review.ts (appealFlag, listAppealsFor,
 *     reviewAppeal, getContentOwner), which the MCP tools aimeat_flag_appeal, aimeat_appeals and
 *     aimeat_appeal_review run too; the rules moved there unchanged (feature audit 2026-11-19, 4.4 item 3).
 *   2026-10-16 — GET /v1/appeals lists an organism's appeals by archiveRoleOf too: the creator or an admin,
 *     in person or through their own agent; an attached agent sees none. It read organism.admins for the
 *     owner name alone (Jouni, 2026-10-16).
 *   2026-10-16 — POST /v1/appeals/:id/review decides the organism arm with archiveRoleOf (services/archive.ts),
 *     the rule archiving asks: the creator or an admin, in person or through one of their own agents; an
 *     agent attached to the organism is refused whoever its owner is. It read organism.admins for the
 *     owner name alone, so an attached agent of an admin decided appeals (Jouni, 2026-10-16).
 *   v1.3.0 — 2026-10-12 — requireRestScope (auth/rest-scope-gate.ts): social:write on POST /v1/flags/:flagId/appeal, POST /v1/appeals/:id/review; social:read on GET /v1/appeals. Allowed with the Deprecation headers before 4.0.0, refused from it (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
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
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { requireRestScope } from '../auth/rest-scope-gate.js';
import { appealFlag, listAppealsFor, reviewAppeal, pageOf } from '../services/moderation/review.js';

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

export function appealsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // ── POST /v1/flags/:flagId/appeal — Content owner appeals a flag ──
    router.post('/v1/flags/:flagId/appeal', requireAuth(), requireRestScope('social:write'), async (req, res) => {
        // The content owner (or one of the owner's agents) or the operator, once per flag:
        // services/moderation/review.ts appealFlag, which aimeat_flag_appeal runs too.
        const out = await appealFlag({ storage, config }, req.auth!, param(req.params.flagId), req.body?.reason);
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }

        res.status(201).json(success(config.nodeId, out.appeal, [
            { description: 'View all appeals', method: 'GET', url: '/v1/appeals' },
        ]));
        emitChange('appeals');
    });

    // ── GET /v1/appeals — List appeals (operator sees all; organism admin sees their organism's) ──
    router.get('/v1/appeals', requireAuth(), requireRestScope('social:read'), async (req, res) => {
        const status = req.query.status as string | undefined;
        const { page, perPage } = pageOf(req.query.page, req.query.per_page);
        // The operator sees every appeal; the creator or an admin of an organism, in person or through
        // their own agent, sees that organism's: services/moderation/review.ts listAppealsFor.
        const out = await listAppealsFor({ storage, config }, req.auth!, { status, page, perPage });
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }
        const { appeals, total } = out;

        res.json(success(config.nodeId, { appeals, total }, [
            { description: 'Review an appeal', method: 'POST', url: '/v1/appeals/{id}/review' },
        ], { page, per_page: perPage, total }));
    });

    // ── POST /v1/appeals/:id/review — Review an appeal (operator or organism admin) ──
    router.post('/v1/appeals/:id/review', requireAuth(), requireRestScope('social:write'), async (req, res) => {
        // The operator, or the organism's creator or an admin in person or through their own agent,
        // on a pending appeal: services/moderation/review.ts reviewAppeal, which aimeat_appeal_review
        // runs too.
        const out = await reviewAppeal({ storage, config }, req.auth!, param(req.params.id),
            { decision: req.body?.decision, note: req.body?.note });
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }
        const { appeal: updated, relatedFlag } = out;
        res.json(success(config.nodeId, updated, [
            { description: 'View all appeals', method: 'GET', url: '/v1/appeals' },
            { description: 'View the related flag', method: 'GET', url: `/v1/flags/summary/${relatedFlag?.targetType}/${relatedFlag?.targetId}` },
        ]));
        emitChange('appeals');
    });

    return router;
}
