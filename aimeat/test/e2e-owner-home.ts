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
 *   v1.1.0 — 2026-11-15 — Audit M094, L102: a second owner's app and file stay off A's dashboard;
 *     chatSessions and work count a real session agent and a real pending work item.
 *   v1.2.0 — 2026-11-15 — A's agent without wallet:read is refused 403 SCOPE_DENIED; one with it reads.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=owner-home

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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

import { ownerSignIn } from './helpers/owner-login.js';
import { connectAgentByDevice } from './helpers/agent-device.js';
async function setupOwner(label: string) {
    const name = `home${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Home', password: 'HomeDash12' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, 'HomeDash12');
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Owner Home Dashboard E2E ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
const authA = () => ({ Authorization: `Bearer ${A.token}` });
const authB = () => ({ Authorization: `Bearer ${B.token}` });

await test('Setup: owner + a few memory keys', async () => {
    A = await setupOwner('a');
    for (let i = 0; i < 5; i++) {
        const r = await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `home.item.${i}`, value: { n: i, note: 'row' }, visibility: 'private' }) });
        assert(r.status === 201 || r.status === 200, `write ${i} → ${r.status}`);
    }
});

// Before A's usage is first computed (it is cached 60s): a second owner holds an app and a file, so a
// count that lost its per-owner filter shows on A's dashboard. A gets a chat session agent and one
// pending work item, so stats.chatSessions and stats.work have something to count.
await test('Setup: owner B publishes an app and stores a file; A gets a chat session and pending work', async () => {
    B = await setupOwner('b');
    const html = '<!DOCTYPE html><html><head><title>B app</title></head><body>B</body></html>';
    const app = await json('/v1/apps', { method: 'POST', headers: authB(), body: JSON.stringify({ filename: 'home-b.html', mime_type: 'text/html', content: Buffer.from(html).toString('base64'), name: 'B app', description: 'Owned by B.' }) });
    assert(app.status === 200 || app.status === 201, `B app ${app.status}: ${JSON.stringify(app.body?.error)}`);
    const file = await json('/v1/storage', { method: 'POST', headers: authB(), body: JSON.stringify({ key: 'home/b.txt', visibility: 'private', mime_type: 'text/plain', data: Buffer.from('B bytes').toString('base64') }) });
    assert(file.status === 200 || file.status === 201, `B file ${file.status}: ${JSON.stringify(file.body?.error)}`);
    const session = await json('/v1/agents', { method: 'POST', headers: authA(), body: JSON.stringify({ name: `session-home${Date.now() % 100000}`, owner: A.name, capabilities: ['memory'] }) });
    assert(session.status === 201, `session agent ${session.status}: ${JSON.stringify(session.body?.error)}`);
    const action = `home-probe-${Date.now()}`;
    const pub = await json('/v1/actions', { method: 'POST', headers: authA(), body: JSON.stringify({ id: action, display_name: 'Home probe', description: 'A work item for the home count', input_schema: { type: 'object' }, output_schema: { type: 'object' }, pricing: { toll_morsels: 0 } }) });
    assert(pub.status === 201, `action ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const work = await json('/v1/work', { method: 'POST', headers: authB(), body: JSON.stringify({ action_id: action, provider_gaii: pub.body.data.provider_gaii, input: {}, ttl_hours: 24 }) });
    assert(work.status === 201 && work.body.data?.status === 'pending', `work ${work.status}: ${JSON.stringify(work.body?.error ?? work.body?.data)}`);
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

await test('Owner B\'s app and file are not counted on A\'s dashboard (audit M094)', async () => {
    // Both sides of the parity above read one function; only a second owner's data can show that it
    // counts this owner's rows and nobody else's. A published no app and stored no file.
    const home = (await json('/v1/owner/home', { headers: authA() })).body.data;
    assert(home.stats.apps === 0 && home.usage.counts.apps.used === 0, `A has no apps, got stats.apps ${home.stats.apps}`);
    assert(home.stats.files === 0 && home.usage.storage.used_files === 0, `A has no files, got stats.files ${home.stats.files}`);
    const homeB = (await json('/v1/owner/home', { headers: authB() })).body.data;
    // Positive control: B's own rows are counted for B (the app publish may store a file of its own).
    assert(homeB.stats.apps === 1 && homeB.stats.files >= 1, `B's own app and file are counted for B: apps ${homeB.stats.apps}, files ${homeB.stats.files}`);
});

await test('stats.chatSessions counts A\'s session agent (audit L102)', async () => {
    const home = (await json('/v1/owner/home', { headers: authA() })).body.data;
    assert(home.stats.chatSessions === 1, `one session agent, got chatSessions ${home.stats.chatSessions}`);
});

await test('stats.work counts the pending work item on A\'s action (audit L102)', async () => {
    const home = (await json('/v1/owner/home', { headers: authA() })).body.data;
    assert(home.stats.work === 1, `one pending work item, got work ${home.stats.work}`);
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

await test('An agent of A without wallet:read is refused 403 SCOPE_DENIED; one with it reads A\'s figures', async () => {
    // The dashboard carries A's balance and counts, and an agent resolves to A like A does, so the
    // scope check is the only thing that keeps a memory-only agent off it.
    const reader = await connectAgentByDevice(BASE, { owner: A.name, ownerToken: A.token, name: 'homereader', scopes: ['memory:read'] });
    const r = await json('/v1/owner/home', { headers: { Authorization: `Bearer ${reader.token}` } });
    assert(r.status === 403 && r.body?.error?.code === 'SCOPE_DENIED', `expected 403 SCOPE_DENIED, got ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(r.body?.data === undefined, `the refusal carried dashboard data: ${JSON.stringify(r.body?.data ?? null).slice(0, 200)}`);
    // Positive control: the same route answers an agent that holds the scope, with A's own figures.
    const wallet = await connectAgentByDevice(BASE, { owner: A.name, ownerToken: A.token, name: 'homewallet', scopes: ['wallet:read'] });
    const ok = await json('/v1/owner/home', { headers: { Authorization: `Bearer ${wallet.token}` } });
    assert(ok.status === 200 && ok.body.data.stats.memory >= 5, `wallet:read agent: ${ok.status}, memory ${ok.body?.data?.stats?.memory}`);
});

await test('Unauthenticated → 401', async () => {
    const r = await json('/v1/owner/home');
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('Cleanup owners', async () => {
    await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: authA() });
    if (B) await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: authB() });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
