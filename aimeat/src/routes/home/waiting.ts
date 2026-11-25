/**
 * @file src/routes/home/waiting.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/home/waiting?limit= — what waits for the person, from every place that holds
 *   something for them, in one answer (services/home/waiting.ts). The Home page's first block reads
 *   it, and aimeat_home_waiting gives an AI the same answer from the same function.
 *
 *   Gated as GET /v1/home/feed is: `memory:read`, which the person in person always holds and an
 *   agent or an app holds only when the person granted it. Each kind inside the answer is then read
 *   only when the caller also holds the word that kind's own route asks; a kind it does not is named
 *   in `withheld`. A visitor from another node has no account here and is refused.
 * @structure registerHomeWaitingRoutes(router, ctx): GET /v1/home/waiting
 * @usage Registered from src/routes/home.ts.
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial.
 */
import type { Router } from 'express';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { homeWaitingFor, WAITING_LIMIT_DEFAULT, WAITING_LIMIT_MAX } from '../../services/home/waiting.js';
import type { HomeRouteCtx } from './welcome-mat.js';

/** The page's `limit`, clamped as GET /v1/home/agents clamps its own: not a positive number is the default. */
export function waitingLimitOf(raw: unknown): number {
    const asked = Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(asked) && asked > 0 ? Math.min(asked, WAITING_LIMIT_MAX) : WAITING_LIMIT_DEFAULT;
}

export function registerHomeWaitingRoutes(router: Router, ctx: HomeRouteCtx): void {
    const { config, storage } = ctx;

    router.get('/v1/home/waiting', requireAuth(), requireScope('memory:read'), async (req, res) => {
        const caller = callerOf(req, config.nodeId, storage);
        if (caller.visitor) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'What waits is an account of this node; a visitor from another node has none here.'));
            return;
        }
        const answer = await homeWaitingFor({ storage, config, ...(req.auth?.app ? { app: req.auth.app } : {}) }, caller, { limit: waitingLimitOf(req.query.limit) });
        res.json(success(config.nodeId, answer, [
            { description: 'What has happened on the account', method: 'GET', url: '/v1/home/feed' },
        ]));
    });
}
