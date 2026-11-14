/**
 * @file test/unit/nightly-preflight-plan.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What `pnpm nightly:preflight` chooses to run: the reds read from a nightly's
 *   failed-job log, and the steps planned from those reds and the files changed since.
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { redFromLog, planSteps } from '../../scripts/lib/nightly-preflight-plan.js';

// The shape `gh run view --log-failed` prints, ANSI codes included, from the 2026-11-14 run.
const LOG = [
    'sweep (sqlite)\tUNKNOWN STEP\t2026-11-14T12:10:16.8121456Z ✗ e2e-graceful-shutdown       4       1       0        5       5.28s     on        0',
    'sweep (sqlite)\tUNKNOWN STEP\t2026-11-14T12:10:16.8147740Z ##[error]e2e-graceful-shutdown',
    'sweep (sqlite)\tUNKNOWN STEP\t2026-11-14T12:10:16.8153558Z ##[error]4/5 passed',
    'release-4-0-0\tUNKNOWN STEP\t2026-11-14T11:43:39.9072225Z ^[[41m^[[1m FAIL ^[[22m^[[49m ^[[30m^[[42m unit ^[[49m^[[39m test/unit/security-gates-fail.test.ts^[[2m > ^[[22mcheck:browser-libs > passes',
    'release-4-0-0\tUNKNOWN STEP\t2026-11-14T11:43:39.9074643Z AssertionError: expected 1 to be +0',
].join('\n');

describe('redFromLog', () => {
    it('reads the red suites and the red unit files per job, and nothing from the totals', () => {
        const reds = redFromLog(LOG);
        expect(reds.get('sweep (sqlite)')).toEqual({ suites: ['e2e-graceful-shutdown'], unitFiles: [] });
        expect(reds.get('release-4-0-0')).toEqual({ suites: [], unitFiles: ['test/unit/security-gates-fail.test.ts'] });
    });
});

describe('planSteps', () => {
    const base = { reds: redFromLog(LOG), failedJobs: ['sweep (sqlite)', 'release-4-0-0'], changed: [] as string[], versionAware: ['e2e-mcp-v2'], full: false };

    it('reruns a red sweep suite on its own backend and a red unit file as 4.0.0', () => {
        const steps = planSteps(base);
        expect(steps).toContainEqual(expect.objectContaining({ kind: 'e2e', backend: 'sqlite', suites: ['e2e-graceful-shutdown'] }));
        expect(steps).toContainEqual(expect.objectContaining({ kind: 'unit', files: ['test/unit/security-gates-fail.test.ts'], version: '4.0.0' }));
        expect(steps.some(s => s.kind === 'e2e' && s.backend === 'postgres-kysely')).toBe(false);
    });

    it('runs a changed suite on both backends, and as 4.0.0 when it is version-aware', () => {
        const steps = planSteps({ ...base, reds: new Map(), failedJobs: [], changed: ['aimeat/test/e2e-mcp-v2.ts', 'aimeat/test/helpers/x.ts'] });
        expect(steps.filter(s => s.kind === 'e2e' && !s.version).map(s => s.kind === 'e2e' && s.backend)).toEqual(['sqlite', 'postgres-kysely']);
        expect(steps).toContainEqual(expect.objectContaining({ kind: 'e2e', backend: 'sqlite', suites: ['e2e-mcp-v2'], version: '4.0.0' }));
    });

    it('adds the upgrade test for a storage change and the pack start for a package change', () => {
        const steps = planSteps({ ...base, reds: new Map(), failedJobs: [], changed: ['aimeat/src/storage/providers/sqlite/index.ts', 'aimeat/package.json'] });
        expect(steps.filter(s => s.kind === 'upgrade')).toHaveLength(2);
        expect(steps.filter(s => s.kind === 'pack-smoke')).toHaveLength(1);
    });

    it('plans nothing when the last nightly was green and nothing it reruns changed', () => {
        expect(planSteps({ ...base, reds: new Map(), failedJobs: [], changed: ['aimeat/src/routes/health.ts'] })).toEqual([]);
    });
});
