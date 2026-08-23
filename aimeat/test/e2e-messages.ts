// E2E Tests for Human↔Human Direct Messages (GHII↔GHII), local (same-node) delivery + first-contact gate.
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-messages
// v1.0.0 -- 2026-06-16 -- Initial: send/inbox/conversations/read/reply, request gate, accept, block.

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
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        if (res.status === 429 && attempt < retries) {
            const retryAfter = Number(res.headers.get('Retry-After') || '5');
            await sleep(retryAfter * 1000 + 500);
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

async function ownerToken(name: string, privKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, name + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

async function registerOwner(name: string): Promise<{ token: string; ghii: string }> {
    const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(status === 201, `register ${name}: ${status} ${JSON.stringify(body)}`);
    const token = await ownerToken(name, body.data.private_key);
    return { token, ghii: `${name}@${NODE_ID}` };
}

/** An agent belonging to `ownerName`. An agent token signs its GAII, not owner + node id. */
async function createAgent(ownerName: string, token: string, agentName: string, scopes: string[]): Promise<{ gaii: string; token: string }> {
    const { status, body } = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'], scopes }),
    });
    assert(status === 201, `create agent ${agentName}: ${status} ${JSON.stringify(body)}`);
    const gaii = body.data.agent.gaii;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(body.data.private_key, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    return { gaii, token: tok.body.data.token };
}

const stamp = Date.now();
// The first owner on a fresh node becomes the OPERATOR, and the operator greets every new account
// with a welcome message that (by design) opens the contact both ways. Alice used to be that first
// owner, which quietly made her and Bob acquaintances before test 1 ran and broke the first-contact
// gate this suite exists to test. A throwaway operator keeps Alice, Bob and Mallory strangers.
const opName = `dmop${stamp}`;
const aliceName = `dmalice${stamp}`;
const bobName = `dmbob${stamp}`;
const malName = `dmmal${stamp}`;
let op = { token: '', ghii: '' };
let alice = { token: '', ghii: '' };
let bob = { token: '', ghii: '' };
let mal = { token: '', ghii: '' };

let msg1Id = '';
let convId = '';

console.log('\n=== AIMEAT Direct Messages (human↔human) E2E ===\n');

console.log('Setup -- three owners');
await test('Register Alice, Bob, Mallory', async () => {
    op = await registerOwner(opName);   // absorbs the operator role; see the note above
    alice = await registerOwner(aliceName);
    bob = await registerOwner(bobName);
    mal = await registerOwner(malName);
});

console.log('\nPhase 1 -- First contact becomes a request (gated)');
await test('1. Alice sends first message to Bob', async () => {
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: bob.ghii, body: 'Hi Bob, **markdown** hello!' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.status === 'delivered', `status: ${body.data.message.status}`);
    assert(body.data.message.senderGhii === alice.ghii, 'sender is alice');
    msg1Id = body.data.message.id;
    convId = body.data.message.conversationId;
    assert(typeof convId === 'string' && convId.length > 0, 'has conversationId');
});

await test('2. Bob sees it as a pending request (NOT in inbox yet)', async () => {
    const reqs = await json('/v1/messages/requests', { headers: { Authorization: `Bearer ${bob.token}` } });
    assert(reqs.status === 200, `requests status ${reqs.status}`);
    const r = reqs.body.data.requests.find((x: any) => x.contactId === alice.ghii);
    assert(r !== undefined, 'alice appears in Bob requests');

    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
    const inInbox = inbox.body.data.messages.find((m: any) => m.id === msg1Id);
    assert(inInbox === undefined, 'pending request not shown in normal inbox');
});

await test('3. Cannot read accepted-only conversations until accepted', async () => {
    const conv = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${bob.token}` } });
    const c = conv.body.data.conversations.find((x: any) => x.conversationId === convId);
    assert(c === undefined, 'pending convo hidden from conversation list');
});

console.log('\nPhase 2 -- Accept + reply (reciprocity)');
await test('4. Bob accepts the request', async () => {
    const { status, body } = await json(`/v1/messages/requests/${encodeURIComponent(alice.ghii)}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.contact.state === 'accepted', 'state accepted');
});

await test('5. Message now appears in Bob inbox (unread=1)', async () => {
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
    const m = inbox.body.data.messages.find((x: any) => x.id === msg1Id);
    assert(m !== undefined, 'accepted message visible in inbox');
    assert(inbox.body.data.unread >= 1, `unread should be >=1, got ${inbox.body.data.unread}`);
});

await test('6. Bob replies; Alice receives it freely (no request gate on initiator)', async () => {
    const send = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
        body: JSON.stringify({ to: alice.ghii, body: 'Hey Alice, got it!', reply_to: msg1Id }),
    });
    assert(send.status === 201, `reply status ${send.status}: ${JSON.stringify(send.body)}`);
    assert(send.body.data.message.conversationId === convId, 'reply shares conversationId');

    // Alice should have NO pending request from Bob, and should see the reply in her inbox directly.
    const reqs = await json('/v1/messages/requests', { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(reqs.body.data.requests.find((x: any) => x.contactId === bob.ghii) === undefined, 'no request gate on Alice');
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(inbox.body.data.messages.some((m: any) => m.senderGhii === bob.ghii), 'Bob reply in Alice inbox');
});

console.log('\nPhase 3 -- Thread + read receipts');
await test('7. Bob reads the conversation; receipt flips Alice sent-copy to read', async () => {
    const read = await json(`/v1/messages/conversations/${convId}/read`, {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
    });
    assert(read.status === 200, `read status ${read.status}`);
    // Alice's outbound copy (msg1) should now be 'read'.
    const conv = await json(`/v1/messages/conversations/${convId}`, { headers: { Authorization: `Bearer ${alice.token}` } });
    const aliceCopy = conv.body.data.messages.find((m: any) => m.id === msg1Id);
    assert(aliceCopy !== undefined, 'alice has her copy of msg1');
    assert(aliceCopy.status === 'read', `alice copy status should be read, got ${aliceCopy.status}`);
});

await test('8. Conversation now appears for Bob and unread cleared', async () => {
    const conv = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${bob.token}` } });
    const c = conv.body.data.conversations.find((x: any) => x.conversationId === convId);
    assert(c !== undefined, 'accepted convo visible');
    assert(c.unread === 0, `unread should be 0 after read, got ${c.unread}`);
    assert(c.peerGhii === alice.ghii, `peer should be alice, got ${c.peerGhii}`);
});

console.log('\nPhase 4 -- Attachment duplication (local, accepted contact)');
let attKey = '';
let attMsgId = '';
await test('9. Alice uploads an image to storage', async () => {
    attKey = `dm-img-${stamp}.png`;
    const data = Buffer.from('fake-png-bytes').toString('base64');
    const up = await json('/v1/storage', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ key: attKey, data, mime_type: 'image/png', visibility: 'private' }),
    });
    assert(up.body.ok === true, `upload: ${JSON.stringify(up.body)}`);
});

await test('10. Alice sends message with attachment; Bob gets a DUPLICATED copy', async () => {
    const send = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({
            to: bob.ghii,
            body: 'Here is a photo ![pic](cid:a1)',
            attachments: [{ storage_key: attKey, mime: 'image/png', size: 14, kind: 'image', inline: true, id: 'a1' }],
        }),
    });
    assert(send.status === 201, `send status ${send.status}: ${JSON.stringify(send.body)}`);
    attMsgId = send.body.data.message.id;

    const conv = await json(`/v1/messages/conversations/${convId}`, { headers: { Authorization: `Bearer ${bob.token}` } });
    const bm = conv.body.data.messages.find((m: any) => m.id === attMsgId);
    assert(bm !== undefined, 'Bob has the attachment message');
    const att = bm.attachments?.[0];
    assert(att?.mode === 'duplicate', `Bob attachment should be duplicate, got ${att?.mode}`);
    assert(typeof att?.localKey === 'string' && att.localKey.length > 0, 'Bob copy has a localKey');
});

await test('11. The duplicated file exists in Bob storage', async () => {
    const files = await json('/v1/storage', { headers: { Authorization: `Bearer ${bob.token}` } });
    const conv = await json(`/v1/messages/conversations/${convId}`, { headers: { Authorization: `Bearer ${bob.token}` } });
    const localKey = conv.body.data.messages.find((m: any) => m.id === attMsgId).attachments[0].localKey;
    const found = files.body.data.files.find((f: any) => f.key === localKey);
    assert(found !== undefined, `Bob storage should contain ${localKey}`);
    assert(found.size === 14, `duplicated size should be 14, got ${found.size}`);
});

console.log('\nPhase 5 -- Block (failure mode)');
await test('12. Bob blocks Mallory proactively; Mallory send is rejected', async () => {
    const block = await json(`/v1/messages/contacts/${encodeURIComponent(mal.ghii)}/block`, {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
    });
    assert(block.status === 200, `block status ${block.status}`);

    const send = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${mal.token}` },
        body: JSON.stringify({ to: bob.ghii, body: 'spam spam spam' }),
    });
    assert(send.status === 403, `blocked send should be 403, got ${send.status}`);
    assert(send.body.error?.code === 'BLOCKED', `code BLOCKED, got ${send.body.error?.code}`);

    // Nothing landed in Bob's inbox or requests from Mallory.
    const reqs = await json('/v1/messages/requests', { headers: { Authorization: `Bearer ${bob.token}` } });
    assert(reqs.body.data.requests.find((x: any) => x.contactId === mal.ghii) === undefined, 'no request from blocked Mallory');
});

console.log('\nPhase 6 -- Validation');
await test('13. Sending to a non-existent local recipient 404s', async () => {
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: `nobodyhere${stamp}@${NODE_ID}`, body: 'hello?' }),
    });
    assert(status === 404, `status ${status}`);
    assert(body.error?.code === 'RECIPIENT_NOT_FOUND', `code: ${body.error?.code}`);
});

await test('14. Empty message (no body, no attachments) is rejected', async () => {
    const { status } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: bob.ghii, body: '   ' }),
    });
    assert(status === 400, `status ${status}`);
});

await test('15. Cannot message yourself', async () => {
    const { status } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: alice.ghii, body: 'note to self' }),
    });
    assert(status === 400, `status ${status}`);
});

console.log('\nPhase 7 -- Reply to an agent is delivered to the agent\'s owner inbox');
await test('16. Replying to an agent GAII delivers to the owner (thread keeps the agent)', async () => {
    const agentGaii = `someagent#${bobName}@${NODE_ID}`;   // bob's agent (need not exist) — reply lands in bob's inbox
    const send = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: agentGaii, body: 'Done — homma hoidettu, omnituinen-agent!' }),
    });
    assert(send.status === 201, `agent send should be 201, got ${send.status}: ${JSON.stringify(send.body)}`);
    assert(send.body.data.message.recipientGhii === agentGaii, `thread keeps the agent GAII, got ${send.body.data.message.recipientGhii}`);
    // Bob (the owner) is an accepted contact of Alice (phases 1–6) → the agent-addressed reply lands in his inbox.
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
    const m = inbox.body.data.messages.find((x: any) => x.senderGhii === alice.ghii && x.recipientGhii === agentGaii && /homma hoidettu/.test(x.body));
    assert(m !== undefined, 'owner bob received the agent-addressed reply in his inbox');
});

await test('17. Can message your OWN agent via the inbox (allowed; not a self-message)', async () => {
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: `myagent#${aliceName}@${NODE_ID}`, body: 'to my own agent' }),
    });
    assert(status === 201, `own-agent send should be 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.recipientGhii === `myagent#${aliceName}@${NODE_ID}`, 'thread is with the agent');
});

await test('17b. A LITERAL self-message (you → you) is still blocked', async () => {
    const { status } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: alice.ghii, body: 'note to self' }),
    });
    assert(status === 400, `literal self-message should be 400, got ${status}`);
});

console.log('\nPhase 8 -- Subject threads (start a new topic thread instead of one endless chat)');
await test('18. A subject opens a NEW thread distinct from the pair thread', async () => {
    const plain = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: bob.ghii, body: 'pair-thread message' }),
    });
    assert(plain.status === 201, `plain send ${plain.status}`);
    const pairConv = plain.body.data.message.conversationId;

    const subj = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: bob.ghii, body: 'topic opener', subject: 'Project Falcon' }),
    });
    assert(subj.status === 201, `subject send ${subj.status}: ${JSON.stringify(subj.body)}`);
    const subjConv = subj.body.data.message.conversationId;
    assert(subjConv && subjConv !== pairConv, `subject thread must differ from pair thread (${subjConv} vs ${pairConv})`);
    assert(subj.body.data.message.subject === 'Project Falcon', `message carries subject, got ${subj.body.data.message.subject}`);

    // Bob (recipient) sees the subject thread with its subject surfaced.
    const convs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${bob.token}` } });
    const sc = convs.body.data.conversations.find((c: any) => c.conversationId === subjConv);
    assert(sc !== undefined, 'bob sees the subject thread');
    assert(sc.subject === 'Project Falcon', `conversation surfaces subject, got ${sc.subject}`);
});

await test('19. Continuing a subject thread by conversation_id stays in that thread', async () => {
    const convs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } });
    const sc = convs.body.data.conversations.find((c: any) => c.subject === 'Project Falcon');
    assert(sc !== undefined, 'alice has the subject thread');
    const cont = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: bob.ghii, body: 'follow-up in topic', conversation_id: sc.conversationId }),
    });
    assert(cont.status === 201, `continue ${cont.status}`);
    assert(cont.body.data.message.conversationId === sc.conversationId, `stays in subject thread, got ${cont.body.data.message.conversationId}`);
    const thread = await json(`/v1/messages/conversations/${encodeURIComponent(sc.conversationId)}`, { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(thread.body.data.messages.length >= 2, `subject thread should have >=2 messages, got ${thread.body.data.messages.length}`);
});

console.log('\nPhase 5 -- Inbox overview composite (Phase 4 DbService)');
await test('20. GET /v1/messages/overview folds the inbox mount into one call, equal to its parts', async () => {
    const ov = await json('/v1/messages/overview', { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(ov.status === 200, `overview status ${ov.status}: ${JSON.stringify(ov.body)}`);
    const d = ov.body.data;
    // All six sections present as arrays.
    for (const k of ['requests', 'conversations', 'important', 'tracked', 'agents', 'groups']) {
        assert(Array.isArray(d[k]), `overview.${k} is an array (got ${typeof d[k]})`);
    }
    // conversations section equals the standalone endpoint (same composition, one read scope).
    const convs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(d.conversations.length === convs.body.data.conversations.length,
        `overview conversations (${d.conversations.length}) == /conversations (${convs.body.data.conversations.length})`);
    const ovIds = new Set(d.conversations.map((c: any) => c.conversationId));
    assert(convs.body.data.conversations.every((c: any) => ovIds.has(c.conversationId)), 'same conversation set');
    // requests section equals the standalone endpoint.
    const reqs = await json('/v1/messages/requests', { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(d.requests.length === reqs.body.data.requests.length,
        `overview requests (${d.requests.length}) == /requests (${reqs.body.data.requests.length})`);
});

await test('20b. overview.peerNames maps every conversation peer to its display name', async () => {
    const dn = `Bob Display ${stamp}`;
    const upd = await json('/v1/ghii', { method: 'PUT', headers: { Authorization: `Bearer ${bob.token}` }, body: JSON.stringify({ display_name: dn }) });
    assert(upd.status === 200, `set display name: ${upd.status} ${JSON.stringify(upd.body)}`);
    const ov = await json('/v1/messages/overview', { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(ov.status === 200, `overview status ${ov.status}`);
    const names = ov.body.data.peerNames;
    assert(!!names && typeof names === 'object' && !Array.isArray(names), 'peerNames is an object map');
    for (const c of ov.body.data.conversations) {
        assert(c.peerGhii in names, `peerNames covers peer ${c.peerGhii}`);
    }
    assert(names[bob.ghii] === dn, `peerNames[bob] resolves the display name (got "${names[bob.ghii]}")`);
});

await test('21. /v1/messages/overview requires an owner session (agent/anon rejected)', async () => {
    const anon = await json('/v1/messages/overview');
    assert(anon.status === 401 || anon.status === 403, `anon overview should be 401/403, got ${anon.status}`);
});

// ─── support@operators: a named address that reaches whoever runs the node ───
// The point of the address is that the sender needs to know nothing: not who the operator is, not
// what a GHII looks like, not whether there is one operator or three. It opens ONE group thread that
// every operator sees and answers in, in the same Messages surface they already use.
console.log('\nPhase 6 -- support@operators (group thread)');

let supportConvId = '';

await test('S1. Anyone can write to support@operators without knowing any operator identity', async () => {
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: 'support@operators', subject: 'Cannot finish onboarding', body: 'The configure_delivery step never passes.' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    supportConvId = body.data.conversation_id;
    assert(typeof supportConvId === 'string' && supportConvId.length > 0, 'a support send returns the thread id to reply into');
    assert(body.data.participants.includes(op.ghii), `the operator must be a participant, got ${JSON.stringify(body.data.participants)}`);
    assert(body.data.participants.includes(alice.ghii), 'the sender is in their own thread');
    assert(body.data.delivered_to >= 1, `at least one operator received it, got ${body.data.delivered_to}`);
});

await test('S2. The operator finds it in their ordinary inbox, not a separate queue', async () => {
    const { status, body } = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${op.token}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const msg = body.data.messages.find((m: any) => m.conversationId === supportConvId);
    assert(!!msg, 'the support message is in the operator inbox');
    assert(msg.senderGhii === alice.ghii, `the sender is visible, got ${msg.senderGhii}`);
    assert(msg.recipientGhii === 'support@operators', `the copy records what was addressed, got ${msg.recipientGhii}`);
});

await test('S3. A first-time sender is NOT held behind the first-contact gate', async () => {
    const { body } = await json('/v1/messages/requests', { headers: { Authorization: `Bearer ${op.token}` } });
    const held = (body.data.requests ?? []).find((r: any) => r.contactId === alice.ghii);
    assert(!held, 'someone asking for help must never land in a request queue');
});

await test('S4. The operator replies into the same thread and the sender sees it', async () => {
    const reply = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${op.token}` },
        body: JSON.stringify({ conversation_id: supportConvId, body: 'Your agent is in the wrong mode — set it to workstation.' }),
    });
    assert(reply.status === 201, `reply status ${reply.status}: ${JSON.stringify(reply.body)}`);

    const thread = await json(`/v1/messages/conversations/${supportConvId}`, { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(thread.status === 200, `thread status ${thread.status}`);
    const bodies = thread.body.data.messages.map((m: any) => m.body);
    assert(bodies.some((b: string) => b.includes('wrong mode')), `the reply is in the sender's thread, got ${JSON.stringify(bodies)}`);
    assert(bodies.some((b: string) => b.includes('configure_delivery')), 'the original question is in the same thread');
});

await test('S5. support@<node-id> is the same address in long form', async () => {
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
        body: JSON.stringify({ to: `support@${NODE_ID}`, body: 'Second question, different person.' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.conversation_id !== supportConvId, 'a new request opens its own thread rather than joining an unrelated one');
    assert(body.data.participants.includes(op.ghii), 'the long form resolves the same operators');
});

await test('S6. An outsider cannot post into a support thread they are not in (failure mode)', async () => {
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${mal.token}` },
        body: JSON.stringify({ conversation_id: supportConvId, body: 'Let me read your support tickets.' }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NOT_A_PARTICIPANT', `expected NOT_A_PARTICIPANT, got ${body.error?.code}`);
});

// A5 (E2E test-quality audit). S6 proves the outsider cannot POST into the thread, and its own
// wording is "let me read your support tickets" — but nothing ever tried the READ. The message rows
// are fenced by the reading identity, so Mallory's page is empty and the door looks shut; the
// `conversation` block beside them was attached unconditionally. Against the pre-fix source this
// test fails: 200 carrying the subject, the creator and every operator GHII in the thread.
await test('S7. An outsider reading a support thread learns nothing about it', async () => {
    const { status, body } = await json(`/v1/messages/conversations/${supportConvId}`, {
        headers: { Authorization: `Bearer ${mal.token}` },
    });
    // The read itself may answer 200 with an empty page — what must not happen is disclosure.
    assert((body.data?.messages ?? []).length === 0, `an outsider must see no messages, got ${(body.data?.messages ?? []).length}`);
    assert(!body.data?.conversation, `an outsider was served the thread's metadata: ${JSON.stringify(body.data?.conversation)}`);
    const serialized = JSON.stringify(body);
    assert(!serialized.includes(op.ghii), `the operator's identity leaked to an outsider: ${serialized.slice(0, 220)}`);
    assert(!serialized.includes(alice.ghii), `the reporter's identity leaked to an outsider: ${serialized.slice(0, 220)}`);
    assert(!serialized.includes('Cannot finish onboarding'), `the thread's subject leaked to an outsider: ${serialized.slice(0, 220)}`);
    assert(status === 200 || status === 403 || status === 404, `unexpected status ${status}`);

    // The participants still get theirs — the fix must not blind the people in the thread.
    const mine = await json(`/v1/messages/conversations/${supportConvId}`, { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(mine.status === 200, `the reporter's own read expected 200, got ${mine.status}`);
    assert(mine.body.data?.conversation?.participants?.includes(op.ghii),
        `the reporter must still see who they are talking to, got ${JSON.stringify(mine.body.data?.conversation)}`);
    const theirs = await json(`/v1/messages/conversations/${supportConvId}`, { headers: { Authorization: `Bearer ${op.token}` } });
    assert(theirs.body.data?.conversation?.participants?.includes(alice.ghii),
        `the operator must still see the reporter, got ${JSON.stringify(theirs.body.data?.conversation)}`);
});

await test('S8. A support thread names a person in the operator\'s list, not an address', async () => {
    // The stored recipient on a group message is the THREAD's address, because a group has no single
    // other party. The conversations list derives its peer from the last message, so an operator's row
    // came back naming `support@operators`: no display name resolves for it and no presence does
    // either, and the inbox rendered "support · Unknown" beside a real person's question.
    const { status, body } = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${op.token}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const row = (body.data.conversations ?? []).find((c: any) => c.conversationId === supportConvId);
    assert(!!row, 'the support thread is in the operator\'s conversations list');
    assert(row.peerGhii === alice.ghii,
        `the operator's peer must be the person who asked, got ${JSON.stringify(row.peerGhii)}`);
    assert(row.groupAlias === 'support@operators',
        `the row must still say which address it arrived through, got ${JSON.stringify(row.groupAlias)}`);
    assert((row.participants ?? []).includes(op.ghii), 'the row carries the membership');

    // The person who ASKED still sees "support", because that is genuinely who they wrote to — and the
    // alias tells the client to render a thread rather than ask whether an address is online.
    const theirs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } });
    const mine = (theirs.body.data.conversations ?? []).find((c: any) => c.conversationId === supportConvId);
    assert(!!mine, 'the reporter sees their own support thread');
    assert(mine.peerGhii === 'support@operators',
        `the reporter wrote to the address and should still see it, got ${JSON.stringify(mine.peerGhii)}`);
    assert(mine.groupAlias === 'support@operators', 'the reporter\'s row is tagged as a thread, not a principal');
});

// ─── The node with ONE operator, which is every managed instance sold to one person ───
// Both of these refused on a node where the only operator is the person asking. That node is not an
// edge case: it is what a customer gets when they buy a platform of their own, and it is the exact
// shape in which an agent is told to write to support@operators when something breaks.
await test('S9. An operator\'s OWN agent writing to support reaches the human, with a bell', async () => {
    const agent = await createAgent(opName, op.token, `sbot${stamp}`, ['messages:send', 'messages:read']);

    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${agent.token}` },
        body: JSON.stringify({ to: 'support@operators', subject: 'Storage will not mount', body: 'Every write returns EACCES.' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    // The agent and its owner share ONE mailbox, so the send used to be counted as "from the sender"
    // and skipped entirely: delivered_to 0, no row worth reading, and the human heard nothing.
    assert(body.data.delivered_to >= 1, `the human must be told their agent asked for help, got ${body.data.delivered_to}`);

    // Not /inbox: the copy is `outbound`, because the message genuinely left this account. What the
    // owner sees is the THREAD, and it must be there, unread, with the agent named as the author.
    const list = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${op.token}` } });
    const row = (list.body.data.conversations ?? []).find((c: any) => c.conversationId === body.data.conversation_id);
    assert(!!row, 'the operator sees the thread their own agent opened in their name');
    assert(row.unread >= 1, `a message you did not write is unread, got ${row.unread}`);

    const thread = await json(`/v1/messages/conversations/${body.data.conversation_id}`, { headers: { Authorization: `Bearer ${op.token}` } });
    const msg = (thread.body.data.messages ?? []).find((m: any) => m.id === body.data.message_id);
    assert(!!msg, 'the operator can read what their agent asked for');
    assert(msg.senderGhii === agent.gaii, `the agent is named as the author, got ${msg.senderGhii}`);

    const notifs = await json('/v1/notifications', { headers: { Authorization: `Bearer ${op.token}` } });
    const bell = (notifs.body.data.notifications ?? []).find((n: any) => (n.link ?? '').includes(body.data.conversation_id));
    assert(!!bell, 'a message written in your name rings your bell');
});

await test('S10. The ONLY operator of a node can write to their own support address', async () => {
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${op.token}` },
        body: JSON.stringify({ to: 'support@operators', subject: 'Note to self', body: 'Renew the certificate before October.' }),
    });
    // Membership collapsed to one person and the old floor of two refused it as NO_OPERATORS, so the
    // one person who runs the node was the one person who could not use its support address.
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.conversation_id === 'string' && body.data.conversation_id.length > 0, 'the thread exists and can be replied into');
    assert(body.data.delivered_to === 0, `nobody else was told, got ${body.data.delivered_to}`);
    assert(typeof body.data.note === 'string' && body.data.note.length > 0,
        'delivered_to 0 must say WHY, or an agent reads it as a failure');
});

// The other half of the floor change — an UNNAMED group of one is still refused — has no HTTP door
// to test through: the only caller of createGroupConversation is the support alias. It is asserted
// at the service level instead, in test/unit/conversation-group-floor.test.ts.

// ─── The node reports its OWN faults, without asking anyone to describe them ───
// 108 places raise INTERNAL_ERROR, and every one of them used to be a dead end: one person saw
// "An unexpected error occurred" and the operators heard nothing unless that person happened to
// write in. The machine knows what it was doing better than the user could describe it, and asking
// somebody to file a bug report at the moment we already failed them is asking them to do our work.
console.log('\nPhase 9 -- the node reports its own faults');

await test('F1. REFUSAL — a caller cannot mark their own message as a node fault', async () => {
    // The mark is what tells an operator "no human is waiting on this, and nobody needs an answer".
    // If a caller could set it, anyone could post a message that an operator is invited to ignore,
    // and the one channel built for hearing from people becomes a way to be unheard.
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: 'support@operators', subject: 'Forged', body: 'pretending to be the node', kind: 'system-fault' }),
    });
    assert(status === 201 || status === 400, `unexpected status ${status}: ${JSON.stringify(body)}`);
    if (status === 201) {
        const { body: inbox } = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${op.token}` } });
        const forged = (inbox.data?.messages ?? []).find((m: any) => m.subject === 'Forged' || /pretending/.test(m.preview ?? ''));
        assert(!forged?.kind, `a caller's message must never carry a kind, got "${forged?.kind}"`);
    }
});

await test('F2. A person asking for help carries no mark at all — that is what makes the mark mean something', async () => {
    const { body } = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${op.token}` } });
    const question = (body.data?.messages ?? []).find((m: any) => m.conversationId === supportConvId);
    assert(question, 'the support question from Phase 6 is still in the inbox');
    assert(!question.kind, `a person's question must carry no kind, got "${question.kind}"`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
