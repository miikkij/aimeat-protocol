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

// A29 (E2E test-quality audit). Test 5 broadcasts to a group Alice owns, so the audience gate was
// never asked a question it could answer no to. Holding the id was the whole check: a group id is a
// v4 UUID and therefore not guessable, but every REMOVED member still knows it, and resolving the
// audience both delivered into the group and returned every current member's identity in the
// broadcast's own receipt — on a group whose GET answers that same person 403. Bob is the outsider
// here; against the pre-fix source this test fails with 201 and Carol's identity in the response.
await test('7. A non-member cannot broadcast to a group (and cannot read its members)', async () => {
    const grp = await json('/v1/groups', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ name: `private-team-${stamp}`, members: [{ identifier: carol.ghii, identifier_type: 'ghii', permissions: { read: true, write: false } }] }),
    });
    assert(grp.status === 201, `group create ${grp.status}: ${JSON.stringify(grp.body)}`);
    const groupId = grp.body.data.group?.id ?? grp.body.data.id;

    // Pin the door that is known to be closed, so the broadcast assertion is measured against it
    // rather than against an assumption about what Bob may see.
    const read = await json(`/v1/groups/${groupId}`, { headers: { Authorization: `Bearer ${bob.token}` } });
    assert(read.status === 403, `Bob reading Alice's group expected 403, got ${read.status}`);

    const send = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
        body: JSON.stringify({ group_id: groupId, mode: 'broadcast', body: 'I am not in this group' }),
    });
    assert(send.status === 400, `Bob broadcasting to Alice's group expected 400 (audience resolves to nobody), got ${send.status}: ${JSON.stringify(send.body).slice(0, 200)}`);
    const serialized = JSON.stringify(send.body);
    assert(!serialized.includes(carol.ghii), `the refusal leaked a member identity: ${serialized.slice(0, 200)}`);

    // Nothing reached Carol.
    await sleep(200);
    const reqs = await json('/v1/messages/requests', { headers: { Authorization: `Bearer ${carol.token}` } });
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${carol.token}` } });
    const gotIt = (reqs.body?.data?.requests ?? []).some((r: any) => r.contactId === bob.ghii)
        || (inbox.body?.data?.messages ?? []).some((m: any) => /not in this group/.test(m.body));
    assert(!gotIt, 'a non-member\'s broadcast reached a member of the group');

    // Alice, the owner, still reaches her own group — the gate must cost the legitimate path nothing.
    const ok = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ group_id: groupId, mode: 'broadcast', body: 'owner still reaches the group' }),
    });
    assert(ok.status === 201, `the owner's own group broadcast expected 201, got ${ok.status}: ${JSON.stringify(ok.body).slice(0, 200)}`);
});

console.log('\nPhase 8 — a titled broadcast, and one row instead of twenty');
// Jouni, 2026-09-06, from a screenshot of his own Messages list: one announcement to twenty agents
// filled it with twenty identical rows in the same minute, and the three unread ones were buried.
// Two things were missing and the first alone fixes nothing: a broadcast could not carry a TITLE (so
// a sender who wanted one looped the 1:1 send, producing threads with no shared id at all), and the
// conversations list could not see the shared id it already had.
await test('8. A broadcast carries a subject, and every copy still shares one broadcast id', async () => {
    const dave = await registerOwner(`bcdave${stamp}`);
    const erin = await registerOwner(`bcerin${stamp}`);
    const send = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({
            to: [dave.ghii, erin.ghii], mode: 'broadcast',
            subject: `Titled announcement ${stamp}`, body: 'Sama asia kaikille, yhdellä kutsulla.',
        }),
    });
    assert(send.status === 201, `titled broadcast ${send.status}: ${JSON.stringify(send.body)}`);
    assert(send.body.data.sent === 2, `expected 2 sent, got ${send.body.data.sent}`);
    const broadcastId = send.body.data.broadcast_id;

    // The recipients each see the title on their own thread.
    for (const who of [dave, erin]) {
        const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${who.token}` } });
        const m = (inbox.body.data.messages ?? []).find((x: any) => x.subject === `Titled announcement ${stamp}`);
        assert(m !== undefined, `recipient must see the subject, got ${JSON.stringify((inbox.body.data.messages ?? []).map((x: any) => x.subject))}`);
        assert(m.broadcastId === broadcastId, `every copy carries the shared id, got ${m.broadcastId}`);
    }
});

await test('9. The sender\'s list folds the copies into ONE row that nests the rest', async () => {
    const f1 = await registerOwner(`bcfold1${stamp}`);
    const f2 = await registerOwner(`bcfold2${stamp}`);
    const f3 = await registerOwner(`bcfold3${stamp}`);
    const send = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: [f1.ghii, f2.ghii, f3.ghii], mode: 'broadcast', subject: `Fold me ${stamp}`, body: 'Kolme kopiota, yksi rivi.' }),
    });
    assert(send.status === 201, `fold broadcast ${send.status}: ${JSON.stringify(send.body)}`);
    const broadcastId = send.body.data.broadcast_id;

    const convs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } });
    const rows = (convs.body.data.conversations ?? []).filter((c: any) => c.broadcastId === broadcastId);
    assert(rows.length === 1, `three copies must be ONE row, got ${rows.length}`);
    assert(rows[0].broadcastCount === 3, `the row says how many it stands for, got ${rows[0].broadcastCount}`);
    assert((rows[0].folded ?? []).length === 2, `the other two ride with it, got ${(rows[0].folded ?? []).length}`);
    // Nothing was thrown away: the three conversation ids are all still reachable from the one row.
    const ids = new Set([rows[0].conversationId, ...rows[0].folded.map((f: any) => f.conversationId)]);
    assert(ids.size === 3, `all three threads must still be addressable, got ${ids.size}`);
});

await test('10. A recipient who REPLIES lifts their thread back out of the fold', async () => {
    // The rule is the LAST message's broadcastId, so this needs no reply detection of its own. It is
    // the assertion that matters most: an answer that folded away would be the same silence again.
    const r1 = await registerOwner(`bcreply1${stamp}`);
    const r2 = await registerOwner(`bcreply2${stamp}`);
    const send = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: [r1.ghii, r2.ghii], mode: 'broadcast', subject: `Answer me ${stamp}`, body: 'Vastatkaa jos ehditte.' }),
    });
    assert(send.status === 201, `reply broadcast ${send.status}`);
    const broadcastId = send.body.data.broadcast_id;

    const before = (await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } }))
        .body.data.conversations.filter((c: any) => c.broadcastId === broadcastId);
    assert(before.length === 1 && before[0].broadcastCount === 2, `two copies fold first, got ${JSON.stringify(before.map((c: any) => c.broadcastCount))}`);

    // r1 answers in their own thread.
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${r1.token}` } });
    const mine = inbox.body.data.messages.find((m: any) => m.broadcastId === broadcastId);
    assert(mine !== undefined, 'the recipient has the announcement');
    const reply = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${r1.token}` },
        body: JSON.stringify({ to: alice.ghii, conversation_id: mine.conversationId, body: 'Selvä, hoidan.' }),
    });
    assert(reply.status === 201, `reply ${reply.status}: ${JSON.stringify(reply.body)}`);

    const after = (await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } }))
        .body.data.conversations;
    const answered = after.find((c: any) => c.conversationId === mine.conversationId);
    assert(answered !== undefined, 'the answered thread is a row of its own');
    assert(!answered.broadcastId, `an answered thread carries no broadcast id any more, got ${answered.broadcastId}`);
    assert(!answered.broadcastCount, 'an answered thread is not a folded row');
    assert(/hoidan/.test(answered.lastMessage), `and it previews the answer, got ${answered.lastMessage}`);
    // The one nobody answered is left, and a group of ONE is never folded.
    const still = after.filter((c: any) => c.broadcastId === broadcastId);
    assert(still.length === 1 && !still[0].broadcastCount, `the remaining copy renders as a plain thread, got ${JSON.stringify(still.map((c: any) => c.broadcastCount))}`);
});

await test('11. Two different broadcasts never fold into each other', async () => {
    const g1 = await registerOwner(`bctwo1${stamp}`);
    const g2 = await registerOwner(`bctwo2${stamp}`);
    const a = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: [g1.ghii, g2.ghii], mode: 'broadcast', subject: `First ${stamp}`, body: 'Ensimmäinen.' }),
    });
    const b = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: [g1.ghii, g2.ghii], mode: 'broadcast', subject: `Second ${stamp}`, body: 'Toinen.' }),
    });
    assert(a.status === 201 && b.status === 201, `two broadcasts ${a.status}/${b.status}`);
    const convs = (await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } })).body.data.conversations;
    // A TITLED broadcast opens a thread of its own per recipient, so two announcements to the same two
    // people are four threads and fold into TWO rows — one each. They must not merge: the id is the
    // key, and two announcements are two different things to read.
    const first = convs.filter((c: any) => c.broadcastId === a.body.data.broadcast_id);
    const second = convs.filter((c: any) => c.broadcastId === b.body.data.broadcast_id);
    assert(first.length === 1 && first[0].broadcastCount === 2, `the first folds its own two, got ${JSON.stringify(first.map((c: any) => c.broadcastCount))}`);
    assert(second.length === 1 && second[0].broadcastCount === 2, `the second folds its own two, got ${JSON.stringify(second.map((c: any) => c.broadcastCount))}`);
    assert(first[0].conversationId !== second[0].conversationId, 'two announcements are two rows, not one');
    // And an UNTITLED broadcast reuses the per-pair thread, so a later one supersedes the earlier as
    // that thread's last word — the same rule, read the other way round.
    const c1 = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: [g1.ghii, g2.ghii], mode: 'broadcast', body: 'Nimetön, ensimmäinen.' }),
    });
    const c2 = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: [g1.ghii, g2.ghii], mode: 'broadcast', body: 'Nimetön, toinen.' }),
    });
    assert(c1.status === 201 && c2.status === 201, `untitled broadcasts ${c1.status}/${c2.status}`);
    const later = (await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } })).body.data.conversations;
    const newest = later.filter((c: any) => c.broadcastId === c2.body.data.broadcast_id);
    assert(newest.length === 1 && newest[0].broadcastCount === 2, `the newer untitled one folds, got ${JSON.stringify(newest.map((c: any) => c.broadcastCount))}`);
    assert(later.every((c: any) => c.broadcastId !== c1.body.data.broadcast_id), 'the superseded untitled broadcast is no longer any thread\'s last word');
});

await test('12. A broadcast with no recipients, and one with nothing in it, are both refused', async () => {
    const empty = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: [], mode: 'broadcast', subject: 'nobody', body: 'x' }),
    });
    assert(empty.status === 400, `no recipients expected 400, got ${empty.status}`);
    const blank = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: [bob.ghii], mode: 'broadcast', subject: 'empty' }),
    });
    assert(blank.status === 400, `no body/attachment/questions expected 400, got ${blank.status}`);
});

await test('13. The reported case: one person owning every recipient sees ONE row, and the badge sums', async () => {
    // This is what Jouni was looking at. An announcement went to twenty AGENTS, all of them his, and
    // an agent's mail is delivered to its OWNER's inbox — so twenty inbound copies landed in one
    // mailbox and made twenty rows. The broadcast RESULTS view does not serve this at all: it reads
    // the SENDER's outbound copies, and here the recipient is the one drowning.
    const fleet = await registerOwner(`bcfleet${stamp}`);
    const gaiis: string[] = [];
    for (const name of ['alpha', 'beta', 'gamma']) {
        const made = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${fleet.token}` },
            body: JSON.stringify({ name, owner: `bcfleet${stamp}`, capabilities: ['memory'] }),
        });
        assert(made.status === 201, `create agent ${name}: ${made.status} ${JSON.stringify(made.body)}`);
        gaiis.push(made.body.data.agent.gaii);
    }
    const send = await json('/v1/messages/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ to: gaiis, mode: 'broadcast', subject: `Fleet notice ${stamp}`, body: 'Kaikille agenteille kerralla.' }),
    });
    assert(send.status === 201 && send.body.data.sent === 3, `fleet broadcast ${send.status}: ${JSON.stringify(send.body.data)}`);
    const broadcastId = send.body.data.broadcast_id;

    // The owner accepts the sender once, so all three copies are in the inbox rather than requests.
    await json(`/v1/messages/requests/${encodeURIComponent(alice.ghii)}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${fleet.token}` },
    });

    const convs = (await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${fleet.token}` } })).body.data.conversations;
    const rows = convs.filter((c: any) => c.broadcastId === broadcastId);
    assert(rows.length === 1, `three agents' copies must be ONE row in their owner's list, got ${rows.length}`);
    assert(rows[0].broadcastCount === 3, `the row stands for three, got ${rows[0].broadcastCount}`);
    // The badge is the whole point of summing: opening the newest copy must not clear a count that
    // belongs to the other two.
    assert(rows[0].unread === 3, `unread must count every copy under the row, got ${rows[0].unread}`);
    const nestedUnread = (rows[0].folded ?? []).reduce((n: number, f: any) => n + f.unread, 0);
    assert(nestedUnread === 2, `and the nested rows keep their own counts, got ${nestedUnread}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
