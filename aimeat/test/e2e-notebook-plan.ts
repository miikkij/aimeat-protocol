/**
 * @file e2e-notebook-plan.ts
 * @description E2E for the notebook enrichment PLANNER endpoint (POST /v1/librarian/plan). The planner
 *   reasons over a free-text note and proposes enrichment steps; the AI call itself needs the caller's
 *   own OpenRouter key (decrypted server-side), so — like the classify E2E — this suite covers the
 *   deterministic contract around the AI call: auth required, input validation, and the clean
 *   no-OpenRouter-key rejection (the path that does NOT require a live model).
 * @version-history
 *   v1.1.0 — 2026-08-16 — August 2026 test-quality audit (e2e-notebook-plan:54): the only refusal here
 *     was 401, and both routes spend the OWNER's OpenRouter key, so the gate that matters is
 *     gateOwnerOrAiUse — never executed, because no agent principal existed in the file. Adds an agent
 *     without ai:use (403 naming the word, on plan AND distribute) and one with it (past the gate,
 *     stopped by the missing key). /v1/librarian/distribute had no coverage of that gate anywhere.
 *     Measured with the three gate calls deleted: the scopeless agent reaches NO_OPENROUTER_KEY, one
 *     API key away from spending the owner's budget.
 *   v1.0.0 — 2026-06-21 — Initial (Phase 1): validation + NO_OPENROUTER_KEY + auth scope.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=notebook-plan

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `nbplan${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'NbPlan', password: 'NbPlan1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'NbPlan', password: 'NbPlan1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Notebook Enrichment Planner E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;
let narrowAgentToken = '';

await test('Setup: an owner', async () => {
    A = await setupOwner('a');
    assert(!!A.token, 'owner token');
});

await test('1. Plan requires authentication (401)', async () => {
    const r = await json('/v1/librarian/plan', { method: 'POST', body: JSON.stringify({ text: 'a note' }) });
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

// 401 is the only refusal this suite had, and it is the weakest one on these two routes. Both spend
// the OWNER's OpenRouter key, so the gate that matters is gateOwnerOrAiUse: an owner session, or a
// token carrying ai:use. No agent, ecosystem or app principal existed anywhere in the file, so that
// gate was never executed — and /v1/librarian/distribute is covered by no other suite at all.
await test('1b. An agent WITHOUT ai:use is refused both doors → 403 naming the word', async () => {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: 'notebot', owner: A.name, capabilities: ['memory'], scopes: ['memory:read'] }),
    });
    assert(reg.status === 201, `create agent: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(reg.body.data.private_key, gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    narrowAgentToken = tok.body.data.token;

    for (const route of ['/v1/librarian/plan', '/v1/librarian/distribute']) {
        const r = await json(route, { method: 'POST', headers: auth(narrowAgentToken), body: JSON.stringify({ text: 'a note' }) });
        assert(r.status === 403, `${route}: expected 403, got ${r.status}: ${JSON.stringify(r.body.error)}`);
        assert(JSON.stringify(r.body.error ?? '').includes('ai:use'), `${route}: the refusal must name the word: ${JSON.stringify(r.body.error)}`);
    }
});

await test('1c. An agent WITH ai:use passes the gate and stops at the missing key', async () => {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: 'notebotwide', owner: A.name, capabilities: ['memory'], scopes: ['memory:read', 'ai:use'] }),
    });
    assert(reg.status === 201, `create agent: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(reg.body.data.private_key, gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);

    for (const route of ['/v1/librarian/plan', '/v1/librarian/distribute']) {
        const r = await json(route, { method: 'POST', headers: auth(tok.body.data.token), body: JSON.stringify({ text: 'a note' }) });
        assert(r.status !== 403, `${route}: an ai:use agent must be past the gate, got 403: ${JSON.stringify(r.body.error)}`);
        assert(r.status === 400 || r.status === 502, `${route}: expected the no-key answer, got ${r.status}: ${JSON.stringify(r.body.error)}`);
    }
});

await test('2. Missing text is rejected (400 INVALID_INPUT)', async () => {
    const r = await json('/v1/librarian/plan', { method: 'POST', headers: auth(A.token), body: JSON.stringify({}) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${JSON.stringify(r.body.error)}`);
});

await test('3. Blank text is rejected (400 INVALID_INPUT)', async () => {
    const r = await json('/v1/librarian/plan', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ text: '   ' }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${JSON.stringify(r.body.error)}`);
});

await test('4. Planning without an OpenRouter key is rejected cleanly (400 NO_OPENROUTER_KEY)', async () => {
    const r = await json('/v1/librarian/plan', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ text: 'research how tides work and compare to my notes' }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'NO_OPENROUTER_KEY', `expected NO_OPENROUTER_KEY, got ${JSON.stringify(r.body.error)}`);
});

await test('5. A delegate catalogue in the body is accepted (parses past validation → NO_OPENROUTER_KEY)', async () => {
    // Phase 2: the planner accepts a compact offer catalogue for grounding delegate steps. With no key
    // configured it still reaches the AI gate (NO_OPENROUTER_KEY), proving the catalogue field is parsed
    // rather than rejected as invalid input.
    const catalogue = [{ agent: 'web-researcher', offerId: 'research', title: 'Research a topic', ask: 'Research X', latency: 'minutes', cost: 'cheap' }];
    const r = await json('/v1/librarian/plan', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ text: 'research how tides work', catalogue }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'NO_OPENROUTER_KEY', `expected NO_OPENROUTER_KEY, got ${JSON.stringify(r.body.error)}`);
});

await test('6. Distribute requires authentication (401)', async () => {
    const r = await json('/v1/librarian/distribute', { method: 'POST', body: JSON.stringify({ text: 'a note' }) });
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('7. Distribute with blank text is rejected (400 INVALID_INPUT)', async () => {
    const r = await json('/v1/librarian/distribute', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ text: '  ' }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${JSON.stringify(r.body.error)}`);
});

await test('8. Distribute without an OpenRouter key is rejected cleanly (400 NO_OPENROUTER_KEY)', async () => {
    const r = await json('/v1/librarian/distribute', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ text: 'one topic about apples and another about quarterly budgets' }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'NO_OPENROUTER_KEY', `expected NO_OPENROUTER_KEY, got ${JSON.stringify(r.body.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
