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
const MEMBER_TOKEN = 'Qwzxymember'; // the same, for the CO-MEMBER's record
let B!: Awaited<ReturnType<typeof setupOwner>>;
const authB = () => ({ Authorization: `Bearer ${B.token}` });
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

await test('A CO-MEMBER writes into the workspace, under their own identity', async () => {
    // The file's own header says the bug was that workspace content is OWNED by the member who wrote
    // it and only KEYED organism.{id}…, so a purge scoped to the deleter's namespace misses it. Every
    // key here was written by the SAME owner who deletes the organism — precisely the case the
    // original bug did NOT affect — so scoping the purge back to `WHERE ownerGaii = the deleter`
    // passes both after-delete assertions while a co-member's records survive and stay findable.
    B = await setupOwner('b');
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: authB(), body: JSON.stringify({}) });
    assert(j.status === 200 || j.status === 201, `join ${j.status}: ${JSON.stringify(j.body?.error)}`);

    const w = await json('/v1/memory', {
        method: 'POST', headers: authB(),
        body: JSON.stringify({ key: `${root()}.shared.notes.n2`, value: { id: 'n2', title: 'Member note', body: `also contains ${MEMBER_TOKEN} inside` }, visibility: 'private' }),
    });
    assert(w.status === 201 || w.status === 200, `member write ${w.status}: ${JSON.stringify(w.body?.error)}`);

    const r = await json(`/v1/librarian/search?q=${MEMBER_TOKEN}&scope=own`, { headers: authB() });
    assert((r.body.data.hits || []).some((h: any) => h.organismId === orgId),
        `the member's record is indexed before the delete: ${JSON.stringify((r.body.data.hits || []).map((h: any) => h.key))}`);
});

await test('Deleting an organism is the CREATOR\'s act — a member cannot do it', async () => {
    // The organism is only ever deleted by its creator here, so removing the
    // `organism.creatorGhii !== ghii` check from routes/organisms/crud.ts leaves the suite green
    // while any authenticated principal destroys any organism on the node, together with everything
    // keyed under it. A joined member is the sharpest case: they are inside, and still not the owner.
    const r = await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: authB() });
    assert(r.status === 403 || r.status === 404, `a member deleted the organism: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const still = await json(`/v1/organisms/${orgId}`, { headers: auth() });
    assert(still.status === 200, `the refused delete removed it anyway: ${still.status}`);
});

await test('Delete the organism', async () => {
    const r = await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: auth() });
    assert(r.status === 200, `delete ${r.status}`);
});

await test('After delete: the CO-MEMBER\'s record is gone too, and unfindable', async () => {
    const r = await json(`/v1/librarian/search?q=${MEMBER_TOKEN}&scope=own`, { headers: authB() });
    assert(r.status === 200, `member search ${r.status}`);
    const hits = (r.body.data.hits || []).filter((h: any) => h.organismId === orgId);
    assert(hits.length === 0, `the member's record survived the delete: ${JSON.stringify(hits.slice(0, 2))}`);

    const m = await json(`/v1/memory?prefix=${encodeURIComponent(`organism.${orgId}.`)}`, { headers: authB() });
    const remaining = (m.body.data.items || []).filter((i: any) => i.key.startsWith(`organism.${orgId}.`));
    assert(remaining.length === 0, `the member still holds org keys: ${JSON.stringify(remaining.map((i: any) => i.key))}`);
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
