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

/**
 * Scopes an app may request, each with a short description key for the consent UI. Drawn from the
 * scope vocabulary the node actually enforces (auth/middleware.ts requireScope). Deliberately a
 * curated subset — not operator/admin or destructive-by-default scopes.
 */
export const APP_GRANTABLE_SCOPES: Record<string, string> = {
  'memory:read': 'Read your stored memories and data',
  'memory:write': 'Create and update your memories and data',
  'memory:delete': 'Delete your memories and data',
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
  expiresAt: number;
}

/** SHA-256 hex (refresh-token storage). */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** PKCE S256 verification: base64url(sha256(verifier)) === challenge. */
function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
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
    if (method !== 'S256' || !codeChallenge) {
      return res.status(400).json(error(config.nodeId, 'PKCE_REQUIRED', 'code_challenge with code_challenge_method=S256 is required'));
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

    const requestId = `agreq-${randomBytes(18).toString('hex')}`;
    pendingRequests.set(requestId, {
      requestId, app, appName: appRecord.manifest?.name || app.slice(slash + 1),
      appOrigin: rd.origin, scopes: requested, redirectUri, state, codeChallenge,
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

    const gaii = resolveIdentity(req.auth!, config.nodeId); // owner GHII (alice@node)
    const owner = req.auth!.owner;
    const code = `agc-${randomBytes(24).toString('hex')}`;
    authCodes.set(code, {
      code, app: pending.app, appName: pending.appName, appOrigin: pending.appOrigin,
      owner, gaii, scopes: pending.scopes, redirectUri: pending.redirectUri,
      state: pending.state, codeChallenge: pending.codeChallenge,
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
      if (!verifier || !verifyPkce(verifier, ac.codeChallenge)) {
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
