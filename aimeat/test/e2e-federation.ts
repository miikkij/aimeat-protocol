/**
 * @file test/e2e-federation.ts
 * @description T-1 federation E2E: peering lifecycle, data replication, catalogue sync, de-peering,
 *   trust advisories and the node's own federation surface.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=federation
 * @version-history
 *   v1.1.0 — 2026-08-16 — August 2026 test-quality audit, two findings. Phase 3b: every replication
 *     and sync in the file carried a VALID signature, and the two existing refusals are stopped
 *     earlier by the not-an-active-peer check, so the signature block itself had never answered
 *     anything — a node accepting unsigned replication from anyone who guessed a peer node id passed
 *     this suite. Adds unsigned, tampered and foreign-key cases from the KNOWN ACTIVE peer, each with
 *     a read-back proving nothing landed. Phase 6: the suite's owner is the first owner on a cleared
 *     database and therefore the operator, so peering, de-peering, peer registration, peering
 *     decisions and trust advisories were only ever exercised by a principal that could not be
 *     refused; a second plain owner is now refused all of them.
 *   v1.0.0 — pre-dates the header standard.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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
const ownerName = `fedowner${Date.now()}`;
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';
const agentName = 'fedagent';

let peeringRequestId = '';
let peeringRequestId2 = '';
const fakePeerNodeId = `aimeat-fake-peer-${Date.now()}`;
const fakePeerUrl = 'http://localhost:9999'; // non-existent, that's fine for API tests
const directPeerNodeId = `aimeat-direct-peer-${Date.now()}`;
const directPeerUrl = 'http://localhost:9998';

// Generate a real Ed25519 keypair for the direct peer (used to sign federation payloads)
const directPeerPrivKeyBytes = ed.utils.randomSecretKey();
const directPeerPubKeyBytes = await ed.getPublicKeyAsync(directPeerPrivKeyBytes);
const directPeerPrivKeyB64 = Buffer.from(directPeerPrivKeyBytes).toString('base64');
const directPeerPubKeyB64 = Buffer.from(directPeerPubKeyBytes).toString('base64');

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
            target_node_id: 'aimeat-reject-test',
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
            public_key: directPeerPubKeyB64,
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

// ─── F1: key-exchange hardening (peer-key continuity + no body-based auto-admission) ───
await test('F1: key-exchange from an UNKNOWN node (no approved request) is rejected (403)', async () => {
    const { status, body } = await json('/v1/federation/key-exchange', {
        method: 'POST',
        body: JSON.stringify({
            node_id: `aimeat-attacker-${Date.now()}`,
            node_url: 'http://localhost:9996',
            node_public_key: directPeerPubKeyB64,
            timestamp: new Date().toISOString(),
        }),
    });
    assert(status === 403, `unknown-node key-exchange should be 403 (no body-based auto-admission), got ${status} ${JSON.stringify(body)}`);
});

await test('F1: key-exchange cannot OVERWRITE an active peer key without a current-key signature (409)', async () => {
    const attackerPub = Buffer.from(await ed.getPublicKeyAsync(ed.utils.randomSecretKey())).toString('base64');
    const { status, body } = await json('/v1/federation/key-exchange', {
        method: 'POST',
        body: JSON.stringify({
            node_id: directPeerNodeId,
            node_url: directPeerUrl,
            node_public_key: attackerPub,
            timestamp: new Date().toISOString(),
        }),
    });
    assert(status === 409, `unsigned key overwrite should be 409, got ${status} ${JSON.stringify(body)}`);
    assert(body?.error?.code === 'KEY_ROTATION_DENIED', `expected KEY_ROTATION_DENIED, got ${body?.error?.code}`);
});

await test('F1: key-exchange with the SAME established key still succeeds (steady-state refresh unbroken)', async () => {
    const { status, body } = await json('/v1/federation/key-exchange', {
        method: 'POST',
        body: JSON.stringify({
            node_id: directPeerNodeId,
            node_url: directPeerUrl,
            node_public_key: directPeerPubKeyB64,
            timestamp: new Date().toISOString(),
        }),
    });
    assert(status === 200, `same-key key-exchange should pass, got ${status} ${JSON.stringify(body)}`);
    assert(body?.data?.accepted === true, `expected accepted:true, got ${JSON.stringify(body?.data)}`);
});

await test('11. Heartbeat (signed: audit H-14 refuses an unsigned one)', async () => {
    // The signature covers `${from_node_id}${timestamp}` and is verified against the peer's stored
    // key. The old gate read `if (peer.publicKey && signature)`, so omitting the signature turned
    // verification off. It is a refusal now, which makes this test the protocol it always described.
    const hbTimestamp = new Date().toISOString();
    const hbMessage = `${directPeerNodeId}${hbTimestamp}`;
    const hbSig = Buffer.from(await ed.signAsync(new TextEncoder().encode(hbMessage), directPeerPrivKeyBytes)).toString('base64');
    const { body } = await json('/v1/federation/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
            from_node_id: directPeerNodeId,
            timestamp: hbTimestamp,
            status: 'healthy',
            signature: hbSig,
        }),
    });
    assert(body.ok === true, 'ok');
    assert(body.data.node_id === NODE_ID, `node_id: ${body.data.node_id}`);
    assert(body.data.status === 'healthy', `status: ${body.data.status}`);
});

await test('11b. An UNSIGNED heartbeat from a known peer is refused (H-14)', async () => {
    const { status, body } = await json('/v1/federation/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
            from_node_id: directPeerNodeId,
            timestamp: new Date().toISOString(),
            status: 'healthy',
        }),
    });
    assert(status === 401, `expected 401, got ${status}: ${JSON.stringify(body).slice(0, 160)}`);
});

// ─── Phase 3: Data Replication & Catalogue Sync ───
console.log('\nPhase 3 — Data Replication & Catalogue Sync');

await test('12. Replicate memory entry', async () => {
    const replicatePayload = {
        source_node: directPeerNodeId,
        gaii: agentGaii,
        key: 'shared-pref',
        value: { theme: 'dark' },
        visibility: 'public',
        version: 1,
        timestamp: new Date().toISOString(),
    };
    const replicateSig = await signMsg(directPeerPrivKeyB64, JSON.stringify(replicatePayload));
    const { body } = await json('/v1/federation/replicate', {
        method: 'POST',
        body: JSON.stringify({ ...replicatePayload, signature: replicateSig }),
    });
    assert(body.ok === true, `replicate: ${JSON.stringify(body.error)}`);
    assert(body.data.replicated === true, 'replicated flag');
    assert(body.data.key.startsWith('replica:'), `key prefix: ${body.data.key}`);
    assert(body.data.source_node === directPeerNodeId, 'source matches');
    assert(body.data.version === 1, 'version matches');
});

await test('13. Catalogue sync (full)', async () => {
    const catActions = [
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
    ];
    const catPayload = { source_node: directPeerNodeId, actions: catActions, since_timestamp: undefined, catalogue_hash: undefined };
    const catSig = await signMsg(directPeerPrivKeyB64, JSON.stringify(catPayload));
    const { body } = await json('/v1/federation/catalogue-sync', {
        method: 'POST',
        body: JSON.stringify({ ...catPayload, signature: catSig }),
    });
    assert(body.ok === true, `sync: ${JSON.stringify(body.error)}`);
    assert(body.data.synced === 2, `synced: ${body.data.synced}`);
    assert(body.data.source_node === directPeerNodeId, 'source ok');
    assert(body.data.total_received === 2, `total_received: ${body.data.total_received}`);
    assert(body.data.incremental === false, 'full sync');
});

await test('14. Catalogue sync (incremental)', async () => {
    const incActions = [
        {
            id: 'remote-action-3',
            provider_gaii: `remoteagent#remoteowner@${directPeerNodeId}`,
            display_name: 'Remote New Action',
            description: 'A new action',
            category: 'misc',
            pricing: { base_morsels: 1 },
            tags: ['new'],
        },
    ];
    const incSinceTimestamp = new Date(Date.now() - 60_000).toISOString();
    const incPayload = { source_node: directPeerNodeId, actions: incActions, since_timestamp: incSinceTimestamp, catalogue_hash: undefined };
    const incSig = await signMsg(directPeerPrivKeyB64, JSON.stringify(incPayload));
    const { body } = await json('/v1/federation/catalogue-sync', {
        method: 'POST',
        body: JSON.stringify({ ...incPayload, signature: incSig }),
    });
    assert(body.ok === true, `incremental sync: ${JSON.stringify(body.error)}`);
    assert(body.data.synced === 1, `synced: ${body.data.synced}`);
    assert(body.data.incremental === true, 'incremental flag');
});

await test('14b. Catalogue sync (update existing)', async () => {
    const updActions = [
        {
            id: 'remote-action-1',
            provider_gaii: `remoteagent#remoteowner@${directPeerNodeId}`,
            display_name: 'Remote Summarize v2',
            description: 'Updated summarizer',
            category: 'nlp',
            pricing: { base_morsels: 8 },
            tags: ['nlp', 'summarize'],
        },
    ];
    const updPayload = { source_node: directPeerNodeId, actions: updActions, since_timestamp: undefined, catalogue_hash: undefined };
    const updSig = await signMsg(directPeerPrivKeyB64, JSON.stringify(updPayload));
    const { body } = await json('/v1/federation/catalogue-sync', {
        method: 'POST',
        body: JSON.stringify({ ...updPayload, signature: updSig }),
    });
    assert(body.ok === true, `update sync: ${JSON.stringify(body.error)}`);
    assert(body.data.updated === 1, `updated: ${body.data.updated}`);
    assert(body.data.synced === 0, `synced (new): ${body.data.synced}`);
});

// ─── Phase 3b: the signature is the authentication ───
// Every replication and sync above carries a VALID signature, and the two refusals the suite already
// has (21, 22) are stopped earlier by the not-an-active-peer check. So nothing here had ever sent a
// bad or absent signature from a KNOWN ACTIVE PEER, which is the only case the signature block
// answers. A node that accepted unsigned replication from anyone who guessed a peer node id passed
// this suite. CLAUDE.md: federation Ed25519 signatures are verified unconditionally.
console.log('\nPhase 3b — A known peer still has to sign');

/** Is the replica there? Reads the owner's memory the way the replicate handler writes it. */
async function replicaExists(key: string): Promise<boolean> {
    const { body } = await json(`/v1/memory/${encodeURIComponent(`replica:${directPeerNodeId}:${key}`)}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    return body.ok === true;
}

await test('12b. An ACTIVE peer with NO signature is refused → 401, and nothing is written', async () => {
    const payload = {
        source_node: directPeerNodeId, gaii: agentGaii, key: 'unsigned-pref',
        value: { theme: 'stolen' }, visibility: 'public', version: 1, timestamp: new Date().toISOString(),
    };
    const { status, body } = await json('/v1/federation/replicate', { method: 'POST', body: JSON.stringify(payload) });
    assert(status === 401, `expected 401, got ${status}: ${JSON.stringify(body.error)}`);
    assert(!(await replicaExists('unsigned-pref')), 'an unsigned replication must write nothing');
});

await test('12c. A signature over a TAMPERED payload is refused → 401, and nothing is written', async () => {
    const payload = {
        source_node: directPeerNodeId, gaii: agentGaii, key: 'tampered-pref',
        value: { theme: 'dark' }, visibility: 'public', version: 1, timestamp: new Date().toISOString(),
    };
    const signature = await signMsg(directPeerPrivKeyB64, JSON.stringify(payload));
    // Signed one thing, sent another — the whole point of signing the payload rather than the peer id.
    const { status, body } = await json('/v1/federation/replicate', {
        method: 'POST', body: JSON.stringify({ ...payload, value: { theme: 'tampered' }, signature }),
    });
    assert(status === 401, `expected 401, got ${status}: ${JSON.stringify(body.error)}`);
    assert(!(await replicaExists('tampered-pref')), 'a tampered replication must write nothing');
});

await test('12d. A signature from a DIFFERENT key is refused → 401, and nothing is written', async () => {
    const otherPriv = ed.utils.randomSecretKey();
    const payload = {
        source_node: directPeerNodeId, gaii: agentGaii, key: 'wrongkey-pref',
        value: { theme: 'dark' }, visibility: 'public', version: 1, timestamp: new Date().toISOString(),
    };
    const signature = Buffer.from(
        await ed.signAsync(new TextEncoder().encode(JSON.stringify(payload)), otherPriv),
    ).toString('base64');
    const { status, body } = await json('/v1/federation/replicate', {
        method: 'POST', body: JSON.stringify({ ...payload, signature }),
    });
    assert(status === 401, `expected 401, got ${status}: ${JSON.stringify(body.error)}`);
    assert(!(await replicaExists('wrongkey-pref')), 'a foreign-key replication must write nothing');
});

await test('14c. Catalogue sync from an active peer is refused unsigned and tampered → 401', async () => {
    const actions = [{
        id: 'remote-action-unsigned', provider_gaii: `remoteagent#remoteowner@${directPeerNodeId}`,
        display_name: 'Unsigned Action', description: 'should never land', category: 'misc',
        pricing: { base_morsels: 1 }, tags: [],
    }];
    const payload = { source_node: directPeerNodeId, actions, since_timestamp: undefined, catalogue_hash: undefined };

    const bare = await json('/v1/federation/catalogue-sync', { method: 'POST', body: JSON.stringify(payload) });
    assert(bare.status === 401, `unsigned sync expected 401, got ${bare.status}: ${JSON.stringify(bare.body.error)}`);

    const signature = await signMsg(directPeerPrivKeyB64, JSON.stringify(payload));
    const tampered = await json('/v1/federation/catalogue-sync', {
        method: 'POST',
        body: JSON.stringify({
            ...payload,
            actions: [{ ...actions[0], id: 'remote-action-swapped', display_name: 'Swapped Action' }],
            signature,
        }),
    });
    assert(tampered.status === 401, `tampered sync expected 401, got ${tampered.status}: ${JSON.stringify(tampered.body.error)}`);

    // Neither action reached the catalogue.
    const cat = await json('/v1/catalogue?limit=200');
    const ids = ((cat.body.data?.actions ?? cat.body.data ?? []) as any[]).map(a => a.id);
    assert(!ids.includes('remote-action-unsigned') && !ids.includes('remote-action-swapped'),
        `a refused sync must land nothing: ${JSON.stringify(ids)}`);
});

// ─── Phase 4: De-peering ───
console.log('\nPhase 4 — De-peering');

// First, add a second peer for emergency de-peering test
const emergencyPeerId = `aimeat-emergency-peer-${Date.now()}`;
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
            target_node: 'aimeat-bad-node-001',
            advisory_type: 'warning',
            reason: 'E2E test warning advisory',
        }),
    });
    assert(status === 201, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(body.data.advisory_type === 'warning', `type: ${body.data.advisory_type}`);
    assert(body.data.target_node === 'aimeat-bad-node-001', 'target matches');
    assert(typeof body.data.id === 'string', 'has advisory id');
});

await test('18b. Trust advisory (ban — auto de-peers)', async () => {
    // Register a peer, then ban it
    const banPeerId = `aimeat-ban-peer-${Date.now()}`;
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
    const kxPeerId = `aimeat-kx-peer-${Date.now()}`;
    await json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ node_id: kxPeerId, url: 'http://localhost:9994' }),
    });
    // Activate the peer so key-exchange accepts it
    await json(`/v1/federation/peers/${kxPeerId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ status: 'active' }),
    });

    const { body } = await json('/v1/federation/key-exchange', {
        method: 'POST',
        body: JSON.stringify({
            node_id: kxPeerId,
            node_public_key: 'deadbeef1234567890abcdef',
            capabilities: ['memory', 'actions'],
        }),
    });
    assert(body.ok === true, `key-exchange: ${JSON.stringify(body.error)}`);
    assert(body.data.node_id === NODE_ID, `node_id: ${body.data.node_id}`);
    assert(typeof body.data.node_public_key === 'string', 'has node_public_key');
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
    assert(status === 400, `status ${status}`);
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
    const dupId = `aimeat-dup-peer-${Date.now()}`;
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

// ─── Phase 6: peering is an operator decision ───
// The suite's owner is registered through POST /v1/owners on a freshly cleared database, so it is
// auto-promoted to operator and every call above went through on that role without anybody saying
// so. A second plain owner is the missing principal: peering, de-peering, peer registration and
// trust advisories decide who this node federates with, and a registered account is not that.
console.log('\nPhase 6 — Peering is an operator decision');

let plainOwnerToken = '';
const plainOwnerName = `fedplain${Date.now()}`;

await test('Setup: a second owner, minted WITHOUT the operator role', async () => {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: plainOwnerName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, plainOwnerName + NODE_ID + ts);
    const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: plainOwnerName, timestamp: ts, signature: sig }) });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    plainOwnerToken = body.data.token;
    // The premise of every assertion below: this account is not an operator.
    assert(Array.isArray(body.data.roles) && !body.data.roles.includes('operator'),
        `the second owner must not be an operator: ${JSON.stringify(body.data.roles)}`);
});

await test('23b. A plain owner cannot register, update, promote or de-peer a peer → 403', async () => {
    const auth = { Authorization: `Bearer ${plainOwnerToken}` };
    const intruderNode = `aimeat-intruder-${Date.now()}`;

    const register = await json('/v1/federation/peers', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ node_id: intruderNode, url: 'http://localhost:9995', public_key: directPeerPubKeyB64 }),
    });
    assert(register.status === 403, `register-peer expected 403, got ${register.status}: ${JSON.stringify(register.body.error)}`);

    const list = await json('/v1/federation/peers', { headers: auth });
    assert(list.status === 403, `peer list expected 403, got ${list.status}`);

    const update = await json(`/v1/federation/peers/${emergencyPeerId}`, {
        method: 'PUT', headers: auth, body: JSON.stringify({ status: 'active' }),
    });
    assert(update.status === 403, `update-peer expected 403, got ${update.status}: ${JSON.stringify(update.body.error)}`);

    const depeer = await json(`/v1/federation/peers/${directPeerNodeId}`, { method: 'DELETE', headers: auth });
    assert(depeer.status === 403, `de-peer expected 403, got ${depeer.status}: ${JSON.stringify(depeer.body.error)}`);

    // Nothing they tried exists, read back as the operator.
    const asOperator = await json('/v1/federation/peers', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(asOperator.status === 200, `operator list: ${asOperator.status}`);
    assert(!(asOperator.body.data.peers as any[]).some(p => p.node_id === intruderNode),
        'the refused registration must not have created a peer');
});

await test('23c. A plain owner cannot decide a peering request or file a trust advisory → 403', async () => {
    const auth = { Authorization: `Bearer ${plainOwnerToken}` };

    const requests = await json('/v1/admin/peering/requests', { headers: auth });
    assert(requests.status === 403, `peering requests expected 403, got ${requests.status}`);

    const decide = await json('/v1/admin/peering/requests/whatever', {
        method: 'PUT', headers: auth, body: JSON.stringify({ decision: 'approve' }),
    });
    assert(decide.status === 403, `peering decision expected 403, got ${decide.status}: ${JSON.stringify(decide.body.error)}`);

    const ask = await json('/v1/federation/peer/request', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ node_url: 'http://localhost:9994', reason: 'let me in' }),
    });
    assert(ask.status === 403, `peer request expected 403, got ${ask.status}: ${JSON.stringify(ask.body.error)}`);

    const advisory = await json('/v1/federation/trust-advisory', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ subject_gaii: agentGaii, severity: 'ban', reason: 'because I said so' }),
    });
    assert(advisory.status === 403, `trust advisory expected 403, got ${advisory.status}: ${JSON.stringify(advisory.body.error)}`);
});

// ─── Phase 7: the genesis memory-read door ───
// GET /v1/federation/genesis-memory-read is registered with NO auth middleware (federation-genesis.ts
// :518) while its POST twin (:382) carries requireAuth() and every genesis-peer admin route carries
// requireAuth + requireRole('operator'). Its handler never consults the peers map, the genesis peer
// list or the per-peer subscriptions: what it reads is `visibility: 'public'` plus an active
// `federation`-scope consent on the agent, and the prefix-only branch walks storage.listAgents()
// across every owner on the node. Nothing in the corpus called either door.
//
// THESE TESTS PIN THE CURRENT CONTRACT, THEY DO NOT ENDORSE IT. If a peer gate is added here, this
// phase is what tells you exactly what changed and for whom — which is the reason to write it before
// touching the route rather than after.
console.log('\nPhase 7 — The genesis memory-read door, as it stands today');

const GEN_PREFIX = `genesisprobe${Date.now()}`;

await test('23. Setup: the agent writes one public and one private key under the same prefix', async () => {
    const pub = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: `${GEN_PREFIX}.open`, value: { note: 'meant to be shared' }, visibility: 'public' }),
    });
    assert(pub.status === 200 || pub.status === 201, `public write: ${pub.status} ${JSON.stringify(pub.body)}`);
    const priv = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: `${GEN_PREFIX}.closed`, value: { note: 'never' }, visibility: 'private' }),
    });
    assert(priv.status === 200 || priv.status === 201, `private write: ${priv.status} ${JSON.stringify(priv.body)}`);
});

await test('24. WITHOUT a federation consent the door returns nothing — the consent is the gate', async () => {
    const r = await json(`/v1/federation/genesis-memory-read?prefix=${GEN_PREFIX}`);
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.total === 0, `expected nothing before the consent, got ${JSON.stringify(r.body.data.results)}`);
});

await test('25. WITH the consent the public key is served — to a caller carrying no credential at all', async () => {
    const consent = await json('/v1/consent', {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            data_pattern: `${GEN_PREFIX}.*`, recipient: '*', purpose: 'federation read probe', scope: 'federation',
        }),
    });
    assert(consent.status === 200 || consent.status === 201, `consent: ${consent.status} ${JSON.stringify(consent.body)}`);

    // No Authorization header, no signature, no peer id. That IS the current contract.
    const r = await json(`/v1/federation/genesis-memory-read?prefix=${GEN_PREFIX}`);
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
    const keys = (r.body.data.results as any[]).map(x => x.key);
    assert(keys.includes(`${GEN_PREFIX}.open`), `the public key must be served: ${JSON.stringify(keys)}`);
    assert(!keys.includes(`${GEN_PREFIX}.closed`), `the private key must never be served: ${JSON.stringify(keys)}`);
});

await test('26. A direct lookup of the PRIVATE key returns nothing even with the consent in place', async () => {
    const r = await json(`/v1/federation/genesis-memory-read?gaii=${encodeURIComponent(agentGaii)}&key=${GEN_PREFIX}.closed`);
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.total === 0, `private direct read must be empty: ${JSON.stringify(r.body.data.results)}`);
});

await test('27. replica:, genesis: and expiring: keys are excluded even when public and consented', async () => {
    for (const reserved of ['replica', 'genesis', 'expiring']) {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: `${reserved}:${GEN_PREFIX}.leak`, value: { note: 'reserved' }, visibility: 'public' }),
        });
        assert(w.status === 200 || w.status === 201, `${reserved} write: ${w.status}`);
        const c = await json('/v1/consent', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ data_pattern: `${reserved}:*`, recipient: '*', purpose: 'reserved probe', scope: 'federation' }),
        });
        assert(c.status === 200 || c.status === 201, `${reserved} consent: ${c.status}`);
        const r = await json(`/v1/federation/genesis-memory-read?prefix=${reserved}:`);
        const keys = (r.body.data.results as any[]).map(x => x.key);
        assert(!keys.some(k => k.startsWith(`${reserved}:`)), `${reserved}: keys must be excluded: ${JSON.stringify(keys)}`);
    }
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
