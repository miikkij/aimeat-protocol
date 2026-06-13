/**
 * @file e2e-workspace-revert.ts
 * @description Tests "reopen a published record for editing": POST /v1/organisms/:id/revert copies a
 *   record's .latest back into .draft (the published .latest stays live), so the normal edit → publish
 *   flow applies. Covers the happy path (publish → revert → draft restored → edit → republish bumps the
 *   version) and the failure modes (409 when a draft already exists, 404 when nothing is published,
 *   403 for a non-member).
 * @version-history
 *   v1.0.0 — 2026-06-13 — Initial: revert-to-draft (feature-mqaos6v2).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-revert

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
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(p: string, m: string) { return Buffer.from(await ed.signAsync(new TextEncoder().encode(m), Buffer.from(p, 'base64'))).toString('base64'); }
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Workspace Revert-to-Draft E2E ===\n');
let token = '', ownerName = '', orgId = '';
const WS = 'ws-rev1', NS = 'shared.tasks', root = () => `organism.${orgId}.w.${WS}`;

// Read the key set under a record's base prefix → which roles (draft/latest/version.N) exist.
async function rolesOf(instance: string): Promise<Set<string>> {
    const base = `${root()}.${NS}.${instance}`;
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(base + '.')}&limit=200`, { headers: auth(token) });
    const items = (r.body?.data?.items ?? []) as Array<{ key: string }>;
    return new Set(items.map(it => it.key.slice(base.length + 1)));
}

await test('Setup: owner + org + workspace + a published record (t1 v1)', async () => {
    ownerName = 'revtest' + Date.now();
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Rev', password: 'Rev12345' }) });
    assert(reg.status === 201, `register: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await sign(reg.body.data.private_key, ownerName + NODE_ID + ts) }) });
    token = tk.body.data.token;
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Rev Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    orgId = o.body.data.organism.id;
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Rev', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    // Write a draft and publish it → draft consumed, .latest + .version.1 created.
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${root()}.${NS}.t1.draft`, value: { id: 't1', title: 'First' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(token), body: JSON.stringify({ ws: WS, namespace: NS, id: 't1' }) });
    assert(pub.status === 200 && pub.body.data.version === 1, `publish v1: ${pub.status} ${JSON.stringify(pub.body)}`);
    const roles = await rolesOf('t1');
    assert(roles.has('latest') && roles.has('version.1') && !roles.has('draft'), `after publish: latest+version.1, no draft (got ${[...roles]})`);
});

await test('1. revert reopens the published record: .draft restored, .latest kept', async () => {
    const r = await json(`/v1/organisms/${orgId}/revert`, { method: 'POST', headers: auth(token), body: JSON.stringify({ ws: WS, namespace: NS, id: 't1' }) });
    assert(r.status === 200 && r.body.data?.reopened === true, `revert: ${r.status} ${JSON.stringify(r.body)}`);
    const roles = await rolesOf('t1');
    assert(roles.has('draft'), `draft restored (got ${[...roles]})`);
    assert(roles.has('latest') && roles.has('version.1'), `published version still live (got ${[...roles]})`);
});

await test('2. the restored draft holds the published content', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(`${root()}.${NS}.t1.draft`)}`, { headers: auth(token) });
    assert(r.status === 200 && r.body.data?.value?.title === 'First', `draft value = published value: ${JSON.stringify(r.body?.data?.value)}`);
});

await test('3. revert again is refused (409) while a draft exists', async () => {
    const r = await json(`/v1/organisms/${orgId}/revert`, { method: 'POST', headers: auth(token), body: JSON.stringify({ ws: WS, namespace: NS, id: 't1' }) });
    assert(r.status === 409, `expected 409 DRAFT_EXISTS, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('4. editing the reopened draft + republish bumps to v2', async () => {
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${root()}.${NS}.t1.draft`, value: { id: 't1', title: 'First (edited)' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(token), body: JSON.stringify({ ws: WS, namespace: NS, id: 't1' }) });
    assert(pub.status === 200 && pub.body.data.version === 2, `republish v2: ${pub.status} ${JSON.stringify(pub.body)}`);
    const latest = await json(`/v1/memory/${encodeURIComponent(`${root()}.${NS}.t1.latest`)}`, { headers: auth(token) });
    assert(latest.body.data?.value?.title === 'First (edited)', `latest reflects the edit: ${JSON.stringify(latest.body?.data?.value)}`);
});

await test('5. revert with nothing published → 404', async () => {
    const r = await json(`/v1/organisms/${orgId}/revert`, { method: 'POST', headers: auth(token), body: JSON.stringify({ ws: WS, namespace: NS, id: 'does-not-exist' }) });
    assert(r.status === 404, `expected 404 NO_LATEST, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('6. a non-member cannot revert (403)', async () => {
    const other = ownerName + 'x';
    const reg2 = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: other, display_name: 'X', password: 'Rev12345' }) });
    const ts = new Date().toISOString();
    const tk2 = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: other, timestamp: ts, signature: await sign(reg2.body.data.private_key, other + NODE_ID + ts) }) });
    // First republish a draft so a fresh draft does not block — but a non-member is gated before that anyway.
    const r = await json(`/v1/organisms/${orgId}/revert`, { method: 'POST', headers: auth(tk2.body.data.token), body: JSON.stringify({ ws: WS, namespace: NS, id: 't1' }) });
    assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    await json(`/v1/owners/${other}`, { method: 'DELETE', headers: auth(tk2.body.data.token) });
});

await test('Cleanup', async () => { await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: auth(token) }); });

console.log(`\n=== Workspace Revert: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
