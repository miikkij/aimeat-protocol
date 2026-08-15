/**
 * @file test/unit/datapackage-core.test.ts
 * @description The pure half of the data-package contract: inference, the quality gate, canonical
 *   CSV, and the content hash that IS the version.
 *
 *   THE HASH TESTS ARE THE LOAD-BEARING ONES. A package's identity is a content hash, so anything
 *   that makes the same table hash differently splits one package into two, and anything that makes
 *   two different tables hash the same lets a version be replaced in place. Both are silent. The
 *   assertions below pin the two properties that matter: the hash does NOT move with the wall clock
 *   or with object key order, and it DOES move when a single cell changes.
 * @usage cd aimeat && pnpm exec vitest run test/unit/datapackage-core.test.ts
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1).
 */
import { describe, it, expect } from 'vitest';
import { inferSchema, validateRows, toCsv, fromCsv } from '../../src/services/datapackage/table.js';
import { contentHashOf, bytesHash, type TableSchema } from '../../src/services/datapackage/contract.js';

const ROWS = [
    { date: '2026-08-15', hits: 42, ratio: 1.5, live: true, note: 'ok' },
    { date: '2026-08-14', hits: 37, ratio: 0.5, live: false, note: 'also, "quoted"' },
];

describe('inferSchema — a proposal, and a narrow one', () => {
    it('names the narrowest type that fits every value', () => {
        const s = inferSchema(ROWS);
        expect(s.fields.map(f => [f.name, f.type])).toEqual([
            ['date', 'date'], ['hits', 'integer'], ['ratio', 'number'], ['live', 'boolean'], ['note', 'string'],
        ]);
    });

    it('keeps the producer\'s column order rather than alphabetising it', () => {
        expect(inferSchema(ROWS).fields.map(f => f.name)).toEqual(['date', 'hits', 'ratio', 'live', 'note']);
    });

    it('widens integer to number when one value has a fraction', () => {
        expect(inferSchema([{ n: 1 }, { n: 2.5 }]).fields[0].type).toBe('number');
    });

    it('a zero-padded string is an IDENTIFIER, not an integer', () => {
        // Measured, not reasoned about: the slice-1 acceptance run published the Nordic article
        // number '001000', inference called it integer, and pandas read the published CSV back as
        // 1000 with the padding gone — while DuckDB kept the same bytes as VARCHAR. Two readers
        // disagreeing about the table's key is worse than either answer.
        expect(inferSchema([{ vnr: '001000' }, { vnr: '001001' }]).fields[0].type).toBe('string');
        expect(inferSchema([{ zip: '00100' }]).fields[0].type).toBe('string');
        // …and a genuine number is still a number.
        expect(inferSchema([{ n: '0' }, { n: '12' }]).fields[0].type).toBe('integer');
        expect(inferSchema([{ n: '0.5' }]).fields[0].type).toBe('number');
        // A producer that hands over a real JS number means one thousand, padding being impossible.
        expect(inferSchema([{ n: 1000 }]).fields[0].type).toBe('integer');
    });

    it('a column that was never filled says so instead of pretending to know', () => {
        const f = inferSchema([{ a: 1, b: null }, { a: 2, b: '' }]).fields.find(x => x.name === 'b')!;
        expect(f.type).toBe('string');
        expect(f.description).toMatch(/no value/i);
    });

    it('sees a field that appears only in a later row', () => {
        expect(inferSchema([{ a: 1 }, { a: 2, b: 'x' }]).fields.map(f => f.name)).toEqual(['a', 'b']);
    });
});

describe('validateRows — coordinates, not a boolean', () => {
    const schema: TableSchema = {
        fields: [{ name: 'date', type: 'date' }, { name: 'hits', type: 'integer' }],
        primaryKey: ['date'],
    };

    it('passes clean data', () => {
        expect(validateRows('rows', [{ date: '2026-08-15', hits: 1 }], schema)).toEqual([]);
    });

    it('names the row, the column and what it wanted', () => {
        const [issue] = validateRows('rows', [{ date: 'n/a', hits: 1 }], schema);
        expect(issue).toMatchObject({ resource: 'rows', row: 1, field: 'date', code: 'type' });
        expect(issue.message).toMatch(/expected date/);
        expect(issue.got).toBe('"n/a"');
    });

    it('counts rows from 1, so the number matches what a spreadsheet shows', () => {
        const issues = validateRows('rows', [{ date: '2026-08-15', hits: 1 }, { date: '2026-08-14', hits: 'x' }], schema);
        expect(issues[0].row).toBe(2);
    });

    it('an empty optional field is absent, not wrong', () => {
        expect(validateRows('rows', [{ date: '2026-08-15', hits: null }], schema)).toEqual([]);
    });

    it('an empty PRIMARY KEY field is wrong', () => {
        const [issue] = validateRows('rows', [{ date: '', hits: 1 }], schema);
        expect(issue.code).toBe('required');
    });

    it('catches a duplicate primary key', () => {
        const issues = validateRows('rows', [{ date: '2026-08-15', hits: 1 }, { date: '2026-08-15', hits: 2 }], schema);
        expect(issues.some(i => i.code === 'duplicate-key')).toBe(true);
    });

    it('reports a column the schema does not declare', () => {
        const [issue] = validateRows('rows', [{ date: '2026-08-15', hits: 1, extra: 'x' }], schema);
        expect(issue).toMatchObject({ code: 'unknown-field', field: 'extra' });
    });

    it('reports every problem, not the first', () => {
        expect(validateRows('rows', [{ date: 'x', hits: 'y' }], schema).length).toBe(2);
    });

    it('caps the list so a wholly-wrong table cannot answer with a million entries', () => {
        const rows = Array.from({ length: 500 }, () => ({ date: 'x', hits: 1 }));
        expect(validateRows('rows', rows, schema, 10).length).toBe(10);
    });
});

describe('toCsv — canonical, because the bytes are the version', () => {
    const schema = inferSchema(ROWS);

    it('writes a header, LF endings and a trailing newline', () => {
        const text = toCsv(ROWS, schema).toString('utf8');
        expect(text.startsWith('date,hits,ratio,live,note\n')).toBe(true);
        expect(text.endsWith('\n')).toBe(true);
        expect(text.includes('\r')).toBe(false);
    });

    it('quotes only what RFC 4180 requires, and doubles an embedded quote', () => {
        expect(toCsv(ROWS, schema).toString('utf8')).toContain('"also, ""quoted"""');
    });

    it('column ORDER follows the schema, not the row\'s key order', () => {
        const shuffled = [{ note: 'ok', live: true, ratio: 1.5, hits: 42, date: '2026-08-15' }];
        const a = toCsv([ROWS[0]], schema);
        const b = toCsv(shuffled, schema);
        expect(b.equals(a)).toBe(true);
    });

    it('a missing key becomes an empty field rather than a ragged line', () => {
        const text = toCsv([{ date: '2026-08-15' }], schema).toString('utf8').split('\n')[1];
        expect(text).toBe('2026-08-15,,,,');
    });

    it('an extra key contributes nothing', () => {
        const a = toCsv([ROWS[0]], schema);
        const b = toCsv([{ ...ROWS[0], surprise: 'x' }], schema);
        expect(b.equals(a)).toBe(true);
    });

    it('round-trips through fromCsv with types intact', () => {
        const back = fromCsv(toCsv(ROWS, schema), schema);
        expect(back[0]).toMatchObject({ date: '2026-08-15', hits: 42, ratio: 1.5, live: true });
        expect(back[1].note).toBe('also, "quoted"');
        expect(back.length).toBe(2);
    });

    it('parses a value containing a newline', () => {
        const s: TableSchema = { fields: [{ name: 'a', type: 'string' }] };
        expect(fromCsv(toCsv([{ a: 'one\ntwo' }], s), s)[0].a).toBe('one\ntwo');
    });
});

describe('contentHashOf — the version', () => {
    const base = () => ({
        name: 'demo',
        profile: 'tabular-data-package' as const,
        resources: [{
            name: 'rows', path: 'data/rows.csv', profile: 'tabular-data-resource' as const,
            format: 'csv' as const, mediatype: 'text/csv' as const, encoding: 'utf-8' as const,
            schema: inferSchema(ROWS), rowCount: 2, bytes: 10, hash: bytesHash(toCsv(ROWS, inferSchema(ROWS))),
        }],
        created: '2026-08-15T10:00:00.000Z',
        aimeat: {
            packageId: 'pkg:alice/demo', changes: 'first',
            producer: { kind: 'extension' as const },
            producedBy: { gaii: 'alice@node', at: '2026-08-15T10:00:00.000Z' },
            schemaSource: 'inferred' as const,
        },
    });

    it('does NOT move with the wall clock — two identical runs of a deterministic producer agree', () => {
        const a = base();
        const b = base();
        b.created = '2026-09-01T03:00:00.000Z';
        b.aimeat.producedBy.at = '2026-09-01T03:00:00.000Z';
        expect(contentHashOf(b)).toBe(contentHashOf(a));
    });

    it('does NOT move with object key order — a jsonb round trip cannot change an identity', () => {
        const a = base();
        const b = base();
        b.aimeat = { producedBy: b.aimeat.producedBy, changes: b.aimeat.changes, schemaSource: b.aimeat.schemaSource, producer: b.aimeat.producer, packageId: b.aimeat.packageId } as typeof b.aimeat;
        expect(contentHashOf(b)).toBe(contentHashOf(a));
    });

    it('DOES move when one cell changes, because the resource hash moves', () => {
        const a = base();
        const b = base();
        const changed = [{ ...ROWS[0], hits: 43 }, ROWS[1]];
        b.resources[0].hash = bytesHash(toCsv(changed, inferSchema(ROWS)));
        expect(contentHashOf(b)).not.toBe(contentHashOf(a));
    });

    it('DOES move when the schema changes, even with identical data', () => {
        const a = base();
        const b = base();
        b.resources[0].schema = { fields: [...b.resources[0].schema.fields, { name: 'sentiment', type: 'number' }] };
        expect(contentHashOf(b)).not.toBe(contentHashOf(a));
    });

    it('DOES move when the change description changes — the explanation is part of the version', () => {
        const a = base();
        const b = base();
        b.aimeat.changes = 'second';
        expect(contentHashOf(b)).not.toBe(contentHashOf(a));
    });

    it('does NOT move with WHO produced it — the producer is interchangeable', () => {
        // This assertion was the other way round on the first attempt, and the slice-1 E2E caught it:
        // with the producer inside the hash, the same rows published by a schedule and by a workflow
        // step landed at two different addresses, which makes "any producer, one package" false.
        // Who made a version is a fact ABOUT the version, not part of what the version IS.
        const a = base();
        const b = base();
        b.aimeat.producedBy = { gaii: 'bot#alice@node', at: '2026-09-01T00:00:00.000Z', run: 'run-77' };
        b.aimeat.producer = { kind: 'workflow', ref: 'daily/produce', schedule: '0 6 * * *' };
        expect(contentHashOf(b)).toBe(contentHashOf(a));
    });

    it('does NOT move with WHAT IT REPLACED — history is where a version sits, not what it is', () => {
        // Same argument as the producer, one step further on. `supersedes` is derived at publish
        // time from the pointer that was standing there, so with it inside the identity the FIRST
        // publish of a table and a REPUBLISH of the identical table would hash differently — purely
        // because something came before the second one. The same rows would land at two addresses.
        const a = base();
        const b = base();
        b.aimeat.supersedes = 'pkg:alice/shortages@sha256:' + 'e'.repeat(64);
        expect(contentHashOf(b)).toBe(contentHashOf(a));
    });

    it('DOES move when the inference status changes — declared and inferred are not the same claim', () => {
        const a = base();
        const b = base();
        b.aimeat.schemaSource = 'declared';
        expect(contentHashOf(b)).not.toBe(contentHashOf(a));
    });
});
