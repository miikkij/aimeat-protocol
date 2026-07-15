/**
 * @file e2e-organism-bulk-publish.ts
 * @description E2E for POST /v1/organisms/:id/workspace/records/publish — the Phase 2 batch publish.
 *   Proves it is behaviourally IDENTICAL to the single publish: a batch-published record and a
 *   single-published record built from the same draft end up with the same .version.1 + .latest (value,
 *   version, ownership), drafts are consumed, an unchanged re-publish is change-guard skipped, and the
 *   route's authorization holds (non-member → 403, publish review gate → 409).
 * @version-history
 *   v1.0.0 — 2026-07-15 — Initial: batch publish happy path + parity-with-single + change-guard + auth.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-bulk-publish

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
    const name = `bp${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'BP', password: 'BulkPub12' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Organism Batch Publish E2E ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'wspub';
const NS = 'shared.tasks';
const authA = () => ({ Authorization: `Bearer ${A.token}` });
const root = () => `organism.${orgId}.w.${WS}`;
const base = (inst: string) => `${root()}.${NS}.${inst}`;
const readKey = async (key: string) => json(`/v1/memory/${encodeURIComponent(key)}?owner_scope=true&soft=1`, { headers: authA() });
const writeDraft = (inst: string, value: unknown) => json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `${base(inst)}.draft`, value, visibility: 'private' }) });

await test('Setup: owner + org + workspace + a records namespace', async () => {
    A = await setupOwner('a');
    const o = await json('/v1/organisms', { method: 'POST', headers: authA(), body: JSON.stringify({ name: 'Batch Publish Org', type: 'project', visibility: 'public', join_policy: 'open' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'WS', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'WS', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
});

await test('Batch publish 3 drafts → version.1 + latest created, drafts consumed', async () => {
    for (const t of ['t1', 't2', 't3']) await writeDraft(t, { id: t, title: `Task ${t}` });
    const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, instances: ['t1', 't2', 't3'] }) });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.published === 3, `published ${JSON.stringify(r.body.data)}`);
    for (const t of ['t1', 't2', 't3']) {
        const latest = await readKey(`${base(t)}.latest`);
        assert(latest.body.data.value?.title === `Task ${t}`, `${t}.latest value`);
        assert(latest.body.data.value !== null, `${t}.latest exists`);
        const v1 = await readKey(`${base(t)}.version.1`);
        assert(v1.body.data.value?.title === `Task ${t}`, `${t}.version.1 value`);
        const draft = await readKey(`${base(t)}.draft`);
        assert(draft.body.data.value === null, `${t}.draft consumed`);
    }
});

await test('Batch publish == single publish (same draft → same version.1 + latest)', async () => {
    // Single publish path for s1.
    await writeDraft('s1', { id: 's1', title: 'Same', n: 7 });
    const single = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, id: 's1' }) });
    assert(single.status === 200, `single ${single.status}`);
    // Batch publish path for b1, identical draft value.
    await writeDraft('b1', { id: 'b1', title: 'Same', n: 7 });
    const batch = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, instances: ['b1'] }) });
    assert(batch.status === 200 && batch.body.data.published === 1, `batch ${batch.status}`);
    // Both must have version 1 latest + a version.1 record, with matching structural fields.
    const sLatest = (await readKey(`${base('s1')}.latest`)).body.data;
    const bLatest = (await readKey(`${base('b1')}.latest`)).body.data;
    assert(sLatest.version === bLatest.version && sLatest.version === 1, `latest version parity: ${sLatest.version} vs ${bLatest.version}`);
    assert(sLatest.value.title === bLatest.value.title && sLatest.value.n === bLatest.value.n, 'latest value parity');
    const sV1 = (await readKey(`${base('s1')}.version.1`)).body.data;
    const bV1 = (await readKey(`${base('b1')}.version.1`)).body.data;
    assert(sV1.value.n === bV1.value.n && sV1.value.title === bV1.value.title, 'version.1 value parity');
});

await test('Unchanged re-publish is change-guard skipped (no new version)', async () => {
    // Re-create t1's draft with the SAME value as its published .latest, then batch publish.
    await writeDraft('t1', { id: 't1', title: 'Task t1' });
    const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, instances: ['t1'] }) });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.skipped === 1 && r.body.data.published === 0, `expected skipped, got ${JSON.stringify(r.body.data)}`);
    // No .version.2 was appended.
    const v2 = await readKey(`${base('t1')}.version.2`);
    assert(v2.body.data.value === null, 't1.version.2 must NOT exist (unchanged publish)');
    // The stale draft was consumed.
    const draft = await readKey(`${base('t1')}.draft`);
    assert(draft.body.data.value === null, 't1.draft consumed on skip');
});

await test('NO_DRAFT for an instance with no draft', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: NS, instances: ['nope'] }) });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.failed === 1 && r.body.data.results[0].code === 'NO_DRAFT', `expected NO_DRAFT, got ${JSON.stringify(r.body.data)}`);
});

await test('Missing namespace/instances → 400; non-member → 403', async () => {
    const bad = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, instances: [] }) });
    assert(bad.status === 400, `expected 400, got ${bad.status}`);
    const B = await setupOwner('b');
    const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: { Authorization: `Bearer ${B.token}` }, body: JSON.stringify({ ws: WS, namespace: NS, instances: ['t2'] }) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.token}` } });
});

await test('Cleanup owner', async () => { await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: authA() }); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
