/**
 * @file app-grants.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Explicit, scoped, user-approved grants that let a user-published app (running on
 *   the isolated app origin, `*.apps.<apex>`) access the granting owner's data with a narrow,
 *   revocable token instead of the ambient session (closes H-2's "apps get the session" half).
 *   An OAuth-like, PKCE-protected code flow mirroring the MCP OAuth flow:
 *     app → GET /v1/app-grants/authorize → (owner approves on aimeat.io) → code → app exchanges
 *     it at POST /v1/app-grants/token for a short scoped access JWT (roles:['app'], the granted
 *     agent scopes, an `app_grant` claim) + a rotating refresh token bound to a persistent
 *     AppGrantRecord. The token resolves to the OWNER's data identity (sub = owner GHII) but,
 *     because role is 'app' (not 'owner'), requireScope still enforces the granted scopes — so
 *     the blast radius is exactly what the user approved, never the full session.
 * @structure
 *   - APP_GRANTABLE_SCOPES — the scope vocabulary an app may request (+ i18n-able descriptions)
 *   - in-memory pendingRequests / authCodes maps (short-TTL, like MCP auth codes)
 *   - appGrantsRouter(config, storage): GET /authorize, GET /request/:id, POST /authorize-consent,
 *     POST /token, GET /v1/app-grants, DELETE /v1/app-grants/:grantId
 * @usage app.use(appGrantsRouter(config, storage));
 * @version-history
 *   v1.11.0 — 2026-08-17 — Consent rows carry `description_keys`: the ordered locale-key chain the
 *     consent UI already resolves client-side (consent-vocab.js), served so API consumers can
 *     localize the sentence instead of hardcoding the English `description`. Display metadata only,
 *     never part of the gate; the validation vocabulary (the APP_GRANTABLE_SCOPES keys) is untouched.
 *   v1.10.0 — 2026-08-11 — Security audit 1-later-c, step ONE of three: `app:write` joins
 *     APP_GRANTABLE_SCOPES, so an app can ask to publish under its owner's name and the owner can
 *     refuse. Publishing was reachable on an app-grant token and missing from this vocabulary, which
 *     is why no owner had ever been asked. Nothing enforces it yet, and the ordering matters: the
 *     entry's own comment names what has to be true before the publish doors may require it.
 *   v1.9.0 — 2026-08-10 — Security audit H-9: a token minted for a PORTFOLIO origin is capped at the
 *     ceiling the node already publishes for that origin (memory:read). The silent bridge took the
 *     own-app branch and granted whatever the page asked for, and a portfolio page writes that ask
 *     itself. Narrows the escalation; the unconditional own-app branch behind it is untouched.
 *   v1.8.0 — 2026-08-10 — Security audit C-1: the silent bridge now refuses any caller that is not the
 *     apex page. It reads the session cookie and takes the app's identity from `?origin=`, and app
 *     origins are same-site with the apex, so any published app could ask for, and read back, a
 *     scoped token minted for a visiting owner. `Sec-Fetch-Site` separates the apex bridge
 *     (`same-origin`) from an app origin (`same-site`); both header names are script-forbidden.
 *   v1.4.0 — 2026-07-28 — `contract:spend` + a per-app ceiling (PATCH /:grantId/spend-cap). Reading your
 *     data and buying with your money are separate favours, and the useful answer to the second is an
 *     amount rather than a yes. The token now carries the app's own id so the caller can be NAMED.
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phase 3: explicit scoped app grants).
 *   v1.1.0 — 2026-06-20 — Add silent SSO bridge GET /v1/auth/app-grant-silent: when the owner is
 *     logged into the apex, their own app (bound by its per-app subdomain origin) gets a scoped
 *     grant token with no visible login (same-site iframe + postMessage). Others → consent_required.
 *   v1.2.0 — 2026-06-26 — Silent bridge reply includes the owner's display_name so the app login pill
 *     can show a human label instead of the raw GHII (non-sensitive; '' when unset).
 *   v1.3.0 — 2026-07-03 — Silent bridge accepts the portfolio origin family
 *     (`<username>.portfolio.<apex>` → grant target `portfolio:<username>`): the owner
 *     visiting their OWN standalone portfolio auto-gets a scoped token (members data
 *     works); other visitors get consent_required and stay logged out — the visible
 *     authorize flow still resolves app targets only.
 *   v1.4.0 — 2026-07-07 — Add task:read/task:write + workflow:read/workflow:write to
 *     APP_GRANTABLE_SCOPES so a control-plane app (TARGET-006 AGENCY) can orchestrate the owner's
 *     OWN agents/automations with explicit consent. Enforcement stays in the task routes
 *     (owner-match) + requireScope on workflow routes — never cross-owner, never a scope escalation.
 *   v1.5.0 — 2026-07-19 — Own-app parity for the VISIBLE flow (Band Jam scope-upgrade findings):
 *     authorize validates that a per-app-subdomain redirect_uri maps to exactly the requesting app
 *     (else INVALID_REDIRECT_URI — app X can no longer run the flow in app Y's name) and records
 *     originBound; GET /request/:id exposes app_owner + origin_bound so the consent page can
 *     auto-approve the owner's OWN app (silent-bridge policy); the authorization_code token
 *     response carries app + own so the SDK's pill/gear metadata stays correct via this path too.
 *   v1.6.0 — 2026-07-25 — One live grant per (owner, app). The authorization_code exchange upserts
 *     instead of always creating: it used to stack a new row on every silent auto-approval (own app
 *     / already-covered scopes), so grants accumulated — 86 on one account — and since only the
 *     newest row kept a live refresh hash, the stale ones showed in the Access tab as active access
 *     that nothing could use. Both consent paths now resolve the live grant via a direct
 *     getAppGrantByOwnerAndApp lookup, and a partial unique index enforces the invariant in the DB.
 *   v1.7.0 — 2026-07-27 — GET /request/:id also returns app_icon + app_description (from the app
 *     manifest, already loaded in authorize — no extra query). The consent screen showed a stranger
 *     nothing but a name, a raw origin and a wall of scope boxes; the icon/monogram and the app's
 *     own one-liner give them something to decide ON. Display-only, never part of the gate.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { issueJWT } from '../auth/jwt.js';
import { readRefreshCookie } from '../services/owner-session.js';
import { PORTFOLIO_TARGET_PREFIX, resolveAppOriginTarget } from '../services/app-origin-target.js';
import { parseAppScopes } from '../services/protected-resource.js';
import { logger } from '../utils/logger.js';

import { APP_GRANTABLE_SCOPES } from './app-grant-vocabulary.js';
export { APP_GRANTABLE_SCOPES };

/**
 * Ordered locale-key candidates for one scope's consent sentence. The consent UI localizes
 * client-side (public/js/consent-vocab.js applies this exact chain); this is served so an API
 * consumer can localize the same way instead of hardcoding the English `description`. The
 * app-context override tree wins over the shared agent sentence tree; the first key that exists in
 * the locale file is the sentence.
 */
export function scopeDescriptionKeys(scope: string): string[] {
  const [family, perm] = scope.split(':');
  return [
    `appGrant.scopeText.${family}.${perm}`,
    `profile.agents.scopeUi.scopeText.${family}.${perm}`,
  ];
}

/**
 * The most a token minted for a PORTFOLIO origin may carry.
 *
 * A portfolio origin exists for one job: the owner visiting their own published page sees their own
 * members-only content there without logging in a second time. Reading memory is all that takes, and
 * the node already publishes exactly this answer twice — `services/protected-resource.ts` returns
 * `scopes_supported: ['memory:read']` for a portfolio origin, and `routes/subdomains.ts` injects a
 * matching `<meta name="aimeat-scopes" content="memory:read">` into every portfolio it serves. Both
 * of those still write the word out inline; when either is next touched, import it from here, so the
 * ceiling has one home instead of three.
 */
export const PORTFOLIO_GRANT_SCOPES: readonly string[] = ['memory:read'];

/** Is this grant target a portfolio origin rather than a published app? */
function isPortfolioTarget(target: string): boolean {
  return target.startsWith(PORTFOLIO_TARGET_PREFIX);
}

/**
 * What the app at this grant target declares TODAY, or null when it says nothing.
 *
 * `<meta name="aimeat-scopes">` is the app's own statement of what it will ask for, and it is the
 * only place the answer lives — the publish path does not copy it onto the app record. Reading it
 * from the stored bytes costs one row and no HTTP.
 *
 * Null, not the empty list, when the app declares nothing: an app with no tag has made no statement,
 * and a caller must be able to tell that apart from "asks for nothing".
 */
async function declaredScopesOf(storage: Storage, target: string): Promise<string[] | null> {
  if (isPortfolioTarget(target)) return null;
  const slash = target.indexOf('/');
  if (slash <= 0 || slash === target.length - 1) return null;
  const owner = target.slice(0, slash);
  const filename = target.slice(slash + 1);
  const bare = owner.includes('@') ? owner.split('@')[0] : owner;
  const app = await storage.getAppByOwnerName(bare, filename).catch(err => {
    logger.warn('app-grants: could not read the app behind a grant target', { target, error: String(err) });
    return null;
  });
  if (!app) return null;
  const data = app.data as Buffer | Uint8Array | string;
  const html = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
  const declared = parseAppScopes(html);
  return declared.length ? declared : null;
}

/**
 * Trim a scope request down to what a portfolio origin may receive.
 *
 * AUDIT H-9. The silent bridge used to hand a portfolio whatever the PAGE asked for, and a portfolio
 * page writes that ask itself, twice over: the SDK reads the FIRST `<meta name="aimeat-scopes">`
 * while the node appends its own last, and a page can skip the SDK and build the /app-silent.html
 * iframe with any `?scope=` it likes. Portfolio HTML is served with `unsafe-inline`, so any script
 * that lands in a portfolio inherits that reach, and the inner fetch is apex-to-apex, so the
 * `Sec-Fetch-Site` caller check does not see it. The ceiling was the node's published answer already;
 * the bridge was the one door not reading it.
 *
 * A scope outside the ceiling is dropped rather than refused, and an empty result falls back to the
 * ceiling, so the members-only content the origin exists for keeps working either way.
 *
 * This NARROWS the escalation, it does not close it. A standing memory:read grant reaches the
 * owner's whole namespace, which is a lot of data, and a page holding that token can post it
 * anywhere `connect-src https:` allows. The root is the unconditional own-app branch in the silent
 * bridge, which hands any origin the owner happens to own whatever it asks for, and replacing that
 * with something the owner actually decides is a larger piece of work than this cap.
 */
function capPortfolioScopes(requested: string[]): string[] {
  const capped = requested.filter(s => PORTFOLIO_GRANT_SCOPES.includes(s));
  return capped.length ? capped : [...PORTFOLIO_GRANT_SCOPES];
}

const CODE_TTL_MS = 60_000;        // authorization code: single-use, 60s
const REQUEST_TTL_MS = 10 * 60_000; // pending authorize request awaiting consent: 10 min

interface PendingRequest {
  requestId: string;
  app: string;          // owner/filename
  appName: string;
  appIcon: string;      // manifest icon (emoji or URL); '' → consent page draws a monogram
  appDescription: string; // manifest description — the "what is this" line for a first-time visitor
  appOrigin: string;    // origin of redirect_uri (shown to user, bound into the grant)
  scopes: string[];
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256' | 'plain';
  responseMode: 'query' | 'web_message'; // web_message → consent page postMessages the code to the popup-opener app
  manage: boolean; // true → consent page always shows the management screen (gear); false → may auto-approve an existing grant
  originBound: boolean; // redirect_uri verified to be THE per-app subdomain mapped to this app → own-app auto-approve eligible
  expiresAt: number;
}

interface AuthCode {
  code: string;
  app: string;
  appName: string;
  appOrigin: string;
  owner: string;        // bare owner name
  gaii: string;         // owner GHII the token resolves to
  scopes: string[];
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256' | 'plain';
  own: boolean;         // origin-bound request approved by the app's own owner (parity with the silent bridge's `own`)
  expiresAt: number;
}

/** SHA-256 hex (refresh-token storage). */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** PKCE verification. S256 (default): base64url(sha256(verifier)) === challenge. plain: verifier ===
 *  challenge (used only by non-secure-context clients without crypto.subtle; real app origins use S256). */
function verifyPkce(codeVerifier: string, codeChallenge: string, method: 'S256' | 'plain' = 'S256'): boolean {
  if (method === 'plain') return codeVerifier === codeChallenge;
  const computed = createHash('sha256').update(codeVerifier).digest('base64url');
  return computed === codeChallenge;
}

/** The node's own origin (scheme + host + port), lowercased — what a same-origin caller's `Origin`
 *  header says when it is present. '' when baseUrl is unparseable, which then matches nothing. */
function apexOrigin(config: AimeatConfig): string {
  // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer: an unparseable baseUrl has no origin
  try { return new URL(config.baseUrl).origin.toLowerCase(); } catch { return ''; }
}

export function appGrantsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  const pendingRequests = new Map<string, PendingRequest>();
  const authCodes = new Map<string, AuthCode>();

  /**
   * The stored scopes, trimmed to what the app declares now — or null when nothing changes.
   *
   * Only ever removes. An app that gained a permission in its manifest has to go through the consent
   * screen for it, and a refresh is not consent. An app that declares nothing is left as it is.
   */
  async function narrowToDeclaration(target: string, stored: string[]): Promise<string[] | null> {
    const declared = await declaredScopesOf(storage, target);
    if (!declared) return null;
    const kept = stored.filter(s => declared.includes(s));
    return kept.length === stored.length ? null : kept;
  }

  // Sweep expired entries lazily on each authorize/token call (cheap; bounded maps).
  function sweep() {
    const now = Date.now();
    for (const [k, v] of pendingRequests) if (v.expiresAt <= now) pendingRequests.delete(k);
    for (const [k, v] of authCodes) if (v.expiresAt <= now) authCodes.delete(k);
  }

  /** redirect_uri must be an absolute http(s) URL on the app origin — never the apex. */
  function validRedirect(uri: string): { ok: true; origin: string } | { ok: false } {
    let u: URL;
    try { u = new URL(uri); } catch { return { ok: false }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false };
    const host = u.hostname.toLowerCase();
    const appHost = (config.appHost || '').toLowerCase();
    if (appHost) {
      // Must be the app host or a per-app subdomain of it — never the apex SPA origin.
      if (host !== appHost && !host.endsWith('.' + appHost)) return { ok: false };
    } else {
      // No app origin provisioned (dev): only allow localhost so the flow is testable.
      if (host !== 'localhost' && host !== '127.0.0.1') return { ok: false };
    }
    return { ok: true, origin: u.origin };
  }

  // ── GET /v1/app-grants/scopes ── the grantable scope vocabulary, machine-readable + public.
  // Apps and agentic coders check this BEFORE declaring <meta name="aimeat-scopes">: requesting
  // ANY name outside the vocabulary fails the whole authorize with INVALID_SCOPE, and guessing
  // names by analogy (storage:delete) is the #1 way that happens (AEB-2 finding). File deletion
  // is intentionally covered by storage:write — overwriting is equally destructive, so the
  // consent line "save and update your files" already covers it; there is no storage:delete.
  router.get('/v1/app-grants/scopes', (_req: Request, res: Response) => {
    const DEFAULT_SCOPES = ['memory:read', 'memory:write', 'storage:read', 'storage:write'];
    res.json(success(config.nodeId, {
      scopes: Object.entries(APP_GRANTABLE_SCOPES).map(([scope, description]) => ({
        scope, description, description_keys: scopeDescriptionKeys(scope), default: DEFAULT_SCOPES.includes(scope),
      })),
      declare_with: '<meta name="aimeat-scopes" content="memory:read memory:write storage:read storage:write memory:delete ai:use">',
      notes: [
        'Apps that declare nothing get exactly the scopes marked default: true.',
        'Requesting any scope outside this vocabulary fails the whole authorize with INVALID_SCOPE — check this list first.',
        'File deletion is covered by storage:write; there is no storage:delete scope.',
        'memory:delete is NOT in the default set — declare it when the app deletes memory keys.',
      ],
    }));
  });

  // ── GET /v1/app-grants/authorize ── app sends the owner's browser here to start the grant.
  router.get('/v1/app-grants/authorize', async (req: Request, res: Response) => {
    sweep();
    const app = String(req.query.app ?? '').trim();
    const responseType = String(req.query.response_type ?? 'code');
    const redirectUri = String(req.query.redirect_uri ?? '').trim();
    const state = String(req.query.state ?? '');
    const codeChallenge = String(req.query.code_challenge ?? '');
    const method = String(req.query.code_challenge_method ?? '');
    const scopeStr = String(req.query.scope ?? '');
    const requested = scopeStr.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);

    if (responseType !== 'code') {
      return res.status(400).json(error(config.nodeId, 'UNSUPPORTED_RESPONSE_TYPE', 'response_type must be "code"'));
    }
    if ((method !== 'S256' && method !== 'plain') || !codeChallenge) {
      return res.status(400).json(error(config.nodeId, 'PKCE_REQUIRED', 'code_challenge with code_challenge_method S256 (or plain on non-secure-context clients) is required'));
    }
    const rd = validRedirect(redirectUri);
    if (!rd.ok) {
      return res.status(400).json(error(config.nodeId, 'INVALID_REDIRECT_URI', 'redirect_uri must be an absolute http(s) URL on the app origin'));
    }
    if (requested.length === 0) {
      return res.status(400).json(error(config.nodeId, 'INVALID_SCOPE', 'At least one scope is required'));
    }
    const invalid = requested.filter(s => !APP_GRANTABLE_SCOPES[s]);
    if (invalid.length) {
      return res.status(400).json(error(config.nodeId, 'INVALID_SCOPE', `Not grantable: ${invalid.join(', ')}. The vocabulary is served at GET /v1/app-grants/scopes (note: file deletion is covered by storage:write).`));
    }

    const slash = app.indexOf('/');
    if (slash <= 0 || slash === app.length - 1) {
      return res.status(400).json(error(config.nodeId, 'INVALID_APP', 'app must be "owner/filename"'));
    }
    const appRecord = await storage.getAppByOwnerName(app.slice(0, slash), app.slice(slash + 1));
    if (!appRecord) {
      return res.status(404).json(error(config.nodeId, 'APP_NOT_FOUND', `No published app "${app}"`));
    }

    // Origin binding: when redirect_uri lives on a PER-APP subdomain, that subdomain must map to
    // exactly this app — otherwise app X could run the flow in app Y's name and harvest a code on
    // its own origin. A bound request is what makes own-app auto-approve safe on the consent page
    // (parity with the silent bridge, which binds by origin the same way). Path-form apps share the
    // bare app host → cannot be bound → they keep the manual consent screen.
    let originBound = false;
    const appHostL = (config.appHost || '').toLowerCase();
    const rdHost = new URL(redirectUri).hostname.toLowerCase();
    if (appHostL && rdHost !== appHostL && rdHost.endsWith('.' + appHostL)) {
      const sub = rdHost.slice(0, -(appHostL.length + 1));
      const site = sub && !sub.includes('.') ? await storage.getSubdomainSite(sub) : null;
      if (!site || !site.enabled || site.kind !== 'app' || site.target !== app) {
        return res.status(400).json(error(config.nodeId, 'INVALID_REDIRECT_URI', 'redirect_uri subdomain is not bound to this app'));
      }
      originBound = true;
    }

    const responseMode = String(req.query.response_mode ?? 'query') === 'web_message' ? 'web_message' : 'query';
    const manage = String(req.query.manage ?? '') === '1';
    const requestId = `agreq-${randomBytes(18).toString('hex')}`;
    pendingRequests.set(requestId, {
      requestId, app, appName: appRecord.manifest?.name || app.slice(slash + 1),
      appIcon: appRecord.manifest?.icon || '', appDescription: appRecord.manifest?.description || '',
      appOrigin: rd.origin, scopes: requested, redirectUri, state, codeChallenge,
      codeChallengeMethod: method === 'plain' ? 'plain' : 'S256', responseMode, manage, originBound,
      expiresAt: Date.now() + REQUEST_TTL_MS,
    });

    // Send the owner to the trusted apex consent page (SPA route) to review + approve.
    res.redirect(302, `${config.baseUrl}/v1/app-grant?req=${encodeURIComponent(requestId)}`);
  });

  // ── GET /v1/app-grants/request/:requestId ── consent UI fetches what's being requested (display).
  router.get('/v1/app-grants/request/:requestId', (req: Request, res: Response) => {
    sweep();
    const pending = pendingRequests.get(req.params.requestId as string);
    if (!pending) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Authorization request not found or expired'));
    }
    res.json(success(config.nodeId, {
      request_id: pending.requestId,
      app: pending.app,
      app_name: pending.appName,
      // Identity + context for the consent screen: a stranger deciding on an app they have never
      // seen needs to know WHAT it is, not only which scopes it asks for. Both are display-only.
      app_icon: pending.appIcon,
      app_description: pending.appDescription,
      app_origin: pending.appOrigin,
      response_mode: pending.responseMode,
      manage: pending.manage, // true → always show the management screen; false → may auto-approve an existing grant
      state: pending.state, // echoed back by the consent page in the web_message revoke postMessage
      // app_owner + origin_bound let the consent page recognise the owner's OWN app (auto-approve,
      // same policy as the silent bridge) — but ONLY when the redirect origin is bound to this app.
      app_owner: pending.app.includes('/') ? pending.app.slice(0, pending.app.indexOf('/')) : null,
      origin_bound: pending.originBound,
      scopes: pending.scopes.map(s => ({ scope: s, description: APP_GRANTABLE_SCOPES[s], description_keys: scopeDescriptionKeys(s) })),
    }));
  });

  // ── POST /v1/app-grants/authorize-consent ── owner approves on aimeat.io (authenticated SPA).
  router.post('/v1/app-grants/authorize-consent', requireAuth(), requireRole('owner'), (req: Request, res: Response) => {
    sweep();
    const requestId = String(req.body?.request_id ?? '');
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Authorization request not found or expired'));
    }
    pendingRequests.delete(requestId);

    // Optional "Advanced" scope subset: the user may approve FEWER scopes than requested, never more.
    const requestedSubset: unknown = req.body?.scopes;
    let grantedScopes = pending.scopes;
    if (Array.isArray(requestedSubset)) {
      const subset = requestedSubset.filter((s): s is string => typeof s === 'string' && pending.scopes.includes(s));
      if (subset.length) grantedScopes = subset;
    }

    const gaii = resolveIdentity(req.auth!, config.nodeId); // owner GHII (alice@node)
    const owner = req.auth!.owner;
    // Own only when the approving owner IS the app's owner AND the request is origin-bound — an
    // unbound request (path-form app, dev localhost) never earns the own flag even for the owner.
    const appOwner = pending.app.includes('/') ? pending.app.slice(0, pending.app.indexOf('/')) : '';
    const own = pending.originBound && !!appOwner && owner === appOwner;
    const code = `agc-${randomBytes(24).toString('hex')}`;
    authCodes.set(code, {
      code, app: pending.app, appName: pending.appName, appOrigin: pending.appOrigin,
      owner, gaii, scopes: grantedScopes, redirectUri: pending.redirectUri,
      state: pending.state, codeChallenge: pending.codeChallenge, codeChallengeMethod: pending.codeChallengeMethod,
      own, expiresAt: Date.now() + CODE_TTL_MS,
    });

    const url = new URL(pending.redirectUri);
    url.searchParams.set('code', code);
    if (pending.state) url.searchParams.set('state', pending.state);
    res.json(success(config.nodeId, { redirect_url: url.toString() }));
  });

  /**
   * Establish the owner's SINGLE live grant for an app: refresh the existing one, else create it.
   * Both consent paths (silent SSO bridge, authorization_code exchange) go through here so neither
   * can stack duplicates. `existing` is passed in because callers have already looked it up to make
   * their own policy decision — no second query on the hot silent path.
   *
   * Scopes are replaced by what was just approved, never unioned: the consent screen's Advanced
   * subset must be able to take access away, not only add it.
   *
   * The partial unique index on (owner, app) WHERE NOT revoked makes the invariant a DB guarantee,
   * so two simultaneous first-time consents surface as a constraint violation instead of a duplicate
   * row. Rather than failing the exchange, adopt the row that won the race.
   */
  async function upsertGrant(
    spec: { app: string; appName: string; appOrigin: string; owner: string; gaii: string; scopes: string[] },
    existing: { grantId: string } | null,
  ): Promise<{ grantId: string; rawRefresh: string }> {
    const rawRefresh = randomBytes(32).toString('hex');
    const now = new Date().toISOString();
    const patch = { refreshTokenHash: hashToken(rawRefresh), lastUsedAt: now, scopes: spec.scopes };
    if (existing) {
      await storage.updateAppGrant(existing.grantId, patch);
      return { grantId: existing.grantId, rawRefresh };
    }
    const grantId = `appgrant-${randomBytes(16).toString('hex')}`;
    try {
      await storage.createAppGrant({
        grantId, app: spec.app, appName: spec.appName, appOrigin: spec.appOrigin,
        owner: spec.owner, gaii: spec.gaii, scopes: spec.scopes,
        refreshTokenHash: patch.refreshTokenHash, createdAt: now, lastUsedAt: now, revoked: false,
      });
      return { grantId, rawRefresh };
    } catch (err) {
      const raced = await storage.getAppGrantByOwnerAndApp(spec.owner, spec.app);
      if (!raced) throw err; // a genuine storage failure, not the unique-index race
      await storage.updateAppGrant(raced.grantId, patch);
      return { grantId: raced.grantId, rawRefresh };
    }
  }

  /** Mint a scoped access JWT for a grant: sub = owner GHII, role 'app', granted scopes only. */
  async function issueAccessToken(grant: { gaii: string; owner: string; scopes: string[]; grantId: string; app?: string }): Promise<{ token: string; expiresIn: number }> {
    const token = await issueJWT(
      // `sub` stays the OWNER's GHII: a hosted app reads and writes the owner's namespace, and moving
      // that would move every existing app's data. `app` names the app beside it, so the caller can be
      // identified where the question is who acted rather than whose space it acted in.
      { sub: grant.gaii, owner: grant.owner, node: config.nodeId, roles: ['app'], scopes: grant.scopes, app_grant: grant.grantId, app: grant.app },
      config.accessTtlSeconds,
    );
    return { token, expiresIn: config.accessTtlSeconds };
  }

  // ── GET /v1/auth/app-grant-silent ── seamless SSO bridge (no visible login). Mounted under
  // /v1/auth so the host-only refresh cookie reaches it. Called credentialed + same-origin by the
  // apex bridge page (app-silent.html) that an app embeds in a hidden iframe. Security model:
  //   • The app is identified ONLY by its per-app subdomain (origin → subdomain → mapped app), so a
  //     token is bound to exactly one app origin — apps cannot impersonate each other. Per-app
  //     subdomain REQUIRED (path-form apps share one origin → not eligible for silent SSO).
  //   • Auto-approve ONLY the owner's OWN app, or an app the owner already granted (remembered).
  //     Anyone else → consent_required (the visible code flow).
  //   • Issues the same scoped, revocable grant token as the code flow — NEVER the session.
  router.get('/v1/auth/app-grant-silent', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const reply = (data: Record<string, unknown>) => res.json(success(config.nodeId, data));

    // SECURITY (C-1): this endpoint turns the session COOKIE into a scoped token, and it takes the
    // app's identity from `?origin=` — a value the caller writes. Only the apex bridge page may call
    // it. App origins are `<sub>.apps.<apex>`, i.e. the SAME SITE as the apex, so `SameSite=Strict`
    // does not fence them: without this check any published app could fetch the bridge endpoint
    // credentialed, name an app the visiting owner owns, and read back a token for that owner.
    // `Sec-Fetch-Site` distinguishes exactly the two cases — the apex bridge sends `same-origin`,
    // an app origin sends `same-site`. Both header names are forbidden to scripts, so a browser
    // caller cannot forge them; a non-browser caller sends neither and carries no cookie to steal,
    // so absence stays allowed (curl, the E2E suites, an agent's HTTP client).
    const fetchSite = String(req.headers['sec-fetch-site'] ?? '').toLowerCase();
    if (fetchSite && fetchSite !== 'same-origin') return reply({ ok: false, error: 'bad_caller' });
    const callerOrigin = String(req.headers.origin ?? '').toLowerCase();
    if (callerOrigin && callerOrigin !== apexOrigin(config)) return reply({ ok: false, error: 'bad_caller' });

    // Origin → grant target, resolved by the one function that knows the binding
    // (services/app-origin-target.ts). The origin is a value the CALLER writes; nothing downstream
    // trusts it beyond what this node actually publishes at that hostname.
    const resolvedOrigin = await resolveAppOriginTarget(config, storage, String(req.query.origin ?? ''));
    if (!resolvedOrigin.ok) return reply({ ok: false, error: resolvedOrigin.error });
    const grantTarget = resolvedOrigin.target;   // "owner/file.html" or "portfolio:<username>"
    const grantName = resolvedOrigin.name;       // human label for consent surfaces
    const grantOwner = resolvedOrigin.owner;     // bare owner whose own visit auto-approves
    // The origin as the resolver accepted it, for the grant row's display/redirect field.
    const grantOriginHost = new URL(String(req.query.origin ?? '')).hostname.toLowerCase();

    // Who is logged in on the apex (refresh cookie → session). Read-only; no rotation.
    const raw = readRefreshCookie(req);
    const session = raw ? await storage.getSessionByRefreshHash(hashToken(raw)) : null;
    const now = Date.now();
    const sessionValid = !!session && !session.revoked
      && !(session.idleExpiresAt && now >= Date.parse(session.idleExpiresAt))
      && !(session.absoluteExpiresAt && now >= Date.parse(session.absoluteExpiresAt));
    // Include the resolved app so the SDK can open the consent popup (which prompts apex login) even
    // when no one is logged in — the user logs in there, then approves, in one flow.
    if (!sessionValid) return reply({ ok: false, error: 'login_required', app: grantTarget, app_name: grantName });
    const owner = session!.owner;

    const asked = String(req.query.scope ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (asked.some(s => !APP_GRANTABLE_SCOPES[s])) return reply({ ok: false, error: 'invalid_scope' });
    // AUDIT H-9: a portfolio target gets the published ceiling and nothing more, before any branch
    // below decides whether to approve it — including the own-app branch, which asks the page what
    // it wants and believes the answer. See capPortfolioScopes for what this does and does not fix.
    const requested = isPortfolioTarget(grantTarget) ? capPortfolioScopes(asked) : asked;

    // Policy: a live grant is answered from what the app asks for TODAY, not from what it asked for
    // the day the grant was made.
    //
    // A grant used to be a snapshot: the scopes were written at the handshake, and every later
    // `grant_type=refresh_token` minted from that stored list without ever re-reading the app. So an
    // app could narrow its `<meta name="aimeat-scopes">` and keep the wider grant indefinitely.
    // Measured on aimeat.io on 2026-08-18: of 108 live grants, 2 matched the app's current
    // declaration and 106 carried permissions the app no longer asks for.
    //
    // Two directions, two answers:
    //   NARROWING  — the app asks for less than the grant holds. Applied silently. Nobody needs to be
    //                asked for permission to take a permission away, and asking would train people to
    //                click through the screen that matters.
    //   WIDENING   — the app asks for something the grant does not carry. The consent screen, with
    //                `reason: 'app_updated'` so the SDK can say WHY it is asking again: the app was
    //                updated and the new permissions have not been approved by this person yet.
    // The owner's OWN app keeps approving itself in both directions. Publishing the app IS the
    // author's decision about their own account, and a screen on every scope edit would land on the
    // one person who wrote the line that triggered it. Their drift is closed by the narrowing above
    // and by the same narrowing on refresh, without a prompt anywhere.
    const isOwnApp = owner === grantOwner;
    const existing = await storage.getAppGrantByOwnerAndApp(owner, grantTarget);
    const fallback = ['memory:read', 'memory:write', 'storage:read', 'storage:write'];
    const wanted = requested.length ? requested : (existing?.scopes ?? fallback);
    const added = existing ? wanted.filter(s => !existing.scopes.includes(s)) : [];
    let scopes: string[];
    if (isOwnApp) {
      scopes = wanted;
    } else if (!existing) {
      return reply({ ok: false, error: 'consent_required', app: grantTarget, app_name: grantName, scope: wanted.join(' ') });
    } else if (added.length === 0) {
      // Same set, or a narrower one. Take the app at its word and shrink the grant to match.
      scopes = wanted;
    } else {
      // Surface what the app is + what it's asking for, so the SDK can launch the visible consent
      // popup (the authorize flow) without a second round-trip to discover the app identity.
      // NOTE: the visible authorize flow resolves app targets only (owner/file) — a portfolio
      // visitor lands here and stays logged out (safe placeholder); the apex viewer covers them.
      return reply({
        ok: false, error: 'consent_required', reason: 'app_updated',
        app: grantTarget, app_name: grantName, scope: wanted.join(' '),
        added: added.join(' '),
      });
    }

    // Mint: reuse this owner's live grant for the app, else create one (one live grant per app).
    const ownerGhii = `${owner}@${config.nodeId}`;
    const { grantId, rawRefresh } = await upsertGrant(
      { app: grantTarget, appName: grantName, appOrigin: `https://${grantOriginHost}`, owner, gaii: ownerGhii, scopes },
      existing,
    );
    const { token, expiresIn } = await issueAccessToken({ gaii: ownerGhii, owner, scopes, grantId, app: grantTarget });
    // The owner's display name (if set) so the app's login pill can show a human label instead of the
    // raw GHII. Non-sensitive (it's the public profile name); falls back to '' → the SDK shows the GHII.
    const ghiiRec = await storage.getGHII(ownerGhii);
    // Include `app` (owner/filename) + `own` so the SDK can offer in-app grant management (the gear on
    // the login pill re-opens the consent screen for exactly this app).
    reply({ ok: true, access_token: token, refresh_token: rawRefresh, expires_in: expiresIn, scope: scopes.join(' '), grant_id: grantId, app: grantTarget, own: isOwnApp, display_name: ghiiRec?.displayName ?? '' });
  });

  // ── POST /v1/app-grants/token ── the app (cross-origin, CORS *) exchanges code / refreshes.
  router.post('/v1/app-grants/token', async (req: Request, res: Response) => {
    sweep();
    const grantType = String(req.body?.grant_type ?? '');

    if (grantType === 'authorization_code') {
      const code = String(req.body?.code ?? '');
      const verifier = String(req.body?.code_verifier ?? '');
      const redirectUri = String(req.body?.redirect_uri ?? '');
      const ac = authCodes.get(code);
      if (!ac) return res.status(400).json(error(config.nodeId, 'INVALID_GRANT', 'Invalid or expired authorization code'));
      authCodes.delete(code); // single-use
      if (ac.redirectUri !== redirectUri) {
        return res.status(400).json(error(config.nodeId, 'INVALID_GRANT', 'redirect_uri mismatch'));
      }
      if (!verifier || !verifyPkce(verifier, ac.codeChallenge, ac.codeChallengeMethod)) {
        return res.status(400).json(error(config.nodeId, 'INVALID_GRANT', 'PKCE verification failed'));
      }

      // Upsert, never blind insert. The consent page auto-approves an owner's OWN app and any app
      // whose live grant already covers the requested scopes, both with no visible prompt — so an
      // unconditional create stacked a fresh row on every app load that missed the silent bridge
      // (no apex session yet, a scope upgrade, or a path-form app with no per-app subdomain). One
      // account reached 86 grants that way, and because only the newest row keeps a live refresh
      // hash, the leftovers stayed revoked=false and the Access tab showed dead grants as live
      // access. One live grant per (owner, app) — a partial unique index enforces it in the DB too.
      const { grantId, rawRefresh } = await upsertGrant(
        { app: ac.app, appName: ac.appName, appOrigin: ac.appOrigin, owner: ac.owner, gaii: ac.gaii, scopes: ac.scopes },
        await storage.getAppGrantByOwnerAndApp(ac.owner, ac.app),
      );
      const { token, expiresIn } = await issueAccessToken({ gaii: ac.gaii, owner: ac.owner, scopes: ac.scopes, grantId, app: ac.app });
      // app + own: same metadata the silent bridge returns, so the SDK keeps the login pill's
      // grant-gear state correct when the session came through the visible consent flow instead.
      return res.json(success(config.nodeId, {
        access_token: token, token_type: 'Bearer', expires_in: expiresIn,
        refresh_token: rawRefresh, scope: ac.scopes.join(' '), grant_id: grantId,
        app: ac.app, own: ac.own,
      }));
    }

    if (grantType === 'refresh_token') {
      const raw = String(req.body?.refresh_token ?? '');
      if (!raw) return res.status(400).json(error(config.nodeId, 'INVALID_GRANT', 'refresh_token required'));
      const grant = await storage.getAppGrantByRefreshHash(hashToken(raw));
      if (!grant || grant.revoked || !grant.refreshTokenHash) {
        return res.status(401).json(error(config.nodeId, 'INVALID_GRANT', 'Grant revoked or refresh token invalid'));
      }
      // Rotate the refresh token (one-time use).
      const newRaw = randomBytes(32).toString('hex');
      // …and bring the grant down to what the app asks for TODAY. This is the second half of the
      // drift fix: the silent bridge only runs on a fresh page load, so an app that lives on refresh
      // tokens would otherwise carry its old snapshot for as long as it keeps refreshing.
      //
      // NARROWING ONLY. Widening is the consent screen's business, never a side effect of a refresh.
      // And an app that declares NOTHING is left alone rather than shrunk to the default set: a
      // publish that drops the meta tag by accident must not quietly cut an app's reach.
      const narrowed = await narrowToDeclaration(grant.app, grant.scopes);
      await storage.updateAppGrant(grant.grantId, {
        refreshTokenHash: hashToken(newRaw), lastUsedAt: new Date().toISOString(),
        ...(narrowed ? { scopes: narrowed } : {}),
      });
      if (narrowed) grant.scopes = narrowed;
      // AUDIT H-9: the same portfolio ceiling, applied at the second door that mints from a stored
      // grant. The silent bridge caps what it writes, so a fresh record can no longer hold more than
      // memory:read for a portfolio — a record written before that cap existed still can, and this
      // stops it refreshing itself back into a wide token.
      const scopes = isPortfolioTarget(grant.app) ? capPortfolioScopes(grant.scopes) : grant.scopes;
      const { token, expiresIn } = await issueAccessToken({ gaii: grant.gaii, owner: grant.owner, scopes, grantId: grant.grantId, app: grant.app });
      return res.json(success(config.nodeId, {
        access_token: token, token_type: 'Bearer', expires_in: expiresIn,
        refresh_token: newRaw, scope: scopes.join(' '), grant_id: grant.grantId,
      }));
    }

    return res.status(400).json(error(config.nodeId, 'UNSUPPORTED_GRANT_TYPE', 'grant_type must be authorization_code or refresh_token'));
  });

  // ── GET /v1/app-grants ── the owner lists the apps they've granted access to.
  router.get('/v1/app-grants', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const grants = (await storage.listAppGrantsByOwner(owner)).filter(g => !g.revoked);
    res.json(success(config.nodeId, {
      grants: grants.map(g => ({
        grant_id: g.grantId, app: g.app, app_name: g.appName, app_origin: g.appOrigin,
        scopes: g.scopes, granted_at: g.createdAt, last_used_at: g.lastUsedAt,
        // Only meaningful for an app that may spend at all; the UI hides the control otherwise.
        can_spend: (g.scopes ?? []).includes('contract:spend'),
        spend_cap_morsels: g.spendCapMorsels ?? null,
        spent_morsels: g.spentMorsels ?? 0,
      })),
      total: grants.length,
    }));
  });

  /**
   * PATCH /v1/app-grants/:grantId/spend-cap — how much of your money this app may spend.
   *
   * The `contract:spend` scope answers whether an app may buy on your behalf. This answers how much,
   * which is the answer most people actually want: a yes with no number is a blank cheque. Body:
   * `{ cap_morsels: number | null }` — null clears the ceiling, 0 stops it without revoking anything
   * else it was trusted with. `{ reset: true }` puts the counter back to zero (a new month, say).
   */
  router.patch('/v1/app-grants/:grantId/spend-cap', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const grant = await storage.getAppGrant(req.params.grantId as string);
    if (!grant || grant.owner !== owner) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Grant not found'));
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const raw = b.cap_morsels;
    if (raw !== undefined && raw !== null && !(typeof raw === 'number' && Number.isInteger(raw) && raw >= 0)) {
      return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'cap_morsels must be a whole number of morsels, or null to remove the ceiling'));
    }
    const updates: Parameters<typeof storage.updateAppGrant>[1] = {};
    if (raw !== undefined) updates.spendCapMorsels = raw === null ? null : (raw as number);
    if (b.reset === true) updates.spentMorsels = 0;
    if (!Object.keys(updates).length) {
      return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Nothing to change — pass cap_morsels and/or reset'));
    }
    const updated = await storage.updateAppGrant(grant.grantId, updates);
    return res.json(success(config.nodeId, {
      grant_id: grant.grantId, app: grant.app,
      cap_morsels: updated?.spendCapMorsels ?? null,
      spent_morsels: updated?.spentMorsels ?? 0,
      can_spend: (updated?.scopes ?? []).includes('contract:spend'),
    }));
  });

  // ── DELETE /v1/app-grants/:grantId ── the owner revokes an app's access.
  router.delete('/v1/app-grants/:grantId', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const grant = await storage.getAppGrant(req.params.grantId as string);
    if (!grant || grant.owner !== owner) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Grant not found'));
    }
    await storage.updateAppGrant(grant.grantId, { revoked: true, refreshTokenHash: null });
    res.json(success(config.nodeId, { revoked: true, grant_id: grant.grantId }));
  });

  return router;
}
