/**
 * @file e2e-chat.ts
 * @description E2E tests for the chat surface: conversations, and the turn stream.
 *
 *   CI has no chat agent configured, and that is most of the point here. A node without one has to
 *   say so plainly on every door rather than offering a box that will never answer, and everything
 *   in front of the agent — who may read a conversation, who may write to one, what happens to a
 *   conversation nobody owns — has to be right whether or not an agent exists.
 *
 *   The turn itself, with a real agent answering and calling tools, is verified by hand against a
 *   running goose; that limitation is stated rather than papered over.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-chat
 * @version-history
 *   v1.4.0 — 2026-08-17 — The first-turn funnel marker: written once with `at`, the starter
 *     dimension lands when a starter button fired the turn, junk starters are dropped at the door,
 *     and a later starter-carrying turn can never rewrite the first record.
 *   v1.3.0 — 2026-08-16 — The status counts reachable devices (the phone nudge reads it).
 *   v1.2.0 — 2026-08-16 — A turn may carry attached pictures: the keys travel, a non-string is
 *     dropped at the door, and the record keeps what was attached.
 *   v1.1.0 — 2026-08-16 — The status names who pays, including for an owner who HAS stored a key.
 *     The page was deciding that for itself and telling the person their own key was being used
 *     while the node's key paid for every turn.
 *   v1.0.0 — 2026-08-16 — initial: status, thread lifecycle, cross-owner refusal, the disabled turn.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerAName = `chata${Date.now() % 100000}`;
const ownerBName = `chatb${Date.now() % 100000}`;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function signMsg(priv: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(priv, 'base64'));
    return Buffer.from(sig).toString('base64');
}

let aToken = ''; let bToken = '';
const aAuthed = (o: RequestInit = {}): RequestInit =>
    ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${aToken}` } });
const bAuthed = (o: RequestInit = {}): RequestInit =>
    ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${bToken}` } });

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name} status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data?.token as string;
}

console.log('\n=== Chat E2E Tests ===\n');

let threadId = '';

await test('Setup: two owners', async () => {
    aToken = await registerOwner(ownerAName);
    bToken = await registerOwner(ownerBName);
    assert(!!aToken && !!bToken, 'both tokens issued');
});

await test('Status says whether this node has an agent, and never pretends', async () => {
    const { status, body } = await json('/v1/chat/status', aAuthed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data?.enabled === 'boolean', 'enabled is a boolean, not a guess');
    assert(String(body.data?.agent_name).startsWith(`chat#${ownerAName}@`), `names the agent, got ${body.data?.agent_name}`);
    if (!body.data.enabled) assert(!!body.data.note, 'a disabled node explains itself');
    console.log(`     ↳ chat ${body.data.enabled ? 'enabled' : 'not configured'} on this node`);
});

await test('Status names WHO PAYS for a turn, and it is not derived from having a key', async () => {
    // The page used to work the payer out for itself: a stored OpenRouter key meant "running on
    // your own key" and no key meant an allowance counting down. Neither described a chat turn.
    // The agent is one shared process with one process-wide provider key, no owner key is ever
    // handed to it, and nothing on this road debits the allowance. So the server says who pays.
    const { body } = await json('/v1/chat/status', aAuthed());
    assert(['own', 'allowance', 'node'].includes(body.data?.pays),
        `pays must name a payer, got ${JSON.stringify(body.data?.pays)}`);
    assert(body.data.pays === 'node',
        `while the agent runs on the node's own provider key, the answer is "node", got ${body.data.pays}`);

    // …and it stays 'node' for an owner who HAS brought a key, which is the case that was wrong.
    const put = await json('/v1/openrouter/settings', aAuthed({
        method: 'PUT', body: JSON.stringify({ apiKey: 'sk-or-e2e-not-a-real-key', model: 'openrouter/free' }),
    }));
    assert(put.status === 200, `store a key: ${put.status} ${JSON.stringify(put.body?.error)}`);
    const after = await json('/v1/chat/status', aAuthed());
    assert(after.body.data.has_own_key === true, 'the key is stored');
    assert(after.body.data.pays === 'node',
        `an owner key that the chat never receives must not be reported as paying, got ${after.body.data.pays}`);
    await json('/v1/openrouter/settings', aAuthed({ method: 'DELETE' }));
});

await test('A turn carries attached files as KEYS, and drops what is not one', async () => {
    // The bytes take the presigned road into the person's own storage; what travels with the turn is
    // a key — for a picture and for a file alike. What is asserted here is the DOOR: the request is accepted, the stream opens, and a
    // non-string in the list never reaches the service.
    //
    // The record half is asserted only on a node that HAS an agent. Without one, runChatTurn refuses
    // before it writes anything — deliberately, so a node with no agent does not accumulate
    // conversations nobody can answer — and asserting a record here would be asserting the absence
    // of the feature this suite runs without.
    const created = await json('/v1/chat/threads', aAuthed({ method: 'POST', body: JSON.stringify({ title: 'pictures' }) }));
    const id = created.body.data.thread.id;

    const res = await fetch(`${BASE}/v1/chat/threads/${id}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(aAuthed().headers as Record<string, string>) },
        body: JSON.stringify({ text: 'what is this?', attachments: ['chat-files/nope.csv', 42, ''] }),
    });
    assert(res.status === 200, `the stream opens with 200, got ${res.status}`);
    await res.body?.cancel();

    const status = await json('/v1/chat/status', aAuthed());
    if (!status.body.data.enabled) {
        console.log('     ↳ no agent on this node: the door was asserted, the record was not');
        return;
    }

    const read = await json(`/v1/chat/threads/${id}`, aAuthed());
    const mine = (read.body.data.thread.turns as any[]).find(t => t.role === 'user');
    assert(!!mine, 'the message is in the conversation');
    assert(Array.isArray(mine.attachments) && mine.attachments.length === 1,
        `only the string key survives the filter, got ${JSON.stringify(mine.attachments)}`);
    assert(mine.attachments[0] === 'chat-files/nope.csv', `the key is kept as given, got ${mine.attachments[0]}`);
});

await test('Status counts the DEVICES that can be reached, which is what the phone nudge reads', async () => {
    // Zero is what makes the page suggest setting a phone up. It has to come from the node — this
    // browser knows nothing about a phone in somebody's pocket — and it must never read zero because
    // a query failed, which is why the route answers 1 on an error rather than 0.
    const { body } = await json('/v1/chat/status', aAuthed());
    assert(typeof body.data?.push_devices === 'number', `push_devices is a number, got ${JSON.stringify(body.data?.push_devices)}`);
    assert(body.data.push_devices === 0, `a fresh owner has no subscribed device, got ${body.data.push_devices}`);
});

await test('An unauthenticated caller sees nothing', async () => {
    const { status } = await json('/v1/chat/threads');
    assert(status === 401, `unauthenticated is 401, got ${status}`);
});

await test('A conversation can be started, read and listed', async () => {
    const created = await json('/v1/chat/threads', aAuthed({ method: 'POST', body: JSON.stringify({}) }));
    assert(created.status === 201, `create status ${created.status}: ${JSON.stringify(created.body)}`);
    threadId = created.body.data.thread.id;
    assert(!!threadId, 'got an id');
    assert(created.body.data.thread.title === 'New chat', 'starts with a placeholder title');

    const read = await json(`/v1/chat/threads/${threadId}`, aAuthed());
    assert(read.status === 200, `read status ${read.status}`);
    assert(read.body.data.thread.turns.length === 0, 'a new conversation is empty');

    const list = await json('/v1/chat/threads', aAuthed());
    assert(list.body.data.threads.some((t: any) => t.id === threadId), 'it is in the list');
});

await test('Starting a conversation provisions the chat agent as a real agent', async () => {
    // It has to be visible where every other agent is, because that is where its scopes are edited.
    const agents = await json('/v1/agents', aAuthed());
    const names = JSON.stringify(agents.body?.data ?? {});
    assert(names.includes(`chat#${ownerAName}@`), 'the chat agent is listed with the others');
});

await test('A second owner cannot read the first owner\'s conversation', async () => {
    const { status } = await json(`/v1/chat/threads/${threadId}`, bAuthed());
    assert(status === 404, `another owner gets 404, got ${status}`);
});

await test('A second owner\'s list does not contain it', async () => {
    const { body } = await json('/v1/chat/threads', bAuthed());
    assert(!(body.data?.threads ?? []).some((t: any) => t.id === threadId), 'not in their list');
});

await test('A turn needs something to say', async () => {
    const { status, body } = await json(`/v1/chat/threads/${threadId}/turn`,
        aAuthed({ method: 'POST', body: JSON.stringify({ text: '   ' }) }));
    assert(status === 400, `empty text is 400, got ${status}`);
    assert(body.error?.code === 'INVALID_BODY', `code INVALID_BODY, got ${body.error?.code}`);
});

await test('A turn on a conversation that does not exist is a 404, not a stream', async () => {
    const { status } = await json('/v1/chat/threads/nope/turn',
        aAuthed({ method: 'POST', body: JSON.stringify({ text: 'hello' }) }));
    assert(status === 404, `unknown conversation is 404, got ${status}`);
});

await test('A turn streams, and says what went wrong when there is no agent', async () => {
    // On a node with no agent the stream opens and carries one error event rather than a 500 or a
    // silent hang: the person asked a question and is owed an answer either way.
    const res = await fetch(`${BASE}/v1/chat/threads/${threadId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aToken}` },
        body: JSON.stringify({ text: 'hello' }),
    });
    assert(res.status === 200, `the stream opens with 200, got ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('text/event-stream'), 'it is an event stream');

    const text = await res.text();
    const events = text.split('\n\n').filter((f) => f.startsWith('data:'))
        .map((f) => JSON.parse(f.slice(5).trim()));
    assert(events.length > 0, `at least one event arrived, got ${JSON.stringify(text).slice(0, 200)}`);
    const last = events.at(-1);
    assert(last.kind === 'error' || last.kind === 'done', `the turn ends with a verdict, got ${last?.kind}`);
    console.log(`     ↳ turn ended as ${last.kind}${last.kind === 'error' ? `: ${String(last.message).slice(0, 60)}` : ''}`);
});

await test('The first turn writes the funnel marker once, and only once', async () => {
    // Owner A has sent turns above with no starter button. The write-once marker must exist,
    // record when, and carry no starter — the absence is itself the datum ("typed their own words").
    // Written fire-and-forget off the turn path, so poll briefly like the other funnel suites do.
    const read = async (auth: (o?: RequestInit) => RequestInit) => {
        const { body } = await json('/v1/memory/onboarding.first_chat_turn?soft=1', auth());
        return body.data?.exists === false ? null : body.data?.value ?? null;
    };
    let mark: any = null;
    for (let i = 0; i < 16 && !mark; i++) { mark = await read(aAuthed); if (!mark) await new Promise(r => setTimeout(r, 250)); }
    assert(!!mark, 'the first turn left a marker');
    assert(typeof mark.at === 'string', `the marker records when, got ${JSON.stringify(mark)}`);
    assert(mark.starter === undefined, `no starter button fired it, got ${JSON.stringify(mark.starter)}`);

    // A later turn CARRYING a starter must not rewrite it: write-once is the whole point.
    const res = await fetch(`${BASE}/v1/chat/threads/${threadId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aToken}` },
        body: JSON.stringify({ text: 'once more', starter: 'page' }),
    });
    await res.text();
    const after = await read(aAuthed);
    assert(after.at === mark.at && after.starter === undefined,
        `the marker never changes after the first write, got ${JSON.stringify(after)}`);
});

await test('A starter button names itself in the marker, and junk is dropped at the door', async () => {
    // Owner B's FIRST turn arrives from a starter button — the dimension that answers "do the
    // starters carry their weight" is recorded with it. An invalid starter string never lands.
    const created = await json('/v1/chat/threads', bAuthed({ method: 'POST', body: JSON.stringify({}) }));
    assert(created.status === 201, `B's conversation: ${created.status}`);
    const bThread = created.body.data.thread.id;
    const res = await fetch(`${BASE}/v1/chat/threads/${bThread}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bToken}` },
        body: JSON.stringify({ text: 'put up my page', starter: 'page' }),
    });
    await res.text();
    let mark: any = null;
    for (let i = 0; i < 16 && !mark; i++) {
        const { body } = await json('/v1/memory/onboarding.first_chat_turn?soft=1', bAuthed());
        mark = body.data?.exists === false ? null : body.data?.value ?? null;
        if (!mark) await new Promise(r => setTimeout(r, 250));
    }
    assert(!!mark && mark.starter === 'page', `B's marker carries the starter, got ${JSON.stringify(mark)}`);
    await json(`/v1/chat/threads/${bThread}`, bAuthed({ method: 'DELETE' }));
});

await test('A node that can never answer leaves the conversation clean', async () => {
    // The refusal comes before anything is written. A half-turn recorded against an agent that does
    // not exist would read, later, as a conversation the person had; they did not have it.
    const read = await json(`/v1/chat/threads/${threadId}`, aAuthed());
    assert(read.body.data.thread.turns.length === 0, `no phantom turns, got ${read.body.data.thread.turns.length}`);
    assert(read.body.data.thread.title === 'New chat', 'and nothing renamed it');
});

await test('The agent session can be reset, and the conversation is untouched', async () => {
    const { status } = await json(`/v1/chat/threads/${threadId}/reset`, aAuthed({ method: 'POST' }));
    assert(status === 200, `reset status ${status}`);
    const read = await json(`/v1/chat/threads/${threadId}`, aAuthed());
    assert(read.status === 200, 'the conversation is still there');
});

await test('A second owner cannot reset it', async () => {
    const { status } = await json(`/v1/chat/threads/${threadId}/reset`, bAuthed({ method: 'POST' }));
    assert(status === 404, `another owner gets 404, got ${status}`);
});

await test('A second owner cannot delete it', async () => {
    await json(`/v1/chat/threads/${threadId}`, bAuthed({ method: 'DELETE' }));
    const read = await json(`/v1/chat/threads/${threadId}`, aAuthed());
    assert(read.status === 200, 'it is still there');
});

await test('The owner can delete it', async () => {
    const del = await json(`/v1/chat/threads/${threadId}`, aAuthed({ method: 'DELETE' }));
    assert(del.status === 200, `delete status ${del.status}`);
    const read = await json(`/v1/chat/threads/${threadId}`, aAuthed());
    assert(read.status === 404, 'and it is gone');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
