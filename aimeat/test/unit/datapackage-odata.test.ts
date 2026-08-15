/**
 * @file test/unit/datapackage-odata.test.ts
 * @description The OData projection, and above all what it REFUSES.
 *
 *   The refusal tests are the important half. An OData server that ignores a query option it does
 *   not understand hands the client MORE ROWS THAN IT ASKED FOR, and the client puts them in a
 *   report as the answer. There is no symptom: the numbers are simply wrong. So every "not
 *   implemented" case below is a test that the server said no rather than quietly said yes.
 * @usage cd aimeat && pnpm exec vitest run test/unit/datapackage-odata.test.ts
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1).
 */
import { describe, it, expect } from 'vitest';
import { toCsdl, parseQuery, applyQuery, edmName, ROW_KEY } from '../../src/services/datapackage/odata.js';
import { inferSchema } from '../../src/services/datapackage/table.js';
import type { Descriptor, TableSchema } from '../../src/services/datapackage/contract.js';

const ROWS = [
    { vnr: '001000', name: 'Burana', shortage: true, reported: '2026-08-10', packages: 12 },
    { vnr: '001001', name: 'Panadol', shortage: false, reported: '2026-08-11', packages: 4 },
    { vnr: '001002', name: 'Buranex', shortage: true, reported: '2026-08-12', packages: 0 },
];
const SCHEMA = inferSchema(ROWS);
const q = (s: string) => parseQuery(new URLSearchParams(s), SCHEMA);
const run = (s: string) => {
    const p = q(s);
    if (!p.ok) throw new Error(`unexpected refusal: ${p.message}`);
    return applyQuery(ROWS, p.value, SCHEMA);
};

const descriptor: Descriptor = {
    name: 'shortages', profile: 'tabular-data-package', created: '2026-08-15T00:00:00.000Z',
    resources: [{
        name: 'rows', path: 'data/rows.csv', profile: 'tabular-data-resource',
        format: 'csv', mediatype: 'text/csv', encoding: 'utf-8',
        schema: SCHEMA, rowCount: 3, bytes: 100, hash: 'sha256:x',
    }],
    aimeat: {
        packageId: 'pkg:alice/shortages', contentHash: 'sha256:' + 'a'.repeat(64), changes: 'c',
        producer: { kind: 'extension' }, producedBy: { gaii: 'a@n', at: '2026' }, schemaSource: 'inferred',
    },
};

describe('CSDL — the metadata Excel parses before it asks for anything', () => {
    const xml = toCsdl(descriptor, 'AIMEAT.shortages');

    it('is a v4 edmx document', () => {
        expect(xml).toContain('<edmx:Edmx Version="4.0"');
        expect(xml).toContain('xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"');
        expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    });

    it('maps every Frictionless type to its EDM primitive, from the ONE place types are declared', () => {
        expect(xml).toContain('<Property Name="vnr" Type="Edm.String"');
        expect(xml).toContain('<Property Name="shortage" Type="Edm.Boolean"');
        expect(xml).toContain('<Property Name="reported" Type="Edm.Date"');
        expect(xml).toContain('<Property Name="packages" Type="Edm.Int64"');
    });

    it('supplies a key, because OData needs one and a CSV row has no identity of its own', () => {
        expect(xml).toContain(`<Key><PropertyRef Name="${ROW_KEY}"/></Key>`);
        expect(xml).toContain(`<Property Name="${ROW_KEY}" Type="Edm.Int64" Nullable="false"/>`);
    });

    it('declares an entity set per resource, inside a container', () => {
        expect(xml).toContain('<EntitySet Name="rows" EntityType="AIMEAT.shortages.rows"/>');
        expect(xml).toContain('<EntityContainer Name="Container">');
    });

    it('every data property is nullable, because only primaryKey states otherwise', () => {
        for (const m of xml.matchAll(/<Property Name="(\w+)"[^>]*Nullable="(\w+)"/g)) {
            expect(m[2]).toBe(m[1] === ROW_KEY ? 'false' : 'true');
        }
    });

    it('a column name that is legal in CSV and illegal in CSDL is mapped, not rejected', () => {
        expect(edmName('first name')).toBe('first_name');
        expect(edmName('2026')).toBe('_2026');
        expect(edmName('päivä')).toBe('p_iv_');
    });

    it('escapes a field name rather than trusting it as markup', () => {
        const nasty: TableSchema = { fields: [{ name: 'a<b', type: 'string' }] };
        const doc = toCsdl({ ...descriptor, resources: [{ ...descriptor.resources[0], schema: nasty }] }, 'N');
        expect(doc).not.toContain('a<b');
        expect(doc).toContain('a_b');
    });
});

describe('what the feed REFUSES rather than ignores', () => {
    it('an unsupported system query option is 501, naming what IS supported', () => {
        const p = q('$expand=other');
        expect(p.ok).toBe(false);
        if (p.ok) return;
        expect(p.code).toBe('NOT_IMPLEMENTED');
        expect(p.message).toContain('$select');
        expect(p.message).toMatch(/refused rather than ignored/i);
    });

    it('$apply and $search are refused too', () => {
        for (const opt of ['$apply=groupby((vnr))', '$search=burana']) {
            expect(q(opt).ok).toBe(false);
        }
    });

    it('a $filter with `or` is refused — half a filter matches more than you asked for', () => {
        const p = q("$filter=shortage eq true or packages gt 5");
        expect(p.ok).toBe(false);
        if (!p.ok) expect(p.code).toBe('NOT_IMPLEMENTED');
    });

    it('a $filter clause the parser does not understand is refused, not skipped', () => {
        const p = q('$filter=year(reported) eq 2026');
        expect(p.ok).toBe(false);
        if (!p.ok) expect(p.message).toContain('not understood');
    });

    it('a filter on a property that does not exist is a 400, not an empty result', () => {
        const p = q("$filter=nosuch eq 'x'");
        expect(p.ok).toBe(false);
        if (!p.ok) expect(p.code).toBe('BAD_REQUEST');
    });

    it('$select of a property that does not exist is refused', () => {
        expect(q('$select=vnr,nosuch').ok).toBe(false);
    });

    it('a malformed $top is refused rather than defaulted', () => {
        expect(q('$top=lots').ok).toBe(false);
        expect(q('$top=-1').ok).toBe(false);
    });

    it('a custom, non-$ parameter is the caller\'s business and is left alone', () => {
        expect(q('utm_source=excel').ok).toBe(true);
    });
});

describe('the subset it does honour', () => {
    it('$select returns only those properties, plus the key', () => {
        const { rows } = run('$select=vnr,packages');
        expect(Object.keys(rows[0]).sort()).toEqual([ROW_KEY, 'packages', 'vnr'].sort());
    });

    it('$top and $skip page', () => {
        expect(run('$top=2').rows.length).toBe(2);
        expect(run('$skip=2').rows.length).toBe(1);
        expect(run('$skip=1&$top=1').rows[0].vnr).toBe('001001');
    });

    it('$filter eq on a string, a boolean and a number', () => {
        expect(run("$filter=vnr eq '001001'").rows.length).toBe(1);
        expect(run('$filter=shortage eq true').rows.length).toBe(2);
        expect(run('$filter=packages eq 0').rows.length).toBe(1);
    });

    it('$filter comparison operators, including on an ISO date', () => {
        expect(run('$filter=packages gt 3').rows.length).toBe(2);
        expect(run('$filter=packages ge 4').rows.length).toBe(2);
        expect(run('$filter=packages lt 4').rows.length).toBe(1);
        expect(run("$filter=reported ge '2026-08-11'").rows.length).toBe(2);
    });

    it('$filter clauses join with and', () => {
        expect(run('$filter=shortage eq true and packages gt 0').rows.length).toBe(1);
    });

    it('contains, startswith and endswith', () => {
        expect(run("$filter=contains(name,'ura')").rows.length).toBe(2);
        expect(run("$filter=startswith(name,'Pan')").rows.length).toBe(1);
        expect(run("$filter=endswith(vnr,'2')").rows.length).toBe(1);
    });

    it('$orderby, both directions', () => {
        expect(run('$orderby=packages asc').rows.map(r => r.packages)).toEqual([0, 4, 12]);
        expect(run('$orderby=packages desc').rows.map(r => r.packages)).toEqual([12, 4, 0]);
    });

    it('$count reports what the FILTER matched, not what the page returned', () => {
        const p = q('$filter=shortage eq true&$top=1&$count=true');
        expect(p.ok).toBe(true);
        if (!p.ok) return;
        const page = applyQuery(ROWS, p.value, SCHEMA);
        expect(page.rows.length).toBe(1);
        expect(page.matched).toBe(2);
    });

    it('the key is assigned BEFORE filtering, so it does not shift with the query', () => {
        const all = run('');
        const filtered = run("$filter=vnr eq '001002'");
        expect(filtered.rows[0][ROW_KEY]).toBe(all.rows[2][ROW_KEY]);
    });

    it('a quoted string with an embedded quote parses', () => {
        const rows = [{ name: "O'Brien" }];
        const s = inferSchema(rows);
        const p = parseQuery(new URLSearchParams("$filter=name eq 'O''Brien'"), s);
        expect(p.ok).toBe(true);
        if (!p.ok) return;
        expect(applyQuery(rows, p.value, s).rows.length).toBe(1);
    });

    it('property names go out as the metadata published them', () => {
        const rows = [{ 'first name': 'a' }];
        const s = inferSchema(rows);
        const p = parseQuery(new URLSearchParams('$select=first_name'), s);
        expect(p.ok).toBe(true);
        if (!p.ok) return;
        expect(Object.keys(applyQuery(rows, p.value, s).rows[0])).toContain('first_name');
    });
});
