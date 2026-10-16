/**
 * @file test/unit/scheduler-failures.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A failed scheduled run tells somebody, and a schedule that keeps failing stops.
 *
 *   WHY. A core job that failed left a log line and an error on its row and told nobody: the only
 *   message was a web push to the job's owner, and a core job has none. A user schedule sent that
 *   push only when push was configured, never a bell entry, and kept failing at its cadence with no
 *   limit. A core job whose handler is not registered (consent turned off after seeding) failed every
 *   ten minutes and buried real failures in the same list.
 *
 *   Fault injection with the real SQLite store: a core handler that throws, a refinery executor that
 *   throws, and a core job whose handler was never registered. The operator's message channel
 *   (message-send) and the bell (notify) are replaced by recorders.
 * @usage cd aimeat && pnpm exec vitest run test/unit/scheduler-failures.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit E4-03).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});

const sent: Array<{ subject: string; kind?: string; body: string }> = [];
vi.mock('../../src/services/message-send.js', () => ({
    sendDirectMessage: vi.fn(async (_deps: unknown, msg: { subject: string; kind?: string; body: string }) => { sent.push(msg); return {}; }),
}));
vi.mock('../../src/services/operators.js', () => ({
    findOperatorGhii: vi.fn(async () => 'op@aimeat-sched-fail'),
    listOperatorGhiis: vi.fn(async () => ['op@aimeat-sched-fail']),
}));
const bell: Array<{ to: string; type: string; title: string }> = [];
vi.mock('../../src/services/notify.js', () => ({
    notify: vi.fn(async (_s: unknown, to: string, input: { type: string; title: string }) => { bell.push({ to, type: input.type, title: input.title }); return { stored: true }; }),
}));

import { createStorage } from '../../src/storage/storage-factory.js';
import { Scheduler } from '../../src/services/scheduler.js';
import { MAX_CONSECUTIVE_FAILURES } from '../../src/services/scheduler-failures.js';
import type { ScheduledJobRecord, Storage } from '../../src/storage/interface.js';

const SQLITE_PATH = `./test/.schedfail-${process.pid}.db`;
const NODE = 'aimeat-sched-fail';
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

beforeEach(() => { sent.length = 0; bell.length = 0; });

async function stored(extra: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord> {
    const now = new Date().toISOString();
    const record: ScheduledJobRecord = {
        id: `test:fail-${randomUUID()}`, name: 'failing job', type: 'core', cron: '0 0 1 1 *',
        enabled: true, createdBy: 'system', createdAt: now, updatedAt: now, ...extra,
    };
    await storage.createScheduledJob(record);
    return record;
}

describe('a core job that fails', () => {
    it('records the error and tells the operator once per window, however often it fails', async () => {
        const job = await stored({ type: 'core', coreHandler: 'boom' });
        const s = new Scheduler({ nodeId: NODE } as never, storage);
        s.registerCoreHandler('boom', async () => { throw new Error('the table is gone'); });

        const first = await s.triggerNow(job.id);
        const second = await s.triggerNow(job.id);

        expect(first.code).toBe('error');
        expect(second.code).toBe('error');
        const row = await storage.getScheduledJob(job.id);
        expect(row?.lastRunResult).toBe('error');
        expect(row?.lastRunError).toContain('the table is gone');
        const logs = await storage.listExecutionLogs({ jobId: job.id });
        expect(logs.map(l => l.result)).toEqual(['error', 'error']);
        expect(sent, 'one operator message for two failures in the window').toHaveLength(1);
        expect(sent[0].kind).toBe('system-fault');
        expect(sent[0].subject).toContain(job.id);
        expect(sent[0].body).toContain('the table is gone');
        expect(row?.enabled, 'a core job is never paused here').toBe(true);
    });
});

describe('a user schedule that fails', () => {
    it('tells its owner in the bell on the first failure, then pauses after the limit and says so', async () => {
        const owner = `alice@${NODE}`;
        const job = await stored({ type: 'refinery', ownerScope: owner, displayName: 'Mail sort', input: { prefix: 'x' } });
        const s = new Scheduler({ nodeId: NODE } as never, storage);
        s.registerKindExecutor('refinery', async () => { throw new Error('the mailbox refused'); });

        await s.triggerNow(job.id);
        expect(bell).toEqual([{ to: owner, type: 'schedule_failed', title: 'Schedule "Mail sort" failed' }]);

        for (let i = 2; i < MAX_CONSECUTIVE_FAILURES; i++) await s.triggerNow(job.id);
        expect(bell, 'no bell entry for every repeat of the same failure').toHaveLength(1);
        expect((await storage.getScheduledJob(job.id))?.enabled).toBe(true);

        await s.triggerNow(job.id);
        const row = await storage.getScheduledJob(job.id);
        expect(row?.enabled, `paused after ${MAX_CONSECUTIVE_FAILURES} failures in a row`).toBe(false);
        expect(bell.map(b => b.type)).toEqual(['schedule_failed', 'schedule_paused']);
        expect(sent, 'a user schedule is not an operator fault').toHaveLength(0);
    });

    it('starts the count again after a success', async () => {
        const owner = `bob@${NODE}`;
        const job = await stored({ type: 'refinery', ownerScope: owner, input: { prefix: 'y' } });
        const s = new Scheduler({ nodeId: NODE } as never, storage);
        let fail = true;
        s.registerKindExecutor('refinery', async () => { if (fail) throw new Error('flaky'); return { reads: [], writes: [] }; });

        for (let i = 1; i < MAX_CONSECUTIVE_FAILURES; i++) await s.triggerNow(job.id);
        fail = false;
        await s.triggerNow(job.id);
        fail = true;
        for (let i = 1; i < MAX_CONSECUTIVE_FAILURES; i++) await s.triggerNow(job.id);
        expect((await storage.getScheduledJob(job.id))?.enabled).toBe(true);
        expect(bell.map(b => b.type), 'a new run of failures is told once more').toEqual(['schedule_failed', 'schedule_failed']);
    });
});

describe('a core job whose handler is not registered', () => {
    it('is skipped without an error row, a fault message or a change to its row', async () => {
        const job = await stored({ type: 'core', coreHandler: 'consent-expiry-off' });
        const s = new Scheduler({ nodeId: NODE } as never, storage);

        const a = await s.triggerNow(job.id);
        await s.triggerNow(job.id);

        expect(a.code).toBe('error');
        expect(a.detail).toContain('turned off');
        expect(await storage.listExecutionLogs({ jobId: job.id })).toHaveLength(0);
        expect(sent).toHaveLength(0);
        const row = await storage.getScheduledJob(job.id);
        expect(row?.lastRunResult).toBeUndefined();
    });
});
