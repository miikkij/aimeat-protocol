// E2E Tests for Tracked Responses (Memory Contract): inbox message → watched record → federated/local reply.
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=tracked-response
// v1.0.0 -- 2026-06-21 -- Auto + approve reply paths, idempotency, condition-not-met + cancel (failure modes).

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
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        if (res.status === 429 && attempt < retries) { await sleep(Number(res.headers.get('Retry-After') || '5') * 1000 + 500); continue; }
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

const stamp = Date.now();
const aliceName = `tralice${stamp}`;   // owes the reply
const bobName = `trbob${stamp}`;       // the reporter who gets the reply
let alice = { token: '', ghii: '' };
let bob = { token: '', ghii: '' };

const authA = () => ({ Authorization: `Bearer ${alice.token}` });
const authB = () => ({ Authorization: `Bearer ${bob.token}` });

async function writeMemory(token: string, key: string, value: unknown) {
    return json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ key, value, visibility: 'private' }) });
}
async function getContract(id: string) {
    const r = await json(`/v1/tracked-responses/${encodeURIComponent(id)}`, { headers: authA() });
    return r.body?.data?.trackedResponse;
}
// Evaluation can be driven by the reactive write-hook (async) AND an explicit evaluate; the in-flight
// lock lets one win while the other no-ops, so the settled state may lag a beat (esp. on Mongo). Poll,
// nudging with an explicit evaluate each round, until the contract reaches the expected state.
async function waitForState(id: string, state: string, rounds = 8): Promise<any> {
    let c = await getContract(id);
    for (let i = 0; i < rounds && c?.state !== state; i++) {
        await json(`/v1/tracked-responses/${id}/evaluate`, { method: 'POST', headers: authA() });
        await sleep(150);
        c = await getContract(id);
    }
    return c;
}

let reporterMsgId = '';
let convId = '';

console.log('\n=== AIMEAT Tracked Responses (Memory Contract) E2E ===\n');

console.log('Setup -- two owners; Bob reports a bug to Alice');
await test('Register Alice + Bob, Bob sends Alice a report', async () => {
    alice = await registerOwner(aliceName);
    bob = await registerOwner(bobName);
    const send = await json('/v1/messages', { method: 'POST', headers: authB(), body: JSON.stringify({ to: alice.ghii, body: 'Self-host crash: no such column googleSub' }) });
    assert(send.status === 201, `bob send: ${send.status} ${JSON.stringify(send.body)}`);
    reporterMsgId = send.body.data.message.id;
    convId = send.body.data.message.conversationId;
    assert(!!reporterMsgId && !!convId, 'have message id + conversation id');
});

console.log('\nPhase 1 -- Auto reply when the watched record is marked done');
let autoBugKey = '';
let autoTrId = '';
await test('1. Alice creates the bug record (status open)', async () => {
    autoBugKey = `tr-bug-auto.${stamp}.latest`;
    const r = await writeMemory(alice.token, autoBugKey, { id: 'auto', title: 'googleSub bug', status: 'open' });
    assert(r.status === 201 || r.status === 200, `write bug: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('2. Alice creates an AUTO Tracked Response bound to the message', async () => {
    const r = await json('/v1/tracked-responses', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({
            message_id: reporterMsgId,
            title: 'googleSub self-host bug',
            watch: { key: autoBugKey, condition: { field: 'status', equals: 'done' } },
            response: { mode: 'auto', inject: { from: 'watch.value', field: 'resolution' } },
        }),
    });
    assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body)}`);
    const c = r.body.data.trackedResponse;
    autoTrId = c.id;
    assert(c.state === 'watching', `state should be watching, got ${c.state}`);
    assert(c.source.peerGhii === bob.ghii, `peer should be bob, got ${c.source.peerGhii}`);
    assert(c.source.messageId === reporterMsgId, 'source bound to the message');
});

// A tracked response makes the node send a threaded reply under the owner's identity, so the whole
// surface is requireRole('owner'). Nothing in this suite had ever presented anything else.
await test('2b. An agent of the owner, and an anonymous caller, cannot create one → 403 / 401', async () => {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ name: 'trbot', owner: aliceName, capabilities: ['memory'] }),
    });
    assert(reg.status === 201, `create agent: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, gaii + ts);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);

    const body = JSON.stringify({
        message_id: reporterMsgId, title: 'agent-made',
        watch: { key: autoBugKey, condition: { field: 'status', equals: 'done' } },
        response: { mode: 'auto' },
    });
    const asAgent = await json('/v1/tracked-responses', {
        method: 'POST', headers: { Authorization: `Bearer ${tok.body.data.token}` }, body,
    });
    assert(asAgent.status === 403, `an agent must be refused, got ${asAgent.status}: ${JSON.stringify(asAgent.body?.error)}`);

    const anon = await json('/v1/tracked-responses', { method: 'POST', body });
    assert(anon.status === 401, `an anonymous caller must be refused, got ${anon.status}`);
});

await test('3. Binding a message id that exists for NOBODY is rejected', async () => {
    const r = await json('/v1/tracked-responses', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ message_id: `nope-${stamp}`, watch: { key: autoBugKey, condition: { field: 'status', equals: 'done' } }, response: { mode: 'auto' } }),
    });
    assert(r.status === 404, `should 404, got ${r.status}`);
});

// Test 3 proves the EXISTENCE check. The route's real guard is the second argument to
// storage.getDirectMessage(message_id, ownerGhii), and until now no test ever presented an id that
// exists under a DIFFERENT owner. Drop that argument and any owner who learns a message id binds a
// contract to someone else's conversation, reads the peer's GHII back off the create response, and
// has the node auto-send threaded replies to that peer under their own identity.
await test('3b. Binding a message that exists under ANOTHER owner is rejected → 404', async () => {
    const carolName = `trcarol${stamp}`;
    const carol = await registerOwner(carolName);

    const r = await json('/v1/tracked-responses', {
        method: 'POST', headers: { Authorization: `Bearer ${carol.token}` },
        body: JSON.stringify({
            message_id: reporterMsgId,
            title: 'not my conversation',
            watch: { key: 'carol.bug', condition: { field: 'status', equals: 'done' } },
            response: { mode: 'auto' },
        }),
    });
    assert(r.status === 404, `a stranger binding Bob→Alice must 404, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    // Nothing was created, and no peer identity leaked back.
    assert(!r.body?.data?.trackedResponse, `no contract may be returned: ${JSON.stringify(r.body?.data)}`);
    const list = await json('/v1/tracked-responses', { headers: { Authorization: `Bearer ${carol.token}` } });
    const mine = (list.body?.data?.trackedResponses ?? list.body?.data?.items ?? []) as any[];
    assert(!mine.some(c => c.source?.messageId === reporterMsgId), `the stranger holds no contract on that message: ${JSON.stringify(mine)}`);
});

await test('4. Marking the bug done fires the reply (reactive; evaluate as fallback)', async () => {
    const w = await writeMemory(alice.token, autoBugKey, { id: 'auto', title: 'googleSub bug', status: 'done', resolution: 'fixed in 1.2.4' });
    assert(w.status === 200 || w.status === 201, `mark done: ${w.status}`);
    const c = await waitForState(autoTrId, 'replied');
    assert(c.state === 'replied', `state should be replied, got ${c.state}`);
    assert(!!c.delivery.sentMessageId, 'sentMessageId is set');
});

await test('5. The reply reached Bob: reply_to + injected result', async () => {
    const conv = await json(`/v1/messages/conversations/${convId}`, { headers: authA() });
    const reply = conv.body.data.messages.find((m: any) => m.direction === 'outbound' && m.replyToId === reporterMsgId);
    assert(reply !== undefined, 'Alice has an outbound reply threaded to the report');
    assert(reply.recipientGhii === bob.ghii, `reply goes to bob, got ${reply.recipientGhii}`);
    assert(/fixed in 1\.2\.4/.test(reply.body), `reply carries the injected result, got: ${reply.body}`);
});

await test('6. Idempotent: re-evaluating does NOT send a second reply', async () => {
    const before = await getContract(autoTrId);
    await json(`/v1/tracked-responses/${autoTrId}/evaluate`, { method: 'POST', headers: authA() });
    const after = await getContract(autoTrId);
    assert(after.delivery.sentMessageId === before.delivery.sentMessageId, 'sentMessageId unchanged');
    const conv = await json(`/v1/messages/conversations/${convId}`, { headers: authA() });
    const replies = conv.body.data.messages.filter((m: any) => m.direction === 'outbound' && m.replyToId === reporterMsgId);
    assert(replies.length === 1, `exactly one reply, got ${replies.length}`);
});

console.log('\nPhase 2 -- Approve mode drafts a reply, does not auto-send');
let apprBugKey = '';
let apprTrId = '';
await test('7. Create an APPROVE Tracked Response + mark the work done', async () => {
    apprBugKey = `tr-bug-appr.${stamp}.latest`;
    await writeMemory(alice.token, apprBugKey, { id: 'appr', status: 'open' });
    const r = await json('/v1/tracked-responses', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({
            message_id: reporterMsgId, title: 'second bug',
            watch: { key: apprBugKey, condition: { field: 'status', equals: 'done' } },
            response: { mode: 'approve', template: 'Done — {{title}}. {{result}}', inject: { field: 'resolution' } },
        }),
    });
    assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body)}`);
    apprTrId = r.body.data.trackedResponse.id;
    await writeMemory(alice.token, apprBugKey, { id: 'appr', status: 'done', resolution: 'patched' });
});

await test('8. Approve contract is awaiting-approval with a draft, NO reply sent', async () => {
    const c = await waitForState(apprTrId, 'awaiting-approval');
    assert(c.state === 'awaiting-approval', `state should be awaiting-approval, got ${c.state}`);
    assert(!c.delivery.sentMessageId, 'no reply sent yet');
    const d = await json(`/v1/tracked-responses/${apprTrId}/draft`, { headers: authA() });
    assert(/patched/.test(d.body?.data?.draft?.body || ''), `draft carries the result, got ${JSON.stringify(d.body?.data?.draft)}`);
});

await test('9. After the owner sends, marking replied transitions to replied', async () => {
    const send = await json('/v1/messages', { method: 'POST', headers: authA(), body: JSON.stringify({ to: bob.ghii, body: 'Done — second bug. patched', reply_to: reporterMsgId }) });
    assert(send.status === 201, `send: ${send.status}`);
    const mark = await json(`/v1/tracked-responses/${apprTrId}/replied`, { method: 'POST', headers: authA(), body: JSON.stringify({ sent_message_id: send.body.data.message.id }) });
    assert(mark.status === 200, `mark replied: ${mark.status}`);
    const c = await getContract(apprTrId);
    assert(c.state === 'replied', `state should be replied, got ${c.state}`);
});

console.log('\nPhase 3 -- Failure modes: condition never met, and cancel');
await test('10. A contract whose condition is not met stays watching', async () => {
    const key = `tr-bug-open.${stamp}.latest`;
    await writeMemory(alice.token, key, { id: 'open', status: 'open' });
    const r = await json('/v1/tracked-responses', { method: 'POST', headers: authA(), body: JSON.stringify({ message_id: reporterMsgId, watch: { key, condition: { field: 'status', equals: 'done' } }, response: { mode: 'auto' } }) });
    const id = r.body.data.trackedResponse.id;
    await json('/v1/tracked-responses/evaluate-due', { method: 'POST', headers: authA() });
    const c = await getContract(id);
    assert(c.state === 'watching', `should stay watching, got ${c.state}`);
    const cancel = await json(`/v1/tracked-responses/${id}/cancel`, { method: 'POST', headers: authA() });
    assert(cancel.status === 200 && cancel.body.data.trackedResponse.state === 'cancelled', 'cancel works');
});

await test('11. The spec endpoint self-describes the contract', async () => {
    const r = await json('/v1/tracked-responses/spec');
    assert(r.status === 200, `spec status ${r.status}`);
    assert(r.body.data.type === 'tracked-response', 'spec declares the type');
    assert(Array.isArray(r.body.data.rules) && r.body.data.rules.length > 0, 'spec lists rules');
});

await test('12. List returns the owner contracts', async () => {
    const r = await json('/v1/tracked-responses', { headers: authA() });
    assert(r.status === 200, `list status ${r.status}`);
    const ids = (r.body.data.trackedResponses || []).map((c: any) => c.id);
    assert(ids.includes(autoTrId) && ids.includes(apprTrId), 'both contracts listed');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
