/**
 * @file test/unit/scheduler-run-limit.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A scheduled run that never returns ends at its time limit, and the job runs again.
 *
 *   WHY. Scheduler.executing was cleared only when the handler's promise settled, and nothing limited
 *   how long that took. A handler waiting on a query the database never answered held its job for
 *   the life of the process: every later fire was a `skipped` row saying "previous run still in
 *   progress", and the job row kept its last success. The refinery had the same shape: a batch that
 *   never finished answered every later start with itself.
 *
 *   Fault injection: a core handler whose promise never settles (and one that settles after the
 *   limit), with the limit shortened through setRunOptions; and a refinery batch whose promise never
 *   settles, with the clock moved past the stall limit.
 * @usage cd aimeat && pnpm exec vitest run test/unit/scheduler-run-limit.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit E4-04).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});
vi.mock('../../src/services/system-fault-report.js', () => ({ reportJobFault: vi.fn(async () => {}) }));

// The refinery batch itself is replaced: each call returns a promise the test settles, or never does.
const batches: Array<{ run: { status: string }; resolve: (v: unknown) => void }> = [];
vi.mock('../../src/services/refinery/pipeline.js', () => ({
    RefineryError: class RefineryError extends Error {},
    runBatch: vi.fn((_d: unknown, _c: unknown, _p: unknown, opts: { run: { status: string } }) =>
        new Promise((resolve) => { batches.push({ run: opts.run, resolve: () => resolve(opts.run) }); })),
}));

import { createStorage } from '../../src/storage/storage-factory.js';
import { Scheduler } from '../../src/services/scheduler.js';
import { withRunLimit, RunTimeoutError } from '../../src/services/scheduler-run-limit.js';
import { startRun, STALL_MS } from '../../src/services/refinery/runs.js';
import type { ScheduledJobRecord, Storage } from '../../src/storage/interface.js';

const SQLITE_PATH = `./test/.schedlimit-${process.pid}.db`;
const NODE = 'aimeat-sched-limit';
let storage: Storage;

beforeAll(async () => {
    storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
}, 60_000);

afterAll(async () => {
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
    }
});

afterEach(() => { vi.useRealTimers(); });

async function coreJob(handler: string): Promise<ScheduledJobRecord> {
    const now = new Date().toISOString();
    const record: ScheduledJobRecord = {
        id: `test:limit-${randomUUID()}`, name: 'hanging job', type: 'core', coreHandler: handler, cron: '0 0 1 1 *',
        enabled: true, createdBy: 'system', createdAt: now, updatedAt: now,
    };
    await storage.createScheduledJob(record);
    return record;
}

describe('withRunLimit', () => {
    it('rejects with RunTimeoutError when the work does not settle in time, and passes a timely result through', async () => {
        await expect(withRunLimit(new Promise(() => { /* never */ }), 30)).rejects.toBeInstanceOf(RunTimeoutError);
        await expect(withRunLimit(Promise.resolve(7), 1000)).resolves.toBe(7);
    });
});

describe('a scheduled run that never returns', () => {
    it('ends as an error after the limit, frees the job, and the next fire runs', async () => {
        const s = new Scheduler({ nodeId: NODE } as never, storage);
        s.setRunOptions({ runLimits: { core: 150 } });
        let calls = 0;
        s.registerCoreHandler('hang-once', () => { calls++; return calls === 1 ? new Promise<void>(() => { /* never */ }) : Promise.resolve(); });
        const job = await coreJob('hang-once');

        const first = await s.triggerNow(job.id);
        expect(first.code).toBe('error');
        expect(first.detail).toMatch(/stopped after/);
        const row = await storage.getScheduledJob(job.id);
        expect(row?.lastRunResult).toBe('error');
        expect(row?.lastRunError).toMatch(/did not finish/);

        const second = await s.triggerNow(job.id);
        expect(second.code, 'the job is free again, not "busy"').toBe('ran');
        expect(calls).toBe(2);
        expect((await storage.getScheduledJob(job.id))?.lastRunResult).toBe('success');
    });

    it('does not let a late result overwrite the recorded one', async () => {
        const s = new Scheduler({ nodeId: NODE } as never, storage);
        s.setRunOptions({ runLimits: { core: 100 } });
        s.registerCoreHandler('late', () => new Promise<void>((r) => setTimeout(r, 300)));
        const job = await coreJob('late');

        expect((await s.triggerNow(job.id)).code).toBe('error');
        await new Promise((r) => setTimeout(r, 450));
        const row = await storage.getScheduledJob(job.id);
        expect(row?.lastRunResult).toBe('error');
        expect(row?.runCount ?? 0).toBe(0);
    });
});

describe('a refinery batch that never finishes', () => {
    const caller = { ownerGhii: `alice@${NODE}`, owner: 'alice', principal: `alice@${NODE}`, roles: ['owner'], scopes: [], isOwner: true };

    it('is treated as stalled after the limit, so a new start begins a new run', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
        const deps = {} as never;
        const a = startRun(deps, caller as never, 'mailsort', {});
        expect(a.already).toBe(false);
        expect(startRun(deps, caller as never, 'mailsort', {}).already, 'a second start inside the limit gets the running one').toBe(true);

        vi.setSystemTime(new Date(Date.parse('2026-10-16T10:00:00Z') + STALL_MS + 1000));
        const b = startRun(deps, caller as never, 'mailsort', {});
        expect(b.already, 'a start after the stall limit is a new run').toBe(false);
        expect(b.run.id).not.toBe(a.run.id);
        expect(a.run.status).toBe('failed');
        expect(a.run.error).toMatch(/stalled/);

        // The stalled batch settles late: its result does not turn the failed run into done.
        batches[0].resolve(undefined);
        await a.done;
        expect(a.run.status).toBe('failed');
    });
});
