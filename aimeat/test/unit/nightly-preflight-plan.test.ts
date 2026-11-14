/**
 * @file test/unit/nightly-preflight-plan.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What `pnpm nightly:preflight` chooses to run: the reds read from a nightly's
 *   failed-job log, and the steps planned from those reds and the files changed since.
 * @version-history
 *   v1.1.0 — 2026-11-14 — No 4.0.0 steps; a red suite without the e2e- prefix is read too.
 *   v1.0.0 — 2026-11-14 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { redFromLog, planSteps } from '../../scripts/lib/nightly-preflight-plan.js';

// The shape `gh run view --log-failed` prints, from the 2026-11-14 run.
const LOG = [
    'sweep (sqlite)\tUNKNOWN STEP\t2026-11-14T12:10:16.8121456Z ✗ e2e-graceful-shutdown       4       1       0        5       5.28s     on        0',
    'sweep (sqlite)\tUNKNOWN STEP\t2026-11-14T12:10:16.8147740Z ##[error]e2e-graceful-shutdown',
    'sweep (sqlite)\tUNKNOWN STEP\t2026-11-14T12:10:16.8153558Z ##[error]4/5 passed',
    'sweep (sqlite)\tUNKNOWN STEP\t2026-11-14T12:10:16.8190642Z ##[error]Process completed with exit code 1.',
    'sweep (postgres-kysely)\tUNKNOWN STEP\t2026-11-14T12:10:16.8147740Z ##[error]federation-messages',
].join('\n');

describe('redFromLog', () => {
    it('reads the red suites per job, and nothing from the totals or the exit line', () => {
        const reds = redFromLog(LOG);
        expect(reds.get('sweep (sqlite)')).toEqual({ suites: ['e2e-graceful-shutdown'] });
        expect(reds.get('sweep (postgres-kysely)')).toEqual({ suites: ['federation-messages'] });
    });
});

describe('planSteps', () => {
    const base = { reds: redFromLog(LOG), failedJobs: ['sweep (sqlite)', 'sweep (postgres-kysely)'], changed: [] as string[], full: false };

    it('reruns a red sweep suite on its own backend only', () => {
        const steps = planSteps(base);
        expect(steps).toContainEqual(expect.objectContaining({ kind: 'e2e', backend: 'sqlite', suites: ['e2e-graceful-shutdown'] }));
        expect(steps).toContainEqual(expect.objectContaining({ kind: 'e2e', backend: 'postgres-kysely', suites: ['federation-messages'] }));
    });

    it('runs a changed suite on both backends, and not a helper', () => {
        const steps = planSteps({ ...base, reds: new Map(), failedJobs: [], changed: ['aimeat/test/e2e-mcp-v2.ts', 'aimeat/test/helpers/x.ts'] });
        expect(steps.map(s => s.kind === 'e2e' && `${s.backend}:${s.suites.join(',')}`)).toEqual(['sqlite:e2e-mcp-v2', 'postgres-kysely:e2e-mcp-v2']);
    });

    it('adds the upgrade test for a storage change and the pack start for a package change', () => {
        const steps = planSteps({ ...base, reds: new Map(), failedJobs: [], changed: ['aimeat/src/storage/providers/sqlite/index.ts', 'aimeat/package.json'] });
        expect(steps.filter(s => s.kind === 'upgrade')).toHaveLength(2);
        expect(steps.filter(s => s.kind === 'pack-smoke')).toHaveLength(1);
    });

    it('adds the whole unit suite, the upgrade test and the pack start with full', () => {
        const kinds = planSteps({ ...base, reds: new Map(), failedJobs: [], full: true }).map(s => s.kind);
        expect(kinds).toEqual(['unit', 'upgrade', 'upgrade', 'pack-smoke']);
    });

    it('plans nothing when the last nightly was green and nothing it reruns changed', () => {
        expect(planSteps({ ...base, reds: new Map(), failedJobs: [], changed: ['aimeat/src/routes/health.ts'] })).toEqual([]);
    });
});
