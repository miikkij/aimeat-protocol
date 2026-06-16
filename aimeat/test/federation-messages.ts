/**
 * @file federation-messages.ts
 * @description Multi-node test for human↔human direct messaging across federation. Boots two AIMEAT
 *   nodes, peers them bidirectionally (which exchanges public keys), then exercises cross-node send,
 *   the first-contact request gate on the recipient node, accept, reciprocal reply, the read-receipt
 *   round-trip, and the block rejection path.
 *
 *   Node A: port 40270, aimeat-hub-001-msga
 *   Node B: port 40271, aimeat-node-001-msgb
 *
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial cross-node direct messaging tests (layer 3: federation delivery).
 */

// Run: cd aimeat && pnpm exec tsx test/federation-messages.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { AimeatConfig } from '../src/config.js';
import type { Server } from 'node:http';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function makeJson(baseUrl: string) {
    return async function json(path: string, opts: RequestInit = {}) {
        const res = await fetch(`${baseUrl}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        return { status: res.status, body };
    };
}

interface NodeState {
    server: Server;
    config: AimeatConfig;
    baseUrl: string;
    nodeId: string;
    json: ReturnType<typeof makeJson>;
    ownerName: string;
    ownerGhii: string;
    ownerToken: string;
    adminPw: string;
}

async function bootNode(port: number, nodeId: string): Promise<NodeState> {
    const adminPw = randomBytes(16).toString('base64url');
    process.env.AIMEAT_PORT = String(port);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
    process.env.AIMEAT_NODE_ID = nodeId;
    process.env.AIMEAT_BASE_URL = `http://localhost:${port}`;
    process.env.AIMEAT_STORAGE = 'memory';

    const { config } = loadConfig({});
    config.port = port;
    config.nodeId = nodeId;
    config.baseUrl = `http://localhost:${port}`;
    config.devMode = true;
    config.testMode = true;
    config.adminPassword = adminPw;
    config.storageProvider = 'memory';
    config.federationAuthPolicy = 'all_peers';

    const { app } = await createServer(config);
    const server = await new Promise<Server>((resolve) => { const s = app.listen(port, () => resolve(s)); });
    return { server, config, baseUrl: `http://localhost:${port}`, nodeId, json: makeJson(`http://localhost:${port}`), ownerName: '', ownerGhii: '', ownerToken: '', adminPw };
}

async function setupOwner(node: NodeState, ownerName: string): Promise<void> {
    const reg = await node.json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ name: ownerName }),
    });
    assert(reg.status === 200 && reg.body.ok === true, `register owner on ${node.nodeId}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const tok = await node.json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ owner: ownerName, private_key: reg.body.private_key }),
    });
    assert(tok.body.ok === true, `token on ${node.nodeId}: ${JSON.stringify(tok.body.error)}`);
    node.ownerName = ownerName;
    node.ownerGhii = `${ownerName}@${node.nodeId}`;
    node.ownerToken = tok.body.token;
}

async function addAndActivatePeer(node: NodeState, peerNodeId: string, peerUrl: string): Promise<void> {
    const add = await node.json('/v1/federation/peers', {
        method: 'POST', headers: { Authorization: `Bearer ${node.ownerToken}` }, body: JSON.stringify({ node_id: peerNodeId, url: peerUrl }),
    });
    assert(add.status === 201, `add peer ${peerNodeId} on ${node.nodeId}: ${add.status} ${JSON.stringify(add.body)}`);
    const act = await node.json(`/v1/federation/peers/${peerNodeId}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${node.ownerToken}` }, body: JSON.stringify({ status: 'active' }),
    });
    assert(act.body.ok === true && act.body.data.status === 'active', `activate ${peerNodeId} on ${node.nodeId}: ${JSON.stringify(act.body.error)}`);
}

console.log('\n=== AIMEAT Federation Direct Messages E2E ===\n');

let A: NodeState;
let B: NodeState;
const ts = Date.now();
let msgId = '';
let convId = '';

console.log('Setup: boot two nodes, owners, bidirectional peering');
await test('Boot nodes A + B', async () => {
    A = await bootNode(40270, 'aimeat-hub-001-msga');
    B = await bootNode(40271, 'aimeat-node-001-msgb');
});
await test('Register owners (operators)', async () => {
    await setupOwner(A!, `alice${ts}`);
    await setupOwner(B!, `bob${ts}`);
});
await test('Peer A<->B (exchanges public keys)', async () => {
    await addAndActivatePeer(A!, B!.nodeId, B!.baseUrl);
    await addAndActivatePeer(B!, A!.nodeId, A!.baseUrl);
    // Activate in BOTH directions: each activate makes the TARGET store the caller's public key,
    // so we need A→B and B→A for both peers to hold each other's key.
    const keAB = await A!.json('/v1/federation/peer/activate', {
        method: 'POST', headers: { Authorization: `Bearer ${A!.ownerToken}` },
        body: JSON.stringify({ peer_node_id: B!.nodeId }),
    });
    assert(keAB.body.ok === true && keAB.body.data.key_exchange === 'completed', `A→B key exchange: ${JSON.stringify(keAB.body)}`);
    const keBA = await B!.json('/v1/federation/peer/activate', {
        method: 'POST', headers: { Authorization: `Bearer ${B!.ownerToken}` },
        body: JSON.stringify({ peer_node_id: A!.nodeId }),
    });
    assert(keBA.body.ok === true && keBA.body.data.key_exchange === 'completed', `B→A key exchange: ${JSON.stringify(keBA.body)}`);
});

console.log('\nPhase 1 -- Cross-node send + request gate');
await test('1. Alice (A) sends to Bob (B) across federation', async () => {
    const { status, body } = await A!.json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${A!.ownerToken}` },
        body: JSON.stringify({ to: B!.ownerGhii, body: 'Hello across the federation!' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.status === 'delivered', `expected delivered, got ${body.data.message.status}`);
    msgId = body.data.message.id;
    convId = body.data.message.conversationId;
});

await test('2. Bob (B) sees a pending request from Alice', async () => {
    const reqs = await B!.json('/v1/messages/requests', { headers: { Authorization: `Bearer ${B!.ownerToken}` } });
    assert(reqs.status === 200, `requests status ${reqs.status}`);
    const r = reqs.body.data.requests.find((x: any) => x.contactId === A!.ownerGhii);
    assert(r !== undefined, 'Alice appears in Bob requests');
});

console.log('\nPhase 2 -- Accept, reply, read receipt');
await test('3. Bob accepts; message lands in inbox', async () => {
    const acc = await B!.json(`/v1/messages/requests/${encodeURIComponent(A!.ownerGhii)}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${B!.ownerToken}` },
    });
    assert(acc.status === 200, `accept status ${acc.status}`);
    const inbox = await B!.json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${B!.ownerToken}` } });
    assert(inbox.body.data.messages.some((m: any) => m.id === msgId), 'message visible in Bob inbox');
});

await test('4. Bob reads conversation; receipt flips Alice copy to read', async () => {
    const read = await B!.json(`/v1/messages/conversations/${convId}/read`, {
        method: 'POST', headers: { Authorization: `Bearer ${B!.ownerToken}` },
    });
    assert(read.status === 200, `read status ${read.status}`);
    // Allow the cross-node receipt to propagate.
    let aliceCopy: any;
    for (let i = 0; i < 20; i++) {
        const conv = await A!.json(`/v1/messages/conversations/${convId}`, { headers: { Authorization: `Bearer ${A!.ownerToken}` } });
        aliceCopy = conv.body.data.messages.find((m: any) => m.id === msgId);
        if (aliceCopy?.status === 'read') break;
        await sleep(100);
    }
    assert(aliceCopy?.status === 'read', `Alice copy should be read, got ${aliceCopy?.status}`);
});

await test('5. Bob replies; Alice receives it freely (initiator not re-gated)', async () => {
    const send = await B!.json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${B!.ownerToken}` },
        body: JSON.stringify({ to: A!.ownerGhii, body: 'Reply across the wire!', reply_to: msgId }),
    });
    assert(send.status === 201, `reply status ${send.status}: ${JSON.stringify(send.body)}`);
    assert(send.body.data.message.status === 'delivered', `reply delivered, got ${send.body.data.message.status}`);

    const reqs = await A!.json('/v1/messages/requests', { headers: { Authorization: `Bearer ${A!.ownerToken}` } });
    assert(reqs.body.data.requests.find((x: any) => x.contactId === B!.ownerGhii) === undefined, 'Alice has no request gate for Bob');
    const inbox = await A!.json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${A!.ownerToken}` } });
    assert(inbox.body.data.messages.some((m: any) => m.senderGhii === B!.ownerGhii), 'Bob reply in Alice inbox');
});

console.log('\nPhase 3 -- Cross-node attachment (grant + duplicate)');
await test('6. Alice attaches an image; Bob pulls + duplicates it across nodes', async () => {
    const attKey = `dm-fed-img-${ts}.png`;
    const data = Buffer.from('cross-node-bytes').toString('base64');
    const up = await A!.json('/v1/storage', {
        method: 'POST', headers: { Authorization: `Bearer ${A!.ownerToken}` },
        body: JSON.stringify({ key: attKey, data, mime_type: 'image/png', visibility: 'private' }),
    });
    assert(up.body.ok === true, `upload: ${JSON.stringify(up.body)}`);

    const send = await A!.json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${A!.ownerToken}` },
        body: JSON.stringify({
            to: B!.ownerGhii,
            body: 'photo across the wire ![p](cid:f1)',
            attachments: [{ storage_key: attKey, mime: 'image/png', size: 16, kind: 'image', inline: true, id: 'f1' }],
        }),
    });
    assert(send.status === 201, `send status ${send.status}: ${JSON.stringify(send.body)}`);
    const mid = send.body.data.message.id;

    // Bob's copy should have a duplicated, locally-hosted attachment (pulled via the grant).
    let att: any;
    for (let i = 0; i < 20; i++) {
        const conv = await B!.json(`/v1/messages/conversations/${convId}`, { headers: { Authorization: `Bearer ${B!.ownerToken}` } });
        att = conv.body.data.messages.find((m: any) => m.id === mid)?.attachments?.[0];
        if (att?.mode === 'duplicate' && att?.localKey) break;
        await sleep(100);
    }
    assert(att?.mode === 'duplicate', `Bob attachment should be duplicate, got ${att?.mode}`);
    assert(typeof att?.localKey === 'string' && att.localKey.length > 0, 'Bob copy has localKey');

    const files = await B!.json('/v1/storage', { headers: { Authorization: `Bearer ${B!.ownerToken}` } });
    const found = files.body.data.files.find((f: any) => f.key === att.localKey);
    assert(found !== undefined && found.size === 16, `Bob storage holds duplicated file (size 16), got ${JSON.stringify(found)}`);
});

console.log('\nPhase 4 -- Block across federation');
await test('7. Bob blocks Alice; Alice cross-node send becomes undeliverable', async () => {
    const block = await B!.json(`/v1/messages/contacts/${encodeURIComponent(A!.ownerGhii)}/block`, {
        method: 'POST', headers: { Authorization: `Bearer ${B!.ownerToken}` },
    });
    assert(block.status === 200, `block status ${block.status}`);

    const send = await A!.json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${A!.ownerToken}` },
        body: JSON.stringify({ to: B!.ownerGhii, body: 'are you there?' }),
    });
    assert(send.status === 201, `send status ${send.status}`);
    // The remote node rejects with 403; the sender copy is marked undeliverable.
    assert(send.body.data.message.status === 'undeliverable', `expected undeliverable, got ${send.body.data.message.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);

// Cleanup
try { A!.server.close(); } catch { /* ignore */ }
try { B!.server.close(); } catch { /* ignore */ }
if (failed > 0) process.exit(1);
process.exit(0);
