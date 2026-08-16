/**
 * @file src/routes/home/feed.ts
 * @description GET /v1/home/feed — what has happened on this account (aimeat_remake/
 *   06-koti-feed-suostumus.md, phase 6), and POST /v1/home/room — which of the four rooms the
 *   person went into first.
 *
 *   The feed is the ACCOUNT HOLDER's own (K1). Not public: nothing here needs moderation,
 *   visibility rules or a retraction, and making it public later is its own decision. Readable by
 *   the person and by anything they granted `memory:read` — see the route.
 * @structure registerHomeFeedRoutes(router, ctx): GET /v1/home/feed, POST /v1/home/room
 * @usage Registered from src/routes/home.ts.
 * @version-history
 *   v1.1.0 — 2026-08-17 — GET /v1/home/feed is gated on `memory:read` rather than restricted to an
 *     owner session. Whether an agent may read its owner's own history is the owner's decision, and
 *     the node's job is to give them a word for it, not to answer it for them. POST /v1/home/room is
 *     unchanged: it records which room the PERSON went into first, and an agent claiming that on
 *     their behalf would write a fiction into the funnel the operator reads.
 *   v1.0.0 — 2026-08-07 — Initial (remake phases 6–7).
 */
import type { Router } from 'express';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
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
     * The account holder's own record, readable by the account holder AND by anything they have
     * given `memory:read` to — their agents, and an app they approved for it.
     *
     * It used to be owner-session-only, on the reasoning that an agent reading its owner's history
     * was reading something that was not its business. That is the owner's call to make, not the
     * node's: an agent exists to act for the person, "what has happened lately" is the most ordinary
     * question they will ask it, and chat is this product's primary interface. What the node owes
     * them is a WORD they can grant or withhold, and `memory:read` is the honest one — every row
     * here is derived from the owner's own `onboarding.*` memory records and their GHII. Nothing new
     * is exposed: a principal holding that scope could already read the markers directly.
     */
    router.get('/v1/home/feed', requireAuth(), requireScope('memory:read'),
        async (req, res) => {
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
