// E2E: the operator's welcome message — every new account finds one real message in its mailbox.
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=operator-welcome
//
// What this suite is really guarding:
//   1. The FIRST owner is the operator, so sender would equal recipient. sendDirectMessage's
//      own-agent branch writes both copies under the same primary key, which would blow up INSIDE
//      registration. Test 1 is that guard, and it must stay.
//   2. skipContactGate — without it the operator's first words land in the first-contact REQUESTS
//      bucket, where a newcomer has to accept a stranger before reading the message that explains
//      where they are. Test 3 fails loudly if the flag is dropped.
//   3. Every human registration door, not just one. Three doors bypassed provisionOwner and the
//      onboarding track marker was missing from one of them for exactly that reason.
//
// v1.0.0 -- 2026-08-07 -- Initial.

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

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
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
    const { body } = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

/** POST /v1/owners — the programmatic door. */
async function registerViaOwners(name: string): Promise<{ token: string; ghii: string }> {
    const { status, body } = await json('/v1/owners', {
        method: 'POST', body: JSON.stringify({ name, display_name: name, public_key: 'placeholder' }),
    });
    assert(status === 201, `register ${name}: ${status} ${JSON.stringify(body)}`);
    return { token: await ownerToken(name, body.data.private_key), ghii: `${name}@${NODE_ID}` };
}

/** POST /v1/ghii — the account door with a password. */
async function registerViaGhii(name: string): Promise<{ token: string; ghii: string }> {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: name, display_name: name, password: 'Correct-Horse-9!' }),
    });
    assert(status === 201, `ghii register ${name}: ${status} ${JSON.stringify(body)}`);
    return { token: await ownerToken(name, body.data.private_key), ghii: `${name}@${NODE_ID}` };
}

async function inboxOf(token: string): Promise<any[]> {
    const { status, body } = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${token}` } });
    assert(status === 200, `inbox status ${status}`);
    return body.data.messages ?? [];
}

async function requestsOf(token: string): Promise<any[]> {
    const { status, body } = await json('/v1/messages/requests', { headers: { Authorization: `Bearer ${token}` } });
    assert(status === 200, `requests status ${status}`);
    return body.data.requests ?? [];
}

const stamp = Date.now();
const operatorName = `opwelcome${stamp}`;      // first owner in this suite => operator
const newcomerName = `newcomer${stamp}`;
const ghiiDoorName = `ghiidoor${stamp}`;
const afterOffName = `afteroff${stamp}`;

let operator = { token: '', ghii: '' };
let newcomer = { token: '', ghii: '' };

console.log('\n=== AIMEAT Operator Welcome Message E2E ===\n');

console.log('Setup — the operator account');
await test('1. The first owner registers and gets NO welcome (would be a self-send)', async () => {
    operator = await registerViaOwners(operatorName);
    await sleep(400);   // the welcome is fire-and-forget; give it a chance to do the wrong thing
    const inbox = await inboxOf(operator.token);
    assert(inbox.length === 0, `operator inbox should be empty, got ${inbox.length}: ${JSON.stringify(inbox.map((m: any) => m.subject))}`);
});

console.log('\nPhase 1 — a newcomer finds the operator\'s message waiting');
await test('2. A second account receives exactly one message, from the operator', async () => {
    newcomer = await registerViaOwners(newcomerName);
    await sleep(600);
    const inbox = await inboxOf(newcomer.token);
    assert(inbox.length === 1, `expected 1 message, got ${inbox.length}`);
    assert(inbox[0].senderGhii === operator.ghii, `sender should be the operator, got ${inbox[0].senderGhii}`);
    assert(inbox[0].direction === 'inbound', `direction: ${inbox[0].direction}`);
});

await test('3. It is IN the mailbox, not stuck in the first-contact requests bucket', async () => {
    const reqs = await requestsOf(newcomer.token);
    assert(reqs.length === 0, `requests should be empty (skipContactGate), got ${JSON.stringify(reqs)}`);
});

await test('4. The first line became the subject, and the body is the rest', async () => {
    const inbox = await inboxOf(newcomer.token);
    const m = inbox[0];
    assert(typeof m.subject === 'string' && m.subject.length > 0, 'has a subject');
    assert(!m.subject.includes('\n'), `subject is one line, got ${JSON.stringify(m.subject)}`);
    assert(typeof m.body === 'string' && m.body.length > m.subject.length, 'body is longer than the subject');
    assert(!m.body.startsWith(m.subject), 'body does not repeat the subject line');
    assert(m.body.includes(newcomerName), `body addresses the person by name: ${m.body.slice(0, 120)}`);
});

await test('5. The reply goes back to a real account (the operator), not a synthetic sender', async () => {
    const inbox = await inboxOf(newcomer.token);
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${newcomer.token}` },
        body: JSON.stringify({ to: inbox[0].senderGhii, body: 'Thanks — one question.', conversation_id: inbox[0].conversationId }),
    });
    assert(status === 201, `reply status ${status}: ${JSON.stringify(body)}`);
    await sleep(400);
    const opInbox = await inboxOf(operator.token);
    assert(opInbox.some((m: any) => m.senderGhii === newcomer.ghii), 'the operator received the reply');
});

console.log('\nPhase 2 — every human door, not just one');
await test('6. The /v1/ghii door produces the welcome too', async () => {
    const g = await registerViaGhii(ghiiDoorName);
    await sleep(600);
    const inbox = await inboxOf(g.token);
    assert(inbox.length === 1, `expected 1 message via /v1/ghii, got ${inbox.length}`);
    assert(inbox[0].senderGhii === operator.ghii, `sender: ${inbox[0].senderGhii}`);
});

console.log('\nPhase 3 — the operator owns the words, including turning them off');
await test('7. The welcome text is an editable managed prompt', async () => {
    const { status, body } = await json('/v1/admin/prompts/operator-welcome', {
        headers: { Authorization: `Bearer ${operator.token}` },
    });
    assert(status === 200, `prompt fetch status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.prompt.content === 'string' && body.data.prompt.content.length > 0, 'has content');
    assert(!!body.data.prompt.locales?.fi, 'ships with a Finnish version');
});

await test('8. Editing it changes what the next account receives', async () => {
    const marker = `Edited by the operator ${stamp}`;
    const patch = await json('/v1/admin/prompts/operator-welcome', {
        method: 'PATCH', headers: { Authorization: `Bearer ${operator.token}` },
        body: JSON.stringify({ content: `A subject line ${stamp}\n\n${marker}`, change_note: 'e2e' }),
    });
    assert(patch.status === 200, `patch status ${patch.status}: ${JSON.stringify(patch.body)}`);

    const later = await registerViaOwners(`edited${stamp}`);
    await sleep(600);
    const inbox = await inboxOf(later.token);
    assert(inbox.length === 1, `expected 1 message, got ${inbox.length}`);
    assert(inbox[0].subject === `A subject line ${stamp}`, `subject: ${inbox[0].subject}`);
    assert(inbox[0].body === marker, `body: ${inbox[0].body}`);
});

await test('9. FAILURE MODE — deactivating the prompt stops it, and registration still succeeds', async () => {
    const off = await json('/v1/admin/prompts/operator-welcome', {
        method: 'PATCH', headers: { Authorization: `Bearer ${operator.token}` },
        body: JSON.stringify({ active: false, change_note: 'e2e off' }),
    });
    assert(off.status === 200, `deactivate status ${off.status}: ${JSON.stringify(off.body)}`);

    const quiet = await registerViaOwners(afterOffName);
    await sleep(600);
    const inbox = await inboxOf(quiet.token);
    assert(inbox.length === 0, `expected no message when the prompt is off, got ${inbox.length}`);
});

await test('10. FAILURE MODE — a non-operator cannot edit the welcome text', async () => {
    const { status } = await json('/v1/admin/prompts/operator-welcome', {
        method: 'PATCH', headers: { Authorization: `Bearer ${newcomer.token}` },
        body: JSON.stringify({ content: 'hijacked', change_note: 'nope' }),
    });
    assert(status === 403 || status === 401, `expected 401/403 for a plain owner, got ${status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
