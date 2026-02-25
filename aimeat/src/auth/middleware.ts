import type { Request, Response, NextFunction } from 'express';
import { verifyJWT, isRevoked, type VerifiedToken } from './jwt.js';

// Extend Express Request with auth info
declare global {
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
    next();
  };
}

/**
 * Require authentication. Returns 401 if no valid JWT.
 */
export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Authentication required'));
      return;
    }

    if (isRevoked(token)) {
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Token has been revoked'));
      return;
    }

    const verified = await verifyJWT(token);
    if (!verified) {
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

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Fallback: _token query parameter
  const queryToken = req.query._token;
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
