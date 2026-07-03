/**
 * @file e2e-organism-workspace-engagements.ts
 * @description E2E for first-class contract engagements — the (agent × contract × workspace) binding
 *   with an active/retired lifecycle that lets an owner ADOPT and RETIRE a contract (a real off-switch,
 *   distinct from the derived "active here" trace). Covers: activate → list (by ws + by agent) →
 *   retire → history, the legacy "retire with no prior active" path, and the ownership/authority
 *   failure modes (activate an agent you don't own; retire as a non-owner non-manager).
 * @version-history
 *   v1.0.0 — 2026-07-03 — Initial: engagement activate/retire lifecycle + authority checks.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-workspace-engagements

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
    const name = `wseng${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'WS Eng', password: 'WsEng1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Organism Workspace Engagements E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;
let B: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
let agentName = '';
let agentGaii = '';
const WS = 'ws-eng1';
const root = () => `organism.${orgId}.w.${WS}`;
const engUrl = () => `/v1/organisms/${orgId}/workspace/engagements`;

await test('Setup owners A (creator) + B (other member)', async () => { A = await setupOwner('a'); B = await setupOwner('b'); });

await test('A registers a contract agent + advertises contracts (tags)', async () => {
    agentName = `researcher${Date.now()}`;
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: agentName, owner: A.name, capabilities: ['social'], model: 'gpt-4o' }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
    agentGaii = ag.body.data.agent.gaii;
    const tg = await json(`/v1/agents/${agentName}/tags`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ tags: ['workspace-contract', 'contract.research', 'contract.market-scan'] }) });
    assert(tg.status === 200, `tags ${tg.status}: ${JSON.stringify(tg.body.error)}`);
});

await test('A creates an OPEN organism + a workspace (A is creator)', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Engage Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Coordination', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
});

await test('B joins the organism', async () => {
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(j.status === 200 || j.status === 201, `join ${j.status}`);
});

await test('0. no engagements yet', async () => {
    const r = await json(`${engUrl()}?ws=${WS}`, { headers: auth(A.token) });
    assert(r.status === 200, `list ${r.status}`);
    assert(Array.isArray(r.body.data.engagements) && r.body.data.engagements.length === 0, 'empty at start');
});

await test('1. A ADOPTS (activates) the research contract for its agent', async () => {
    const r = await json(engUrl(), { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, agent: agentGaii, contract: 'research' }) });
    assert(r.status === 200, `activate ${r.status}: ${JSON.stringify(r.body.error)}`);
    const e = r.body.data.engagement;
    assert(e.state === 'active', `state ${e.state}`);
    assert(e.contract === 'research' && e.agentName === agentName && e.owner === A.name, 'engagement fields');
    assert(!!e.adoptedAt && e.retiredAt === null, 'adoptedAt set, retiredAt null');
});

await test('2. list-by-workspace shows the active engagement', async () => {
    const r = await json(`${engUrl()}?ws=${WS}`, { headers: auth(A.token) });
    const e = (r.body.data.engagements || []).find((x: any) => x.contract === 'research');
    assert(e && e.state === 'active', 'active research engagement listed');
});

await test('3. list-by-agent (A) shows it, enriched with org + ws names', async () => {
    const r = await json(`/v1/agents/${agentName}/engagements`, { headers: auth(A.token) });
    assert(r.status === 200, `by-agent ${r.status}`);
    const e = (r.body.data.engagements || []).find((x: any) => x.ws === WS && x.contract === 'research');
    assert(e && e.state === 'active', 'active engagement in by-agent list');
    assert(e.organismName === 'Engage Org' && e.wsName === 'Coordination', `names enriched: ${e.organismName} / ${e.wsName}`);
});

await test('4. FAIL: B cannot adopt an agent it does not own (403)', async () => {
    const r = await json(engUrl(), { method: 'POST', headers: auth(B.token), body: JSON.stringify({ ws: WS, agent: agentGaii, contract: 'research' }) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('5. FAIL: B (member, not creator, not agent owner) cannot retire it (403)', async () => {
    const r = await json(`${engUrl()}/retire`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ ws: WS, agent: agentGaii, contract: 'research' }) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('6. A RETIRES the research contract (real off-switch)', async () => {
    const r = await json(`${engUrl()}/retire`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, agent: agentGaii, contract: 'research' }) });
    assert(r.status === 200, `retire ${r.status}: ${JSON.stringify(r.body.error)}`);
    const e = r.body.data.engagement;
    assert(e.state === 'retired' && !!e.retiredAt && e.retiredBy === A.name, 'retired with stamp');
    assert(!!e.adoptedAt, 'adoptedAt preserved from the active record');
});

await test('7. list shows research retired (kept as history)', async () => {
    const r = await json(`${engUrl()}?ws=${WS}`, { headers: auth(A.token) });
    const e = (r.body.data.engagements || []).find((x: any) => x.contract === 'research');
    assert(e && e.state === 'retired', 'research now retired in the roster');
});

await test('8. legacy path: retire a contract that was NEVER adopted still writes a retired marker', async () => {
    const r = await json(`${engUrl()}/retire`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, agent: agentGaii, contract: 'market-scan' }) });
    assert(r.status === 200, `retire ${r.status}`);
    assert(r.body.data.engagement.state === 'retired', 'market-scan retired');
    const l = await json(`${engUrl()}?ws=${WS}`, { headers: auth(A.token) });
    assert((l.body.data.engagements || []).length === 2, 'two engagement records now (research + market-scan)');
});

await test('9. re-adopt flips research back to active + preserves original adoptedAt', async () => {
    const before = await json(`${engUrl()}?ws=${WS}`, { headers: auth(A.token) });
    const prev = (before.body.data.engagements || []).find((x: any) => x.contract === 'research');
    const r = await json(engUrl(), { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, agent: agentGaii, contract: 'research' }) });
    assert(r.status === 200 && r.body.data.engagement.state === 'active', 'back to active');
    assert(r.body.data.engagement.adoptedAt === prev.adoptedAt, 'adoptedAt unchanged on re-adopt');
    assert(r.body.data.engagement.retiredAt === null, 'retiredAt cleared');
});

await test('Cleanup A + B', async () => {
    await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: auth(A.token) });
    await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: auth(B.token) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
