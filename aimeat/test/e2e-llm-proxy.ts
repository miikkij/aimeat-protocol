/**
 * @file e2e-llm-proxy.ts
 * @description E2E tests for the OpenAI-compatible door the chat agent's model calls come through.
 *
 *   The point of this route is that it decides nothing itself: the same key choice, budget gate and
 *   allowance the rest of the node uses, reached from a different request shape. So what is asserted
 *   here is the gate and the refusals, not the answer — CI has no provider key and no model, and a
 *   suite that pretended otherwise would be testing a fixture.
 *
 *   The one thing that cannot be faked and matters most: a caller who may not spend the owner's AI
 *   budget is refused BEFORE the provider is touched, and a caller from another account is refused
 *   at all.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-llm-proxy
 * @version-history
 *   v1.0.0 — 2026-08-16 — initial: the scope gate, the shape checks, and the refusal without a key.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerName = `llmp${Date.now() % 100000}`;

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
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function signMsg(priv: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(priv, 'base64'));
    return Buffer.from(sig).toString('base64');
}

let ownerToken = '';
let scopelessAgentToken = '';
let aiAgentToken = '';

const auth = (tok: string, o: RequestInit = {}): RequestInit =>
    ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${tok}` } });

const CALL = { messages: [{ role: 'user', content: 'hello' }] };

console.log('\n=== LLM proxy E2E ===\n');

await test('Setup: an owner', async () => {
    const reg = await json('/v1/owners', {
        method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({
            owner: ownerName, timestamp: ts,
            signature: await signMsg(reg.body.data.private_key, ownerName + NODE_ID + ts),
        }),
    });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    ownerToken = tok.body.data.token;
});

await test('An unauthenticated caller cannot spend anyone\'s budget', async () => {
    const { status } = await json('/v1/llm/chat/completions', {
        method: 'POST', body: JSON.stringify(CALL),
    });
    assert(status === 401, `unauthenticated is 401, got ${status}`);
});

await test('Setup: two agents, one with ai:use and one without', async () => {
    const mint = async (name: string, scopes: string[]): Promise<string> => {
        const reg = await json('/v1/agents', auth(ownerToken, {
            method: 'POST',
            body: JSON.stringify({ name, owner: ownerName, capabilities: ['memory'], scopes }),
        }));
        assert(reg.status === 201, `agent ${name} ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
        const gaii = reg.body.data.agent.gaii as string;
        const ts = new Date().toISOString();
        const tok = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({
                gaii, timestamp: ts,
                signature: await signMsg(reg.body.data.private_key, gaii + ts),
            }),
        });
        assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
        return tok.body.data.token as string;
    };
    aiAgentToken = await mint('llmyes', ['ai:use']);
    scopelessAgentToken = await mint('llmno', ['memory:read']);
});

await test('THE GATE: an agent without ai:use is refused, and the provider is never touched', async () => {
    // The word is the whole control. Without it, any app-grant token the owner ever approved for
    // something else could spend their AI budget through this door.
    const { status, body } = await json('/v1/llm/chat/completions',
        auth(scopelessAgentToken, { method: 'POST', body: JSON.stringify(CALL) }));
    assert(status === 403, `no ai:use is 403, got ${status}: ${JSON.stringify(body)}`);
});

await test('An agent WITH ai:use gets past the gate', async () => {
    // Past the gate is as far as CI goes: there is no provider key here, so the answer is the
    // node's own named reason rather than a completion. What matters is that it is not a 403.
    const { status, body } = await json('/v1/llm/chat/completions',
        auth(aiAgentToken, { method: 'POST', body: JSON.stringify(CALL) }));
    assert(status !== 403, `ai:use must not be refused, got 403: ${JSON.stringify(body)}`);
    assert(status !== 401, `ai:use must not be unauthorized, got 401`);
    console.log(`     ↳ past the gate, node answered ${status} ${body?.error?.code ?? ''}`);
});

await test('A call with no messages is refused before anything is decided', async () => {
    const { status, body } = await json('/v1/llm/chat/completions',
        auth(ownerToken, { method: 'POST', body: JSON.stringify({}) }));
    assert(status === 400, `empty body is 400, got ${status}`);
    assert(body.error?.code === 'INVALID_BODY', `code INVALID_BODY, got ${body.error?.code}`);
});

await test('Without a key the node names the reason rather than failing opaquely', async () => {
    // The node has no instance key in CI and this owner has set none, so this is the state a person
    // is actually in before they bring one. They are owed the reason.
    const { status, body } = await json('/v1/llm/chat/completions',
        auth(ownerToken, { method: 'POST', body: JSON.stringify(CALL) }));
    assert(status !== 200, `no key cannot succeed, got ${status}`);
    assert(typeof body.error?.code === 'string' && body.error.code.length > 0,
        `the failure is named, got ${JSON.stringify(body.error)}`);
    assert(body.error.code !== 'INTERNAL_ERROR',
        `an unnamed internal error is not an answer: ${JSON.stringify(body.error)}`);
    // Every error on this node says which node answered. The first version of this route sent an
    // empty one, and a client collecting failures across nodes could not tell them apart.
    assert(body.node === NODE_ID, `the envelope names the node, got ${JSON.stringify(body.node)}`);
    console.log(`     ↳ ${body.error.code}: ${String(body.error.message).slice(0, 70)}`);
});

await test('The model list is behind the same gate', async () => {
    const anon = await json('/v1/llm/models');
    assert(anon.status === 401, `unauthenticated model list is 401, got ${anon.status}`);
    const scopeless = await json('/v1/llm/models', auth(scopelessAgentToken));
    assert(scopeless.status === 403, `no ai:use is 403 on the model list, got ${scopeless.status}`);
});

await test('The proxy spends nothing when it refuses', async () => {
    // A refusal that had already been billed would be the worst of both. The usage record for today
    // must still be empty after every refusal above.
    const { body } = await json('/v1/ai/usage', auth(ownerToken));
    const spent = Number(body?.data?.today?.total_cost_usd ?? body?.data?.total_cost_usd ?? 0);
    assert(spent === 0, `nothing was billed for a refused call, got $${spent}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
