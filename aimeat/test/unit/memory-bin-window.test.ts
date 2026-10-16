/**
 * @file test/unit/memory-bin-window.test.ts
 * @description The two clocks of the memory bin, without a database: when a binned record's grace
 *   window has closed (pastGraceWindow, which restoreMemoryRecord asks), and the cutoff the sweep
 *   hands the provider (sweepMemoryBin) for a grace of 7, a grace of 0, a grace that is not a
 *   number, and a provider that throws. The provider queries themselves run on both backends in
 *   test/e2e-memory-bin-purge.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/memory-bin-window.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F05a-02).
 */
import { describe, it, expect } from 'vitest';
import { pastGraceWindow } from '../../src/services/memory-bin.js';
import { sweepMemoryBin } from '../../src/services/memory-bin-sweep.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-16T12:00:00.000Z');

describe('pastGraceWindow', () => {
    it('a record deleted six days ago is inside a seven-day window, eight days ago is past it', () => {
        expect(pastGraceWindow(new Date(NOW - 6 * DAY).toISOString(), 7, NOW)).toBe(false);
        expect(pastGraceWindow(new Date(NOW - 8 * DAY).toISOString(), 7, NOW)).toBe(true);
    });

    it('the window closes at exactly the grace, not a moment later', () => {
        expect(pastGraceWindow(new Date(NOW - 7 * DAY).toISOString(), 7, NOW)).toBe(true);
        expect(pastGraceWindow(new Date(NOW - 7 * DAY + 1).toISOString(), 7, NOW)).toBe(false);
    });

    it('a grace of 0 is an immediate, final delete', () => {
        expect(pastGraceWindow(new Date(NOW).toISOString(), 0, NOW)).toBe(true);
    });

    it('an unreadable date or grace leaves the record restorable: the sweep removes rows, not this check', () => {
        expect(pastGraceWindow(null, 7, NOW)).toBe(false);
        expect(pastGraceWindow('not a date', 7, NOW)).toBe(false);
        expect(pastGraceWindow(new Date(NOW - 30 * DAY).toISOString(), Number.NaN, NOW)).toBe(false);
    });
});

describe('sweepMemoryBin', () => {
    const stub = (impl: (cutoff: string) => Promise<number>) => {
        const seen: string[] = [];
        const storage = { purgeDeletedMemory: async (c: string) => { seen.push(c); return impl(c); } } as unknown as Storage;
        return { storage, seen };
    };
    const cfg = (days: number) => ({ memoryDeleteGraceDays: days }) as AimeatConfig;

    it('with a grace of 7, the cutoff is seven days back and the count is returned', async () => {
        const { storage, seen } = stub(async () => 3);
        const before = Date.now();
        expect(await sweepMemoryBin(storage, cfg(7))).toBe(3);
        const cutoff = Date.parse(seen[0]!);
        expect(cutoff).toBeGreaterThanOrEqual(before - 7 * DAY - 5);
        expect(cutoff).toBeLessThanOrEqual(Date.now() - 7 * DAY + 5);
    });

    it('with a grace of 0, the cutoff is now', async () => {
        const { storage, seen } = stub(async () => 1);
        const before = Date.now();
        await sweepMemoryBin(storage, cfg(0));
        expect(Date.parse(seen[0]!)).toBeGreaterThanOrEqual(before - 5);
    });

    it('a grace that is not a number removes nothing and does not throw', async () => {
        const { storage, seen } = stub(async () => 99);
        await expect(sweepMemoryBin(storage, cfg(Number.NaN))).resolves.toBe(0);
        expect(seen).toEqual([]);
    });

    it('a provider that throws is logged and counted as nothing removed', async () => {
        const { storage } = stub(async () => { throw new Error('database gone'); });
        await expect(sweepMemoryBin(storage, cfg(7))).resolves.toBe(0);
    });
});
