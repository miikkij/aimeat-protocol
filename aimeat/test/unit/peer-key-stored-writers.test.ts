/**
 * @file peer-key-stored-writers.test.ts
 * @description The peer key check (ed25519PublicKeyProblem, audit 2026-11 L056) on the code paths that
 *   pin a peer to a key read from a record or from another node's answer rather than from the request
 *   body: approving a stored peering request, the key-exchange re-admission under an approved
 *   request, activation adopting the key a key exchange answered, and the adoption of a pending
 *   package-peer registration.
 *
 *   WHY A UNIT TEST. Since 2026-11-15 no route stores a request or a pending registration under a key
 *   that is not an Ed25519 key or is small-order, so the records these paths read can only be ones
 *   written before that day. The test seeds them into storage directly, the way they sit on a node
 *   that ran older code, and drives the real routes over HTTP. The far end is a local stub that
 *   answers a key exchange and a node card with the key each case chooses.
 *
 *   Each refusal has its use beside it: a generated key on the same path still approves, admits,
 *   activates and adopts.
 * @structure stub far end · real peers and lifecycle routes · approve · re-admission · activation ·
 *   pending adoption
 * @usage cd aimeat && pnpm exec vitest run test/unit/peer-key-stored-writers.test.ts
 * @version-history
 *   2026-11-15 — Initial (audit 2026-11 L056, the stored-record writers).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { Router } from 'express';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { registerPeersRoutes } from '../../src/routes/federation-peer/peers.js';
import { registerLifecycleRoutes } from '../../src/routes/federation-peer/lifecycle.js';
import type { PeerInfo } from '../../src/services/federation.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, issueJWT, generateSessionId } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { adoptPendingPeer } from '../../src/services/packages/peer/package-peer-register.js';
import { writePendingPeer, readPendingPeer } from '../../src/services/peer/origin.js';

const NODE_ID = 'aimeat-local-001-dev';
const OWNER = 'keyop';

/** A small-order point (the identity, encoded): under ZIP-215 a forged signature verifies against it for any text. */
const SMALL_ORDER = Buffer.from([1, ...new Array(31).fill(0)]).toString('base64');
const BAD_KEYS: Array<[string, string]> = [['not a key', 'deadbeef1234567890abcdef'], ['small-order', SMALL_ORDER]];

/** What the stub far end answers, set per case. */
let stubKey = '';
let stubNodeId = '';

describe('a peer key read from a stored record or a key-exchange answer is checked before a peer is pinned to it', () => {
    let storage: SqliteStorage;
    let server: http.Server;
    let stubServer: http.Server;
    let base: string;
    let stubUrl: string;
    let config: AimeatConfig;
    let opToken: string;
    const peers = new Map<string, PeerInfo>();

    async function send(method: 'POST' | 'PUT', path: string, body: unknown, token: string | null = opToken) {
        const res = await fetch(`${base}${path}`, {
            method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() as { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } } };
    }
    const post = (path: string, body: unknown, token?: string | null) => send('POST', path, body, token);
    const put = (path: string, body: unknown) => send('PUT', path, body);
    const stored = async (nodeId: string) => (await storage.listFederationPeers()).find(p => p.nodeId === nodeId);

    /** A peering request as one sat in storage before the introduction checked keys. */
    async function seedRequest(fromNodeId: string, publicKey: string, status: 'pending' | 'approved'): Promise<string> {
        const id = `peer-req-${randomBytes(6).toString('hex')}`;
        const now = new Date().toISOString();
        await storage.createPeeringRequest({ id, fromNodeUrl: stubUrl, fromNodeId, toNodeId: NODE_ID, targetUrl: stubUrl, publicKey, status, createdAt: now, updatedAt: now });
        return id;
    }

    /** A peer row with no key, as one could be written before keys were required. */
    async function seedKeylessPeer(nodeId: string): Promise<void> {
        const now = new Date().toISOString();
        const row = {
            nodeId, url: stubUrl, publicKey: '', status: 'pending', addedAt: now, lastSeen: now,
            shareCatalogue: true, replicateMemory: true, allowRouting: true, allowMessaging: true,
            allowBroadcast: true, allowSettlement: true, supportUpstream: false,
            peerMode: 'federation' as const, allowFederatedAuth: false, federationAuthScopes: [],
            tier: 'member' as const,
        };
        peers.set(nodeId, row);
        await storage.saveFederationPeer(row);
    }

    beforeAll(async () => {
        storage = new SqliteStorage(':memory:');
        config = { ...loadConfig().config, nodeId: NODE_ID } as AimeatConfig;
        const kp = await generateKeyPair();
        await initNodeKeys(kp.publicKey, kp.privateKey);
        initSessionAuth(storage, config);
        const now = new Date().toISOString();
        await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: kp.publicKey, roles: ['owner', 'operator'], createdAt: now });
        await storage.setNodeKey(kp.publicKey, kp.privateKey);
        opToken = await issueJWT(
            { sub: `${OWNER}@${NODE_ID}`, owner: OWNER, node: NODE_ID, roles: ['owner', 'operator'], scopes: ['*'] },
            3600, generateSessionId(),
        );

        const stub = express();
        stub.use(express.json());
        stub.post('/v1/federation/key-exchange', (_req, res) => {
            res.json({ ok: true, data: { node_id: stubNodeId, node_public_key: stubKey, agent_keys: [] } });
        });
        stub.get('/.well-known/aimeat', (_req, res) => {
            res.json({ ok: true, data: { node_id: stubNodeId, protocol: 'aimeat', public_key: stubKey } });
        });
        stubServer = http.createServer(stub);
        await new Promise<void>(resolve => stubServer.listen(0, '127.0.0.1', resolve));
        stubUrl = `http://127.0.0.1:${(stubServer.address() as { port: number }).port}`;

        const app = express();
        app.use(express.json());
        const router = Router();
        registerPeersRoutes(router, config, storage, peers);
        registerLifecycleRoutes(router, config, storage, peers);
        app.use(router);
        server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    afterAll(async () => {
        if (server) await new Promise<void>(resolve => server.close(() => resolve()));
        if (stubServer) await new Promise<void>(resolve => stubServer.close(() => resolve()));
        storage?.close?.();
    });

    // ── Approving a stored peering request ──

    it('a stored request under a generated key is approved and pins the peer to that key', async () => {
        const kp = await generateKeyPair();
        const nodeId = `appr-good-${randomBytes(4).toString('hex')}`;
        const id = await seedRequest(nodeId, kp.publicKey, 'pending');
        const r = await put(`/v1/admin/peering/requests/${id}`, { decision: 'approve' });
        expect(r.status, JSON.stringify(r.body.error)).toBe(200);
        expect((await stored(nodeId))?.publicKey).toBe(kp.publicKey);
    });

    it('REFUSED: approving a stored request whose key is not an Ed25519 key or is small-order is 400, and nothing is marked or written', async () => {
        for (const [label, key] of BAD_KEYS) {
            const nodeId = `appr-bad-${label.replace(/\W+/g, '-')}-${randomBytes(4).toString('hex')}`;
            const id = await seedRequest(nodeId, key, 'pending');
            const r = await put(`/v1/admin/peering/requests/${id}`, { decision: 'approve' });
            expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBe(400);
            expect(r.body.error?.code).toBe('INVALID_PEER_KEY');
            expect((await storage.getPeeringRequest(id))?.status, label).toBe('pending');
            expect(peers.has(nodeId), label).toBe(false);
            expect(await stored(nodeId), label).toBeUndefined();
            // Rejecting it stays open.
            const no = await put(`/v1/admin/peering/requests/${id}`, { decision: 'reject' });
            expect(no.status, label).toBe(200);
        }
    });

    // ── The key-exchange re-admission under an approved request ──

    it('a key exchange from a node with an approved request under a generated key admits it under that key', async () => {
        const kp = await generateKeyPair();
        const nodeId = `readmit-good-${randomBytes(4).toString('hex')}`;
        await seedRequest(nodeId, kp.publicKey, 'approved');
        const r = await post('/v1/federation/key-exchange', { node_id: nodeId, node_url: stubUrl, node_public_key: kp.publicKey }, null);
        expect(r.status, JSON.stringify(r.body.error)).toBe(200);
        expect(peers.get(nodeId)?.publicKey).toBe(kp.publicKey);
    });

    it('REFUSED: a key exchange that would admit a node under its approved request\'s small-order key is 400, and no peer is written', async () => {
        const presented = await generateKeyPair();
        const nodeId = `readmit-bad-${randomBytes(4).toString('hex')}`;
        await seedRequest(nodeId, SMALL_ORDER, 'approved');
        const r = await post('/v1/federation/key-exchange', { node_id: nodeId, node_url: stubUrl, node_public_key: presented.publicKey }, null);
        expect(r.status, JSON.stringify(r.body)).toBe(400);
        expect(r.body.error?.code).toBe('INVALID_PEER_KEY');
        expect(peers.has(nodeId)).toBe(false);
        expect(await stored(nodeId)).toBeUndefined();
    });

    // ── Activation adopting the key a key exchange answered ──

    it('a keyless peer activated against a node answering a generated key adopts that key', async () => {
        const kp = await generateKeyPair();
        const nodeId = `adopt-good-${randomBytes(4).toString('hex')}`;
        await seedKeylessPeer(nodeId);
        stubNodeId = nodeId;
        stubKey = kp.publicKey;
        const r = await post('/v1/federation/peer/activate', { peer_node_id: nodeId });
        expect(r.status, JSON.stringify(r.body.error)).toBe(200);
        expect(peers.get(nodeId)?.publicKey).toBe(kp.publicKey);
        expect(peers.get(nodeId)?.status).toBe('active');
    });

    it('REFUSED: a keyless peer activated against a node answering a key that is not an Ed25519 key or is small-order stays keyless and not active', async () => {
        for (const [label, key] of BAD_KEYS) {
            const nodeId = `adopt-bad-${label.replace(/\W+/g, '-')}-${randomBytes(4).toString('hex')}`;
            await seedKeylessPeer(nodeId);
            stubNodeId = nodeId;
            stubKey = key;
            const r = await post('/v1/federation/peer/activate', { peer_node_id: nodeId });
            expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBe(502);
            expect(r.body.error?.code).toBe('KEY_EXCHANGE_FAILED');
            expect(r.body.error?.message, label).toContain('INVALID_PEER_KEY');
            expect(peers.get(nodeId)?.publicKey, label).toBe('');
            expect(peers.get(nodeId)?.status, label).toBe('pending');
            expect((await stored(nodeId))?.publicKey, label).toBe('');
        }
    });

    // ── Adoption of a pending package-peer registration ──

    /** A pending registration as linkPackagePeer left one before it checked the key. */
    async function seedPending(nodeId: string, publicKey: string): Promise<void> {
        const now = new Date().toISOString();
        await writePendingPeer(storage, { nodeId, source: 'package-grant', by: OWNER, url: stubUrl, publicKey, requestedAt: now, lastTryAt: now, lastProblem: 'did not answer' });
    }
    const deps = () => ({ storage, peers, timeoutMs: 3000, thisNodeId: NODE_ID });

    it('a pending registration under a generated key is adopted once its card answers with that key', async () => {
        const kp = await generateKeyPair();
        const nodeId = `pend-good-${randomBytes(4).toString('hex')}`;
        await seedPending(nodeId, kp.publicKey);
        stubNodeId = nodeId;
        stubKey = kp.publicKey;
        await adoptPendingPeer(deps(), nodeId, async () => true);
        expect(peers.get(nodeId)?.publicKey).toBe(kp.publicKey);
        expect(await readPendingPeer(storage, nodeId)).toBeNull();
    });

    it('REFUSED: a pending registration under a small-order key is not adopted, though a forged signature and a card with that key pass', async () => {
        const nodeId = `pend-bad-${randomBytes(4).toString('hex')}`;
        await seedPending(nodeId, SMALL_ORDER);
        stubNodeId = nodeId;
        stubKey = SMALL_ORDER;
        // `proves` answers true: under ZIP-215 a forged signature verifies against a small-order key.
        await adoptPendingPeer(deps(), nodeId, async () => true);
        expect(peers.has(nodeId)).toBe(false);
        expect(await stored(nodeId)).toBeUndefined();
        expect((await readPendingPeer(storage, nodeId))?.publicKey).toBe(SMALL_ORDER);
    });
});
