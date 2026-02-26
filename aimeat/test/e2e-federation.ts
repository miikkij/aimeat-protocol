// T-1: Federation E2E Tests
// Run: cd aimeat && pnpm exec tsx test/e2e-federation.ts
// Requires: server running on :40251

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'meat-local-001-dev';

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
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
const ownerName = `fedowner${Date.now()}`;
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';
const agentName = 'fedagent';

let peeringRequestId = '';
let peeringRequestId2 = '';
const fakePeerNodeId = `meat-fake-peer-${Date.now()}`;
const fakePeerUrl = 'http://localhost:9999'; // non-existent, that's fine for API tests
const directPeerNodeId = `meat-direct-peer-${Date.now()}`;
const directPeerUrl = 'http://localhost:9998';

console.log('\n=== T-1: Federation E2E Tests ===\n');

// ─── Setup: Register owner + agent, get tokens ───
console.log('Setup — Owner & Agent');

await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
});

await test('Owner auth', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    ownerToken = body.data.token;
});

await test('Register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'] }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
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
    agentToken = body.data.token;
});

// ─── Phase 1: Peering Lifecycle ───
console.log('\nPhase 1 — Peering Lifecycle');

await test('1. Submit peering request', async () => {
    const { status, body } = await json('/v1/federation/peer/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            target_url: fakePeerUrl,
            target_node_id: fakePeerNodeId,
            message: 'E2E test peering',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data.request_id === 'string', 'has request_id');
    assert(body.data.status === 'pending', `status: ${body.data.status}`);
    peeringRequestId = body.data.request_id;
});

await test('2. Check request status (pending)', async () => {
    const { body } = await json(`/v1/federation/peer/request/${peeringRequestId}/status`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    assert(body.data.status === 'pending', `status: ${body.data.status}`);
    assert(body.data.id === peeringRequestId, 'id matches');
});

await test('3. Admin lists pending requests', async () => {
    const { body } = await json('/v1/admin/peering/requests', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data.requests), 'is array');
    const found = body.data.requests.find((r: any) => r.id === peeringRequestId);
    assert(found, 'pending request in list');
    assert(found.status === 'pending', `found status: ${found.status}`);
});

await test('4. Admin approves request', async () => {
    const { body } = await json(`/v1/admin/peering/requests/${peeringRequestId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ decision: 'approve' }),
    });
    assert(body.ok === true, `approve: ${JSON.stringify(body.error)}`);
    assert(body.data.status === 'approved', `status: ${body.data.status}`);
});

await test('5. Check request status (approved)', async () => {
    const { body } = await json(`/v1/federation/peer/request/${peeringRequestId}/status`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    assert(body.data.status === 'approved', `status: ${body.data.status}`);
});

await test('6. Activate peering', async () => {
    // The approve step adds the peer with the fromNodeId from the request.
    // We need to activate it using that node ID.
    const { body } = await json('/v1/federation/peer/activate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ peer_node_id: config_nodeIdFromRequest() }),
    });
    assert(body.ok === true, `activate: ${JSON.stringify(body.error)}`);
    assert(body.data.status === 'active', `status: ${body.data.status}`);
});

// Helper: the peering request's fromNodeId is set to config.nodeId by the server
function config_nodeIdFromRequest(): string {
    // The server sets fromNodeId to config.nodeId (our own node id) when creating the request.
    // So the peer was registered with key = config.nodeId = NODE_ID.
    // But that would conflict - let's check by listing peers instead.
    return NODE_ID;
}

await test('7. Submit + reject a second request', async () => {
    const { status, body } = await json('/v1/federation/peer/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            target_url: 'http://localhost:8888',
            target_node_id: 'meat-reject-test',
            message: 'This will be rejected',
        }),
    });
    assert(status === 201, `status ${status}`);
    peeringRequestId2 = body.data.request_id;

    const { body: rejBody } = await json(`/v1/admin/peering/requests/${peeringRequestId2}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ decision: 'reject', reason: 'E2E test rejection' }),
    });
    assert(rejBody.ok === true, `reject: ${JSON.stringify(rejBody.error)}`);
    assert(rejBody.data.status === 'rejected', `status: ${rejBody.data.status}`);

    // Verify status is rejected
    const { body: sBody } = await json(`/v1/federation/peer/request/${peeringRequestId2}/status`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(sBody.data.status === 'rejected', `check rejected: ${sBody.data.status}`);
});

// ─── Phase 2: Peer Management ───
console.log('\nPhase 2 — Peer Management');

await test('8. Register peer manually', async () => {
    const { status, body } = await json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            node_id: directPeerNodeId,
            url: directPeerUrl,
            public_key: 'abc123pubkey',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.peer.node_id === directPeerNodeId, 'node_id matches');
    assert(body.data.peer.status === 'pending', `status: ${body.data.peer.status}`);
});

await test('9. List peers', async () => {
    const { body } = await json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data.peers), 'is array');
    const found = body.data.peers.find((p: any) => p.node_id === directPeerNodeId);
    assert(found, 'direct peer in list');
});

await test('10. Update peer info', async () => {
    const { body } = await json(`/v1/federation/peers/${directPeerNodeId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: 'http://localhost:9997', status: 'active' }),
    });
    assert(body.ok === true, `update: ${JSON.stringify(body.error)}`);
    assert(body.data.updated === true, 'updated flag');
    assert(body.data.status === 'active', `status: ${body.data.status}`);
});

await test('11. Heartbeat', async () => {
    const { body } = await json('/v1/federation/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
            from_node_id: directPeerNodeId,
            timestamp: new Date().toISOString(),
            status: 'healthy',
        }),
    });
    assert(body.ok === true, 'ok');
    assert(body.data.node_id === NODE_ID, `node_id: ${body.data.node_id}`);
    assert(body.data.status === 'healthy', `status: ${body.data.status}`);
});

// ─── Phase 3: Data Replication & Catalogue Sync ───
console.log('\nPhase 3 — Data Replication & Catalogue Sync');

await test('12. Replicate memory entry', async () => {
    const { body } = await json('/v1/federation/replicate', {
        method: 'POST',
        body: JSON.stringify({
            source_node: directPeerNodeId,
            gaii: agentGaii,
            key: 'shared-pref',
            value: { theme: 'dark' },
            visibility: 'public',
            version: 1,
            timestamp: new Date().toISOString(),
        }),
    });
    assert(body.ok === true, `replicate: ${JSON.stringify(body.error)}`);
    assert(body.data.replicated === true, 'replicated flag');
    assert(body.data.key.startsWith('replica:'), `key prefix: ${body.data.key}`);
    assert(body.data.source_node === directPeerNodeId, 'source matches');
    assert(body.data.version === 1, 'version matches');
});

await test('13. Catalogue sync (full)', async () => {
    const { body } = await json('/v1/federation/catalogue-sync', {
        method: 'POST',
        body: JSON.stringify({
            source_node: directPeerNodeId,
            actions: [
                {
                    id: 'remote-action-1',
                    provider_gaii: `remoteagent#remoteowner@${directPeerNodeId}`,
                    display_name: 'Remote Summarize',
                    description: 'Summarizes text remotely',
                    category: 'nlp',
                    pricing: { base_morsels: 5 },
                    tags: ['nlp', 'summarize'],
                },
                {
                    id: 'remote-action-2',
                    provider_gaii: `remoteagent#remoteowner@${directPeerNodeId}`,
                    display_name: 'Remote Translate',
                    description: 'Translates text remotely',
                    category: 'nlp',
                    pricing: { base_morsels: 3 },
                    tags: ['nlp', 'translate'],
                },
            ],
        }),
    });
    assert(body.ok === true, `sync: ${JSON.stringify(body.error)}`);
    assert(body.data.synced === 2, `synced: ${body.data.synced}`);
    assert(body.data.source_node === directPeerNodeId, 'source ok');
    assert(body.data.total_received === 2, `total_received: ${body.data.total_received}`);
    assert(body.data.incremental === false, 'full sync');
});

await test('14. Catalogue sync (incremental)', async () => {
    const { body } = await json('/v1/federation/catalogue-sync', {
        method: 'POST',
        body: JSON.stringify({
            source_node: directPeerNodeId,
            since_timestamp: new Date(Date.now() - 60_000).toISOString(),
            actions: [
                {
                    id: 'remote-action-3',
                    provider_gaii: `remoteagent#remoteowner@${directPeerNodeId}`,
                    display_name: 'Remote New Action',
                    description: 'A new action',
                    category: 'misc',
                    pricing: { base_morsels: 1 },
                    tags: ['new'],
                },
            ],
        }),
    });
    assert(body.ok === true, `incremental sync: ${JSON.stringify(body.error)}`);
    assert(body.data.synced === 1, `synced: ${body.data.synced}`);
    assert(body.data.incremental === true, 'incremental flag');
});

await test('14b. Catalogue sync (update existing)', async () => {
    const { body } = await json('/v1/federation/catalogue-sync', {
        method: 'POST',
        body: JSON.stringify({
            source_node: directPeerNodeId,
            actions: [
                {
                    id: 'remote-action-1',
                    provider_gaii: `remoteagent#remoteowner@${directPeerNodeId}`,
                    display_name: 'Remote Summarize v2',
                    description: 'Updated summarizer',
                    category: 'nlp',
                    pricing: { base_morsels: 8 },
                    tags: ['nlp', 'summarize'],
                },
            ],
        }),
    });
    assert(body.ok === true, `update sync: ${JSON.stringify(body.error)}`);
    assert(body.data.updated === 1, `updated: ${body.data.updated}`);
    assert(body.data.synced === 0, `synced (new): ${body.data.synced}`);
});

// ─── Phase 4: De-peering ───
console.log('\nPhase 4 — De-peering');

// First, add a second peer for emergency de-peering test
const emergencyPeerId = `meat-emergency-peer-${Date.now()}`;
await test('Setup: register peer for emergency de-peer', async () => {
    const { status } = await json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            node_id: emergencyPeerId,
            url: 'http://localhost:9996',
        }),
    });
    assert(status === 201, `status ${status}`);

    // Activate it
    const { body: actBody } = await json(`/v1/federation/peers/${emergencyPeerId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ status: 'active' }),
    });
    assert(actBody.ok === true, 'activated');
});

await test('15. Normal de-peering (grace period)', async () => {
    const { body } = await json(`/v1/federation/peers/${directPeerNodeId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `de-peer: ${JSON.stringify(body.error)}`);
    assert(body.data.emergency === false, 'not emergency');
    assert(body.data.status === 'depeering', `status: ${body.data.status}`);
    assert(typeof body.data.grace_period_hours === 'number', 'has grace_period_hours');
    assert(typeof body.data.grace_period_ends === 'string', 'has grace_period_ends');
});

await test('16. Emergency de-peering', async () => {
    const { body } = await json(`/v1/federation/peers/${emergencyPeerId}?emergency=true`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `emergency de-peer: ${JSON.stringify(body.error)}`);
    assert(body.data.emergency === true, 'emergency flag');
    assert(body.data.deleted === true, 'deleted flag');
    assert(typeof body.data.cancelled_work_items === 'number', 'has cancelled count');
});

// ─── Phase 5: Federation Ping & Trust Advisory ───
console.log('\nPhase 5 — Ping & Trust Advisory');

await test('17. Ping endpoint', async () => {
    const { body } = await json('/v1/federation/ping', {
        method: 'POST',
        body: JSON.stringify({ from_node: 'some-external-node' }),
    });
    assert(body.ok === true, 'ok');
    assert(body.data.pong === true, 'pong');
    assert(body.data.node_id === NODE_ID, `node_id: ${body.data.node_id}`);
    assert(typeof body.data.timestamp === 'string', 'has timestamp');
});

await test('17b. Ping without body', async () => {
    const { body } = await json('/v1/federation/ping', { method: 'POST' });
    assert(body.ok === true, 'ok');
    assert(body.data.pong === true, 'pong');
});

await test('18. Trust advisory (warning)', async () => {
    const { status, body } = await json('/v1/federation/trust-advisory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            target_node: 'meat-bad-node-001',
            advisory_type: 'warning',
            reason: 'E2E test warning advisory',
        }),
    });
    assert(status === 201, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(body.data.advisory_type === 'warning', `type: ${body.data.advisory_type}`);
    assert(body.data.target_node === 'meat-bad-node-001', 'target matches');
    assert(typeof body.data.id === 'string', 'has advisory id');
});

await test('18b. Trust advisory (ban — auto de-peers)', async () => {
    // Register a peer, then ban it
    const banPeerId = `meat-ban-peer-${Date.now()}`;
    await json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ node_id: banPeerId, url: 'http://localhost:9995' }),
    });

    const { status, body } = await json('/v1/federation/trust-advisory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            target_node: banPeerId,
            advisory_type: 'ban',
            reason: 'E2E test ban',
        }),
    });
    assert(status === 201, `status ${status}`);
    assert(body.data.advisory_type === 'ban', 'ban type');

    // Verify peer is removed
    const { body: listBody } = await json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const found = listBody.data.peers.find((p: any) => p.node_id === banPeerId);
    assert(!found, 'banned peer should be removed from peer list');
});

// ─── Phase 6: Key Exchange ───
console.log('\nPhase 6 — Key Exchange');

await test('18c. Key exchange with known peer', async () => {
    // Re-register the direct peer (it was de-peered in phase 4)
    const kxPeerId = `meat-kx-peer-${Date.now()}`;
    await json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ node_id: kxPeerId, url: 'http://localhost:9994' }),
    });

    const { body } = await json('/v1/federation/key-exchange', {
        method: 'POST',
        body: JSON.stringify({
            node_id: kxPeerId,
            public_key: 'deadbeef1234567890abcdef',
            capabilities: ['memory', 'actions'],
        }),
    });
    assert(body.ok === true, `key-exchange: ${JSON.stringify(body.error)}`);
    assert(body.data.node_id === NODE_ID, `node_id: ${body.data.node_id}`);
    assert(typeof body.data.public_key === 'string', 'has public_key');
    assert(body.data.accepted === true, 'accepted');
    assert(Array.isArray(body.data.capabilities), 'has capabilities');
});

// ─── Phase 7: Error Paths ───
console.log('\nPhase 7 — Error Paths');

await test('19. Activate non-existent peering', async () => {
    const { status, body } = await json('/v1/federation/peer/activate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ peer_node_id: 'nonexistent-node-99' }),
    });
    assert(status === 404, `status ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('20. De-peer unknown node', async () => {
    const { status, body } = await json('/v1/federation/peers/nonexistent-node-99', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 404, `status ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('21. Replicate from non-peer source', async () => {
    const { status, body } = await json('/v1/federation/replicate', {
        method: 'POST',
        body: JSON.stringify({
            source_node: 'unknown-node-xyz',
            gaii: agentGaii,
            key: 'test',
            value: 'hello',
            version: 1,
        }),
    });
    assert(status === 403, `status ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('22. Catalogue sync from non-peer source', async () => {
    const { status, body } = await json('/v1/federation/catalogue-sync', {
        method: 'POST',
        body: JSON.stringify({
            source_node: 'unknown-node-xyz',
            actions: [],
        }),
    });
    assert(status === 403, `status ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('23. Key exchange with unknown peer', async () => {
    const { status, body } = await json('/v1/federation/key-exchange', {
        method: 'POST',
        body: JSON.stringify({
            node_id: 'totally-unknown-node',
            public_key: 'abcdef',
        }),
    });
    assert(status === 404, `status ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('24. Trust advisory bad type', async () => {
    const { status, body } = await json('/v1/federation/trust-advisory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            target_node: 'some-node',
            advisory_type: 'invalid_type',
            reason: 'test',
        }),
    });
    assert(status === 400, `status ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('25. Trust advisory missing fields', async () => {
    const { status, body } = await json('/v1/federation/trust-advisory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ target_node: 'some-node' }),
    });
    assert(status === 400, `status ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('26. Replicate missing fields', async () => {
    const { status, body } = await json('/v1/federation/replicate', {
        method: 'POST',
        body: JSON.stringify({ source_node: 'foo' }),
    });
    assert(status === 400, `status ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('27. Peer registration duplicate', async () => {
    // Register a new peer
    const dupId = `meat-dup-peer-${Date.now()}`;
    const { status: s1 } = await json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ node_id: dupId, url: 'http://localhost:9993' }),
    });
    assert(s1 === 201, `first create: ${s1}`);

    // Try to register same again
    const { status: s2, body } = await json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ node_id: dupId, url: 'http://localhost:9992' }),
    });
    assert(s2 === 409, `duplicate: ${s2}`);
    assert(body.ok === false, 'not ok');
});

await test('28. Peer registration missing fields', async () => {
    const { status } = await json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ node_id: 'only-node-id' }),
    });
    assert(status === 400, `status ${status}`);
});

await test('29. Update non-existent peer', async () => {
    const { status } = await json('/v1/federation/peers/nonexistent-node-xyz', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: 'http://new-url' }),
    });
    assert(status === 404, `status ${status}`);
});

await test('30. Federation directory is public', async () => {
    // No auth needed
    const { body } = await json('/v1/federation/directory');
    assert(body.ok === true, 'ok');
    assert(body.data.self.node_id === NODE_ID, `node_id: ${body.data.self.node_id}`);
    assert(Array.isArray(body.data.peers), 'has peers array');
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
process.exit(failed > 0 ? 1 : 0);
