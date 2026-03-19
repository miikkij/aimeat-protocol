import type { Request, Response, NextFunction } from 'express';
import { verifyJWT, isRevoked, type VerifiedToken } from './jwt.js';
import { getStats } from '../services/stats.js';
import { getPromMetrics } from '../services/prometheus.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

// P3-7: Reference to storage for session revocation checks
let _sessionStorage: Storage | null = null;

/** Initialize session-aware auth middleware. Called once during server startup. */
export function initSessionAuth(storage: Storage): void {
  _sessionStorage = storage;
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
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (token) {
      if (await isRevoked(token)) {
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

    // Role hierarchy: operator > owner > agent
    const hasRole = req.auth.roles.includes(role) ||
      (role === 'agent' && req.auth.roles.includes('owner')) ||
      (role === 'agent' && req.auth.roles.includes('operator')) ||
      (role === 'owner' && req.auth.roles.includes('operator'));

    if (!hasRole) {
      res.status(403).json(errorEnvelope('ACCESS_DENIED', `Role "${role}" required`));
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
export function requireScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Authentication required'));
      return;
    }

    // Owner-role requests bypass scope checks (owners act on behalf of all their agents)
    // But agent-role requests MUST respect scopes, even if their owner is an operator
    if (req.auth.roles.includes('owner') && !req.auth.roles.includes('agent')) {
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
