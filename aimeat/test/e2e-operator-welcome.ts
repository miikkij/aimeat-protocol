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
// v1.2.0 -- 2026-11-15 -- Audit M068: the negatives are proven after a later welcome has landed
//   (polled), not after a fixed sleep. Audit L092: test 11 refuses a plain owner GET, versions and
//   reset on the prompt; test 10 asserts 403 ACCESS_DENIED exactly.
// v1.1.0 -- 2026-10-12 -- POST /v1/owners: the answer's next action is POST /v1/ghii/login, not the
//   owner-key sign-in that node 4.0.0 removes (src/routes/owners.ts v1.8.0).
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

import { ownerToken as passwordToken } from './helpers/owner-login.js';
import { seedPassword } from './helpers/seed-password.js';

/**
 * POST /v1/owners — the programmatic door. It makes an account with no password, and the owner-key
 * sign-in that opened its session is removed in 4.0.0, so the account gets a password in the
 * server's database (helpers/seed-password.ts) and signs in with it to read its inbox.
 */
async function registerViaOwners(name: string): Promise<{ token: string; ghii: string }> {
    const { status, body } = await json('/v1/owners', {
        method: 'POST', body: JSON.stringify({ name, display_name: name, public_key: 'placeholder' }),
    });
    assert(status === 201, `register ${name}: ${status} ${JSON.stringify(body)}`);
    // The answer's next action is the password sign-in, never the owner-key sign-in 4.0.0 removes.
    const next = body.hints?.next_actions?.[0];
    assert(next?.url === '/v1/ghii/login' && next?.method === 'POST', `next action: ${JSON.stringify(body.hints?.next_actions)}`);
    assert(!JSON.stringify(body.hints ?? {}).includes('/v1/auth/token'), 'no next action names the owner-key sign-in');
    await seedPassword(name);
    return { token: await passwordToken(BASE, name), ghii: `${name}@${NODE_ID}` };
}

/** POST /v1/ghii — the account door with a password. */
async function registerViaGhii(name: string): Promise<{ token: string; ghii: string }> {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: name, display_name: name, password: 'Correct-Horse-9!' }),
    });
    assert(status === 201, `ghii register ${name}: ${status} ${JSON.stringify(body)}`);
    return { token: await passwordToken(BASE, name, 'Correct-Horse-9!'), ghii: `${name}@${NODE_ID}` };
}

async function inboxOf(token: string): Promise<any[]> {
    const { status, body } = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${token}` } });
    assert(status === 200, `inbox status ${status}`);
    return body.data.messages ?? [];
}

/** Poll an inbox until it holds `n` messages or the deadline passes; the last read is returned. */
async function waitForInbox(token: string, n: number, deadlineMs = 10_000): Promise<any[]> {
    const until = Date.now() + deadlineMs;
    let inbox = await inboxOf(token);
    while (inbox.length < n && Date.now() < until) {
        await sleep(100);
        inbox = await inboxOf(token);
    }
    return inbox;
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
    const inbox = await waitForInbox(newcomer.token, 1);
    assert(inbox.length === 1, `expected 1 message, got ${inbox.length}`);
    assert(inbox[0].senderGhii === operator.ghii, `sender should be the operator, got ${inbox[0].senderGhii}`);
    assert(inbox[0].direction === 'inbound', `direction: ${inbox[0].direction}`);
    // Test 1's negative, asked again once a later welcome has landed: a self-send to the operator
    // that is only slower than test 1's wait would be in the operator's inbox by now.
    const opInbox = await inboxOf(operator.token);
    assert(opInbox.length === 0, `operator inbox should still be empty, got ${JSON.stringify(opInbox.map((m: any) => m.subject))}`);
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
    const inbox = await waitForInbox(g.token, 1);
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
    const inbox = await waitForInbox(later.token, 1);
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
    // No fixed wait proves a negative. The prompt goes back on and a control account registers; once
    // the control's welcome has landed, a welcome sent for the quiet account (late, or reading the
    // prompt after it went back on) would have landed too.
    const on = await json('/v1/admin/prompts/operator-welcome', {
        method: 'PATCH', headers: { Authorization: `Bearer ${operator.token}` },
        body: JSON.stringify({ active: true, change_note: 'e2e on again' }),
    });
    assert(on.status === 200, `reactivate status ${on.status}: ${JSON.stringify(on.body)}`);
    const control = await registerViaOwners(`control${stamp}`);
    const controlInbox = await waitForInbox(control.token, 1);
    assert(controlInbox.length === 1, `the control account got ${controlInbox.length} welcomes, expected 1`);
    const inbox = await inboxOf(quiet.token);
    assert(inbox.length === 0, `expected no message when the prompt is off, got ${inbox.length}`);
});

await test('10. FAILURE MODE — a non-operator cannot edit the welcome text', async () => {
    const { status, body } = await json('/v1/admin/prompts/operator-welcome', {
        method: 'PATCH', headers: { Authorization: `Bearer ${newcomer.token}` },
        body: JSON.stringify({ content: 'hijacked', change_note: 'nope' }),
    });
    assert(status === 403 && body.error?.code === 'ACCESS_DENIED', `expected 403 ACCESS_DENIED for a plain owner, got ${status} ${JSON.stringify(body.error)}`);
});

await test('11. FAILURE MODE — a non-operator cannot read the prompt, its versions, or reset it', async () => {
    const P = '/v1/admin/prompts/operator-welcome';
    for (const [method, path] of [['GET', P], ['GET', `${P}/versions`], ['GET', `${P}/versions/1`], ['POST', `${P}/reset`]] as const) {
        const { status, body } = await json(path, {
            method, headers: { Authorization: `Bearer ${newcomer.token}` }, ...(method === 'POST' ? { body: '{}' } : {}),
        });
        assert(status === 403 && body.error?.code === 'ACCESS_DENIED', `${method} ${path} as a plain owner: ${status} ${JSON.stringify(body.error ?? body.data)}`);
    }
    // The prompt is unchanged by the refused reset: the operator's edit from test 8 is still there.
    const read = await json(P, { headers: { Authorization: `Bearer ${operator.token}` } });
    assert(read.status === 200 && String(read.body.data?.prompt?.content).includes(`Edited by the operator ${stamp}`), `the operator's text changed: ${JSON.stringify(read.body.data?.prompt?.content)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
