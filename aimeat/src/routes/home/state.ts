/**
 * @file src/routes/home/state.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/home/state — where this account stands on the new path, in one call
 *   (aimeat_remake/06-koti-feed-suostumus.md). The home view renders entirely from this: which
 *   step is open, which are named but not yet reachable, and whether the home exists at all.
 *
 *   The answer also carries what the UI needs to ASK when the branch is undecided — the app
 *   options built from the tool table itself, so the picker can never drift from the list the
 *   branch decision reads.
 * @structure registerHomeStateRoutes(router, ctx): GET /v1/home/state
 * @usage Registered from src/routes/home.ts.
 * @version-history
 *   v1.1.0 — 2026-08-19 — The response carries `playbooks`: the named outcomes this node can
 *     actually deliver (services/home-playbooks.ts), each with its prompt, step count and whatever
 *     live proof the node has. Only for a finished home.
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 3).
 */
import type { Router } from 'express';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success } from '../../middleware/envelope.js';
import { readHomeState, HOME_STEPS } from '../../services/home-state.js';
import { aiClientQuestionOptions, resolveAiClient, decideBranch } from '../../services/ai-tool-setup.js';
import { openRooms } from '../../services/home-rooms.js';
import { openPlaybooks } from '../../services/home-playbooks.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { requireOwnerSession, type HomeRouteCtx } from './welcome-mat.js';

export function registerHomeStateRoutes(router: Router, ctx: HomeRouteCtx): void {
    const { config, storage } = ctx;

    /**
     * GET /v1/home/state
     *
     * Owner role: this is the person's own home. An agent asking where its owner stands in
     * onboarding would be reading the owner's progress, which is theirs and not the agent's.
     */
    router.get('/v1/home/state', requireAuth(), requireRole('owner'), requireOwnerSession(config.nodeId), async (req, res) => {
        const owner = req.auth!.owner;
        const lang = typeof req.query.lang === 'string' ? req.query.lang : undefined;
        const state = await readHomeState(storage, config, owner);

        // Re-derive the pending question from what is known, rather than storing it: the answer
        // to "what should I ask next" is a function of the state, and a stored copy would survive
        // the state changing underneath it.
        const decision = state.mat.done
            ? decideBranch(resolveAiClient(state.ai?.client ?? null),
                state.branch ? { clientAnswer: state.ai?.client ?? undefined } : {})
            : null;
        const question = state.branch ? null : decision?.branch === 'ask' ? decision.question : null;

        // Only the rooms that are really there. The view renders what it is given and never
        // decides for itself which doors exist (E11).
        // The mailbox room asks about THIS account, so the resolved GHII goes in — never
        // req.auth!.sub, which is a bare owner name on an owner session (Rule 10).
        const rooms = state.initialized
            ? await openRooms(storage, config, resolveIdentity(req.auth!, config.nodeId))
            : [];

        // The playbooks this node can actually deliver. Only for a FINISHED home: somebody still
        // putting their page up is being asked one thing at a time, and a menu of outcomes beside
        // that is the noise the rooms were removed for.
        const playbooks = state.initialized ? await openPlaybooks(storage, config) : [];

        res.json(success(config.nodeId, {
            state,
            rooms,
            playbooks,
            /** The three steps in order, so the view can name the ones still ahead. */
            steps: HOME_STEPS,
            /** What still needs asking, if anything. */
            question,
            /** Built from the tool table itself — never a second hardcoded list. */
            client_options: question === 'which-client' ? aiClientQuestionOptions(config, { lang }) : null,
        }, nextActions(state.step)));
    });
}

/** The one thing to do next, as a hint. One action, because the view shows one action. */
function nextActions(step: string | null) {
    if (step === 'welcome-mat') {
        return [{ description: 'Get the prompt for your welcome mat', method: 'GET' as const, url: '/v1/prompts/welcome-mat' }];
    }
    if (step === 'first-agent' || step === 'hello-mcp') {
        return [{ description: 'Connect your first agent', method: 'POST' as const, url: '/v1/agents/device-authorize' }];
    }
    return [{ description: 'Your welcome mat', method: 'GET' as const, url: '/v1/portfolio/me' }];
}
