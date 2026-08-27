/**
 * @file src/routes/home/track.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The start page: where a signed-in person lands when they open the site's root or
 *   sign in. Three answers: the home, the chat, or settings and controls (the old profile).
 *
 *   GET /v1/home/ui-track — where this person lands.
 *   PUT /v1/home/ui-track — change it.
 *
 *   The choice is per USER, stored on the account, so it follows them to another device. A per-tab
 *   choice would mean landing on whichever page happened to be the default every morning.
 *
 *   What this route does NOT do: move data, reset anything, or change what any page can see. The
 *   home and the controls read the same account, and every other door between them (the brand
 *   link, the header, the chat's back button) goes to a fixed place regardless of this setting.
 * @structure registerHomeTrackRoutes(router, ctx): GET + PUT /v1/home/ui-track
 * @usage Registered from src/routes/home.ts.
 * @version-history
 *   v2.0.0 — 2026-08-27 — A start page, not a side. The home and the profile stopped being two
 *     alternatives a person switches between and became two layers of one thing (the home in front,
 *     settings and controls behind it), so the default is the home for every account, the cohort no
 *     longer decides it, and the `switched` counter is gone with the switch it counted.
 *   v1.1.0 — 2026-08-16 — A third side, `chat`, and it is where a new account lands when this node
 *     has a chat agent.
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 8).
 */
import type { Router } from 'express';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { requireOwnerSession, type HomeRouteCtx } from './welcome-mat.js';

/** The start page. Separate from the onboarding `track`, which is a cohort and never changes. */
export const UI_TRACK_KEY = 'settings.ui_track';
export type UiTrack = 'home' | 'profile' | 'chat';

/** Where each start page actually is. One place, because the GET and the PUT both answer with it. */
const LANDING: Record<UiTrack, string> = {
    chat: '/v1/chat',
    home: '/v1/home',
    profile: '/v1/profile',
};

export function registerHomeTrackRoutes(router: Router, ctx: HomeRouteCtx): void {
    const { config, storage } = ctx;
    const ghiiOf = (owner: string) => `${owner}@${config.nodeId}`;

    /** The stored choice, or the default: the home, for everyone. */
    async function currentUiTrack(owner: string): Promise<{ ui: UiTrack; defaulted: boolean }> {
        const rec = await storage.getMemory(ghiiOf(owner), UI_TRACK_KEY);
        const v = (rec?.value ?? null) as { ui?: string } | null;
        if (v?.ui === 'home' || v?.ui === 'profile' || v?.ui === 'chat') return { ui: v.ui, defaulted: false };
        // The home is the front room: it shows the person's own state and carries a door to the
        // chat and to every control. A new account used to be sent to the chat when this node had
        // an agent; the onboarding home carries the chat door now, so the person sees the steps and
        // the chat side by side instead of being put in one of them.
        return { ui: 'home', defaulted: true };
    }

    router.get('/v1/home/ui-track', requireAuth(), requireRole('owner'),
        requireOwnerSession(config.nodeId), async (req, res) => {
            const { ui, defaulted } = await currentUiTrack(req.auth!.owner);
            res.json(success(config.nodeId, {
                ui,
                /** True when nothing has been chosen yet and this is the default. */
                defaulted,
                landing: LANDING[ui],
            }));
        });

    router.put('/v1/home/ui-track', requireAuth(), requireRole('owner'),
        requireOwnerSession(config.nodeId), async (req, res) => {
            const owner = req.auth!.owner;
            const ui = (req.body ?? {}).ui as UiTrack;
            if (ui !== 'home' && ui !== 'profile' && ui !== 'chat') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ui must be "home", "profile" or "chat"'));
                return;
            }

            const now = new Date().toISOString();
            const existing = await storage.getMemory(ghiiOf(owner), UI_TRACK_KEY);
            await storage.setMemory({
                key: UI_TRACK_KEY,
                ownerGaii: ghiiOf(owner),
                value: { ui, at: now },
                visibility: 'owner',
                tags: ['settings'],
                ttlHours: null,
                version: existing ? existing.version + 1 : 1,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            });

            res.json(success(config.nodeId, { ui, landing: LANDING[ui] }));
        });
}
