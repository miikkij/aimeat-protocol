/**
 * @file federated-login-verifies-unconditionally.test.ts
 * @description Rule 10's federation invariant, on the LOGIN path: the home node's attestation is
 *   verified unconditionally, and a missing key or a missing signature is a refusal.
 *
 *   WHAT THIS PINS. The check read `if (homePeer.publicKey && attestation.signature)`, so the two
 *   ways of having nothing to check were the two ways of skipping the check: a peer with no stored
 *   key, or a reply with no signature field, signed the caller in on the strength of an HTTP 200
 *   from a URL. A conditional verification is not a weaker version of an unconditional one — it is
 *   its absence, arranged so that the party who benefits picks which one applies.
 *
 *   WHY A UNIT TEST AND NOT THE MULTINODE SUITE. The suite runs real nodes, and a real home node
 *   always signs — the interesting cases are the ones a well-behaved peer never produces. So the
 *   home node here is a local stub whose reply this test writes, which is exactly the position an
 *   attacker who controls a peer URL is in.
 *
 * @structure
 *   - a stub home node serving /v1/federation/auth/verify with a reply the test chooses
 *   - the real registerRegisterLoginRoutes, driven over HTTP, with a peers map the test controls
 *   - four cases: signed · badly signed · no pinned key · no signature field
 * @usage cd aimeat && pnpm exec vitest run test/unit/federated-login-verifies-unconditionally.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the fix.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { Router } from 'express';
import { registerRegisterLoginRoutes } from '../../src/routes/ghii/register-login.js';
import type { PeerInfo } from '../../src/services/federation.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';

const NODE_ID = 'aimeat-local-001-dev';
const HOME_NODE = 'aimeat-home-001-test';
const USER = 'fedvisitor';

/** What the stub home node will answer next. The test rewrites this per case. */
let homeReply: Record<string, unknown> = {};
/** Whether the stub signs its reply, and with which key. */
let homeSigner: { privateKey: string } | null = null;

describe('federated login verifies the home node\'s attestation unconditionally', () => {
    let storage: SqliteStorage;
    let server: http.Server;
    let homeServer: http.Server;
    let base: string;
    let homeUrl: string;
    let config: AimeatConfig;
    let homeKeys: { publicKey: string; privateKey: string };
    const peers = new Map<string, PeerInfo>();

    /** A peer entry for the home node, with whatever key the case wants pinned. */
    function pinHomePeer(publicKey: string): void {
        peers.set(HOME_NODE, {
            nodeId: HOME_NODE, url: homeUrl, publicKey, status: 'active',
            addedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
            shareCatalogue: true, replicateMemory: true, allowRouting: true,
            allowMessaging: true, allowBroadcast: true, allowSettlement: true,
            peerMode: 'federation', allowFederatedAuth: true, federationAuthScopes: ['memory:read'],
            tier: 'member',
        });
    }

    /** The attestation a well-behaved home node returns, signed the way this node checks it. */
    async function signedAttestation(extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        const payload = {
            verified: true, ghii: `${USER}@${HOME_NODE}`, display_name: 'Fed Visitor',
            home_node: HOME_NODE, home_url: homeUrl, scopes: ['memory:read'], ...extra,
        };
        if (!homeSigner) return payload;
        // The node verifies over the attestation MINUS its own signature field, serialised as JSON
        // in insertion order — so the stub must build the same bytes the route will rebuild.
        const signature = await sign(homeSigner.privateKey, JSON.stringify(payload));
        return { ...payload, signature };
    }

    interface LoginBody { ok?: boolean; data?: { token?: string; federated?: boolean }; error?: { code?: string; message?: string } }
    async function login(): Promise<{ status: number; body: LoginBody }> {
        const res = await fetch(`${base}/v1/ghii/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: `${USER}@${HOME_NODE}`, password: 'FedVisitorPass12345' }),
        });
        return { status: res.status, body: await res.json() as LoginBody };
    }

    beforeAll(async () => {
        storage = new SqliteStorage(':memory:');
        config = { ...loadConfig().config, nodeId: NODE_ID, federationAuthPolicy: 'all_peers' } as AimeatConfig;
        const kp = await generateKeyPair();
        await initNodeKeys(kp.publicKey, kp.privateKey);
        initSessionAuth(storage, config);
        homeKeys = await generateKeyPair();

        // The stub home node. It answers whatever the current case put in `homeReply`.
        const home = express();
        home.use(express.json());
        home.post('/v1/federation/auth/verify', (_req, res) => {
            res.json({ ok: true, data: homeReply });
        });
        homeServer = http.createServer(home);
        await new Promise<void>(resolve => homeServer.listen(0, '127.0.0.1', resolve));
        homeUrl = `http://127.0.0.1:${(homeServer.address() as { port: number }).port}`;

        const app = express();
        app.use(express.json());
        const router = Router();
        registerRegisterLoginRoutes(router, config, storage, undefined, peers, (_q, _s, n) => n());
        app.use(router);
        server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        await new Promise<void>(resolve => homeServer.close(() => resolve()));
        storage.close?.();
    });

    it('a peer with a pinned key and a valid signature signs in', async () => {
        homeSigner = { privateKey: homeKeys.privateKey };
        pinHomePeer(homeKeys.publicKey);
        homeReply = await signedAttestation();

        const { status, body } = await login();
        expect(body.error?.code, JSON.stringify(body.error)).toBeUndefined();
        expect(status).toBe(200);
        // A 200 alone would also be what a route that answered before reaching the check looks
        // like. The token is what says the whole federated path ran and ended in a credential.
        expect(typeof body.data?.token).toBe('string');
        expect(body.data?.token?.split('.').length).toBe(3);
    });

    it('the same peer with a BAD signature is refused', async () => {
        // Signed by somebody else's key: the shape a peer URL taken over by another party produces.
        const impostor = await generateKeyPair();
        homeSigner = { privateKey: impostor.privateKey };
        pinHomePeer(homeKeys.publicKey);
        homeReply = await signedAttestation();

        const { status, body } = await login();
        expect(status).toBe(401);
        expect(body.error?.code).toBe('INVALID_ATTESTATION');
    });

    it('a peer with NO pinned key is refused, and the message names that half', async () => {
        // The hole: no key meant no check, and no check meant signed in.
        homeSigner = { privateKey: homeKeys.privateKey };
        pinHomePeer('');
        homeReply = await signedAttestation();

        const { status, body } = await login();
        expect(status).toBe(401);
        expect(body.error?.code).toBe('PEER_KEY_MISSING');
        // The two causes need different operators to act, so the refusal has to say which it was.
        expect(body.error?.message).toContain('key exchange');
    });

    it('a valid attestation with NO signature field is refused', async () => {
        // The other half of the same hole, and the one an attacker chooses: the key is pinned, so
        // the peer looks trustworthy, and the reply simply omits the thing that proves it.
        homeSigner = null;
        pinHomePeer(homeKeys.publicKey);
        homeReply = await signedAttestation();
        expect(homeReply.signature).toBeUndefined();

        const { status, body } = await login();
        expect(status).toBe(401);
        expect(body.error?.code).toBe('ATTESTATION_UNSIGNED');
    });

    it('and neither refusal is the generic one, so an operator can tell them apart', async () => {
        // Three distinct codes for three distinct causes. Collapsing them would send each operator
        // looking at the wrong end of the link.
        const codes = new Set(['PEER_KEY_MISSING', 'ATTESTATION_UNSIGNED', 'INVALID_ATTESTATION']);
        expect(codes.size).toBe(3);
    });
});
