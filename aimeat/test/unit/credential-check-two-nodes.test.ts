/**
 * @file test/unit/credential-check-two-nodes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description In a process that serves two nodes, a credential is checked against the storage of
 *   the node the code runs as, whichever node registered last.
 *
 *   WHY. The multi-node E2E suites boot two or three nodes in one process, and each node registers
 *   its storage and config with the auth layer at boot (initSessionAuth, initRevocationStorage), and
 *   its anonymous identity when that mode is on. The credential checks read them for the node the
 *   code runs as (runAsNode, utils/gaii.ts): credentialRevoked and its five questions, the requireAuth
 *   path, a personal access token, the last-seen write, the refusal's discovery URL and the mint
 *   check in issueJWT. So node A answers from node A's accounts, sessions and revoked tokens. A
 *   production process serves one node.
 * @usage cd aimeat && pnpm exec vitest run test/unit/credential-check-two-nodes.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../../src/services/stats.js', () => ({ getStats: () => null }));
vi.mock('../../src/services/prometheus.js', () => ({ getPromMetrics: () => null }));
vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});

import { AccountDisabledError, initNodeKeys, initRevocationStorage, issueJWT, revokeToken, verifyJWT } from '../../src/auth/jwt.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { credentialRevoked, enableAnonymousAuth, initSessionAuth, isAnonymousMode, optionalAuth, requireAuth } from '../../src/auth/middleware.js';
import { runAsNode, setThisNodeId } from '../../src/utils/gaii.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE_A = 'aimeat-auth-node-a';
const NODE_B = 'aimeat-auth-node-b';
/** Every account here was made long before any credential. */
const LONG_AGO = '2026-01-01T00:00:00.000Z';

/** One node's store: its accounts, the sessions it ended, a personal access token, and what it records. */
function nodeStore(opts: { accounts: string[]; endedSessions?: string[]; disabled?: string[]; patOwner?: string }) {
    const revokedTokens = new Set<string>();
    const lastSeen: string[] = [];
    const store = {
        revokedTokens,
        lastSeen,
        getOwner: async (name: string) => (opts.accounts.includes(name)
            ? { name, roles: ['owner'], createdAt: LONG_AGO, disabledAt: opts.disabled?.includes(name) ? LONG_AGO : null }
            : null),
        isSessionRevoked: async (sessionId: string) => !!opts.endedSessions?.includes(sessionId),
        getAppGrant: async () => null,
        getEcosystemApp: async () => null,
        getAgent: async () => null,
        updateAgent: async (id: string) => { lastSeen.push(id); },
        isTokenRevoked: async (id: string) => revokedTokens.has(id),
        revokeToken: async (id: string) => { revokedTokens.add(id); },
        cleanExpiredRevocations: async () => {},
        getPatByHash: async () => (opts.patOwner
            ? { id: 'pat-1', owner: opts.patOwner, grantOwner: true, scopes: [], createdAt: '2026-02-01T00:00:00.000Z', expiresAt: null }
            : null),
        touchPat: async () => {},
    };
    return store;
}

// alice-a has an account on node A only, bob-b on node B only, and carol and dave on both: two people
// each, who share a name. Node A ended carol's session sid-carol-ended and deactivated its dave; node
// B did neither. Node A holds alice-a's personal access token.
const storeA = nodeStore({ accounts: ['alice-a', 'carol', 'dave'], endedSessions: ['sid-carol-ended'], disabled: ['dave'], patOwner: 'alice-a' });
const storeB = nodeStore({ accounts: ['bob-b', 'carol', 'dave'] });

const configOf = (node: string) => ({ nodeId: node, baseUrl: `http://${node}.test`, appHost: `apps.${node}.test` }) as AimeatConfig;

/** Node A's own HTTP server, with the per-request line server.ts runs every request of a node through. */
let serverA: Server;
let portA = 0;

beforeAll(async () => {
    const keys = await generateKeyPair();
    await initNodeKeys(keys.publicKey, keys.privateKey);
    // Node A registers first, node B last, as two nodes booted in one process do.
    for (const [node, store] of [[NODE_A, storeA], [NODE_B, storeB]] as const) {
        initRevocationStorage(store as unknown as Storage, node);
        initSessionAuth(store as unknown as Storage, configOf(node));
    }
    const app = express();
    app.use((_req, _res, next) => runAsNode(NODE_A, () => next()));
    app.use('/app', (req, _res, next) => { (req as unknown as { appOrigin: boolean }).appOrigin = true; next(); });
    app.use(optionalAuth());
    app.get(['/me', '/app/me'], requireAuth(), (req, res) => { res.json({ owner: req.auth!.owner }); });
    serverA = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    portA = (serverA.address() as AddressInfo).port;
});

afterAll(async () => {
    serverA.closeAllConnections();
    await new Promise((r) => serverA.close(() => r(null)));
    setThisNodeId(null);
});

/** An owner token of `name`, minted as `node` mints it, optionally naming a session. */
const ownerToken = (node: string, name: string, sessionId?: string) =>
    runAsNode(node, () => issueJWT({ sub: name, owner: name, node, roles: ['owner'], scopes: [] }, 3600, sessionId));
/** Is the credential dead, asked as `node`? */
const deadOn = async (node: string, token: string) => runAsNode(node, async () => credentialRevoked(token, (await verifyJWT(token))!));
const getOnA = (path: string, token?: string) =>
    fetch(`http://127.0.0.1:${portA}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe('the credential check of node A, while node B registered last', () => {
    it('accepts a token of an account node A holds', async () => {
        expect(await deadOn(NODE_A, await ownerToken(NODE_A, 'alice-a'))).toBe(false);
    });

    it('refuses a session node A ended, although node B has an account of the same name', async () => {
        expect(await deadOn(NODE_A, await ownerToken(NODE_A, 'carol', 'sid-carol-ended'))).toBe(true);
    });

    it('refuses a token of an account only node B holds, which node B accepts', async () => {
        const token = await ownerToken(NODE_B, 'bob-b');
        expect({ onA: await deadOn(NODE_A, token), onB: await deadOn(NODE_B, token) }).toEqual({ onA: true, onB: false });
    });

    it('files a token revoked on node A in node A\'s store', async () => {
        const token = await ownerToken(NODE_A, 'alice-a');
        await runAsNode(NODE_A, () => revokeToken(token, Math.floor(Date.now() / 1000) + 3600));
        expect({ a: storeA.revokedTokens.size, b: storeB.revokedTokens.size }).toEqual({ a: 1, b: 0 });
        expect(await deadOn(NODE_A, token)).toBe(true);
    });

    it('mints no token for an account node A deactivated, and node B mints for its own', async () => {
        await expect(ownerToken(NODE_A, 'dave')).rejects.toBeInstanceOf(AccountDisabledError);
        await expect(ownerToken(NODE_B, 'dave')).resolves.toEqual(expect.any(String));
    });
});

describe('a request to node A, while node B registered last', () => {
    it('lets in an owner token of node A, through optionalAuth and requireAuth', async () => {
        const res = await getOnA('/me', await ownerToken(NODE_A, 'alice-a'));
        expect({ status: res.status, body: await res.json() }).toEqual({ status: 200, body: { owner: 'alice-a' } });
    });

    it('lets in a personal access token node A holds', async () => {
        const res = await getOnA('/me', 'aimeat_pat_node-a-token');
        expect({ status: res.status, body: await res.json() }).toEqual({ status: 200, body: { owner: 'alice-a' } });
    });

    it('writes an agent\'s last-seen time to node A\'s store', async () => {
        const token = await runAsNode(NODE_A, () =>
            issueJWT({ sub: `bot#alice-a@${NODE_A}`, owner: 'alice-a', node: NODE_A, roles: ['agent'], scopes: ['memory:read'] }, 3600));
        const res = await getOnA('/me', token);
        expect(res.status).toBe(200);
        expect({ a: storeA.lastSeen, b: storeB.lastSeen }).toEqual({ a: [`bot#alice-a@${NODE_A}`], b: [] });
    });

    it('names node A\'s app origin in the refusal\'s discovery URL', async () => {
        const res = await getOnA('/app/me');
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toContain(`apps.${NODE_A}.test`);
    });
});

describe('anonymous mode', () => {
    it('is on for the node that switched it on and off for the other', () => {
        enableAnonymousAuth(`shared#anonymous@${NODE_A}`, 'anonymous', NODE_A);
        expect({ a: runAsNode(NODE_A, isAnonymousMode), b: runAsNode(NODE_B, isAnonymousMode) }).toEqual({ a: true, b: false });
    });
});
