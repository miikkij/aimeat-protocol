/**
 * @file e2e-organism-delete-cascade.ts
 * @description Regression test: deleting an organism must purge ALL of its content from the key
 *   namespace (workspace records/documents/meta), so it no longer surfaces in search. The bug:
 *   deleteOrganism deleted memory WHERE ownerGaii = memoryNamespace, but workspace content is OWNED
 *   by the member who wrote it (creator GHII) and only KEYED `organism.{id}.…`, so it was orphaned
 *   and stayed findable via the (indexed) librarian/$text search. Now it deletes by key prefix.
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial: organism delete purges workspace content from memory + search.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-delete-cascade

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
    const name = `del${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Del', password: 'Del12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Organism Delete → Search Cascade E2E Test ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'wsdel';
const TOKEN = 'Qwzxytoken';   // unique needle that only lives in this organism's content
const auth = () => ({ Authorization: `Bearer ${A.token}` });
const root = () => `organism.${orgId}.w.${WS}`;

await test('Setup owner + organism + workspace + a record carrying a unique token', async () => {
    A = await setupOwner('a');
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Delete Cascade Org', type: 'project', visibility: 'public', join_policy: 'open' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'WS', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'WS', kind: 'project', status: 'active', objectTypes: [{ name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.shared.notes.n1`, value: { id: 'n1', title: 'Secret note', body: `contains ${TOKEN} inside` }, visibility: 'private' }) });
});

await test('Before delete: librarian search finds the token in this organism', async () => {
    const r = await json(`/v1/librarian/search?q=${TOKEN}&scope=own`, { headers: auth() });
    assert(r.status === 200, `search ${r.status}`);
    const hits = (r.body.data.hits || []).filter((h: any) => h.organismId === orgId);
    assert(hits.length >= 1, `expected a hit in the org before delete, got ${hits.length}`);
});

await test('Before delete: the workspace content key exists', async () => {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.shared.notes`)}`, { headers: auth() });
    assert((r.body.data.items || []).some((i: any) => i.key === `${root()}.shared.notes.n1`), 'note key present');
});

await test('Delete the organism', async () => {
    const r = await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: auth() });
    assert(r.status === 200, `delete ${r.status}`);
});

await test('After delete: librarian search no longer finds the token (search index purged)', async () => {
    const r = await json(`/v1/librarian/search?q=${TOKEN}&scope=own`, { headers: auth() });
    assert(r.status === 200, `search ${r.status}`);
    const hits = (r.body.data.hits || []).filter((h: any) => h.organismId === orgId);
    assert(hits.length === 0, `expected NO hits after delete, got ${hits.length}: ${JSON.stringify(hits.slice(0, 2))}`);
});

await test('After delete: the workspace content keys are gone from memory', async () => {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`organism.${orgId}.`)}`, { headers: auth() });
    const remaining = (r.body.data.items || []).filter((i: any) => i.key.startsWith(`organism.${orgId}.`));
    assert(remaining.length === 0, `expected no remaining org keys, got ${remaining.length}`);
});

await test('Cleanup owner', async () => { const r = await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: auth() }); assert(r.status === 200, `del ${r.status}`); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
