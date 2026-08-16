/**
 * @file auth.ts
 * @description Authentication routes for challenge signing, JWT issuance,
 *   refresh, revocation, and session OTK flows.
 * @structure
 *   - authRouter() -- Express router for authentication endpoints
 *   - checkOtkSession() -- inactivity guard for session-bound OTKs
 *   - Challenge/session stores for interactive auth flows
 * @usage
 *   app.use(authRouter(config, storage));
 * @version-history
 *   v1.5.0 -- 2026-08-15 -- The Tier 0.5 OTK write path stops being a fourth implementation and a
 *     way around the reserved-key rule. GET /v1/otk/:key executes UNAUTHENTICATED by design, so
 *     every question about who may do this belongs at the mint — and the mint carried requireAuth()
 *     alone, so an app grant holding only memory:read minted a write of `openrouter.settings` and
 *     executed it with no credential, reopening C-2. The mint now needs memory:write and applies
 *     appMayWriteKey() to the parameters; the execution goes through writeMemoryRecord() like every
 *     other door, so schema locks, quota, provenance and the SSE change domain apply to it too.
 *     E2E test-quality audit finding A8. Tier 0.5 is deprecated in RFC v4.0 and three of its write
 *     paths were deleted in 9723f018; removing this one is a separate decision.
 *   v1.4.0 -- 2026-08-15 -- POST /v1/auth/refresh branches on the PRINCIPAL CLASS, not on "is this
 *     an agent". The guard that keeps an agent at ['agent'] across a refresh was written for agents
 *     and the `else` handed the OWNER's roles to everything else — so an ecosystem app or an
 *     app-grant token made one call with its own bearer and got back a token for the same sub
 *     carrying ['owner'] (plus 'operator' where the human is one) and no scopes, clearing
 *     requireScope, requireRole and requireOwnerPrincipal alike. Ecosystem apps now refresh as
 *     ['ecosystem'] with their stored scopes; an app grant is sent to its own exchange. E2E
 *     test-quality audit finding A20.
 *   v1.3.0 -- 2026-08-13 -- Session revocation started being ENFORCED (auth/middleware.ts), so the
 *     two session surfaces here were scoped to the human's own sign-ins: the device list hides agent
 *     rows, and "sign out everywhere" no longer disconnects the owner's fleet.
 *   v1.0.0 -- 2026-02-25 -- Initial authentication routes
 *   v1.2.0 -- 2026-07-16 -- Add GET /v1/security/overview composite (GHII + per-agent CORS + sessions)
 *     folding the Security tab's CORS-per-agent fan-out (SecurityTabService).
 *   v1.1.0 -- 2026-05-28 -- Preserve agent identity and scopes during JWT refresh
 *   v1.1.1 -- 2026-06-29 -- SECURITY: legacy Bearer refresh no longer merges the
 *     owner's owner/operator roles onto an agent session (intra-owner scope collapse /
 *     privilege escalation); agent sessions stay ['agent'] across refresh
 *   v1.3.0 -- 2026-08-11 -- SECURITY (August 2026 audit H-2): POST /v1/auth/token stops doing on the
 *     MINT what v1.1.1 stopped doing on the REFRESH. The agent branch no longer copies the owner's
 *     owner/operator roles onto the agent's JWT (token laundering: the mirrored token bought an
 *     unscoped operator PAT in two calls), and the operator self-heal that wrote to the owner record
 *     from a token mint is gone, because routes/ghii/register-login.ts already does it on the
 *     owner's own doors.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { verify } from '../auth/keypair.js';
import { issueJWT, revokeToken, generateSessionId } from '../auth/jwt.js';
import { requireAuth, requireRole, optionalAuth, isAnonymousMode, getAnonymousCredentials } from '../auth/middleware.js';
import { registerOtkRoutes } from './auth-otk.js';
import { success, error } from '../middleware/envelope.js';
import { loginTarpit } from '../middleware/login-tarpit.js';
import { readRefreshCookie, refreshOwnerSession, hashToken, clearRefreshCookie } from '../services/owner-session.js';
import { resolvePat, PAT_PREFIX } from '../services/access-token.js';
import { parseGAII, isExternalPrincipal } from '../utils/gaii.js';
import { createSecurityTabService } from '../services/db/security-tab-db-service.js';
import { randomBytes } from 'node:crypto';
import { generateOtk } from '../utils/otk.js';
import { AuthTokenRequestSchema, validateBody } from '../models/schemas.js';
import { logger } from '../utils/logger.js';

// In-memory challenge store
const challenges = new Map<string, { challenge: string; expiresAt: number; owner: string }>();

// Session inactivity tracking: sessionId → lastActivity timestamp
const sessions = new Map<string, { ownerGaii: string; lastActivity: number }>();
const SESSION_INACTIVITY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if an OTK's session is still active (not timed out by inactivity).
 * Updates lastActivity on success. Returns false if session has expired.
 * Non-session OTKs always return true.
 */
export async function checkOtkSession(otk: { sessionId: string | null }, storage: Storage): Promise<boolean> {
  if (!otk.sessionId) return true;
  const session = sessions.get(otk.sessionId);
  if (!session) return true; // session not tracked (e.g. standalone OTK)
  if (Date.now() - session.lastActivity > SESSION_INACTIVITY_MS) {
    await storage.expireSessionOtks(otk.sessionId);
    sessions.delete(otk.sessionId);
    return false;
  }
  session.lastActivity = Date.now();
  return true;
}

export function authRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/security/overview — the Security tab mount in ONE call: GHII CORS + per-agent CORS (resolved
  // from the agent records + one shared GHII read + node default, replacing the GET /agents/:name/cors
  // fan-out) + active sessions. Owner view.
  const securityTabDb = createSecurityTabService(storage, config);
  router.get('/v1/security/overview', requireAuth(), requireRole('owner'), async (req, res) => {
    const data = await securityTabDb.overview(req.auth!.owner as string, req.auth!.sessionId);
    res.json(success(config.nodeId, data));
  });

  // POST /v1/auth/anonymous — get a JWT for anonymous access (when anonymous mode is enabled)
  router.post('/v1/auth/anonymous', async (req, res) => {
    if (!isAnonymousMode()) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Anonymous mode is not enabled on this node'));
      return;
    }

    const { gaii, owner } = getAnonymousCredentials();
    const token = await issueJWT({
      sub: gaii,
      owner,
      node: config.nodeId,
      roles: ['agent'],
      scopes: ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write', 'catalogue:read', 'social:read'],
    }, 86400); // 24 hours

    res.json(success(config.nodeId, {
      token,
      gaii,
      expires_in: 86400,
    }, [
      { description: 'Store data', method: 'POST', url: '/v1/memory' },
      { description: 'Create realtime room', method: 'POST', url: '/v1/realtime/rooms' },
    ]));
  });

  // GET /v1/auth/challenge — get a nonce to sign
  router.get('/v1/auth/challenge', (req, res) => {
    const owner = req.query.owner as string | undefined;
    if (!owner) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Query parameter "owner" is required'));
      return;
    }

    const challenge = `ch-${randomBytes(16).toString('hex')}`;
    const expiresAt = Date.now() + 60_000; // 60 seconds
    challenges.set(challenge, { challenge, expiresAt, owner });

    res.json(success(config.nodeId, {
      challenge,
      expires_at: new Date(expiresAt).toISOString(),
    }, [
      {
        description: 'Sign the challenge with your private key and submit to get a JWT',
        method: 'POST',
        url: '/v1/auth/token',
        example_body: {
          gaii: `your-agent#${owner}@${config.nodeId}`,
          timestamp: new Date().toISOString(),
          signature: 'base64(Ed25519_sign(private_key, gaii + timestamp))',
        },
      },
    ]));
  });

  // GET /v1/auth/session — Submit signed challenge, get OTK (Tier 0.5)
  router.get('/v1/auth/session', async (req, res) => {
    const owner = req.query.owner as string | undefined;
    const challengeStr = req.query.challenge as string | undefined;
    const sig = req.query.sig as string | undefined;

    if (!owner || !challengeStr || !sig) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Query parameters "owner", "challenge", and "sig" are required'));
      return;
    }

    // Look up challenge
    const stored = challenges.get(challengeStr);
    if (!stored) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Challenge not found or expired'));
      return;
    }
    if (Date.now() > stored.expiresAt) {
      challenges.delete(challengeStr);
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Challenge expired'));
      return;
    }
    if (stored.owner !== owner) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Challenge does not match owner'));
      return;
    }

    // Verify signature: owner signed the challenge string with their private key
    const ownerRecord = await storage.getOwner(owner);
    if (!ownerRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${owner}`));
      return;
    }

    const valid = await verify(ownerRecord.publicKey, challengeStr, sig);
    if (!valid) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid signature'));
      return;
    }

    // Consume challenge
    challenges.delete(challengeStr);

    // Find first agent for this owner (or create session OTK for owner)
    const agents = await storage.getAgentsByOwner(owner);
    const sessionGaii = agents.length > 0 ? agents[0].gaii : owner;

    // Create a session for inactivity tracking
    const sessionId = `sess-${randomBytes(8).toString('hex')}`;
    sessions.set(sessionId, { ownerGaii: sessionGaii, lastActivity: Date.now() });

    // Generate OTK for Tier 0.5 operations
    const otk = generateOtk();
    const expiresAt = new Date(Date.now() + config.otkTtlMs).toISOString();

    await storage.createOtk({
      key: otk,
      ownerGaii: sessionGaii,
      action: 'session',
      params: { owner, sessionType: 'tier_0_5', sessionId },
      expiresAt,
      initial: false,
      used: false,
      usedAt: null,
      sessionId,
      createdAt: new Date().toISOString(),
    });

    // Pre-rotate: generate next_otk so the AI always has a buffered key
    const nextOtk = generateOtk();
    const nextExpiresAt = new Date(Date.now() + config.otkTtlMs).toISOString();
    await storage.createOtk({
      key: nextOtk,
      ownerGaii: sessionGaii,
      action: 'session',
      params: { owner, sessionType: 'tier_0_5', sessionId },
      expiresAt: nextExpiresAt,
      initial: false,
      used: false,
      usedAt: null,
      sessionId,
      createdAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, {
      otk,
      otk_expires: expiresAt,
      next_otk: nextOtk,
      next_otk_expires: nextExpiresAt,
      session_id: sessionId,
      session_agent: sessionGaii,
      session_inactivity_timeout_seconds: SESSION_INACTIVITY_MS / 1000,
      otk_ttl_ms: config.otkTtlMs,
      otk_grace_ms: config.otkGraceMs,
      max_url_length: config.maxUrlLength,
      note: `OTKs remain valid for ${config.otkGraceMs / 1000} seconds after first use to handle retries. Session expires after 5 minutes of inactivity.`,
    }, [
      { description: 'Use OTK for micro-memory operations', method: 'GET', url: `/v1/mm?otk=${otk}&op=list` },
      { description: 'Accept work via GET', method: 'GET', url: `/v1/work/{tc}/accept?otk=${otk}` },
    ]));
  });

  // POST /v1/auth/token — exchange signature for JWT
  // The agent and owner credential door. It verifies an Ed25519 signature, which is cheap to
  // attempt and expensive in aggregate, and it stood behind nothing.
  //
  // The TARPIT and not the login rate limit. This door is not a password prompt: a fleet mints
  // tokens here all day, legitimately and in bursts, and a whole office or a whole fleet sits
  // behind one address. A fifteen-a-minute ceiling refuses the honest traffic and barely
  // inconveniences a signature guesser, who cannot get anywhere against Ed25519 anyway. The tarpit
  // costs nothing when the signature is right and grows only for whoever keeps getting it wrong,
  // which is the shape this door actually needs.
  router.post('/v1/auth/token', loginTarpit(config), validateBody(AuthTokenRequestSchema, config.nodeId), async (req, res) => {
    const { gaii, owner: ownerName, timestamp, signature } = req.body ?? {};

    // Agent auth (gaii provided)
    if (gaii) {
      const parsed = parseGAII(gaii);
      if (!parsed) {
        res.status(400).json(error(config.nodeId, 'INVALID_GAII', `Invalid GAII format: ${gaii}`));
        return;
      }

      const agent = await storage.getAgent(gaii);
      if (!agent) {
        res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${gaii}`));
        return;
      }

      // Verify signature: sign(private_key, gaii + timestamp)
      const message = gaii + timestamp;
      const valid = await verify(agent.publicKey, message, signature);
      if (!valid) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid signature'));
        return;
      }

      // Check timestamp freshness (within 5 minutes)
      const ts = new Date(timestamp).getTime();
      if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Timestamp too old or too far in the future'));
        return;
      }

      // SECURITY (audit H-2): an agent session is exactly ['agent'], the same role set the other
      // three mints already issue (agents/device-auth.ts, mcp/oauth.ts, and the refresh branch
      // below). This handler used to read the OWNER record and copy the owner's 'owner' and
      // 'operator' roles onto the agent's token, and that is the last step of the paved
      // device-authorization path, so scope-limited agents held it in production.
      //
      // What the copy bought an agent, in two calls: the mirrored token cleared
      // requireRole('owner') on POST /v1/access/tokens, `isOperator` was true there so
      // `grant_operator` was accepted, and services/access-token.ts resolves that PAT to
      // ['owner','operator'] with no scopes and NO agent role, at which point requireScope stops
      // applying at all, because its owner branch only steps aside for an agent or ecosystem role.
      // An agent granted memory:read could mint itself an unscoped operator credential.
      //
      // The operator self-heal that sat here went with it. Minting an agent token is the one path
      // that has no business WRITING to the owner record, and the promotion it duplicated already
      // runs where it belongs: on the owner's own doors in routes/ghii/register-login.ts, at
      // registration and again at password login.
      const roles = ['agent'];

      // P3-7: Create session record for JWT tracking
      const sessionId = generateSessionId();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + config.jwtTtlSeconds * 1000);

      const token = await issueJWT({
        sub: gaii,
        owner: parsed.owner,
        node: config.nodeId,
        roles,
        scopes: agent.defaultScopes,
      }, config.jwtTtlSeconds, sessionId);

      await storage.createSession({
        sessionId,
        gaii,
        owner: parsed.owner,
        issuedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });

      // Update last seen
      await storage.updateAgent(gaii, { lastSeen: new Date().toISOString() });

      res.json(success(config.nodeId, {
        token,
        expires_at: new Date(Date.now() + config.jwtTtlSeconds * 1000).toISOString(),
        ttl_seconds: config.jwtTtlSeconds,
        identity: {
          gaii,
          owner: parsed.owner,
          node: config.nodeId,
        },
        roles,
      }, [
        {
          description: 'Use this token in the Authorization header for all requests',
          note: `Authorization: Bearer ${token.slice(0, 20)}...`,
          method: 'GET',
          url: '/v1/memory',
        },
        { description: 'Refresh before expiry', method: 'POST', url: '/v1/auth/refresh' },
      ]));
      return;
    }

    // Owner auth (owner name provided instead of gaii)
    if (ownerName) {
      const ownerRecord = await storage.getOwner(ownerName);
      if (!ownerRecord) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${ownerName}`));
        return;
      }

      const message = ownerName + config.nodeId + timestamp;
      const valid = await verify(ownerRecord.publicKey, message, signature);
      if (!valid) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid signature'));
        return;
      }

      const ts = new Date(timestamp).getTime();
      if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Timestamp too old or too far in the future'));
        return;
      }

      const roles = [...ownerRecord.roles];

      // P3-7: Create session record for JWT tracking
      const ownerSessionId = generateSessionId();
      const ownerNow = new Date();
      const ownerExpiresAt = new Date(ownerNow.getTime() + config.jwtTtlSeconds * 1000);

      const token = await issueJWT({
        sub: ownerName,
        owner: ownerName,
        node: config.nodeId,
        roles,
      }, config.jwtTtlSeconds, ownerSessionId);

      await storage.createSession({
        sessionId: ownerSessionId,
        gaii: ownerName,
        owner: ownerName,
        issuedAt: ownerNow.toISOString(),
        expiresAt: ownerExpiresAt.toISOString(),
      });

      res.json(success(config.nodeId, {
        token,
        expires_at: ownerExpiresAt.toISOString(),
        ttl_seconds: config.jwtTtlSeconds,
        identity: {
          owner: ownerName,
          node: config.nodeId,
        },
        roles,
      }, [
        { description: 'Register a new agent', method: 'POST', url: '/v1/agents' },
        { description: 'List your agents', method: 'GET', url: '/v1/agents' },
      ]));
      return;
    }

    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Either "gaii" or "owner" is required'));
  });

  // POST /v1/auth/refresh
  // Two modes: (1) owner session refresh via the httpOnly aimeat_rt cookie with token
  // rotation + reuse detection; (2) legacy Bearer-based refresh for agents / pre-cookie
  // clients. optionalAuth() resolves a Bearer if present without rejecting cookie clients.
  router.post('/v1/auth/refresh', optionalAuth(), async (req, res) => {
    // (1) Cookie-based owner session refresh (rotation + reuse detection).
    if (readRefreshCookie(req)) {
      const cookieVal = readRefreshCookie(req)!;
      // PAT-backed browser session: the cookie value IS the access token (set by a browser
      // PAT request) — validate it per refresh so revocation takes effect immediately.
      if (cookieVal.startsWith(PAT_PREFIX)) {
        if (req.headers['x-aimeat-refresh'] !== '1') {
          res.status(400).json(error(config.nodeId, 'CSRF_REQUIRED', 'Missing X-AIMEAT-Refresh header'));
          return;
        }
        const r = await resolvePat(storage, cookieVal);
        if (!r) {
          clearRefreshCookie(req, res);
          res.status(401).json(error(config.nodeId, 'INVALID_TOKEN', 'Access token is invalid, revoked, or expired'));
          return;
        }
        await storage.touchPat(r.patId, new Date().toISOString());
        const includeScopes = r.roles.includes('agent');
        const patToken = await issueJWT({
          sub: r.sub, owner: r.owner, node: config.nodeId, roles: r.roles,
          ...(includeScopes ? { scopes: r.scopes } : {}),
        }, config.accessTtlSeconds);
        res.json(success(config.nodeId, {
          token: patToken,
          expires_in: config.accessTtlSeconds,
          expires_at: new Date(Date.now() + config.accessTtlSeconds * 1000).toISOString(),
          ttl_seconds: config.accessTtlSeconds,
        }));
        return;
      }
      const result = await refreshOwnerSession(storage, config, req, res);
      if (!result.ok) {
        res.status(result.status).json(error(config.nodeId, result.code, result.message));
        return;
      }
      res.json(success(config.nodeId, {
        token: result.token,
        expires_in: result.expiresIn,
        expires_at: new Date(Date.now() + result.expiresIn * 1000).toISOString(),
        ttl_seconds: result.expiresIn,
        display_name: result.displayName,
      }));
      return;
    }

    // (2) Legacy Bearer-based refresh (agents / pre-cookie clients).
    if (!req.auth || req.auth.anonymous) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required'));
      return;
    }
    // Re-read roles from storage to prevent stale privilege persistence
    const ownerRecord = await storage.getOwner(req.auth!.owner);
    if (!ownerRecord) {
      res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Owner not found'));
      return;
    }

    let freshRoles: string[];
    let freshScopes: string[] | undefined;
    const isAgentSession = req.auth!.roles.includes('agent') && parseGAII(req.auth!.sub) !== null;

    if (isAgentSession) {
      const agent = await storage.getAgent(req.auth!.sub);
      if (!agent) {
        res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Agent no longer active'));
        return;
      }
      // SECURITY: an agent session stays exactly ['agent'] across refresh — the
      // same role set it was minted with at device-auth (agents.ts). Merging the
      // owner's owner/operator roles here would let a scoped agent clear
      // requireRole('owner'/'operator') after one refresh (those gates check role,
      // not scope) — an intra-owner privilege escalation / scope collapse.
      freshRoles = ['agent'];
      freshScopes = agent.defaultScopes;
    } else if (req.auth!.roles.includes('ecosystem')) {
      // The same rule as the agent branch, for the principal class it forgot. `else` handed the
      // OWNER's roles to anything that was not an agent, and an ecosystem app is not an agent: one
      // POST /v1/auth/refresh with its own bearer returned a token for the same sub carrying
      // ['owner'] (plus 'operator' where the human is one) and NO scopes — after which it passed
      // requireScope, requireRole('owner'), requireRole('operator') and requireOwnerPrincipal. A
      // memory:read ecosystem app could change the account's password.
      const ecoApp = await storage.getEcosystemApp(req.auth!.sub);
      if (!ecoApp || ecoApp.status === 'revoked') {
        res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Ecosystem app no longer active'));
        return;
      }
      freshRoles = ['ecosystem'];
      freshScopes = ecoApp.scopes;
    } else if (req.auth!.app_grant) {
      // An app grant has its own exchange (POST /v1/app-grants/token, refresh_token grant) which
      // re-reads the grant and its approved scopes. Coming through THIS door was the escalation in
      // its purest form: a token minted from a consent screen the owner ticked, handed back with the
      // human's roles and no scopes at all.
      res.status(403).json(error(config.nodeId, 'FORBIDDEN',
        "This kind of access is renewed somewhere else. Use the app's own renewal address instead."));
      return;
    } else {
      freshRoles = ownerRecord.roles ?? ['owner'];
    }

    // P3-7: Create new session record for refreshed token
    const refreshSessionId = generateSessionId();
    const refreshNow = new Date();
    const refreshExpiresAt = new Date(refreshNow.getTime() + config.jwtTtlSeconds * 1000);

    const token = await issueJWT({
      sub: req.auth!.sub,
      owner: req.auth!.owner,
      node: config.nodeId,
      roles: freshRoles,
      ...(freshScopes !== undefined ? { scopes: freshScopes } : {}),
    }, config.jwtTtlSeconds, refreshSessionId);

    await storage.createSession({
      sessionId: refreshSessionId,
      gaii: req.auth!.sub,
      owner: req.auth!.owner,
      issuedAt: refreshNow.toISOString(),
      expiresAt: refreshExpiresAt.toISOString(),
    });

    res.json(success(config.nodeId, {
      token,
      expires_at: refreshExpiresAt.toISOString(),
      ttl_seconds: config.jwtTtlSeconds,
    }));
  });

  // POST /v1/auth/revoke
  // Logout: revoke the owner refresh session (identified by the cookie) and/or the
  // bearer token, then clear the refresh cookie. optionalAuth so it still works when
  // the short-lived access token has already expired.
  router.post('/v1/auth/revoke', optionalAuth(), async (req, res) => {
    const rt = readRefreshCookie(req);
    if (rt) {
      const session = await storage.getSessionByRefreshHash(hashToken(rt));
      if (session) await storage.revokeSession(session.sessionId);
      clearRefreshCookie(req, res);
    }

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && req.auth && !req.auth.anonymous) {
      const token = authHeader.slice(7);
      await revokeToken(token, req.auth.exp);
      if (req.auth.sessionId) await storage.revokeSession(req.auth.sessionId);
    }

    res.json(success(config.nodeId, {
      revoked: true,
    }, [
      { description: 'Get a new token', method: 'POST', url: '/v1/auth/token' },
    ]));
  });

  // GET /v1/auth/sessions — list active sessions for the authenticated owner.
  // The human's own sign-ins only. An agent's session row carries the same `owner` but its `gaii` is
  // a GAII, and this list is a device list: it shows a label, a user agent and a Sign out button.
  // The owner's agents have their own surface, with far more to say about each one.
  router.get('/v1/auth/sessions', requireAuth(), async (req, res) => {
    const owner = req.auth!.owner;
    const sessions = (await storage.listActiveSessions(owner)).filter(s => !isExternalPrincipal(s.gaii));
    const currentSessionId = req.auth!.sessionId;

    res.json(success(config.nodeId, {
      sessions: sessions.map(s => ({
        session_id: s.sessionId,
        gaii: s.gaii,
        issued_at: s.issuedAt,
        expires_at: s.expiresAt,
        last_used_at: s.lastUsedAt ?? null,
        device_label: s.deviceLabel ?? null,
        current: s.sessionId === currentSessionId,
      })),
      total: sessions.length,
    }));
  });

  // DELETE /v1/auth/sessions/:id — revoke a specific session
  router.delete('/v1/auth/sessions/:id', requireAuth(), async (req, res) => {
    const sessionId = req.params.id as string;
    // Verify the session belongs to this owner by checking active sessions
    const sessions = await storage.listActiveSessions(req.auth!.owner);
    const target = sessions.find(s => s.sessionId === sessionId);
    if (!target) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Session not found or already revoked'));
      return;
    }
    await storage.revokeSession(sessionId);
    // If the caller revoked the device they're currently on, clear its cookie too.
    const rt = readRefreshCookie(req);
    if (rt && (hashToken(rt) === target.refreshTokenHash || hashToken(rt) === target.prevTokenHash)) {
      clearRefreshCookie(req, res);
    }
    res.json(success(config.nodeId, { revoked: true, session_id: sessionId }));
  });

  // DELETE /v1/auth/sessions — sign the owner out everywhere (P3-7).
  //
  // "Everywhere" means the person's own devices, not their fleet. Session revocation only started
  // being enforced on 2026-08-13 (it was checked in a branch that the global optionalAuth made
  // unreachable), so this call used to be inert for agents; enforcing it without scoping it would
  // turn "sign out of my other browser" into disconnecting every agent, each of which then needs the
  // owner to approve device authorization again. An agent is ended from the Agents surface, one at a
  // time, deliberately. Erasing the account still takes everything (services/owner-erasure.ts).
  router.delete('/v1/auth/sessions', requireAuth(), async (req, res) => {
    const owner = req.auth!.owner;
    const mine = (await storage.listActiveSessions(owner)).filter(s => !isExternalPrincipal(s.gaii));
    let count = 0;
    for (const s of mine) if (await storage.revokeSession(s.sessionId)) count++;
    clearRefreshCookie(req, res); // the caller's own device is included in "all"

    res.json(success(config.nodeId, {
      revoked_sessions: count,
      owner,
    }, [
      { description: 'Get a new token', method: 'POST', url: '/v1/auth/token' },
    ]));
  });
  // Tier 0.5 one-time keys — moved to auth-otk.ts by pure extraction (max-file-lines).
  registerOtkRoutes(router, config, storage, sessions, SESSION_INACTIVITY_MS);


  // Cleanup expired challenges and inactive sessions periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of challenges) {
      if (now > val.expiresAt) challenges.delete(key);
    }
    // Expire inactive sessions (5 min inactivity)
    for (const [sessionId, session] of sessions) {
      if (now - session.lastActivity > SESSION_INACTIVITY_MS) {
        storage.expireSessionOtks(sessionId).catch(err => { logger.warn('GET /v1/otk/:key: continuing after a suppressed failure', { error: String(err) }); });
        sessions.delete(sessionId);
      }
    }
  }, 30_000);

  return router;
}
