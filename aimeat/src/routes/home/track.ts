/**
 * @file src/routes/home/track.ts
 * @description The switch between the new home and the old profile (aimeat_remake/08-kytkin.md).
 *
 *   GET /v1/home/ui-track — which side this person lands on.
 *   PUT /v1/home/ui-track — change it.
 *
 *   K2: the choice is per USER, stored on the account, so it follows them to another device. A
 *   per-tab choice would mean landing on whichever side happened to be the default every morning,
 *   and the measurement needs a durable answer anyway.
 *
 *   The switch INCREMENTS `switched` and never touches `track`. Those are two different questions:
 *   `track` is which path the account was CREATED on and defines its cohort, `switched` is how many
 *   times the person has flipped. Rewriting `track` on a flip would move accounts between cohorts
 *   as people wander, and a cohort whose membership changes under you measures nothing. The counter
 *   is itself a result: remake-created accounts leaving for the old side is the signal that the
 *   remake is not working.
 *
 *   What the switch does NOT do: move data, reset anything, or change what either side can see.
 *   Both read the same account.
 * @structure registerHomeTrackRoutes(router, ctx): GET + PUT /v1/home/ui-track
 * @usage Registered from src/routes/home.ts.
 * @version-history
 *   v1.1.0 — 2026-08-16 — A third side, `chat`, and it is where a new account lands when this node
 *     has a chat agent. That is the point of the chat: a person who has connected nothing can still
 *     do something here. A node with no agent keeps the old landing rather than sending anyone to a
 *     box that cannot answer.
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 8).
 */
import type { Router } from 'express';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { readTrack, recordTrackSwitch } from '../../services/onboarding-funnel.js';
import { requireOwnerSession, type HomeRouteCtx } from './welcome-mat.js';
import { chatEnabled } from '../../services/chat-session.js';

/** Which side the person lands on. Separate from `track`, which is a cohort and never changes. */
export const UI_TRACK_KEY = 'settings.ui_track';
export type UiTrack = 'home' | 'profile' | 'chat';

/** Where each side actually is. One place, because the GET and the PUT both answer with it. */
const LANDING: Record<UiTrack, string> = {
    chat: '/v1/chat',
    home: '/v1/home',
    profile: '/v1/profile',
};

export function registerHomeTrackRoutes(router: Router, ctx: HomeRouteCtx): void {
    const { config, storage } = ctx;
    const ghiiOf = (owner: string) => `${owner}@${config.nodeId}`;

    /** The stored choice, or the default for this account. */
    async function currentUiTrack(owner: string): Promise<{ ui: UiTrack; defaulted: boolean }> {
        const rec = await storage.getMemory(ghiiOf(owner), UI_TRACK_KEY);
        const v = (rec?.value ?? null) as { ui?: string } | null;
        if (v?.ui === 'home' || v?.ui === 'profile' || v?.ui === 'chat') return { ui: v.ui, defaulted: false };
        // K3: an account created on the remake lands on the home; one created before it lands where
        // it always did. Nobody's workflow changes under them, and new people see the new thing.
        //
        // Since the chat exists, a new account lands there instead: it is the one place a person who
        // has connected no AI tool of their own can do something on their first visit. Only when
        // this node HAS an agent, though — landing somebody in a box that says "no agent configured"
        // is worse than the home they would otherwise have seen.
        const { track } = await readTrack(storage, config, owner);
        if (track !== 'remake') return { ui: 'profile', defaulted: true };
        return { ui: chatEnabled(config) ? 'chat' : 'home', defaulted: true };
    }

    router.get('/v1/home/ui-track', requireAuth(), requireRole('owner'),
        requireOwnerSession(config.nodeId), async (req, res) => {
            const owner = req.auth!.owner;
            const [{ ui, defaulted }, cohort] = await Promise.all([
                currentUiTrack(owner),
                readTrack(storage, config, owner),
            ]);
            res.json(success(config.nodeId, {
                ui,
                /** True when nothing has been chosen yet and this is the default for the cohort. */
                defaulted,
                landing: LANDING[ui],
                // The cohort, for transparency. Read-only here: no route changes it.
                track: cohort.track,
                switched: cohort.switched,
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

            const before = await currentUiTrack(owner);
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

            // Count a real CHANGE of side, not a re-affirmation of the current one. Counting a
            // no-op would inflate the one number that says whether people are leaving.
            let switched = (await readTrack(storage, config, owner)).switched;
            if (before.ui !== ui) switched = await recordTrackSwitch(storage, config, owner);

            const cohort = await readTrack(storage, config, owner);
            res.json(success(config.nodeId, {
                ui,
                landing: LANDING[ui],
                switched,
                // Unchanged, always. Proven by the E2E rather than promised here.
                track: cohort.track,
            }));
        });
}
