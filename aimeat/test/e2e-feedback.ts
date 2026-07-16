/**
 * @file e2e-feedback.ts
 * @description E2E tests for the Node Feedback Channel: an authenticated principal (agent) opens
 *   a platform-feedback thread to the node operator, the operator sees it in the admin inbox,
 *   replies (new → ack), the sender reads the reply and follows up, and the operator resolves.
 *   A `blocker` thread drops a bell notification for the operator. Failure modes: unauthenticated
 *   401, foreign-thread 404 (cross-principal isolation, incl. same-owner GHII vs GAII), invalid
 *   category/status 400, non-operator admin access 403, and the per-principal rate limit 429.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-feedback
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: Node Feedback Channel v1.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const opName = `fbop${Date.now() % 100000}`;      // first owner → operator
const userName = `fbuser${Date.now() % 100000}`;  // regular owner
const agentName = 'fbagent';

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

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function registerOwner(name: string): Promise<{ token: string }> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { token: tok.body.data.token as string };
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

// ── State ──
let opToken = '';
let userToken = '';
let agentGaii = '';
let agentToken = '';
let threadId = '';

console.log('\n=== Node Feedback Channel E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register operator (first owner) + regular owner', async () => {
    opToken = (await registerOwner(opName)).token;
    userToken = (await registerOwner(userName)).token;
});

await test('Register agent under the regular owner + agent token', async () => {
    const { status, body } = await json('/v1/agents', auth(userToken, {
        method: 'POST',
        body: JSON.stringify({ name: agentName, owner: userName, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(status === 201, `agent register status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: await signMsg(body.data.private_key, agentGaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data.token;
});

// ── Phase 1: happy path — agent reports, operator triages + replies, agent follows up ──
console.log('\nPhase 1: happy path (send → inbox → reply → resolve)');

await test('Agent opens a feedback thread (POST /v1/feedback → 201)', async () => {
    const { status, body } = await json('/v1/feedback', auth(agentToken, {
        method: 'POST',
        body: JSON.stringify({
            category: 'bug', title: 'Badge injection breaks apps',
            body: 'Any app whose JS contains </body> dies silently on inline serve.',
            context: { app: 'drum-sample-slicer', version: '1.34' },
        }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    threadId = body.data?.id;
    assert(typeof threadId === 'string' && threadId.startsWith('fb-'), `got thread id, got ${threadId}`);
    assert(body.data.sender === agentGaii, `sender is the agent GAII, got ${body.data.sender}`);
    assert(body.data.status === 'new', `status new, got ${body.data.status}`);
    assert(body.data.context?.app === 'drum-sample-slicer', 'context carried');
});

await test('Agent sees the thread in GET /v1/feedback/mine', async () => {
    const { status, body } = await json('/v1/feedback/mine', auth(agentToken));
    assert(status === 200, `status ${status}`);
    const threads = body.data?.threads ?? [];
    assert(threads.some((t: any) => t.id === threadId), 'own thread listed');
});

await test('Operator sees the thread in GET /v1/admin/feedback', async () => {
    const { status, body } = await json('/v1/admin/feedback', auth(opToken));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const threads = body.data?.threads ?? [];
    assert(threads.some((t: any) => t.id === threadId), 'thread in operator inbox');
});

await test('Operator inbox filters by status + category', async () => {
    const a = await json('/v1/admin/feedback?status=new&category=bug', auth(opToken));
    assert(a.status === 200 && (a.body.data?.threads ?? []).some((t: any) => t.id === threadId), 'matches filter');
    const b = await json('/v1/admin/feedback?status=resolved', auth(opToken));
    assert(b.status === 200 && !(b.body.data?.threads ?? []).some((t: any) => t.id === threadId), 'excluded by non-matching filter');
});

await test('Operator reply bumps new → ack and appends an operator message', async () => {
    const { status, body } = await json(`/v1/feedback/${threadId}/reply`, auth(opToken, {
        method: 'POST', body: JSON.stringify({ body: 'Confirmed and fixed in 4d83a8ee — thanks for the report!' }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'ack', `status ack after operator reply, got ${body.data.status}`);
    assert(body.data.messages.length === 1 && body.data.messages[0].from === 'operator', 'operator message appended');
});

await test('Agent reads the operator reply via /mine and follows up', async () => {
    const mine = await json('/v1/feedback/mine', auth(agentToken));
    const thread = (mine.body.data?.threads ?? []).find((t: any) => t.id === threadId);
    assert(!!thread && thread.messages.length === 1 && thread.messages[0].from === 'operator', 'reply visible to sender');
    const { status, body } = await json(`/v1/feedback/${threadId}/reply`, auth(agentToken, {
        method: 'POST', body: JSON.stringify({ body: 'Verified fixed on our side too.' }),
    }));
    assert(status === 200, `follow-up status ${status}`);
    assert(body.data.messages.length === 2 && body.data.messages[1].from === 'sender', 'sender follow-up appended');
});

await test('Operator resolves the thread (PATCH /v1/admin/feedback/:id)', async () => {
    const { status, body } = await json(`/v1/admin/feedback/${threadId}`, auth(opToken, {
        method: 'PATCH', body: JSON.stringify({ status: 'resolved' }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'resolved', `status resolved, got ${body.data.status}`);
    const mine = await json('/v1/feedback/mine', auth(agentToken));
    const thread = (mine.body.data?.threads ?? []).find((t: any) => t.id === threadId);
    assert(thread?.status === 'resolved', 'sender sees resolved status');
});

// ── Phase 2: blocker → operator bell notification ──
console.log('\nPhase 2: blocker notification');

await test('A blocker thread drops a bell notification for the operator', async () => {
    const { status } = await json('/v1/feedback', auth(userToken, {
        method: 'POST',
        body: JSON.stringify({ category: 'blocker', title: 'Cannot publish at all', body: 'Publishing returns 500 on every attempt.' }),
    }));
    assert(status === 201, `blocker create status ${status}`);
    const notifs = await json('/v1/notifications', auth(opToken));
    assert(notifs.status === 200, `notifications status ${notifs.status}`);
    const items = notifs.body.data?.notifications ?? notifs.body.data ?? [];
    const arr = Array.isArray(items) ? items : (items.items ?? []);
    assert(arr.some((n: any) => n.type === 'feedback_blocker'), `operator has a feedback_blocker notification: ${JSON.stringify(arr).slice(0, 200)}`);
});

// ── Phase 3: failure modes ──
console.log('\nPhase 3: failure modes');

await test('Unauthenticated POST /v1/feedback → 401', async () => {
    const { status } = await json('/v1/feedback', {
        method: 'POST', body: JSON.stringify({ category: 'bug', title: 'x', body: 'y' }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('Invalid category → 400', async () => {
    const { status } = await json('/v1/feedback', auth(agentToken, {
        method: 'POST', body: JSON.stringify({ category: 'rant', title: 'x', body: 'y' }),
    }));
    assert(status === 400, `expected 400, got ${status}`);
});

await test('Over-long title → 400', async () => {
    const { status } = await json('/v1/feedback', auth(agentToken, {
        method: 'POST', body: JSON.stringify({ category: 'bug', title: 'x'.repeat(201), body: 'y' }),
    }));
    assert(status === 400, `expected 400, got ${status}`);
});

await test("Another principal cannot read the agent's thread (→ 404)", async () => {
    const { status } = await json(`/v1/feedback/${threadId}`, auth(userToken));
    assert(status === 404, `expected 404, got ${status}`);
});

await test("Same-owner GHII isolation: the owner's /mine does not list the agent's thread", async () => {
    const { status, body } = await json('/v1/feedback/mine', auth(userToken));
    assert(status === 200, `status ${status}`);
    assert(!(body.data?.threads ?? []).some((t: any) => t.id === threadId), 'agent thread not visible to owner GHII');
});

await test("Another principal cannot reply into the agent's thread (→ 404)", async () => {
    const { status } = await json(`/v1/feedback/${threadId}/reply`, auth(userToken, {
        method: 'POST', body: JSON.stringify({ body: 'hijack attempt' }),
    }));
    assert(status === 404, `expected 404, got ${status}`);
});

await test('Non-operator GET /v1/admin/feedback → 403', async () => {
    const { status } = await json('/v1/admin/feedback', auth(userToken));
    assert(status === 403, `expected 403, got ${status}`);
});

await test('Invalid status on PATCH → 400', async () => {
    const { status } = await json(`/v1/admin/feedback/${threadId}`, auth(opToken, {
        method: 'PATCH', body: JSON.stringify({ status: 'done' }),
    }));
    assert(status === 400, `expected 400, got ${status}`);
});

await test('Per-principal rate limit trips with 429', async () => {
    let got429 = false;
    for (let i = 0; i < 25; i++) {
        const { status } = await json('/v1/feedback', auth(agentToken, {
            method: 'POST', body: JSON.stringify({ category: 'idea', title: `spam ${i}`, body: 'rate limit probe' }),
        }));
        if (status === 429) { got429 = true; break; }
        assert(status === 201, `unexpected status ${status} on probe ${i}`);
    }
    assert(got429, 'a 429 fired within 25 rapid sends');
});

// ── Summary ──
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
