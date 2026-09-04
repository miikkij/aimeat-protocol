/**
 * @file test/unit/ai-gate.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who the AI-spend gate admits, and that it agrees with requireScope('ai:use').
 *
 *   WHY THE SECOND HALF MATTERS MORE THAN THE FIRST. `assertAiUseAllowed` guards the doors that
 *   spend an owner's AI money (POST /v1/ai/complete, /v1/ai/image, the chat proxy), and
 *   `requireScope('ai:use')` guards the AI-job routes, which spend the same money. Two answers to
 *   one question is the shape the August 2026 audit kept finding, and it had already happened here:
 *   the gate restated the scope test by hand as `includes('ai:use') || includes('*')`, which misses
 *   the domain wildcard that every other door on this node honours. An owner who granted an agent
 *   `ai:*` — the whole AI area — got an agent that could start an AI job and could not generate an
 *   image, with a refusal telling them to grant the AI permission they had just granted.
 *
 *   So the equivalence is asserted directly, over the same set of principals, rather than left to
 *   two files agreeing by inspection.
 * @usage pnpm test -- ai-gate
 * @version-history
 *   v1.0.0 — 2026-08-31 — Written for the ai-gate/requireScope divergence found auditing AI jobs.
 */
import { describe, it, expect } from 'vitest';
import { assertAiUseAllowed } from '../../src/auth/ai-gate.js';
import { requireScope } from '../../src/auth/middleware.js';
import type { VerifiedToken } from '../../src/auth/jwt.js';
import type { Request, Response, NextFunction } from 'express';

function mockReq(auth?: Partial<VerifiedToken>): Request {
    return {
        headers: {}, method: 'POST', path: '/v1/ai/complete',
        auth: auth
            ? { sub: 'a#alice@node', owner: 'alice', node: 'node', exp: 0, roles: [], scopes: [], ...auth }
            : undefined,
    } as unknown as Request;
}

function mockRes(): Response & { _status: number | null } {
    const r = {
        _status: null as number | null,
        status(code: number) { r._status = code; return r; },
        json() { return r; },
        // A scope refusal carries a `WWW-Authenticate` challenge since 2026-09-04, so the double
        // needs a header sink or every test here throws `res.setHeader is not a function`. This
        // file only asks whether the gate ADMITS a principal, so the value is discarded — but a
        // double that cannot receive what production sends is not standing in for it.
        setHeader() { return r; },
    };
    return r as unknown as Response & { _status: number | null };
}

/** Does requireScope('ai:use') let this principal through? */
function scopeGateAdmits(auth?: Partial<VerifiedToken>): boolean {
    let passed = false;
    const next: NextFunction = () => { passed = true; };
    requireScope('ai:use')(mockReq(auth), mockRes(), next);
    return passed;
}

/** Does the AI gate let this principal through? */
const aiGateAdmits = (auth?: Partial<VerifiedToken>): boolean =>
    assertAiUseAllowed(mockReq(auth), mockRes(), 'node');

/**
 * Every principal shape that reaches an AI door. `admitted` is what BOTH gates must answer.
 */
const CASES: Array<{ name: string; auth?: Partial<VerifiedToken>; admitted: boolean }> = [
    { name: 'an owner session', auth: { roles: ['owner'], scopes: [] }, admitted: true },
    // A mirrored agent token carried the owner's roles until audit H-2. Roles alone must not admit.
    { name: 'an agent whose token also carries the owner role', auth: { roles: ['owner', 'agent'], scopes: [] }, admitted: false },
    { name: 'an ecosystem app carrying the owner role', auth: { roles: ['owner', 'ecosystem'], scopes: [] }, admitted: false },
    { name: 'an agent holding the exact word', auth: { roles: ['agent'], scopes: ['ai:use'] }, admitted: true },
    { name: 'an agent holding the AI domain', auth: { roles: ['agent'], scopes: ['ai:*'] }, admitted: true },
    { name: 'an agent holding full access', auth: { roles: ['agent'], scopes: ['*'] }, admitted: true },
    { name: 'an agent holding a neighbouring word only', auth: { roles: ['agent'], scopes: ['memory:write'] }, admitted: false },
    { name: 'an agent holding a neighbouring domain only', auth: { roles: ['agent'], scopes: ['memory:*'] }, admitted: false },
    { name: 'an agent with no scopes', auth: { roles: ['agent'], scopes: [] }, admitted: false },
];

describe('the AI-spend gate', () => {
    for (const c of CASES) {
        it(`admits ${c.name}: ${c.admitted}`, () => {
            expect(aiGateAdmits(c.auth)).toBe(c.admitted);
        });
    }

    it('refuses an unauthenticated caller', () => {
        expect(aiGateAdmits(undefined)).toBe(false);
    });

    it('answers 403, not 401, for a principal that is present but unscoped', () => {
        const res = mockRes();
        assertAiUseAllowed(mockReq({ roles: ['agent'], scopes: [] }), res, 'node');
        expect(res._status).toBe(403);
    });
});

describe('it agrees with requireScope(ai:use) on every principal shape', () => {
    // The two doors spend the same money. A disagreement here means one of them is admitting or
    // refusing somebody the other does not, which is exactly what happened with `ai:*`.
    for (const c of CASES) {
        it(`${c.name}`, () => {
            expect(aiGateAdmits(c.auth)).toBe(scopeGateAdmits(c.auth));
        });
    }
});
