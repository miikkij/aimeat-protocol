/**
 * @file e2e-hello-mcp.ts
 * @description E2E for Hello MCP, the onboarding proof. The pass condition is one memory key,
 *   `onboarding.hello_mcp`, and the load-bearing fact is WHO writes it versus WHO reads it: the
 *   user's AI writes it over its own MCP session, so it lands in the AGENT's namespace, while the
 *   check runs from the owner's browser. If the owner-scope broadening on GET /v1/memory/:key ever
 *   regressed, the feature would fail exactly the way it exists to prevent — silently, and only
 *   for users whose connection was genuinely working. The browser cannot cover that case (a
 *   browser session is always the owner), so it is covered here.
 *
 *   Also pins the response contract the checker depends on: `exists` is present on BOTH branches.
 *   A hit used to omit it, which made `if (!data.exists)` read every success as a failure.
 *
 *   Failure modes: unproven owner sees exists:false (not a 404), a foreign owner's key does not
 *   satisfy another owner's check (cross-owner isolation), and the prompt names the same key the
 *   checker looks for.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-hello-mcp
 * @version-history
 *   v1.0.0 — 2026-07-31 — Initial.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const HELLO_KEY = 'onboarding.hello_mcp';
const ownerA = `hmo${Date.now() % 100000}`;
const ownerB = `hmb${Date.now() % 100000}`;
const agentName = 'hmagent';

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

/** The check exactly as the browser performs it: one lookup, soft, owner session. */
async function checkHelloMcp(ownerToken: string) {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(HELLO_KEY)}?soft=1`, auth(ownerToken));
    assert(status === 200, `soft read must be 200, got ${status}`);
    return body.data;
}

// ── State ──
let tokenA = '';
let tokenB = '';
let agentGaii = '';
let agentToken = '';

console.log('\n=== Hello MCP E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register two owners + an agent under owner A', async () => {
    tokenA = (await registerOwner(ownerA)).token;
    tokenB = (await registerOwner(ownerB)).token;
    const { status, body } = await json('/v1/agents', auth(tokenA, {
        method: 'POST',
        body: JSON.stringify({ name: agentName, owner: ownerA, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(status === 201, `agent register ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: await signMsg(body.data.private_key, agentGaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data.token;
});

// ── Phase 1: the failure state is a clean answer, not an error ──
console.log('\nPhase 1: unproven');

await test('Before anything is written, the check answers exists:false with 200 (not 404)', async () => {
    const d = await checkHelloMcp(tokenA);
    assert(d.exists === false, `expected exists:false, got ${JSON.stringify(d)}`);
    assert(d.value === null, `expected null value, got ${JSON.stringify(d.value)}`);
});

// ── Phase 2: the real path — the AGENT writes, the OWNER reads ──
console.log('\nPhase 2: proof written by the agent, read by the owner');

await test('Agent writes the key into its own namespace', async () => {
    const { status, body } = await json('/v1/memory', auth(agentToken, {
        method: 'POST',
        body: JSON.stringify({
            key: HELLO_KEY,
            value: { ok: true, at: new Date().toISOString(), tool: 'e2e agent' },
            visibility: 'private',
        }),
    }));
    assert(status === 201, `agent write ${status}: ${JSON.stringify(body)}`);
});

await test('The key really is under the AGENT GAII, not the owner GHII', async () => {
    // Read the agent's own keyspace explicitly. If this ever returns nothing, the premise of the
    // owner-scope test below has changed and the test above is proving nothing.
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(HELLO_KEY)}?agent=${encodeURIComponent(agentGaii)}`, auth(tokenA));
    assert(status === 200, `agent-scoped read ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.value?.tool === 'e2e agent', `expected the agent's value, got ${JSON.stringify(body.data?.value)}`);
});

await test('Owner check passes on the agent-written key — ONE lookup, no agent param', async () => {
    const d = await checkHelloMcp(tokenA);
    assert(d.exists === true, `owner-scope read must find the agent's key; got ${JSON.stringify(d)}`);
    assert(d.value?.ok === true, `expected the written value, got ${JSON.stringify(d.value)}`);
});

await test('A hit carries exists:true — the contract the checker depends on', async () => {
    // Regression pin: a hit used to omit `exists` entirely, so `if (!data.exists)` read every
    // success as a failure. Silently, and only when the connection actually worked.
    const d = await checkHelloMcp(tokenA);
    assert('exists' in d, 'a successful soft read must still carry the `exists` field');
    assert(d.exists === true, `exists must be true on a hit, got ${JSON.stringify(d.exists)}`);
});

// ── Phase 3: one owner's proof is not another's ──
console.log('\nPhase 3: cross-owner isolation');

await test('Owner B is still unproven after owner A passed', async () => {
    const d = await checkHelloMcp(tokenB);
    assert(d.exists === false, `owner B must not inherit owner A's proof; got ${JSON.stringify(d)}`);
});

// ── Phase 4: the prompt and the checker name the same key ──
console.log('\nPhase 4: prompt / key agreement');

await test('GET /v1/prompts/hello-mcp names the key the checker looks for', async () => {
    const { status, body } = await json('/v1/prompts/hello-mcp');
    assert(status === 200, `prompt route ${status}`);
    assert(body.data?.key === HELLO_KEY, `route reports key ${body.data?.key}, expected ${HELLO_KEY}`);
    assert(typeof body.data?.prompt === 'string' && body.data.prompt.includes(HELLO_KEY),
        'the prompt text must name the key it writes');
});

await test('The Finnish prompt names the same key', async () => {
    const { body } = await json('/v1/prompts/hello-mcp?lang=fi');
    assert(body.data?.prompt?.includes(HELLO_KEY), 'fi prompt must name the same key');
});

console.log(`\n=== Hello MCP: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
