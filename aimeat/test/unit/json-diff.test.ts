/**
 * @file test/unit/json-diff.test.ts
 * @description diffJson: the change list aimeat_memory_history shows for each kept version.
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { diffJson } from '../../src/services/memory-versions/diff.js';

describe('diffJson', () => {
    it('says nothing for equal values, whatever the key order', () => {
        expect(diffJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }).changes).toEqual([]);
    });

    it('names added, removed and changed fields by path', () => {
        const d = diffJson({ core: 'old', lifecycle: { shapedAt: 'x' }, gone: 1 }, { core: 'new', lifecycle: { shapedAt: 'y' }, added: true });
        expect(d.changes).toEqual([
            { path: 'core', op: 'changed', before: 'old', after: 'new' },
            { path: 'lifecycle.shapedAt', op: 'changed', before: 'x', after: 'y' },
            { path: 'gone', op: 'removed', before: 1 },
            { path: 'added', op: 'added', after: true },
        ]);
    });

    it('matches records in an array by identity, so an insert at the top is one addition', () => {
        const before = { references: [{ ref: 'memory:a', what: 'A' }, { ref: 'memory:b', what: 'B' }] };
        const after = { references: [{ ref: 'memory:new', what: 'N' }, { ref: 'memory:a', what: 'A' }, { ref: 'memory:b', what: 'B2' }] };
        expect(diffJson(before, after).changes).toEqual([
            { path: 'references[ref=memory:b].what', op: 'changed', before: 'B', after: 'B2' },
            { path: 'references[ref=memory:new]', op: 'added', after: { ref: 'memory:new', what: 'N' } },
        ]);
    });

    it('matches ontology concepts by @id', () => {
        const c = (id: string, label: string) => ({ '@id': id, 'skos:prefLabel': label });
        const d = diffJson({ concepts: [c('x/1', 'one'), c('x/2', 'two')] }, { concepts: [c('x/2', 'TWO')] });
        expect(d.changes.map(ch => `${ch.op} ${ch.path}`)).toEqual([
            'removed concepts[@id=x/1]',
            'changed concepts[@id=x/2].skos:prefLabel',
        ]);
    });

    it('falls back to positions when elements carry no unique identity', () => {
        expect(diffJson([1, 2], [1, 3, 4]).changes).toEqual([
            { path: '[1]', op: 'changed', before: 2, after: 3 },
            { path: '[2]', op: 'added', after: 4 },
        ]);
        const dup = diffJson([{ id: 'a' }, { id: 'a', x: 1 }], [{ id: 'a' }, { id: 'a', x: 2 }]);
        expect(dup.changes).toEqual([{ path: '[1].x', op: 'changed', before: 1, after: 2 }]);
    });

    it('cuts long values short and stops at maxChanges', () => {
        const d = diffJson({ s: 'x'.repeat(500) }, { s: 'y'.repeat(500) }, { maxValueChars: 10 });
        expect(d.changes[0]!.before).toBe('xxxxxxxxxx…');
        const many = diffJson(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])), {}, { maxChanges: 5 });
        expect(many.changes).toHaveLength(5);
        expect(many.truncated).toBe(true);
    });

    it('names a change of the whole value', () => {
        expect(diffJson('a', 'b').changes).toEqual([{ path: '(whole value)', op: 'changed', before: 'a', after: 'b' }]);
    });
});
