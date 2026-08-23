/**
 * @file federation-peer-flag-roundtrip.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A peer's permission flags survive being written and read back, on BOTH providers.
 *
 *   The `contact` tier promises a customer that messages are the only thing crossing the link. That
 *   promise is enforced by reading flags off a stored row, so a flag written as false and read back
 *   as true breaks it silently, in the one direction nobody notices: the door opens.
 *
 *   The failure is easy to write. sqlite stores booleans as 0/1 and the mapper compares `=== 1`, so a
 *   column that was added without a backfill reads NULL and every peer loses the capability; a column
 *   missing from the INSERT list is written as its default and every contact peer gains one. Neither
 *   shows up in a type check, and neither shows up in a test that only ever stores a member peer,
 *   which is what the federation E2E suites do.
 *
 *   So this stores a peer at every tier, reads it back through the real provider, and compares the
 *   whole flag set. Postgres runs when DATABASE_URL is set, sqlite always.
 * @structure One round-trip per tier, plus the legacy-row defaults.
 * @usage pnpm exec vitest run test/unit/federation-peer-flag-roundtrip.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial, with the contact tier.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, FederationPeerRecord } from '../../src/storage/interface.js';
import { deriveTierFlags, type PeerTier } from '../../src/services/federation-tiers.js';

const SQLITE_PATH = `./test/.peerflags-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
    provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
    if (PG_URL) {
        try {
            provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
        } catch (err) {
            console.warn(`[peer-flags] postgres unavailable, sqlite only: ${String(err)}`);
        }
    } else {
        console.warn('[peer-flags] DATABASE_URL not set — sqlite only');
    }
}, 60_000);

afterAll(async () => {
    for (const { storage } of provs) {
        await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    }
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
    }
});

function peerAt(tier: PeerTier, nodeId: string, extra: Partial<FederationPeerRecord> = {}): FederationPeerRecord {
    const now = new Date().toISOString();
    return {
        nodeId, url: `https://${nodeId}.example`, publicKey: 'k', status: 'active',
        addedAt: now, lastSeen: now,
        ...deriveTierFlags(tier),
        tier,
        ...extra,
    };
}

async function readBack(storage: Storage, nodeId: string): Promise<FederationPeerRecord> {
    const rows = await storage.listFederationPeers();
    const row = rows.find(r => r.nodeId === nodeId);
    expect(row, `peer ${nodeId} was stored`).toBeDefined();
    return row!;
}

describe('the harness itself', () => {
    // vitest swallows console.warn, so a postgres arm that failed to connect would skip in silence
    // and this file would pass having tested one provider. That is the documented history of
    // storage-conformance.test.ts, whose postgres arm never ran once. Make the skip loud.
    it('runs postgres whenever DATABASE_URL is set', () => {
        expect(provs.map(p => p.name)).toContain('sqlite');
        if (PG_URL) expect(provs.map(p => p.name)).toContain('postgres-kysely');
    });
});

describe('a peer\'s flags survive the round trip', () => {
    for (const tier of ['contact', 'visiting', 'member', 'genesis'] as PeerTier[]) {
        it(`${tier}: every flag reads back as it was written`, async () => {
            for (const { name, storage } of provs) {
                const nodeId = `aimeat-test-${tier}-${name}`;
                await storage.saveFederationPeer(peerAt(tier, nodeId));
                const row = await readBack(storage, nodeId);
                const want = deriveTierFlags(tier);

                expect(row.shareCatalogue, `${name}/${tier}.shareCatalogue`).toBe(want.shareCatalogue);
                expect(row.replicateMemory, `${name}/${tier}.replicateMemory`).toBe(want.replicateMemory);
                expect(row.allowRouting, `${name}/${tier}.allowRouting`).toBe(want.allowRouting);
                expect(row.allowMessaging, `${name}/${tier}.allowMessaging`).toBe(want.allowMessaging);
                expect(row.allowBroadcast, `${name}/${tier}.allowBroadcast`).toBe(want.allowBroadcast);
                expect(row.allowSettlement, `${name}/${tier}.allowSettlement`).toBe(want.allowSettlement);
                expect(row.peerMode, `${name}/${tier}.peerMode`).toBe(want.peerMode);
                expect(row.allowFederatedAuth, `${name}/${tier}.allowFederatedAuth`).toBe(want.allowFederatedAuth);
                expect(row.tier, `${name}/${tier}.tier`).toBe(tier);
            }
        }, 30_000);
    }

    it('a contact peer stays private and unable to broadcast or settle, on every provider', async () => {
        for (const { name, storage } of provs) {
            const nodeId = `aimeat-test-contact-promise-${name}`;
            await storage.saveFederationPeer(peerAt('contact', nodeId));
            const row = await readBack(storage, nodeId);
            // The customer-facing promise, asserted as one statement rather than inferred.
            expect(row.allowMessaging, name).toBe(true);
            for (const [k, v] of Object.entries(row)) {
                if (typeof v !== 'boolean') continue;
                if (k === 'allowMessaging') continue;
                expect(v, `${name}: contact peer must not carry ${k}`).toBe(false);
            }
            expect(row.peerMode, name).toBe('private');
        }
    }, 30_000);

    it('supportUpstream persists when set and defaults to off when not', async () => {
        for (const { name, storage } of provs) {
            const off = `aimeat-test-upstream-off-${name}`;
            const on = `aimeat-test-upstream-on-${name}`;
            await storage.saveFederationPeer(peerAt('contact', off));
            await storage.saveFederationPeer(peerAt('contact', on, { supportUpstream: true }));

            expect((await readBack(storage, off)).supportUpstream ?? false, `${name}: not set`).toBe(false);
            expect((await readBack(storage, on)).supportUpstream, `${name}: set`).toBe(true);
        }
    }, 30_000);

    it('an UPDATE cannot silently drop a flag: saving twice keeps what the second save said', async () => {
        for (const { name, storage } of provs) {
            const nodeId = `aimeat-test-update-${name}`;
            await storage.saveFederationPeer(peerAt('member', nodeId));
            expect((await readBack(storage, nodeId)).allowBroadcast, `${name}: member`).toBe(true);

            // The same node id demoted to the floor. An upsert that omits a column would leave the
            // member value standing, which is how a "revoked" capability keeps working.
            await storage.saveFederationPeer(peerAt('contact', nodeId));
            const row = await readBack(storage, nodeId);
            expect(row.tier, `${name}: demoted tier`).toBe('contact');
            expect(row.allowBroadcast, `${name}: demoted broadcast`).toBe(false);
            expect(row.allowSettlement, `${name}: demoted settlement`).toBe(false);
            expect(row.shareCatalogue, `${name}: demoted catalogue`).toBe(false);
            expect(row.peerMode, `${name}: demoted peerMode`).toBe('private');
        }
    }, 30_000);
});
