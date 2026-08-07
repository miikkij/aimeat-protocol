/**
 * @file src/routes/home/first-agent.ts
 * @description POST /v1/home/first-agent — the funnel marker for "this person's first agent is
 *   in" (aimeat_remake/05-mittaus.md). Called by the home right after an approval.
 *
 *   It records rather than grants: the approval itself already happened through the normal
 *   device-authorization route, and nothing here can create or admit an agent. That separation is
 *   deliberate — a measurement endpoint that could also let someone in would be a way to walk past
 *   the consent step it exists to count.
 *
 *   Write-once, so re-approving or a double-click cannot move the timestamp, and only ever about
 *   the caller's OWN account.
 * @structure registerFirstAgentRoutes(router, ctx): POST /v1/home/first-agent
 * @usage Registered from src/routes/home.ts.
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 4).
 */
import type { Router } from 'express';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { ONBOARDING_KEYS, recordOnboardingEvent } from '../../services/onboarding-funnel.js';
import { readHomeState } from '../../services/home-state.js';
import { requireOwnerSession, type HomeRouteCtx } from './welcome-mat.js';

export function registerFirstAgentRoutes(router: Router, ctx: HomeRouteCtx): void {
    const { config, storage } = ctx;

    router.post('/v1/home/first-agent', requireAuth(), requireRole('owner'),
        requireOwnerSession(config.nodeId), async (req, res) => {
            const owner = req.auth!.owner;

            // The agent list is the evidence. Marking "first agent connected" for an account with
            // no agents would put a step in the funnel that never happened, and the funnel is the
            // only thing that says whether any of this works.
            const agents = await storage.getAgentsByOwner(owner);
            if (!agents.length) {
                res.status(409).json(error(config.nodeId, 'NO_AGENT',
                    'No agent has joined this account yet.'));
                return;
            }

            const wrote = await recordOnboardingEvent(storage, config, owner,
                ONBOARDING_KEYS.firstAgentConnected, { agentName: agents[0].name });

            // readHomeState also stamps home_initialized the first time all three conditions hold,
            // so the response is the authoritative "are you done" answer rather than a guess.
            const state = await readHomeState(storage, config, owner);
            res.json(success(config.nodeId, { recorded: wrote, state }, [
                { description: 'Prove the connection from your AI chat', method: 'GET', url: '/v1/prompts/hello-mcp' },
            ]));
        });
}
