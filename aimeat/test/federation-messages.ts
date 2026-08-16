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
 *   v1.1.0 -- 2026-06-23 -- Phase 5: cross-node interactive message (federated AskUserQuestion) — the
 *     question spec rides the signed wire payload and the structured answer round-trips back.
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

async function signMsg(privKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
/** Register a NON-operator owner via public registration + mint its token (so its agent's owner is
 *  independent of the node operator, who may have blocked the sender in an earlier test). */
async function registerOwnerOn(node: NodeState, name: string): Promise<{ token: string; ghii: string }> {
    const reg = await node.json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register owner ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts2 = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, name + node.nodeId + ts2);
    const tok = await node.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts2, signature: sig }) });
    assert(tok.body.ok === true, `owner token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { token: tok.body.data.token, ghii: `${name}@${node.nodeId}` };
}
async function createAgentOn(node: NodeState, ownerName: string, ownerToken: string, agentName: string, scopes: string[]): Promise<{ gaii: string; token: string }> {
    const reg = await node.json('/v1/agents', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'], scopes }) });
    assert(reg.status === 201, `create agent ${agentName}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii;
    const ts2 = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, gaii + ts2);
    const tok = await node.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts2, signature: sig }) });
    assert(tok.body.ok === true, `agent token ${agentName}: ${JSON.stringify(tok.body.error)}`);
    return { gaii, token: tok.body.data.token };
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

// A19 (E2E test-quality audit). This asserted only that a row appeared in Bob's requests list, which
// is true whether or not the gate does anything. The first-contact gate does not REFUSE a stranger —
// it HOLDS them: the message is stored and acknowledged, and stays out of everything the owner reads
// until they accept. So the contract has two halves and only the visible one was checked. Asserting
// the other half is what makes this a gate test: delete the `isRequest` filter in routes/messages.ts
// and the inbox assertion below goes red, while the requests-list assertion stays green.
await test('2. Bob (B) sees a pending request from Alice, and nothing else yet', async () => {
    const reqs = await B!.json('/v1/messages/requests', { headers: { Authorization: `Bearer ${B!.ownerToken}` } });
    assert(reqs.status === 200, `requests status ${reqs.status}`);
    const r = reqs.body.data.requests.find((x: any) => x.contactId === A!.ownerGhii);
    assert(r !== undefined, 'Alice appears in Bob requests');

    // Held, not delivered: the message is not in the inbox and opens no thread before acceptance.
    const inbox = await B!.json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${B!.ownerToken}` } });
    assert(inbox.status === 200, `inbox status ${inbox.status}`);
    assert(!(inbox.body.data.messages ?? []).some((m: any) => m.id === msgId),
        'a first-contact message must NOT be in the inbox before it is accepted');

    const convos = await B!.json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${B!.ownerToken}` } });
    assert(convos.status === 200, `conversations status ${convos.status}`);
    assert(!(convos.body.data.conversations ?? []).some((c: any) => c.conversationId === convId || c.contactId === A!.ownerGhii),
        'a first-contact message must open no thread before it is accepted');
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

// Test 7 reads only the SENDER's copy on node A — 'undeliverable' is what A wrote about itself.
// Whether the block actually kept the message out of Bob's mailbox on node B is a different claim,
// and the read-back door is unfiltered for it: GET /v1/messages/inbox hides senders whose contact
// state is 'pending' and nothing else, so a blocked sender's row would show. The refusal has to
// happen BEFORE the copy is written, not merely be reported afterwards.
await test('7b. The blocked message never reaches the recipient\'s mailbox on the other node', async () => {
    const inbox = await B!.json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${B!.ownerToken}` } });
    assert(inbox.status === 200, `inbox status ${inbox.status}`);
    const msgs = (inbox.body.data?.messages ?? []) as any[];
    assert(!msgs.some(m => m.body === 'are you there?'),
        `the blocked message must not be in Bob's inbox: ${JSON.stringify(msgs.map(m => m.body))}`);

    // The thread is the second, filter-free door onto the same rows: conversationIdFor is a
    // deterministic hash over the sorted GHII pair, so the blocked send would land in this very
    // conversation if it had been written at all.
    const convs = await B!.json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${B!.ownerToken}` } });
    const conv = (convs.body.data?.conversations ?? []).find((c: any) => c.peerGhii === A!.ownerGhii);
    if (conv) {
        const thread = await B!.json(`/v1/messages/conversations/${conv.conversationId}`, {
            headers: { Authorization: `Bearer ${B!.ownerToken}` },
        });
        const bodies = ((thread.body.data?.messages ?? []) as any[]).map(m => m.body);
        assert(!bodies.includes('are you there?'),
            `the blocked message must not be in the thread either: ${JSON.stringify(bodies)}`);
    }

    // POSITIVE CONTROL, same reader, same sender, same door: the message Alice delivered BEFORE the
    // block is still there. So the inbox read works and does show rows from this sender — the absence
    // above is the block and not an empty or broken mailbox. (There is no unblock route to undo with:
    // POST .../block is the only contact-state door in routes/messages.ts.)
    assert(msgs.some(m => m.body === 'Hello across the federation!'),
        `the pre-block message must still be in Bob's inbox: ${JSON.stringify(msgs.map(m => m.body))}`);
});

await test('8. Cross-node DM to an AGENT: the agent reads it AND its owner sees it', async () => {
    // Fresh owner on B (independent of the operator Bob, who blocked Alice above) + an agent with read.
    const owner = await registerOwnerOn(B!, `bagent${ts}`);
    const bot = await createAgentOn(B!, `bagent${ts}`, owner.token, 'bbot', ['messages:send', 'messages:read']);

    const send = await A!.json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${A!.ownerToken}` },
        body: JSON.stringify({ to: bot.gaii, body: 'Hei B-agentti, viesti solmurajan yli.' }),
    });
    assert(send.status === 201, `send to agent ${send.status}: ${JSON.stringify(send.body)}`);
    assert(send.body.data.message.recipientGhii === bot.gaii, `outbound keeps the agent recipient, got ${send.body.data.message.recipientGhii}`);

    // Federation delivery is async — poll the agent's own inbox on B.
    let agentMsg: any;
    for (let i = 0; i < 25; i++) {
        const inbox = await B!.json('/v1/messages/agent-inbox', { headers: { Authorization: `Bearer ${bot.token}` } });
        agentMsg = (inbox.body?.data?.messages ?? []).find((m: any) => m.recipientGhii === bot.gaii && /solmurajan yli/.test(m.body));
        if (agentMsg) break;
        await new Promise(r => setTimeout(r, 150));
    }
    assert(agentMsg !== undefined, 'agent on B reads the cross-node DM addressed to it (recipient identity preserved)');
    assert(agentMsg.senderGhii === A!.ownerGhii, `from Alice, got ${agentMsg.senderGhii}`);

    // The agent's OWNER also has it (mailbox copy owned by the owner) — as a pending first-contact request.
    const ownerReq = await B!.json('/v1/messages/requests', { headers: { Authorization: `Bearer ${owner.token}` } });
    const ownerInbox = await B!.json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${owner.token}` } });
    const ownerSees = (ownerReq.body?.data?.requests ?? []).some((r: any) => r.contactId === A!.ownerGhii)
        || (ownerInbox.body?.data?.messages ?? []).some((m: any) => m.recipientGhii === bot.gaii);
    assert(ownerSees, 'the agent owner also sees the message (pending request or inbox)');
});

console.log('\nPhase 5 -- Interactive message (federated AskUserQuestion) across nodes');
await test('9. Cross-node interactive question: the spec survives the wire + the answer round-trips', async () => {
    const owner = await registerOwnerOn(B!, `bask${ts}`);
    const bot = await createAgentOn(B!, `bask${ts}`, owner.token, 'askb', ['messages:send', 'messages:read']);

    // Alice (A) asks the B-agent a structured question across the federation.
    const ask = await A!.json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${A!.ownerToken}` },
        body: JSON.stringify({
            to: bot.gaii, body: 'Yksi kysymys ennen kuin aloitan:',
            interactive: { role: 'questions', v: 1, questions: [{
                id: 'q1', header: 'Env', prompt: 'Which environment?', multiSelect: false, allowOther: true, required: true,
                options: [{ id: 'prod', label: 'Production' }, { id: 'staging', label: 'Staging' }],
            }] },
        }),
    });
    assert(ask.status === 201, `ask status ${ask.status}: ${JSON.stringify(ask.body)}`);
    const qid = ask.body.data.message.id;
    const conv = ask.body.data.message.conversationId;

    // The agent on B reads the question with the spec intact (the field rode the signed wire payload).
    let q: any;
    for (let i = 0; i < 25; i++) {
        const inbox = await B!.json('/v1/messages/agent-inbox', { headers: { Authorization: `Bearer ${bot.token}` } });
        q = (inbox.body?.data?.messages ?? []).find((m: any) => m.id === qid);
        if (q?.interactive?.role === 'questions') break;
        await sleep(150);
    }
    assert(q?.interactive?.role === 'questions', 'the B-agent receives the interactive question spec across nodes');
    assert(q.interactive.questions[0].options[1].id === 'staging', 'option ids survive the wire');

    // The B-agent answers; Alice (A) reads the structured picks back cross-node.
    const ans = await B!.json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${bot.token}` },
        body: JSON.stringify({
            to: A!.ownerGhii, conversation_id: conv, reply_to: qid, body: '- Env: Production',
            interactive: { role: 'answers', v: 1, answersFor: qid, answers: { q1: { selected: ['prod'], other: null } } },
        }),
    });
    assert(ans.status === 201, `answer status ${ans.status}: ${JSON.stringify(ans.body)}`);

    let got: any;
    for (let i = 0; i < 25; i++) {
        const conv2 = await A!.json(`/v1/messages/conversations/${conv}`, { headers: { Authorization: `Bearer ${A!.ownerToken}` } });
        got = (conv2.body?.data?.messages ?? []).find((m: any) => m.interactive?.role === 'answers');
        if (got) break;
        await sleep(150);
    }
    assert(got?.interactive?.answers?.q1?.selected?.[0] === 'prod', `Alice reads the answer cross-node, got ${JSON.stringify(got?.interactive)}`);
});

console.log('\nPhase 6 -- Federation-wide operator broadcast');
await test('10. Operator broadcasts to the whole federation; a peer owner receives it (inbox, non-respondable)', async () => {
    const bUser = await registerOwnerOn(B!, `bcfed${ts}`); // a fresh B owner (no block)
    // A's operator (setupOwner registered the node operator) broadcasts federation-wide.
    const bc = await A!.json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${A!.ownerToken}` },
        body: JSON.stringify({ audience: 'federation-users', mode: 'announcement', body: 'Federation-wide maintenance notice.' }),
    });
    assert(bc.status === 201, `broadcast ${bc.status}: ${JSON.stringify(bc.body)}`);
    assert((bc.body.data.federation_peers ?? 0) >= 1, `expected federation_peers >= 1, got ${bc.body.data.federation_peers}`);
    // The B owner receives it directly in their inbox (operator announcement bypasses the request gate).
    let msg: any;
    for (let i = 0; i < 25; i++) {
        const inbox = await B!.json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bUser.token}` } });
        msg = (inbox.body?.data?.messages ?? []).find((m: any) => /maintenance notice/.test(m.body));
        if (msg) break;
        await sleep(150);
    }
    assert(msg !== undefined, 'B owner received the federation announcement in their inbox');
    assert(msg.senderGhii === A!.ownerGhii, `from A operator, got ${msg.senderGhii}`);
    assert(msg.respondable === false, 'an announcement is non-respondable');
});

await test('11. A non-operator cannot broadcast to the federation (403)', async () => {
    const plain = await registerOwnerOn(A!, `bcplain${ts}`);
    const bc = await A!.json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${plain.token}` },
        body: JSON.stringify({ audience: 'federation-users', mode: 'announcement', body: 'nope' }),
    });
    assert(bc.status === 403, `expected 403 for a non-operator, got ${bc.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);

// Cleanup
try { A!.server.close(); } catch { /* ignore */ }
try { B!.server.close(); } catch { /* ignore */ }
if (failed > 0) process.exit(1);
process.exit(0);
