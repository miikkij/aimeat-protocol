/**
 * @file test/unit/data-map-model.test.ts
 * @description The browser-side data-map vocabulary, and the one thing that keeps its two copies
 *   honest.
 *
 *   The app-catalog is an esbuild bundle with no Preact and no import map, so it cannot import from
 *   /components; the house convention there is to port. A duplicated rule set is a defect unless
 *   something makes drift impossible, so this loads BOTH copies and runs the same table through
 *   each. Change one and the other goes red rather than quietly wrong.
 * @usage pnpm test -- data-map-model
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073, the surfaces half.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const SHARED = join(ROOT, 'public', 'components', 'data-map', 'model.js');
const CATALOG = join(ROOT, 'src', 'static', 'app-catalog', 'js', 'data-map-model.js');

const model = await import(`file://${SHARED.replace(/\\/g, '/')}`);

const row = (pattern: string, over: Record<string, unknown> = {}) => ({
    grant: { area: 'memory', pattern, rights: ['read', 'write'] },
    basis: { tier: 'declared-space', by: 'app:x' },
    why: 'Because it belongs to the customer.',
    source: 'declared',
    ...over,
});
const map = (over: Record<string, unknown> = {}) => ({
    spec: 'aimeat.datamap/1', form: 'single-person', source: 'declared',
    held: [row('cadence.*')], elsewhere: [], at: '2026-08-24T00:00:00.000Z', ...over,
});
const seen = (family: string) => ({ family, trace: { writeCount: 1 } });

describe('the four states', () => {
    it('a map somebody wrote is declared', () => {
        expect(model.mapState(map(), [])).toBe('declared');
    });

    it('a map the node worked out is derived, and never claims otherwise', () => {
        expect(model.mapState(map({ source: 'derived' }), [])).toBe('derived');
    });

    it('no rows is a STATEMENT, not an absence', () => {
        // An absent map and an empty one look identical to a person, and only one is a finding.
        expect(model.mapState(map({ held: [] }), [])).toBe('empty');
        expect(model.mapState(null, [])).toBe('empty');
    });

    it('a map that disagrees with reality outranks everything else', () => {
        const m = map({ source: 'derived' });
        expect(model.mapState(m, [seen('somewhere.else.*')])).toBe('contradicted');
    });
});

describe('the contradiction rule, both directions', () => {
    it('a family being written that no row covers', () => {
        const { undeclared } = model.contradictions(map(), [seen('somewhere.else.*')]);
        expect(undeclared).toHaveLength(1);
    });

    it('a declared row that has never received a write', () => {
        const { dead } = model.contradictions(map(), [seen('something.other.*')]);
        expect(dead.map((r: any) => r.grant.pattern)).toEqual(['cadence.*']);
    });

    it('a declared pattern covers the families beneath it', () => {
        const m = map({ held: [row('uutiset.*')] });
        const { undeclared, dead } = model.contradictions(m, [seen('uutiset.elokuu.*')]);
        expect(undeclared).toHaveLength(0);
        expect(dead).toHaveLength(0);
    });

    it('says nothing at all when nothing has been observed yet', () => {
        // A brand-new app has no trace. Reporting every row as dead on day one would fire on
        // everything, which is how a finding gets ignored.
        const { undeclared, dead } = model.contradictions(map(), []);
        expect(undeclared).toHaveLength(0);
        expect(dead).toHaveLength(0);
    });
});

describe('the weakest basis is what the whole map is worth', () => {
    it('reports the weakest row, not the strongest', () => {
        const m = map({
            held: [row('a.*', { basis: { tier: 'schema-locked', by: 's' } }), row('b.*', { basis: { tier: 'none', by: '' } })],
        });
        expect(model.weakestTier(m.held)).toBe('none');
    });

    it('scores an unknown tier lowest, so a bad value cannot look reassuring', () => {
        expect(model.tierRank('nonsense')).toBe(0);
        expect(model.tierRank('schema-locked')).toBeGreaterThan(model.tierRank('owner-named'));
    });
});

describe('reading order', () => {
    it('puts what disagrees first, then what nobody explained', () => {
        // Two of the three rows are covered by something observed. The third declares a write that
        // has never happened, which is the disagreement, and it leads even though it has a `why`.
        const m = map({
            held: [
                row('seen-a.*', { why: 'A good reason.' }),
                row('nowhy.*', { why: '' }),
                row('never-written.*', { why: 'Another reason.' }),
            ],
        });
        const ordered = model.orderRows(m, [seen('seen-a.elokuu.*'), seen('nowhy.elokuu.*')]);
        expect(ordered[0].grant.pattern).toBe('never-written.*');
        expect(ordered[1].grant.pattern).toBe('nowhy.*');
    });
});

describe('the summary a one-line strip shows', () => {
    it('counts the groups, the unexplained and the disagreements', () => {
        const m = map({ held: [row('a.*', { why: '' }), row('b.*')] });
        const s = model.summarise(m, [seen('c.*')]);
        expect(s.groups).toBe(2);
        expect(s.unexplained).toBe(1);
        expect(s.contradictions).toBeGreaterThan(0);
        expect(s.state).toBe('contradicted');
    });
});

describe('the catalogue copy cannot drift', () => {
    it('exists, and answers identically on the whole table', async () => {
        expect(existsSync(CATALOG), `${CATALOG} is missing — the catalogue must carry a copy`).toBe(true);
        const ported = await import(`file://${CATALOG.replace(/\\/g, '/')}`);

        const cases: [unknown, unknown][] = [
            [map(), []],
            [map({ source: 'derived' }), []],
            [map({ held: [] }), []],
            [map(), [seen('somewhere.else.*')]],
            [map({ held: [row('uutiset.*')] }), [seen('uutiset.elokuu.*')]],
            [null, []],
        ];
        for (const [m, o] of cases) {
            expect(ported.mapState(m, o), `mapState disagreed on ${JSON.stringify(m)}`)
                .toBe(model.mapState(m, o));
            expect(ported.summarise(m, o)).toEqual(model.summarise(m, o));
        }
        for (const tier of [...model.TIERS, 'nonsense']) {
            expect(ported.tierRank(tier)).toBe(model.tierRank(tier));
        }
        expect(ported.TIERS).toEqual(model.TIERS);
        expect(ported.STATES).toEqual(model.STATES);
    });

    it('is a verbatim copy apart from its header, so a reviewer can diff it by eye', () => {
        const body = (p: string) => readFileSync(p, 'utf-8').replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trim();
        expect(body(CATALOG)).toBe(body(SHARED));
    });
});
