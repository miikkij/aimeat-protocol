/**
 * @file test/unit/scheduler-compliance-catch-up.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The monthly compliance job decides by the months already stored, so a late run makes
 *   up the month it owes and a second run does not double a month.
 *
 *   WHY. The job reported "the month before today". Fired on the first it was right; a node down at
 *   04:00 on the first had no report for that month until somebody pressed Run now in the same month,
 *   and the scheduler's catch-up at start (scheduler-catch-up.ts) would have written the same month
 *   again and told the operators twice.
 * @usage cd aimeat && pnpm exec vitest run test/unit/scheduler-compliance-catch-up.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit E4-07).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const told: string[] = [];
const written: string[] = [];
let storedReports: Array<{ id: string; kind: 'monthly' | 'manual'; generated_at: string }> = [];

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});
vi.mock('../../src/services/notify.js', () => ({
    notify: vi.fn(async (_s: unknown, _to: string, input: { title: string }) => { told.push(input.title); return {}; }),
}));
vi.mock('../../src/services/compliance-report.js', () => ({
    buildComplianceReport: vi.fn(async () => ({ gaps: [], register: { usecases: [] } })),
}));
vi.mock('../../src/services/compliance-register.js', () => ({
    writeStoredReport: vi.fn(async (_s: unknown, _n: string, id: string) => { written.push(id); }),
    snapshotIdFor: vi.fn(() => 'x'),
    listStoredReports: vi.fn(async () => storedReports),
}));

const { runComplianceMonthlyReport, monthsOwed } = await import('../../src/services/compliance-monthly-job.js');

const storage = { listOwners: async () => [{ name: 'op', roles: ['owner', 'operator'] }] } as unknown as Storage;
const config = { nodeId: 'node-test' } as AimeatConfig;
const at = (iso: string) => ({ id: iso, kind: 'monthly' as const, generated_at: '2026-01-01T00:00:00Z' });

beforeEach(() => { told.length = 0; written.length = 0; storedReports = []; });

describe('monthsOwed', () => {
    it('owes the months after the newest stored one, at most three, and only the target on a new node', () => {
        expect(monthsOwed('2026-09', null)).toEqual(['2026-09']);
        expect(monthsOwed('2026-09', '2026-09')).toEqual([]);
        expect(monthsOwed('2026-09', '2026-07')).toEqual(['2026-08', '2026-09']);
        expect(monthsOwed('2026-01', '2025-11')).toEqual(['2025-12', '2026-01']);
        expect(monthsOwed('2026-09', '2025-01')).toEqual(['2026-07', '2026-08', '2026-09']);
    });
});

describe('runComplianceMonthlyReport', () => {
    it('makes up the month it owes when it runs late in the month', async () => {
        storedReports = [at('2026-08')];
        const r = await runComplianceMonthlyReport(config, storage, new Date('2026-10-09T12:00:00Z'));
        expect(r.month).toBe('2026-09');
        expect(written).toEqual(['2026-09']);
        expect(told).toEqual(['Compliance report for 2026-09 is ready']);
    });

    it('does not write or announce a month already reported', async () => {
        storedReports = [{ id: '2026-10-05-1200', kind: 'manual', generated_at: '' }, at('2026-09')];
        const r = await runComplianceMonthlyReport(config, storage, new Date('2026-10-02T04:00:00Z'));
        expect(r.written).toEqual([]);
        expect(written).toEqual([]);
        expect(told).toEqual([]);
    });
});
