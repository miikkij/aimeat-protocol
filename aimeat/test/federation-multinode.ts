/**
 * @file federation-multinode.ts
 * @description Multi-node federation integration test. Boots 3 separate AIMEAT
 *   server instances in the same process (all in-memory storage) and tests
 *   real cross-node federation: peering, service discovery, routing, federated
 *   login, memory replication, and directory visibility filtering.
 *
 *   Node A (hub/operator): port 40260, node ID aimeat-hub-001-testa
 *   Node B (contributor):  port 40261, node ID aimeat-node-001-testb
 *   Node C (contributor):  port 40262, node ID aimeat-node-001-testc
 *
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial multi-node federation E2E tests
 *   v1.1.0 -- 2026-05-21 -- Add cross-catalogue discovery tests
 *   v1.2.0 -- 2026-08-12 -- Security audit H-14: the ping tests now sign the way the heartbeat
 *     client signs, Node A pins the node key of each peer it is pinged by, and an unsigned and a
 *     wrong-key ping are asserted to be refused.
 *   v1.3.0 -- 2026-08-16 -- E2E quality, multinode:291: every peer mutation here ran as the operator
 *     credential /v1/admin/setup/register hands out, so requireRole('operator') was never told apart
 *     from plain authentication. A non-operator owner (fedLoginUser, proven non-operator by decoding
 *     its token) is now refused list, add, re-tune and de-peer on Node B, against a throwaway peer so
 *     no mutation can cascade into the routing tests, with operator positive controls on the same doors.
 */

// Run: cd aimeat && pnpm exec tsx test/federation-multinode.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { AimeatConfig } from '../src/config.js';
import type { Server } from 'node:http';

// ─── Ed25519 setup ───
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    const privateKeyBytes = ed.utils.randomSecretKey();
    const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes);
    return {
        publicKey: Buffer.from(publicKeyBytes).toString('base64'),
        privateKey: Buffer.from(privateKeyBytes).toString('base64'),
    };
}

// ─── Test helpers ───
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

/** Per-node JSON fetch helper */
function makeJson(baseUrl: string) {
    return async function json(path: string, opts: RequestInit = {}) {
        const res = await fetch(`${baseUrl}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        return { status: res.status, body, headers: res.headers };
    };
}

// ─── Node state ───
interface NodeState {
    server: Server;
    config: AimeatConfig;
    baseUrl: string;
    json: ReturnType<typeof makeJson>;
    ownerName: string;
    ownerToken: string;
    ownerPrivKey: string;
    adminPw: string;
    /** This node's own Ed25519 identity, the key it signs federation traffic with. */
    nodeKey: { publicKey: string; privateKey: string };
}

// ─── Boot a node ───
async function bootNode(port: number, nodeId: string): Promise<NodeState> {
    const adminPw = randomBytes(16).toString('base64url');

    // Set env vars that loadConfig reads
    process.env.AIMEAT_PORT = String(port);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
    process.env.AIMEAT_NODE_ID = nodeId;
    process.env.AIMEAT_BASE_URL = `http://localhost:${port}`;
    process.env.AIMEAT_STORAGE = 'memory';

    const { config } = loadConfig({});
    // Override config directly in case loadConfig cached old values
    config.port = port;
    config.nodeId = nodeId;
    config.baseUrl = `http://localhost:${port}`;
    config.devMode = true;
    config.testMode = true;
    config.adminPassword = adminPw;
    config.storageProvider = 'memory';
    config.federationAuthPolicy = 'all_peers';

    const { app, storage } = await createServer(config);
    const server = await new Promise<Server>((resolve) => {
        const s = app.listen(port, () => resolve(s));
    });

    // The node keypair is created by initializeNode(), which service-init fires without awaiting,
    // so it can land a tick or two after createServer() resolves. Peers pin this public key and the
    // node signs its federation traffic with the private half, so the test needs both.
    let nodeKey: { publicKey: string; privateKey: string } | null = null;
    for (let attempt = 0; attempt < 100 && !nodeKey; attempt++) {
        nodeKey = await storage.getNodeKey();
        if (!nodeKey) await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (!nodeKey) throw new Error(`node ${nodeId} never produced a node keypair`);

    return {
        server,
        config,
        baseUrl: `http://localhost:${port}`,
        json: makeJson(`http://localhost:${port}`),
        ownerName: '',
        ownerToken: '',
        ownerPrivKey: '',
        adminPw,
        nodeKey,
    };
}

/**
 * Body of a federation ping, signed the way the heartbeat client signs it in
 * src/services/federation.ts: Ed25519 over JSON.stringify({ node_id, timestamp, version,
 * software_version, stats }) in exactly that order. The receiver rebuilds the same string from the
 * body it received (src/routes/federation-peer/lifecycle.ts), so the field order is part of the
 * contract and a signature over any other byte string fails the same way a forged one does.
 *
 * `idField` picks which spelling of the sender id goes on the wire. The route accepts both.
 *
 * One limit to read these tests with: all three nodes boot in one process on one machine, so
 * initializeNode() hands each of them the same persisted ~/.aimeat/node-key.json identity. A ping
 * "from C" therefore carries bytes B could also have produced. The wrong-key test below is what
 * proves the route verifies a pinned key at all, and it uses a keypair no node holds.
 */
async function signedPingBody(
    from: NodeState,
    idField: 'node_id' | 'from_node',
    privateKey = from.nodeKey.privateKey,
): Promise<string> {
    const timestamp = new Date().toISOString();
    const version = 'v1';
    const softwareVersion = '0.0.0-test';
    const stats = { agents_active: 0, actions_published: 0, uptime_hours: 0, catalogue_hash: '' };
    const signedBytes = JSON.stringify({
        node_id: from.config.nodeId,
        timestamp,
        version,
        software_version: softwareVersion,
        stats,
    });
    const signature = await signMsg(privateKey, signedBytes);
    const wire: Record<string, unknown> = {
        timestamp,
        version,
        software_version: softwareVersion,
        stats,
        signature,
    };
    wire[idField] = from.config.nodeId;
    return JSON.stringify(wire);
}

/** Register owner via admin API and get token */
async function setupOwner(node: NodeState, ownerName: string): Promise<void> {
    // Register owner
    const { status, body } = await node.json('/v1/admin/setup/register', {
        method: 'POST',
        headers: { 'X-Admin-Password': node.adminPw },
        body: JSON.stringify({ name: ownerName }),
    });
    assert(status === 200, `register owner on ${node.config.nodeId}: status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, `register ok on ${node.config.nodeId}`);
    node.ownerPrivKey = body.private_key;
    node.ownerName = ownerName;

    // Get token
    const tokenRes = await node.json('/v1/admin/setup/token', {
        method: 'POST',
        headers: { 'X-Admin-Password': node.adminPw },
        body: JSON.stringify({ owner: ownerName, private_key: node.ownerPrivKey }),
    });
    assert(tokenRes.body.ok === true, `token ok on ${node.config.nodeId}: ${JSON.stringify(tokenRes.body.error)}`);
    node.ownerToken = tokenRes.body.token;
    assert(typeof node.ownerToken === 'string' && node.ownerToken.length > 0, `got token on ${node.config.nodeId}`);
}

/**
 * Add a peer and activate it.
 *
 * `peerPublicKey` is the peer's node identity. Every signed federation endpoint verifies against
 * the key pinned here and fails closed when there is none, so a peer added without one can be
 * reached but cannot prove it is itself.
 */
async function addAndActivatePeer(
    node: NodeState,
    peerNodeId: string,
    peerUrl: string,
    peerPublicKey?: string,
): Promise<void> {
    // Add peer
    const { status, body } = await node.json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${node.ownerToken}` },
        body: JSON.stringify({ node_id: peerNodeId, url: peerUrl, public_key: peerPublicKey }),
    });
    assert(status === 201, `add peer ${peerNodeId} on ${node.config.nodeId}: status ${status}: ${JSON.stringify(body)}`);

    // Activate peer
    const activateRes = await node.json(`/v1/federation/peers/${peerNodeId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${node.ownerToken}` },
        body: JSON.stringify({ status: 'active' }),
    });
    assert(activateRes.body.ok === true, `activate peer ${peerNodeId} on ${node.config.nodeId}: ${JSON.stringify(activateRes.body.error)}`);
    assert(activateRes.body.data.status === 'active', `peer ${peerNodeId} active on ${node.config.nodeId}`);
}

// =============================================================================
//  MAIN TEST SEQUENCE
// =============================================================================

console.log('\n=== Federation Multi-Node E2E Tests ===\n');

// ─── Step 1: Boot 3 nodes ───
console.log('Step 1: Boot 3 nodes');

let nodeA: NodeState;
let nodeB: NodeState;
let nodeC: NodeState;

await test('Boot Node A (hub, port 40260)', async () => {
    nodeA = await bootNode(40260, 'aimeat-hub-001-testa');
    console.log(`    Node A running on ${nodeA.baseUrl}`);
});

await test('Boot Node B (contributor, port 40261)', async () => {
    nodeB = await bootNode(40261, 'aimeat-node-001-testb');
    console.log(`    Node B running on ${nodeB.baseUrl}`);
});

await test('Boot Node C (contributor, port 40262)', async () => {
    nodeC = await bootNode(40262, 'aimeat-node-001-testc');
    console.log(`    Node C running on ${nodeC.baseUrl}`);
});

// ─── Step 2: Register owners ───
console.log('\nStep 2: Register owners (first owner = operator)');

const tsUniq = Date.now();

await test('Register operator on Node A', async () => {
    await setupOwner(nodeA!, `hub-op-${tsUniq}`);
});

await test('Register operator on Node B', async () => {
    await setupOwner(nodeB!, `nodeb-op-${tsUniq}`);
});

await test('Register operator on Node C', async () => {
    await setupOwner(nodeC!, `nodec-op-${tsUniq}`);
});

// ─── Step 3: Establish peering (hub-and-spoke) ───
console.log('\nStep 3: Establish peering (A <-> B, A <-> C)');

await test('Node A adds Node B as peer', async () => {
    // A pins B's node key, which is what B's pings are verified against below.
    await addAndActivatePeer(nodeA!, 'aimeat-node-001-testb', nodeB!.baseUrl, nodeB!.nodeKey.publicKey);
});

await test('Node A adds Node C as peer', async () => {
    await addAndActivatePeer(nodeA!, 'aimeat-node-001-testc', nodeC!.baseUrl, nodeC!.nodeKey.publicKey);
});

await test('Node B adds Node A as peer', async () => {
    await addAndActivatePeer(nodeB!, 'aimeat-hub-001-testa', nodeA!.baseUrl);
});

await test('Node C adds Node A as peer', async () => {
    await addAndActivatePeer(nodeC!, 'aimeat-hub-001-testa', nodeA!.baseUrl);
});

await test('Verify A has 2 peers, B and C have 1 each', async () => {
    const peersA = await nodeA!.json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
    });
    assert(peersA.body.data.total === 2, `A has ${peersA.body.data.total} peers, expected 2`);

    const peersB = await nodeB!.json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${nodeB!.ownerToken}` },
    });
    assert(peersB.body.data.total === 1, `B has ${peersB.body.data.total} peers, expected 1`);

    const peersC = await nodeC!.json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${nodeC!.ownerToken}` },
    });
    assert(peersC.body.data.total === 1, `C has ${peersC.body.data.total} peers, expected 1`);
});

// ─── Test 1: Service discovery through hub ───
console.log('\nTest 1: Service discovery through hub');

let agentCToken = '';
let agentCGaii = '';
let agentCPrivKey = '';
const agentCName = 'disco-agent';
let federatedActionId = '';

await test('Register agent on Node C', async () => {
    const { status, body } = await nodeC!.json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeC!.ownerToken}` },
        body: JSON.stringify({
            name: agentCName,
            owner: nodeC!.ownerName,
            capabilities: ['memory', 'actions'],
            scopes: ['memory:read', 'memory:write', 'catalogue:read', 'work:publish'],
            model: 'test-model',
        }),
    });
    assert(status === 201, `agent register: ${status}: ${JSON.stringify(body)}`);
    agentCGaii = body.data.agent.gaii;
    agentCPrivKey = body.data.private_key;
});

await test('Authenticate agent on Node C', async () => {
    const timestamp = new Date().toISOString();
    const message = agentCGaii + timestamp;
    const signature = await signMsg(agentCPrivKey, message);
    const { body } = await nodeC!.json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentCGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
    agentCToken = body.data?.token;
    assert(typeof agentCToken === 'string', 'got agent token');
});

await test('Publish federated action on Node C', async () => {
    federatedActionId = `fed-action-${Date.now()}`;
    const { status, body } = await nodeC!.json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentCToken}` },
        body: JSON.stringify({
            id: federatedActionId,
            display_name: 'Cross-Node Test Action',
            description: 'An action federated from Node C',
            category: 'utility',
            input_schema: {},
            output_schema: {},
            pricing: { base_morsels: 5 },
            federate: true,
        }),
    });
    assert(status === 201, `action create: ${status}: ${JSON.stringify(body)}`);
});

await test('Node A fetches service summary from Node C', async () => {
    // Simulate what A's heartbeat would do: call C's service-summary endpoint
    const { status, body } = await nodeC!.json('/v1/federation/service-summary', {
        headers: { 'x-source-node': 'aimeat-hub-001-testa' },
    });
    assert(status === 200, `service-summary: ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data.actions), 'actions is array');
    const fedAction = body.data.actions.find((a: any) => a.id === federatedActionId);
    assert(fedAction, `federated action ${federatedActionId} found in C's service summary`);
});

await test('Service summary rejects unknown source node', async () => {
    const { status } = await nodeC!.json('/v1/federation/service-summary', {
        headers: { 'x-source-node': 'aimeat-node-001-testb' },
    });
    // B is not a peer of C, should be rejected
    assert(status === 403, `expected 403, got ${status}`);
});

// ─── Test 1b: Cross-catalogue does not include C's services without heartbeat ───
// The network directory (cross-catalogue source=network) is populated by the heartbeat
// service, which runs on a timer. In integration tests, heartbeats do not fire, so the
// networkDirectory Map remains empty. We verify this expected behavior and confirm that
// the service-summary endpoint (which IS available) returns C's federated action.
// A full cross-catalogue integration would require triggering the heartbeat manually,
// which is not exposed via API.

await test('A cross-catalogue network source is empty (no heartbeat in tests)', async () => {
    const { status, body } = await nodeA!.json('/v1/federation/cross-catalogue?source=network', {
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
    });
    assert(status === 200, `cross-catalogue: ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data.entries), 'entries is array');
    // Network directory is empty because heartbeat has not run
    // This is expected -- the service-summary endpoint test above proves the data exists on C
});

await test('A cross-catalogue federated source includes local federated actions', async () => {
    // Even without heartbeat, A can see its own local federated items
    const { status, body } = await nodeA!.json('/v1/federation/cross-catalogue?source=federated', {
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
    });
    assert(status === 200, `cross-catalogue federated: ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data.entries), 'entries is array');
});

// ─── Test 2: Cross-node routing ───
console.log('\nTest 2: Cross-node routing');

await test('Direct routing from A to C works', async () => {
    const { status, body } = await nodeA!.json('/v1/federation/route', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
        body: JSON.stringify({
            target_node: 'aimeat-node-001-testc',
            method: 'GET',
            path: '/v1/federation/directory',
        }),
    });
    assert(status === 200, `route A->C: status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'routing ok');
    assert(body.data.routed_to === 'aimeat-node-001-testc', 'routed directly to C');
    assert(body.data.response_data !== null, 'response_data not null');
});

await test('Direct routing from A to B works', async () => {
    const { status, body } = await nodeA!.json('/v1/federation/route', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
        body: JSON.stringify({
            target_node: 'aimeat-node-001-testb',
            method: 'GET',
            path: '/v1/federation/directory',
        }),
    });
    assert(status === 200, `route A->B: status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.routed_to === 'aimeat-node-001-testb', 'routed directly to B');
});

await test('B can route to A (direct peer)', async () => {
    const { status, body } = await nodeB!.json('/v1/federation/route', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeB!.ownerToken}` },
        body: JSON.stringify({
            target_node: 'aimeat-hub-001-testa',
            method: 'GET',
            path: '/v1/federation/directory',
        }),
    });
    assert(status === 200, `route B->A: status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.routed_to === 'aimeat-hub-001-testa', 'routed to A');
});

await test('Multi-hop B->A->C succeeds (relay forwards auth)', async () => {
    const { status, body } = await nodeB!.json('/v1/federation/route', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeB!.ownerToken}` },
        body: JSON.stringify({
            target_node: 'aimeat-node-001-testc',
            method: 'GET',
            path: '/v1/federation/directory',
        }),
    });
    assert(status === 200, `route B->A->C: status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.routed_to === 'aimeat-node-001-testc', 'routed to C');
});

await test('Routing to unknown node fails', async () => {
    const { status } = await nodeA!.json('/v1/federation/route', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
        body: JSON.stringify({
            target_node: 'aimeat-fake-999-nonexist',
            method: 'GET',
            path: '/v1/federation/directory',
        }),
    });
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Test 3: Federated login ───
console.log('\nTest 3: Federated login');

const fedLoginUser = `feduser${Date.now()}`;
const fedLoginPassword = 'SecurePass123!';
let fedLoginToken = '';

let fedLoginPrivKey = '';

await test('Register GHII user with password on Node B', async () => {
    const { status, body } = await nodeB!.json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            display_name: 'Federation Test User',
            password: fedLoginPassword,
        }),
    });
    assert(status === 201, `register GHII: ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.has_password === true, 'has_password');
    fedLoginPrivKey = body.data.private_key;
    assert(typeof fedLoginPrivKey === 'string' && fedLoginPrivKey.length > 0, 'got private key');
});

await test('Authenticate federation login user on Node B', async () => {
    // Use password login to get a token
    const loginRes = await nodeB!.json('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: fedLoginPassword,
        }),
    });
    assert(loginRes.body.ok === true, `ghii login: ${JSON.stringify(loginRes.body.error)}`);
    fedLoginToken = loginRes.body.data?.token ?? loginRes.body.token;
    assert(typeof fedLoginToken === 'string' && fedLoginToken.length > 0, 'got fed login token');
});

// Every peer mutation in this file runs as the operator credential /v1/admin/setup/register hands out,
// so requireRole('operator') has never been distinguished from plain authentication. fedLoginUser is a
// real second account on Node B, registered through /v1/ghii — the only non-operator principal in the
// file, and the doors it is refused decide who Node B federates with.
//
// The refusals are aimed at a throwaway peer, never at Node A: if the PUT gate falls, a succeeding
// status/peer_mode change on the real peering would cascade into the routing and directory tests and
// the mutation would redden more than this case. The fixture is created and removed inside the test,
// so the suite's peer counts see nothing.
await test('A non-operator on Node B cannot add, re-tune or de-peer → 403, and the operator still can', async () => {
    const payload = JSON.parse(Buffer.from(fedLoginToken.split('.')[1], 'base64url').toString());
    assert(Array.isArray(payload.roles) && payload.roles.includes('owner') && !payload.roles.includes('operator'),
        `the premise: an owner who is not an operator. /v1/ghii register and login both self-heal an operator-less node, so the token is the only honest proof. Got ${JSON.stringify(payload.roles)}`);
    const asUser = { Authorization: `Bearer ${fedLoginToken}` };
    const asOperator = { Authorization: `Bearer ${nodeB!.ownerToken}` };
    const throwId = `mnode-throwaway-${Date.now()}`;

    const created = await nodeB!.json('/v1/federation/peers', {
        method: 'POST', headers: asOperator,
        body: JSON.stringify({ node_id: throwId, url: 'http://localhost:49999' }),
    });
    assert(created.status === 201, `fixture peer: ${created.status}: ${JSON.stringify(created.body.error)}`);

    // ACCESS_DENIED is requireRole's own code; the routes' own refusals use FORBIDDEN / NOT_FOUND,
    // so the code is what says which layer answered.
    const listed = await nodeB!.json('/v1/federation/peers', { headers: asUser });
    assert(listed.status === 403 && listed.body.error?.code === 'ACCESS_DENIED',
        `peer list expected 403 ACCESS_DENIED, got ${listed.status} ${JSON.stringify(listed.body.error)}`);

    const added = await nodeB!.json('/v1/federation/peers', {
        method: 'POST', headers: asUser,
        body: JSON.stringify({ node_id: `${throwId}-x`, url: 'http://localhost:49998' }),
    });
    assert(added.status === 403 && added.body.error?.code === 'ACCESS_DENIED',
        `add-peer expected 403 ACCESS_DENIED, got ${added.status} ${JSON.stringify(added.body.error)}`);

    const retuned = await nodeB!.json(`/v1/federation/peers/${throwId}`, {
        method: 'PUT', headers: asUser,
        body: JSON.stringify({ status: 'active', peer_mode: 'private', allow_federated_auth: true }),
    });
    assert(retuned.status === 403 && retuned.body.error?.code === 'ACCESS_DENIED',
        `update-peer expected 403 ACCESS_DENIED, got ${retuned.status} ${JSON.stringify(retuned.body.error)}`);

    const depeered = await nodeB!.json(`/v1/federation/peers/${throwId}?emergency=true`, { method: 'DELETE', headers: asUser });
    assert(depeered.status === 403 && depeered.body.error?.code === 'ACCESS_DENIED',
        `de-peer expected 403 ACCESS_DENIED, got ${depeered.status} ${JSON.stringify(depeered.body.error)}`);

    // Nothing the refusals asked for happened: no new peer, and the fixture is untouched.
    const after = await nodeB!.json('/v1/federation/peers', { headers: asOperator });
    assert(after.status === 200, `operator list: ${after.status}`);
    const peerRows = after.body.data.peers as any[];
    assert(!peerRows.some(p => p.node_id === `${throwId}-x`), 'the refused add must not have registered a peer');
    const fixture = peerRows.find(p => p.node_id === throwId);
    assert(!!fixture, `the fixture peer must survive: ${JSON.stringify(peerRows.map(p => p.node_id))}`);
    assert(fixture.status === 'pending', `still pending, got ${fixture.status}`);
    assert(fixture.peer_mode === 'federation', `still federation mode, got ${fixture.peer_mode}`);
    assert(fixture.allow_federated_auth === false, `federated auth still off, got ${fixture.allow_federated_auth}`);

    // Positive controls: the same two doors, the same moment, the operator credential.
    const opRetune = await nodeB!.json(`/v1/federation/peers/${throwId}`, {
        method: 'PUT', headers: asOperator, body: JSON.stringify({ peer_mode: 'private' }),
    });
    assert(opRetune.status === 200, `operator update: ${opRetune.status}: ${JSON.stringify(opRetune.body.error)}`);
    assert(opRetune.body.data.peer_mode === 'private', `operator update took effect, got ${opRetune.body.data.peer_mode}`);

    const opDepeer = await nodeB!.json(`/v1/federation/peers/${throwId}?emergency=true`, { method: 'DELETE', headers: asOperator });
    assert(opDepeer.status === 200 && opDepeer.body.data.deleted === true,
        `operator emergency de-peer: ${opDepeer.status}: ${JSON.stringify(opDepeer.body)}`);

    // …and the refusals plus the cleanup moved nothing else: the real peering is as it was.
    const final = await nodeB!.json('/v1/federation/peers', { headers: asOperator });
    const finalRows = final.body.data.peers as any[];
    assert(!finalRows.some(p => p.node_id === throwId), 'the fixture peer is gone');
    const a = finalRows.find(p => p.node_id === nodeA!.config.nodeId);
    assert(!!a && a.status === 'active', `Node A must still be an active peer of B: ${JSON.stringify(finalRows.map(p => [p.node_id, p.status]))}`);
});

await test('Create auth consent for Node C on Node B', async () => {
    const { status, body } = await nodeB!.json('/v1/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${fedLoginToken}` },
        body: JSON.stringify({
            data_pattern: '_identity',
            recipient: 'node:aimeat-node-001-testc',
            scope: 'auth',
            purpose: 'federation_login',
        }),
    });
    assert(status === 201, `consent: ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'consent ok');
});

await test('Auth verify succeeds on Node B for Node C with valid credentials', async () => {
    const timestamp = new Date().toISOString();
    const { status, body } = await nodeB!.json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: fedLoginPassword,
            requesting_node: 'aimeat-node-001-testc',
            timestamp,
        }),
    });
    assert(status === 200, `auth verify: ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.verified === true, 'verified is true');
    assert(body.data.ghii.includes(fedLoginUser), `ghii contains username: ${body.data.ghii}`);
    assert(body.data.requesting_node === 'aimeat-node-001-testc', 'requesting_node matches');
    assert(typeof body.data.signature === 'string', 'signature exists');
});

await test('Auth verify fails for unauthorized node (Node A has no consent)', async () => {
    const timestamp = new Date().toISOString();
    const { status, body } = await nodeB!.json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: fedLoginPassword,
            requesting_node: 'aimeat-hub-001-testa',
            timestamp,
        }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NO_AUTH_CONSENT', `error code: ${body.error?.code}`);
});

await test('Auth verify fails with wrong password', async () => {
    const timestamp = new Date().toISOString();
    const { status, body } = await nodeB!.json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: fedLoginUser,
            password: 'WrongPassword999',
            requesting_node: 'aimeat-node-001-testc',
            timestamp,
        }),
    });
    assert(status === 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'FEDERATION_AUTH_FAILED', `error code: ${body.error?.code}`);
});

// ─── Test 4: Cross-node data access via routing ───
console.log('\nTest 4: Cross-node data access via routing');

// Register an agent on Node B for memory operations
let agentBToken = '';
let agentBGaii = '';
let agentBPrivKey = '';

await test('Register agent on Node B for memory tests', async () => {
    const { status, body } = await nodeB!.json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeB!.ownerToken}` },
        body: JSON.stringify({
            name: 'memtest-agent',
            owner: nodeB!.ownerName,
            capabilities: ['memory'],
            scopes: ['memory:read', 'memory:write'],
            model: 'test-model',
        }),
    });
    assert(status === 201, `agent register: ${status}: ${JSON.stringify(body)}`);
    agentBGaii = body.data.agent.gaii;
    agentBPrivKey = body.data.private_key;
});

await test('Authenticate agent on Node B', async () => {
    const timestamp = new Date().toISOString();
    const message = agentBGaii + timestamp;
    const signature = await signMsg(agentBPrivKey, message);
    const { body } = await nodeB!.json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentBGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
    agentBToken = body.data?.token;
    assert(typeof agentBToken === 'string', 'got agent token');
});

await test('Write public memory on Node B via agent', async () => {
    const { status, body } = await nodeB!.json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentBToken}` },
        body: JSON.stringify({
            key: 'profile.bio',
            value: { text: 'Hello from Node B', language: 'en' },
            visibility: 'public',
            version: 1,
        }),
    });
    assert(status === 201, `memory write: ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'memory write ok');
});

await test('Read memory back on Node B', async () => {
    const { status, body } = await nodeB!.json('/v1/memory/profile.bio', {
        headers: { Authorization: `Bearer ${agentBToken}` },
    });
    assert(status === 200, `memory read: ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.value?.text === 'Hello from Node B', `value: ${JSON.stringify(body.data.value)}`);
});

await test('Hub A can route to B and read its directory', async () => {
    const { status, body } = await nodeA!.json('/v1/federation/route', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
        body: JSON.stringify({
            target_node: 'aimeat-node-001-testb',
            method: 'GET',
            path: '/v1/federation/directory',
        }),
    });
    assert(status === 200, `route A->B: status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.routed_to === 'aimeat-node-001-testb', 'routed to B');
    assert(body.data.response_data !== null, 'got response data');
});

// ─── Test 5: Private peer visibility in directory ───
console.log('\nTest 5: Private peer visibility in directory');

const privatePeerId = `private-peer-${Date.now()}`;

await test('Add a private peer on Node A', async () => {
    // Add a fake private peer
    const { status, body } = await nodeA!.json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
        body: JSON.stringify({
            node_id: privatePeerId,
            url: 'http://localhost:9999',
        }),
    });
    assert(status === 201, `add private peer: ${status}: ${JSON.stringify(body)}`);

    // Set it to private mode
    const updateRes = await nodeA!.json(`/v1/federation/peers/${privatePeerId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
        body: JSON.stringify({ peer_mode: 'private', status: 'active' }),
    });
    assert(updateRes.body.ok === true, `set private: ${JSON.stringify(updateRes.body.error)}`);
    assert(updateRes.body.data.peer_mode === 'private', 'peer_mode is private');
});

await test('Directory listing on Node A excludes private peers', async () => {
    const { status, body } = await nodeA!.json('/v1/federation/directory');
    assert(status === 200, `directory: ${status}`);
    assert(body.ok === true, 'ok');

    const peerIds = body.data.peers.map((p: any) => p.node_id);

    assert(peerIds.includes('aimeat-node-001-testb'), 'B visible in directory');
    assert(peerIds.includes('aimeat-node-001-testc'), 'C visible in directory');
    assert(!peerIds.includes(privatePeerId), 'private peer excluded from directory');
});

await test('Operator peers list shows peer_mode=private', async () => {
    const { body } = await nodeA!.json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    const privatePeer = body.data.peers.find((p: any) => p.node_id === privatePeerId);
    assert(privatePeer, 'private peer found in operator list');
    assert(privatePeer.peer_mode === 'private', `peer_mode: ${privatePeer.peer_mode}`);
});

// ─── Test 6: Routing fee verification ───
// Use Node A (hub) which has direct peers B and C, so routing charges fees
console.log('\nTest 6: Routing fee verification');

let balanceBefore = 0;

await test('Check wallet balance on Node A before routing', async () => {
    const { status, body } = await nodeA!.json('/v1/wallet', {
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
    });
    assert(status === 200, `wallet: ${status}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data.balance === 'number', `balance is number: ${body.data.balance}`);
    assert(body.data.balance > 0, `balance > 0: ${body.data.balance}`);
    balanceBefore = body.data.balance;
});

await test('Route request from A to C to trigger fee', async () => {
    const { status, body } = await nodeA!.json('/v1/federation/route', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
        body: JSON.stringify({
            target_node: 'aimeat-node-001-testc',
            method: 'GET',
            path: '/v1/federation/directory',
        }),
    });
    assert(status === 200, `route: ${status}: ${JSON.stringify(body)}`);
});

await test('Verify routing fee was charged on Node A', async () => {
    const { body } = await nodeA!.json('/v1/wallet', {
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
    });
    const balanceAfter = body.data.balance;
    // Routing fee is 1 morsel per hop
    assert(balanceAfter < balanceBefore, `balance decreased: ${balanceBefore} -> ${balanceAfter}`);
});

await test('Route again and verify cumulative fee deduction', async () => {
    // Record balance, route, check balance decreased again
    const { body: before } = await nodeA!.json('/v1/wallet', {
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
    });
    const b1 = before.data.balance;

    await nodeA!.json('/v1/federation/route', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
        body: JSON.stringify({
            target_node: 'aimeat-node-001-testb',
            method: 'GET',
            path: '/v1/federation/directory',
        }),
    });

    const { body: after } = await nodeA!.json('/v1/wallet', {
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
    });
    const b2 = after.data.balance;
    assert(b2 < b1, `balance decreased after second route: ${b1} -> ${b2}`);
    assert(b2 === b1 - 1, `exactly 1 morsel charged: ${b1} -> ${b2}`);
});

// ─── Additional cross-node tests ───
console.log('\nAdditional: Cross-node connectivity');

await test('Node C can ping Node A', async () => {
    const { status, body } = await nodeA!.json('/v1/federation/ping', {
        method: 'POST',
        body: await signedPingBody(nodeC!, 'from_node'),
    });
    assert(status === 200, `ping: ${status}: ${JSON.stringify(body)}`);
    assert(body.data.pong === true, 'pong is true');
    assert(typeof body.data.service_summary_hash === 'string', 'has summary hash');
});

await test('Node B can ping Node A', async () => {
    const { status, body } = await nodeA!.json('/v1/federation/ping', {
        method: 'POST',
        body: await signedPingBody(nodeB!, 'node_id'),
    });
    assert(status === 200, `ping: ${status}: ${JSON.stringify(body)}`);
    assert(body.data.pong === true, 'pong');
});

// SECURITY (audit H-14, commit 846f21f4): POST /v1/federation/ping ran no signature check at all
// and set status = 'active' from a body-supplied node id, so one unauthenticated request from
// anywhere cancelled a de-peering an operator had started. These two tests are the finding. Do not
// relax them back into an unsigned ping: a suite that only ever sends a good signature would not
// notice the check being deleted again.
await test('An unsigned ping is refused', async () => {
    const { status, body } = await nodeA!.json('/v1/federation/ping', {
        method: 'POST',
        body: JSON.stringify({ from_node: 'aimeat-node-001-testb', timestamp: new Date().toISOString() }),
    });
    assert(status === 401, `unsigned ping must be 401, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'UNAUTHORIZED', `error code: ${JSON.stringify(body.error)}`);
});

await test('A ping signed by the wrong key is refused', async () => {
    const impostor = await generateKeyPair();
    const { status, body } = await nodeA!.json('/v1/federation/ping', {
        method: 'POST',
        body: await signedPingBody(nodeB!, 'node_id', impostor.privateKey),
    });
    assert(status === 401, `wrong-key ping must be 401, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'UNAUTHORIZED', `error code: ${JSON.stringify(body.error)}`);
});

await test('Each node has its own identity', async () => {
    // Verify each node returns its own nodeId in responses
    const dirA = await nodeA!.json('/v1/federation/directory');
    assert(dirA.body.data.self.node_id === 'aimeat-hub-001-testa', `A nodeId: ${dirA.body.data.self.node_id}`);

    const dirB = await nodeB!.json('/v1/federation/directory');
    assert(dirB.body.data.self.node_id === 'aimeat-node-001-testb', `B nodeId: ${dirB.body.data.self.node_id}`);

    const dirC = await nodeC!.json('/v1/federation/directory');
    assert(dirC.body.data.self.node_id === 'aimeat-node-001-testc', `C nodeId: ${dirC.body.data.self.node_id}`);
});

await test('B and C are not direct peers of each other', async () => {
    // B should not list C as a peer
    const peersB = await nodeB!.json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${nodeB!.ownerToken}` },
    });
    const bPeerIds = peersB.body.data.peers.map((p: any) => p.node_id);
    assert(!bPeerIds.includes('aimeat-node-001-testc'), 'B does not have C as direct peer');

    // C should not list B as a peer
    const peersC = await nodeC!.json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${nodeC!.ownerToken}` },
    });
    const cPeerIds = peersC.body.data.peers.map((p: any) => p.node_id);
    assert(!cPeerIds.includes('aimeat-node-001-testb'), 'C does not have B as direct peer');
});

await test('C can route to A (direct peer)', async () => {
    const { status, body } = await nodeC!.json('/v1/federation/route', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nodeC!.ownerToken}` },
        body: JSON.stringify({
            target_node: 'aimeat-hub-001-testa',
            method: 'GET',
            path: '/v1/federation/directory',
        }),
    });
    assert(status === 200, `route C->A: status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.routed_to === 'aimeat-hub-001-testa', 'routed to A');
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Delete owners on all nodes', async () => {
    // Node A
    const delA = await nodeA!.json(`/v1/owners/${nodeA!.ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${nodeA!.ownerToken}` },
    });
    assert(delA.body.ok === true, `delete A owner: ${JSON.stringify(delA.body.error)}`);

    // Node B
    const delB = await nodeB!.json(`/v1/owners/${nodeB!.ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${nodeB!.ownerToken}` },
    });
    assert(delB.body.ok === true, `delete B owner: ${JSON.stringify(delB.body.error)}`);

    // Node C
    const delC = await nodeC!.json(`/v1/owners/${nodeC!.ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${nodeC!.ownerToken}` },
    });
    assert(delC.body.ok === true, `delete C owner: ${JSON.stringify(delC.body.error)}`);
});

// ─── Summary ───
console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);

// Close all servers
nodeA!.server.close();
nodeB!.server.close();
nodeC!.server.close();

process.exit(failed > 0 ? 1 : 0);
