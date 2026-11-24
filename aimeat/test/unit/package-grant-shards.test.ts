/**
 * @file test/unit/package-grant-shards.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package group's grants at the size a sold package reaches: more installs than one
 *   shard holds, every stored value under the 1024 kB memory value cap, every grant readable, and an
 *   old single grants record read as it is and converted on its next write (package sale decision,
 *   part b, 2026-11-24). Real SQLite storage, so the compare-and-swap writes are the provider's.
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, PackageRecord } from '../../src/storage/interface.js';
import {
    grantEntitlement, revokeEntitlement, readEntitlements, entitlementOf, entitledGroupsOf, NS_PACKAGE_ENTITLEMENTS,
} from '../../src/services/packages/sale/package-entitlements.js';
import { GRANTS_PER_SHARD, writeGrant, listAllGrants } from '../../src/services/packages/sale/package-grant-shards.js';

const AUTHOR = { owner: 'vendor', isOperator: false };
const VALUE_CAP_BYTES = 1024 * 1024;
const node = (i: number): string => `aimeat-customer-${String(i).padStart(5, '0')}`;

let storage: Storage;

async function publish(groupId: string): Promise<void> {
    const now = new Date().toISOString();
    await storage.createPackage({
        id: randomUUID(), packageGroupId: groupId, name: groupId.split('::')[0], author: 'vendor', authorGhii: 'vendor@test-node',
        version: 'v2026-11-25-0000', changelog: '', description: 'A sold package', category: 'other', tags: [],
        visibility: 'private', status: 'published', manifest: '', createdAt: now, updatedAt: now,
        components: [{ id: 'app.html', type: 'app', label: 'App', content: '<html></html>', contentHash: 'x', dependencies: [] }],
    } as PackageRecord);
}

/** A grant as a seller's sale writes it: a note naming the order, the seller and the terms. */
function sale(groupId: string, i: number) {
    return {
        groupId, nodeId: node(i), updatesUntil: '2027-11-25T00:00:00.000Z',
        note: `sold by aimeat-shop-001: order cs_${randomUUID()}`,
        terms: { offerTermsId: `terms-${randomUUID()}`, price: { amount: 20_000_000, currency: 'EUR' }, renewal: { amount: 5_000_000, currency: 'EUR', period_days: 30 }, acceptedAt: new Date().toISOString() },
    };
}

async function storedValues(): Promise<Array<{ key: string; bytes: number; nodes: number }>> {
    return (await storage.listMemory(NS_PACKAGE_ENTITLEMENTS, {})).map(r => ({
        key: r.key,
        bytes: Buffer.byteLength(JSON.stringify(r.value), 'utf8'),
        nodes: Object.keys((r.value as { nodes?: object } | null)?.nodes ?? {}).length,
    }));
}

beforeEach(() => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
});

describe('a package group with more installs than one shard holds', () => {
    it('2,500 sold grants: every value stays under the 1024 kB cap and every grant is read back', async () => {
        const groupId = 'corp-kit::vendor';
        await publish(groupId);
        const N = 2500;
        // 2,400 grants as the one record held them before shards (a write of them one by one reads
        // every shard each time, which takes a minute), then 100 more sales on top.
        const now = new Date().toISOString();
        const SEEDED = 2400;
        const nodes = Object.fromEntries(Array.from({ length: SEEDED }, (_, i) => {
            const s = sale(groupId, i);
            return [node(i), {
                nodeId: s.nodeId, updatesUntil: s.updatesUntil, channel: 'stable', note: s.note, soldBy: 'aimeat-shop-001', terms: s.terms,
                grantedAt: now, grantedBy: 'vendor', updatedAt: now,
            }];
        }));
        await storage.setMemory({
            key: `entitlements.${groupId}`, ownerGaii: NS_PACKAGE_ENTITLEMENTS, value: { groupId, nodes }, visibility: 'private',
            tags: ['package-entitlements'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        });
        for (let i = SEEDED; i < N; i++) {
            const out = await grantEntitlement(storage, AUTHOR, sale(groupId, i));
            expect(out.ok).toBe(true);
        }
        const values = await storedValues();
        for (const v of values) {
            expect(v.bytes, v.key).toBeLessThan(VALUE_CAP_BYTES / 2 + 4096);
            expect(v.nodes, v.key).toBeLessThanOrEqual(GRANTS_PER_SHARD);
        }
        expect(values.length).toBeGreaterThanOrEqual(1 + Math.ceil(N / GRANTS_PER_SHARD));

        const all = await readEntitlements(storage, groupId);
        expect(all.length).toBe(N);
        expect(new Set(all.map(e => e.nodeId)).size).toBe(N);
        expect((await entitlementOf(storage, groupId, node(N - 1)))?.nodeId).toBe(node(N - 1));
        expect((await entitledGroupsOf(storage, node(N - 1))).map(g => g.groupId)).toEqual([groupId]);

        // A revoke in the first shard frees one place, and the next new node takes it.
        expect((await revokeEntitlement(storage, AUTHOR, groupId, node(0))).ok).toBe(true);
        expect(await entitlementOf(storage, groupId, node(0))).toBeNull();
        expect((await grantEntitlement(storage, AUTHOR, sale(groupId, N))).ok).toBe(true);
        expect((await readEntitlements(storage, groupId)).length).toBe(N);
        // A grant changed again stays one grant.
        expect((await grantEntitlement(storage, AUTHOR, { groupId, nodeId: node(1500), channel: 'beta' })).ok).toBe(true);
        const after = await readEntitlements(storage, groupId);
        expect(after.filter(e => e.nodeId === node(1500)).map(e => e.channel)).toEqual(['beta']);
        expect((await listAllGrants(storage)).map(g => [g.groupId, g.grants.length])).toEqual([[groupId, N]]);
    }, 60_000);

    it('grants made at the same moment across a full shard all land, and no shard holds more than its size', async () => {
        const groupId = 'edge-kit::vendor';
        await publish(groupId);
        const now = new Date().toISOString();
        for (let i = 0; i < GRANTS_PER_SHARD - 2; i++) {
            await writeGrant(storage, groupId, node(i), { nodeId: node(i), updatesUntil: null, channel: 'stable', grantedAt: now, grantedBy: 'vendor', updatedAt: now });
        }
        const fresh = Array.from({ length: 6 }, (_, k) => GRANTS_PER_SHARD + k);
        const outs = await Promise.all(fresh.map(i => grantEntitlement(storage, AUTHOR, sale(groupId, i))));
        expect(outs.every(o => o.ok)).toBe(true);
        const ids = (await readEntitlements(storage, groupId)).map(e => e.nodeId);
        expect(ids.length).toBe(GRANTS_PER_SHARD - 2 + fresh.length);
        for (const i of fresh) expect(ids).toContain(node(i));
        for (const v of await storedValues()) expect(v.nodes, v.key).toBeLessThanOrEqual(GRANTS_PER_SHARD);
    }, 60_000);
});

describe('an old single grants record', () => {
    async function seedLegacy(groupId: string, ids: string[]): Promise<void> {
        const now = new Date().toISOString();
        const nodes = Object.fromEntries(ids.map(id => [id, { nodeId: id, updatesUntil: null, channel: 'stable', grantedAt: now, grantedBy: 'vendor', updatedAt: now }]));
        await storage.setMemory({
            key: `entitlements.${groupId}`, ownerGaii: NS_PACKAGE_ENTITLEMENTS, value: { groupId, nodes }, visibility: 'private',
            tags: ['package-entitlements'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        });
    }

    it('is read as it is, and its next write moves its grants to shards without losing one', async () => {
        const groupId = 'old-kit::vendor';
        await publish(groupId);
        await seedLegacy(groupId, [node(1), node(2)]);
        expect((await readEntitlements(storage, groupId)).map(e => e.nodeId).sort()).toEqual([node(1), node(2)]);
        expect((await entitledGroupsOf(storage, node(2))).map(g => g.groupId)).toEqual([groupId]);

        expect((await grantEntitlement(storage, AUTHOR, sale(groupId, 3))).ok).toBe(true);
        const index = (await storage.getMemory(NS_PACKAGE_ENTITLEMENTS, `entitlements.${groupId}`))?.value as { shards?: number[]; nodes?: unknown };
        expect(index.shards).toEqual([0]);
        expect(index.nodes).toBeUndefined();
        expect((await readEntitlements(storage, groupId)).map(e => e.nodeId).sort()).toEqual([node(1), node(2), node(3)]);
        expect((await entitledGroupsOf(storage, node(1))).map(g => g.groupId)).toEqual([groupId]);
    });

    it('a revoke converts it too, and removes only the one node', async () => {
        const groupId = 'old-kit2::vendor';
        await publish(groupId);
        await seedLegacy(groupId, [node(1), node(2)]);
        expect((await revokeEntitlement(storage, AUTHOR, groupId, node(1))).ok).toBe(true);
        expect((await readEntitlements(storage, groupId)).map(e => e.nodeId)).toEqual([node(2)]);
    });

    it('a node id that is also a property of every object is a node like any other', async () => {
        const groupId = 'proto-kit::vendor';
        await publish(groupId);
        expect(await entitlementOf(storage, groupId, 'constructor')).toBeNull();
        expect((await grantEntitlement(storage, AUTHOR, { groupId, nodeId: 'constructor' })).ok).toBe(true);
        expect((await readEntitlements(storage, groupId)).map(e => e.nodeId)).toEqual(['constructor']);
    });
});
