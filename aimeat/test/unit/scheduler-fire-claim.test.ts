/**
 * @file test/unit/scheduler-fire-claim.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One cron fire of a scheduled job runs once, however many node processes share the
 *   database.
 *
 *   WHY. On aimeat.io the workflow laimeat-sanomat-evening started two runs per fire on 2026-10-02
 *   (1 ms apart) and 2026-10-03 (15 ms apart), and each run dispatched its own tasks; earlier
 *   workflows did the same on 2026-08-18 and 2026-08-31. There is one schedule record, and one
 *   process cannot start a second run of a job it is already running (the `executing` guard is set
 *   before any wait for a job with no constraints), so two processes fired it. Every process starts
 *   its own scheduler, and nothing coordinated them. Now each cron fire is claimed in the database
 *   (`claimScheduledFire`, a conditional update of ScheduledJob.lastFireAt) before it runs, and the
 *   process that loses the claim does not run it.
 *
 *   Two parts: the claim itself on both providers (Postgres when DATABASE_URL is set), and two
 *   schedulers over ONE store, which is what two processes on one database are.
 * @usage cd aimeat && pnpm exec vitest run test/unit/scheduler-fire-claim.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-04 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});

import { createStorage } from '../../src/storage/storage-factory.js';
import { Scheduler } from '../../src/services/scheduler.js';
import type { ScheduledJobRecord, Storage } from '../../src/storage/interface.js';

const SQLITE_PATH = `./test/.fireclaim-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
    provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
    if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
}, 60_000);

const created: Array<{ storage: Storage; id: string }> = [];

afterAll(async () => {
    for (const { storage, id } of created) await storage.deleteScheduledJob(id).catch(() => false);
    for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
    }
});

function job(cron: string, extra: Partial<ScheduledJobRecord> = {}): ScheduledJobRecord {
    const now = new Date().toISOString();
    return {
        id: `test:fire-claim-${randomUUID()}`, name: 'fire claim', type: 'core', coreHandler: 'count',
        cron, enabled: true, createdBy: 'system', createdAt: now, updatedAt: now, ...extra,
    };
}

async function stored(storage: Storage, record: ScheduledJobRecord): Promise<ScheduledJobRecord> {
    await storage.createScheduledJob(record);
    created.push({ storage, id: record.id });
    return record;
}

describe('the harness itself', () => {
    it('runs postgres whenever DATABASE_URL is set', () => {
        expect(provs.map(p => p.name)).toContain('sqlite');
        if (PG_URL) expect(provs.map(p => p.name)).toContain('postgres-kysely');
    });
});

describe('claimScheduledFire', () => {
    it('claims a fire once, refuses the same or an earlier fire, and takes a later one', async () => {
        for (const { name, storage } of provs) {
            const r = await stored(storage, job('17 0 * * *'));
            const t1 = '2026-10-02T21:17:00.000Z';
            expect(await storage.claimScheduledFire(r.id, t1), `${name}: first claim`).toBe(true);
            expect(await storage.claimScheduledFire(r.id, t1), `${name}: same fire again`).toBe(false);
            expect(await storage.claimScheduledFire(r.id, '2026-10-01T21:17:00.000Z'), `${name}: an earlier fire`).toBe(false);
            expect(await storage.claimScheduledFire(r.id, '2026-10-03T21:17:00.000Z'), `${name}: the next fire`).toBe(true);
            expect(await storage.claimScheduledFire(`missing-${randomUUID()}`, t1), `${name}: no such job`).toBe(false);
        }
    });

    it('is not undone by an ordinary update of the job', async () => {
        for (const { name, storage } of provs) {
            const r = await stored(storage, job('17 0 * * *'));
            const t1 = '2026-10-02T21:17:00.000Z';
            expect(await storage.claimScheduledFire(r.id, t1)).toBe(true);
            await storage.updateScheduledJob(r.id, { lastRunAt: new Date().toISOString(), runCount: 1 });
            expect(await storage.claimScheduledFire(r.id, t1), `${name}: claim survives an update`).toBe(false);
        }
    });
});

describe('two schedulers on one database', () => {
    it('run each fire of a shared job once', async () => {
        const storage = provs[0].storage;
        const record = await stored(storage, job('* * * * * *'));
        const ran: Array<{ node: string; second: number }> = [];
        const schedulers: Scheduler[] = [];
        for (const node of ['aimeat-claim-node-a', 'aimeat-claim-node-b']) {
            const s = new Scheduler({ nodeId: node } as never, storage);
            s.registerCoreHandler('count', async () => { ran.push({ node, second: Math.floor(Date.now() / 1000) }); });
            s.addJob({ ...record });
            schedulers.push(s);
        }
        try {
            await new Promise(r => setTimeout(r, 3_500));
        } finally {
            for (const s of schedulers) s.stop();
        }
        const seconds = ran.map(r => r.second);
        expect(ran.length, 'the job fired at all').toBeGreaterThanOrEqual(2);
        expect(new Set(seconds).size, `one run per fire, got ${JSON.stringify(ran)}`).toBe(seconds.length);
    }, 10_000);
});
