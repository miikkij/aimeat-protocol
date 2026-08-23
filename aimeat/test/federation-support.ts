/**
 * @file federation-support.ts
 * @description Support reaching the people who actually run a node, across a contact link.
 *
 *   A managed instance makes its buyer the local operator, so `support@operators` — the address every
 *   agent on the node is told to use — resolves to the customer rather than to the provider. This is
 *   the whole path that fixes it, end to end and over the wire.
 *
 *   The shape is asymmetric on purpose. The customer's side is an ordinary 1:1 pair thread with
 *   `support@{vendorNode}`; the vendor's side is its own group thread, whose participants are the
 *   vendor's own operators. Nobody joins anybody's operator list, no group thread gains a foreign
 *   participant, and createGroupConversation's node-local invariant is never touched.
 *
 *   Nodes: V (vendor) 40288, two operators. C (customer) 40289, one owner who IS its operator, plus
 *   an agent — the principal that actually writes to support when something breaks.
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial.
 */

// Run: cd aimeat && pnpm exec tsx test/federation-support.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Server } from 'node:http';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

type Json = (p: string, o?: RequestInit) => Promise<{ status: number; body: any }>;
interface NodeState { server: Server; baseUrl: string; nodeId: string; adminPw: string; ownerName: string; ownerGhii: string; ownerToken: string; json: Json }

function makeJson(baseUrl: string): Json {
    return async (path, opts: RequestInit = {}) => {
        const res = await fetch(`${baseUrl}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        return { status: res.status, body };
    };
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

    const { app } = await createServer(config);
    const server = await new Promise<Server>(resolve => { const s = app.listen(port, () => resolve(s)); });
    return { server, baseUrl: `http://localhost:${port}`, nodeId, adminPw, ownerName: '', ownerGhii: '', ownerToken: '', json: makeJson(`http://localhost:${port}`) };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function setupOperator(node: NodeState, ownerName: string): Promise<void> {
    const reg = await node.json('/v1/admin/setup/register', { method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ name: ownerName }) });
    assert(reg.status === 200 && reg.body.ok === true, `register ${ownerName}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const tok = await node.json('/v1/admin/setup/token', { method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ owner: ownerName, private_key: reg.body.private_key }) });
    assert(tok.body.ok === true, `token ${ownerName}: ${JSON.stringify(tok.body.error)}`);
    node.ownerName = ownerName;
    node.ownerGhii = `${ownerName}@${node.nodeId}`;
    node.ownerToken = tok.body.token;
}

async function signMsg(privKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** A second owner on a node, granted the operator role, so "every operator sees it" has two people. */
async function addOperator(node: NodeState, name: string): Promise<{ ghii: string; token: string }> {
    const reg = await node.json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const grant = await node.json('/v1/admin/roles/grant', {
        method: 'POST', headers: auth(node.ownerToken), body: JSON.stringify({ owner: name, role: 'operator' }),
    });
    assert(grant.status === 200 || grant.status === 201, `grant operator to ${name}: ${grant.status} ${JSON.stringify(grant.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, name + node.nodeId + timestamp);
    const tok = await node.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { ghii: `${name}@${node.nodeId}`, token: tok.body.data.token };
}

/** An ordinary owner on a node: no operator role, so a support thread is none of their business. */
async function addNonOperator(node: NodeState, name: string): Promise<{ ghii: string; token: string }> {
    const reg = await node.json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, name + node.nodeId + timestamp);
    const tok = await node.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { ghii: `${name}@${node.nodeId}`, token: tok.body.data.token };
}

async function createAgent(node: NodeState, agentName: string, scopes: string[] = ['messages:send', 'messages:read']): Promise<{ gaii: string; token: string }> {
    const r = await node.json('/v1/agents', {
        method: 'POST', headers: auth(node.ownerToken),
        body: JSON.stringify({ name: agentName, owner: node.ownerName, capabilities: ['memory'], scopes }),
    });
    assert(r.status === 201, `create agent ${agentName}: ${r.status} ${JSON.stringify(r.body)}`);
    const gaii = r.body.data.agent.gaii;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(r.body.data.private_key, gaii + timestamp);
    const tok = await node.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    return { gaii, token: tok.body.data.token };
}

/**
 * Link two nodes at the contact tier, both directions.
 *
 * The key exchange is what makes it real: activate posts THIS node's public key to the peer, and the
 * peer's key-exchange route stores it on its own peer row. Run from both ends, each side ends up
 * holding the other's key, which is what every inbound signature is verified against.
 */
async function linkAsContact(a: NodeState, b: NodeState): Promise<void> {
    for (const [self, peer] of [[a, b], [b, a]] as [NodeState, NodeState][]) {
        const add = await self.json('/v1/federation/peers', {
            method: 'POST', headers: auth(self.ownerToken),
            body: JSON.stringify({ node_id: peer.nodeId, url: peer.baseUrl }),
        });
        assert(add.status === 201, `add ${peer.nodeId} on ${self.nodeId}: ${add.status} ${JSON.stringify(add.body)}`);
        const put = await self.json(`/v1/federation/peers/${peer.nodeId}`, {
            method: 'PUT', headers: auth(self.ownerToken),
            body: JSON.stringify({ status: 'active', tier: 'contact' }),
        });
        assert(put.body.data?.tier === 'contact', `tier on ${self.nodeId}: ${JSON.stringify(put.body)}`);
    }
    for (const [self, peer] of [[a, b], [b, a]] as [NodeState, NodeState][]) {
        const act = await self.json('/v1/federation/peer/activate', {
            method: 'POST', headers: auth(self.ownerToken), body: JSON.stringify({ peer_node_id: peer.nodeId }),
        });
        assert(act.body.data?.key_exchange === 'completed', `key exchange ${self.nodeId}→${peer.nodeId}: ${JSON.stringify(act.body)}`);
    }
}

console.log('\n=== AIMEAT Federated Support E2E (support@operators across a contact link) ===\n');

let V: NodeState;   // the vendor: runs the platform, answers support
let C: NodeState;   // the customer: bought a managed instance, is its own local operator
let opB: { ghii: string; token: string };
let agent: { gaii: string; token: string };
const ts = Date.now();
let ticketId = '';

console.log('Setup');
await test('Boot V (two operators) and C (owner + agent), linked at tier contact', async () => {
    V = await bootNode(40288, 'aimeat-test-001-supv');
    C = await bootNode(40289, 'aimeat-test-001-supc');
    await setupOperator(V, `supv${ts}`);
    await setupOperator(C, `supc${ts}`);
    opB = await addOperator(V, `supvb${ts}`);
    agent = await createAgent(C, `helper${ts}`);
    await linkAsContact(V, C);

    const point = await C.json(`/v1/federation/peers/${V.nodeId}`, {
        method: 'PUT', headers: auth(C.ownerToken), body: JSON.stringify({ support_upstream: true }),
    });
    assert(point.status === 200 && point.body.data.support_upstream === true,
        `point support at V: ${point.status} ${JSON.stringify(point.body)}`);
});

console.log('\nPhase 1 — the agent does the ordinary thing and reaches the vendor');

await test('S1. The customer\'s agent writes to support@operators and is told where it went', async () => {
    const r = await C.json('/v1/messages', {
        method: 'POST', headers: auth(agent.token),
        body: JSON.stringify({ to: 'support@operators', subject: 'Storage will not mount', body: 'Every write returns EACCES.' }),
    });
    assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.addressed_to === `support@${V.nodeId}`,
        `addressed to the vendor's support, got ${r.body.data.addressed_to}`);
    ticketId = r.body.data.conversation_id;
    assert(typeof ticketId === 'string' && ticketId.length > 0, 'a ticket id comes back to continue in');
    assert(typeof r.body.data.note === 'string' && r.body.data.note.length > 0, 'and it says so in words');
});

await test('S2. No local support thread was opened on the customer\'s node', async () => {
    // The customer's side is a PAIR thread, which stores no conversation record. If a group had been
    // opened here the customer's own operator would be answering their own agent.
    const r = await C.json(`/v1/messages/conversations/${ticketId}`, { headers: auth(C.ownerToken) });
    assert(!r.body.data?.conversation, `no group record may exist here, got ${JSON.stringify(r.body.data?.conversation)}`);
});

await test('S3. The vendor holds it as its OWN support thread, with the customer as the remote party', async () => {
    const r = await V.json(`/v1/messages/conversations/${ticketId}`, { headers: auth(V.ownerToken) });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
    const convo = r.body.data.conversation;
    assert(!!convo, 'the vendor has a conversation record');
    assert(convo.alias === 'support@operators', `it is a support thread, got ${convo.alias}`);
    assert(convo.participants.includes(V.ownerGhii) && convo.participants.includes(opB.ghii),
        `both operators are participants, got ${JSON.stringify(convo.participants)}`);
    assert(!convo.participants.some((p: string) => p.endsWith(`@${C.nodeId}`)),
        'and nobody from the customer node is in the membership');
});

await test('S4. BOTH of the vendor\'s operators see it, and neither has a first-contact request', async () => {
    for (const [who, token] of [['operator A', V.ownerToken], ['operator B', opB.token]] as [string, string][]) {
        const inbox = await V.json('/v1/messages/inbox', { headers: auth(token) });
        const msg = (inbox.body.data?.messages ?? []).find((m: any) => m.conversationId === ticketId);
        assert(!!msg, `${who} sees the ticket`);
        assert(msg.senderGhii === agent.gaii, `${who} sees who asked, got ${msg.senderGhii}`);
        assert(msg.recipientGhii === 'support@operators', `${who}'s row reads like a local support thread, got ${msg.recipientGhii}`);

        const reqs = await V.json('/v1/messages/requests', { headers: auth(token) });
        const held = (reqs.body.data?.requests ?? []).find((q: any) => (q.contactId ?? '').endsWith(`@${C.nodeId}`));
        assert(!held, `somebody asking for help must not land in ${who}'s request queue`);
    }
});

console.log('\nPhase 2 — the answer comes back');

await test('S5. Operator A replies in the thread and it reaches the customer', async () => {
    const reply = await V.json('/v1/messages', {
        method: 'POST', headers: auth(V.ownerToken),
        body: JSON.stringify({ conversation_id: ticketId, body: 'Your storage quota is full. Raising it now.' }),
    });
    assert(reply.status === 201, `reply: ${reply.status} ${JSON.stringify(reply.body)}`);

    // The customer's mailbox, addressed to the agent that asked.
    const inbox = await C.json('/v1/messages/inbox', { headers: auth(C.ownerToken) });
    const got = (inbox.body.data?.messages ?? []).find((m: any) => m.conversationId === ticketId);
    assert(!!got, 'the answer is in the customer\'s inbox, not their request queue');
    assert(got.recipientGhii === agent.gaii, `addressed to the agent that asked, got ${got.recipientGhii}`);
    assert(got.origin === 'federation', `it came over the wire, got ${got.origin}`);
});

await test('S6. Operator B sees operator A\'s reply in the same thread', async () => {
    const thread = await V.json(`/v1/messages/conversations/${ticketId}`, { headers: auth(opB.token) });
    const bodies = (thread.body.data?.messages ?? []).map((m: any) => m.body);
    assert(bodies.some((b: string) => b.includes('EACCES')), 'B sees the question');
    assert(bodies.some((b: string) => b.includes('quota is full')), 'and A\'s answer, without being cc\'d');
});

await test('S7. The agent continues with the same id and no second ticket is opened', async () => {
    const before = await V.json(`/v1/messages/conversations/${ticketId}`, { headers: auth(V.ownerToken) });
    const beforeCount = (before.body.data?.messages ?? []).length;

    const r = await C.json('/v1/messages', {
        method: 'POST', headers: auth(agent.token),
        body: JSON.stringify({ conversation_id: ticketId, body: 'Confirmed, writes work again.' }),
    });
    assert(r.status === 201, `continue: ${r.status} ${JSON.stringify(r.body)}`);

    const after = await V.json(`/v1/messages/conversations/${ticketId}`, { headers: auth(V.ownerToken) });
    assert((after.body.data?.messages ?? []).length === beforeCount + 1,
        'the follow-up joined the same thread');

    const convos = await V.json('/v1/messages/conversations', { headers: auth(V.ownerToken) });
    const supportThreads = (convos.body.data?.conversations ?? []).filter((c: any) => c.groupAlias === 'support@operators');
    assert(supportThreads.length === 1, `one ticket, not two, got ${supportThreads.length}`);
});

await test('S8. The customer sees what their own agent told the vendor, and what came back', async () => {
    // Ownership is the product: the human must not be blind to what their AI reported in their name.
    const convos = await C.json('/v1/messages/conversations', { headers: auth(C.ownerToken) });
    const row = (convos.body.data?.conversations ?? []).find((c: any) => c.conversationId === ticketId);
    assert(!!row, 'the ticket appears in the customer\'s own conversations');

    // Read it under the agent, which is where the question lives: the agent's outbound copy is in the
    // AGENT's mailbox and the vendor's answer is in the owner's, so the owner's own view holds half
    // the thread. `?agent=` is the ownership-verified door to the other half, and it is the one an
    // owner needs to see what was said in their name.
    const thread = await C.json(`/v1/messages/conversations/${ticketId}?agent=${encodeURIComponent(agent.gaii)}`, { headers: auth(C.ownerToken) });
    assert(thread.status === 200, `status ${thread.status}: ${JSON.stringify(thread.body)}`);
    const bodies = (thread.body.data?.messages ?? []).map((m: any) => m.body);
    assert(bodies.some((b: string) => b.includes('EACCES')), 'the customer can read what their agent asked');
    assert(bodies.some((b: string) => b.includes('quota is full')), 'and the answer it got');
});

console.log('\nPhase 3 — who may not');

await test('S12. REFUSED — a non-operator on the vendor node cannot read the ticket', async () => {
    // A support thread carries a customer's problem, and on the vendor node its participants are the
    // operators. Anyone else holding the id is an outsider, whatever else they are here.
    const outsider = await addNonOperator(V, `nosy${ts}`);
    const r = await V.json(`/v1/messages/conversations/${ticketId}`, { headers: auth(outsider.token) });
    assert(r.status === 403 || !r.body.data?.conversation,
        `an outsider must learn nothing about it, got ${r.status} ${JSON.stringify(r.body.data?.conversation)}`);
    assert(!(r.body.data?.messages ?? []).length, 'and read none of it');
});

await test('S13. REFUSED — an agent without messages:send cannot write to support', async () => {
    // The scope fence is what stops "reach the people who run this node" from being a capability
    // every agent has by virtue of existing.
    const mute = await createAgent(C, `mute${ts}`, []);
    const r = await C.json('/v1/messages', {
        method: 'POST', headers: auth(mute.token),
        body: JSON.stringify({ to: 'support@operators', subject: 'Unscoped', body: 'Should not arrive.' }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 4 — the escape hatch, and the state after a revoke');

await test('S9. The LONG form still means the customer\'s OWN operators', async () => {
    const r = await C.json('/v1/messages', {
        method: 'POST', headers: auth(C.ownerToken),
        body: JSON.stringify({ to: `support@${C.nodeId}`, subject: 'Mine', body: 'For my own operators.' }),
    });
    assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert(!r.body.data.addressed_to, 'nothing was redirected');

    // The GROUP response shape: a local support thread was opened, so there is a conversation id and
    // a participant list rather than a single message record.
    const convo = await C.json(`/v1/messages/conversations/${r.body.data.conversation_id}`, { headers: auth(C.ownerToken) });
    assert(convo.body.data?.conversation?.alias === 'support@operators', 'a local support thread was opened');
    assert(convo.body.data.conversation.participants.includes(C.ownerGhii), 'with the customer as its operator');
});

await test('S10. REFUSED — a second peer cannot also answer support', async () => {
    // Two answers to "who answers support here" is not a richer configuration, it is an ambiguity
    // resolved by whichever peer the iterator reached first.
    const other = 'aimeat-peer-001-second';
    await C.json('/v1/federation/peers', {
        method: 'POST', headers: auth(C.ownerToken), body: JSON.stringify({ node_id: other, url: 'http://localhost:49995' }),
    });
    await C.json(`/v1/federation/peers/${other}`, {
        method: 'PUT', headers: auth(C.ownerToken), body: JSON.stringify({ status: 'active', tier: 'contact' }),
    });
    const r = await C.json(`/v1/federation/peers/${other}`, {
        method: 'PUT', headers: auth(C.ownerToken), body: JSON.stringify({ support_upstream: true }),
    });
    assert(r.status === 409, `expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'ONE_UPSTREAM_ONLY', `got ${r.body.error?.code}`);
});

await test('S10b. The refused PUT changed nothing: a 409 leaves the peer as it was', async () => {
    // Invariant 14 (audit AI-triage 2026-08-23): the handler used to mutate the live peers-Map
    // object field by field and 409 in the middle, so the refused request had already promoted the
    // peer in memory while storage kept the old row. Against the pre-fix source the tier below
    // reads 'member'.
    const other = 'aimeat-peer-001-second';
    const r = await C.json(`/v1/federation/peers/${other}`, {
        method: 'PUT', headers: auth(C.ownerToken),
        body: JSON.stringify({ tier: 'member', support_upstream: true }),
    });
    assert(r.status === 409, `expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);

    const list = await C.json('/v1/federation/peers', { headers: auth(C.ownerToken) });
    const row = (list.body.data.peers as any[]).find(p => p.node_id === other);
    assert(!!row && row.tier === 'contact', `the refused PUT promoted the peer anyway: ${JSON.stringify(row?.tier)}`);
    assert(row.support_upstream !== true, 'and it did not take support either');
});

await test('S10c. A pair thread continued by id alone is NOT rerouted to the vendor\'s support', async () => {
    // Invariant 13 (audit AI-triage 2026-08-23): an omitted `to` used to count as "addressed to
    // support" by itself, so on a node with a support upstream ANY pair thread continued with just
    // its conversation id was silently delivered to the vendor's support queue instead of the
    // thread's real counterparty. Against the pre-fix source the continuation below answers 201
    // with addressed_to support@{vendor}.
    const opened = await C.json('/v1/messages', {
        method: 'POST', headers: auth(C.ownerToken),
        body: JSON.stringify({ to: V.ownerGhii, subject: 'Private thread', body: 'Between the two of us.' }),
    });
    assert(opened.status === 201, `open pair thread: ${opened.status} ${JSON.stringify(opened.body)}`);
    const pairId = opened.body.data.conversation_id ?? opened.body.data.message?.conversationId;
    assert(typeof pairId === 'string' && pairId.length > 0, 'the pair thread has an id');

    const cont = await C.json('/v1/messages', {
        method: 'POST', headers: auth(C.ownerToken),
        body: JSON.stringify({ conversation_id: pairId, body: 'Still between the two of us.' }),
    });
    assert(cont.body.data?.addressed_to !== `support@${V.nodeId}`,
        `the private continuation was rerouted to the vendor's support: ${JSON.stringify(cont.body.data)}`);
    assert(cont.status === 400, `an id-only pair continuation asks for its recipient (400), got ${cont.status}: ${JSON.stringify(cont.body)}`);
});

await test('S11. Taking support back makes support@operators local again, immediately', async () => {
    const off = await C.json(`/v1/federation/peers/${V.nodeId}`, {
        method: 'PUT', headers: auth(C.ownerToken), body: JSON.stringify({ support_upstream: false }),
    });
    assert(off.status === 200, `revoke: ${off.status}`);

    const r = await C.json('/v1/messages', {
        method: 'POST', headers: auth(agent.token),
        body: JSON.stringify({ to: 'support@operators', subject: 'After the revoke', body: 'Who answers now?' }),
    });
    assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert(!r.body.data.addressed_to, `nothing may leave the node now, got ${r.body.data.addressed_to}`);
    // And it reaches the customer, who is the only operator — which is the bug fixed alongside this.
    assert(r.body.data.delivered_to >= 1, `the local operator is told, got ${r.body.data.delivered_to}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
V!.server.close();
C!.server.close();
process.exit(failed > 0 ? 1 : 0);
