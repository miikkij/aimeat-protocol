/**
 * @file src/routes/registration-invites.ts
 * @description The agent door (aimeat_remake/12-ai-rekisteroi.md): POST /v1/registration-invites.
 *
 *   An AI makes ONE call with a person's email address. The node emails that address a link; the
 *   person clicks it, picks a username, and has an account. The AI never creates the account and
 *   never chooses the username — a username is permanent, and it is not something to be guessed in
 *   a chat window by a model that cannot see whether it is free.
 *
 *   The call proves exactly one thing: this AI could make a POST request. That is not nothing —
 *   plenty cannot — but it is not MCP and does not replace it. The chain does not end at the
 *   account: the welcome mat and the first agent still follow.
 *
 *   This endpoint is OPEN and it sends email, which is a shape that has to be handled rather than
 *   hoped about:
 *     - the response NEVER reveals whether an address already has an account, or even whether a
 *       message was sent, so it cannot be used to test addresses;
 *     - one live invitation per address at a time, so an address cannot be buried in mail;
 *     - a per-IP limit, so one machine cannot mail a thousand strangers;
 *     - and the message itself carries the request's origin, which is what turns an open door into
 *       a traceable one.
 * @structure registrationInvitesRouter(config, storage): POST /v1/registration-invites
 * @usage app.use(registrationInvitesRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 4b).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { logger } from '../utils/logger.js';
import { createRegistrationInvitation, InvitationError } from '../services/invitations.js';
import { resolveAiClient } from '../services/ai-tool-setup.js';

/** Trim a claimed field to something loggable. The AI supplies these; none is trusted. */
const claim = (v: unknown): string | null =>
    (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);

export function registrationInvitesRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    /**
     * POST /v1/registration-invites
     * Body: { email, agent: { model, vendor, client } }
     *
     * Per-IP limit on the route; the per-address limit is in the service, because it is a property
     * of the address rather than of the caller — an attacker rotating IPs still cannot bury one
     * inbox.
     */
    router.post('/v1/registration-invites',
        rateLimit(config.rateLimits.registrationInvites),
        async (req, res) => {
            const body = req.body ?? {};
            const email = typeof body.email === 'string' ? body.email.trim() : '';
            const agentIn = (body.agent ?? {}) as Record<string, unknown>;
            const agent = {
                model: claim(agentIn.model),
                vendor: claim(agentIn.vendor),
                client: claim(agentIn.client),
            };

            // The model is REQUIRED (12-ai-rekisteroi.md): it is how we learn which AIs can actually
            // do this, and without it the whole measurement is guesswork. Refusing here also means
            // the email can always say what asked for it.
            if (!agent.model) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                    'Tell us which model you are: "agent": { "model": "...", "vendor": "...", "client": "..." }. '
                    + 'It goes in the message so the person can see who asked.'));
                return;
            }

            const observed = {
                // Express resolves x-forwarded-for only when trust proxy is set; either way this is
                // the node's own reading, never the caller's claim.
                ip: req.ip || req.socket.remoteAddress || 'unknown',
                userAgent: typeof req.headers['user-agent'] === 'string'
                    ? req.headers['user-agent'].slice(0, 300) : null,
                at: new Date().toISOString(),
            };

            let result;
            try {
                result = await createRegistrationInvitation(storage, config, { email, agent, observed });
            } catch (err) {
                if (err instanceof InvitationError) {
                    res.status(err.status).json(error(config.nodeId, err.code, err.message));
                    return;
                }
                throw err;
            }

            // Whether an address is new, already has an account, or already has a live invite, the
            // answer is the same sentence. Anything else makes this an address-checking machine.
            if (result.suppressed) {
                logger.info('registration invite suppressed', { reason: result.suppressed, ip: observed.ip });
            } else {
                logger.info('registration invite sent', {
                    ip: observed.ip, model: agent.model, client: agent.client, delivered: result.emailSent,
                });
            }

            // What the AI should say next. It cannot see the mailbox, so it is told what to tell the
            // person rather than left to invent it.
            const resolvedClient = resolveAiClient(agent.client);
            res.status(202).json(success(config.nodeId, {
                status: 'sent',
                tell_the_person: 'Check your email. There is a link in it that finishes the account — no code to type. '
                    + 'The message also shows the IP address and which AI asked, so you can see it was you.',
                expires_in_hours: 24,
                // If they said which app they are in and we know it, say so now: it is the field
                // that decides what they will be asked to do after the account exists.
                mcp_client_recognised: resolvedClient.kind === 'known' ? resolvedClient.id : null,
                next: 'The account is the beginning, not the end. After it: a welcome mat, then connecting you as an agent.',
            }, [
                { description: 'What the person does after the link', method: 'GET', url: '/v1/home' },
                { description: 'How to connect yourself as an agent afterwards', method: 'GET', url: '/auth.md' },
            ]));
        });

    return router;
}
