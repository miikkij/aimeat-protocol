/**
 * @file federation-mesh.ts
 * @description Federation Mesh E2E tests — per-peer policy fields, action/board/agent
 *   federate flag, policy update persistence, and network directory (service summary,
 *   ping hash, cross-catalogue filtering).
 * @version-history
 *   v1.0.0 — 2026-05-20 — Initial federation mesh E2E tests
 *   v1.1.0 — 2026-05-20 — Add network directory tests (Phase 2 Task 6)
 *   v1.2.0 — 2026-05-21 — Add federated login E2E tests (Phase 3 Task 6)
 *   v1.3.0 — 2026-05-21 — Add cross-node data access tests (Phase 4 Task 4)
 *   v1.4.0 — 2026-05-21 — Add auth/refresh and wildcard consent tests
 */

// Run: cd aimeat && pnpm exec tsx test/federation-mesh.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Server } from 'node:http';

// ─── Boot embedded server ───
const TEST_PORT = parseInt(process.env.E2E_PORT ?? '40253', 10);
const BASE = process.env.E2E_BASE ?? `http://localhost:${TEST_PORT}`;
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let server: Server | null = null;

if (!process.env.E2E_BASE) {
    process.env.AIMEAT_PORT = String(TEST_PORT);
    process.env.AIMEAT_DEV_MODE = 'true';
    if (!process.env.AIMEAT_ADMIN_PASSWORD) {
        process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');
    }
    const { config } = loadConfig({});
    config.port = TEST_PORT;
    const { app } = await createServer(config);
    server = await new Promise<Server>((resolve) => {
        const s = app.listen(TEST_PORT, () => resolve(s));
    });
    console.log(`Test server started on port ${TEST_PORT}`);
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

// ─── Ed25519 setup ───
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';
const ownerName = `meshtest${Date.now()}`;
const agentName = 'meshagent';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? '';
let isOperator = false;

const fakePeerNodeId = `aimeat-mesh-peer-${Date.now()}`;
const fakePeerUrl = 'http://localhost:9999';

console.log('\n=== Federation Mesh Phase 1 E2E Tests ===\n');

// ─── Setup: Register owner + agent, get tokens ───
console.log('Setup -- Owner & Agent');

await test('Register owner', async () => {
    if (ADMIN_PW) {
        const { status, body } = await json('/v1/admin/setup/register', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ name: ownerName }),
        });
        assert(status === 200, `admin register status ${status}: ${JSON.stringify(body)}`);
        assert(body.ok === true, 'ok');
        ownerPrivKey = body.private_key;
        isOperator = true;
    } else {
        const { status, body } = await json('/v1/owners', {
            method: 'POST',
            body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.ok === true, 'ok');
        ownerPrivKey = body.data.private_key;
    }
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got owner private key');
});

await test('Owner auth', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);

    if (ADMIN_PW && isOperator) {
        const { body } = await json('/v1/admin/setup/token', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ owner: ownerName, private_key: ownerPrivKey }),
        });
        assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
        ownerToken = body.token;
    } else {
        const { body } = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: ownerName, timestamp, signature }),
        });
        assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
        ownerToken = body.data?.token;
        if (body.data?.roles?.includes('operator')) isOperator = true;
    }
    assert(typeof ownerToken === 'string', 'got owner token');
});

await test('Register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['memory', 'actions', 'social'],
            scopes: ['memory:read', 'memory:write', 'memory:delete', 'catalogue:read', 'work:publish', 'work:request', 'social:read', 'social:write'],
            model: 'test-model',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.agent?.gaii?.includes(agentName), 'gaii contains agent name');
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    assert(typeof agentPrivKey === 'string', 'got agent private key');
});

await test('Agent auth', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
    agentToken = body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

// ─── Test: Peer policy defaults ───
console.log('\nPeer Policy Defaults');

await test('POST /v1/federation/peers -- add peer', async () => {
    const { status, body } = await json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            node_id: fakePeerNodeId,
            url: fakePeerUrl,
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.peer.node_id === fakePeerNodeId, 'node_id matches');
});

await test('GET /v1/federation/peers -- default policy values', async () => {
    const { body } = await json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data.peers), 'peers is array');
    const peer = body.data.peers.find((p: any) => p.node_id === fakePeerNodeId);
    assert(peer, 'peer found in list');
    assert(peer.share_catalogue === true, `share_catalogue default: ${peer.share_catalogue}`);
    assert(peer.replicate_memory === true, `replicate_memory default: ${peer.replicate_memory}`);
    assert(peer.allow_routing === true, `allow_routing default: ${peer.allow_routing}`);
    assert(peer.peer_mode === 'federation', `peer_mode default: ${peer.peer_mode}`);
});

// ─── Test: Peer policy update ───
console.log('\nPeer Policy Update');

await test('PUT /v1/federation/peers/:nodeId -- update policy', async () => {
    const { body } = await json(`/v1/federation/peers/${fakePeerNodeId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ share_catalogue: false, peer_mode: 'private' }),
    });
    assert(body.ok === true, `update: ${JSON.stringify(body.error)}`);
    assert(body.data.updated === true, 'updated flag');
    assert(body.data.share_catalogue === false, `share_catalogue: ${body.data.share_catalogue}`);
    assert(body.data.peer_mode === 'private', `peer_mode: ${body.data.peer_mode}`);
});

await test('GET /v1/federation/peers -- verify policy persisted', async () => {
    const { body } = await json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    const peer = body.data.peers.find((p: any) => p.node_id === fakePeerNodeId);
    assert(peer, 'peer found');
    assert(peer.share_catalogue === false, `share_catalogue persisted: ${peer.share_catalogue}`);
    assert(peer.peer_mode === 'private', `peer_mode persisted: ${peer.peer_mode}`);
    // Others should remain at defaults
    assert(peer.replicate_memory === true, `replicate_memory unchanged: ${peer.replicate_memory}`);
    assert(peer.allow_routing === true, `allow_routing unchanged: ${peer.allow_routing}`);
});

await test('PUT /v1/federation/peers/:nodeId -- update remaining policies', async () => {
    const { body } = await json(`/v1/federation/peers/${fakePeerNodeId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ replicate_memory: false, allow_routing: false }),
    });
    assert(body.ok === true, `update: ${JSON.stringify(body.error)}`);
    assert(body.data.replicate_memory === false, `replicate_memory: ${body.data.replicate_memory}`);
    assert(body.data.allow_routing === false, `allow_routing: ${body.data.allow_routing}`);
});

await test('PUT /v1/federation/peers/:nodeId -- restore to federation mode', async () => {
    const { body } = await json(`/v1/federation/peers/${fakePeerNodeId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            share_catalogue: true,
            replicate_memory: true,
            allow_routing: true,
            peer_mode: 'federation',
        }),
    });
    assert(body.ok === true, `restore: ${JSON.stringify(body.error)}`);
    assert(body.data.share_catalogue === true, 'share_catalogue restored');
    assert(body.data.replicate_memory === true, 'replicate_memory restored');
    assert(body.data.allow_routing === true, 'allow_routing restored');
    assert(body.data.peer_mode === 'federation', 'peer_mode restored');
});

// ─── Test: Action federate flag ───
console.log('\nAction Federate Flag');

let federatedActionId = '';
let unfederatedActionId = '';

await test('POST /v1/actions -- create action with federate=true', async () => {
    const { status, body } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            id: `mesh-action-fed-${Date.now()}`,
            display_name: 'Federated Action',
            description: 'An action with federation enabled',
            category: 'utility',
            input_schema: {},
            output_schema: {},
            pricing: { base_morsels: 5 },
            federate: true,
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    federatedActionId = body.data.action?.id || body.data.id;
    assert(federatedActionId, 'got action id');
});

await test('POST /v1/actions -- create action without federate (default false)', async () => {
    const { status, body } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            id: `mesh-action-nofed-${Date.now()}`,
            display_name: 'Local Action',
            description: 'An action without federation',
            category: 'utility',
            input_schema: {},
            output_schema: {},
            pricing: { base_morsels: 3 },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    unfederatedActionId = body.data.action?.id || body.data.id;
    assert(unfederatedActionId, 'got action id');
});

await test('GET /v1/actions -- verify federate flags in listing', async () => {
    const { body } = await json('/v1/actions', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data.actions), 'actions is array');

    const fedAction = body.data.actions.find((a: any) => a.id === federatedActionId);
    assert(fedAction, `federated action found: ${federatedActionId}`);
    assert(fedAction.federate === true, `federated action federate: ${fedAction.federate}`);

    const nofedAction = body.data.actions.find((a: any) => a.id === unfederatedActionId);
    assert(nofedAction, `unfederated action found: ${unfederatedActionId}`);
    assert(nofedAction.federate === false, `unfederated action federate: ${nofedAction.federate}`);
});

// ─── Test: Board federate flag ───
console.log('\nBoard Federate Flag');

let federatedBoardId = '';

await test('POST /v1/boards -- create board with federate=true', async () => {
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            name: `mesh-board-fed-${Date.now()}`,
            visibility: 'public',
            description: 'A federated board',
            federate: true,
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    federatedBoardId = body.data.id;
    assert(federatedBoardId, 'got board id');
    assert(body.data.federate === true, `board federate on create: ${body.data.federate}`);
});

await test('GET /v1/boards -- verify federate=true in listing', async () => {
    const { body } = await json('/v1/boards', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data.boards), 'boards is array');

    const board = body.data.boards.find((b: any) => b.id === federatedBoardId);
    assert(board, 'federated board found');
    assert(board.federate === true, `board federate in listing: ${board.federate}`);
});

await test('PATCH /v1/boards/:id/visibility -- set federate=false', async () => {
    const { body } = await json(`/v1/boards/${federatedBoardId}/visibility`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ federate: false }),
    });
    assert(body.ok === true, `update: ${JSON.stringify(body.error)}`);
    assert(body.data.federate === false, `board federate after update: ${body.data.federate}`);
});

await test('GET /v1/boards -- verify federate=false after update', async () => {
    const { body } = await json('/v1/boards', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(body.ok === true, 'ok');
    const board = body.data.boards.find((b: any) => b.id === federatedBoardId);
    assert(board, 'board found');
    assert(board.federate === false, `board federate after update in listing: ${board.federate}`);
});

// ─── Test: Agent federate toggle ───
console.log('\nAgent Federate Toggle');

await test('GET /v1/agents -- agent defaults to federate=false', async () => {
    const { body } = await json('/v1/agents', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    const agents = body.data.agents || [];
    const agent = agents.find((a: any) => a.name === agentName);
    assert(agent, 'agent found');
    assert(agent.federate === false, `agent federate default: ${agent.federate}`);
});

await test('PATCH /v1/agents/:name/federate -- enable federation', async () => {
    const { body } = await json(`/v1/agents/${agentName}/federate`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ federate: true }),
    });
    assert(body.ok === true, `toggle: ${JSON.stringify(body.error)}`);
    assert(body.data.federate === true, `agent federate after toggle: ${body.data.federate}`);
});

await test('GET /v1/agents -- verify federate=true persisted', async () => {
    const { body } = await json('/v1/agents', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    const agent = (body.data.agents || []).find((a: any) => a.name === agentName);
    assert(agent, 'agent found');
    assert(agent.federate === true, `agent federate persisted: ${agent.federate}`);
});

await test('PATCH /v1/agents/:name/federate -- disable federation', async () => {
    const { body } = await json(`/v1/agents/${agentName}/federate`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ federate: false }),
    });
    assert(body.ok === true, `toggle back: ${JSON.stringify(body.error)}`);
    assert(body.data.federate === false, `agent federate after toggle back: ${body.data.federate}`);
});

// ─── Test: Network Directory ───
console.log('\nNetwork Directory');

await test('GET /v1/federation/service-summary -- requires x-source-node header', async () => {
    const { status, body } = await json('/v1/federation/service-summary');
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false, 'ok is false');
});

await test('GET /v1/federation/service-summary -- requires active peer', async () => {
    const { status, body } = await json('/v1/federation/service-summary', {
        headers: { 'x-source-node': 'unknown-node' },
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false, 'ok is false');
});

await test('PUT /v1/federation/peers/:nodeId -- activate peer for service-summary', async () => {
    const { body } = await json(`/v1/federation/peers/${fakePeerNodeId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ status: 'active' }),
    });
    assert(body.ok === true, `activate peer: ${JSON.stringify(body.error)}`);
    assert(body.data.status === 'active', `peer status: ${body.data.status}`);
});

await test('GET /v1/federation/service-summary -- returns correct data', async () => {
    const { status, body } = await json('/v1/federation/service-summary', {
        headers: { 'x-source-node': fakePeerNodeId },
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data.node_id === 'string', `node_id is string: ${body.data.node_id}`);
    assert(typeof body.data.summary_hash === 'string', `summary_hash is string: ${body.data.summary_hash}`);
    assert(Array.isArray(body.data.actions), 'actions is array');
    assert(Array.isArray(body.data.agents), 'agents is array');
    assert(Array.isArray(body.data.boards), 'boards is array');
    assert(Array.isArray(body.data.csms), 'csms is array');
});

await test('GET /v1/federation/service-summary -- includes only federated items', async () => {
    const { status, body } = await json('/v1/federation/service-summary', {
        headers: { 'x-source-node': fakePeerNodeId },
    });
    assert(status === 200, `expected 200, got ${status}`);

    const actionIds = body.data.actions.map((a: any) => a.id);
    assert(actionIds.includes(federatedActionId), `federated action ${federatedActionId} should be in summary`);
    assert(!actionIds.includes(unfederatedActionId), `unfederated action ${unfederatedActionId} should NOT be in summary`);
});

await test('POST /v1/federation/ping -- response includes service_summary_hash', async () => {
    const { status, body } = await json('/v1/federation/ping', {
        method: 'POST',
        body: JSON.stringify({ from_node: fakePeerNodeId }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.pong === true, 'pong is true');
    assert(typeof body.data.service_summary_hash === 'string', `service_summary_hash is string: ${body.data.service_summary_hash}`);
});

await test('GET /v1/federation/cross-catalogue -- supports source=network filter', async () => {
    const { status, body } = await json('/v1/federation/cross-catalogue?source=network', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data.entries), 'entries is array');
});

// ─── Test: Federated Login ───
console.log('\nFederated Login');

// The main test owner was registered via admin API (no password hash).
// Federation auth/verify requires a password hash, so we register a separate
// GHII user with a password specifically for these tests.
const fedLoginUser = `fedlogin${Date.now()}`;
const fedLoginPassword = 'FedTest1234';
let fedLoginToken = '';
let fedLoginPrivKey = '';

await test('Register GHII with password for federation auth tests', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            display_name: fedLoginUser,
            password: fedLoginPassword,
        }),
    });
    assert(status === 201, `register status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.has_password === true, 'has_password is true');
    fedLoginPrivKey = body.data.private_key;
    assert(typeof fedLoginPrivKey === 'string' && fedLoginPrivKey.length > 0, 'got private key');
});

await test('Authenticate federation login user', async () => {
    const timestamp = new Date().toISOString();
    const message = fedLoginUser + NODE_ID + timestamp;
    const signature = await signMsg(fedLoginPrivKey, message);

    // Use admin token endpoint if available, otherwise standard auth
    if (ADMIN_PW) {
        const { body } = await json('/v1/admin/setup/token', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ owner: fedLoginUser, private_key: fedLoginPrivKey }),
        });
        assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
        fedLoginToken = body.token;
    } else {
        const { body } = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: fedLoginUser, timestamp, signature }),
        });
        assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
        fedLoginToken = body.data?.token;
    }
    assert(typeof fedLoginToken === 'string', 'got token');
});

await test('Create auth consent for test node', async () => {
    const { status, body } = await json('/v1/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${fedLoginToken}` },
        body: JSON.stringify({
            data_pattern: '_identity',
            recipient: 'node:test-remote-node',
            scope: 'auth',
            purpose: 'federation_login',
        }),
    });
    assert(status === 201, `consent status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
});

await test('Auth verify succeeds with valid credentials + auth consent', async () => {
    const timestamp = new Date().toISOString();
    const { status, body } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: fedLoginPassword,
            requesting_node: 'test-remote-node',
            timestamp,
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.verified === true, 'verified is true');
    assert(typeof body.data.ghii === 'string' && body.data.ghii.includes(fedLoginUser), `ghii contains username: ${body.data.ghii}`);
    assert(typeof body.data.home_node === 'string', 'home_node exists');
    assert(body.data.requesting_node === 'test-remote-node', 'requesting_node matches');
    assert(typeof body.data.signature === 'string', 'signature exists');
    assert(typeof body.data.issued_at === 'string', 'issued_at exists');
    assert(typeof body.data.expires_at === 'string', 'expires_at exists');
    assert(Array.isArray(body.data.scopes), 'scopes is an array');
});

await test('Auth verify fails without auth consent (unauthorized node)', async () => {
    const timestamp = new Date().toISOString();
    const { status, body } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: fedLoginPassword,
            requesting_node: 'unauthorized-node',
            timestamp,
        }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false, 'ok is false');
    assert(body.error?.code === 'NO_AUTH_CONSENT', `error code: ${body.error?.code}`);
});

await test('Auth verify fails with wrong password', async () => {
    const timestamp = new Date().toISOString();
    const { status, body } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: 'WrongPassword99',
            requesting_node: 'test-remote-node',
            timestamp,
        }),
    });
    assert(status === 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false, 'ok is false');
    assert(body.error?.code === 'FEDERATION_AUTH_FAILED', `error code: ${body.error?.code}`);
});

await test('Auth verify fails with nonexistent user', async () => {
    const timestamp = new Date().toISOString();
    const { status, body } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: 'nonexistent_user_xyz',
            password: 'SomePassword1',
            requesting_node: 'test-remote-node',
            timestamp,
        }),
    });
    assert(status === 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false, 'ok is false');
    assert(body.error?.code === 'FEDERATION_AUTH_FAILED', `error code: ${body.error?.code}`);
});

await test('Auth verify fails with missing fields', async () => {
    // Missing password
    const { status: s1 } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            requesting_node: 'test-remote-node',
            timestamp: new Date().toISOString(),
        }),
    });
    assert(s1 === 400, `missing password: expected 400, got ${s1}`);

    // Missing username
    const { status: s2 } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            password: fedLoginPassword,
            requesting_node: 'test-remote-node',
            timestamp: new Date().toISOString(),
        }),
    });
    assert(s2 === 400, `missing username: expected 400, got ${s2}`);

    // Missing requesting_node
    const { status: s3 } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: fedLoginPassword,
            timestamp: new Date().toISOString(),
        }),
    });
    assert(s3 === 400, `missing requesting_node: expected 400, got ${s3}`);

    // Missing timestamp
    const { status: s4 } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: fedLoginPassword,
            requesting_node: 'test-remote-node',
        }),
    });
    assert(s4 === 400, `missing timestamp: expected 400, got ${s4}`);
});

await test('Auth verify fails with expired timestamp', async () => {
    // Timestamp 10 minutes in the past (beyond the 5-minute window)
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { status, body } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: fedLoginPassword,
            requesting_node: 'test-remote-node',
            timestamp: oldTimestamp,
        }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false, 'ok is false');
    assert(body.error?.code === 'INVALID_TIMESTAMP', `error code: ${body.error?.code}`);
});

await test('Data consent does not grant auth access (scope isolation)', async () => {
    // Create a data/federation consent for a different node (NOT auth scope)
    const { status: consentStatus, body: consentBody } = await json('/v1/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${fedLoginToken}` },
        body: JSON.stringify({
            data_pattern: 'profile.*',
            recipient: 'node:data-only-node',
            scope: 'federation',
            purpose: 'data_sharing',
        }),
    });
    assert(consentStatus === 201, `consent created: ${consentStatus}: ${JSON.stringify(consentBody)}`);

    const timestamp = new Date().toISOString();
    const { status, body } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: fedLoginPassword,
            requesting_node: 'data-only-node',
            timestamp,
        }),
    });
    assert(status === 403, `expected 403 (data consent should NOT grant auth), got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NO_AUTH_CONSENT', `error code: ${body.error?.code}`);
});

// ─── Test: Auth Refresh ───
console.log('\nAuth Refresh');

// Construct the GHII for the federation login user (matches what the server builds)
const fedLoginGhii = `${fedLoginUser.toLowerCase().trim()}@${NODE_ID}`;

await test('Auth refresh succeeds with valid consent', async () => {
    const timestamp = new Date().toISOString();
    const { status, body } = await json('/v1/federation/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({
            ghii: fedLoginGhii,
            requesting_node: 'test-remote-node',
            timestamp,
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.verified === true, `verified: ${body.data.verified}`);
    assert(typeof body.data.ghii === 'string' && body.data.ghii.includes(fedLoginUser), `ghii: ${body.data.ghii}`);
    assert(typeof body.data.signature === 'string' && body.data.signature.length > 0, 'signature exists');
});

await test('Auth refresh fails without consent (unauthorized node)', async () => {
    const timestamp = new Date().toISOString();
    const { status, body } = await json('/v1/federation/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({
            ghii: fedLoginGhii,
            requesting_node: 'unauthorized-node',
            timestamp,
        }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NO_AUTH_CONSENT', `error code: ${body.error?.code}`);
});

await test('Auth refresh fails for nonexistent user', async () => {
    const timestamp = new Date().toISOString();
    const { status, body } = await json('/v1/federation/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({
            ghii: `nonexistent@${NODE_ID}`,
            requesting_node: 'test-remote-node',
            timestamp,
        }),
    });
    assert(status === 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
});

// ─── Test: Wildcard Auth Consent ───
console.log('\nWildcard Auth Consent');

let wildcardConsentId = '';

await test('Wildcard auth consent grants access to any node', async () => {
    // Create a wildcard consent (recipient: '*')
    const { status: consentStatus, body: consentBody } = await json('/v1/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${fedLoginToken}` },
        body: JSON.stringify({
            data_pattern: '_identity',
            recipient: '*',
            scope: 'auth',
            purpose: 'federation_login_wildcard',
        }),
    });
    assert(consentStatus === 201, `wildcard consent status ${consentStatus}: ${JSON.stringify(consentBody)}`);
    assert(consentBody.ok === true, 'wildcard consent created');
    wildcardConsentId = consentBody.data?.id || consentBody.data?.consent_id || '';

    // Verify via auth/refresh (not auth/verify, which has a tight 10/min rate limit
    // and is exhausted by the preceding tests). The refresh endpoint checks the same
    // consent logic, so a wildcard '*' consent should let any node through.
    const timestamp = new Date().toISOString();
    const { status, body } = await json('/v1/federation/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({
            ghii: fedLoginGhii,
            requesting_node: 'random-new-node',
            timestamp,
        }),
    });
    assert(status === 200, `wildcard refresh status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.verified === true, 'verified via wildcard consent');

    // Cleanup: revoke the wildcard consent
    if (wildcardConsentId) {
        const { body: revokeBody } = await json(`/v1/consent/${wildcardConsentId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${fedLoginToken}` },
        });
        assert(revokeBody.ok === true, `wildcard consent revoked: ${JSON.stringify(revokeBody.error)}`);
    }
});

// NOTE: "Federated session blocked from operator actions" test is skipped.
// Single-node tests cannot produce a real federated JWT (it would be issued by a remote
// node's /v1/federation/auth/verify and contain home_node != this node). Testing this
// requires the multi-node test suite (federation-multinode.ts).

await test('Delete federation login user (cleanup)', async () => {
    const { body } = await json(`/v1/owners/${fedLoginUser}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `delete: ${JSON.stringify(body.error)}`);
    assert(body.data.deleted === true, 'confirmed deleted');
});

// ─── Test: Cross-Node Data Access ───
console.log('\nCross-Node Data Access');

await test('POST /v1/memory/pull -- requires federated session', async () => {
    const { status, body } = await json('/v1/memory/pull', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'test-key' }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NOT_FEDERATED', `code: ${body.error?.code}`);
});

await test('POST /v1/memory/push-home -- requires federated session', async () => {
    const { status, body } = await json('/v1/memory/push-home', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'test-key' }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NOT_FEDERATED', `code: ${body.error?.code}`);
});

await test('POST /v1/memory/pull -- requires auth', async () => {
    const { status } = await json('/v1/memory/pull', {
        method: 'POST',
        body: JSON.stringify({ key: 'test-key' }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('POST /v1/memory/push-home -- requires auth', async () => {
    const { status } = await json('/v1/memory/push-home', {
        method: 'POST',
        body: JSON.stringify({ key: 'test-key' }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Delete owner (cascade)', async () => {
    const { body } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `delete: ${JSON.stringify(body.error)}`);
    assert(body.data.deleted === true, 'confirmed deleted');
});

// ─── Summary ───
console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);

if (server) {
    server.close();
}

process.exit(failed > 0 ? 1 : 0);
