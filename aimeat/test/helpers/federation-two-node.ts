/**
 * @file test/helpers/federation-two-node.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The world a federation suite needs when the shared test node cannot be it: two whole
 *   AIMEAT nodes booted IN-PROCESS on ports of their own, and a node:http peer holding an Ed25519
 *   keypair the suite controls.
 *
 *   WHY A REAL SECOND NODE. Half of the federation code only runs when something on the other end
 *   answers, and the shared runner node has exactly one of itself. Two in-process nodes cost about a
 *   second and give a genuine socket between them, so a refused signature is refused over the wire
 *   rather than in a stub.
 *
 *   WHY A THIRD, FAKE PEER. A node cannot hand a suite its own private key, so nothing driven
 *   through two real nodes can present a settlement SIGNED as a peer. The fake peer's key is the
 *   suite's, and its `modes` switch lets the far end answer 500 on demand — which is how a failure
 *   branch gets a real non-2xx instead of a mocked return value. Every request it receives is
 *   recorded in `seen`, so an OUTBOUND body can be held to what the signing code claims to send.
 *
 *   ONE NODE ID, ONE NODE KEY. Since 2026-09-03 the key file path carries the node id
 *   ($HOME/.aimeat/nodes/<nodeId>/node-key.json), so two nodes booted here sign as themselves.
 *   Give each suite node ids of its own and assert the two public keys differ, or a cross-node
 *   signature test proves nothing.
 *
 * @structure NodeState · bootNode() · setupOperator() · addPeer() · startFakePeer() with `modes`
 *   and `seen` · makeJson()/auth() request helpers
 * @usage
 *   const A = await bootNode(40322, 'aimeat-test-001-seta', { packageFederationEnabled: true });
 *   const fake = await startFakePeer();
 *   await addPeer(A, 'aimeat-fake-001', fake.url, peerPublicKey);
 * @version-history
 *   v1.0.0 — 2026-09-08 — Extracted from test/e2e-federation-settlements-sync.ts.
 */

import { randomBytes } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createServer } from '../../src/server.js';
import { loadConfig } from '../../src/config.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

export type Json = (p: string, o?: RequestInit) => Promise<{ status: number; body: any }>;

/** Bearer header, spelled once. */
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

export function makeJson(baseUrl: string): Json {
    return async (path, opts: RequestInit = {}) => {
        const res = await fetch(`${baseUrl}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = res.status === 204 ? null : ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        return { status: res.status, body };
    };
}

export interface NodeState {
    server: Server;
    config: AimeatConfig;
    storage: Storage;
    baseUrl: string;
    nodeId: string;
    adminPw: string;
    ownerName: string;
    ownerGhii: string;
    ownerToken: string;
    /** This node's own Ed25519 identity: the key it signs federation traffic with. */
    nodeKey: { publicKey: string; privateKey: string };
    json: Json;
}

function fail(msg: string): never { throw new Error(msg); }

/**
 * Boot one node in this process. `overrides` is applied to the config AFTER loadConfig, which is
 * where a flag the shipped default keeps off (packageFederationEnabled, say) is turned on.
 */
export async function bootNode(
    port: number, nodeId: string, overrides: Partial<AimeatConfig> = {},
): Promise<NodeState> {
    const adminPw = randomBytes(16).toString('base64url');
    process.env.AIMEAT_PORT = String(port);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
    process.env.AIMEAT_NODE_ID = nodeId;
    process.env.AIMEAT_BASE_URL = `http://localhost:${port}`;
    process.env.AIMEAT_STORAGE = 'memory';
    // A suite makes far more calls than a person would, and one 429 mid-run hides every assertion
    // after it. Same reasoning as the AIMEAT_RL_* block in .env.test.sqlite.
    process.env.AIMEAT_RL_GLOBAL = '100000';
    process.env.AIMEAT_RL_AUTH = '10000';
    process.env.AIMEAT_RL_MEMORY = '10000';

    const { config } = loadConfig({});
    config.port = port;
    config.nodeId = nodeId;
    config.baseUrl = `http://localhost:${port}`;
    config.devMode = true;
    config.testMode = true;
    config.adminPassword = adminPw;
    config.storageProvider = 'memory';
    Object.assign(config, overrides);

    const { app, storage } = await createServer(config);
    const server = await new Promise<Server>(resolve => { const s = app.listen(port, () => resolve(s)); });

    // initializeNode() is fired without being awaited by service-init, so the keypair can land a
    // tick or two after createServer() resolves. Both halves are needed: this node signs with the
    // private one, a peer pins the public one.
    let nodeKey: { publicKey: string; privateKey: string } | null = null;
    for (let i = 0; i < 100 && !nodeKey; i++) {
        nodeKey = await storage.getNodeKey();
        if (!nodeKey) await sleep(20);
    }
    if (!nodeKey) fail(`node ${nodeId} never produced a node keypair`);

    return {
        server, config, storage, baseUrl: `http://localhost:${port}`, nodeId, adminPw,
        ownerName: '', ownerGhii: '', ownerToken: '', nodeKey, json: makeJson(`http://localhost:${port}`),
    };
}

/** Register the node's first owner through the admin setup door, which always grants operator. */
export async function setupOperator(node: NodeState, ownerName: string): Promise<void> {
    const reg = await node.json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ name: ownerName }),
    });
    if (reg.status !== 200 || reg.body.ok !== true) fail(`register ${ownerName}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const tok = await node.json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': node.adminPw },
        body: JSON.stringify({ owner: ownerName, private_key: reg.body.private_key }),
    });
    if (tok.body.ok !== true) fail(`token ${ownerName}: ${JSON.stringify(tok.body)}`);
    node.ownerName = ownerName;
    node.ownerToken = tok.body.token;
    node.ownerGhii = `${ownerName}@${node.nodeId}`;
}

/** Register a peer and activate it, in the two calls the operator routes actually take. */
export async function addPeer(
    node: NodeState, nodeId: string, url: string, publicKey: string, tune: Record<string, unknown> = {},
): Promise<void> {
    const add = await node.json('/v1/federation/peers', {
        method: 'POST', headers: auth(node.ownerToken),
        body: JSON.stringify({ node_id: nodeId, url, public_key: publicKey }),
    });
    if (add.status !== 201) fail(`add peer ${nodeId} on ${node.nodeId}: ${add.status} ${JSON.stringify(add.body)}`);
    const put = await node.json(`/v1/federation/peers/${nodeId}`, {
        method: 'PUT', headers: auth(node.ownerToken), body: JSON.stringify({ status: 'active', ...tune }),
    });
    if (put.status !== 200) fail(`activate peer ${nodeId} on ${node.nodeId}: ${put.status} ${JSON.stringify(put.body)}`);
}

// ─── The fake peer: a real socket with a key the suite holds ──────────────────

/** What the far end answers. A suite flips these to turn a happy path into a refusal. */
export const modes = {
    settle: 'ok' as 'ok' | 'fail',
    catalogue: 'ok' as 'ok' | 'resync' | 'fail',
    replicate: 'ok' as 'ok' | 'fail',
};

/** Every request the fake peer received, so an outbound body can be held to what was claimed. */
export const seen: { path: string; method: string; body: any }[] = [];

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise(resolve => {
        let raw = '';
        req.on('data', c => { raw += c.toString(); });
        req.on('end', () => resolve(raw));
    });
}
function send(res: http.ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

/**
 * A peer on an ephemeral loopback port. Every door here is one the code under test actually calls;
 * anything else gets a 200 echo, which is what makes it usable as a relay target for any path.
 *
 * GET /v1/federation/templates refuses on purpose: a sync loop has a per-peer HTTP-error branch and
 * this is the peer that exercises it. A suite that wants a served listing uses a real second node.
 */
export function startFakePeer(): Promise<{ server: Server; url: string }> {
    const server = http.createServer((req, res) => {
        void (async () => {
            const path = (req.url ?? '').split('?')[0];
            const raw = await readBody(req);
            let parsed: unknown;
            try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = { _unparsed: raw }; }
            seen.push({ path, method: req.method ?? '', body: parsed });

            if (path === '/v1/federation/settle') {
                if (modes.settle === 'fail') { send(res, 500, { ok: false, error: { code: 'PEER_BROKEN' } }); return; }
                send(res, 200, { ok: true, data: { settled: true } });
                return;
            }
            if (path === '/v1/federation/catalogue-sync') {
                if (modes.catalogue === 'fail') { send(res, 500, { ok: false, error: { code: 'PEER_BROKEN' } }); return; }
                send(res, 200, { ok: true, data: { synced: 1, updated: 0, resync_required: modes.catalogue === 'resync' } });
                return;
            }
            if (path === '/v1/federation/replicate') {
                if (modes.replicate === 'fail') { send(res, 500, { ok: false, error: { code: 'PEER_BROKEN' } }); return; }
                send(res, 200, { ok: true, data: { stored: true } });
                return;
            }
            if (path === '/v1/federation/templates') { send(res, 404, { ok: false, error: { code: 'NOT_FOUND' } }); return; }
            if (path === '/v1/work/request') { send(res, 201, { ok: true, data: { tracking_code: 'tc-fake-001' } }); return; }
            if (path.startsWith('/v1/agents/')) { send(res, 200, { ok: true, data: { agent: { gaii: decodeURIComponent(path.slice(11)) } } }); return; }
            if (path === '/v1/federation/route') { send(res, 200, { ok: true, data: { relayed: true } }); return; }
            send(res, 200, { ok: true, data: { echo: path } });
        })();
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as AddressInfo).port;
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });
}
