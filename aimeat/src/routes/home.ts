/**
 * @file src/routes/home.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The KOTI (home) routes — the new onboarding path, built beside the old one rather
 *   than on top of it (aimeat_remake/08-kytkin.md). Nothing here modifies an existing route: the
 *   old profile keeps /v1/profile and every endpoint it already used, and a person moves between
 *   the two with a switch. Two parallel view trees, one backend.
 *
 *   "Profile" is not a word on this path. The account has a HOME, its first content is a welcome
 *   mat, and the mat is the person's portfolio rather than a second page type.
 * @structure
 *   - homeRouter(config, storage): the router, mounted in routes-loader
 *   - Handlers live in sibling modules under ./home/:
 *     - home/welcome-mat.ts — POST /v1/home/welcome-mat, POST /v1/home/ai-client
 *     - home/state.ts       — GET /v1/home/state
 *     - home/first-agent.ts — POST /v1/home/first-agent
 *     - home/feed.ts        — GET /v1/home/feed, POST /v1/home/room
 *     - home/track.ts       — GET + PUT /v1/home/ui-track (the switch)
 * @usage app.use(homeRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 2).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { registerWelcomeMatRoutes, type HomeRouteCtx } from './home/welcome-mat.js';
import { registerHomeStateRoutes } from './home/state.js';
import { registerFirstAgentRoutes } from './home/first-agent.js';
import { registerHomeFeedRoutes } from './home/feed.js';
import { registerHomeTrackRoutes } from './home/track.js';

export function homeRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const ctx: HomeRouteCtx = { config, storage };

    registerHomeStateRoutes(router, ctx);
    registerWelcomeMatRoutes(router, ctx);
    registerFirstAgentRoutes(router, ctx);
    registerHomeFeedRoutes(router, ctx);
    registerHomeTrackRoutes(router, ctx);

    return router;
}
