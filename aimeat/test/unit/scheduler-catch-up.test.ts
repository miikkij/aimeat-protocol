/**
 * @file test/unit/scheduler-catch-up.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A fire missed while the node was down is caught up or recorded, and shutdown stops
 *   the scheduler.
 *
 *   WHY. start() scheduled each job from its pattern and never read the stored next fire, so a fire
 *   that fell while the process was down was neither run nor recorded: a deploy at midnight skipped
 *   the daily allowance, a node down at 04:00 on the first had no compliance report for the month,
 *   and a person's daily schedule did not run without a word in its run list. The shutdown handler
 *   did not stop the scheduler or wait for a run in progress.
 *
 *   Fault injection with the real SQLite store: jobs whose stored nextRunAt is in the past at start
 *   (the node was down), a handler still running at shutdown, and a handler that never returns.
 * @usage cd aimeat && pnpm exec vitest run test/unit/scheduler-catch-up.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit E4-07).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});
vi.mock('../../src/services/system-fault-report.js', () => ({ reportJobFault: vi.fn(async () => {}) }));
vi.mock('../../src/services/notify.js', () => ({ notify: vi.fn(async () => ({ stored: true })) }));

import { createStorage } from '../../src/storage/storage-factory.js';
import { Scheduler } from '../../src/services/scheduler.js';
import { missedFire } from '../../src/services/scheduler-catch-up.js';
import type { ScheduledJobRecord, Storage } from '../../src/storage/interface.js';

const SQLITE_PATH = `./test/.schedcatch-${process.pid}.db`;
const NODE = 'aimeat-sched-catch';
let storage: Storage;
const created: string[] = [];

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

function record(extra: Partial<ScheduledJobRecord>): ScheduledJobRecord {
    const now = new Date().toISOString();
    return {
        id: `test:catch-${randomUUID()}`, name: 'job', type: 'core', cron: '0 0 * * *',
        enabled: true, createdBy: 'system', createdAt: now, updatedAt: now, ...extra,
    };
}

async function stored(extra: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord> {
    const r = record(extra);
    await storage.createScheduledJob(r);
    created.push(r.id);
    return r;
}

/** Remove every job of this file, so the next start() sees only the next test's jobs. */
async function clearJobs(): Promise<void> {
    while (created.length) await storage.deleteScheduledJob(created.pop()!).catch(() => false);
}

const now = new Date('2026-10-16T10:00:00Z');
const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000).toISOString();

describe('missedFire', () => {
    it('catches up a daily core job, records a user schedule, and leaves the rest alone', () => {
        expect(missedFire(record({ cron: '0 0 * * *', timezone: 'UTC', nextRunAt: twoDaysAgo }), now)).toEqual({ action: 'run', fireAt: '2026-10-16T00:00:00.000Z' });
        expect(missedFire(record({ cron: '0 4 1 * *', nextRunAt: '2026-10-01T04:00:00.000Z' }), now)?.action, 'monthly').toBe('run');
        expect(missedFire(record({ cron: '*/5 * * * *', nextRunAt: twoDaysAgo }), now), 'a core job every 5 minutes').toBeNull();
        expect(missedFire(record({ type: 'ai', cron: '0 7 * * *', nextRunAt: twoDaysAgo }), now)?.action).toBe('record');
        expect(missedFire(record({ nextRunAt: '2026-10-17T00:00:00.000Z' }), now), 'next fire still ahead').toBeNull();
        expect(missedFire(record({ nextRunAt: twoDaysAgo, lastRunAt: twoDaysAgo }), now), 'it ran; only the next time was not written').toBeNull();
        expect(missedFire(record({}), now), 'never scheduled').toBeNull();
    });
});

describe('start() with a fire missed while the node was down', () => {
    it('runs a daily core job once and writes one "missed" row for a user schedule', async () => {
        const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
        const daily = await stored({ coreHandler: 'count-daily', cron: '0 0 * * *', nextRunAt: past });
        const user = await stored({ type: 'refinery', ownerScope: `alice@${NODE}`, cron: '0 7 * * *', nextRunAt: past, input: { prefix: 'p' } });
        const s = new Scheduler({ nodeId: NODE } as never, storage);
        s.setRunOptions({ catchUpDelayMs: 0 });
        let dailyRuns = 0;
        let userRuns = 0;
        s.registerCoreHandler('count-daily', async () => { dailyRuns++; });
        s.registerKindExecutor('refinery', async () => { userRuns++; return { reads: [], writes: [] }; });
        try {
            await s.start();
            await new Promise((r) => setTimeout(r, 1000));
        } finally {
            s.stop();
        }
        expect(dailyRuns, 'one catch-up run, however many fires were missed').toBe(1);
        expect(userRuns, 'a user schedule is not run late').toBe(0);
        const logs = await storage.listExecutionLogs({ jobId: user.id });
        expect(logs).toHaveLength(1);
        expect(logs[0].result).toBe('skipped');
        expect(logs[0].errorMessage).toMatch(/^Missed:/);
        expect((await storage.getScheduledJob(daily.id))?.lastRunResult).toBe('success');

        // A second process (or a restart) on the same database does not catch the same fire up again.
        await storage.updateScheduledJob(daily.id, { nextRunAt: past, lastRunAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
        await storage.updateScheduledJob(user.id, { nextRunAt: past });
        const again = new Scheduler({ nodeId: `${NODE}-b` } as never, storage);
        again.setRunOptions({ catchUpDelayMs: 0 });
        again.registerCoreHandler('count-daily', async () => { dailyRuns++; });
        again.registerKindExecutor('refinery', async () => { userRuns++; return { reads: [], writes: [] }; });
        try {
            await again.start();
            await new Promise((r) => setTimeout(r, 1000));
        } finally {
            again.stop();
        }
        expect(dailyRuns, 'the claim keeps it to one').toBe(1);
        expect(await storage.listExecutionLogs({ jobId: user.id })).toHaveLength(1);
        await clearJobs();
    }, 15_000);
});

describe('shutdown()', () => {
    it('stops the crons, waits for a run in progress, and records a run it could not wait for', async () => {
        const s = new Scheduler({ nodeId: NODE } as never, storage);
        let ticks = 0;
        let slowDone = false;
        s.registerCoreHandler('tick', async () => { ticks++; });
        s.registerCoreHandler('slow', () => new Promise<void>((r) => setTimeout(() => { slowDone = true; r(); }, 200)));
        s.registerCoreHandler('never', () => new Promise<void>(() => { /* never */ }));
        const tick = await stored({ coreHandler: 'tick', cron: '* * * * * *' });
        const slow = await stored({ coreHandler: 'slow', cron: '0 0 1 1 *' });
        const never = await stored({ coreHandler: 'never', cron: '0 0 1 1 *' });
        s.addJob(tick);

        void s.triggerNow(slow.id);
        void s.triggerNow(never.id);
        await new Promise((r) => setTimeout(r, 50));
        const unfinished = await s.shutdown(600);

        expect(slowDone, 'the run in progress was waited for').toBe(true);
        expect(unfinished).toEqual([never.id]);
        const cut = await storage.listExecutionLogs({ jobId: never.id });
        expect(cut).toHaveLength(1);
        expect(cut[0].result).toBe('error');
        expect(cut[0].errorMessage).toMatch(/shut down/);

        const before = ticks;
        await new Promise((r) => setTimeout(r, 1500));
        expect(ticks, 'no fire after shutdown').toBe(before);
        await clearJobs();
    }, 15_000);
});
