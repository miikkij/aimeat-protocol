/**
 * @file src/auth/middleware.ts
 * @description Express auth middleware — extracts and verifies JWTs / Personal Access Tokens,
 *   attaches the resolved identity to req.auth, and gates routes by presence, role, scope, and
 *   principal type. Supports anonymous-mode fallback and browser PAT-to-cookie session bootstrap.
 *
 * @structure
 *   - initSessionAuth / enableAnonymousAuth / isAnonymousMode / getAnonymousCredentials: startup wiring
 *   - optionalAuth / requireAuth / requireAuthOrAnonymous: presence-level gates
 *   - requireRole / requireScope / requireExternalPrincipal / requireLocalSession: authorization gates
 *   - requireOwnerPrincipal: the account-security gate (password, recovery address, 2FA, deletion)
 *   - resolvePatToken / maybeSetPatBrowserSession: Personal Access Token handling
 *
 * @version-history
 *   v1.5.0 — 2026-08-15 — requireOperatorPrincipal(), the gate for the break-glass doors that reach
 *     across accounts. requireRole('operator') reads the TOKEN's roles, so it admits the operator's
 *     browser and refuses the operator's agents; this asks whether the ACCOUNT behind the principal
 *     is an operator, the way the aimeat_admin_* MCP tools already did, and then requires an exact
 *     scope word on top so the role alone does not arm every agent the operator owns.
 *   v1.4.0 — 2026-08-14 — requireRoleOrScope() says in its own doc that the role path makes the
 *     named scope decorative FOR THAT ROLE, which is how organism:write came to be enforced on the
 *     MCP tool surface and ignored on the three HTTP doors that write. Nothing executable changed
 *     here; the three organism routes moved to requireScope('organism:write').
 *   v1.3.0 — 2026-08-13 — The session-revocation check moved into optionalAuth(), where the token is
 *     actually verified. It lived in requireAuth() behind an early return that server.ts makes
 *     unconditional: optionalAuth() is mounted globally, so requireAuth() always found req.auth
 *     already set and returned at its first line. Session revocation was therefore enforced on no
 *     route at all — logout revoked the row and the bearer kept working, and deleting an agent could
 *     not end the ninety-day credential it held.
 *   v1.2.0 — 2026-08-11 — Security audit H-1/H-7: requireOwnerPrincipal(), the gate for the doors
 *     that decide who can get back INTO the account. Not one authenticated route under /v1/ghii
 *     carried a role gate, and every one of them keys off req.auth.owner — which holds the HUMAN's
 *     account name on agent, ecosystem and app-grant tokens alike.
 *   v1.1.0 — 2026-07-28 — Every AUTH_REQUIRED 401 goes through deny401(), which stamps the RFC 9728
 *     `WWW-Authenticate: Bearer resource_metadata="…"` hint for the origin the client reached.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Request, Response, NextFunction } from 'express';
import { verifyJWT, isRevoked, type VerifiedToken } from './jwt.js';
import { ACCOUNT_SECURITY_SCOPE, OPERATOR_ORGANISM_REPAIR_SCOPE } from '../utils/scope-coverage.js';
import { setRefreshCookie, readRefreshCookie } from '../services/owner-session.js';
import { resolvePat, PAT_PREFIX } from '../services/access-token.js';
import type { AimeatConfig } from '../config.js';
import { getStats } from '../services/stats.js';
import { getPromMetrics } from '../services/prometheus.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { resourceMetadataUrl } from '../services/protected-resource.js';

// P3-7: Reference to storage for session revocation checks
let _sessionStorage: Storage | null = null;
let _config: AimeatConfig | null = null;

/** Initialize session-aware auth middleware. Called once during server startup. */
export function initSessionAuth(storage: Storage, config?: AimeatConfig): void {
  _sessionStorage = storage;
  _config = config ?? null;
}

const _lastSeenCache = new Map<string, number>();
const LAST_SEEN_THROTTLE_MS = 5 * 60_000;

function touchAgentLastSeen(auth: VerifiedToken): void {
  if (!_sessionStorage) return;
  const isAgent = auth.roles.includes('agent');
  const isEco = auth.roles.includes('ecosystem');
  if (!isAgent && !isEco) return;
  const id = auth.sub;
  const now = Date.now();
  const last = _lastSeenCache.get(id) ?? 0;
  if (now - last < LAST_SEEN_THROTTLE_MS) return;
  _lastSeenCache.set(id, now);
  const iso = new Date(now).toISOString();
  // Best-effort liveness bookkeeping on the hot auth path: a failure must not fail the request, but
  // it must not be invisible either — a lastSeen that silently stops updating reads as "the agent is
  // gone" in every fleet view. The throttle above bounds how often this can log.
  const lastSeenFailed = (err: unknown) =>
    logger.warn('lastSeen update failed; fleet views will show this principal as stale', { id, error: String(err) });
  if (isEco) {
    _sessionStorage.updateEcosystemApp(id, { lastSeen: iso }).catch(lastSeenFailed);
  } else {
    _sessionStorage.updateAgent(id, { lastSeen: iso }).catch(lastSeenFailed);
  }
}

// Personal Access Tokens are presented as a Bearer credential (Authorization: Bearer
// aimeat_pat_...). They are recognised transparently by the auth middleware so an agent
// is authenticated by the header alone — like a logged-in user — with no app/client changes.

/**
 * Resolve a Personal Access Token to a verified identity (operator/owner act as the owner
 * GHII; otherwise a scoped agent identity; roles re-derived from the owner's CURRENT roles).
 * Returns null if missing/revoked/expired. Records usage without blocking the request.
 */
async function resolvePatToken(token: string): Promise<VerifiedToken | null> {
  if (!_sessionStorage) return null;
  const r = await resolvePat(_sessionStorage, token);
  if (!r) return null;
  _sessionStorage.touchPat(r.patId, new Date().toISOString())
    .catch(err => logger.warn('PAT lastUsed update failed; the token will look unused', { patId: r.patId, error: String(err) }));
  return {
    sub: r.sub,
    owner: r.owner,
    node: '',
    roles: r.roles,
    scopes: r.scopes,
    exp: r.expiresAt ? Math.floor(Date.parse(r.expiresAt) / 1000) : Math.floor(Date.now() / 1000) + 3600,
  };
}

/**
 * For a BROWSER request carrying an owner/operator PAT, set the httpOnly refresh cookie to the
 * PAT itself (once) so the webapp boots "logged in" via the cookie — like a normal login,
 * without re-sending the header on every request. The refresh endpoint validates the PAT
 * cookie on every refresh, so revoking the token takes effect immediately. Skipped for scoped
 * tokens, non-browsers, /v1/auth/* (which manage their own cookies), and when a cookie exists.
 */
function maybeSetPatBrowserSession(req: Request, res: Response, rawToken: string, patAuth: VerifiedToken): void {
  if (!_config) return;
  if (!patAuth.roles.includes('owner')) return;
  if (req.path.startsWith('/v1/auth/')) return;
  if (!String(req.headers['user-agent'] || '').includes('Mozilla')) return;
  if (readRefreshCookie(req)) return;
  setRefreshCookie(req, res, _config, rawToken);
}

// Anonymous mode: when enabled, inject this identity for unauthenticated requests
let _anonymousMode = false;
let _anonymousGaii = '';
let _anonymousOwner = '';

/** Called by server.ts after anonymous setup to enable anonymous fallback in auth middleware */
export function enableAnonymousAuth(gaii: string, owner: string): void {
  _anonymousMode = true;
  _anonymousGaii = gaii;
  _anonymousOwner = owner;
}

/** Check if anonymous mode is enabled */
export function isAnonymousMode(): boolean {
  return _anonymousMode;
}

/** Get anonymous credentials (gaii + owner) — only valid when isAnonymousMode() is true */
export function getAnonymousCredentials(): { gaii: string; owner: string } {
  return { gaii: _anonymousGaii, owner: _anonymousOwner };
}

// Extend Express Request with auth info
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: VerifiedToken;
    }
  }
}

/**
 * Has this token's session been ended? True only for a token that names a session the store has and
 * has marked revoked; a token with no `jti`, or one naming a session nobody tracked, is unaffected.
 */
async function sessionRevoked(verified: VerifiedToken): Promise<boolean> {
  if (!verified.sessionId || !_sessionStorage) return false;
  return _sessionStorage.isSessionRevoked(verified.sessionId);
}

/**
 * An app grant's ACCESS token carries no session id, so the check above cannot see it: revoking the
 * grant cleared the refresh token and nothing else, and the 15-minute access token kept reading and
 * writing the owner's memory until it expired on its own. The owner is told otherwise in as many
 * words — locales/en.json `profile.apps.revokeConfirm`: "It loses access immediately."
 *
 * The other two credential families are already answered per request: a PAT is resolved from storage
 * on every call, and owner/agent sessions go through sessionRevoked(). This is the third family, and
 * it was the only one where the button and the behaviour disagreed.
 *
 * One keyed read per app-token request, uncached for the same reason sessionRevoked() is: the row is
 * written by whoever pressed Revoke, and "immediately" is the promise being kept. A grant that has
 * disappeared counts as revoked — an app whose grant row is gone has nothing to act for.
 */
async function appGrantRevoked(verified: VerifiedToken): Promise<boolean> {
  if (!verified.app_grant || !_sessionStorage) return false;
  const grant = await _sessionStorage.getAppGrant(verified.app_grant);
  return !grant || grant.revoked === true;
}

/**
 * Is this credential dead? Three ways a JWT stops being one, and a door that asks fewer than three
 * questions is a door the revoked keep opening:
 *   - the exact token was revoked          (POST /v1/auth/revoke)
 *   - its session row was revoked          (sign out, sign out everywhere, deleting the agent)
 *   - its app grant was revoked            (the owner pressed Revoke on the app)
 *
 * Exported because verifying a JWT is not only Express's job. The WebSocket upgrade for the connect
 * tunnel (src/index-start.ts) cannot run middleware on a raw socket, so it verified the token by
 * hand — and asked none of these. A bearer revoked on every HTTP route still opened a tunnel and
 * received the on-connect backlog plus live pushes until its own exp. Any future door that verifies
 * a token itself calls this rather than writing the rule out a fourth time.
 */
export async function credentialRevoked(token: string, verified: VerifiedToken): Promise<boolean> {
  if (await isRevoked(token)) return true;
  if (await sessionRevoked(verified)) return true;
  return appGrantRevoked(verified);
}

/**
 * Optional auth middleware — parses JWT if present, does not reject if absent.
 * Use requireAuth() or requireRole() for endpoints that need auth.
 */
export function optionalAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (token) {
      if (token.startsWith(PAT_PREFIX)) {
        const patAuth = await resolvePatToken(token);
        if (patAuth) {
          req.auth = patAuth;
          maybeSetPatBrowserSession(req, res, token, patAuth);
        }
      } else if (await isRevoked(token)) {
        req.auth = undefined;
      } else {
        const verified = await verifyJWT(token);
        // SECURITY: the session check belongs HERE, not only in requireAuth(). This middleware is
        // mounted globally (server.ts), so requireAuth() finds req.auth already set and returns at
        // its first line — its own session check has therefore never run on a single route. That
        // made session revocation decorative everywhere: logout revoked the row and the bearer kept
        // working, and deleting an agent could not end the credential it held.
        //
        // Uncached on purpose. The token-hash cache in jwt.ts can afford 60 seconds because the
        // revoking caller writes its own entry; here the revocation happens in storage, and an owner
        // pressing Delete means now. One keyed read per authenticated request that carries a jti.
        if (verified && !(await credentialRevoked(token, verified))) {
          req.auth = verified;
        }
      }
    }
    // Anonymous mode: inject anonymous identity when no auth present
    if (!req.auth && _anonymousMode) {
      req.auth = {
        sub: _anonymousGaii,
        owner: _anonymousOwner,
        node: '',
        roles: ['agent'],
        exp: Math.floor(Date.now() / 1000) + 86400,
        scopes: ['memory:read', 'catalogue:read', 'social:read'],
        anonymous: true,
      };
    }
    next();
  };
}

/**
 * Require authentication. Returns 401 if no valid JWT.
 * If req.auth is already set (e.g. by optionalAuth() in anonymous mode), skips token check.
 */
export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    // If auth was already resolved by global optionalAuth() (e.g. anonymous mode)
    if (req.auth) {
      touchAgentLastSeen(req.auth);
      // SECURITY: Reject anonymous credentials — requireAuth() requires real authentication
      if (req.auth.anonymous) {
        const stats = getStats();
        if (stats) stats.increment('auth_failures_total');
        const prom = getPromMetrics();
        if (prom) prom.authFailuresTotal.inc();
        deny401(req, res, 'This endpoint requires authentication');
        return;
      }
      next();
      return;
    }

    const token = extractToken(req);
    if (!token) {
      const stats = getStats();
      if (stats) stats.increment('auth_failures_total');
      const prom = getPromMetrics();
      if (prom) prom.authFailuresTotal.inc();
      deny401(req, res, 'Authentication required');
      return;
    }

    // Personal Access Token presented as a Bearer credential — authenticate via the
    // header transparently (no app/client changes; acts like a logged-in user).
    if (token.startsWith(PAT_PREFIX)) {
      const patAuth = await resolvePatToken(token);
      if (!patAuth) {
        const stats = getStats();
        if (stats) stats.increment('auth_failures_total');
        const prom = getPromMetrics();
        if (prom) prom.authFailuresTotal.inc();
        deny401(req, res, 'Invalid or revoked access token');
        return;
      }
      req.auth = patAuth;
      maybeSetPatBrowserSession(req, res, token, patAuth);
      touchAgentLastSeen(patAuth);
      next();
      return;
    }

    if (await isRevoked(token)) {
      const stats = getStats();
      if (stats) stats.increment('auth_failures_total');
      const prom = getPromMetrics();
      if (prom) prom.authFailuresTotal.inc();
      deny401(req, res, 'Token has been revoked');
      return;
    }

    const verified = await verifyJWT(token);
    if (!verified) {
      const stats = getStats();
      if (stats) stats.increment('auth_failures_total');
      const prom = getPromMetrics();
      if (prom) prom.authFailuresTotal.inc();
      deny401(req, res, 'Invalid or expired token');
      return;
    }

    // P3-7: Check if the session has been revoked. Reached only when this middleware ran without the
    // global optionalAuth() ahead of it (unit tests, a router mounted standalone) — in the server
    // the check above has already happened and this is a second, harmless look.
    if (verified.sessionId && _sessionStorage) {
      const revokedSession = await _sessionStorage.isSessionRevoked(verified.sessionId);
      if (revokedSession) {
        const stats = getStats();
        if (stats) stats.increment('auth_failures_total');
        const prom = getPromMetrics();
        if (prom) prom.authFailuresTotal.inc();
        deny401(req, res, 'Session has been revoked');
        return;
      }
    }

    req.auth = verified;
    touchAgentLastSeen(verified);
    next();
  };
}

/**
 * Require authentication OR anonymous credentials.
 * Use for endpoints that should be accessible in anonymous mode
 * (e.g. public catalogue searches, board reads, directory listing).
 */
export function requireAuthOrAnonymous() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }
    // Allow both authenticated and anonymous
    next();
  };
}

/**
 * Require a specific role. Must be used after requireAuth().
 * Federated sessions are blocked from operator role access.
 */
export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      const stats = getStats();
      if (stats) stats.increment('auth_failures_total');
      const prom = getPromMetrics();
      if (prom) prom.authFailuresTotal.inc();
      deny401(req, res, 'Authentication required');
      return;
    }

    // Federated sessions cannot access operator functions
    if (role === 'operator' && req.auth.federated) {
      res.status(403).json(errorEnvelope('FORBIDDEN', 'Federated sessions cannot access operator functions'));
      return;
    }

    // Role hierarchy: operator > owner > (agent | ecosystem).
    // `agent` and `ecosystem` are SIBLING external-principal classes: neither satisfies the other.
    // Owner/operator may act for their own agents AND their own ecosystem connections.
    const hasRole = req.auth.roles.includes(role) ||
      (role === 'agent' && req.auth.roles.includes('owner')) ||
      (role === 'agent' && req.auth.roles.includes('operator')) ||
      (role === 'ecosystem' && req.auth.roles.includes('owner')) ||
      (role === 'ecosystem' && req.auth.roles.includes('operator')) ||
      (role === 'owner' && req.auth.roles.includes('operator'));

    if (!hasRole) {
      res.status(403).json(errorEnvelope('ACCESS_DENIED', `Role "${role}" required`));
      return;
    }

    next();
  };
}

/**
 * Require a principal that IS the account holder, rather than something acting on the account
 * holder's behalf. For the doors that decide who can get back INTO the account: the password, the
 * recovery address, the second factor, the identity proof, and deleting or exporting everything.
 *
 * WHY NOT requireRole('owner'). The `owner` role does not say which principal is calling. The agent
 * branch of POST /v1/auth/token used to mint an agent session carrying the human's owner (and
 * operator) roles — the August 2026 audit removed that in the same run — and the two unauthenticated
 * mints in routes/ghii/web-verify.ts still do it today, so requireRole('owner') admits an agent JWT.
 * The exclusions below are what makes this gate hold regardless of who else stops copying roles onto
 * whom, and that is the reason to spell the test out here instead of leaning on a role name.
 *
 * WHY NOT "does the token carry a session id". A Personal Access Token the human minted for their
 * own browser produces owner tokens with NO session id (the PAT branch of POST /v1/auth/refresh),
 * so that test would sign real people out of their own account settings. An owner-level PAT passes
 * here, and that is correct: it is a credential the human created behind requireRole('owner').
 *
 * WHAT IS EXCLUDED. `agent` and `ecosystem` are external principals with their own identity; `app`
 * is a published app holding a scoped grant. All three carry the HUMAN's account name in
 * `req.auth.owner`, which is what every handler under /v1/ghii keys off, so without this gate all
 * three land on the human's record: set a password on an account that has none and then sign in as
 * them, point the recovery address at a mailbox they control and mail themselves a reset code, or
 * arm a second factor with a secret the human never sees.
 *
 * The one way in for an external principal is ACCOUNT_SECURITY_SCOPE, granted per agent by the
 * owner in the agent permission editor. It is tested as the EXACT string: no wildcard carries it
 * (utils/scope-coverage.ts), and no existing agent was grandfathered onto it, so an agent is here
 * only because the owner ticked that one box. An `app` is refused whatever it holds — an app grant
 * is consent to use the account, never consent to take it over — and the word is deliberately
 * absent from APP_GRANTABLE_SCOPES so an app cannot ask for it either.
 */
export function requireOwnerPrincipal() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }
    const roles = req.auth.roles;
    const isApp = roles.includes('app');
    const isOwnerPrincipal = roles.includes('owner') && !isApp &&
      !roles.includes('agent') && !roles.includes('ecosystem');
    if (isOwnerPrincipal) {
      next();
      return;
    }
    // Exact string, no wildcard. scope-coverage.ts enforces the same rule everywhere a scope is
    // proposed or approved; this line is that rule at the door itself.
    if (!isApp && (req.auth.scopes ?? []).includes(ACCOUNT_SECURITY_SCOPE)) {
      next();
      return;
    }
    logger.warn(`[account-security-denied] ${req.auth.sub} on ${req.method} ${req.path}`);
    res.status(403).json(errorEnvelope('ACCESS_DENIED',
      'This changes how the account is signed into, so it is reserved to the account holder. ' +
      `An agent needs the "${ACCOUNT_SECURITY_SCOPE}" permission, which the owner grants per agent.`));
  };
}

/**
 * Require the NODE OPERATOR, or something the operator explicitly sent. For the break-glass doors
 * that reach across accounts: repairing an organism whose owner is unreachable is the first of them.
 *
 * WHY NOT requireRole('operator'). That tests the token's own role list, so it admits the operator's
 * browser session and refuses the operator's AGENTS — and an agent should be able to do what a
 * person can. This gate asks the question one level up: is the ACCOUNT behind this principal an
 * operator account? The four `aimeat_admin_*` MCP tools already resolve the operator that way
 * (mcp/core-admin.ts), so the two surfaces now agree instead of disagreeing by accident.
 *
 * WHY A SCOPE ON TOP. The role alone would hand every one of the operator's agents a node-wide
 * capability the moment it exists, and that is the shape of the incident this door was built for: an
 * agent with no scope limit called the ownership transfer during a test run and gave away the node's
 * own development organism. The word is tested as the EXACT string — no wildcard carries it
 * (SCOPES_OUTSIDE_WILDCARD), nobody was grandfathered onto it, and `app` principals are refused
 * outright, because an app grant is consent to use the account and never consent to act as the node.
 *
 * Federated sessions are refused for the same reason requireRole('operator') refuses them: operator
 * power stops at this node's own front door.
 */
export function requireOperatorPrincipal(storage: Storage) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }
    if (req.auth.federated) {
      res.status(403).json(errorEnvelope('FORBIDDEN', 'Federated sessions cannot access operator functions'));
      return;
    }
    const roles = req.auth.roles;
    // The operator in person: an operator session that is not something acting on its behalf.
    if (roles.includes('operator') && !roles.includes('app') &&
        !roles.includes('agent') && !roles.includes('ecosystem')) {
      next();
      return;
    }
    if (roles.includes('app')) {
      res.status(403).json(errorEnvelope('ACCESS_DENIED', 'An app grant cannot carry operator functions'));
      return;
    }
    // Anything else: the ACCOUNT must be an operator, and the principal must carry the exact word.
    const owner = await storage.getOwner(req.auth.owner as string);
    if (!owner?.roles.includes('operator')) {
      res.status(403).json(errorEnvelope('ACCESS_DENIED', 'Node operator required'));
      return;
    }
    if (!(req.auth.scopes ?? []).includes(OPERATOR_ORGANISM_REPAIR_SCOPE)) {
      logger.warn(`[operator-scope-denied] ${req.auth.sub} on ${req.method} ${req.path}`);
      res.status(403).json(errorEnvelope('SCOPE_DENIED',
        `Scope "${OPERATOR_ORGANISM_REPAIR_SCOPE}" required. The node operator grants it per agent, ` +
        'and no wildcard carries it.'));
      return;
    }
    next();
  };
}

/**
 * Require a scoped EXTERNAL principal — an agent (GAII) OR an ecosystem app (GEAI). Owner/operator
 * also pass (they act for their own external principals, exactly as with requireRole('agent')).
 * Use this on routes that legitimately serve either external principal (e.g. the memory CRUD a GEAI
 * uses to deposit refined data). This is a strict SUPERSET of requireRole('agent') — it only widens
 * access to add the ecosystem role, so agent/owner behavior is unchanged. Scopes are still enforced
 * separately by requireScope() for both agents and GEAIs.
 */
export function requireExternalPrincipal() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      const stats = getStats();
      if (stats) stats.increment('auth_failures_total');
      const prom = getPromMetrics();
      if (prom) prom.authFailuresTotal.inc();
      deny401(req, res, 'Authentication required');
      return;
    }
    const roles = req.auth.roles;
    // `app` is a third scoped external-principal class (H-2 app grants): a user-published app
    // holding an explicit, scoped grant token. Like agent/ecosystem it is scope-enforced by
    // requireScope() (no owner bypass — its role is not 'owner'), so widening here only lets a
    // granted app reach the same data CRUD an agent/GEAI uses, never escalating its scopes.
    const ok = roles.includes('agent') || roles.includes('ecosystem') ||
      roles.includes('app') || roles.includes('owner') || roles.includes('operator');
    if (!ok) {
      res.status(403).json(errorEnvelope('ACCESS_DENIED', 'Agent, ecosystem-app, or app principal required'));
      return;
    }
    next();
  };
}

/**
 * Build an "agent record missing" response. Use this in route handlers AFTER
 * `storage.getAgent(...)` returns null, when the request is authenticated.
 *
 * Why this exists: a signed agent JWT can outlive the agent record itself --
 * the owner can delete an agent from the Profile UI without revoking the
 * token, and the token will keep authenticating fine (valid signature, valid
 * exp, no revocation entry) while every storage.getAgent() lookup returns
 * null. Bare "Agent not found" is misleading in that state because it sounds
 * like the agent name was mistyped; the real cause is that the local
 * connector cache + token are stale relative to the server. This helper
 * detects the desync (caller's GAII matches the missing agent) and returns
 * AGENT_NOT_REGISTERED with a concrete recovery hint pointing at
 * `aimeat connect add`. For all other callers (owner sessions looking up
 * someone else's agent, or genuine unknown names) the standard NOT_FOUND is
 * returned.
 */
export function agentNotFoundResponse(
  req: Request,
  agentName: string,
  expectedGaii: string,
  config: { nodeId: string; baseUrl: string },
): { status: number; code: string; message: string } {
  const isAgentSession = req.auth?.roles.includes('agent') === true;
  const callerGaii = req.auth?.sub;
  if (isAgentSession && callerGaii === expectedGaii) {
    return {
      status: 404,
      code: 'AGENT_NOT_REGISTERED',
      message:
        `Your token is valid but agent '${agentName}' has no record on node ${config.nodeId}. ` +
        `The agent was likely deleted server-side. Re-register with: ` +
        `aimeat connect add --agent ${agentName} --owner ${req.auth?.owner ?? '<owner>'} --url ${config.baseUrl}`,
    };
  }
  return {
    status: 404,
    code: 'NOT_FOUND',
    message: `Agent '${agentName}' not found`,
  };
}

/**
 * Require a local (non-federated) session. Returns 403 for federated sessions.
 * Use on endpoints that should not be accessible to federated users
 * (e.g., agent creation on remote nodes).
 */
export function requireLocalSession() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.federated) {
      res.status(403).json(errorEnvelope('FORBIDDEN', 'This action requires a local session'));
      return;
    }
    next();
  };
}

// Generator scopes (agent-driven service generation):
// generator:read    — read projects, interview specs, components, session state
// generator:write   — create projects, save interview spec, submit blueprint and components
// generator:execute — claim/release sessions, register and activate components, write logs

/**
 * Require specific scopes. Must be used after requireAuth().
 * Checks if the agent's JWT scopes include the required scopes.
 * Supports exact match, domain wildcards (memory:*), and global wildcard (*).
 * Owner/operator role bypasses scope checks (they act as owners, not scoped agents).
 * Agents with explicit scopes are always enforced, even if their owner is an operator.
 */
/**
 * Pass if the caller satisfies requireRole(role) OR carries one of `scopes`. Lets a role-'app' (H-2)
 * or ecosystem session with an explicit owner-granted scope do what the named role can do.
 *
 * READ THIS BEFORE REACHING FOR IT. The role path runs FIRST and unconditionally, so for the role
 * named here the scope is DECORATIVE: an agent passed requireRoleOrScope('agent', 'organism:write')
 * whether or not its owner ticked organism:write. That was measured on a running node — an agent
 * holding seven explicit scopes without the word could not even SEE aimeat_organism_create on its
 * MCP surface, because the tool surface filters on that same word at registration, and the same
 * agent got 201 Created from POST /v1/organisms. Enforced on the surface the owner reads, ignored on
 * the door that writes: security DNA invariant 15.
 *
 * So this helper is right only where the ROLE is the permission and the scope WIDENS it to a
 * principal class that does not carry that role. requireRoleOrScope('owner', 'agent:delete') is that
 * shape: the owner may delete their own agent by being the owner, and a fleet-managing agent may do
 * it on the explicit word. It is the wrong shape whenever the scope is meant to bind the same
 * principals the role already admits — there, use requireScope(), which keeps the owner-session
 * bypass and refuses an agent that lacks the word. The three organism write doors moved to
 * requireScope on 2026-08-14 for exactly that reason; see routes/organisms/crud.ts.
 */
export function requireRoleOrScope(role: string, ...scopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) { deny401(req, res, 'Authentication required'); return; }
    const roles = req.auth.roles;
    // Role path — mirrors requireRole(role) exactly (owner/operator satisfy 'agent'; operator satisfies 'owner').
    if (roles.includes(role) ||
        (role === 'agent' && (roles.includes('owner') || roles.includes('operator'))) ||
        (role === 'owner' && roles.includes('operator'))) { next(); return; }
    // Scope path — any authenticated principal carrying the grant (wildcard-aware, mirrors requireScope).
    const have = req.auth.scopes ?? [];
    if (have.includes('*') || scopes.some(s => have.includes(s) || have.includes(`${s.split(':')[0]}:*`))) { next(); return; }
    res.status(403).json(errorEnvelope('ACCESS_DENIED', `Requires role '${role}' or one of scopes: [${scopes.join(', ')}]`));
  };
}

export function requireScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }

    // Owner-role requests bypass scope checks (owners act on behalf of all their agents).
    // But agent- AND ecosystem-role requests MUST respect scopes, even if their owner is an
    // operator: a GEAI is a scoped external principal and must NEVER receive the owner bypass.
    if (req.auth.roles.includes('owner') &&
        !req.auth.roles.includes('agent') && !req.auth.roles.includes('ecosystem')) {
      next();
      return;
    }

    const agentScopes = req.auth.scopes;

    // Global wildcard
    if (agentScopes.includes('*')) {
      next();
      return;
    }

    for (const required of requiredScopes) {
      const [domain] = required.split(':');
      const hasExact = agentScopes.includes(required);
      const hasDomainWild = agentScopes.includes(`${domain}:*`);

      if (!hasExact && !hasDomainWild) {
        logger.warn(`[scope-denied] ${req.auth.sub} needs "${required}", has [${agentScopes.join(', ')}] on ${req.method} ${req.path}`);
        res.status(403).json(errorEnvelope('SCOPE_DENIED', `Scope "${required}" required. Agent scopes: [${agentScopes.join(', ')}]`));
        return;
      }
    }

    next();
  };
}

/**
 * Like requireScope, but ANY of the listed scopes is enough.
 *
 * requireScope is an AND, which is the right default: a route that needs two permissions needs
 * both. This is for the case where two DIFFERENT principals legitimately reach the same route by
 * different routes of trust — an owner reading their own connections with `connections:read`, and a
 * granted app reading the same list with `connections:use` because it may publish to one and
 * therefore has to be able to name one.
 *
 * A named guard rather than an inline check in the route: the owner bypass and the domain wildcard
 * are security logic, and security logic copied into a handler is security logic that drifts.
 */
export function requireAnyScope(...acceptableScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }
    if (req.auth.roles.includes('owner') &&
        !req.auth.roles.includes('agent') && !req.auth.roles.includes('ecosystem')) {
      next();
      return;
    }
    const held = req.auth.scopes;
    if (held.includes('*')) {
      next();
      return;
    }
    const ok = acceptableScopes.some((required) => {
      const [domain] = required.split(':');
      return held.includes(required) || held.includes(`${domain}:*`);
    });
    if (ok) {
      next();
      return;
    }
    logger.warn(`[scope-denied] ${req.auth.sub} needs any of "${acceptableScopes.join('", "')}", has [${held.join(', ')}] on ${req.method} ${req.path}`);
    res.status(403).json(errorEnvelope('SCOPE_DENIED',
      `One of these scopes is required: ${acceptableScopes.join(', ')}. Agent scopes: [${held.join(', ')}]`));
  };
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // SECURITY: JWT tokens must NOT be accepted via URL query parameters.
  // Tokens in URLs are logged in access logs, browser history, and referrer headers.
  return null;
}

/**
 * Refuse an unauthenticated request with 401 AND the RFC 9728 discovery hint. The
 * `resource_metadata` parameter names the protected-resource metadata of the ORIGIN the client
 * actually reached (apex, app origin, portfolio origin), which is how an MCP client learns where
 * to get a token without having been told out of band. Header omitted when the config was never
 * wired (unit tests constructing middleware standalone) — the 401 body is unchanged either way.
 */
function deny401(req: Request, res: Response, message: string): void {
  if (_config && !res.headersSent) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl(req, _config)}"`);
  }
  res.status(401).json(errorEnvelope('AUTH_REQUIRED', message));
}

function errorEnvelope(code: string, message: string) {
  return {
    ok: false,
    protocol: 'aimeat',
    version: 'v1',
    timestamp: new Date().toISOString(),
    error: { code, message },
    hints: {
      next_actions: [
        { description: 'Authenticate to get a JWT token', method: 'POST', url: '/v1/auth/token' },
      ],
    },
  };
}
