import { describe, it, expect, vi } from 'vitest';
import { requireAuth, requireRole, requireScope, requireAuthOrAnonymous } from '../../src/auth/middleware.js';
import type { VerifiedToken } from '../../src/auth/jwt.js';
import type { Request, Response, NextFunction } from 'express';

// ── Mock helpers ──────────────────────────────────────────────────────

/** Build a mock Express Request with optional auth already attached. */
function mockReq(overrides: Partial<Request & { auth?: VerifiedToken }> = {}): Request {
    return {
        headers: {},
        method: 'GET',
        path: '/v1/test',
        auth: undefined,
        ...overrides,
    } as unknown as Request;
}

/** Build a mock Express Response that captures status codes and JSON bodies. */
function mockRes(): Response & { _status: number | null; _json: unknown } {
    const r = {
        _status: null as number | null,
        _json: undefined as unknown,
        status(code: number) { r._status = code; return r; },
        json(body: unknown) { r._json = body; return r; },
    };
    return r as unknown as Response & { _status: number | null; _json: unknown };
}

/** Create a VerifiedToken for testing. */
function token(overrides: Partial<VerifiedToken> = {}): VerifiedToken {
    return {
        sub: 'agent#alice@node',
        owner: 'alice',
        node: 'test-node',
        roles: ['agent'],
        exp: Math.floor(Date.now() / 1000) + 3600,
        scopes: ['*'],
        ...overrides,
    };
}

// ── Mock external dependencies ───────────────────────────────────────

// The middleware imports stats and prometheus — stub them to avoid side effects.
vi.mock('../../src/services/stats.js', () => ({
    getStats: () => null,
}));
vi.mock('../../src/services/prometheus.js', () => ({
    getPromMetrics: () => null,
}));
vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// =====================================================================
// requireScope — scope resolution tests
// =====================================================================

describe('requireScope', () => {
    describe('exact scope matching', () => {
        it('passes when agent has the exact required scope', () => {
            const mw = requireScope('memory:read');
            const req = mockReq({ auth: token({ scopes: ['memory:read'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res._status).toBeNull();
        });

        it('denies when agent lacks the required scope', () => {
            const mw = requireScope('memory:write');
            const req = mockReq({ auth: token({ scopes: ['memory:read'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res._status).toBe(403);
            expect((res._json as any).error.code).toBe('SCOPE_DENIED');
        });

        it('passes when agent has multiple scopes including the required one', () => {
            const mw = requireScope('catalogue:read');
            const req = mockReq({ auth: token({ scopes: ['memory:read', 'catalogue:read', 'social:write'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe('domain wildcard matching', () => {
        it('passes when agent has domain:* and needs domain:read', () => {
            const mw = requireScope('memory:read');
            const req = mockReq({ auth: token({ scopes: ['memory:*'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res._status).toBeNull();
        });

        it('passes when agent has domain:* and needs domain:write', () => {
            const mw = requireScope('memory:write');
            const req = mockReq({ auth: token({ scopes: ['memory:*'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('denies when agent has different domain wildcard', () => {
            const mw = requireScope('memory:read');
            const req = mockReq({ auth: token({ scopes: ['catalogue:*'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res._status).toBe(403);
        });
    });

    describe('global wildcard', () => {
        it('passes when agent has global wildcard *', () => {
            const mw = requireScope('memory:read');
            const req = mockReq({ auth: token({ scopes: ['*'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('passes any scope when agent has global wildcard', () => {
            const mw = requireScope('catalogue:write', 'social:read', 'wallet:transfer');
            const req = mockReq({ auth: token({ scopes: ['*'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe('multiple required scopes', () => {
        it('passes when agent has all required scopes', () => {
            const mw = requireScope('memory:read', 'catalogue:read');
            const req = mockReq({ auth: token({ scopes: ['memory:read', 'catalogue:read'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('denies when agent is missing one of the required scopes', () => {
            const mw = requireScope('memory:read', 'catalogue:write');
            const req = mockReq({ auth: token({ scopes: ['memory:read'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res._status).toBe(403);
            expect((res._json as any).error.message).toContain('catalogue:write');
        });

        it('passes when multiple scopes are covered by domain wildcards', () => {
            const mw = requireScope('memory:read', 'memory:write');
            const req = mockReq({ auth: token({ scopes: ['memory:*'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('passes when one scope is exact and another is covered by domain wildcard', () => {
            const mw = requireScope('memory:read', 'catalogue:write');
            const req = mockReq({ auth: token({ scopes: ['memory:read', 'catalogue:*'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('denies on the first missing scope and stops checking', () => {
            const mw = requireScope('memory:read', 'catalogue:write', 'social:read');
            const req = mockReq({ auth: token({ scopes: ['memory:read', 'social:read'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).not.toHaveBeenCalled();
            // The error message should reference the first missing scope (catalogue:write)
            expect((res._json as any).error.message).toContain('catalogue:write');
        });
    });

    describe('operator bypass', () => {
        // Operator principals always co-carry the 'owner' role in production
        // (operator ⊂ owner); the scope bypass keys off 'owner'. operator-only is never minted.
        it('operators bypass all scope checks', () => {
            const mw = requireScope('memory:read', 'catalogue:write', 'wallet:transfer');
            const req = mockReq({ auth: token({ roles: ['owner', 'operator'], scopes: [] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('operator with empty scopes still passes', () => {
            const mw = requireScope('social:admin');
            const req = mockReq({ auth: token({ roles: ['owner', 'operator'], scopes: [] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe('no auth', () => {
        it('returns 401 when no auth is present', () => {
            const mw = requireScope('memory:read');
            const req = mockReq();
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res._status).toBe(401);
            expect((res._json as any).error.code).toBe('AUTH_REQUIRED');
        });
    });
});

// =====================================================================
// requireRole — role hierarchy tests
// =====================================================================

describe('requireRole', () => {
    describe('exact role matching', () => {
        it('agent passes when agent role is required', () => {
            const mw = requireRole('agent');
            const req = mockReq({ auth: token({ roles: ['agent'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('owner passes when owner role is required', () => {
            const mw = requireRole('owner');
            const req = mockReq({ auth: token({ roles: ['owner'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('operator passes when operator role is required', () => {
            const mw = requireRole('operator');
            const req = mockReq({ auth: token({ roles: ['operator'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe('role hierarchy: operator > owner > agent', () => {
        it('operator can access agent-only endpoints', () => {
            const mw = requireRole('agent');
            const req = mockReq({ auth: token({ roles: ['operator'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('operator can access owner-only endpoints', () => {
            const mw = requireRole('owner');
            const req = mockReq({ auth: token({ roles: ['operator'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('owner can access agent-only endpoints', () => {
            const mw = requireRole('agent');
            const req = mockReq({ auth: token({ roles: ['owner'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('agent cannot access owner-only endpoints', () => {
            const mw = requireRole('owner');
            const req = mockReq({ auth: token({ roles: ['agent'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res._status).toBe(403);
            expect((res._json as any).error.code).toBe('ACCESS_DENIED');
        });

        it('agent cannot access operator-only endpoints', () => {
            const mw = requireRole('operator');
            const req = mockReq({ auth: token({ roles: ['agent'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res._status).toBe(403);
        });

        it('owner cannot access operator-only endpoints', () => {
            const mw = requireRole('operator');
            const req = mockReq({ auth: token({ roles: ['owner'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res._status).toBe(403);
        });
    });

    describe('multi-role tokens', () => {
        it('owner+operator can access operator endpoints', () => {
            const mw = requireRole('operator');
            const req = mockReq({ auth: token({ roles: ['owner', 'operator'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('owner+operator can access agent endpoints', () => {
            const mw = requireRole('agent');
            const req = mockReq({ auth: token({ roles: ['owner', 'operator'] }) });
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe('no auth', () => {
        it('returns 401 when no auth is present', () => {
            const mw = requireRole('agent');
            const req = mockReq();
            const res = mockRes();
            const next = vi.fn();

            mw(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res._status).toBe(401);
            expect((res._json as any).error.code).toBe('AUTH_REQUIRED');
        });
    });
});

// =====================================================================
// requireAuthOrAnonymous — anonymous access tests
// =====================================================================

describe('requireAuthOrAnonymous', () => {
    it('passes when authenticated with real token', () => {
        const mw = requireAuthOrAnonymous();
        const req = mockReq({ auth: token() });
        const res = mockRes();
        const next = vi.fn();

        mw(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('passes when authenticated with anonymous token', () => {
        const mw = requireAuthOrAnonymous();
        const req = mockReq({ auth: token({ anonymous: true }) });
        const res = mockRes();
        const next = vi.fn();

        mw(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('returns 401 when no auth is present', () => {
        const mw = requireAuthOrAnonymous();
        const req = mockReq();
        const res = mockRes();
        const next = vi.fn();

        mw(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res._status).toBe(401);
    });
});

// =====================================================================
// requireAuth — authentication gate tests
// =====================================================================

describe('requireAuth', () => {
    it('passes when auth is already set on the request (pre-resolved)', async () => {
        const mw = requireAuth();
        const req = mockReq({ auth: token() });
        const res = mockRes();
        const next = vi.fn();

        await mw(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('rejects anonymous credentials — requireAuth needs real auth', async () => {
        const mw = requireAuth();
        const req = mockReq({ auth: token({ anonymous: true }) });
        const res = mockRes();
        const next = vi.fn();

        await mw(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res._status).toBe(401);
    });

    it('returns 401 when no token is in the Authorization header', async () => {
        const mw = requireAuth();
        const req = mockReq({ headers: {} });
        const res = mockRes();
        const next = vi.fn();

        await mw(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res._status).toBe(401);
        expect((res._json as any).error.code).toBe('AUTH_REQUIRED');
        expect((res._json as any).error.message).toBe('Authentication required');
    });
});

// =====================================================================
// Error response shape
// =====================================================================

describe('error response shape', () => {
    it('scope denial includes AIMEAT protocol fields', () => {
        const mw = requireScope('memory:write');
        const req = mockReq({ auth: token({ scopes: ['memory:read'] }) });
        const res = mockRes();
        const next = vi.fn();

        mw(req, res, next);

        const body = res._json as any;
        expect(body.ok).toBe(false);
        expect(body.protocol).toBe('aimeat');
        expect(body.version).toBe('v1');
        expect(body.error.code).toBe('SCOPE_DENIED');
        expect(body.timestamp).toBeDefined();
        expect(body.hints.next_actions).toHaveLength(1);
        expect(body.hints.next_actions[0].url).toBe('/v1/auth/token');
    });

    it('role denial includes AIMEAT protocol fields', () => {
        const mw = requireRole('operator');
        const req = mockReq({ auth: token({ roles: ['agent'] }) });
        const res = mockRes();
        const next = vi.fn();

        mw(req, res, next);

        const body = res._json as any;
        expect(body.ok).toBe(false);
        expect(body.protocol).toBe('aimeat');
        expect(body.error.code).toBe('ACCESS_DENIED');
        expect(body.error.message).toContain('operator');
    });

    it('auth required includes hint to get a token', () => {
        const mw = requireRole('agent');
        const req = mockReq();
        const res = mockRes();
        const next = vi.fn();

        mw(req, res, next);

        const body = res._json as any;
        expect(body.hints.next_actions[0].method).toBe('POST');
        expect(body.hints.next_actions[0].url).toBe('/v1/auth/token');
    });
});
