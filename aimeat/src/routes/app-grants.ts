/**
 * @file app-grants.ts
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
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phase 3: explicit scoped app grants).
 *   v1.1.0 — 2026-06-20 — Add silent SSO bridge GET /v1/auth/app-grant-silent: when the owner is
 *     logged into the apex, their own app (bound by its per-app subdomain origin) gets a scoped
 *     grant token with no visible login (same-site iframe + postMessage). Others → consent_required.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppGrantRecord } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { issueJWT } from '../auth/jwt.js';
import { readRefreshCookie } from '../services/owner-session.js';

/**
 * Scopes an app may request, each with a short description key for the consent UI. Drawn from the
 * scope vocabulary the node actually enforces (auth/middleware.ts requireScope). Deliberately a
 * curated subset — not operator/admin or destructive-by-default scopes.
 */
export const APP_GRANTABLE_SCOPES: Record<string, string> = {
  'memory:read': 'Read your stored memories and data',
  'memory:write': 'Create and update your memories and data',
  'memory:delete': 'Delete your memories and data',
  'storage:read': 'Read your stored files (images, documents)',
  'storage:write': 'Save and update your stored files (images, documents)',
  'catalogue:read': 'Read the public catalogue/directory',
  'social:read': 'Read boards you can access',
  'social:write': 'Post to boards on your behalf',
  'wallet:read': 'See your morsel balance and transactions',
  'knowledge:read': 'Read your knowledge packages',
};

const CODE_TTL_MS = 60_000;        // authorization code: single-use, 60s
const REQUEST_TTL_MS = 10 * 60_000; // pending authorize request awaiting consent: 10 min

interface PendingRequest {
  requestId: string;
  app: string;          // owner/filename
  appName: string;
  appOrigin: string;    // origin of redirect_uri (shown to user, bound into the grant)
  scopes: string[];
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256' | 'plain';
  responseMode: 'query' | 'web_message'; // web_message → consent page postMessages the code to the popup-opener app
  manage: boolean; // true → consent page always shows the management screen (gear); false → may auto-approve an existing grant
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

export function appGrantsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  const pendingRequests = new Map<string, PendingRequest>();
  const authCodes = new Map<string, AuthCode>();

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
      return res.status(400).json(error(config.nodeId, 'INVALID_SCOPE', `Not grantable: ${invalid.join(', ')}`));
    }

    const slash = app.indexOf('/');
    if (slash <= 0 || slash === app.length - 1) {
      return res.status(400).json(error(config.nodeId, 'INVALID_APP', 'app must be "owner/filename"'));
    }
    const appRecord = await storage.getAppByOwnerName(app.slice(0, slash), app.slice(slash + 1));
    if (!appRecord) {
      return res.status(404).json(error(config.nodeId, 'APP_NOT_FOUND', `No published app "${app}"`));
    }

    const responseMode = String(req.query.response_mode ?? 'query') === 'web_message' ? 'web_message' : 'query';
    const manage = String(req.query.manage ?? '') === '1';
    const requestId = `agreq-${randomBytes(18).toString('hex')}`;
    pendingRequests.set(requestId, {
      requestId, app, appName: appRecord.manifest?.name || app.slice(slash + 1),
      appOrigin: rd.origin, scopes: requested, redirectUri, state, codeChallenge,
      codeChallengeMethod: method === 'plain' ? 'plain' : 'S256', responseMode, manage,
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
      app_origin: pending.appOrigin,
      response_mode: pending.responseMode,
      manage: pending.manage, // true → always show the management screen; false → may auto-approve an existing grant
      state: pending.state, // echoed back by the consent page in the web_message revoke postMessage
      scopes: pending.scopes.map(s => ({ scope: s, description: APP_GRANTABLE_SCOPES[s] })),
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
    const code = `agc-${randomBytes(24).toString('hex')}`;
    authCodes.set(code, {
      code, app: pending.app, appName: pending.appName, appOrigin: pending.appOrigin,
      owner, gaii, scopes: grantedScopes, redirectUri: pending.redirectUri,
      state: pending.state, codeChallenge: pending.codeChallenge, codeChallengeMethod: pending.codeChallengeMethod,
      expiresAt: Date.now() + CODE_TTL_MS,
    });

    const url = new URL(pending.redirectUri);
    url.searchParams.set('code', code);
    if (pending.state) url.searchParams.set('state', pending.state);
    res.json(success(config.nodeId, { redirect_url: url.toString() }));
  });

  /** Mint a scoped access JWT for a grant: sub = owner GHII, role 'app', granted scopes only. */
  async function issueAccessToken(grant: { gaii: string; owner: string; scopes: string[]; grantId: string }): Promise<{ token: string; expiresIn: number }> {
    const token = await issueJWT(
      { sub: grant.gaii, owner: grant.owner, node: config.nodeId, roles: ['app'], scopes: grant.scopes, app_grant: grant.grantId },
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

    const appHost = (config.appHost || '').toLowerCase();
    if (!appHost) return reply({ ok: false, error: 'app_origin_disabled' });

    // The app's real origin (the apex bridge passes it from window.location.ancestorOrigins).
    let host: string;
    try { host = new URL(String(req.query.origin ?? '')).hostname.toLowerCase(); } catch { return reply({ ok: false, error: 'bad_origin' }); }
    if (host === appHost || !host.endsWith('.' + appHost)) return reply({ ok: false, error: 'bad_origin' });
    const sub = host.slice(0, -(appHost.length + 1));
    if (!sub || sub.includes('.')) return reply({ ok: false, error: 'bad_origin' }); // single-label per-app subdomain only

    // Subdomain → the app it serves. This binding is what ties a token to one app's origin.
    const site = await storage.getSubdomainSite(sub);
    if (!site || !site.enabled || site.kind !== 'app') return reply({ ok: false, error: 'unknown_app' });
    const slash = site.target.indexOf('/');
    if (slash <= 0) return reply({ ok: false, error: 'unknown_app' });
    const appOwner = site.target.slice(0, slash);
    const appFile = site.target.slice(slash + 1);

    // Who is logged in on the apex (refresh cookie → session). Read-only; no rotation.
    const raw = readRefreshCookie(req);
    const session = raw ? await storage.getSessionByRefreshHash(hashToken(raw)) : null;
    const now = Date.now();
    const sessionValid = !!session && !session.revoked
      && !(session.idleExpiresAt && now >= Date.parse(session.idleExpiresAt))
      && !(session.absoluteExpiresAt && now >= Date.parse(session.absoluteExpiresAt));
    // Include the resolved app so the SDK can open the consent popup (which prompts apex login) even
    // when no one is logged in — the user logs in there, then approves, in one flow.
    if (!sessionValid) return reply({ ok: false, error: 'login_required', app: site.target, app_name: appFile });
    const owner = session!.owner;

    const requested = String(req.query.scope ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (requested.some(s => !APP_GRANTABLE_SCOPES[s])) return reply({ ok: false, error: 'invalid_scope' });

    // Policy: own app → auto-approve requested scopes; otherwise require a prior non-revoked grant
    // that already covers them (remembered approval). Anything else needs the visible consent.
    const isOwnApp = owner === appOwner;
    const existing = (await storage.listAppGrantsByOwner(owner)).find(g => !g.revoked && g.app === site.target);
    let scopes: string[];
    if (isOwnApp) {
      scopes = requested.length ? requested : ['memory:read', 'memory:write', 'storage:read', 'storage:write'];
    } else if (existing && requested.every(s => existing.scopes.includes(s))) {
      scopes = requested.length ? requested : existing.scopes;
    } else {
      // Surface what the app is + what it's asking for, so the SDK can launch the visible consent
      // popup (the authorize flow) without a second round-trip to discover the app identity.
      return reply({ ok: false, error: 'consent_required', app: site.target, app_name: appFile, scope: requested.join(' ') });
    }

    // Mint: reuse this owner's existing grant for the app, else create one.
    const ownerGhii = `${owner}@${config.nodeId}`;
    const rawRefresh = randomBytes(32).toString('hex');
    const ts = new Date().toISOString();
    let grantId: string;
    if (existing) {
      grantId = existing.grantId;
      await storage.updateAppGrant(grantId, { refreshTokenHash: hashToken(rawRefresh), lastUsedAt: ts, scopes });
    } else {
      grantId = `appgrant-${randomBytes(16).toString('hex')}`;
      await storage.createAppGrant({
        grantId, app: site.target, appName: appFile, appOrigin: `https://${host}`,
        owner, gaii: ownerGhii, scopes, refreshTokenHash: hashToken(rawRefresh),
        createdAt: ts, lastUsedAt: ts, revoked: false,
      });
    }
    const { token, expiresIn } = await issueAccessToken({ gaii: ownerGhii, owner, scopes, grantId });
    // Include `app` (owner/filename) + `own` so the SDK can offer in-app grant management (the gear on
    // the login pill re-opens the consent screen for exactly this app).
    reply({ ok: true, access_token: token, refresh_token: rawRefresh, expires_in: expiresIn, scope: scopes.join(' '), grant_id: grantId, app: site.target, own: isOwnApp });
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

      const grantId = `appgrant-${randomBytes(16).toString('hex')}`;
      const rawRefresh = randomBytes(32).toString('hex');
      const now = new Date().toISOString();
      await storage.createAppGrant({
        grantId, app: ac.app, appName: ac.appName, appOrigin: ac.appOrigin,
        owner: ac.owner, gaii: ac.gaii, scopes: ac.scopes,
        refreshTokenHash: hashToken(rawRefresh), createdAt: now, lastUsedAt: now, revoked: false,
      });
      const { token, expiresIn } = await issueAccessToken({ gaii: ac.gaii, owner: ac.owner, scopes: ac.scopes, grantId });
      return res.json(success(config.nodeId, {
        access_token: token, token_type: 'Bearer', expires_in: expiresIn,
        refresh_token: rawRefresh, scope: ac.scopes.join(' '), grant_id: grantId,
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
      await storage.updateAppGrant(grant.grantId, { refreshTokenHash: hashToken(newRaw), lastUsedAt: new Date().toISOString() });
      const { token, expiresIn } = await issueAccessToken({ gaii: grant.gaii, owner: grant.owner, scopes: grant.scopes, grantId: grant.grantId });
      return res.json(success(config.nodeId, {
        access_token: token, token_type: 'Bearer', expires_in: expiresIn,
        refresh_token: newRaw, scope: grant.scopes.join(' '), grant_id: grant.grantId,
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
      })),
      total: grants.length,
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
