// E2E Tests for Broadcast / send-to-many (mass posting)
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=broadcast
//
// Verifies POST /v1/messages/broadcast fans out one message per recipient under a shared broadcastId
// (explicit list + Share Group audience), the announcement mode is non-respondable (replies rejected),
// and GET /v1/messages/broadcast/:id aggregates the results.

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        if (res.status === 429 && attempt < retries) { await sleep(Number(res.headers.get('Retry-After') || '5') * 1000 + 500); continue; }
        return { status: res.status, body };
    }
    throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(priv: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(priv, 'base64'))).toString('base64');
}
async function getToken(owner: string, priv: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(priv, owner + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}
async function registerOwner(name: string): Promise<{ token: string; ghii: string }> {
    const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(status === 201, `register ${name}: ${status} ${JSON.stringify(body)}`);
    return { token: await getToken(name, body.data.private_key), ghii: `${name}@${NODE_ID}` };
}

const stamp = Date.now();
let alice = { token: '', ghii: '' };
let bob = { token: '', ghii: '' };
let carol = { token: '', ghii: '' };
let bcId = '';

console.log('\n=== AIMEAT Broadcast / send-to-many E2E ===\n');

await test('Register Alice (sender) + Bob + Carol (recipients)', async () => {
    alice = await registerOwner(`bcalice${stamp}`);
    bob = await registerOwner(`bcbob${stamp}`);
    carol = await registerOwner(`bccarol${stamp}`);
});

await test('1. Broadcast a message to an explicit list of two → 201, sent=2', async () => {
    const { status, body } = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: [bob.ghii, carol.ghii], mode: 'broadcast', body: 'Hello everyone — broadcast test!' }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data.sent === 2, `expected sent=2, got ${body.data.sent}`);
    assert(typeof body.data.broadcast_id === 'string', 'broadcast_id returned');
    bcId = body.data.broadcast_id;
});

await test('2. Results endpoint lists both recipients under the broadcastId', async () => {
    const { status, body } = await json(`/v1/messages/broadcast/${bcId}`, { headers: { Authorization: `Bearer ${alice.token}` } });
    assert(status === 200, `results ${status}: ${JSON.stringify(body)}`);
    assert(body.data.total === 2, `expected total=2, got ${body.data.total}`);
    const ids = body.data.recipients.map((r: any) => r.recipient);
    assert(ids.includes(bob.ghii) && ids.includes(carol.ghii), `recipients should include both, got ${JSON.stringify(ids)}`);
});

await test('3. A recipient accepts + sees the broadcast copy (broadcastId set, respondable)', async () => {
    const acc = await json(`/v1/messages/requests/${encodeURIComponent(alice.ghii)}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
    });
    assert(acc.status === 200, `accept ${acc.status}`);
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
    const m = inbox.body.data.messages.find((x: any) => x.senderGhii === alice.ghii && /broadcast test/.test(x.body));
    assert(m !== undefined, 'Bob sees the broadcast message');
    assert(m.broadcastId === bcId, `broadcastId carried, got ${m.broadcastId}`);
    assert(m.respondable !== false, 'a normal broadcast is respondable');
});

await test('4. Announcement mode is non-respondable — a reply is rejected (403)', async () => {
    const send = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: [bob.ghii], mode: 'announcement', body: 'Node maintenance tonight at 22:00. (read-only)' }),
    });
    assert(send.status === 201, `announcement send ${send.status}: ${JSON.stringify(send.body)}`);
    // Bob finds the announcement in his inbox (Alice is an accepted contact now).
    let ann: any;
    for (let i = 0; i < 10; i++) {
        const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
        ann = inbox.body.data.messages.find((x: any) => x.respondable === false && /maintenance/.test(x.body));
        if (ann) break;
        await sleep(100);
    }
    assert(ann !== undefined, 'Bob sees the announcement (respondable=false)');
    // Replying to it is rejected.
    const reply = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
        body: JSON.stringify({ to: alice.ghii, body: 'can I reply?', reply_to: ann.id, conversation_id: ann.conversationId }),
    });
    assert(reply.status === 403, `expected 403 NOT_RESPONDABLE, got ${reply.status}: ${JSON.stringify(reply.body)}`);
    assert(reply.body.error?.code === 'NOT_RESPONDABLE', `code, got ${reply.body.error?.code}`);
});

await test('5. Broadcast to a Share Group audience reaches its members', async () => {
    // Alice makes a group with Carol as a member, then broadcasts to the group id.
    const grp = await json('/v1/groups', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ name: `team-${stamp}`, members: [{ identifier: carol.ghii, identifier_type: 'ghii', permissions: { read: true, write: false } }] }),
    });
    assert(grp.status === 201, `group create ${grp.status}: ${JSON.stringify(grp.body)}`);
    const groupId = grp.body.data.group?.id ?? grp.body.data.id;
    const send = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ group_id: groupId, mode: 'broadcast', body: 'Hello team (via Share Group)!' }),
    });
    assert(send.status === 201, `group broadcast ${send.status}: ${JSON.stringify(send.body)}`);
    assert(send.body.data.sent >= 1, `expected ≥1 sent to the group, got ${send.body.data.sent}`);
    // Carol sees it (as a request from Alice, first contact).
    let seen = false;
    for (let i = 0; i < 10; i++) {
        const reqs = await json('/v1/messages/requests', { headers: { Authorization: `Bearer ${carol.token}` } });
        const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${carol.token}` } });
        seen = (reqs.body?.data?.requests ?? []).some((r: any) => r.contactId === alice.ghii)
            || (inbox.body?.data?.messages ?? []).some((m: any) => /via Share Group/.test(m.body));
        if (seen) break;
        await sleep(100);
    }
    assert(seen, 'Carol (group member) received the group broadcast');
});

await test('6. A broadcast with no recipients is rejected (400)', async () => {
    const { status } = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: [], mode: 'broadcast', body: 'nobody' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

await test('7. Poll: broadcast an interactive question, a recipient answers, results aggregate it', async () => {
    // Bob is an accepted contact (test 3). Alice polls him.
    const poll = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({
            to: [bob.ghii], mode: 'broadcast', body: 'Quick poll:',
            interactive: { role: 'questions', v: 1, questions: [{
                id: 'q1', header: 'Color', prompt: 'Favorite color?', multiSelect: false, allowOther: false, required: true,
                options: [{ id: 'red', label: 'Red' }, { id: 'blue', label: 'Blue' }],
            }] },
        }),
    });
    assert(poll.status === 201, `poll broadcast ${poll.status}: ${JSON.stringify(poll.body)}`);
    const pollBcId = poll.body.data.broadcast_id;

    // Bob finds the poll question in his inbox.
    let q: any;
    for (let i = 0; i < 10; i++) {
        const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
        q = inbox.body.data.messages.find((m: any) => m.interactive?.role === 'questions' && /Favorite color/.test(m.interactive.questions[0]?.prompt || ''));
        if (q) break;
        await sleep(100);
    }
    assert(q !== undefined, 'Bob received the poll question');

    // Bob answers the poll (Blue).
    const ans = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
        body: JSON.stringify({
            to: alice.ghii, conversation_id: q.conversationId, reply_to: q.id, body: '- Color: Blue',
            interactive: { role: 'answers', v: 1, answersFor: q.id, answers: { q1: { selected: ['blue'], other: null } } },
        }),
    });
    assert(ans.status === 201, `poll answer ${ans.status}: ${JSON.stringify(ans.body)}`);

    // Alice's results aggregate Bob's answer.
    let res: any;
    for (let i = 0; i < 10; i++) {
        const r = await json(`/v1/messages/broadcast/${pollBcId}`, { headers: { Authorization: `Bearer ${alice.token}` } });
        res = r.body.data;
        if (res.answered >= 1) break;
        await sleep(150);
    }
    assert(res.interactive?.role === 'questions', 'results carry the poll question spec');
    assert(res.answered >= 1, `expected ≥1 answered, got ${res.answered}`);
    const bobRec = res.recipients.find((x: any) => x.recipient === bob.ghii);
    assert(bobRec?.answers?.q1?.selected?.[0] === 'blue', `Bob's answer aggregated, got ${JSON.stringify(bobRec?.answers)}`);
});

await test('8. The "all node users" audience is operator-only (a non-operator gets 403)', async () => {
    // Carol was registered third — not the node operator. node-users must be rejected for her.
    const { status, body } = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${carol.token}` },
        body: JSON.stringify({ audience: 'node-users', mode: 'announcement', body: 'node-wide notice' }),
    });
    assert(status === 403, `expected 403 for non-operator node-users, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'FORBIDDEN', `code, got ${body.error?.code}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
