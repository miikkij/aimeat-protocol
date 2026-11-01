/**
 * @file test/unit/datapackage-freshness.test.ts
 * @description The pure parts of the data package lifecycle (plan doc-mvwxcas3dom3, D6.1, D6.4, D9.9):
 *   freshnessOf() states fresh, late, stale and unscheduled against the promised cron, reads a weekday
 *   cron's own gaps, follows its least fresh source, and never calls a package with no promise fresh;
 *   doomedVersions() never removes a version a named share pins.
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D6.1, D6.4).
 */
import { describe, it, expect } from 'vitest';
import { freshnessOf, worstOf, type Freshness } from '../../src/services/datapackage/freshness.js';
import { doomedVersions } from '../../src/services/datapackage/retention.js';

const daily = { cron: '0 6 * * *', timezone: 'UTC', source: 'producer' as const };
const at = (iso: string) => new Date(iso);

describe('freshnessOf', () => {
    it('is fresh within one interval plus grace', () => {
        const f = freshnessOf({ promise: daily, lastSuccessAt: '2026-11-01T06:00:05Z', now: at('2026-11-02T07:00:00Z') });
        expect(f.state).toBe('fresh');
        expect(f.promise?.interval_seconds).toBe(86_400);
        expect(f.due_at).toBe('2026-11-02T06:00:00.000Z');
    });
    it('is late past one interval and stale past three', () => {
        expect(freshnessOf({ promise: daily, lastSuccessAt: '2026-11-01T06:00:05Z', now: at('2026-11-02T09:00:00Z') }).state).toBe('late');
        expect(freshnessOf({ promise: daily, lastSuccessAt: '2026-11-01T06:00:05Z', now: at('2026-11-04T05:00:00Z') }).state).toBe('late');
        const stale = freshnessOf({ promise: daily, lastSuccessAt: '2026-11-01T06:00:05Z', now: at('2026-11-04T10:00:00Z') });
        expect(stale.state).toBe('stale');
        expect(stale.reason_code).toBe('missed-three');
    });
    it('reads a weekday cron by its own runs: Friday to Monday is not late', () => {
        const weekdays = { cron: '0 6 * * 1-5', timezone: 'UTC', source: 'producer' as const };
        // 2026-10-30 is a Friday; the next run is Monday 2026-11-02 06:00.
        expect(freshnessOf({ promise: weekdays, lastSuccessAt: '2026-10-30T06:00:00Z', now: at('2026-11-01T20:00:00Z') }).state).toBe('fresh');
        expect(freshnessOf({ promise: weekdays, lastSuccessAt: '2026-10-30T06:00:00Z', now: at('2026-11-02T09:00:00Z') }).state).toBe('late');
    });
    it('never calls a package with no promise fresh', () => {
        const f = freshnessOf({ promise: null, lastSuccessAt: '2026-11-01T06:00:00Z', producerKind: 'manual', now: at('2026-11-01T06:01:00Z') });
        expect(f.state).toBe('unscheduled');
        expect(f.reason_code).toBe('no-promise');
    });
    it('reads a workflow or extension producer with no promise as stale after 30 silent days', () => {
        expect(freshnessOf({ promise: null, lastSuccessAt: '2026-08-15T00:00:00Z', producerKind: 'workflow', now: at('2026-11-01T00:00:00Z') }).state).toBe('stale');
        expect(freshnessOf({ promise: null, lastSuccessAt: '2026-10-25T00:00:00Z', producerKind: 'extension', now: at('2026-11-01T00:00:00Z') }).state).toBe('unscheduled');
        expect(freshnessOf({ promise: null, lastSuccessAt: '2026-08-15T00:00:00Z', producerKind: 'agent', now: at('2026-11-01T00:00:00Z') }).state).toBe('unscheduled');
    });
    it('treats @activate and an unreadable cron as no promise', () => {
        expect(freshnessOf({ promise: { cron: '@activate', source: 'producer' }, lastSuccessAt: '2026-11-01T00:00:00Z', now: at('2026-11-01T00:00:00Z') }).state).toBe('unscheduled');
        const bad = freshnessOf({ promise: { cron: 'not a cron', source: 'producer' }, lastSuccessAt: '2026-11-01T00:00:00Z', now: at('2026-11-01T00:00:00Z') });
        expect(bad.state).toBe('unscheduled');
        expect(bad.reason_code).toBe('promise-unreadable');
    });
    it('names a failed run newer than the last success', () => {
        const f = freshnessOf({ promise: daily, lastSuccessAt: '2026-11-01T06:00:00Z', lastError: { at: '2026-11-02T06:00:01Z', message: 'source down' }, now: at('2026-11-02T06:10:00Z') });
        expect(f.last_error?.message).toBe('source down');
        const older = freshnessOf({ promise: daily, lastSuccessAt: '2026-11-02T06:00:00Z', lastError: { at: '2026-11-01T06:00:01Z', message: 'old' }, now: at('2026-11-02T06:10:00Z') });
        expect(older.last_error).toBeUndefined();
    });
    it('follows its least fresh source (D9.9)', () => {
        const staleSource = freshnessOf({ promise: daily, lastSuccessAt: '2026-10-01T06:00:00Z', now: at('2026-11-02T07:00:00Z') });
        const freshSource = freshnessOf({ promise: daily, lastSuccessAt: '2026-11-02T06:00:00Z', now: at('2026-11-02T07:00:00Z') });
        const f = freshnessOf({
            promise: { ...daily, source: 'dataproduct' }, lastSuccessAt: '2026-11-02T06:00:00Z', now: at('2026-11-02T07:00:00Z'),
            sources: [{ package: 'pkg:a/fresh', freshness: freshSource }, { package: 'pkg:a/old', freshness: staleSource }],
        });
        expect(f.state).toBe('stale');
        expect(f.limited_by).toBe('pkg:a/old');
        expect(f.sources).toEqual([{ package: 'pkg:a/fresh', state: 'fresh' }, { package: 'pkg:a/old', state: 'stale' }]);
    });
    it('orders the states', () => {
        expect(worstOf('fresh', 'unscheduled')).toBe('unscheduled');
        expect(worstOf('late', 'unscheduled')).toBe('late');
        expect(worstOf('stale', 'fresh')).toBe('stale');
    });
    it('is stale when a promise has never been kept', () => {
        const f: Freshness = freshnessOf({ promise: daily, lastSuccessAt: null, now: at('2026-11-02T07:00:00Z') });
        expect(f.state).toBe('stale');
        expect(f.reason_code).toBe('promised-never-ran');
    });
});

describe('doomedVersions (retention)', () => {
    const h = (n: number) => String(n).repeat(64).slice(0, 64);
    // Newest first, the current one excluded.
    const ordered = [1, 2, 3, 4].map((n, i) => ({ hash: h(n), at: Date.parse('2026-10-20T00:00:00Z') - i * 86_400_000 }));
    it('keeps the newest N including the current one', () => {
        expect(doomedVersions(ordered, { keep: 2, unit: 'versions' }, Date.now(), new Set()).map(v => v.hash)).toEqual([h(2), h(3), h(4)]);
    });
    it('never removes a version a named share pins, and the pin takes no place in the count', () => {
        const doomed = doomedVersions(ordered, { keep: 2, unit: 'versions' }, Date.now(), new Set([h(3)])).map(v => v.hash);
        expect(doomed).not.toContain(h(3));
        expect(doomed).toEqual([h(2), h(4)]);
    });
    it('removes by age in months, a pinned one spared', () => {
        const now = Date.parse('2026-12-25T00:00:00Z');
        // The cutoff is 2026-10-26: every version is older, and the pinned one stays.
        expect(doomedVersions(ordered, { keep: 2, unit: 'months' }, now, new Set([h(4)])).map(v => v.hash)).toEqual([h(1), h(2), h(3)]);
        // In mid-November the cutoff is 2026-09-16 and nothing is old enough.
        expect(doomedVersions(ordered, { keep: 2, unit: 'months' }, Date.parse('2026-11-15T00:00:00Z'), new Set())).toEqual([]);
    });
});
