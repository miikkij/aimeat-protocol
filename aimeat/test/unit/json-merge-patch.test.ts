/**
 * @file test/unit/json-merge-patch.test.ts
 * @description RFC 7386 merge semantics, including the whole test suite from the RFC's Appendix A.
 *   Those cases are here verbatim because they are the ones an implementation gets subtly wrong:
 *   null deletes rather than stores, arrays replace rather than merge, and an object patched over a
 *   scalar discards the scalar. Getting any of them wrong loses a writer's data silently, which is
 *   exactly the failure this route exists to prevent.
 * @usage pnpm test -- json-merge-patch
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial, with PATCH /v1/memory/:key.
 */
import { describe, it, expect } from 'vitest';
import { applyMergePatch, mergePatchTouchesReservedRoot } from '../../src/utils/json-merge-patch.js';

describe('applyMergePatch — RFC 7386 Appendix A', () => {
    const cases: Array<[unknown, unknown, unknown]> = [
        [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
        [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
        [{ a: 'b' }, { a: null }, {}],
        [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
        [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
        [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
        [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
        [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
        [['a', 'b'], ['c', 'd'], ['c', 'd']],
        [{ a: 'b' }, ['c'], ['c']],
        [{ a: 'foo' }, null, null],
        [{ a: 'foo' }, 'bar', 'bar'],
        [{ e: null }, { a: 1 }, { e: null, a: 1 }],
        [[1, 2], { a: 'b', c: null }, { a: 'b' }],
        [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
    ];

    it.each(cases)('target %j + patch %j = %j', (target, patch, expected) => {
        expect(applyMergePatch(target, patch)).toEqual(expected);
    });
});

describe('applyMergePatch — the properties the route depends on', () => {
    it('never mutates the target, so a failed CAS can retry against the original', () => {
        const target = { status: { fetch: 'done' }, articles: { talous: { body: 'x' } } };
        const frozen = JSON.parse(JSON.stringify(target));
        applyMergePatch(target, { status: { writeA: 'running' } });
        expect(target).toEqual(frozen);
    });

    it('never mutates the patch', () => {
        const patch = { status: { writeA: 'running' } };
        const frozen = JSON.parse(JSON.stringify(patch));
        applyMergePatch({ status: { fetch: 'done' } }, patch);
        expect(patch).toEqual(frozen);
    });

    it('lets two writers own disjoint subtrees without touching each other', () => {
        // The Sanomat case: Desk A and Desk B each patch their own categories of one edition.
        const edition = { status: { fetch: 'done' }, articles: { talous: { body: 'A' } } };
        const afterA = applyMergePatch(edition, {
            status: { writeA: 'done' }, articles: { tiede: { body: 'B' } },
        });
        const afterBoth = applyMergePatch(afterA, {
            status: { writeB: 'done' }, articles: { urheilu: { body: 'C' } },
        });
        expect(afterBoth).toEqual({
            status: { fetch: 'done', writeA: 'done', writeB: 'done' },
            articles: { talous: { body: 'A' }, tiede: { body: 'B' }, urheilu: { body: 'C' } },
        });
    });

    it('replaces an array wholesale rather than merging element-wise', () => {
        // Element-wise merging would make two concurrent appends silently reorder each other.
        expect(applyMergePatch({ items: [1, 2, 3] }, { items: [9] })).toEqual({ items: [9] });
    });

    it('deletes a deeply nested key without disturbing its siblings', () => {
        const target = { a: { b: 1, c: 2 }, d: 3 };
        expect(applyMergePatch(target, { a: { b: null } })).toEqual({ a: { c: 2 }, d: 3 });
    });

    it('is idempotent for a patch that only sets values', () => {
        const patch = { status: { writeA: 'done' } };
        const once = applyMergePatch({ status: {} }, patch);
        expect(applyMergePatch(once, patch)).toEqual(once);
    });
});

describe('mergePatchTouchesReservedRoot', () => {
    const RESERVED = ['openrouter', 'ai-usage', 'profile'] as const;

    it('names the reserved root a patch reaches into', () => {
        expect(mergePatchTouchesReservedRoot({ openrouter: { url: 'x' } }, RESERVED)).toBe('openrouter');
    });

    it('passes a patch that touches nothing reserved', () => {
        expect(mergePatchTouchesReservedRoot({ articles: { talous: {} } }, RESERVED)).toBeNull();
    });

    it('ignores a reserved name nested below the top level', () => {
        // The guard is about the record's own top-level fields; a field called "profile" inside
        // someone's own data is not the owner's reserved profile namespace.
        expect(mergePatchTouchesReservedRoot({ articles: { profile: {} } }, RESERVED)).toBeNull();
    });

    it('says nothing about a non-object patch', () => {
        expect(mergePatchTouchesReservedRoot('bar', RESERVED)).toBeNull();
    });
});
