/**
 * @file surface-focus.test.ts
 * @description The surface-focus gate's own arithmetic, against synthetic surfaces. Today's real
 *   numbers pass by construction, so they prove nothing about whether the gate would REFUSE the
 *   thing it exists to refuse. These cases do: a tool added where it belongs is allowed, the same
 *   tool spread onto a surface that did not carry it is not.
 * @version-history
 *   v1.0.0 -- 2026-09-03 -- Initial, with the gate.
 */
import { describe, it, expect } from 'vitest';
import { focusReport } from '../../scripts/check-surface-focus.js';

const SEEDS = { agent: 2, appdev: 3 };

/** full has 5, agent leaves out 2 (carries 3), appdev leaves out 3 (carries 2). */
const BASE = {
    full: ['a', 'b', 'c', 'd', 'e'],
    agent: ['a', 'b', 'c'],
    appdev: ['d', 'e'],
};

describe('surface focus', () => {
    it('passes when nothing moved', () => {
        const r = focusReport(BASE, SEEDS);
        expect(r.shrunk).toEqual([]);
        expect(r.rows.find(x => x.role === 'agent')).toMatchObject({ size: 3, distance: 2, seed: 2 });
    });

    it('allows a NEW tool placed where it belongs — full and one surface together', () => {
        const r = focusReport({ ...BASE, full: [...BASE.full, 'f'], agent: [...BASE.agent, 'f'] }, SEEDS);
        // The distance is unchanged: both sides grew by one. This is the move that must stay easy.
        expect(r.shrunk).toEqual([]);
        expect(r.rows.find(x => x.role === 'agent')?.distance).toBe(2);
    });

    it('allows a new tool that goes only on full — the surface got MORE focused', () => {
        const r = focusReport({ ...BASE, full: [...BASE.full, 'f'] }, SEEDS);
        expect(r.shrunk).toEqual([]);
        expect(r.gained).toContain('agent: 1');
    });

    it('REFUSES an existing tool being spread onto a surface that did not carry it', () => {
        // 'd' was appdev's. Putting it on agent as well is the one move that makes a surface less
        // focused, and it is exactly how `agent` reached 65% of the catalog.
        const r = focusReport({ ...BASE, agent: [...BASE.agent, 'd'] }, SEEDS);
        expect(r.shrunk).toEqual(['agent: leaves out 1, seeded 2']);
    });

    it('REFUSES a tool drifting onto a fourth surface', () => {
        const wide = {
            full: ['a', 'b'],
            one: ['a'], two: ['a'], three: ['a'], four: ['a'],
        };
        const seeds = { one: 1, two: 1, three: 1, four: 1 };
        const r = focusReport(wide, seeds, 0, 4);
        expect(r.spread).toBe(1);
        expect(r.shrunk).toContain('spread: 1 tools on 4+ surfaces, seeded 0');
    });
});
