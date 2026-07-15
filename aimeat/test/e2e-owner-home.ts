/**
 * @file e2e-owner-home.ts
 * @description E2E for GET /v1/owner/home — the Phase 3 composite home dashboard. Proves it is
 *   behaviourally the sum of the endpoints it replaces (its `usage` block + stats equal what
 *   /v1/owner/usage returns; its agents/stats equal what /v1/agents returns), that every stats figure
 *   is internally consistent with the usage summary, and that it enforces auth (401 without a token).
 *   The point of the composite is ONE identity resolution shared across the parts — this asserts the
 *   parts still agree.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Initial: composite == usage + agents parity, stats consistency, auth.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=owner-home

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function setupOwner(label: string) {
    const name = `home${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Home', password: 'HomeDash12' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Owner Home Dashboard E2E ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
const authA = () => ({ Authorization: `Bearer ${A.token}` });

await test('Setup: owner + a few memory keys', async () => {
    A = await setupOwner('a');
    for (let i = 0; i < 5; i++) {
        const r = await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `home.item.${i}`, value: { n: i, note: 'row' }, visibility: 'private' }) });
        assert(r.status === 201 || r.status === 200, `write ${i} → ${r.status}`);
    }
});

await test('GET /v1/owner/home returns { stats, usage, agents } with the right shapes', async () => {
    const r = await json('/v1/owner/home', { headers: authA() });
    assert(r.status === 200, `status ${r.status}`);
    const d = r.body.data;
    assert(d && typeof d === 'object', 'data object');
    assert(d.stats && typeof d.stats === 'object', 'stats present');
    assert(d.usage && typeof d.usage === 'object', 'usage present');
    assert(Array.isArray(d.agents), 'agents is an array');
    for (const k of ['agents', 'chatSessions', 'balance', 'memory', 'files', 'services', 'apps', 'work']) {
        assert(typeof d.stats[k] === 'number', `stats.${k} is a number (got ${typeof d.stats[k]})`);
    }
});

await test('Composite == /v1/owner/usage (the usage block + stats match the standalone endpoint)', async () => {
    const home = (await json('/v1/owner/home', { headers: authA() })).body.data;
    const usage = (await json('/v1/owner/usage', { headers: authA() })).body.data;
    // The home.usage block IS the usage summary (same 60s-cached compute).
    assert(home.usage.memory.used_keys === usage.memory.used_keys, `mem keys ${home.usage.memory.used_keys} vs ${usage.memory.used_keys}`);
    assert(home.usage.memory.used_bytes === usage.memory.used_bytes, 'mem bytes parity');
    assert(home.usage.counts.agents === usage.counts.agents, 'agents count parity');
    // The stats bar figures are all projections of that same summary.
    assert(home.stats.memory === usage.memory.used_keys, `stats.memory ${home.stats.memory} == usage.memory.used_keys ${usage.memory.used_keys}`);
    assert(home.stats.files === usage.storage.used_files, 'stats.files == usage.storage.used_files');
    assert(home.stats.services === usage.counts.services.used, 'stats.services == usage.counts.services.used');
    assert(home.stats.apps === usage.counts.apps.used, 'stats.apps == usage.counts.apps.used');
    assert(home.stats.agents === usage.counts.agents, 'stats.agents == usage.counts.agents');
    assert(home.stats.balance === usage.morsels.balance, 'stats.balance == usage.morsels.balance');
    assert(home.stats.memory >= 5, `at least the 5 keys we wrote (got ${home.stats.memory})`);
});

await test('Composite agents == /v1/agents (same owner agent set)', async () => {
    const home = (await json('/v1/owner/home', { headers: authA() })).body.data;
    const agentsResp = await json('/v1/agents', { headers: authA() });
    assert(agentsResp.status === 200, `/v1/agents ${agentsResp.status}`);
    const list = agentsResp.body.data?.agents ?? agentsResp.body.data ?? [];
    const nonSession = (Array.isArray(list) ? list : []).filter((a: any) => !String(a.name || '').startsWith('session-'));
    // stats.agents counts ALL agents; home.agents lists the non-session ones (Agents card).
    assert(home.stats.agents === (Array.isArray(list) ? list.length : 0), `stats.agents ${home.stats.agents} == /v1/agents length ${Array.isArray(list) ? list.length : 0}`);
    assert(home.agents.length === nonSession.length, `home.agents ${home.agents.length} == non-session ${nonSession.length}`);
});

await test('Unauthenticated → 401', async () => {
    const r = await json('/v1/owner/home');
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('Cleanup owner', async () => { await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: authA() }); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
