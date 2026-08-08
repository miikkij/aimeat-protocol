/**
 * @file test/unit/scope-coverage.test.ts
 * @description The rule that `memory:write-reserved` is carried by no wildcard, asserted once for
 *   every surface that grants or approves scopes — and asserted to match the checkbox editor.
 *
 *   The scope exists so that handing an agent the keys the server itself trusts costs a deliberate,
 *   separate tick. That guarantee is only as strong as the least careful gate: two surfaces
 *   hand-rolled their own `*` test and both became a way for an agent to obtain the scope with no
 *   owner involved — `aimeat_operator_agent_configure` skipped its narrow-only check whenever the
 *   TARGET held `*`, and the device-auth auto-approve skipped its escalation filter whenever the
 *   APPROVER did. Neither was an escalation before this scope existed. Both were the moment it did.
 *
 *   So the rule lives in one function, and the client's copy of the list is compared against the
 *   server's here. A checkbox that claims to grant something the server never checks for, or a
 *   server check for something the UI cannot offer, is the same bug in two directions.
 * @usage pnpm test -- scope-coverage
 * @version-history
 *   v1.0.0 — 2026-08-08 — Initial, with the fix to both surfaces.
 */
import { describe, it, expect } from 'vitest';
import {
    SCOPES_OUTSIDE_WILDCARD, WRITE_RESERVED_SCOPE, WRITE_AS_OWNER_SCOPE,
    isOutsideWildcard, scopeIsCovered, uncoveredScopes,
} from '../../src/utils/scope-coverage.js';
import { NOT_IN_WILDCARD } from '../../public/views/profile/agents/scope-model.js';
import { hasWriteReserved, hasWriteAsOwner } from '../../src/routes/memory/owner-target.js';

describe('the wildcard rule', () => {
    it('a global wildcard covers an ordinary scope', () => {
        expect(scopeIsCovered(['*'], 'memory:read')).toBe(true);
        expect(scopeIsCovered(['*'], WRITE_AS_OWNER_SCOPE)).toBe(true);
    });

    it('a domain wildcard covers its own domain and nothing else', () => {
        expect(scopeIsCovered(['memory:*'], 'memory:write')).toBe(true);
        expect(scopeIsCovered(['memory:*'], 'storage:write')).toBe(false);
    });

    it('NO wildcard covers the reserved grant — only the exact string', () => {
        expect(scopeIsCovered(['*'], WRITE_RESERVED_SCOPE)).toBe(false);
        expect(scopeIsCovered(['memory:*'], WRITE_RESERVED_SCOPE)).toBe(false);
        expect(scopeIsCovered(['*', 'memory:*'], WRITE_RESERVED_SCOPE)).toBe(false);
        expect(scopeIsCovered([WRITE_RESERVED_SCOPE], WRITE_RESERVED_SCOPE)).toBe(true);
    });

    it('an empty grant covers nothing', () => {
        expect(scopeIsCovered([], 'memory:read')).toBe(false);
        expect(isOutsideWildcard(WRITE_RESERVED_SCOPE)).toBe(true);
        expect(isOutsideWildcard(WRITE_AS_OWNER_SCOPE)).toBe(false);
    });
});

describe('uncoveredScopes — what a narrow-only surface must refuse', () => {
    // The exact shape of the operator-config guard and the device-auth escalation filter.
    it('a wildcard principal is NOT waved through for the reserved grant', () => {
        expect(uncoveredScopes(['*'], ['*', WRITE_RESERVED_SCOPE])).toEqual([WRITE_RESERVED_SCOPE]);
    });

    it('a memory:* principal is not waved through either', () => {
        expect(uncoveredScopes(['memory:*'], [WRITE_RESERVED_SCOPE])).toEqual([WRITE_RESERVED_SCOPE]);
    });

    it('an ordinary widening is still refused', () => {
        expect(uncoveredScopes(['memory:read'], ['memory:read', 'storage:write'])).toEqual(['storage:write']);
    });

    it('narrowing and no-ops pass', () => {
        expect(uncoveredScopes(['*'], ['memory:read'])).toEqual([]);
        expect(uncoveredScopes(['*'], ['*'])).toEqual([]);
        expect(uncoveredScopes(['memory:*'], ['memory:read', 'memory:write'])).toEqual([]);
        expect(uncoveredScopes(['*', WRITE_RESERVED_SCOPE], ['*', WRITE_RESERVED_SCOPE])).toEqual([]);
    });
});

describe('the gate and the coverage rule agree', () => {
    it('hasWriteReserved is exact-string only, matching scopeIsCovered', () => {
        for (const held of [['*'], ['memory:*'], ['*', 'memory:*'], []]) {
            expect(hasWriteReserved(held)).toBe(scopeIsCovered(held, WRITE_RESERVED_SCOPE));
            expect(hasWriteReserved(held)).toBe(false);
        }
        expect(hasWriteReserved(['*', WRITE_RESERVED_SCOPE])).toBe(true);
    });

    it('hasWriteAsOwner DOES honour the wildcards, matching scopeIsCovered', () => {
        for (const held of [['*'], ['memory:*'], [WRITE_AS_OWNER_SCOPE], ['memory:read']]) {
            expect(hasWriteAsOwner(held)).toBe(scopeIsCovered(held, WRITE_AS_OWNER_SCOPE));
        }
    });
});

describe('the checkbox editor and the server hold the same list', () => {
    // Two copies of one decision. If they drift, the UI either offers a scope nothing enforces or
    // hides one the server does — and the drift is invisible in both codebases on its own.
    it('NOT_IN_WILDCARD (client) === SCOPES_OUTSIDE_WILDCARD (server)', () => {
        expect([...NOT_IN_WILDCARD].sort()).toEqual([...SCOPES_OUTSIDE_WILDCARD].sort());
    });

    it('the list is not empty — an empty one silently disables the whole guarantee', () => {
        expect(SCOPES_OUTSIDE_WILDCARD.length).toBeGreaterThan(0);
    });
});
