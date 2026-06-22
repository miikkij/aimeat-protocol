// E2E Tests for Agent Federated Direct Messages (Phase A)
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-dm
//
// Verifies the federated-inbox send path FROM an agent: an agent holding messages:send can send a
// direct message (and attachments) to a person across the node, the sender is the agent's GAII, the
// recipient receives it past the first-contact gate, and an agent WITHOUT messages:send is rejected.
// (The aimeat_dm_send MCP tool is a thin wrapper over the same sendDirectMessage path exercised here.)

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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        if (res.status === 429 && attempt < retries) {
            await sleep(Number(res.headers.get('Retry-After') || '5') * 1000 + 500);
            continue;
        }
        return { status: res.status, body };
    }
    throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent ? { gaii: ownerOrGaii, timestamp, signature } : { owner: ownerOrGaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

async function registerOwner(name: string): Promise<{ token: string; ghii: string }> {
    const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(status === 201, `register owner ${name}: ${status} ${JSON.stringify(body)}`);
    const token = await getToken(name, body.data.private_key, false);
    return { token, ghii: `${name}@${NODE_ID}` };
}

async function createAgent(ownerName: string, ownerToken: string, agentName: string, scopes: string[]): Promise<{ gaii: string; token: string }> {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'], scopes }),
    });
    assert(status === 201, `create agent ${agentName}: ${status} ${JSON.stringify(body)}`);
    const gaii = body.data.agent.gaii;
    const token = await getToken(gaii, body.data.private_key, true);
    return { gaii, token };
}

// ─── State ───
const stamp = Date.now();
const aliceName = `dmalice${stamp}`;  // owner of the sending agents
const bobName = `dmbob${stamp}`;      // recipient human
let bob = { token: '', ghii: '' };
let dmbot = { gaii: '', token: '' };  // agent WITH messages:send
let mute = { gaii: '', token: '' };   // agent WITHOUT messages:send

console.log('\n=== AIMEAT Agent Federated DM E2E (Phase A) ===\n');

console.log('Setup — owners + agents');
await test('Register owner Alice + Bob', async () => {
    const alice = await registerOwner(aliceName);
    bob = await registerOwner(bobName);
    dmbot = await createAgent(aliceName, alice.token, 'dmbot', ['messages:send', 'storage:write']);
    mute = await createAgent(aliceName, alice.token, 'mutebot', ['memory:read']);
    assert(dmbot.gaii.startsWith('dmbot#'), `agent gaii: ${dmbot.gaii}`);
});

console.log('\nPhase A — agent sends a federated DM');
await test('1. Agent WITHOUT messages:send is rejected (403)', async () => {
    const { status } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${mute.token}` },
        body: JSON.stringify({ to: bob.ghii, body: 'should be blocked by scope' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('2. Agent WITH messages:send sends a DM — sender is the agent GAII', async () => {
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${dmbot.token}` },
        body: JSON.stringify({ to: bob.ghii, body: 'Hei! Olen Alicen agentti, raportoin tuloksen.' }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.senderGhii === dmbot.gaii, `sender should be the agent, got ${body.data.message.senderGhii}`);
    assert(body.data.message.recipientGhii === bob.ghii, `recipient should be Bob, got ${body.data.message.recipientGhii}`);
});

await test('3. Agent sends a DM with two attachments (storage-key references)', async () => {
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${dmbot.token}` },
        body: JSON.stringify({
            to: bob.ghii,
            body: 'Tässä kaksi liitettä.',
            attachments: [
                { storage_key: `dmbot-shot-${stamp}.png`, mime: 'image/png', kind: 'image', size: 2048, name: 'shot.png' },
                { storage_key: `dmbot-notes-${stamp}.md`, mime: 'text/markdown', kind: 'file', size: 512, name: 'notes.md' },
            ],
        }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert((body.data.message.attachments?.length ?? 0) === 2, `expected 2 attachments, got ${body.data.message.attachments?.length}`);
    assert(body.data.message.attachments[0].storageKey === `dmbot-shot-${stamp}.png`, 'first attachment storageKey preserved');
});

await test('4. Body-less + attachment-less message is rejected (400)', async () => {
    const { status } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${dmbot.token}` },
        body: JSON.stringify({ to: bob.ghii, body: '   ' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

console.log('\nPhase A — delivery past the first-contact gate');
await test('5. Bob sees the agent as a pending request, accepts, then the DM is in his inbox', async () => {
    const reqs = await json('/v1/messages/requests', { headers: { Authorization: `Bearer ${bob.token}` } });
    const fromAgent = reqs.body.data.requests.find((r: any) => r.contactId === dmbot.gaii);
    assert(fromAgent !== undefined, `expected a pending request from ${dmbot.gaii}`);

    const acc = await json(`/v1/messages/requests/${encodeURIComponent(dmbot.gaii)}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
    });
    assert(acc.status === 200, `accept failed: ${acc.status} ${JSON.stringify(acc.body)}`);

    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
    const m = inbox.body.data.messages.find((x: any) => x.senderGhii === dmbot.gaii && /Alicen agentti/.test(x.body));
    assert(m !== undefined, 'Bob inbox should contain the agent-sent DM after accepting');
});

console.log('\nPhase B — agent reads its federated inbox (two-way)');
let readbot = { gaii: '', token: '' };   // agent with messages:read (+send)
await test('6. Setup: agent with messages:read + a human who messages it', async () => {
    const alice = await registerOwner(`dmreadowner${stamp}`);
    readbot = await createAgent(`dmreadowner${stamp}`, alice.token, 'readbot', ['messages:send', 'messages:read']);
    // Bob messages the agent directly → delivered to the agent's owner mailbox, recipient = the agent.
    const send = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
        body: JSON.stringify({ to: readbot.gaii, body: 'Hei readbot, tässä ihmiseltä viesti agentille.' }),
    });
    assert(send.status === 201, `bob→agent send ${send.status}: ${JSON.stringify(send.body)}`);
});

await test('7. Agent reads its federated inbox (sees the message addressed to it)', async () => {
    const r = await json('/v1/messages/agent-inbox', { headers: { Authorization: `Bearer ${readbot.token}` } });
    assert(r.status === 200, `agent-inbox ${r.status}: ${JSON.stringify(r.body)}`);
    const m = r.body.data.messages.find((x: any) => x.recipientGhii === readbot.gaii && /ihmiseltä viesti agentille/.test(x.body));
    assert(m !== undefined, 'agent sees the DM addressed to it');
});

await test('8. Agent reads the full thread (its own reply + the inbound message)', async () => {
    const inbox = await json('/v1/messages/agent-inbox', { headers: { Authorization: `Bearer ${readbot.token}` } });
    const conv = inbox.body.data.messages[0].conversationId;
    // Agent replies in-thread.
    await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${readbot.token}` },
        body: JSON.stringify({ to: bob.ghii, body: 'Kiitos, hoidan asian!', conversation_id: conv }),
    });
    const thread = await json(`/v1/messages/agent-thread/${encodeURIComponent(conv)}`, { headers: { Authorization: `Bearer ${readbot.token}` } });
    assert(thread.status === 200, `agent-thread ${thread.status}`);
    const hasInbound = thread.body.data.messages.some((m: any) => m.direction === 'inbound' && m.recipientGhii === readbot.gaii);
    const hasOutbound = thread.body.data.messages.some((m: any) => m.direction === 'outbound' && m.senderGhii === readbot.gaii);
    assert(hasInbound && hasOutbound, `thread should show both directions (in:${hasInbound} out:${hasOutbound})`);
});

await test('9. Agent WITHOUT messages:read cannot read the inbox (403)', async () => {
    const r = await json('/v1/messages/agent-inbox', { headers: { Authorization: `Bearer ${dmbot.token}` } });
    assert(r.status === 403, `expected 403 for missing messages:read, got ${r.status}`);
});

console.log('\nPhase C — owner DMs its OWN agent through the inbox (uniform channel, with attachments)');
await test('10. Owner can DM its own agent (with an attachment); the agent reads it; owner sees the thread', async () => {
    const owner = await registerOwner(`selfowner${stamp}`);
    const myAgent = await createAgent(`selfowner${stamp}`, owner.token, 'mybot', ['messages:read']);
    const send = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({
            to: myAgent.gaii,
            body: 'Hei oma agentti — hoida tämä liite.',
            attachments: [{ storage_key: `selftask-${stamp}.pdf`, mime: 'application/pdf', kind: 'file', size: 1024, name: 'task.pdf' }],
        }),
    });
    assert(send.status === 201, `own-agent send should be 201, got ${send.status}: ${JSON.stringify(send.body)}`);
    assert(send.body.data.message.recipientGhii === myAgent.gaii, `thread is with the agent, got ${send.body.data.message.recipientGhii}`);

    // The agent reads the DM addressed to it (with the attachment).
    const inbox = await json('/v1/messages/agent-inbox', { headers: { Authorization: `Bearer ${myAgent.token}` } });
    const m = inbox.body.data.messages.find((x: any) => x.recipientGhii === myAgent.gaii && /oma agentti/.test(x.body));
    assert(m !== undefined, 'the agent reads the DM its owner sent it');
    assert(m.senderGhii === owner.ghii, `from the owner, got ${m.senderGhii}`);
    assert((m.attachments?.length ?? 0) === 1, `attachment delivered to the agent, got ${m.attachments?.length}`);

    // The owner sees their sent copy as a thread with the agent (so they can follow + intervene).
    const convs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${owner.token}` } });
    assert(convs.body.data.conversations.some((c: any) => c.peerGhii === myAgent.gaii), 'owner sees the thread with their own agent');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
