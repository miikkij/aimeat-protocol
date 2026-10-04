/**
 * @file src/middleware/app-origin-sign-in.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app does not sign people in: the routes that create an account, start an owner
 *   session or hand back an owner credential refuse a request that comes from an app. An app gets a
 *   scoped grant through AIMEAT.auth.signIn() and the apex bridge, never the session (security DNA,
 *   boundary 4).
 *
 *   WHAT "FROM AN APP" MEANS. Three signals, each one the browser or the proxy sets and page script
 *   cannot:
 *   - the request arrived on the app host family (`req.appOrigin`, set by middleware/subdomain.ts
 *     from the Host nginx routed on). A password sign-in there used to answer with an owner JWT and
 *     an `aimeat_rt` cookie on the app's own origin, good for 90 days (found 2026-10-04 from
 *     aimeat-commercial's store);
 *   - the `Origin` header names a host in the app family. The family is same-site with the apex, so
 *     a credentialed fetch from an app to the apex login route set the apex session cookie: an app
 *     could sign its visitor in to an account the app controls (login CSRF);
 *   - the `Origin` header is `null`, which is what an app in the node's isolated frame sends. The
 *     SAML assertion consumer is exempt: an identity provider's form post can carry `Origin: null`
 *     under a strict referrer policy, and that post is a top-level navigation no frame can make.
 *
 *   A non-browser caller (the crew image at boot, an agent's HTTP client, curl) sends no Origin and
 *   reaches the node's own host, so nothing here applies to it.
 *
 *   The refusal is 403 APP_ORIGIN_SIGN_IN with the sentence an app author needs. The CORS middleware
 *   has already run, so an app can read it.
 *
 *   ROLLOUT. config.appOriginSignInRefuse (AIMEAT_APP_ORIGIN_SIGN_IN_REFUSE) is off by default:
 *   every request that would be refused is logged and let through. aimeat-commercial's store signed
 *   its buyers in with a password on its app origin and asked for the refusal to wait until it had
 *   moved to AIMEAT.auth.signIn() (2026-10-04). The default turns on once the log is quiet.
 * @structure SIGN_IN_ROUTES · isSignInRoute() · requestFromApp() · appOriginSignIn(config)
 * @usage app.use(appOriginSignIn(config));   // after corsMiddleware
 * @version-history
 *   v1.0.0 — 2026-10-04 — Initial.
 */
import type { RequestHandler, Request } from 'express';
import type { AimeatConfig } from '../config.js';
import { error } from './envelope.js';
import { logger } from '../utils/logger.js';

/**
 * The routes that create an account or hand back an owner credential (a session cookie, an owner
 * JWT, or an owner or agent private key). `method` null matches every method.
 */
const SIGN_IN_ROUTES: Array<{ method: string | null; path: RegExp }> = [
    { method: 'POST', path: /^\/v1\/ghii$/ },                       // registration
    { method: 'POST', path: /^\/v1\/ghii\/register-web$/ },
    { method: 'POST', path: /^\/v1\/ghii\/verify-email$/ },         // answers with an agent token and keys
    { method: null, path: /^\/v1\/ghii\/login(\/.*)?$/ },           // password, passkey, Google/Entra, SAML, attach-email
    { method: 'GET', path: /^\/v1\/ghii\/magic-link\/(open|verify)$/ },
    { method: 'POST', path: /^\/v1\/owners$/ },                     // returns the owner private key
    { method: 'POST', path: /^\/v1\/owners\/[^/]+\/recover$/ },
    { method: 'POST', path: /^\/v1\/auth\/refresh$/ },
    { method: 'POST', path: /^\/v1\/invitations\/[^/]+\/accept$/ },
];

/** A form post from an identity provider; see the file header. */
const SAML_ACS = /^\/v1\/ghii\/login\/saml\/[^/]+\/acs$/;

export function isSignInRoute(method: string, rawPath: string): boolean {
    const path = rawPath.replace(/\/+$/, '') || rawPath;
    return SIGN_IN_ROUTES.some(r => (r.method === null || r.method === method) && r.path.test(path));
}

/** The host of an Origin header, or null when it is absent, `null` or does not parse. */
function originHost(origin: string): string | null {
    try { return new URL(origin).hostname.toLowerCase(); } catch { return null; }   // eslint-disable-line aimeat/no-silent-catch -- an Origin that does not parse names no host
}

/** Which signal marks this request as coming from an app, or null when none does. */
export function requestFromApp(req: Request, config: AimeatConfig): 'app_host' | 'app_origin' | 'opaque_origin' | null {
    if (req.appOrigin) return 'app_host';
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    if (!origin) return null;
    if (origin === 'null') return SAML_ACS.test(req.path) ? null : 'opaque_origin';
    const appHost = (config.appHost || '').toLowerCase();
    if (!appHost) return null;
    const host = originHost(origin);
    return host && (host === appHost || host.endsWith(`.${appHost}`)) ? 'app_origin' : null;
}

export function appOriginSignIn(config: AimeatConfig): RequestHandler {
    return (req, res, next) => {
        if (!isSignInRoute(req.method, req.path)) { next(); return; }
        const from = requestFromApp(req, config);
        if (!from) { next(); return; }
        const refuse = config.appOriginSignInRefuse;
        logger.warn(refuse ? 'app-origin sign-in refused' : 'app-origin sign-in (would be refused; AIMEAT_APP_ORIGIN_SIGN_IN_REFUSE is off)',
            { path: req.path, method: req.method, from, origin: req.headers.origin ?? null });
        if (!refuse) { next(); return; }
        res.status(403).json(error(config.nodeId, 'APP_ORIGIN_SIGN_IN',
            'An app does not sign people in or create accounts itself. Call AIMEAT.auth.signIn() from a click: '
            + `the person signs in on ${config.baseUrl}, and the app gets a scoped grant. On later visits `
            + 'AIMEAT.auth.login() restores it with no click.'));
    };
}
