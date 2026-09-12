/**
 * @file cortex-grouping.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one rule the admin Cortex extensions page adds to what the server sends: how
 *   the cortexes nothing loads are arranged so an operator can act on them.
 *
 *   THE FIXTURE IS REAL. Every name, installer and date below was read off aimeat.io on
 *   2026-09-12, because the arrangement is only worth anything if it separates the sets that are
 *   actually there: seven parts of one Bitcoin tracker installed in one afternoon, three fleet
 *   dashboards under two spellings, one game spelled two ways, and the kit the site ships.
 *
 *   THE HEURISTIC IS ALLOWED TO BE WRONG, which is why the reason is part of the answer and not
 *   just a yes: the page prints it, so an operator can see what joined two names and overrule it.
 *   These tests pin which of the three reasons each real pair earns.
 * @usage cd aimeat && pnpm exec vitest run test/unit/cortex-grouping.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Cortex extensions page in the poster face).
 */
import { describe, it, expect } from 'vitest';
import {
    nameKey, editDistance, lookalikeReason, isSiteOwn, groupUnused,
} from '../../public/views/admin/cortex-tab.groups.js';

const SITE = 'system@aimeat-finland-001-genesis';

/** One listing row, with only the fields the arrangement reads. */
const cx = (name: string, opts: Partial<{ apps: number; by: string; at: string }> = {}) => ({
    name,
    installed_by: opts.by ?? 'happydude500001',
    installed_at: opts.at ?? '2026-06-03T04:14:59.569Z',
    used_by: { apps: opts.apps ?? 0, cortexes: 0, app_names: [], cortex_names: [] },
});

describe('nameKey', () => {
    it('keeps only the letters and digits a person reads out', () => {
        expect(nameKey('fleet-status-cortex')).toBe('fleetstatuscortex');
        expect(nameKey('fleetstatus-cortex')).toBe('fleetstatuscortex');
        expect(nameKey('happydude500001/taivas-engine')).toBe('happydude500001taivasengine');
    });

    it('answers for a missing name rather than throwing', () => {
        expect(nameKey(undefined)).toBe('');
        expect(nameKey(null)).toBe('');
    });
});

describe('editDistance', () => {
    it('counts the single-letter edits between two names', () => {
        expect(editDistance('tictactoecortex', 'tictactactoecortex')).toBe(3);
        expect(editDistance('abc', 'abc')).toBe(0);
    });

    it('gives up past the cap instead of measuring two unrelated names', () => {
        expect(editDistance('aimeatuinav', 'aimeatuiforms', 3)).toBeGreaterThan(3);
        expect(editDistance('a', 'abcdefghij', 3)).toBeGreaterThan(3);
    });
});

describe('lookalikeReason', () => {
    it('calls one spelling of the same letters what it is', () => {
        expect(lookalikeReason('fleet-status-cortex', 'fleetstatus-cortex')).toBe('sameLetters');
    });

    it('calls one name sitting inside another a containment', () => {
        expect(lookalikeReason('marketplace-cortex', 'tori-marketplace-cortex')).toBe('contains');
        expect(lookalikeReason('comicland-v2', 'comicland-v2-happydude500001-eb9ed495-cortex-comicland-v2')).toBe('contains');
    });

    it('calls two names a few letters apart a near miss', () => {
        expect(lookalikeReason('tictactoe-cortex', 'tictactactoe-cortex')).toBe('close');
    });

    it('leaves two real neighbours alone', () => {
        expect(lookalikeReason('aimeat-ui-nav', 'aimeat-ui-forms')).toBeNull();
        expect(lookalikeReason('aimeat-charts', 'aimeat-flow')).toBeNull();
        expect(lookalikeReason('fleetdash-cortex', 'fleet-status-cortex')).toBeNull();
    });

    /**
     * The sharpest edge on the near-miss test: a family of names that share a long prefix and
     * differ only in the last word. Every one of these is a real, separate piece of the kit, and
     * joining any pair would tell an operator to throw one away.
     */
    it('leaves a family of kit names apart, however much prefix they share', () => {
        const family = ['aimeat-ui-nav', 'aimeat-ui-forms', 'aimeat-ui-layout', 'aimeat-ui-dialogs', 'aimeat-ui-viewers'];
        for (const a of family) {
            for (const b of family) {
                if (a !== b) expect(lookalikeReason(a, b)).toBeNull();
            }
        }
    });

    it('will not join two short names, where a few letters is the whole name', () => {
        expect(lookalikeReason('prh', 'prh-x')).toBeNull();
        expect(lookalikeReason('pulse', 'pulses')).toBeNull();
    });
});

describe('isSiteOwn', () => {
    it('knows what this site installed itself', () => {
        expect(isSiteOwn({ installed_by: SITE })).toBe(true);
        expect(isSiteOwn({ installed_by: 'happyadmin' })).toBe(false);
        expect(isSiteOwn({})).toBe(false);
    });
});

describe('groupUnused', () => {
    // The seven pieces of one Bitcoin tracker, installed in one afternoon and loaded by nothing.
    const BTC = ['kpi-card', 'currency-toggle', 'transaction-form', 'transactions-table', 'line-chart', 'tax-table', 'comparison-card']
        .map(n => cx(n, { by: 'generator', at: '2026-05-22T15:30:57.531Z' }));
    const FLEET = [
        cx('fleet-status-cortex', { by: 'owl', at: '2026-06-02T17:34:35.545Z' }),
        cx('fleetstatus-cortex', { by: 'owl', at: '2026-06-02T17:15:22.094Z' }),
    ];
    const SITE_KIT = [
        cx('aimeat-ui-layout', { by: SITE, at: '2026-03-16T23:51:28.270Z' }),
        cx('aimeat-ui-nav', { by: SITE, at: '2026-03-16T23:51:28.309Z' }),
    ];
    const ALONE = cx('tori-marketplace-cortex', { by: 'happydude500001', at: '2026-06-06T06:13:51.433Z' });
    const USED = cx('aimeat-tdr-cortex', { apps: 12, by: 'happydude500001' });

    const unused = [...BTC, ...FLEET, ...SITE_KIT, ALONE];
    const all = [...unused, USED];
    const groups = groupUnused(all, unused);
    const byKind = (k: string) => groups.filter(g => g.kind === k);

    it('puts every unused cortex in exactly one group', () => {
        const seen = groups.flatMap(g => g.items.map(e => e.name)).filter(n => unused.some(u => u.name === n));
        expect(seen.slice().sort()).toEqual(unused.map(e => e.name).sort());
        expect(new Set(seen).size).toBe(unused.length);
    });

    it('joins the two spellings of one fleet dashboard, and says which test joined them', () => {
        const look = byKind('lookalike');
        expect(look).toHaveLength(1);
        expect(look[0].items.map(e => e.name).sort()).toEqual(['fleet-status-cortex', 'fleetstatus-cortex']);
        expect(look[0].reason).toBe('sameLetters');
    });

    it('gathers what one person installed on one day, and carries the fact that made the group', () => {
        const batch = byKind('batch');
        expect(batch).toHaveLength(1);
        expect(batch[0].items).toHaveLength(7);
        expect(batch[0].by).toBe('generator');
        expect(batch[0].day).toBe('2026-05-22');
    });

    it('keeps what this site ships in a group of its own', () => {
        const site = byKind('site');
        expect(site).toHaveLength(1);
        expect(site[0].items.map(e => e.name).sort()).toEqual(['aimeat-ui-layout', 'aimeat-ui-nav']);
    });

    it('leaves the one that resembles nothing on its own row', () => {
        const ones = byKind('one');
        expect(ones).toHaveLength(1);
        expect(ones[0].items[0].name).toBe('tori-marketplace-cortex');
    });

    it('never lists a cortex an app loads as something to clear away', () => {
        for (const g of groups) expect(g.items.map(e => e.name)).not.toContain('aimeat-tdr-cortex');
    });

    it('brings a used twin along so the pair can be read together', () => {
        const twinned = groupUnused(
            [cx('marketplace-cortex', { apps: 3 }), cx('tori-marketplace-cortex')],
            [cx('tori-marketplace-cortex')],
        );
        expect(twinned).toHaveLength(1);
        expect(twinned[0].kind).toBe('lookalike');
        expect(twinned[0].items.map(e => e.name).sort()).toEqual(['marketplace-cortex', 'tori-marketplace-cortex']);
    });

    it('needs three before it calls something a batch', () => {
        const two = [cx('alpha-thing', { by: 'x', at: '2026-01-01T00:00:00Z' }), cx('beta-thing', { by: 'x', at: '2026-01-01T00:00:00Z' })];
        expect(groupUnused(two, two).every(g => g.kind === 'one')).toBe(true);
    });

    it('answers with nothing when nothing is unused', () => {
        expect(groupUnused([USED], [])).toEqual([]);
    });

    /**
     * A site seeds its whole bundled kit in one second at first boot, so "installed together by one
     * person on one day" describes the site's own furniture perfectly. Read in the wrong order it
     * puts fifteen pieces of the kit behind a Remove all 15 button, which is the one arrangement on
     * this page that would actively cause harm.
     */
    it('never calls the kit this site ships a removable batch', () => {
        // The fifteen a fresh site actually seeds, by their real names.
        const kit = [
            'aimeat-canvas', 'aimeat-charts', 'aimeat-dag', 'aimeat-flow', 'aimeat-i18n',
            'aimeat-input', 'aimeat-parvi', 'aimeat-surface', 'aimeat-ui-dialogs', 'aimeat-ui-forms',
            'aimeat-ui-layout', 'aimeat-ui-nav', 'aimeat-ui-viewers', 'aimeat-viewport', 'aimeat-vocab',
        ].map(n => cx(n, { by: SITE, at: '2026-03-16T23:51:28.270Z' }));
        const out = groupUnused(kit, kit);
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('site');
        expect(out[0].items).toHaveLength(15);
        expect(out.some(g => g.kind === 'batch')).toBe(false);
    });
});
