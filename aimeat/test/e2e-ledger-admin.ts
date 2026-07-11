/**
 * @file e2e-ledger-admin.ts
 * @description E2E for the operator-only cross-user agent ledger aggregate:
 *   GET /v1/admin/ledger (LEDGER / TARGET-016). Registers two owner+agent pairs (the first owner
 *   on this suite's fresh node is the operator), seeds priced llm_call telemetry for both, then
 *   asserts the operator sees a node-wide aggregate spanning BOTH owners (totals, per_user top
 *   spenders, per_agent, per_model) and that a non-operator owner is refused (403). Mirrors the
 *   AI-usage admin test (e2e-ai-usage-history.ts) for the ledger side.
 * @version-history
 *   v1.0.0 -- 2026-07-11 -- Initial creation for the operator ledger dashboard.
 */

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

function approx(actual: number, expected: number, msg: string, eps = 0.0001) {
    assert(Math.abs(actual - expected) < eps, `${msg}: expected ~${expected}, got ${actual}`);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        if (res.status === 429 && attempt < retries) {
            const retryAfter = Number(res.headers.get('Retry-After') || '5');
            await sleep(retryAfter * 1000 + 500);
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

async function registerOwnerAndAgent(prefix: string): Promise<{
    ownerName: string; ownerToken: string; agentName: string; agentGaii: string;
}> {
    const ownerName = `${prefix}${Date.now()}${Math.floor(performance.now())}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register owner: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ownerToken = await getToken(ownerName, reg.body.data.private_key, false);

    const agentName = 'ledgerbot';
    const ar = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'] }),
    });
    assert(ar.status === 201, `register agent: ${ar.status} ${JSON.stringify(ar.body)}`);
    return { ownerName, ownerToken, agentName, agentGaii: ar.body.data.agent.gaii };
}

async function reportLlmCall(ownerToken: string, agentName: string, data: Record<string, unknown>) {
    return json(`/v1/agents/${agentName}/telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ type: 'llm_call', data }),
    });
}

console.log('\n=== AIMEAT LEDGER ADMIN (operator cross-user) E2E ===\n');

console.log('Setup -- operator + non-operator owners (each with an agent)');
// The FIRST owner registered on this suite's fresh node becomes the node operator.
const op = await registerOwnerAndAgent('ledgeropadmin');
const user = await registerOwnerAndAgent('ledgeruseradmin');

// Seed priced usage for BOTH owners so the cross-user aggregate spans them.
await reportLlmCall(op.ownerToken, op.agentName, {
    model: 'claude-opus-4', provider: 'openrouter',
    prompt_tokens: 2000, completion_tokens: 800, cost_usd: 0.05, run_id: 'op-run-1',
});
await reportLlmCall(user.ownerToken, user.agentName, {
    model: 'claude-sonnet-4-6', provider: 'openrouter',
    prompt_tokens: 1000, completion_tokens: 400, cost_usd: 0.01, run_id: 'user-run-1',
});

console.log('\nOperator cross-user aggregate');

await test('1. GET /v1/admin/ledger (operator) spans BOTH owners', async () => {
    const { status, body } = await json('/v1/admin/ledger', { headers: { Authorization: `Bearer ${op.ownerToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const d = body.data;
    approx(d.totals.cost_usd, 0.06, 'grand total cost (op 0.05 + user 0.01)');
    assert(Array.isArray(d.per_user) && d.per_user.length >= 2, `>=2 users, got ${d.per_user?.length}`);
    assert(d.per_user[0].cost_usd >= d.per_user[1].cost_usd, 'per_user sorted by cost desc');
    assert(d.per_user[0].owner_ghii === `${op.ownerName}@${NODE_ID}`, `top spender is the operator, got ${d.per_user[0].owner_ghii}`);
    const owners = d.per_user.map((u: any) => u.owner_ghii);
    assert(owners.includes(`${user.ownerName}@${NODE_ID}`), 'non-operator owner present in per_user');
});

await test('2. per_agent + per_model span both owners', async () => {
    const { body } = await json('/v1/admin/ledger', { headers: { Authorization: `Bearer ${op.ownerToken}` } });
    const d = body.data;
    const agents = d.per_agent.map((x: any) => x.agent_gaii);
    assert(agents.includes(op.agentGaii) && agents.includes(user.agentGaii), 'per_agent has both agents');
    const models = d.per_model.map((x: any) => x.model);
    assert(models.includes('claude-opus-4') && models.includes('claude-sonnet-4-6'), 'per_model has both models');
    assert(Array.isArray(d.days) && d.days.length >= 1, 'days series present');
});

await test('3. non-operator owner -> 403', async () => {
    const { status } = await json('/v1/admin/ledger', { headers: { Authorization: `Bearer ${user.ownerToken}` } });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('4. no auth -> 401', async () => {
    const { status } = await json('/v1/admin/ledger');
    assert(status === 401, `expected 401, got ${status}`);
});

await test('5. narrow future range excludes today (empty totals)', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const { status, body } = await json(`/v1/admin/ledger?from=${future}&to=${future}`, {
        headers: { Authorization: `Bearer ${op.ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    approx(body.data.totals.cost_usd, 0, 'future range has no spend');
});

console.log(`\n=== Ledger Admin E2E: ${passed} passed, ${failed} failed (${passed + failed} total) ===\n`);
if (failed > 0) process.exit(1);
