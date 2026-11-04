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
 *   - POST   /v1/apps/:owner/:filename/parties/:name/stop    stop one: its sign-in is refused (app:manage)
 *   - POST   /v1/apps/:owner/:filename/parties/:name/resume  let a stopped one in again (app:manage)
 *   - GET|PUT|DELETE /v1/apps/:owner/:filename/party-data/:key   the party's own collection (party token)
 *   - PUT    /v1/apps/:owner/:filename/party-data-shared/:key    the app's shared collection (app:write)
 *   - GET    /v1/admin/app-party-registrations               the apps that asked (operator)
 *   - POST   /v1/admin/app-party-registrations/:owner/:filename   approve or refuse (operator)
 * @usage router.use(appPartiesRouter(config, storage))
 * @version-history
 *   2026-11-04 — The party's own endpoints (me, signout, party-data) declare the credential strategy
 *     acceptCredential('app-party') instead of calling partyOf() first in each handler; same answers
 *     (codebase analysis 2026-11-03, item B8).
 *   v1.2.1 — 2026-11-03 — The signup 429 says what the limit is, why it exists, when to try again and
 *     which Config setting the operator raises (secaudit2026nov02d round 13b).
 *   v1.2.0 — 2026-11-02 — secaudit2026nov02d round 13: POST .../parties/signup takes
 *     consent.app_party_signups_per_hour signups an hour from one network address (30 by default, 0 = no
 *     limit); past it 429 RATE_LIMITED names the setting.
 *   v1.1.0 — 2026-11-01 — POST .../parties/{name}/stop and /resume (WP9d).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4.1 to D4.3).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { ipRateKey } from '../middleware/rate-limit.js';
import { rateBuckets } from '../services/rate-buckets.js';
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
import { signUp, signIn, verifyLink, partyMe, signOut, type AppPartyAnswer, type AppPartyCtx } from '../services/app-parties/service.js';
import { acceptCredential, credentialOf } from '../auth/credential-strategies.js';
import { getRegistration, setRegistration, listAppParties, removeAppParty, setAppPartyStatus, listRegistrationRequests, decideRegistration } from '../services/app-parties/owner.js';
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
    // The party's own endpoints declare acceptCredential('app-party') (auth/credential-strategies.ts),
    // which verifies the app party token for the route's app and answers the refusal; the handler reads the party.
    const partyOf = (req: Request): AppPartyCtx => credentialOf(req, 'app-party');

    // Signups one network address (IPv6 by its /64) may make in an hour over every app:
    // consent.app_party_signups_per_hour, 0 = no limit. Read on every request, so a saved value applies at once.
    const takeSignup = rateBuckets(3_600_000);
    const signupLimit = (req: Request, res: Response, next: NextFunction): void => {
        const max = config.appPartySignupsPerHour ?? 30;
        if (!(max > 0)) { next(); return; }
        const t = takeSignup(ipRateKey(req.ip ?? req.socket.remoteAddress), max);
        if (t.ok) { next(); return; }
        res.setHeader('Retry-After', t.retryAfterSec);
        res.setHeader('Cache-Control', 'no-store');
        res.status(429).json(error(config.nodeId, 'RATE_LIMITED',
            `Your network has made ${max} signups to apps on this server in the last hour, which is the most this server takes from one network in an hour. `
            + `The limit stops one network from filling the apps with signups. Try again in ${Math.ceil(t.retryAfterSec / 60)} minutes. `
            + 'Many people behind one network, for example a school, can ask the operator of this server to raise "Signups to apps from one address in an hour" in the admin settings, under Config.',
            429, { limit: max, retry_after_seconds: t.retryAfterSec, setting: 'consent.app_party_signups_per_hour', env: 'AIMEAT_APP_PARTY_SIGNUPS_PER_HOUR' }));
    };

    router.post('/v1/apps/:owner/:filename/parties/signup', signupLimit, validateBody(AppPartySignupSchema, config.nodeId), async (req, res) =>
        send(res, await signUp(deps, refOf(req), (req.body ?? {}) as Record<string, unknown>)));
    router.post('/v1/apps/:owner/:filename/parties/signin', validateBody(AppPartySigninSchema, config.nodeId), async (req, res) =>
        send(res, await signIn(deps, refOf(req), (req.body ?? {}) as Record<string, unknown>)));
    router.post('/v1/apps/:owner/:filename/parties/verify', validateBody(AppPartyVerifySchema, config.nodeId), async (req, res) =>
        send(res, await verifyLink(deps, refOf(req), (req.body ?? {}) as Record<string, unknown>)));
    router.get('/v1/apps/:owner/:filename/parties/me', acceptCredential('app-party', deps), async (req, res) => {
        send(res, await partyMe(deps, partyOf(req)));
    });
    router.post('/v1/apps/:owner/:filename/parties/signout', validateBody(EmptyBodySchema, config.nodeId), acceptCredential('app-party', deps), async (req, res) => {
        send(res, await signOut(deps, partyOf(req)));
    });

    router.get('/v1/apps/:owner/:filename/parties/registration', async (req, res) =>
        sendAppOp(res, config.nodeId, await getRegistration(deps, refOf(req))));
    router.put('/v1/apps/:owner/:filename/parties/registration', requireAuth(), requireScopeOrOwnApp('app:manage'), validateBody(AppPartyRegistrationSchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await setRegistration(deps, req.auth!, refOf(req), (req.body ?? {}) as Record<string, unknown>)));
    router.get('/v1/apps/:owner/:filename/parties', requireAuth(), requireScopeOrOwnApp('app:write'), async (req, res) =>
        sendAppOp(res, config.nodeId, await listAppParties(deps, req.auth!, refOf(req))));
    router.delete('/v1/apps/:owner/:filename/parties/:name', requireAuth(), requireScopeOrOwnApp('app:manage'), async (req, res) =>
        sendAppOp(res, config.nodeId, await removeAppParty(deps, req.auth!, refOf(req), String(req.params.name ?? ''))));
    router.post('/v1/apps/:owner/:filename/parties/:name/stop', requireAuth(), requireScopeOrOwnApp('app:manage'), validateBody(EmptyBodySchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await setAppPartyStatus(deps, req.auth!, refOf(req), String(req.params.name ?? ''), 'stopped')));
    router.post('/v1/apps/:owner/:filename/parties/:name/resume', requireAuth(), requireScopeOrOwnApp('app:manage'), validateBody(EmptyBodySchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await setAppPartyStatus(deps, req.auth!, refOf(req), String(req.params.name ?? ''), 'active')));

    router.get('/v1/apps/:owner/:filename/party-data/:key', acceptCredential('app-party', deps), async (req, res) => {
        sendAppOp(res, config.nodeId, await getPartyData(deps, partyOf(req), String(req.params.key ?? ''), { shared: req.query.shared === 'true' }));
    });
    router.put('/v1/apps/:owner/:filename/party-data/:key', validateBody(AppPartyDataSchema, config.nodeId), acceptCredential('app-party', deps), async (req, res) => {
        sendAppOp(res, config.nodeId, await putPartyData(deps, partyOf(req), String(req.params.key ?? ''), (req.body as { value?: unknown }).value));
    });
    router.delete('/v1/apps/:owner/:filename/party-data/:key', acceptCredential('app-party', deps), async (req, res) => {
        sendAppOp(res, config.nodeId, await deletePartyData(deps, partyOf(req), String(req.params.key ?? '')));
    });
    router.put('/v1/apps/:owner/:filename/party-data-shared/:key', requireAuth(), requireScopeOrOwnApp('app:write'), validateBody(AppPartyDataSchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await putSharedData(deps, req.auth!, refOf(req), String(req.params.key ?? ''), (req.body as { value?: unknown }).value ?? null)));

    router.get('/v1/admin/app-party-registrations', requireAuth(), requireOperator(storage), async (_req, res) =>
        sendAppOp(res, config.nodeId, await listRegistrationRequests(deps)));
    router.post('/v1/admin/app-party-registrations/:owner/:filename', requireAuth(), requireOperator(storage), validateBody(AppPartyDecisionSchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await decideRegistration(deps, resolveIdentity(req.auth!, config.nodeId), refOf(req), (req.body ?? {}) as Record<string, unknown>)));

    return router;
}
