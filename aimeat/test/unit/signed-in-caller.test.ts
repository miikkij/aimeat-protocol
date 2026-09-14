/**
 * @file test/unit/signed-in-caller.test.ts
 * @description Who counts as a signed-in caller, on a node that hands passers-by a credential.
 *
 *   ANONYMOUS MODE IS WHY THIS IS NOT `!req.auth`. When it is on, the middleware injects a shared
 *   anonymous identity for every caller who brought none, so `req.auth` is set for a stranger and
 *   the absence test never matches. Two doors read a setting called `authenticated` that way —
 *   GET /v1/stats and GET /v1/metrics — so an operator who narrowed either of them to signed-in
 *   callers still served them to anybody who asked, and nothing in the route said so.
 *
 *   It is a predicate rather than an E2E because the branch only exists under a configuration no
 *   test server runs: both settings default elsewhere (`public` and `operator`), and proving it
 *   end to end would mean a node of its own for one boolean. What the branch decides is this
 *   function, so this is where it is asserted.
 * @usage pnpm test -- signed-in-caller
 * @version-history
 *   v1.0.0 — 2026-09-14 — Initial, with the fix. Found by the AI triage of 2026-09-13.
 */
import { describe, it, expect } from 'vitest';
import { isSignedInCaller } from '../../src/auth/account-security.js';

// The shape the middleware puts on req.auth; only the two fields this predicate reads matter.
const auth = (over: Record<string, unknown> = {}) =>
    ({ sub: 'alice@node', owner: 'alice', roles: ['owner'], scopes: [], ...over }) as never;

describe('isSignedInCaller', () => {
    it('refuses a caller with no credential at all', () => {
        expect(isSignedInCaller(undefined)).toBe(false);
    });

    it('refuses the shared anonymous identity, which IS a req.auth', () => {
        const anon = auth({ sub: 'anonymous@node', owner: 'anonymous', roles: ['agent'], anonymous: true });
        // The bug this closes, stated as the thing that used to be true:
        expect(!anon).toBe(false);
        expect(isSignedInCaller(anon)).toBe(false);
    });

    it('admits a person signed in', () => {
        expect(isSignedInCaller(auth())).toBe(true);
    });

    it('admits an agent, which is somebody acting for a person', () => {
        expect(isSignedInCaller(auth({ sub: 'bot#alice@node', roles: ['agent'] }))).toBe(true);
    });

    it('admits a session that says it is not anonymous, rather than omitting the field', () => {
        expect(isSignedInCaller(auth({ anonymous: false }))).toBe(true);
    });
});
