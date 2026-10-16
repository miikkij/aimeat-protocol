/**
 * @file test/unit/replication-queue-parity.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The federation replication queue answers the same on both providers: the payload
 *   comes back decoded, the depth counts only the rows not yet sent (status pending), and a prune
 *   removes aged rows and sent rows.
 *
 *   WHY. e2e-federation-settlements-sync ran its nodes on SQLite until 2026-10-16. On its first
 *   PostgreSQL run three assertions failed: PostgreSQL counted only pending rows, returned the payload
 *   as JSON text, and kept sent rows through a prune (QA audit P1-02). The PostgreSQL half fails on
 *   postgres-kysely/methods/system-extras.ts v1.0.0. PostgreSQL runs when DATABASE_URL is set
 *   (scripts/test-unit-postgres.ts in CI and pnpm gate), SQLite always.
 * @version-history
 *   2026-10-16 — The process runs in Europe/Helsinki for this file, a row reads back with the time it was
 *     queued, and a prune one hour back keeps a fresh pending row. On PostgreSQL the creation time was
 *     written as UTC wall time and read as local time, so on a machine east of UTC a prune with a short
 *     cutoff deleted rows queued a moment before (fails on postgres-kysely system-extras.ts v1.1.0).
 *   2026-10-16 — The depth counts only pending rows on both providers: a sent row and a failed row are
 *     not waiting to go, and the throttle in services/sync-health.ts reads the depth as the backlog. The
 *     test asserted every row (decision 2026-10-16; it fails on system-extras.ts as of 2b41d0c03).
 *   2026-10-16 — Initial (QA audit P1-02).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';

requirePostgresWhenAsked('replication-queue-parity');

// A clock zone east of UTC, whatever the machine's: the PostgreSQL defect below only shows there.
// Restored in afterAll, because the worker process may run other files after this one.
const previousTz = process.env.TZ;
process.env.TZ = 'Europe/Helsinki';

type TestStorage = Storage & { close?(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])] as const;
const providers = new Map<string, TestStorage>();

beforeAll(async () => {
    for (const name of names) {
        providers.set(name, await createStorage({
            provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely', sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
        }) as TestStorage);
    }
}, 180_000);
afterAll(async () => {
    for (const s of providers.values()) await s.close?.();
    if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz;
});

describe.each(names)('the replication queue on %s', name => {
    it('decodes the payload, counts only pending rows, and prunes aged and sent rows', async () => {
        const s = providers.get(name)!;
        const peer = `peer-${randomUUID().slice(0, 8)}`;
        // A shared PostgreSQL database may hold rows from other tests: work relative to the start.
        const start = await s.replicationQueueSize();
        const a = await s.enqueueReplication({ type: 'memory_replicate', payload: { gaii: 'a@n', key: 'k.shared' }, targetPeers: [peer], createdAt: new Date().toISOString() } as never);
        const b = await s.enqueueReplication({ type: 'memory_replicate', payload: { gaii: 'b@n', key: 'k.other' }, targetPeers: [peer], createdAt: new Date().toISOString() } as never);

        const c = await s.enqueueReplication({ type: 'memory_replicate', payload: { gaii: 'c@n', key: 'k.third' }, targetPeers: [peer], createdAt: new Date().toISOString() } as never);
        expect(await s.replicationQueueSize()).toBe(start + 3);

        const batch = await s.dequeueReplication(peer, 10);
        expect(batch.map(e => (e.payload as { key?: string }).key).sort()).toEqual(['k.other', 'k.shared', 'k.third']);
        // Each row reads back with the moment it was queued, not hours off.
        for (const e of batch) expect(Math.abs(Date.parse(e.createdAt) - Date.now())).toBeLessThan(60_000);

        // One sent, one failed, one still pending: only the pending one is depth.
        await s.markReplicationSent([a]);
        await s.markReplicationFailed([b]);
        expect(await s.replicationQueueSize()).toBe(start + 1);

        // The prune removes the sent row and keeps the pending one, queued a moment ago, although the
        // cutoff is only an hour back; the depth does not move, because a sent row was never depth.
        const pruned = await s.pruneReplicationQueue(new Date(Date.now() - 3_600_000));
        expect(pruned).toBeGreaterThanOrEqual(1);
        expect(await s.replicationQueueSize()).toBe(start + 1);
        expect((await s.dequeueReplication(peer, 10)).map(e => e.id)).toEqual([c]);

        await s.markReplicationSent([c]);
        expect(await s.replicationQueueSize()).toBe(start);
        expect(await s.dequeueReplication(peer, 10)).toEqual([]);
        await s.pruneReplicationQueue(new Date(Date.now() + 60_000));
    }, 60_000);
});
