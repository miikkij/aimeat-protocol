/**
 * @file test/unit/owner-principal-gate.test.ts
 * @description requireOwnerPrincipal(): who may change how an account is signed into.
 *
 *   The routes behind it (password, recovery address, TOTP, identity proof, account delete and
 *   export) all key off req.auth.owner, and req.auth.owner is the HUMAN's account name on an agent
 *   JWT, a GEAI token and an app-grant token alike. So "which account" was never the question that
 *   needed answering there; "which of that account's principals" was, and nothing asked it.
 *
 *   Two properties are asserted here rather than in the route suite, because neither is visible in
 *   a response body: an agent session that ALSO carries the owner role is still an agent (the mint
 *   at POST /v1/auth/token copies the owner's roles onto it), and the companion scope is honoured on
 *   the exact string only, so a wildcard grant never reaches these doors.
 * @usage cd aimeat && pnpm exec vitest run test/unit/owner-principal-gate.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit, H-1/H-7 step 7b).
 */
import { describe, it, expect, vi } from 'vitest';
import { requireOwnerPrincipal, requireRole } from '../../src/auth/middleware.js';
import { ACCOUNT_SECURITY_SCOPE, SCOPES_OUTSIDE_WILDCARD } from '../../src/utils/scope-coverage.js';
import type { VerifiedToken } from '../../src/auth/jwt.js';
import type { Request, Response } from 'express';

vi.mock('../../src/services/stats.js', () => ({ getStats: () => null }));
vi.mock('../../src/services/prometheus.js', () => ({ getPromMetrics: () => null }));
vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function mockReq(auth?: VerifiedToken): Request {
    return { headers: {}, method: 'POST', path: '/v1/ghii/password/change', auth } as unknown as Request;
}

function mockRes(): Response & { _status: number | null; _json: any } {
    const r = {
        _status: null as number | null,
        _json: undefined as any,
        status(code: number) { r._status = code; return r; },
        json(body: unknown) { r._json = body; return r; },
        setHeader() { return r; },
        headersSent: false,
    };
    return r as unknown as Response & { _status: number | null; _json: any };
}

function token(overrides: Partial<VerifiedToken> = {}): VerifiedToken {
    return {
        sub: 'alice@node',
        owner: 'alice',
        node: 'test-node',
        roles: ['owner'],
        exp: Math.floor(Date.now() / 1000) + 3600,
        scopes: [],
        ...overrides,
    };
}

/** Run the gate and report which way it went. */
function run(auth?: VerifiedToken) {
    const req = mockReq(auth);
    const res = mockRes();
    const next = vi.fn();
    requireOwnerPrincipal()(req, res, next);
    return { passed: next.mock.calls.length === 1, status: res._status, body: res._json };
}

describe('the account holder gets in', () => {
    it('an owner session passes', () => {
        expect(run(token({ roles: ['owner'] })).passed).toBe(true);
    });

    it('an operator session passes (operators co-carry owner)', () => {
        expect(run(token({ roles: ['owner', 'operator'] })).passed).toBe(true);
    });

    it('an owner-level PAT passes even with no session id', () => {
        // The PAT-backed browser session mints owner tokens with no sessionId (the PAT branch of
        // POST /v1/auth/refresh). Testing for a session id here would sign real people out of
        // their own settings page, which is why the gate tests roles instead.
        const pat = token({ roles: ['owner'], scopes: [] });
        expect('sessionId' in pat).toBe(false);
        expect(run(pat).passed).toBe(true);
    });
});

describe('a machine principal of the same owner does not', () => {
    // Each of these carries owner: 'alice'. That is the whole defect: the handler reads
    // req.auth.owner and lands on Alice's record whichever of these is calling.
    const refused: Array<[string, VerifiedToken]> = [
        ['an agent JWT', token({ sub: 'claude#alice@node', roles: ['agent'], scopes: ['*'] })],
        ['an agent JWT that also carries the owner role', token({ sub: 'claude#alice@node', roles: ['agent', 'owner'], scopes: ['*'] })],
        ['an agent JWT of an operator account', token({ sub: 'claude#alice@node', roles: ['agent', 'owner', 'operator'], scopes: ['*'] })],
        ['a GEAI token', token({ sub: 'eco:news#alice@node', roles: ['ecosystem'], scopes: ['*'] })],
        ['an app-grant token', token({ sub: 'app:board@alice@node', roles: ['app'], scopes: ['*'] })],
    ];

    for (const [what, auth] of refused) {
        it(`${what} is refused with 403 ACCESS_DENIED`, () => {
            const r = run(auth);
            expect(r.passed).toBe(false);
            expect(r.status).toBe(403);
            expect(r.body.error.code).toBe('ACCESS_DENIED');
        });
    }

    it('the refusal names the permission that would open the door', () => {
        const r = run(token({ roles: ['agent'], scopes: ['memory:read'] }));
        expect(r.body.error.message).toContain(ACCOUNT_SECURITY_SCOPE);
    });

    it('requireRole("owner") would have let the agent session through — which is why this gate exists', () => {
        // The reason requireOwnerPrincipal spells its test out instead of calling requireRole:
        // the owner ROLE says which account, never which principal. If someone ever replaces the
        // gate with requireRole('owner'), the assertion above about this token starts failing and
        // this one explains what changed.
        const agentWithOwnerRole = token({ sub: 'claude#alice@node', roles: ['agent', 'owner'] });
        const req = mockReq(agentWithOwnerRole);
        const res = mockRes();
        const next = vi.fn();
        requireRole('owner')(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('no auth at all is 401, not 403', () => {
        const r = run(undefined);
        expect(r.passed).toBe(false);
        expect(r.status).toBe(401);
        expect(r.body.error.code).toBe('AUTH_REQUIRED');
    });
});

describe('the companion scope, and only on the exact word', () => {
    it('an agent the owner granted account:security passes', () => {
        expect(run(token({ roles: ['agent'], scopes: ['memory:read', ACCOUNT_SECURITY_SCOPE] })).passed).toBe(true);
    });

    it('a GEAI granted the same word passes', () => {
        expect(run(token({ roles: ['ecosystem'], scopes: [ACCOUNT_SECURITY_SCOPE] })).passed).toBe(true);
    });

    it('the global wildcard does NOT carry it', () => {
        // "Full access" is one click, and nobody clicking it is deciding that an agent may set
        // their password. This is the assertion that keeps that true.
        expect(run(token({ roles: ['agent'], scopes: ['*'] })).passed).toBe(false);
    });

    it('the domain wildcard does not carry it either', () => {
        expect(run(token({ roles: ['agent'], scopes: ['account:*'] })).passed).toBe(false);
    });

    it('an app is refused even holding the word outright', () => {
        // An app grant is consent to use the account, never consent to take it over. The word is
        // absent from APP_GRANTABLE_SCOPES too, so this is the second of two locks.
        expect(run(token({ roles: ['app'], scopes: [ACCOUNT_SECURITY_SCOPE] })).passed).toBe(false);
    });

    it('the word is registered as one no wildcard carries', () => {
        // Without this, the narrow-only check on the agent-configure surface would read a '*'
        // agent as already holding it and let the agent write the word onto itself.
        expect(SCOPES_OUTSIDE_WILDCARD).toContain(ACCOUNT_SECURITY_SCOPE);
    });
});
