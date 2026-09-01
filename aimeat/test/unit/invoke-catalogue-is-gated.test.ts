/**
 * @file invoke-catalogue-is-gated.test.ts
 * @description `/v1/invoke` is `requireAuth()` and no scope, on purpose: it dispatches over loopback
 *   to the target capability's own route and that route's gate is the one that decides. The model is
 *   right, and it makes the CATALOGUE a security surface — one door, one name, and everything
 *   invokable behind it.
 *
 *   SO THE PROPERTY WORTH PINNING IS ABOUT THE CATALOGUE, not about one call. Every mutating
 *   capability `invoke` can name either carries a scope word or is a named exemption with a written
 *   reason. A capability in neither would be a mutation reachable by any authenticated principal
 *   through a door whose whole defence is "the route decides" — and nobody would have decided.
 *
 *   `check:mcp-tools` already refuses `mutatingWithoutScope`, so this test is the same line drawn a
 *   second time, from the other side: that gate reads the tool tables, this reads what `invoke`
 *   actually offers. They agree today, and if the two ever diverge — a capability dispatchable but
 *   absent from the tables, or the reverse — this is the one that says so.
 *
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, post-audit item 2).
 */
import { describe, it, expect } from 'vitest';
import { listNodeCapabilities, NON_INVOKABLE } from '../../src/services/node-capabilities.js';
import { TOOL_SCOPES, SCOPE_EXEMPT_TOOLS } from '../../src/mcp/catalog/scopes.js';
import { TOOL_ANNOTATIONS } from '../../src/mcp/annotations.js';

/** A capability that changes something. The annotation is the node's own answer to that question. */
function isMutating(id: string): boolean {
    return TOOL_ANNOTATIONS[id]?.readOnlyHint !== true;
}

describe('the invoke catalogue is a gated surface', () => {
    it('every mutating capability invoke can name is scoped or is a named exemption', () => {
        const unaccounted = listNodeCapabilities()
            .map(c => c.id)
            .filter(isMutating)
            .filter(id => !(TOOL_SCOPES as Record<string, string>)[id] && !SCOPE_EXEMPT_TOOLS.has(id));

        // Named rather than counted: a failure here has to say WHICH capability nobody decided about.
        expect(unaccounted).toEqual([]);
    });

    it('every capability it names has an annotation, so "is this a mutation" is never a guess', () => {
        const unannotated = listNodeCapabilities().map(c => c.id).filter(id => !TOOL_ANNOTATIONS[id]);
        // Without this, the test above would quietly stop testing anything: an unannotated tool reads
        // as mutating, so it would be caught — but an annotation added later as readOnly by mistake
        // would remove a real capability from the check with nothing to notice it.
        expect(unannotated).toEqual([]);
    });

    it('invoke cannot name itself', () => {
        // A door that can be pointed at itself is a loop with a caller's credential in it.
        const ids = new Set(listNodeCapabilities().map(c => c.id));
        for (const forbidden of NON_INVOKABLE) expect(ids.has(forbidden)).toBe(false);
    });

    it('the exemptions it relies on are a bounded, written set rather than a default', () => {
        const mutating = listNodeCapabilities().map(c => c.id).filter(isMutating);
        const exempt = mutating.filter(id => !(TOOL_SCOPES as Record<string, string>)[id] && SCOPE_EXEMPT_TOOLS.has(id));
        // This number is the honest shape of the surface: `invoke` reaches these with no scope word,
        // exactly as a direct call does, and each one has a reason recorded beside it. It is written
        // down here so that growing it is a visible act rather than a silent one.
        expect(exempt.length).toBeLessThanOrEqual(25);
        expect(mutating.length).toBeGreaterThan(100);
    });
});
