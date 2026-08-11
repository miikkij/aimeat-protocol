/**
 * @file test/unit/storage-conformance.test.ts
 * @description The semantic contract between the two storage providers. `Storage` composes 44
 *   repository interfaces implemented twice by hand, and TypeScript proves the signatures match
 *   while nothing proves the behaviour does. The August 2026 audit's H-30 is exactly that gap: on
 *   SQLite `deleteOwner` clears eleven owner-scoped tables plus a per-agent cascade, on production
 *   Postgres it clears five, and both return true. E2E runs on both backends and passes on both,
 *   because a test asserting "the owner is gone" cannot see what survived.
 *
 *   So this suite asks the other question: run the same scenario against both providers and require
 *   the same observable result. It is also the safety net the step 3 refactor needs, since that work
 *   moves code across this layer and a divergence introduced there would otherwise look green.
 *
 *   Postgres is optional here: when DATABASE_URL is absent (a plain `pnpm test` on a laptop) the
 *   cross-provider cases skip with a printed reason rather than failing, and the SQLite-only
 *   invariants still run. CI sets DATABASE_URL, so the pair is compared where it matters.
 * @structure
 *   - providers(): the provider list for this run (sqlite always; postgres when reachable)
 *   - seedOwner(): one owner with data in several owner-scoped tables
 *   - the cases: delete cascade, transaction lookup, memory listing order, push subscriptions
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-conformance.test.ts
 * @version-history
 *   v1.1.0 — 2026-08-11 — Push subscriptions join the seed and the cascade check, and get a case of
 *     their own: one row per device, refresh in place, prune one endpoint (audit H-8).
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit, step 5c / systemic pattern 5).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';

const SQLITE_PATH = `./test/.conformance-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
    provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
    if (PG_URL) {
        try {
            // `dbUrl`, not `databaseUrl` — StorageOptions names it dbUrl, and test/ is outside tsconfig's
            // include, so the wrong key type-checked fine and pg fell back to env vars with no password.
            // The postgres arm of this suite had therefore never run once. Fixed 2026-08-11.
            provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
        } catch (err) {
            console.warn(`[conformance] postgres unavailable, comparing sqlite only: ${String(err)}`);
        }
    } else {
        console.warn('[conformance] DATABASE_URL not set — cross-provider comparison skipped, sqlite invariants still run');
    }
}, 60_000);

afterAll(async () => {
    // Close first, or Windows refuses to unlink an open database file and every run of this suite
    // leaves ~6 MB of scratch behind. `close` is not on the Storage interface (nothing in the node
    // shuts storage down mid-process), so it is asked for rather than assumed.
    for (const { storage } of provs) {
        await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    }
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the file is the test's own scratch */ } }
    }
});

/**
 * One owner carrying data in several owner-scoped tables, so a partial cascade is visible. Rows land
 * under BOTH identities on purpose: the GHII (where an owner session and an app grant write) and the
 * agent GAII. The cascade runs per identity, and a version of it that only walked agents would still
 * pass a GHII-only seed.
 */
async function seedOwner(s: Storage, name: string): Promise<{ ghii: string; gaii: string }> {
    const node = 'aimeat-conformance-001';
    const ghii = `${name}@${node}`;
    const gaii = `bot#${name}@${node}`;
    const now = new Date().toISOString();

    await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
    await s.createGHII({
        username: name, nodeId: node, ghii, displayName: name, verificationLevel: 0,
        ownerName: name, totpEnabled: false, morselBalance: 100, loginCount: 0, createdAt: now, updatedAt: now,
    });
    await s.createAgent({
        name: 'bot', owner: name, gaii, publicKey: 'pk', trustScore: 50, morselBalance: 0,
        capabilities: [], createdAt: now, lastSeen: now,
    });
    await s.setMemory({
        key: 'conformance.note', ownerGaii: ghii, value: { hello: 'world' }, visibility: 'private',
        tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    await s.addTransaction({
        id: `tx-${randomUUID()}`, gaii: ghii, type: 'welcome_bonus', amount: 10, timestamp: now,
    });
    await s.createConsent({
        id: randomUUID(), ownerGaii: ghii, dataPattern: 'profile.*', recipient: '*', purpose: 'discovery',
        scope: 'dmz', expires: null, status: 'active', grantedAt: now, revokedAt: null,
    });
    await s.createStorageFile({
        key: 'conformance.txt', ownerGaii: ghii, visibility: 'private', mimeType: 'text/plain',
        size: 3, data: Buffer.from('abc'), tags: [], createdAt: now,
    });
    await s.createSharingGroup({
        id: randomUUID(), name: 'conformance group', ownerGaii: ghii, members: [],
        defaultPermissions: { read: true, write: false }, createdAt: now, updatedAt: now,
    });
    // Keyed on the bare owner name rather than an identity: a push subscription belongs to a device
    // of the person, and one person has several.
    await s.createPushSubscription({
        ownerName: name, endpoint: `https://push.example.test/${name}/laptop`,
        keys: { p256dh: 'conf-p256dh', auth: 'conf-auth' }, createdAt: now, lastUsedAt: now,
    });
    // Under the AGENT identity, so the per-agent branch of the cascade is exercised too.
    await s.setMicroMemory({ gaii, set: 'conf', entries: { a: '1' }, visibility: 'private', updatedAt: now });
    return { ghii, gaii };
}

/** Everything the cascade must leave empty, read back through the Storage interface. */
async function leftovers(s: Storage, owner: string, ghii: string, gaii: string) {
    return {
        memory: (await s.listMemory(ghii, {})).length,
        transactions: (await s.getTransactions(ghii)).length,
        consents: (await s.listConsents(ghii)).length,
        files: (await s.listStorageFiles(ghii)).length,
        sharingGroups: (await s.listSharingGroups(ghii)).length,
        pushSubscriptions: (await s.listPushSubscriptionsByOwner(owner)).length,
        microMemory: (await s.listMicroMemorySets(gaii)).length,
        agents: (await s.getAgentsByOwner(owner)).length,
        ghii: !!(await s.getGHII(ghii)),
    };
}

describe('storage providers agree on what they do, not just on their signatures', () => {
    it('deleteOwner leaves nothing owner-scoped behind, identically on every provider', async () => {
        const results: Record<string, Awaited<ReturnType<typeof leftovers>>> = {};

        for (const { name, storage } of provs) {
            const owner = `conf${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii, gaii } = await seedOwner(storage, owner);

            // The seed is real: without this the assertions below could pass on an empty database.
            const seeded = await leftovers(storage, owner, ghii, gaii);
            for (const [field, value] of Object.entries(seeded)) {
                if (field === 'ghii') continue;
                expect(value, `${name}: seed wrote ${field}`).toBeGreaterThan(0);
            }

            await storage.deleteOwner(owner);
            results[name] = await leftovers(storage, owner, ghii, gaii);
        }

        // Every provider must reach the same end state. This is the assertion H-30 needed: on the
        // production backend the transactions survived the delete while the tested backend cleared
        // them, and every existing test passed on both because none of them looked.
        const [first, ...rest] = Object.entries(results);
        for (const [name, r] of rest) {
            expect(r, `${name} must match ${first[0]} after deleteOwner`).toEqual(first[1]);
        }
        for (const [name, r] of Object.entries(results)) {
            for (const [field, value] of Object.entries(r)) {
                expect(value, `${name}: ${field} survived the delete`).toBe(field === 'ghii' ? false : 0);
            }
        }
    }, 60_000);

    it('findTransactionByTrackingCode finds a row no recent-window scan would reach', async () => {
        for (const { name, storage } of provs) {
            const owner = `conftx${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii } = await seedOwner(storage, owner);
            const tc = `settle:conf-${randomUUID()}`;
            const base = Date.now();

            await storage.addTransaction({
                id: `tx-${randomUUID()}`, gaii: ghii, type: 'federation_settlement', amount: 5,
                trackingCode: tc, timestamp: new Date(base).toISOString(),
            });
            // Push it out of the default 50-row window the old replay guard scanned.
            for (let i = 0; i < 60; i++) {
                await storage.addTransaction({
                    id: `tx-${randomUUID()}`, gaii: ghii, type: 'earned', amount: 1,
                    timestamp: new Date(base + 1000 + i * 1000).toISOString(),
                });
            }

            const found = await storage.findTransactionByTrackingCode(ghii, tc, 'federation_settlement');
            expect(found, `${name}: the settlement must still be found after 60 newer rows`).toBeTruthy();
            expect(found?.trackingCode).toBe(tc);

            const wrongType = await storage.findTransactionByTrackingCode(ghii, tc, 'earned');
            expect(wrongType, `${name}: the type is part of the identity`).toBeNull();

            await storage.deleteOwner(owner);
        }
    }, 60_000);

    it('listMemory returns the same set for the same prefix on every provider', async () => {
        const shapes: Record<string, { count: number; firstKey: string }> = {};

        for (const { name, storage } of provs) {
            const owner = `confmem${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii } = await seedOwner(storage, owner);
            const now = new Date().toISOString();
            for (const k of ['conformance.a', 'conformance.b', 'conformance.c']) {
                await storage.setMemory({
                    key: k, ownerGaii: ghii, value: { k }, visibility: 'private',
                    tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
                });
            }
            // NB: listMemory's contract has no limit — the interface takes prefix/visibility/tags
            // only, and the audit's 'GET /v1/memory has no LIMIT' finding is about exactly that.
            const all = await storage.listMemory(ghii, { prefix: 'conformance.' });
            shapes[name] = { count: all.length, firstKey: [...all].map(m => m.key).sort()[0] };

            await storage.deleteOwner(owner);
        }

        const [first, ...rest] = Object.entries(shapes);
        for (const [name, s] of rest) {
            expect(s, `${name} must return the same set as ${first[0]}`).toEqual(first[1]);
        }
    }, 60_000);

    it('a transaction that throws leaves NOTHING behind, on every provider', async () => {
        for (const { name, storage } of provs) {
            const owner = `conftx2${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii } = await seedOwner(storage, owner);
            const now = new Date().toISOString();
            const boom = new Error('second step fails');

            await expect(storage.transaction(async () => {
                await storage.setMemory({
                    key: 'tx.first', ownerGaii: ghii, value: { step: 1 }, visibility: 'private',
                    tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
                });
                await storage.addTransaction({ id: `tx-${randomUUID()}`, gaii: ghii, type: 'earned', amount: 7, timestamp: now });
                throw boom;
            })).rejects.toThrow('second step fails');

            // Both steps must be gone. Without a real transaction the first write is committed on its
            // own and this is the assertion that fails.
            expect(await storage.getMemory(ghii, 'tx.first'), `${name}: the first write survived the rollback`).toBeNull();
            const sevens = (await storage.getTransactions(ghii)).filter(t => t.amount === 7);
            expect(sevens.length, `${name}: the second write survived the rollback`).toBe(0);

            await storage.deleteOwner(owner);
        }
    }, 60_000);

    it('a transaction that succeeds commits every step, and nesting joins rather than nests', async () => {
        for (const { name, storage } of provs) {
            const owner = `conftx3${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii } = await seedOwner(storage, owner);
            const now = new Date().toISOString();

            const out = await storage.transaction(async () => {
                await storage.setMemory({
                    key: 'tx.outer', ownerGaii: ghii, value: { step: 1 }, visibility: 'private',
                    tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
                });
                // A service function calling another service function: the inner call must join, not
                // open a second transaction (Postgres would error, SQLite would deadlock on its queue).
                return storage.transaction(async () => {
                    await storage.setMemory({
                        key: 'tx.inner', ownerGaii: ghii, value: { step: 2 }, visibility: 'private',
                        tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
                    });
                    return 'done';
                });
            });

            expect(out, `${name}: the return value comes back through both levels`).toBe('done');
            expect(await storage.getMemory(ghii, 'tx.outer'), `${name}: outer write committed`).not.toBeNull();
            expect(await storage.getMemory(ghii, 'tx.inner'), `${name}: inner write committed`).not.toBeNull();

            await storage.deleteOwner(owner);
        }
    }, 60_000);

    it('a push subscription is per DEVICE on every provider, and pruning takes one endpoint', async () => {
        const shapes: Record<string, unknown> = {};

        for (const { name, storage } of provs) {
            const owner = `confpush${Date.now()}${Math.floor(Math.random() * 1000)}`;
            await seedOwner(storage, owner);              // already registers the "laptop" endpoint
            const now = new Date().toISOString();
            const laptop = `https://push.example.test/${owner}/laptop`;
            const phone = `https://push.example.test/${owner}/phone`;
            const keys = { p256dh: 'conf-p256dh', auth: 'conf-auth' };

            // A second device joins the first. Keyed on ownerName alone (before H-8) this replaced it.
            await storage.createPushSubscription({ ownerName: owner, endpoint: phone, keys, createdAt: now, lastUsedAt: now });
            const both = (await storage.listPushSubscriptionsByOwner(owner)).map(s => s.endpoint).sort();

            // The same device again refreshes its keys rather than adding a row.
            await storage.createPushSubscription({
                ownerName: owner, endpoint: laptop, keys: { p256dh: 'rotated', auth: 'rotated' }, createdAt: now, lastUsedAt: now,
            });
            const afterRefresh = await storage.listPushSubscriptionsByOwner(owner);
            const rotated = afterRefresh.find(s => s.endpoint === laptop)?.keys.p256dh;

            // A dead endpoint is pruned on its own: the other device must survive it.
            const prunedOne = await storage.deletePushSubscription(owner, phone);
            const afterPrune = (await storage.listPushSubscriptionsByOwner(owner)).map(s => s.endpoint);

            // No endpoint named: the whole account unsubscribes.
            const prunedAll = await storage.deletePushSubscription(owner);
            const afterAll_ = await storage.listPushSubscriptionsByOwner(owner);
            const missing = await storage.deletePushSubscription(owner, laptop);

            shapes[name] = {
                both, count: afterRefresh.length, rotated, prunedOne, afterPrune, prunedAll,
                left: afterAll_.length, missing,
            };
            expect(shapes[name], `${name}: per-device subscriptions`).toEqual({
                both: [laptop, phone].sort(), count: 2, rotated: 'rotated',
                prunedOne: true, afterPrune: [laptop], prunedAll: true, left: 0, missing: false,
            });

            await storage.deleteOwner(owner);
        }

        const [first, ...rest] = Object.entries(shapes);
        for (const [name, s] of rest) {
            // Endpoints carry the owner name, which differs per provider run, so compare the shape.
            expect(JSON.stringify(s).replace(/confpush\d+/g, 'OWNER'), `${name} must behave like ${first[0]}`)
                .toEqual(JSON.stringify(first[1]).replace(/confpush\d+/g, 'OWNER'));
        }
    }, 60_000);

    it('a write started outside an open transaction is not swallowed by its rollback', async () => {
        for (const { name, storage } of provs) {
            const owner = `conftx4${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii } = await seedOwner(storage, owner);
            const now = new Date().toISOString();

            // Start the transaction WITHOUT awaiting it, so the write below runs in this test's async
            // context — a real second request, not a step of the transaction. SQLite runs the whole
            // process on one connection, so without the guard that write lands inside the open BEGIN
            // and is discarded by its rollback.
            const tx = storage.transaction(async () => {
                await new Promise(r => setImmediate(r));
                await storage.setMemory({
                    key: 'tx.doomed', ownerGaii: ghii, value: {}, visibility: 'private',
                    tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
                });
                await new Promise(r => setImmediate(r));
                throw new Error('rolled back');
            }).catch(() => { /* the rejection is the point; the assertions are below */ });

            const outsider = storage.setMemory({
                key: 'tx.outsider', ownerGaii: ghii, value: { from: 'another request' }, visibility: 'private',
                tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
            });
            await tx;
            await outsider;

            expect(await storage.getMemory(ghii, 'tx.doomed'), `${name}: the rolled-back write survived`).toBeNull();
            expect(await storage.getMemory(ghii, 'tx.outsider'), `${name}: an unrelated write was rolled back with it`).not.toBeNull();

            await storage.deleteOwner(owner);
        }
    }, 60_000);
});
