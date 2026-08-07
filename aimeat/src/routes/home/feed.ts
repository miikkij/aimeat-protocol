/**
 * @file src/routes/home/feed.ts
 * @description GET /v1/home/feed — what has happened on this account (aimeat_remake/
 *   06-koti-feed-suostumus.md, phase 6), and POST /v1/home/room — which of the four rooms the
 *   person went into first.
 *
 *   The feed is the ACCOUNT HOLDER's own (K1). Not public: nothing here needs moderation,
 *   visibility rules or a retraction, and making it public later is its own decision.
 * @structure registerHomeFeedRoutes(router, ctx): GET /v1/home/feed, POST /v1/home/room
 * @usage Registered from src/routes/home.ts.
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phases 6–7).
 */
import type { Router } from 'express';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { readHomeFeed } from '../../services/home-feed.js';
import { ONBOARDING_KEYS, recordOnboardingEvent, type OnboardingRoom } from '../../services/onboarding-funnel.js';
import { ROOMS, openRooms } from '../../services/home-rooms.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { requireOwnerSession, type HomeRouteCtx } from './welcome-mat.js';

export function registerHomeFeedRoutes(router: Router, ctx: HomeRouteCtx): void {
    const { config, storage } = ctx;

    /**
     * GET /v1/home/feed
     *
     * Owner session only — this is a record of one person's own account, and an agent reading its
     * owner's history would be reading something that is not its business.
     */
    router.get('/v1/home/feed', requireAuth(), requireRole('owner'),
        requireOwnerSession(config.nodeId), async (req, res) => {
            const owner = req.auth!.owner;
            // "An agent is knocking" is live state rather than a marker: it is the one row that
            // disappears again, and the one the person most needs to act on.
            const pending = await storage.listPendingDeviceAuthByOwner(owner);
            const items = await readHomeFeed(storage, config, owner, { pendingAgents: pending.length });
            res.json(success(config.nodeId, { items, total: items.length }));
        });

    /**
     * POST /v1/home/room
     * Body: { room: 'create' | 'organise' | 'monetise' | 'company' }
     *
     * Records which room the person went into FIRST. Write-once on purpose: the question it answers
     * is "what did they come here to do", and a value that follows them around would answer
     * "where were they last" instead — which nobody asked.
     */
    router.post('/v1/home/room', requireAuth(), requireRole('owner'),
        requireOwnerSession(config.nodeId), async (req, res) => {
            const owner = req.auth!.owner;
            const room = (req.body ?? {}).room as OnboardingRoom;
            const known = ROOMS.find(r => r.id === room);
            if (!known) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                    `room must be one of: ${ROOMS.map(r => r.id).join(', ')}`));
                return;
            }
            // A room whose destination is not on this node is not enterable. Recording an entry
            // into a place that does not exist would put a step in the funnel that cannot happen.
            const open = await openRooms(storage, config, resolveIdentity(req.auth!, config.nodeId));
            if (!open.some(r => r.id === room)) {
                res.status(409).json(error(config.nodeId, 'ROOM_CLOSED',
                    'That room is not open on this node yet.'));
                return;
            }
            const recorded = await recordOnboardingEvent(storage, config, owner,
                ONBOARDING_KEYS.roomEntered, { room });
            res.json(success(config.nodeId, { recorded, room, url: known.url }));
        });
}
