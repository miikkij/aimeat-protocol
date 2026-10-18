/**
 * @file test/unit/atomic-once-jobs.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two runs at the same moment of the budget alert and of a refinery batch, the two G4
 *   sites of the atomic-write fixes (2026-10-18) that reach outside storage: each test fires them
 *   together against a real storage of both providers, with reads answering late (slow-reads.ts).
 *
 *   WHAT IS A STAND-IN. The budget status (ledger-budget.ts) and the notification send (notify.ts),
 *   and for the refinery the mailbox (connections/read.ts, connections/access.ts) and the row store's
 *   lookup (workspace-rows/row-service.ts readRow): the questions asked are how many alerts go out and
 *   how many times a page of mail is read, and those are what the stand-ins count. Every message read
 *   fails, so a batch files nothing and calls no model.
 *
 *   Runs on SQLite in memory, and on PostgreSQL too when DATABASE_URL is set (names carry a run tag).
 * @usage cd aimeat && pnpm exec vitest run test/unit/atomic-once-jobs.test.ts
 * @version-history
 *   2026-10-18 — Initial (atomic-write fixes, group G4).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { slowReads } from './slow-reads.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import { evaluateBudgetAlerts } from '../../src/services/ledger-budget-alerts.js';
import { runBatch, type RunState } from '../../src/services/refinery/pipeline.js';

requirePostgresWhenAsked('atomic-once-jobs');

const h = vi.hoisted(() => ({ alerts: 0, messageReads: 0 }));
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

vi.mock('../../src/services/ledger-budget.js', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getOwnerBudgetStatus: async () => ({ dailyBudgetUsd: 1, level: 'over', date: '2026-10-18', spentUsd: 1.5, topConsumers: [] }),
}));
vi.mock('../../src/services/notify.js', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    notify: async () => { h.alerts += 1; await sleep(5); },
}));
vi.mock('../../src/services/connections/read.js', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    readResource: async (_ctx: unknown, _id: string, resource: string) => {
        await sleep(5);
        if (resource === 'messages') return { ok: true, data: { messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'page-2' } };
        h.messageReads += 1;
        return { ok: false, code: 'UPSTREAM_DOWN', status: 502, message: 'the mailbox stand-in refuses every message' };
    },
}));
vi.mock('../../src/services/connections/access.js', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    requireOwnConnection: async () => true,
}));
vi.mock('../../src/services/workspace-rows/row-service.js', async (importOriginal) => {
    const { WorkspaceRowError } = await import('../../src/services/workspace-rows/row-space.js');
    return {
        ...(await importOriginal<object>()),
        readRow: async () => { throw new WorkspaceRowError('NOT_FOUND', 404, 'no such row'); },
    };
});

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
beforeAll(async () => {
    for (const name of names) providers.set(name, await createStorage({
        provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
        sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
    }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const s of providers.values()) await s.close(); });

const { config: baseConfig } = loadConfig({});
const config = { ...baseConfig, encryptionKey: 'ab'.repeat(32) };

function newRun(prefix: string): RunState {
    return {
        id: randomUUID(), prefix, status: 'running', startedAt: new Date().toISOString(), n: 0, i: 0, step: '', subject: '',
        counts: { seen: 0, clear: 0, unclear: 0, bad: 0, skip: 0, skipped_seen: 0 }, rows: [], by: 'owner',
    } as RunState;
}

describe.each(names)('%s: two runs at the same moment', provider => {
    const real = () => providers.get(provider)!;
    const tag = () => randomUUID().slice(0, 8);

    it('evaluateBudgetAlerts: two usage events over the budget send one alert', async () => {
        const owner = `budget-${tag()}@n`;
        const { storage: s } = slowReads(real());
        h.alerts = 0;
        await Promise.all([evaluateBudgetAlerts(s, owner), evaluateBudgetAlerts(s, owner)]);
        expect(h.alerts).toBe(1);
    });

    async function definition(): Promise<{ owner: string; prefix: string; caller: Parameters<typeof runBatch>[1] }> {
        const name = `refine${tag()}`;
        const owner = `${name}@${config.nodeId}`;
        const prefix = `refinery-${tag()}`;
        const now = new Date().toISOString();
        await real().setMemory({
            key: `${prefix}.config`, ownerGaii: owner, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
            value: { connectionId: 'conn-1', provider: 'google', since: '2026-01-01', organismId: 'org-1', workspaceId: 'ws-1' },
        });
        return { owner, prefix, caller: { ownerGhii: owner, owner: name, principal: owner, roles: ['owner'], scopes: [], isOwner: true } };
    }

    it('runBatch: two batches on one cursor read the page of mail once', async () => {
        const { prefix, caller } = await definition();
        const { storage: s } = slowReads(real());
        h.messageReads = 0;
        const out = await Promise.allSettled([
            runBatch({ storage: s, config }, caller, prefix, { run: newRun(prefix) }),
            runBatch({ storage: s, config }, caller, prefix, { run: newRun(prefix) }),
        ]);
        expect(h.messageReads).toBe(2);
        const codes = out.map(r => (r.status === 'rejected' ? (r.reason as { code?: string }).code : 'ok')).sort();
        expect(codes).toEqual(['BATCH_BUSY', 'BATCH_FAILED']);
        // Every message failed, so the cursor is where it was: the next batch reads the same page.
        const cursor = await real().getMemory(caller.ownerGhii, `${prefix}.cursor`);
        expect((cursor?.value as { page?: string } | undefined)?.page ?? '').toBe('');
    });

    it('runBatch: two batches that finish at once both stay in the run history', async () => {
        const { prefix, caller } = await definition();
        const { storage: s } = slowReads(real());
        const a = newRun(prefix), b = newRun(prefix);
        await Promise.allSettled([
            runBatch({ storage: s, config }, caller, prefix, { run: a, messageIds: ['m1'] }),
            runBatch({ storage: s, config }, caller, prefix, { run: b, messageIds: ['m2'] }),
        ]);
        const runs = await real().getMemory(caller.ownerGhii, `${prefix}.runs`);
        expect((runs?.value as Array<{ id: string }>).map(r => r.id).sort()).toEqual([a.id, b.id].sort());
    });
});
