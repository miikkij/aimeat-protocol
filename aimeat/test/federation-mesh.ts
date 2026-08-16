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
 *   v1.5.0 — 2026-08-12 — August 2026 audit fallout, two findings:
 *     H-2: the federated PUBLIC board is created by the OWNER session, because an agent JWT no
 *     longer carries its owner's roles. The same test now also shows the refusal is about `public`
 *     and not about `federate`.
 *     H-14: the federation ping is signed the way the heartbeat client signs it, and an unsigned
 *     ping from a known peer is asserted to be refused. The fake peer is registered with a real
 *     Ed25519 public key so there is something to verify against.
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
    process.env.AIMEAT_TEST_MODE = 'true';
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
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

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

// The fake peer needs a real key: since audit finding H-14 the node verifies the signature on a
// federation ping instead of taking the body's word for who sent it, and a peer registered with an
// empty public key can never produce one that verifies.
const fakePeerSecret = ed.utils.randomSecretKey();
const fakePeerPrivKey = Buffer.from(fakePeerSecret).toString('base64');
const fakePeerPubKey = Buffer.from(await ed.getPublicKeyAsync(fakePeerSecret)).toString('base64');

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
            public_key: fakePeerPubKey,
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

// Every peer call in this file is the suite's own operator, so requireRole('operator') on the peer
// doors has never been asked to refuse anything. These doors decide who this node federates with:
// who is on the roster, what they may replicate, and whether they stay peered at all.
let outsiderToken = '';

await test('Setup: a second owner, minted WITHOUT the operator role', async () => {
    const outsiderName = `meshoutsider${Date.now()}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: outsiderName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts2 = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, outsiderName + NODE_ID + ts2);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: outsiderName, timestamp: ts2, signature: sig }) });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    outsiderToken = tok.body.data.token;
    // The premise every assertion below rests on, read from the mint rather than from a door.
    assert(Array.isArray(tok.body.data.roles) && !tok.body.data.roles.includes('operator'),
        `the second owner must not be an operator: ${JSON.stringify(tok.body.data.roles)}`);
});

await test('A non-operator owner cannot register, read, retune or de-peer a peer → 403', async () => {
    const asOutsider = { Authorization: `Bearer ${outsiderToken}` };
    const intruderNode = `aimeat-mesh-intruder-${Date.now()}`;

    const register = await json('/v1/federation/peers', {
        method: 'POST', headers: asOutsider,
        body: JSON.stringify({ node_id: intruderNode, url: 'http://localhost:9995' }),
    });
    assert(register.status === 403, `register-peer expected 403, got ${register.status}: ${JSON.stringify(register.body.error)}`);

    const list = await json('/v1/federation/peers', { headers: asOutsider });
    assert(list.status === 403, `peer list expected 403, got ${list.status}`);
    assert(list.body.data === undefined, `no roster may leak in the error envelope: ${JSON.stringify(list.body.data)}`);

    // Aimed at the peer this suite created, so a landed write would show in the read-back below.
    const retune = await json(`/v1/federation/peers/${fakePeerNodeId}`, {
        method: 'PUT', headers: asOutsider,
        body: JSON.stringify({ share_catalogue: false, replicate_memory: false, allow_routing: false, peer_mode: 'private' }),
    });
    assert(retune.status === 403, `update-peer expected 403, got ${retune.status}: ${JSON.stringify(retune.body.error)}`);

    const depeer = await json(`/v1/federation/peers/${fakePeerNodeId}`, { method: 'DELETE', headers: asOutsider });
    assert(depeer.status === 403, `de-peer expected 403, got ${depeer.status}: ${JSON.stringify(depeer.body.error)}`);

    // Read back as the operator: the peer is still there and still tuned the way the test above left it.
    const asOperator = await json('/v1/federation/peers', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(asOperator.status === 200, `operator list: ${asOperator.status}`);
    const peers = asOperator.body.data.peers as any[];
    assert(!peers.some(p => p.node_id === intruderNode), 'the refused registration must not have created a peer');
    const ours = peers.find(p => p.node_id === fakePeerNodeId);
    assert(!!ours, `our peer must still exist: ${JSON.stringify(peers.map(p => p.node_id))}`);
    assert(ours.share_catalogue === true && ours.replicate_memory === true && ours.allow_routing === true,
        `the refused retune must not have moved anything: ${JSON.stringify(ours)}`);
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

// A PUBLIC board is the operator's to create (services/board-write.ts). This test used agentToken,
// which worked because POST /v1/auth/token copied the owner's 'owner' and 'operator' roles onto the
// agent JWT. Audit finding H-2 closed that: an agent session is exactly ['agent'] now, matching what
// device-auth, the MCP OAuth path and the refresh path always issued. So the operator credential is
// ownerToken. DO NOT switch this back to agentToken: the create would 403 again, federatedBoardId
// would stay empty, and the three board tests after it would run against `/v1/boards//visibility`.
// The two probes below say which word in the request the refusal is about: with the SAME agent
// credential a shared board is created and a public one is refused, so the gate is `public` rather
// than `federate`. The operator dimension of the same gate (a non-operator OWNER session is refused
// too) is proven in e2e-board-ttl test 35, which is where it belongs.
await test('POST /v1/boards -- create board with federate=true', async () => {
    const { status: sharedStatus, body: sharedBody } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            name: `mesh-board-fed-shared-${Date.now()}`,
            visibility: 'shared',
            description: 'A federated board an agent may create',
            federate: true,
        }),
    });
    assert(sharedStatus === 201, `agent shared+federate board: status ${sharedStatus}: ${JSON.stringify(sharedBody)}`);
    assert(sharedBody.data.federate === true, `shared board federate: ${sharedBody.data.federate}`);

    const { status: refusedStatus } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            name: `mesh-board-fed-refused-${Date.now()}`,
            visibility: 'public',
            description: 'An agent session is not an operator',
            federate: true,
        }),
    });
    assert(refusedStatus === 403, `agent public board: expected 403, got ${refusedStatus}`);

    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
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

// Owner credential again, and for a second reason: this route admits the BOARD OWNER alone, not an
// operator and not another session of the same person. The board above is the owner session's, so
// only the owner session may turn its federate flag off.
await test('PATCH /v1/boards/:id/visibility -- set federate=false', async () => {
    const { body } = await json(`/v1/boards/${federatedBoardId}/visibility`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` },
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

// The summary has three lists and the test above reads one. Agents and boards carry the same
// `federate` decision — who this node advertises to a peer — and nothing looked at either. The
// summary is computed fresh on every request (no cache), so flipping a flag and re-reading is an
// honest measurement rather than a stale one.
await test('GET /v1/federation/service-summary -- an AGENT appears only while its federate flag is on', async () => {
    const summary = () => json('/v1/federation/service-summary', { headers: { 'x-source-node': fakePeerNodeId } });

    // The suite turned this agent's federation back off above, so it must be absent right now.
    const off = await summary();
    assert(off.status === 200, `status ${off.status}`);
    assert(!(off.body.data.agents ?? []).some((a: any) => a.gaii === agentGaii),
        `an unfederated agent must not be advertised: ${JSON.stringify((off.body.data.agents ?? []).map((a: any) => a.gaii))}`);

    // POSITIVE CONTROL: turn it on and it appears — so the absence above is the flag, not an empty list.
    const on = await json(`/v1/agents/${agentName}/federate`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ federate: true }),
    });
    assert(on.body.ok === true, `enable federate: ${JSON.stringify(on.body)}`);
    const listed = await summary();
    assert((listed.body.data.agents ?? []).some((a: any) => a.gaii === agentGaii),
        `a federated agent must be advertised: ${JSON.stringify((listed.body.data.agents ?? []).map((a: any) => a.gaii))}`);

    // …and off again, so the suite leaves the flag where it found it.
    const back = await json(`/v1/agents/${agentName}/federate`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ federate: false }),
    });
    assert(back.body.ok === true, `disable federate: ${JSON.stringify(back.body)}`);
    const gone = await summary();
    assert(!(gone.body.data.agents ?? []).some((a: any) => a.gaii === agentGaii), 'and it stops being advertised again');
});

// This asked for a pong with `{ from_node }` and nothing else, which is the shape audit finding
// H-14 refuses: a liveness signal used to be taken on the body's word alone and it wrote
// status = 'active', so one unauthenticated request from anywhere cancelled a de-peering the
// operator had started. The heartbeat client in services/federation.ts has always signed this
// payload, so the test signs the same fields in the same order the client sends them. The unsigned
// arm below is the rule itself: a known peer that does not sign gets 401, not a pong.
await test('POST /v1/federation/ping -- signed ping pongs, unsigned is refused', async () => {
    const pingPayload = {
        node_id: fakePeerNodeId,
        timestamp: new Date().toISOString(),
        version: 'v1',
        software_version: '0.0.0-mesh-test',
        stats: { agents_active: 0, actions_published: 0, uptime_hours: 0, catalogue_hash: 'mesh-test' },
    };
    const signature = await signMsg(fakePeerPrivKey, JSON.stringify(pingPayload));
    const { status, body } = await json('/v1/federation/ping', {
        method: 'POST',
        body: JSON.stringify({ ...pingPayload, signature }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.pong === true, 'pong is true');
    assert(typeof body.data.service_summary_hash === 'string', `service_summary_hash is string: ${body.data.service_summary_hash}`);

    const { status: unsignedStatus, body: unsignedBody } = await json('/v1/federation/ping', {
        method: 'POST',
        body: JSON.stringify({ from_node: fakePeerNodeId }),
    });
    assert(unsignedStatus === 401, `unsigned ping: expected 401, got ${unsignedStatus}`);
    assert(unsignedBody.error?.code === 'UNAUTHORIZED', `unsigned ping code: ${unsignedBody.error?.code}`);
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

    // Verify via auth/verify -- wildcard '*' consent should let any node through
    const timestamp = new Date().toISOString();
    const { status, body } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: fedLoginPassword,
            requesting_node: 'random-new-node',
            timestamp,
        }),
    });
    assert(status === 200, `wildcard verify status ${status}: ${JSON.stringify(body)}`);
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
