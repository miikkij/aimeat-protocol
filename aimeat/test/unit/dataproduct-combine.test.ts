/**
 * @file test/unit/dataproduct-combine.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of a data product build (services/dataproduct/combine.ts and
 *   definition.ts): the three combine modes with their refusals, the column mapping, the personal
 *   rule, the filter, the audience narrowing, the data map family match and the publishable finding.
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9).
 */
import { describe, it, expect } from 'vitest';
import { combineSources, applyFilter, coerceTo } from '../../src/services/dataproduct/combine.js';
import { normaliseDefinition, DataProductError, type DataProductDefinition } from '../../src/services/dataproduct/definition.js';
import { audienceFits, narrowest, tableOf } from '../../src/services/dataproduct/source-common.js';
import { familyMatches } from '../../src/services/dataproduct/sources-memory.js';
import { typedFromStrings } from '../../src/services/dataproduct/sources-io.js';
import { checkMap } from '../../src/services/data-map/data-map-check.js';
import { DATA_MAP_SPEC, type DataMap, type DataMapRow } from '../../src/services/data-map/data-map-types.js';

function def(body: Record<string, unknown>): DataProductDefinition {
    const n = normaliseDefinition('kunnat', body);
    if (!n.ok) throw new Error(n.message);
    return { ...n.definition, definedBy: 'a@n', createdAt: 'x', updatedAt: 'x' };
}
const A = tableOf('A', [{ kunta: 'Espoo', budjetti: 10 }, { kunta: 'Vantaa', budjetti: 7 }, { kunta: 'Oulu', budjetti: 3 }]);
const B = tableOf('B', [{ kunta: 'Espoo', asukkaat: 300 }, { kunta: 'Vantaa', asukkaat: 240 }]);

describe('definition', () => {
    it('defaults to private, tables with one source, and ids A, B', () => {
        const n = normaliseDefinition('x1', { sources: [{ kind: 'memory', key: 'k' }] });
        expect(n.ok && n.definition.visibility).toBe('private');
        expect(n.ok && n.definition.combine.mode).toBe('tables');
        expect(n.ok && n.definition.sources[0]!.id).toBe('A');
    });
    it('refuses a source without its fields, several sources without a mode, and a join key of a stranger', () => {
        expect(normaliseDefinition('x1', { sources: [{ kind: 'records', organism_id: 'o' }] }).ok).toBe(false);
        expect(normaliseDefinition('x1', { sources: [{ kind: 'memory', key: 'a' }, { kind: 'memory', key: 'b' }] }).ok).toBe(false);
        expect(normaliseDefinition('x1', { sources: [{ kind: 'memory', key: 'a' }, { kind: 'memory', key: 'b' }], combine: { mode: 'join', key: { left: 'A.k', right: 'C.k' } } }).ok).toBe(false);
        expect(normaliseDefinition('Bad Name', { sources: [{ kind: 'memory', key: 'a' }] }).ok).toBe(false);
    });
});

describe('combine', () => {
    it('tables: one resource per source, named by id', () => {
        const out = combineSources(def({ sources: [{ kind: 'memory', key: 'a' }, { kind: 'memory', key: 'b' }], combine: { mode: 'tables' } }), [A, B]);
        expect(out.resources.map(r => r.name)).toEqual(['source-a', 'source-b']);
        expect(out.resources[0]!.rows).toHaveLength(3);
    });
    it('union: appends rows, and refuses a column mismatch naming it', () => {
        const C = tableOf('B', [{ kunta: 'Turku', budjetti: 5 }]);
        const ok = combineSources(def({ sources: [{ kind: 'memory', key: 'a' }, { kind: 'memory', key: 'b' }], combine: { mode: 'union' } }), [A, C]);
        expect(ok.resources[0]!.rows).toHaveLength(4);
        expect(() => combineSources(def({ sources: [{ kind: 'memory', key: 'a' }, { kind: 'memory', key: 'b' }], combine: { mode: 'union' } }), [A, B]))
            .toThrowError(expect.objectContaining({ code: 'UNION_COLUMNS_MISMATCH' }) as unknown as Error);
    });
    it('join: keeps unmatched left rows with nulls, and refuses a duplicate right key', () => {
        const d = def({ sources: [{ kind: 'memory', key: 'a' }, { kind: 'memory', key: 'b' }], combine: { mode: 'join', key: { left: 'A.kunta', right: 'B.kunta' } } });
        const out = combineSources(d, [A, B]);
        expect(out.resources[0]!.rows).toEqual([
            { kunta: 'Espoo', budjetti: 10, asukkaat: 300 }, { kunta: 'Vantaa', budjetti: 7, asukkaat: 240 }, { kunta: 'Oulu', budjetti: 3, asukkaat: null },
        ]);
        const dup = tableOf('B', [{ kunta: 'Espoo', asukkaat: 1 }, { kunta: 'Espoo', asukkaat: 2 }]);
        let err: unknown;
        try { combineSources(d, [A, dup]); } catch (e) { err = e; }
        expect(err instanceof DataProductError && err.code).toBe('JOIN_DUPLICATE_KEY');
    });
    it('maps, types and renames columns, records it, and filters', () => {
        const d = def({ sources: [{ kind: 'memory', key: 'a' }], columns: [{ source: 'A', from: 'kunta', name: 'municipality' }, { source: 'A', from: 'budjetti', type: 'integer' }],
            filter: { column: 'budjetti', op: 'gte', value: 5 } });
        const out = combineSources(d, [A]);
        expect(out.resources[0]!.rows).toEqual([{ municipality: 'Espoo', budjetti: 10 }, { municipality: 'Vantaa', budjetti: 7 }]);
        expect(out.transformations.map(t => t.what)).toEqual(['renamed A.kunta to municipality', 'kept the rows where budjetti gte 5']);
        expect(out.resources[0]!.schema).toEqual({ fields: [{ name: 'municipality', type: 'string' }, { name: 'budjetti', type: 'integer' }] });
    });
    it('leaves a personal column out unless it is included, and reports the inclusion', () => {
        const P = tableOf('A', [{ name: 'x', email: 'x@y' }], {}, new Set(['email']));
        const dropped = combineSources(def({ sources: [{ kind: 'memory', key: 'a' }] }), [P]);
        expect(Object.keys(dropped.resources[0]!.rows[0]!)).toEqual(['name']);
        expect(dropped.personalIncluded).toEqual([]);
        const kept = combineSources(def({ sources: [{ kind: 'memory', key: 'a' }], columns: [{ source: 'A', from: 'name' }, { source: 'A', from: 'email', include: true }] }), [P]);
        expect(kept.personalIncluded).toEqual(['A.email']);
    });
});

describe('helpers', () => {
    it('filter ops and coercion', () => {
        expect(applyFilter('Espoo', { column: 'k', op: 'in', value: ['Espoo', 'Oulu'] })).toBe(true);
        expect(applyFilter('Helsinki', { column: 'k', op: 'contains', value: 'sink' })).toBe(true);
        expect(applyFilter(null, { column: 'k', op: 'eq', value: 'x' })).toBe(false);
        expect(coerceTo('12', 'integer')).toBe(12);
        expect(coerceTo('1,5', 'number')).toBe(1.5);
    });
    it('audience: the narrowest source decides', () => {
        expect(narrowest(['public', 'organism:o1'])).toBe('organism:o1');
        expect(narrowest(['organism:o1', 'organism:o2'])).toBe('private');
        expect(audienceFits('public', 'organism:o1')).toBe(false);
        expect(audienceFits('organism:o1', 'organism:o1')).toBe(true);
        expect(audienceFits('members', 'organism:o1')).toBe(false);
        expect(audienceFits('private', 'private')).toBe(true);
    });
    it('data map families', () => {
        expect(familyMatches('news.<date>.*', 'news.2026-11-01.top')).toBe(true);
        expect(familyMatches('items', 'items.42')).toBe(true);
        expect(familyMatches('items', 'itemsx')).toBe(false);
        expect(familyMatches('crm.{id}', 'crm.7')).toBe(true);
    });
    it('typed CSV strings', () => {
        const t = typedFromStrings([{ a: '1', b: '2.5', c: 'x' }], ['a', 'b', 'c']);
        expect(t.types).toEqual({ a: 'integer', b: 'number', c: 'string' });
    });
    it('a publishable that is not a boolean is a finding', () => {
        const row = { what: 'notes.*', holds: 'n', kind: 'user-written', usedFor: 'user-returns-to-read', where: 'owner-memory-private', owner: 'person',
            readers: 'owner-only', writers: ['the-app-for-the-person'], shape: 'one-record', keptFor: 'until-deleted', lossRisk: 'only-copy', personalData: 'no', why: 'w', publishable: 'yes' } as unknown as DataMapRow;
        const map: DataMap = { spec: DATA_MAP_SPEC, what: 'a', usedFor: 'b', form: 'one-person', arrangement: 'c', machinery: [], leaves: [], held: [row], elsewhere: [], source: 'declared', at: 'x' };
        expect(checkMap(map, 'x').findings.map(f => f.code)).toContain('DATAMAP_ROW_BAD_PUBLISHABLE');
        expect(checkMap({ ...map, held: [{ ...row, publishable: true }] }, 'x').findings.map(f => f.code)).not.toContain('DATAMAP_ROW_BAD_PUBLISHABLE');
    });
});
