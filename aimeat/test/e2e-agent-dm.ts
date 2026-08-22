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
let alice = { token: '', ghii: '' };  // owner of the sending agents
let bob = { token: '', ghii: '' };
let dmbot = { gaii: '', token: '' };  // agent WITH messages:send
let mute = { gaii: '', token: '' };   // agent WITHOUT messages:send

console.log('\n=== AIMEAT Agent Federated DM E2E (Phase A) ===\n');

console.log('Setup — owners + agents');
await test('Register owner Alice + Bob', async () => {
    alice = await registerOwner(aliceName);
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

console.log('\nOwner-aggregation — the owner sees their agent\'s outbound conversations (read-only)');
await test('11. Alice (owner) sees dmbot\'s conversation with Bob in her list, tagged viaAgent', async () => {
    const convs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(convs.status === 200, `conversations ${convs.status}`);
    const c = convs.body.data.conversations.find((x: any) => x.peerGhii === bob.ghii && x.viaAgent === dmbot.gaii);
    assert(c !== undefined, 'Alice sees the agent→Bob conversation tagged viaAgent=dmbot');
});

await test('12. Alice reads that thread read-only via ?agent=<dmbot> and sees the agent\'s message', async () => {
    const convs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } });
    const c = convs.body.data.conversations.find((x: any) => x.viaAgent === dmbot.gaii);
    const thread = await json(`/v1/messages/conversations/${encodeURIComponent(c.conversationId)}?agent=${encodeURIComponent(dmbot.gaii)}`, { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(thread.status === 200, `thread ${thread.status}: ${JSON.stringify(thread.body)}`);
    const m = thread.body.data.messages.find((x: any) => x.senderGhii === dmbot.gaii);
    assert(m !== undefined, 'Alice reads the agent\'s outbound message in the thread');
});

await test('13. ?agent= must be one of the owner\'s OWN agents (Bob cannot read Alice\'s agent thread) → 403', async () => {
    const convs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } });
    const c = convs.body.data.conversations.find((x: any) => x.viaAgent === dmbot.gaii);
    // Bob asks to read the thread AS dmbot (not his agent) → 403.
    const forbidden = await json(`/v1/messages/conversations/${encodeURIComponent(c.conversationId)}?agent=${encodeURIComponent(dmbot.gaii)}`, { headers: { Authorization: `Bearer ${bob.token}` } });
    assert(forbidden.status === 403, `expected 403 for a non-owned agent, got ${forbidden.status}`);
});

await test('14. Bob (a different owner) does NOT see Alice\'s agent conversations in his list', async () => {
    const convs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${bob.token}` } });
    const leaked = convs.body.data.conversations.find((x: any) => x.viaAgent === dmbot.gaii);
    assert(leaked === undefined, 'Bob must not see Alice\'s agent-owned conversations');
});

console.log('\nPhase D — an agent in a GROUP thread (support@operators) can read its own correspondence');
// A group message is addressed to the THREAD, and every copy is written to the mailbox its participant
// resolves to — for an agent, its OWNER's. So the agent's identity is on none of the rows: the two
// predicates that find a 1:1 message (own copy / addressed to me) match nothing, and the agent that had
// just reported a problem was told its own thread held 0 messages. The owner's mailbox meanwhile showed
// the agent's words as `outbound`, which the inbox renders as "You:".
const grpOwnerName = `grpowner${stamp}`;
let grpOwner = { token: '', ghii: '' };
let grpbot = { gaii: '', token: '' };
let bobbot = { gaii: '', token: '' };
let supportConv = '';
let unreadOwner = { token: '', ghii: '' };
let unreadConv = '';

await test('15. An agent writes to support@operators and gets a conversation id back', async () => {
    grpOwner = await registerOwner(grpOwnerName);
    grpbot = await createAgent(grpOwnerName, grpOwner.token, 'grpbot', ['messages:send', 'messages:read']);
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${grpbot.token}` },
        body: JSON.stringify({ to: 'support@operators', subject: 'completeJson drops the schema', body: 'The parameter never leaves the library.' }),
    });
    assert(status === 201, `support send ${status}: ${JSON.stringify(body)}`);
    supportConv = body.data.conversation_id;
    assert(typeof supportConv === 'string' && supportConv.length > 0, 'a support send returns the thread id');
    assert(body.data.participants.includes(grpbot.gaii), `the agent is in its own thread, got ${JSON.stringify(body.data.participants)}`);
    // Alice is the first owner registered on this node, so she carries the operator role.
    assert(body.data.participants.includes(alice.ghii), `the operator must be a participant, got ${JSON.stringify(body.data.participants)}`);
});

await test('16. The SAME agent reads that thread back by the id it was just handed', async () => {
    const { status, body } = await json(`/v1/messages/agent-thread/${encodeURIComponent(supportConv)}`, {
        headers: { Authorization: `Bearer ${grpbot.token}` },
    });
    assert(status === 200, `agent-thread ${status}: ${JSON.stringify(body)}`);
    assert(body.data.total >= 1, `the agent must see its own report, got total ${body.data.total}`);
    const mine = body.data.messages.find((m: any) => m.senderGhii === grpbot.gaii && /never leaves the library/.test(m.body));
    assert(mine !== undefined, `the agent's own message is in the thread, got ${JSON.stringify(body.data.messages.map((m: any) => m.senderGhii))}`);
});

await test('17. The operator answers, and the answer reaches the agent\'s own inbox', async () => {
    const reply = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ conversation_id: supportConv, body: 'Confirmed — the library never sent it.' }),
    });
    assert(reply.status === 201, `operator reply ${reply.status}: ${JSON.stringify(reply.body)}`);

    const inbox = await json('/v1/messages/agent-inbox', { headers: { Authorization: `Bearer ${grpbot.token}` } });
    assert(inbox.status === 200, `agent-inbox ${inbox.status}`);
    const answer = inbox.body.data.messages.find((m: any) => m.conversationId === supportConv && /never sent it/.test(m.body));
    assert(answer !== undefined, `the agent must see the answer to its own report, got ${JSON.stringify(inbox.body.data.messages.map((m: any) => m.body))}`);
    const ownEcho = inbox.body.data.messages.find((m: any) => m.senderGhii === grpbot.gaii);
    assert(ownEcho === undefined, 'an inbox holds what arrived, not what the agent itself sent');
});

await test('18. The owner sees the thread as a group their AGENT spoke in, not as their own send', async () => {
    const { status, body } = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${grpOwner.token}` } });
    assert(status === 200, `conversations ${status}`);
    const row = (body.data.conversations ?? []).find((c: any) => c.conversationId === supportConv);
    assert(row !== undefined, 'the owner sees their agent\'s support thread');
    assert(row.groupAlias === 'support@operators', `the row is a group thread, got ${JSON.stringify(row.groupAlias)}`);
    assert(row.lastSenderGhii === alice.ghii, `the last word was the operator's, got ${row.lastSenderGhii}`);
});

await test('19. Before the operator answers, the owner\'s row names the agent that spoke', async () => {
    // Same shape as 18 at the moment the agent has just written: the newest message is the agent's, the
    // copy sits in the owner's mailbox marked outbound, and the list said "You:" over it.
    const owner2 = await registerOwner(`grpowner2${stamp}`);
    const bot2 = await createAgent(`grpowner2${stamp}`, owner2.token, 'grpbot2', ['messages:send']);
    const send = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${bot2.token}` },
        body: JSON.stringify({ to: 'support@operators', subject: 'Second report', body: 'Nobody has answered yet.' }),
    });
    assert(send.status === 201, `support send ${send.status}: ${JSON.stringify(send.body)}`);

    const { body } = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${owner2.token}` } });
    const row = (body.data.conversations ?? []).find((c: any) => c.conversationId === send.body.data.conversation_id);
    assert(row !== undefined, 'the owner sees the thread');
    assert(row.lastDirection === 'outbound', `the copy is still the agent's send, got ${row.lastDirection}`);
    assert(row.sentByAgent === bot2.gaii, `the row must name the agent that spoke, got ${JSON.stringify(row.sentByAgent)}`);
    unreadOwner = owner2;
    unreadConv = send.body.data.conversation_id;
});

await test('20. Another owner\'s agent gets nothing from that thread (no leak) ', async () => {
    bobbot = await createAgent(bobName, bob.token, 'bobbot', ['messages:read']);
    const thread = await json(`/v1/messages/agent-thread/${encodeURIComponent(supportConv)}`, {
        headers: { Authorization: `Bearer ${bobbot.token}` },
    });
    assert(thread.status === 200, `agent-thread ${thread.status}`);
    assert(thread.body.data.total === 0, `a stranger's agent must see nothing, got ${thread.body.data.total}`);

    const inbox = await json('/v1/messages/agent-inbox', { headers: { Authorization: `Bearer ${bobbot.token}` } });
    const leaked = (inbox.body.data.messages ?? []).find((m: any) => m.conversationId === supportConv);
    assert(leaked === undefined, 'a stranger\'s agent must not receive the thread in its inbox');
});

await test('21. A sibling agent of the same owner is not in the thread and does not read it', async () => {
    // Membership for the inbox is the EXACT participant match, not "someone in this household is in it".
    const sibling = await createAgent(grpOwnerName, grpOwner.token, 'grpsibling', ['messages:read']);
    const inbox = await json('/v1/messages/agent-inbox', { headers: { Authorization: `Bearer ${sibling.token}` } });
    assert(inbox.status === 200, `agent-inbox ${inbox.status}`);
    const leaked = (inbox.body.data.messages ?? []).find((m: any) => m.conversationId === supportConv);
    assert(leaked === undefined, 'a sibling agent was never named in the thread, so it is not its correspondence');
});

console.log('\nPhase E — a message your agent sent in your name counts as unread until YOU look');
// The badge counted `direction = 'inbound'`, which was a stand-in for "somebody other than me wrote
// it". A group thread put the agent's sent copy in its owner's mailbox marked outbound, so four
// reports from three agents arrived already read and raised nothing. Unread is now "not written by
// me, and I have not looked at it", which is a different field from readAt: readAt on that same row
// is the RECIPIENT's read receipt, so keying the badge on it would let the operator clear it.

async function unreadFor(token: string, conversationId: string): Promise<number> {
    const { body } = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${token}` } });
    const row = (body.data.conversations ?? []).find((c: any) => c.conversationId === conversationId);
    return row ? row.unread : -1;
}

await test('22. The owner\'s badge counts what their agent sent in their name', async () => {
    const unread = await unreadFor(unreadOwner.token, unreadConv);
    assert(unread === 1, `the agent's send must be unread for its owner, got ${unread}`);
});

await test('23. An OPERATOR reading it does not clear the owner\'s badge', async () => {
    // The operator's reading stamps readAt on the owner's copy, because that copy is the outbound one
    // and readAt is the read receipt. If the badge were keyed on readAt it would go to zero here, and
    // the owner would never learn their agent had written.
    const read = await json(`/v1/messages/conversations/${encodeURIComponent(unreadConv)}/read`, {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
    });
    assert(read.status === 200, `operator read ${read.status}: ${JSON.stringify(read.body)}`);
    const unread = await unreadFor(unreadOwner.token, unreadConv);
    assert(unread === 1, `somebody else's reading must not clear my badge, got ${unread}`);
});

await test('24. Opening the thread clears it, and does not fake a read receipt', async () => {
    const before = await json(`/v1/messages/conversations/${encodeURIComponent(unreadConv)}`, {
        headers: { Authorization: `Bearer ${unreadOwner.token}` },
    });
    const agentRow = before.body.data.messages.find((m: any) => m.direction === 'outbound');
    assert(agentRow !== undefined, 'the agent\'s copy is in the owner\'s mailbox');
    const statusBefore = agentRow.status;

    const read = await json(`/v1/messages/conversations/${encodeURIComponent(unreadConv)}/read`, {
        method: 'POST', headers: { Authorization: `Bearer ${unreadOwner.token}` },
    });
    assert(read.status === 200, `owner read ${read.status}`);
    const unread = await unreadFor(unreadOwner.token, unreadConv);
    assert(unread === 0, `opening the thread clears the badge, got ${unread}`);

    const after = await json(`/v1/messages/conversations/${encodeURIComponent(unreadConv)}`, {
        headers: { Authorization: `Bearer ${unreadOwner.token}` },
    });
    const agentAfter = after.body.data.messages.find((m: any) => m.id === agentRow.id);
    assert(agentAfter.status === statusBefore,
        `reading my own mailbox must not restate delivery on an outbound row (${statusBefore} -> ${agentAfter.status})`);
});

await test('25. My own sends still never count against me', async () => {
    const send = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${unreadOwner.token}` },
        body: JSON.stringify({ conversation_id: unreadConv, body: 'Kirjoitan itse, joten tämä ei ole minulta lukematta.' }),
    });
    assert(send.status === 201, `own reply ${send.status}: ${JSON.stringify(send.body)}`);
    const unread = await unreadFor(unreadOwner.token, unreadConv);
    assert(unread === 0, `my own words are not unread for me, got ${unread}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
