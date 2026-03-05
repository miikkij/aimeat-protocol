import type { Request, Response, NextFunction } from 'express';
import { verifyJWT, isRevoked, type VerifiedToken } from './jwt.js';
import { getStats } from '../services/stats.js';
import { getPromMetrics } from '../services/prometheus.js';

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
      if (isRevoked(token)) {
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
    // If auth was already resolved by global optionalAuth() (e.g. anonymous mode), pass through
    if (req.auth) {
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

    if (isRevoked(token)) {
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

    req.auth = verified;
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

/**
 * Require specific scopes. Must be used after requireAuth().
 * Checks if the agent's JWT scopes include the required scopes.
 * Supports exact match, domain wildcards (memory:*), and global wildcard (*).
 * Operators bypass all scope checks.
 */
export function requireScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Authentication required'));
      return;
    }

    // Operators always have full access
    if (req.auth.roles.includes('operator')) {
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
        console.warn(`[scope-denied] ${req.auth.sub} needs "${required}", has [${agentScopes.join(', ')}] on ${req.method} ${req.path}`);
        res.status(403).json(errorEnvelope('SCOPE_DENIED', `Scope "${required}" required. Agent scopes: [${agentScopes.join(', ')}]`));
        return;
      }
    }

    next();
  };
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Fallback: token or _token query parameter
  const queryToken = req.query.token ?? req.query._token;
  if (typeof queryToken === 'string') {
    return queryToken;
  }
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
