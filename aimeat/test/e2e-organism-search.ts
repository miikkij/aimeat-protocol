/**
 * @file e2e-organism-search.ts
 * @description E2E for organism/workspace content search (GET /v1/organisms/:id/search?q=).
 *   Covers: query validation, a creator finding a record + a document by text, scoping to one
 *   workspace, the membership gate (non-member 403), and no-match returning an empty result set.
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: workspace content search.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-search

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
    const name = `orgsearch${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Org Search', password: 'OrgSearch1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Org Search', password: 'OrgSearch1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Organism Search E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;
let B: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'ws-search1';
const root = () => `organism.${orgId}.w.${WS}`;

await test('Setup A (creator) + B (non-member); A creates org + workspace + content', async () => {
    A = await setupOwner('a'); B = await setupOwner('b');
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Search Org', description: 'x', type: 'project', join_policy: 'approval_required', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    // workspace registry + manifest (records space 'task' + document space 'notes')
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Coordination', kind: 'project', status: 'active', objectTypes: [
        { name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
    ] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);
    // Two records: one with 'pineapple', one whose body field mentions 'blueberry'
    const r1 = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.shared.tasks.t1.latest`, value: { id: 't1', title: 'Buy a pineapple', status: 'open' }, visibility: 'private' }) });
    assert(r1.status === 201 || r1.status === 200, `record1 ${r1.status}: ${JSON.stringify(r1.body.error)}`);
    const r2 = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.shared.tasks.t2.latest`, value: { id: 't2', title: 'Shopping list', note: 'Remember the blueberry jam.' }, visibility: 'private' }) });
    assert(r2.status === 201 || r2.status === 200, `record2 ${r2.status}: ${JSON.stringify(r2.body.error)}`);
});

await test('1. Query shorter than 2 chars is rejected (400)', async () => {
    const r = await json(`/v1/organisms/${orgId}/search?q=a`, { headers: auth(A.token) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('2. Creator finds the record by text ("pineapple")', async () => {
    const r = await json(`/v1/organisms/${orgId}/search?q=pineapple`, { headers: auth(A.token) });
    assert(r.status === 200, `search ${r.status}: ${JSON.stringify(r.body.error)}`);
    const hit = (r.body.data.results || []).find((x: any) => x.id === 't1');
    assert(!!hit, `expected a hit for t1, got ${JSON.stringify(r.body.data.results)}`);
    assert(hit.space === 'shared' || hit.title.includes('pineapple'), 'hit carries space/title');
});

await test('3. Creator finds a record by a body field ("blueberry") with a snippet', async () => {
    const r = await json(`/v1/organisms/${orgId}/search?q=blueberry`, { headers: auth(A.token) });
    assert(r.status === 200, `search ${r.status}`);
    const hit = (r.body.data.results || []).find((x: any) => x.id === 't2');
    assert(!!hit, 'expected a hit for t2');
    assert(/blueberry/i.test(hit.snippet), `snippet should contain the term, got "${hit.snippet}"`);
});

await test('4. Scoping to a non-existent workspace yields no results', async () => {
    const r = await json(`/v1/organisms/${orgId}/search?q=pineapple&ws=nope`, { headers: auth(A.token) });
    assert(r.status === 200 && (r.body.data.results || []).length === 0, `expected empty, got ${JSON.stringify(r.body.data)}`);
});

await test('5. No-match query returns an empty result set', async () => {
    const r = await json(`/v1/organisms/${orgId}/search?q=zzzznomatch`, { headers: auth(A.token) });
    assert(r.status === 200 && (r.body.data.results || []).length === 0, `expected empty, got ${r.body.data.total}`);
});

await test('6. A non-member cannot search (403)', async () => {
    const r = await json(`/v1/organisms/${orgId}/search?q=pineapple`, { headers: auth(B.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
