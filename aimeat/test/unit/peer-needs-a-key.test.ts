/**
 * @file peer-needs-a-key.test.ts
 * @description A federation peer cannot exist, or become active, without a verification key.
 *
 *   WHAT THIS PINS. Two write paths defaulted the key to `''` and activation wrote `status =
 *   'active'` before running key exchange, then warned and answered 200 when it failed — so an
 *   unreachable node became an ACTIVE peer with no key. Active is the state every other gate reads
 *   as "this link works", and one of those gates (federated login) responded to a missing key by
 *   skipping verification entirely. Closing that gate made these rows useless; this stops them
 *   being written.
 *
 *   WHY A UNIT TEST FOR THE SUCCESS PATH. `e2e-federation` covers the refusals, but a SUCCESSFUL
 *   activation needs a second node that actually answers `/v1/federation/key-exchange`, and that
 *   suite has none. Here the far end is a local stub, so "a peer with a key still creates and
 *   activates exactly as before" is measured rather than assumed — which matters more than the
 *   refusals, because a fix that only refuses is a fix that broke the feature.
 *
 * @structure
 *   - a stub peer node serving /v1/federation/key-exchange with a key the test chooses
 *   - the real federationPeersRoutes, driven over HTTP by an operator
 *   - create without a key · create with one · activate reachable · activate unreachable · rotation
 * @usage cd aimeat && pnpm exec vitest run test/unit/peer-needs-a-key.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the fix.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { Router } from 'express';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { registerPeersRoutes } from '../../src/routes/federation-peer/peers.js';
import type { PeerInfo } from '../../src/services/federation.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, issueJWT, generateSessionId } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';

const NODE_ID = 'aimeat-local-001-dev';
const OWNER = 'peerop';

/** What the stub far end returns from key-exchange. The test rewrites this per case. */
let stubKey = '';
/** Whether the stub answers at all — false is the unreachable case without closing the socket. */
let stubAnswers = true;

describe('a federation peer needs a key to exist and to become active', () => {
    let storage: SqliteStorage;
    let server: http.Server;
    let stubServer: http.Server;
    let base: string;
    let stubUrl: string;
    let config: AimeatConfig;
    let opToken: string;
    const peers = new Map<string, PeerInfo>();

    const auth = () => ({ Authorization: `Bearer ${opToken}`, 'Content-Type': 'application/json' });

    async function post(path: string, body: unknown) {
        const res = await fetch(`${base}${path}`, { method: 'POST', headers: auth(), body: JSON.stringify(body) });
        return { status: res.status, body: await res.json() as { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string } } };
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

        // The far end. A real one answers key-exchange with its own node id and public key.
        const stub = express();
        stub.use(express.json());
        stub.post('/v1/federation/key-exchange', (_req, res) => {
            if (!stubAnswers) { res.status(503).json({ ok: false }); return; }
            res.json({ ok: true, data: { node_id: 'aimeat-stub-peer', node_public_key: stubKey, agent_keys: [] } });
        });
        stubServer = http.createServer(stub);
        await new Promise<void>(resolve => stubServer.listen(0, '127.0.0.1', resolve));
        stubUrl = `http://127.0.0.1:${(stubServer.address() as { port: number }).port}`;

        const app = express();
        app.use(express.json());
        const router = Router();
        registerPeersRoutes(router, config, storage, peers);
        app.use(router);
        server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    afterAll(async () => {
        // Guarded: a beforeAll that threw leaves these undefined, and an afterAll that then throws
        // replaces the real failure with a TypeError about `close`.
        if (server) await new Promise<void>(resolve => server.close(() => resolve()));
        if (stubServer) await new Promise<void>(resolve => stubServer.close(() => resolve()));
        storage?.close?.();
    });

    it('creating a peer with no public_key is refused', async () => {
        const r = await post('/v1/federation/peers', { node_id: `nokey-${randomBytes(4).toString('hex')}`, url: stubUrl });
        expect(r.status).toBe(400);
        expect(r.body.error?.code).toBe('PEER_KEY_REQUIRED');
    });

    it('an empty or whitespace public_key is refused too, not stored as a key', async () => {
        for (const key of ['', '   ']) {
            const r = await post('/v1/federation/peers', { node_id: `blank-${randomBytes(4).toString('hex')}`, url: stubUrl, public_key: key });
            expect(r.status, `key ${JSON.stringify(key)}`).toBe(400);
            expect(r.body.error?.code).toBe('PEER_KEY_REQUIRED');
        }
    });

    it('a peer with a key creates and activates exactly as before', async () => {
        // The one that matters most: a fix that only refuses is a fix that broke the feature.
        const kp = await generateKeyPair();
        stubKey = kp.publicKey;
        stubAnswers = true;
        const nodeId = `good-${randomBytes(4).toString('hex')}`;

        const created = await post('/v1/federation/peers', { node_id: nodeId, url: stubUrl, public_key: kp.publicKey });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        expect((created.body.data?.peer as { status?: string })?.status).toBe('pending');

        const activated = await post('/v1/federation/peer/activate', { peer_node_id: nodeId });
        expect(activated.body.error?.code, JSON.stringify(activated.body.error)).toBeUndefined();
        expect(activated.status).toBe(200);
        expect(activated.body.data?.status).toBe('active');
        expect(activated.body.data?.key_exchange).toBe('completed');
        expect(peers.get(nodeId)?.status).toBe('active');
        expect(peers.get(nodeId)?.publicKey).toBe(kp.publicKey);
    });

    it('activating a peer whose key exchange fails is refused, and the peer is unchanged', async () => {
        const kp = await generateKeyPair();
        stubKey = kp.publicKey;
        const nodeId = `unreachable-${randomBytes(4).toString('hex')}`;
        const created = await post('/v1/federation/peers', { node_id: nodeId, url: stubUrl, public_key: kp.publicKey });
        expect(created.status).toBe(201);
        const before = { ...peers.get(nodeId)! };

        stubAnswers = false;
        const r = await post('/v1/federation/peer/activate', { peer_node_id: nodeId });
        expect(r.status).toBe(502);
        expect(r.body.error?.code).toBe('KEY_EXCHANGE_FAILED');

        // Unchanged means unchanged: in memory AND in storage, not merely "still exists".
        const after = peers.get(nodeId)!;
        expect(after.status).toBe(before.status);
        expect(after.status).toBe('pending');
        expect(after.lastSeen).toBe(before.lastSeen);
        const stored = (await storage.listFederationPeers()).find(p => p.nodeId === nodeId);
        expect(stored?.status).toBe('pending');
        stubAnswers = true;
    });

    it('a peer presenting a DIFFERENT key at activation is refused as a rotation', async () => {
        // Adopting it because an operator pressed activate would be the key-continuity gate with a
        // button in front of it.
        const onFile = await generateKeyPair();
        const presented = await generateKeyPair();
        const nodeId = `rotate-${randomBytes(4).toString('hex')}`;
        await post('/v1/federation/peers', { node_id: nodeId, url: stubUrl, public_key: onFile.publicKey });

        stubKey = presented.publicKey;
        const r = await post('/v1/federation/peer/activate', { peer_node_id: nodeId });
        expect(r.status).toBe(409);
        expect(r.body.error?.code).toBe('KEY_ROTATION_DENIED');
        expect(peers.get(nodeId)?.status).toBe('pending');
        expect(peers.get(nodeId)?.publicKey).toBe(onFile.publicKey);
    });
});
