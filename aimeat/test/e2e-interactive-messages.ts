// E2E Tests for Interactive Messages (federated AskUserQuestion)
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=interactive-messages
//
// Verifies the structured question/answer round-trip carried on a direct message's `interactive` field:
// an agent asks a person a set of option questions (aimeat_dm_ask / POST /v1/messages role=questions),
// the spec survives storage + the first-contact gate, the person replies with role=answers, the agent
// reads the machine-readable picks back via its thread, and malformed specs / orphan answers are rejected.
//
// A third party is then added (2026-09-04): an answer here is a person's considered reply to a
// structured question, the picks an agent will act on, so a stranger must neither read Bob's thread
// nor accept the first-contact request on his behalf. One of the 34 seeded into
// security/denial-coverage-exemptions.json on 2026-08-15 (quality plan stream B).

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
const aliceName = `iqalice${stamp}`;   // owner of the asking agent
const bobName = `iqbob${stamp}`;       // the person being asked
let bob = { token: '', ghii: '' };
let askbot = { gaii: '', token: '' };  // agent WITH messages:send + messages:read

let questionId = '';
let conversationId = '';

const QUESTIONS = [
    {
        id: 'q1', header: 'Auth', prompt: 'Which auth method should the integration use?',
        multiSelect: false, allowOther: true, required: true,
        options: [{ id: 'oauth', label: 'OAuth (Google)' }, { id: 'pw', label: 'Email + password' }],
    },
    {
        id: 'q2', header: 'Scopes', prompt: 'Which scopes to enable?',
        multiSelect: true, allowOther: false, required: false,
        options: [{ id: 'read', label: 'Read' }, { id: 'write', label: 'Write' }, { id: 'admin', label: 'Admin' }],
    },
];

console.log('\n=== AIMEAT Interactive Messages E2E (federated AskUserQuestion) ===\n');

console.log('Setup — owners + asking agent');
await test('Register Alice + Bob, create askbot (messages:send + messages:read)', async () => {
    const alice = await registerOwner(aliceName);
    bob = await registerOwner(bobName);
    askbot = await createAgent(aliceName, alice.token, 'askbot', ['messages:send', 'messages:read']);
    assert(askbot.gaii.startsWith('askbot#'), `agent gaii: ${askbot.gaii}`);
});

console.log('\nAsk — agent sends a structured question to a person');
await test('1. Agent sends an interactive question (role=questions) — spec stored verbatim', async () => {
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${askbot.token}` },
        body: JSON.stringify({
            to: bob.ghii, body: 'Before I build it, a couple of questions:',
            interactive: { role: 'questions', v: 1, questions: QUESTIONS, submitLabel: 'Send' },
        }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const m = body.data.message;
    assert(m.interactive?.role === 'questions', `interactive.role should be 'questions', got ${m.interactive?.role}`);
    assert(m.interactive.questions.length === 2, `expected 2 questions, got ${m.interactive.questions.length}`);
    assert(m.interactive.questions[0].options[0].id === 'oauth', 'first option id preserved');
    assert(m.interactive.questions[1].multiSelect === true, 'multiSelect preserved on q2');
    questionId = m.id;
    conversationId = m.conversationId;
});

await test('2. Bob accepts the first-contact request; the question is in his inbox WITH the spec', async () => {
    const acc = await json(`/v1/messages/requests/${encodeURIComponent(askbot.gaii)}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
    });
    assert(acc.status === 200, `accept failed: ${acc.status} ${JSON.stringify(acc.body)}`);
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
    const m = inbox.body.data.messages.find((x: any) => x.id === questionId);
    assert(m !== undefined, 'the question is in Bob\'s inbox');
    assert(m.interactive?.role === 'questions' && m.interactive.questions.length === 2, 'Bob sees the question spec');
});

console.log('\nAnswer — the person replies with structured picks');
await test('3. Bob replies with role=answers (single + multi + ids) — accepted (201)', async () => {
    const { status, body } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
        body: JSON.stringify({
            to: askbot.gaii, conversation_id: conversationId, reply_to: questionId,
            body: '**Answers**\n- Auth: OAuth (Google)\n- Scopes: Read, Write',
            interactive: {
                role: 'answers', v: 1, answersFor: questionId,
                answers: { q1: { selected: ['oauth'], other: null }, q2: { selected: ['read', 'write'], other: null } },
            },
        }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.interactive?.role === 'answers', 'reply carries the answers payload');
});

await test('4. Agent reads the answers back from its thread (machine-readable picks)', async () => {
    const thread = await json(`/v1/messages/agent-thread/${encodeURIComponent(conversationId)}`, {
        headers: { Authorization: `Bearer ${askbot.token}` },
    });
    assert(thread.status === 200, `agent-thread ${thread.status}: ${JSON.stringify(thread.body)}`);
    const ans = thread.body.data.messages.find((m: any) => m.interactive?.role === 'answers');
    assert(ans !== undefined, 'the agent sees the answers message');
    assert(ans.interactive.answers.q1.selected[0] === 'oauth', `q1 answer should be oauth, got ${JSON.stringify(ans.interactive.answers.q1)}`);
    assert(ans.interactive.answers.q2.selected.includes('read') && ans.interactive.answers.q2.selected.includes('write'),
        `q2 should include read+write, got ${JSON.stringify(ans.interactive.answers.q2.selected)}`);
});

await test('5. Free-form "Other" answer round-trips (a second question, answered via other)', async () => {
    const send = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${askbot.token}` },
        body: JSON.stringify({
            to: bob.ghii, conversation_id: conversationId,
            interactive: { role: 'questions', v: 1, questions: [{
                id: 'qx', header: 'Region', prompt: 'Which region?', multiSelect: false, allowOther: true, required: true,
                options: [{ id: 'eu', label: 'EU' }, { id: 'us', label: 'US' }],
            }] },
        }),
    });
    assert(send.status === 201, `ask other: ${send.status}`);
    const qx = send.body.data.message.id;
    const ans = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
        body: JSON.stringify({
            to: askbot.gaii, conversation_id: conversationId, reply_to: qx, body: '- Region: Other: Nordics',
            interactive: { role: 'answers', v: 1, answersFor: qx, answers: { qx: { selected: [], other: 'Nordics' } } },
        }),
    });
    assert(ans.status === 201, `answer other: ${ans.status}: ${JSON.stringify(ans.body)}`);
    assert(ans.body.data.message.interactive.answers.qx.other === 'Nordics', 'Other text preserved');
});

console.log('\nValidation — malformed specs / orphan answers are rejected');
await test('6. Answers pointing at a non-existent question are rejected (400)', async () => {
    const { status } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${bob.token}` },
        body: JSON.stringify({
            to: askbot.gaii, conversation_id: conversationId, body: 'orphan answers',
            interactive: { role: 'answers', v: 1, answersFor: '00000000-0000-0000-0000-000000000000', answers: { q1: { selected: ['oauth'] } } },
        }),
    });
    assert(status === 400, `expected 400 for orphan answersFor, got ${status}`);
});

await test('7. A malformed question spec (option without id) is rejected (400)', async () => {
    const { status } = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${askbot.token}` },
        body: JSON.stringify({
            to: bob.ghii,
            interactive: { role: 'questions', v: 1, questions: [{
                id: 'bad', header: 'Bad', prompt: 'No option ids', options: [{ label: 'missing id' }],
            }] },
        }),
    });
    assert(status === 400, `expected 400 for malformed spec, got ${status}`);
});

await test('8. Owner can ask its OWN agent a question (own-agent path, no gate)', async () => {
    const owner = await registerOwner(`iqself${stamp}`);
    const myAgent = await createAgent(`iqself${stamp}`, owner.token, 'selfbot', ['messages:read']);
    const send = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({
            to: myAgent.gaii,
            interactive: { role: 'questions', v: 1, questions: [{
                id: 'go', header: 'Proceed', prompt: 'Run the migration now?', multiSelect: false, required: true,
                options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
            }] },
        }),
    });
    assert(send.status === 201, `own-agent ask: ${send.status}: ${JSON.stringify(send.body)}`);
    const inbox = await json('/v1/messages/agent-inbox', { headers: { Authorization: `Bearer ${myAgent.token}` } });
    const m = inbox.body.data.messages.find((x: any) => x.interactive?.role === 'questions');
    assert(m !== undefined, 'the agent receives the interactive question from its owner');
});

// ── Who may read the answers, and who may give them ──
//
// The suite already has two owners, and every case above is Alice's agent asking and Bob answering,
// which is the flow working. The question it never asks is what a THIRD person gets. An answer here
// is a person's considered reply to a structured question — the picks an agent will act on — so two
// things must hold: a stranger cannot read Bob's thread, and a stranger cannot answer as Bob.
console.log('\nA third party — neither the asker nor the person asked');

let mallory: { token: string; ghii: string };

await test('9. Register a third owner with no part in the conversation', async () => {
    mallory = await registerOwner(`iqmallory${stamp}`);
    assert(mallory.ghii.length > 0, 'third owner exists');
});

await test('10. A stranger\'s inbox does not carry the question or the answers', async () => {
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${mallory.token}` } });
    assert(inbox.status === 200, `inbox ${inbox.status}`);
    const msgs = (inbox.body.data?.messages ?? []) as any[];
    assert(!msgs.some(m => m.id === questionId), 'the stranger sees the question');
    assert(!JSON.stringify(msgs).includes('answersFor'), 'the stranger sees an answers payload');
});

await test('11. A stranger cannot accept the first-contact request on Bob\'s behalf', async () => {
    const r = await json(`/v1/messages/requests/${encodeURIComponent(askbot.gaii)}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${mallory.token}` },
    });
    // 404 and not 403: the pending request is looked up under the caller's own identity, so one
    // addressed to Bob is not there for anybody else. Pinned, because a drift to 403 would confirm
    // that askbot has asked this person something.
    assert(r.status === 404, `expected 404, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('12. An unauthenticated caller cannot ask a question at all', async () => {
    // The one door on this surface that answers with a status rather than an empty result: POST
    // /v1/messages carries requireAuth, so a question with no credential never reaches the
    // interactive validation. Without this, an anonymous sender could put a structured prompt in
    // front of a person and collect their picks.
    const r = await json('/v1/messages', {
        method: 'POST',
        body: JSON.stringify({
            to: bob.ghii, body: 'anonymous question',
            interactive: { role: 'questions', v: 1, questions: QUESTIONS, submitLabel: 'Send' },
        }),
    });
    assert(r.status === 401, `expected 401, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('13. POSITIVE CONTROL: Bob still reads his own question and its answers', async () => {
    // Two refusals in a row pass just as happily against a thread that had become unreadable to
    // everyone, which for a question-and-answer flow would be the failure rather than the fix.
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
    assert(inbox.status === 200, `bob inbox ${inbox.status}`);
    assert((inbox.body.data?.messages ?? []).some((m: any) => m.id === questionId),
        'Bob can no longer see the question he was asked');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
