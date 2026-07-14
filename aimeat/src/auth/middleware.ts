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
 *   - resolvePatToken / maybeSetPatBrowserSession: Personal Access Token handling
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Request, Response, NextFunction } from 'express';
import { verifyJWT, isRevoked, type VerifiedToken } from './jwt.js';
import { setRefreshCookie, readRefreshCookie } from '../services/owner-session.js';
import { resolvePat, PAT_PREFIX } from '../services/access-token.js';
import type { AimeatConfig } from '../config.js';
import { getStats } from '../services/stats.js';
import { getPromMetrics } from '../services/prometheus.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

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
  if (isEco) {
    _sessionStorage.updateEcosystemApp(id, { lastSeen: iso }).catch(() => {});
  } else {
    _sessionStorage.updateAgent(id, { lastSeen: iso }).catch(() => {});
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
  _sessionStorage.touchPat(r.patId, new Date().toISOString()).catch(() => {});
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
        if (verified) {
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
        res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'This endpoint requires authentication'));
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
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Authentication required'));
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
        res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Invalid or revoked access token'));
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
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Token has been revoked'));
      return;
    }

    const verified = await verifyJWT(token);
    if (!verified) {
      const stats = getStats();
      if (stats) stats.increment('auth_failures_total');
      const prom = getPromMetrics();
      if (prom) prom.authFailuresTotal.inc();
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Invalid or expired token'));
      return;
    }

    // P3-7: Check if the session has been revoked
    if (verified.sessionId && _sessionStorage) {
      const sessionRevoked = await _sessionStorage.isSessionRevoked(verified.sessionId);
      if (sessionRevoked) {
        const stats = getStats();
        if (stats) stats.increment('auth_failures_total');
        const prom = getPromMetrics();
        if (prom) prom.authFailuresTotal.inc();
        res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Session has been revoked'));
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
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Authentication required'));
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
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Authentication required'));
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
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Authentication required'));
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
 * Pass if the caller satisfies requireRole(role) OR carries one of `scopes`. Generalizes the
 * organism:invite pattern: a role-'app' (H-2) or ecosystem session with an explicit owner-granted
 * scope may do what agents/owners can do by role — without weakening the role path (existing
 * agent/owner/operator callers keep working regardless of their scopes). Used to let a published app
 * provision an organism/workspace on its owner's behalf (organism:write) the same way it can invite
 * (organism:invite).
 */
export function requireRoleOrScope(role: string, ...scopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) { res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Authentication required')); return; }
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
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Authentication required'));
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

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // SECURITY: JWT tokens must NOT be accepted via URL query parameters.
  // Tokens in URLs are logged in access logs, browser history, and referrer headers.
  return null;
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
