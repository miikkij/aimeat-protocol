/**
 * @file federation-mesh.ts
 * @description Federation Mesh Phase 1 E2E tests — per-peer policy fields, action/board/agent
 *   federate flag, and policy update persistence.
 * @version-history
 *   v1.0.0 — 2026-05-20 — Initial federation mesh E2E tests
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
