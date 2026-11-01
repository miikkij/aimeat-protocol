/**
 * @file src/routes/app-parties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's own users as outside parties of its owner (plan doc-mvwxcas3dom3, D4;
 *   services/app-parties/). Mounted by routes/app-members.ts, ahead of the parameterized app routes.
 * @structure
 *   - POST   /v1/apps/:owner/:filename/parties/signup        a person registers with an e-mail address (202)
 *   - POST   /v1/apps/:owner/:filename/parties/signin        a new sign-in link (202)
 *   - POST   /v1/apps/:owner/:filename/parties/verify        open a mailed link: the session
 *   - GET    /v1/apps/:owner/:filename/parties/me            the party's own standing (party token)
 *   - POST   /v1/apps/:owner/:filename/parties/signout       end every session of the party (party token)
 *   - GET    /v1/apps/:owner/:filename/parties/registration  whether the signup is open (public)
 *   - PUT    /v1/apps/:owner/:filename/parties/registration  the owner opens or closes it (app:manage)
 *   - GET    /v1/apps/:owner/:filename/parties               the registered people (app:write)
 *   - DELETE /v1/apps/:owner/:filename/parties/:name         remove one (app:manage)
 *   - GET|PUT|DELETE /v1/apps/:owner/:filename/party-data/:key   the party's own collection (party token)
 *   - PUT    /v1/apps/:owner/:filename/party-data-shared/:key    the app's shared collection (app:write)
 *   - GET    /v1/admin/app-party-registrations               the apps that asked (operator)
 *   - POST   /v1/admin/app-party-registrations/:owner/:filename   approve or refuse (operator)
 * @usage router.use(appPartiesRouter(config, storage))
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4.1 to D4.3).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperator } from '../auth/middleware.js';
import { requireScopeOrOwnApp } from '../auth/app-own-gate.js';
import { success, error } from '../middleware/envelope.js';
import { validateBody } from '../models/schemas.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
    AppPartySignupSchema, AppPartySigninSchema, AppPartyVerifySchema, AppPartyRegistrationSchema, AppPartyDataSchema,
    AppPartyDecisionSchema, EmptyBodySchema,
} from '../models/app-party-schemas.js';
import { signUp, signIn, verifyLink, partyMe, signOut, appPartyFromRequest, type AppPartyAnswer } from '../services/app-parties/service.js';
import { getRegistration, setRegistration, listAppParties, removeAppParty, listRegistrationRequests, decideRegistration } from '../services/app-parties/owner.js';
import { getPartyData, putPartyData, deletePartyData, putSharedData } from '../services/app-parties/data.js';
import { sendAppOp } from './app-op-answer.js';

const refOf = (req: Request) => ({ owner: String(req.params.owner ?? ''), filename: String(req.params.filename ?? '') });

export function appPartiesRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const deps = { storage, config };
    const send = (res: Response, out: AppPartyAnswer<Record<string, unknown>>) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.status(out.status ?? 200).json(success(config.nodeId, out.data));
    };
    /** The verified app party of the request, or null when the refusal was sent. */
    const partyOf = async (req: Request, res: Response) => {
        const v = await appPartyFromRequest(deps, refOf(req), req);
        if (!v.ok) { res.status(v.status).json(error(config.nodeId, v.code, v.message)); return null; }
        res.setHeader('Cache-Control', 'private, no-store');
        return v.ctx;
    };

    router.post('/v1/apps/:owner/:filename/parties/signup', validateBody(AppPartySignupSchema, config.nodeId), async (req, res) =>
        send(res, await signUp(deps, refOf(req), (req.body ?? {}) as Record<string, unknown>)));
    router.post('/v1/apps/:owner/:filename/parties/signin', validateBody(AppPartySigninSchema, config.nodeId), async (req, res) =>
        send(res, await signIn(deps, refOf(req), (req.body ?? {}) as Record<string, unknown>)));
    router.post('/v1/apps/:owner/:filename/parties/verify', validateBody(AppPartyVerifySchema, config.nodeId), async (req, res) =>
        send(res, await verifyLink(deps, refOf(req), (req.body ?? {}) as Record<string, unknown>)));
    router.get('/v1/apps/:owner/:filename/parties/me', async (req, res) => {
        const ctx = await partyOf(req, res);
        if (ctx) send(res, await partyMe(deps, ctx));
    });
    router.post('/v1/apps/:owner/:filename/parties/signout', validateBody(EmptyBodySchema, config.nodeId), async (req, res) => {
        const ctx = await partyOf(req, res);
        if (ctx) send(res, await signOut(deps, ctx));
    });

    router.get('/v1/apps/:owner/:filename/parties/registration', async (req, res) =>
        sendAppOp(res, config.nodeId, await getRegistration(deps, refOf(req))));
    router.put('/v1/apps/:owner/:filename/parties/registration', requireAuth(), requireScopeOrOwnApp('app:manage'), validateBody(AppPartyRegistrationSchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await setRegistration(deps, req.auth!, refOf(req), (req.body ?? {}) as Record<string, unknown>)));
    router.get('/v1/apps/:owner/:filename/parties', requireAuth(), requireScopeOrOwnApp('app:write'), async (req, res) =>
        sendAppOp(res, config.nodeId, await listAppParties(deps, req.auth!, refOf(req))));
    router.delete('/v1/apps/:owner/:filename/parties/:name', requireAuth(), requireScopeOrOwnApp('app:manage'), async (req, res) =>
        sendAppOp(res, config.nodeId, await removeAppParty(deps, req.auth!, refOf(req), String(req.params.name ?? ''))));

    router.get('/v1/apps/:owner/:filename/party-data/:key', async (req, res) => {
        const ctx = await partyOf(req, res);
        if (ctx) sendAppOp(res, config.nodeId, await getPartyData(deps, ctx, String(req.params.key ?? ''), { shared: req.query.shared === 'true' }));
    });
    router.put('/v1/apps/:owner/:filename/party-data/:key', validateBody(AppPartyDataSchema, config.nodeId), async (req, res) => {
        const ctx = await partyOf(req, res);
        if (ctx) sendAppOp(res, config.nodeId, await putPartyData(deps, ctx, String(req.params.key ?? ''), (req.body as { value?: unknown }).value));
    });
    router.delete('/v1/apps/:owner/:filename/party-data/:key', async (req, res) => {
        const ctx = await partyOf(req, res);
        if (ctx) sendAppOp(res, config.nodeId, await deletePartyData(deps, ctx, String(req.params.key ?? '')));
    });
    router.put('/v1/apps/:owner/:filename/party-data-shared/:key', requireAuth(), requireScopeOrOwnApp('app:write'), validateBody(AppPartyDataSchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await putSharedData(deps, req.auth!, refOf(req), String(req.params.key ?? ''), (req.body as { value?: unknown }).value ?? null)));

    router.get('/v1/admin/app-party-registrations', requireAuth(), requireOperator(storage), async (_req, res) =>
        sendAppOp(res, config.nodeId, await listRegistrationRequests(deps)));
    router.post('/v1/admin/app-party-registrations/:owner/:filename', requireAuth(), requireOperator(storage), validateBody(AppPartyDecisionSchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await decideRegistration(deps, resolveIdentity(req.auth!, config.nodeId), refOf(req), (req.body ?? {}) as Record<string, unknown>)));

    return router;
}
