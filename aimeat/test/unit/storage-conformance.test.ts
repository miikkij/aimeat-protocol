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
 *   - the cases: delete cascade, transaction lookup, memory listing order
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-conformance.test.ts
 * @version-history
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

afterAll(() => {
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
});
