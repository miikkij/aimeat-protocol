/**
 * @file test/unit/datapackage-odps.test.ts
 * @description The acceptance line "the package is sellable", made checkable: the ODPS sheet
 *   generated from a descriptor validates against the VENDORED ODPS v4.1 schema, with no mapping
 *   layer in between.
 *
 *   WHY VALIDATE AGAINST THE VENDORED COPY. A projection that only satisfies our own idea of the
 *   spec is a projection nobody else can read. The schema in test/fixtures is the published one, and
 *   the interesting failures are its CLOSED enums — `dataAccess[].format`, `specification`, the SLA
 *   dimension names. Those are exactly where a generator drifts by filling a field with the closest
 *   wrong answer, so the tests below name each one.
 * @usage cd aimeat && pnpm exec vitest run test/unit/datapackage-odps.test.ts
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import { descriptorToOdps, odpsToYamlDocument } from '../../src/services/datapackage/odps.js';
import { inferSchema, toCsv } from '../../src/services/datapackage/table.js';
import { bytesHash, type Descriptor } from '../../src/services/datapackage/contract.js';

const odpsSchema = JSON.parse(readFileSync(new URL('../fixtures/odps-v4.1.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const rawValidate = ajv.compile(odpsSchema);

/**
 * Validate everything the published schema can actually judge.
 *
 * `product.dataAccess` is excluded, and NOT because ours is wrong. The published v4.1 schema
 * contradicts itself there: the `product.dataAccess` property is `type: object` while it `$ref`s an
 * array-typed definition, so no document can satisfy both halves. The spec's own examples show a
 * MAPPING of named access blocks, which is what this node emits and what services/exchange-odps.ts
 * already decided for the EXCHANGE projection. The tripwire below fails the day upstream fixes it,
 * so this exclusion cannot outlive its reason.
 */
function validate(doc: unknown): { ok: boolean; errors: unknown[] } {
    const d = doc as { product: Record<string, unknown> };
    const validatable = { ...d, product: { ...d.product } };
    delete validatable.product.dataAccess;
    const ok = rawValidate(validatable) as boolean;
    return { ok, errors: rawValidate.errors ?? [] };
}

it('TRIPWIRE: the published schema still contradicts itself on dataAccess', () => {
    // The day this fails, upstream fixed it: validate the whole document and delete the exclusion.
    expect(odpsSchema.properties.product.properties.dataAccess.type).toBe('object');
    expect(odpsSchema.$defs.DataAccess.type).toBe('array');
});

const ROWS = [
    { vnr: '001000', name: 'Burana, 400 mg', shortage: true, reported: '2026-08-10', packages: 12 },
    { vnr: '001001', name: 'Panadol', shortage: false, reported: '2026-08-11', packages: 0 },
];
const SCHEMA = inferSchema(ROWS);
const CSV = toCsv(ROWS, SCHEMA);

function descriptor(over: Partial<Descriptor['aimeat']> = {}): Descriptor {
    return {
        name: 'shortages-weekly',
        profile: 'tabular-data-package',
        title: 'Medicine shortages, weekly',
        description: 'The Finnish shortage list, normalised.',
        created: '2026-08-15T06:00:00.000Z',
        resources: [{
            name: 'rows', path: 'data/rows.csv', profile: 'tabular-data-resource',
            format: 'csv', mediatype: 'text/csv', encoding: 'utf-8',
            schema: SCHEMA, rowCount: ROWS.length, bytes: CSV.length, hash: bytesHash(CSV),
        }],
        aimeat: {
            packageId: 'pkg:alice/shortages-weekly',
            contentHash: 'sha256:' + 'a'.repeat(64),
            changes: 'Two products entered the shortage list.',
            producer: { kind: 'extension', ref: 'sched-1', schedule: '0 6 * * 1' },
            producedBy: { gaii: 'scheduler@node', at: '2026-08-15T06:00:00.000Z' },
            schemaSource: 'inferred',
            license: 'CC-BY-4.0',
            legalBasis: 'public register',
            sources: [{ url: 'https://fimea.fi/', title: 'Fimea shortage file' }],
            ...over,
        },
    };
}

const project = (d: Descriptor) => descriptorToOdps({
    descriptor: d,
    ownerGhii: 'alice@node',
    baseUrl: 'https://aimeat.io',
    descriptorUrl: 'https://aimeat.io/v1/pub/alice%40node/datapkg/shortages-weekly/aaa/datapackage.json',
    resourceUrls: { rows: 'https://aimeat.io/v1/pub/alice%40node/datapkg/shortages-weekly/aaa/data/rows.csv' },
});

describe('descriptorToOdps — validates against the vendored ODPS v4.1 schema', () => {
    it('a scheduled package produces a conformant document', () => {
        const { ok, errors } = validate(project(descriptor()));
        expect(errors).toEqual([]);
        expect(ok).toBe(true);
    });

    it('a package with NO schedule is conformant too, and simply states no service level', () => {
        const d = descriptor({ producer: { kind: 'manual' } });
        const doc = project(d) as any;
        expect(validate(doc).errors).toEqual([]);
        // An unstated SLA is an ABSENT SLA, never a promise of daily.
        expect(doc.product.SLA).toBeUndefined();
    });

    it('survives a round trip through YAML, which is the form it is stored in', () => {
        const yaml = odpsToYamlDocument(project(descriptor()));
        expect(validate(parseYaml(yaml)).errors).toEqual([]);
    });
});

describe('the closed enums the spec will not bend', () => {
    it('dataAccess format is CSV and JSON — both on the published list', () => {
        const doc = project(descriptor()) as any;
        const formats = Object.values(doc.product.dataAccess).map((p: any) => p.format);
        expect(formats).toEqual(['CSV', 'JSON']);
    });

    it('no port claims an API specification, because a file has none', () => {
        const doc = project(descriptor()) as any;
        for (const port of Object.values(doc.product.dataAccess) as any[]) {
            expect(port.specification).toBeUndefined();
        }
    });

    it('the SLA dimension is the enum\'s own word, and the unit is one of its units', () => {
        const doc = project(descriptor()) as any;
        const dim = doc.product.SLA.declarative[0].dimensions[0];
        expect(dim.dimension).toBe('updateFrequency');
        expect(['days', 'weeks', 'months']).toContain(dim.unit);
    });
});

describe('the cadence comes from the producer cron, not from prose', () => {
    const freq = (cron: string | undefined) => {
        const doc = project(descriptor({ producer: { kind: 'extension', schedule: cron } })) as any;
        return doc.product.SLA?.declarative[0].dimensions[0];
    };

    it('a weekly cron reads as weekly', () => {
        expect(freq('0 6 * * 1')).toMatchObject({ objective: '1', unit: 'weeks' });
    });
    it('a daily cron reads as daily', () => {
        expect(freq('0 6 * * *')).toMatchObject({ objective: '1', unit: 'days' });
    });
    it('a monthly cron reads as monthly', () => {
        expect(freq('0 6 1 * *')).toMatchObject({ objective: '1', unit: 'months' });
    });
    it('several weekdays are more often than weekly, so the floor is days', () => {
        expect(freq('0 6 * * 1,3,5')).toMatchObject({ unit: 'days' });
    });
    it('no cron means no SLA block at all', () => {
        expect(freq(undefined)).toBeUndefined();
    });
});

describe('what x-aimeat carries, being everything the enums cannot', () => {
    it('the columns and their types, from the one place they are declared', () => {
        const x = (project(descriptor()) as any).product['x-aimeat'];
        expect(x.resources[0].fields).toEqual([
            { name: 'vnr', type: 'string' },       // NOT integer — a zero-padded identifier
            { name: 'name', type: 'string' },
            { name: 'shortage', type: 'boolean' },
            { name: 'reported', type: 'date' },
            { name: 'packages', type: 'integer' },
        ]);
    });

    it('the content hash, the producer and whether anybody confirmed the types', () => {
        const x = (project(descriptor()) as any).product['x-aimeat'];
        expect(x.contentHash).toMatch(/^sha256:/);
        expect(x.schemaSource).toBe('inferred');
        expect(x.producer.kind).toBe('extension');
        expect(x.profile).toBe('aimeat.datapackage/v1');
    });

    it('a free sample without a second artefact: the resource itself', () => {
        const doc = project(descriptor()) as any;
        expect(doc.product.details.en.contentSample).toContain('/data/rows.csv');
    });

    it('the version note IS the required change description — never empty', () => {
        const doc = project(descriptor()) as any;
        expect(doc.product.details.en.versionNotes).toBe('Two products entered the shortage list.');
    });
});
