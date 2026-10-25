/**
 * @file src/middleware/content-access-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A node set to `contentAccess: 'signed-in'` serves nothing to a caller who is not an
 *   account of THIS node (plan doc-mvcn6c7e4e5q, V1). Deny by default: every request passes through
 *   here after optionalAuth, and one that is not from an account of this node answers 401
 *   SIGN_IN_REQUIRED unless its route is on OPEN_ROUTES, the short list that sign-in, registration
 *   and the machine connections need to work at all.
 *
 *   WHY DENY BY DEFAULT. The alternative, a check in each route that serves content, is how the
 *   node got here: a dozen content kinds, each with its own idea of public, and a new route open
 *   until someone remembers it. Here a new route is closed until someone adds it to the list, and
 *   test/e2e-content-access-gate.ts walks every route the code declares and fails on one that
 *   answers a stranger without being on it.
 *
 *   WHAT STAYS OPEN, AND WHY IT HOLDS NO CONTENT.
 *   - The SPA shell and its page addresses. A browser keeps its session in localStorage, so a page
 *     load carries no credential even for a signed-in person, and refusing the shell would lock
 *     everyone out. The shell holds no content in this mode: serveSpa drops the live page bodies and
 *     the per-person heads (routes/portal-spa.ts), and every byte of content comes from an API call,
 *     which this gate refuses.
 *   - Sign-in, registration, invitations, recovery, OAuth and MCP discovery, device authorization,
 *     the app-grant steps, setup. They are how a person or an agent becomes an account here.
 *   - Routes that carry a credential of their own in the address or the body: presigned download
 *     and upload tokens, unsubscribe links, the document-signing wallet, connection media, SCIM's
 *     own bearer, payment webhooks (signed), federation (signed by the peer; the federation policy
 *     decides what a peer gets).
 *   - The node's own description for machines: health, build, llms.txt, the API contract, the
 *     served libraries' code. None of it names a person, an organism or an app.
 *
 *   THE OTHER ORIGINS. An app origin serves the app page itself, and the app gate asks for a
 *   sign-in grant from the apex before it does (routes/subdomains.ts, appIsRestricted); a welcome
 *   page or company origin serves its page `/` the same way, on a page grant (routes/page-open.ts).
 *   Each of them also passes the open routes under /v1/ (the served libraries, the sign-in steps),
 *   which hold no content; everything else there, the per-app documents included, answers 404. The
 *   page host serves only what a frame token names, and a token is minted only after the page's own
 *   gate, which in this mode admits accounts only.
 *
 *   THE WATCHED EXCEPTION. An app opened to the internet (services/internet-opening/) is served to
 *   everyone with the forms it declares, on an operator's approval or by an owner the node lets open
 *   on their own; who opened it, why and until when is recorded and listed for the operators.
 * @structure OPEN_ROUTES · isOpenRoute() · openedAppRead() · contentAccessGate(config)
 * @usage app.use(contentAccessGate(config));   // after optionalAuth, CORS and appOriginSignIn
 * @version-history
 *   v1.4.0 — 2026-10-25 — An app opened to the internet (services/internet-opening/) is the watched
 *     exception: its apex read, its own origin's documents and the public intake routes of the forms
 *     it declares pass. Its other data calls stay closed. The list of openings is in memory
 *     (opening-registry.ts), so a node with none pays one map lookup.
 *   v1.3.0 — 2026-10-19 — Open: the node's own documents the showroom pages link to (site map, page
 *     mirrors, glossary, AI transparency statement, provenance schema, API reference page), the
 *     outbound connection callback and the live stream (its ticket is its credential). A signed-in
 *     person's new tab, an EventSource or the provider's redirect carries no session, so each
 *     answered 401 (signed-in browser audit, scripts/check-signed-in-browser.mjs).
 *   v1.2.0 — 2026-10-19 — An app, welcome-page or company origin passes the served libraries and the
 *     sign-in steps (open routes under /v1/), and a welcome-page or company origin passes its page to
 *     the route that checks the page grant. The app origin answered /v1/libs/* 404, so every app that
 *     loads aimeat-auth.js or aimeat-data.js lost its person; the page origins answered 404 even to a
 *     person holding a page grant (seen on innokas.aimeat.io).
 *   v1.1.0 — 2026-10-19 — A browser navigation to the apex app read goes to /v1/app-open instead of
 *     the 401: a new tab carries no session, so every app's Open answered a signed-in person 401
 *     (seen on innokas.aimeat.io). API callers and the app's sub-routes keep the 401.
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V1).
 */
import type { RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import { signedInOnly } from '../config-visibility.js';
import { isNodeAccount } from '../services/audience.js';
import { mirroredPages } from '../data/public-pages.js';
import { localAccountName } from '../utils/gaii.js';
import type { Storage } from '../storage/interface.js';
import {
  anyOpenings, isAppOpenToInternet, isOpenedIntakeRoute, isTargetOpenToInternet,
} from '../services/internet-opening/opening-registry.js';
import { error } from './envelope.js';

/** `method` null matches every method. A path is matched whole, after its trailing slashes go. */
export const OPEN_ROUTES: ReadonlyArray<{ method: string | null; path: RegExp; why: string }> = [
  // ── The SPA shell and its page addresses (no content in this mode, see the header) ──
  { method: 'GET', path: /^\/$/, why: 'the front page shell' },
  { method: 'GET', path: /^\/(spa|app-silent|app-catalog)\.html$/, why: 'shell files' },
  { method: 'GET', path: /^\/(everything|start)$/, why: 'redirects to shell pages' },
  { method: 'GET', path: /^\/v1\/(portal|profile|chat|home|aimeat-os|app-store|classic|portfolio|fleet|members|admin|appcat|help|publicknowledgeviewer|publicworkspaceviewer|how-it-works|changelog|how-an-app-builds|connect-your-ai|everything|glossary|business|transparency|start|app-grant|app-open|invite|oauth-round|allow|echat)$/, why: 'SPA page addresses' },
  { method: 'GET', path: /^\/v1\/design-lab\/frame$/, why: 'SPA page address' },
  // A person's portfolio PAGE, never the portfolio API beside it (catalog, config, data, me, members).
  { method: 'GET', path: /^\/v1\/portfolio\/(?!(catalog|config|data|me|members|upload)$)[^/]+$/, why: 'SPA page address; the shell drops the person from the head in this mode' },
  { method: 'GET', path: /^\/v1\/use-with-ai\/[^/]+\/[^/]+$/, why: 'SPA page address; the shell drops the app from the head in this mode' },
  { method: 'GET', path: /^\/v1\/(connect|privacy|terms)(\/[^/]+)?$/, why: 'operator-written pages' },
  { method: 'GET', path: /^\/v1\/admin\/(ui|setup)$/, why: 'admin shell and first-run setup page' },
  { method: 'GET', path: /^\/v1\/agents\/verify$/, why: 'device authorization consent page' },
  { method: 'GET', path: /^\/v1\/oauth\/consent$/, why: 'OAuth consent page' },
  { method: 'GET', path: /^\/v1\/site\/header-nav$/, why: 'the operator\'s navigation' },
  { method: 'GET', path: /^\/v1\/portal\/(cookie-consent\.js|platforms|prompts|prompts\/[^/]+|prompt\/[^/]+)$/, why: 'the node\'s connect prompts and consent script' },
  { method: 'GET', path: /^\/(favicon\.(ico|svg)|sw\.js|app-frame(-core)?\.js|robots\.txt)$/, why: 'static files' },
  { method: 'GET', path: /^\/[A-Za-z0-9_-]+\.txt$/, why: 'domain verification files' },
  { method: 'GET', path: /^\/docs\/specs\/[^/]+$/, why: 'protocol specifications' },
  // ── Sign-in, registration, recovery ──
  { method: null, path: /^\/v1\/auth\/(?!anonymous$).+$/, why: 'sessions, tokens, providers, the silent app grant (cookie-borne)' },
  { method: 'POST', path: /^\/v1\/ghii$/, why: 'registration' },
  { method: 'POST', path: /^\/v1\/owners$/, why: 'registration by API' },
  { method: null, path: /^\/v1\/ghii\/login(\/.*)?$/, why: 'password, passkey, provider and SAML sign-in' },
  { method: null, path: /^\/v1\/ghii\/magic-link(\/.*)?$/, why: 'sign-in links' },
  { method: 'POST', path: /^\/v1\/ghii\/(register-web|verify-email|totp\/verify|account\/recover|email\/(verify|confirm)|password\/(reset|reset-request))$/, why: 'registration, second factor and recovery' },
  { method: 'GET', path: /^\/v1\/ghii\/username-available$/, why: 'registration form' },
  { method: null, path: /^\/v1\/ghii\/verify\/(ftn|eudiw)(\/.*)?$/, why: 'identity verification callbacks' },
  { method: 'POST', path: /^\/v1\/registration-invites$/, why: 'asking for an invitation' },
  { method: null, path: /^\/v1\/invitations\/[^/]+(\/accept)?$/, why: 'accepting an invitation (token in the address)' },
  { method: null, path: /^\/v1\/setup\/(status|wizard|init)$/, why: 'first-run setup' },
  { method: null, path: /^\/v1\/admin\/setup(\/(auth|register|token))?$/, why: 'first-run operator setup' },
  { method: null, path: /^\/v1\/scim\/v2\/.+$/, why: 'SCIM provisioning (its own bearer)' },
  { method: 'GET', path: /^\/v1\/sso\/[^/]+\/metadata$/, why: 'SAML service provider metadata' },
  // ── Agents and apps becoming principals ──
  { method: null, path: /^\/(mcp|v1\/mcp|v2\/mcp\/[^/]+)$/, why: 'MCP endpoints answer their own 401 with the OAuth pointer' },
  { method: null, path: /^\/v1\/mcp\/(register|authorize|authorize-consent|token|token\/revoke)$/, why: 'MCP OAuth' },
  { method: 'GET', path: /^\/\.well-known\/(oauth-authorization-server|oauth-protected-resource(\/.*)?|aimeat|api-catalog|did\.json|http-message-signatures-directory)$/, why: 'OAuth and node discovery, signature keys' },
  { method: 'POST', path: /^\/v1\/agents\/(device-authorize|device-token|verify)$/, why: 'device authorization (RFC 8628)' },
  { method: 'GET', path: /^\/v1\/agents\/(device-authorize\/pending|verify\/info\/[^/]+)$/, why: 'device authorization' },
  { method: 'POST', path: /^\/v1\/agents\/v2\/token$/, why: 'agent token' },
  { method: null, path: /^\/v1\/app-grants\/(scopes|authorize|authorize-consent|token|request\/[^/]+)$/, why: 'app grant steps' },
  { method: null, path: /^\/v1\/oauth-rounds\/[^/]+(\/approve)?$/, why: 'a sign-in round an agent started' },
  // ── Routes that carry their own credential ──
  { method: 'GET', path: /^\/v1\/download\/[^/]+$/, why: 'presigned download token' },
  { method: 'PUT', path: /^\/v1\/upload\/[^/]+$/, why: 'presigned upload token' },
  { method: 'GET', path: /^\/v1\/connections\/media\/[^/]+\/[^/]+$/, why: 'connection media token' },
  { method: null, path: /^\/v1\/outbound\/unsubscribe$/, why: 'unsubscribe token' },
  { method: null, path: /^\/v1\/docsign\/wallet(\/.*)?$/, why: 'document-signing wallet session' },
  { method: 'POST', path: /^\/$/, why: 'document-signing wallet response' },
  { method: 'POST', path: /^\/v1\/commerce\/webhooks\/.+$/, why: 'payment webhooks (signed)' },
  // Federation: the protocol messages a peer signs (POST), and the GETs a handshake needs. The public
  // federation reads (directory, catalogue, book, packages, templates, stats) list this node's
  // people and content, so on this node they answer a signed-in account only.
  { method: 'POST', path: /^\/v1\/federation\/.+$/, why: 'federation protocol messages (signed by the peer; the federation policy decides)' },
  { method: 'GET', path: /^\/v1\/federation\/(node-card|peer\/(introduce|request)\/[^/]+\/status)$/, why: 'federation handshake' },
  // ── The node describing itself to machines (no person, organism or app named) ──
  { method: 'GET', path: /^\/v1\/(health|build)$/, why: 'health and build' },
  { method: 'GET', path: /^\/v1\/spec$/, why: 'the API reference page (the contract, no content)' },
  { method: 'GET', path: /^\/(llms|llms-full)\.txt$/, why: 'the node\'s own agent guide' },
  { method: 'GET', path: /^\/(auth\.md|skill\.md|agents\.txt|openapi\.json|AGENTS\.md)$/, why: 'the node\'s own agent documents' },
  { method: 'GET', path: /^\/v1\/libs(\/.*)?$/, why: 'served library code' },
  // The node's own documents the showroom pages link to (a signed-in person's new tab carries no
  // session, so these answered a raw 401): the site map, the markdown mirrors of the authored pages
  // (data/public-pages.ts), the glossary, the AI transparency statement and the provenance schema.
  // Each is built from the code or the operator's config; none names a person, an organism or an app.
  { method: 'GET', path: /^\/sitemap\.md$/, why: 'the node\'s site map (a fixed list of its pages)' },
  { method: 'GET', path: pageMirrors(), why: 'markdown mirrors of the authored pages' },
  { method: 'GET', path: /^\/v1\/glossary\.(md|json)$/, why: 'the glossary (fixed terms)' },
  { method: 'GET', path: /^\/v1\/ai-transparency(\.md)?$/, why: 'the AI transparency statement (from config)' },
  { method: 'GET', path: /^\/v1\/schemas\/ai-provenance\/v1\.json$/, why: 'the provenance record schema' },
  // The provider sends the browser back here at the end of connecting a mail account; the browser
  // carries no session, and the route's own gates are the single-use state and the round cookie.
  { method: 'GET', path: /^\/v1\/connections\/callback$/, why: 'outbound connection callback (single-use state and round cookie)' },
  // An EventSource sends no Authorization header: the stream's credential is the single-use ticket in
  // the address, which POST /v1/events/ticket mints for a signed-in caller behind this gate.
  { method: 'GET', path: /^\/v1\/events$/, why: 'the live stream (single-use ticket from a gated route)' },
  { method: 'GET', path: /^\/v1\/docs$/, why: 'the API reference page (reads the contract, no content)' },
];

/** The markdown mirror paths, exactly as routes/markdown-mirrors.ts registers them. */
function pageMirrors(): RegExp {
  const paths = ['/.md', ...mirroredPages().map(p => (p.path === '/' ? '/index.md' : `${p.path}.md`))];
  return new RegExp(`^(${paths.map(p => p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
}

export function isOpenRoute(method: string, rawPath: string): boolean {
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  const m = method === 'HEAD' ? 'GET' : method;
  return OPEN_ROUTES.some(r => (r.method === null || r.method === m) && r.path.test(path));
}

/** The paths an app origin serves in this mode: the app page itself, which asks for a grant. */
const APP_ORIGIN_PAGE = /^\/([^/]+\/[^/]+\.html?)?$/i;

/**
 * The apex app read, GET /v1/apps/:owner/:filename, with the characters an owner name and an app
 * filename are made of, so the segments go into the query without decoding. `ui/catalogue` is a list
 * route of the same shape.
 */
const APEX_APP_READ = /^\/v1\/apps\/([\w.@~-]+)\/([\w.~-]+)$/;

/**
 * A browser navigation to the apex app read goes to the open page, which holds the session the tab
 * could not carry (routes/apps/open.ts appOpenPage). The store's Open, a feed or notification link and
 * a version link all open a new tab on this address, and a new tab sends no credential even for a
 * signed-in person, so a 401 here broke every app on a signed-in-only node. The redirect names only
 * the address the browser asked for; the open page asks POST .../open with the session, which decides.
 */
function appOpenRedirect(method: string, path: string, accept: string | undefined): string | null {
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (!(accept ?? '').includes('text/html')) return null;
  const m = APEX_APP_READ.exec(path);
  if (!m || (m[1] === 'ui' && m[2] === 'catalogue')) return null;
  return `/v1/app-open?app=${encodeURIComponent(`${m[1]}/${m[2]}`)}`;
}

/** True for GET /v1/apps/:owner/:filename of an app opened to the internet. */
function openedAppRead(method: string, path: string): boolean {
  if ((method !== 'GET' && method !== 'HEAD') || !anyOpenings()) return false;
  const m = APEX_APP_READ.exec(path);
  return !!m && isAppOpenToInternet(localAccountName(m[1]), m[2]);
}

export function contentAccessGate(
  config: AimeatConfig,
  /** The storage, read late: the server builds it after it mounts this gate (server.ts). */
  storageOf?: () => Pick<Storage, 'getSubdomainSite'> | null,
): RequestHandler {
  return async (req, res, next) => {
    if (!signedInOnly(config) || req.method === 'OPTIONS') return next();
    if (isNodeAccount(req.auth)) return next();
    if (req.pageOrigin) return next();   // the page host: a frame token names what it serves
    // An app opened to the internet (services/internet-opening/) submits to the forms it declares,
    // on the apex as the intake library calls them; the routes there apply their own guards.
    if (isOpenedIntakeRoute(req.method, req.path)) return next();
    if (req.appOrigin || req.portfolioOrigin || req.coOrigin) {
      // The page itself goes to its route, which serves it only on a grant and sends a browser
      // without one to the open page (routes/subdomains.ts, routes/page-open.ts). A welcome page or
      // a company page has only `/`.
      const page = req.appOrigin ? APP_ORIGIN_PAGE.test(req.path) : req.path === '/';
      if (req.method === 'GET' && page) return next();
      // The origin of an app opened to the internet also serves its own documents (the legal pages,
      // llms.txt, the manifest) as on an open node. Its data calls under /v1/ stay closed. The
      // origin's app is one keyed read, made only while some app is open.
      const storage = storageOf?.();
      if (req.appOrigin && storage && req.subdomain && anyOpenings()
        && (req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/v1/')) {
        const site = await storage.getSubdomainSite(req.subdomain);
        if (site && site.enabled && site.kind === 'app' && isTargetOpenToInternet(site.target)) return next();
      }
      // The page loads the served libraries and signs in from its own origin. Those routes hold no
      // content and are open on the apex too; the origin's own documents (llms.txt, AGENTS.md, the
      // legal pages) are outside /v1/ and stay closed.
      if (req.path.startsWith('/v1/') && isOpenRoute(req.method, req.path)) return next();
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found'));
      return;
    }
    if (isOpenRoute(req.method, req.path)) return next();
    // The apex read of an app opened to the internet: the route serves it as on an open node
    // (routes/apps/read.ts asks appAudience, which answers anyone for it).
    if (openedAppRead(req.method, req.path)) return next();
    const openPage = appOpenRedirect(req.method, req.path, req.headers.accept);
    if (openPage) {
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, openPage);
      return;
    }
    res.status(401).json(error(config.nodeId, 'SIGN_IN_REQUIRED',
      'This node shows its content to its own signed-in accounts only. Sign in, or connect your AI to this node, and ask again.'));
  };
}
