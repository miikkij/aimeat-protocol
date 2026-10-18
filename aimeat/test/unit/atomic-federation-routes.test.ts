/**
 * @file test/unit/atomic-federation-routes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two signed peer requests at the same moment on POST /v1/federation/trust-advisory and
 *   POST /v1/federation/replicate, the two route sites of the G4 atomic-write fixes (2026-10-18). The
 *   routes are the real ones (registerCatalogueTrustRoutes, registerMessagingRoutes) on an HTTP server
 *   in this process, over a real storage of both providers whose reads answer late (slow-reads.ts),
 *   and the peer signs every request with its own key and proof, as a peer node does.
 *
 *   Runs on SQLite in memory, and on PostgreSQL too when DATABASE_URL is set (names carry a run tag).
 * @usage cd aimeat && pnpm exec vitest run test/unit/atomic-federation-routes.test.ts
 * @version-history
 *   2026-10-18 — Initial (atomic-write fixes, group G4).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { slowReads } from './slow-reads.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';
import { audienceProof, deliveryProof } from '../../src/services/signed-node-request.js';
import { trustNoticeSignString } from '../../src/services/federation-trust-notice.js';
import type { PeerInfo } from '../../src/services/federation.js';
import { registerCatalogueTrustRoutes } from '../../src/routes/federation-sync/catalogue-trust.js';
import { registerMessagingRoutes } from '../../src/routes/federation-sync/messaging.js';

requirePostgresWhenAsked('atomic-federation-routes');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
const servers: Server[] = [];
beforeAll(async () => {
    for (const name of names) providers.set(name, await createStorage({
        provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
        sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
    }) as TestStorage);
}, 60_000);
afterAll(async () => {
    for (const s of servers) await new Promise<void>(r => s.close(() => r()));
    for (const s of providers.values()) await s.close();
});

const { config: baseConfig } = loadConfig({});

/** This node's federation routes over `storage`, and one active peer that signs what it sends. */
async function nodeWithPeer(storage: Storage) {
    const tag = randomUUID().slice(0, 8);
    const config = { ...baseConfig, nodeId: `here-${tag}` };
    const keys = await generateKeyPair();
    const now = new Date().toISOString();
    const peer = {
        nodeId: `peer-${tag}`, url: 'https://peer.example.test', publicKey: keys.publicKey, status: 'active', addedAt: now, lastSeen: now,
        shareCatalogue: true, replicateMemory: true, allowRouting: true, allowMessaging: true, allowBroadcast: true, allowSettlement: true,
        peerMode: 'federation', allowFederatedAuth: false, federationAuthScopes: [], tier: 'member',
    } as PeerInfo;
    const peers = new Map<string, PeerInfo>([[peer.nodeId, peer]]);
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerCatalogueTrustRoutes(router, config, storage, peers);
    registerMessagingRoutes(router, config, storage, peers);
    app.use(router);
    const server = await new Promise<Server>(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (path: string, body: Record<string, unknown>) => {
        const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, body: await res.json() as { data?: Record<string, unknown>; error?: { code?: string } } };
    };
    const notice = async (target: string) => {
        const fields = { source_node: peer.nodeId, target_node: target, advisory_type: 'warning', reason: `seen ${target}`, evidence_hash: '', timestamp: new Date().toISOString() };
        const signed = trustNoticeSignString(fields);
        return post('/v1/federation/trust-advisory', { ...fields, signature: await sign(keys.privateKey, signed), ...await audienceProof(keys.privateKey, signed, config.nodeId) });
    };
    const replicate = async (key: string, value: unknown, timestamp: string) => {
        const fields = { source_node: peer.nodeId, gaii: `alice@${peer.nodeId}`, key, value, visibility: 'private', version: 1, timestamp };
        const signed = JSON.stringify(fields);
        return post('/v1/federation/replicate', { ...fields, signature: await sign(keys.privateKey, signed), ...await deliveryProof(keys.privateKey, signed, config.nodeId) });
    };
    return { config, peer, notice, replicate };
}

describe.each(names)('%s: two signed peer requests at the same moment', provider => {
    const real = () => providers.get(provider)!;

    it('trust-advisory: notices sent at once past the per-peer bound, no more than the bound is stored', async () => {
        const { storage: slow } = slowReads(real());
        const { config, peer, notice } = await nodeWithPeer(slow);
        const systemGaii = `system@${config.nodeId}`;
        const prefix = `trust_advisory:recv:${peer.nodeId}:`;
        const now = new Date().toISOString();
        for (let i = 0; i < 49; i++) {
            await real().setMemory({
                key: `${prefix}held-${i}:warning`, ownerGaii: systemGaii, value: { id: `adv-${i}` }, visibility: 'private', tags: [],
                ttlHours: null, version: 1, createdAt: now, updatedAt: now,
            });
        }
        const out = await Promise.all(['t-a', 't-b', 't-c'].map(t => notice(t)));
        for (const r of out) expect([201, 429]).toContain(r.status);
        const stored = await real().listMemory(systemGaii, { prefix });
        expect(stored.length).toBeLessThanOrEqual(50);
        expect(stored.length).toBe(49 + out.filter(r => r.status === 201).length);
    });

    it('replicate: an older replica sent beside a newer one never replaces it', async () => {
        const { storage: slow } = slowReads(real());
        const { peer, replicate } = await nodeWithPeer(slow);
        const t0 = new Date(Date.now() - 3000).toISOString();
        const t1 = new Date(Date.now() - 2000).toISOString();
        const t2 = new Date(Date.now() - 1000).toISOString();
        expect((await replicate('note', { v: 'first' }, t0)).status).toBe(200);
        const out = await Promise.all([replicate('note', { v: 'newest' }, t2), replicate('note', { v: 'middle' }, t1)]);
        for (const r of out) expect(r.status).toBe(200);
        const rec = await real().getMemory(`alice@${peer.nodeId}`, `replica:${peer.nodeId}:note`);
        expect(rec?.value).toEqual({ v: 'newest' });
    });
});
