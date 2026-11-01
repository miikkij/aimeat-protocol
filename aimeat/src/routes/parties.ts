/**
 * @file src/routes/parties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The HTTP endpoints of outside parties and named shares (plan doc-mvwxcas3dom3, D2, D3):
 *   the owner's management, the party's own endpoints and its token, and the operator's stop. The work
 *   is services/parties/, which the MCP tool aimeat_party calls too; this file parses requests and
 *   renders answers.
 *
 *   TWO KINDS OF CALLER, NEVER MIXED. The owner's endpoints take a node session (the owner in person,
 *   or a principal of the owner holding party:manage). The party's endpoints (/v1/parties/me*,
 *   /v1/parties/token) take a party credential only, read by services/parties/verify.ts: HTTP Basic
 *   (user `<owner>/<name>`, password the key) or a party token. A party credential is never req.auth.
 *   The /me routes are registered before /:name, and "me", "token" and "share" are not party names.
 * @structure
 *   - GET/POST   /v1/parties                         the owner's parties; make one (its key shown once)
 *   - POST       /v1/parties/share                   share a package with a party in one call
 *   - POST       /v1/parties/token                   a party's key for a token (OAuth 2.0 client credentials)
 *   - GET        /v1/parties/me                      the party and what was shared with it
 *   - POST       /v1/parties/me/keys/rotate          a new key; the one used stops working
 *   - GET        /v1/parties/me/shares/:id/connection the share's connection file
 *   - POST       /v1/parties/me/shares/:id/accept    accept the share's terms
 *   - POST       /v1/parties/me/shares/:id/decline   end a share the party does not need
 *   - GET/PATCH/DELETE /v1/parties/:name             one party
 *   - POST /v1/parties/:name/keys, DELETE /v1/parties/:name/keys/:keyId
 *   - POST /v1/parties/:name/stop, /resume
 *   - GET  /v1/parties/:name/reads                   the party's read log
 *   - POST /v1/admin/parties/:owner/:name/stop, /resume   the operator, for abuse (D2.9)
 * @usage app.use(partiesRouter(config, storage))
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2, D3).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, requireOperator } from '../auth/middleware.js';
import { refuseAnonymousPrincipal } from '../auth/anonymous-principal.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { deny403 } from '../auth/deny.js';
import {
    createParty, listParties, getParty, updateParty, stopParty, resumeParty, deleteParty, createKey, deleteKey,
    readsOfParty, shareWithParty, type PartyAnswer, type PartyServiceCtx,
} from '../services/parties/service.js';
import { partyMe, partyConnection, acceptShareTerms, declineShare, rotatePartyKey, partyTokenFor } from '../services/parties/party-self.js';
import { operatorSetStop } from '../services/parties/admin.js';
import { partyCredentialOf, verifyParty, type PartyContext } from '../services/parties/verify.js';
import { parsePartyUser } from '../services/parties/contract.js';
import { takeReadSlot } from '../services/parties/activity.js';
import { validateBody } from '../models/schemas.js';
import {
    PartyCreateSchema, PartyUpdateSchema, PartyShareSchema, PartyTokenSchema, PartyStopSchema, EmptyPartyBodySchema,
} from '../models/party-schemas.js';

export function partiesRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const deps = { storage, config };
    const ctxOf = (req: Request): PartyServiceCtx => ({ deps, caller: callerOf(req, config.nodeId, storage), door: 'rest' });
    const render = <T>(req: Request, res: Response, out: PartyAnswer<T>, okStatus = 200) => {
        if (out.ok) { res.status(okStatus).json(success(config.nodeId, out.data as Record<string, unknown>)); return; }
        if (out.status === 403 && (out.code === 'SCOPE_DENIED' || out.code === 'FORBIDDEN')) { deny403(req, res, out.code, out.message); return; }
        res.status(out.status).json(error(config.nodeId, out.code, out.message, undefined, out.details));
    };
    const name = (req: Request) => String(req.params.name ?? '');
    // The owner's endpoints: a node session of the account, and party:manage for anyone but the owner in person.
    const owner = [requireAuth(), refuseAnonymousPrincipal(), requireScope('party:manage')];

    /** The verified party on this request, or null with the 401 or 403 sent. */
    const partyOf = async (req: Request, res: Response): Promise<PartyContext | null> => {
        const cred = partyCredentialOf(req);
        if (!cred) {
            res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Sign in with the name and the key the owner gave you.', undefined, {
                basic_user: '<owner>/<party name>', basic_password: 'the party key', token_endpoint: '/v1/parties/token',
            }));
            return null;
        }
        const v = await verifyParty(deps, cred);
        if (!v.ok) { res.status(v.status).json(error(config.nodeId, v.code, v.message)); return null; }
        return v.ctx;
    };

    // ── The party's own endpoints (before /:name) ──

    /**
     * OAuth 2.0 client credentials (RFC 6749 §4.4): `grant_type=client_credentials` with `client_id`
     * `<owner>/<name>` and `client_secret` the key, as a form or JSON body, or the same pair as HTTP
     * Basic. Answers the token in the OAuth shape, and the OAuth error shape on a refusal.
     */
    router.post('/v1/parties/token', validateBody(PartyTokenSchema, config.nodeId), async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const oauthError = (status: number, code: string, description: string) => {
            if (status === 401) res.setHeader('WWW-Authenticate', 'Basic realm="aimeat", charset="UTF-8"');
            res.status(status).setHeader('Cache-Control', 'no-store');
            res.json({ error: code, error_description: description });
        };
        if (body.grant_type !== undefined && body.grant_type !== 'client_credentials') { oauthError(400, 'unsupported_grant_type', 'This endpoint takes grant_type=client_credentials.'); return; }
        let cred = partyCredentialOf(req);
        if (!cred && typeof body.client_id === 'string' && typeof body.client_secret === 'string') {
            const user = parsePartyUser(body.client_id);
            cred = user ? { form: 'basic', owner: user.owner, name: user.name, key: body.client_secret } : { form: 'malformed', reason: 'client_id is <owner>/<party name>, for example alice/matti.' };
        }
        if (!cred || cred.form === 'token' || cred.form === 'url-key') { oauthError(401, 'invalid_client', 'Send client_id <owner>/<party name> and client_secret the party key, as a form, JSON or HTTP Basic.'); return; }
        const v = await verifyParty(deps, cred);
        if (!v.ok) { oauthError(v.status === 403 ? 400 : 401, v.status === 403 ? 'unauthorized_client' : 'invalid_client', v.message); return; }
        if (!takeReadSlot(v.ctx.party.uid, Math.max(1, config.partyReadsPerMinute))) {
            res.setHeader('Retry-After', '60');
            oauthError(429, 'slow_down', 'Too many requests for this party in a minute. Wait a minute.');
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json(await partyTokenFor(v.ctx));
    });

    router.get('/v1/parties/me', async (req, res) => {
        const ctx = await partyOf(req, res);
        if (ctx) render(req, res, await partyMe(deps, ctx));
    });
    router.post('/v1/parties/me/keys/rotate', validateBody(EmptyPartyBodySchema, config.nodeId), async (req, res) => {
        const ctx = await partyOf(req, res);
        if (ctx) render(req, res, await rotatePartyKey(deps, ctx));
    });
    router.get('/v1/parties/me/shares/:id/connection', async (req, res) => {
        const ctx = await partyOf(req, res);
        if (ctx) render(req, res, await partyConnection(deps, ctx, String(req.params.id)));
    });
    router.post('/v1/parties/me/shares/:id/accept', validateBody(EmptyPartyBodySchema, config.nodeId), async (req, res) => {
        const ctx = await partyOf(req, res);
        if (ctx) render(req, res, await acceptShareTerms(deps, ctx, String(req.params.id)));
    });
    router.post('/v1/parties/me/shares/:id/decline', validateBody(EmptyPartyBodySchema, config.nodeId), async (req, res) => {
        const ctx = await partyOf(req, res);
        if (ctx) render(req, res, await declineShare(deps, ctx, String(req.params.id)));
    });

    // ── The owner's endpoints ──

    router.get('/v1/parties', ...owner, async (req, res) => { render(req, res, await listParties(ctxOf(req))); });
    router.post('/v1/parties', ...owner, validateBody(PartyCreateSchema, config.nodeId), async (req, res) => {
        render(req, res, await createParty(ctxOf(req), (req.body ?? {}) as Record<string, unknown>), 201);
    });
    router.post('/v1/parties/share', ...owner, validateBody(PartyShareSchema, config.nodeId), async (req, res) => {
        render(req, res, await shareWithParty(ctxOf(req), (req.body ?? {}) as Record<string, unknown>), 201);
    });
    router.get('/v1/parties/:name', ...owner, async (req, res) => { render(req, res, await getParty(ctxOf(req), name(req))); });
    router.patch('/v1/parties/:name', ...owner, validateBody(PartyUpdateSchema, config.nodeId), async (req, res) => {
        render(req, res, await updateParty(ctxOf(req), name(req), (req.body ?? {}) as Record<string, unknown>));
    });
    router.delete('/v1/parties/:name', ...owner, async (req, res) => { render(req, res, await deleteParty(ctxOf(req), name(req))); });
    router.post('/v1/parties/:name/keys', ...owner, validateBody(EmptyPartyBodySchema, config.nodeId), async (req, res) => { render(req, res, await createKey(ctxOf(req), name(req)), 201); });
    router.delete('/v1/parties/:name/keys/:keyId', ...owner, async (req, res) => {
        render(req, res, await deleteKey(ctxOf(req), name(req), String(req.params.keyId)));
    });
    router.post('/v1/parties/:name/stop', ...owner, validateBody(EmptyPartyBodySchema, config.nodeId), async (req, res) => { render(req, res, await stopParty(ctxOf(req), name(req))); });
    router.post('/v1/parties/:name/resume', ...owner, validateBody(EmptyPartyBodySchema, config.nodeId), async (req, res) => { render(req, res, await resumeParty(ctxOf(req), name(req))); });
    router.get('/v1/parties/:name/reads', ...owner, async (req, res) => {
        const limit = Number(req.query.limit);
        render(req, res, await readsOfParty(ctxOf(req), name(req), Number.isFinite(limit) ? limit : undefined));
    });

    // ── The operator (D2.9) ──

    router.post('/v1/admin/parties/:owner/:name/stop', requireAuth(), requireOperator(storage), validateBody(PartyStopSchema, config.nodeId), async (req, res) => {
        const { reason } = (req.body ?? {}) as { reason?: string };
        render(req, res, await operatorSetStop(deps, String(req.params.owner), name(req), true, reason));
    });
    router.post('/v1/admin/parties/:owner/:name/resume', requireAuth(), requireOperator(storage), validateBody(PartyStopSchema, config.nodeId), async (req, res) => {
        render(req, res, await operatorSetStop(deps, String(req.params.owner), name(req), false));
    });

    return router;
}
