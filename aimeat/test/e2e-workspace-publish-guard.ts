/**
 * @file e2e-workspace-publish-guard.ts
 * @description E2E for the workspace publish change-guard (A1) + the `versioned` objectType flag (A2),
 *   both on the REST POST /v1/organisms/:id/publish path:
 *   - Happy path: a genuine draft edit → publish still appends a new .version.N (history preserved).
 *   - A1: re-publishing a draft byte-identical to the live .latest is a NO-OP — the response reports
 *     `skipped:true`, no new .version.N is written, and the stale draft is consumed.
 *   - A2: a space declared `versioned:false` (e.g. a request queue) keeps only .latest — publishing it
 *     (even with real changes) never writes a .version.N.
 * @version-history
 *   v1.0.0 — 2026-07-01 — Initial: change-guard + versioned-flag coverage (Lanka A).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-publish-guard

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, ct };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function setupOwner(label: string) {
    const name = `pg${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Pub', password: 'Pub12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Workspace Publish Change-Guard + versioned Flag E2E Test ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'wspub';
const root = () => `organism.${orgId}.w.${WS}`;
const auth = () => ({ Authorization: `Bearer ${A.token}` });

// Count published version rows under a record base via the owner memory list (?count=true).
async function versionCount(base: string): Promise<number> {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${base}.version.`)}&count=true`, { headers: auth() });
    assert(r.status === 200, `versionCount ${r.status}`);
    return r.body.data.count as number;
}
async function latestValue(base: string): Promise<any> {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${base}.`)}`, { headers: auth() });
    const rec = (r.body.data.items as any[]).find(i => i.key === `${base}.latest`);
    return rec?.value;
}
async function hasDraft(base: string): Promise<boolean> {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${base}.`)}`, { headers: auth() });
    return (r.body.data.items as any[]).some(i => i.key === `${base}.draft`);
}

await test('Setup owner', async () => { A = await setupOwner('a'); });

await test('Create organism + workspace with a versioned `note` space and a versioned:false `req` space', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Publish Guard Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;

    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Main', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Main', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true },
            { name: 'req', schemaRef: 'schema:req@1', namespace: 'shared.reqs', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: false },
        ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
});

// ── Happy path: a real edit still versions ──
await test('First publish of a versioned note creates .version.1 + .latest', async () => {
    const base = `${root()}.shared.notes.n1`;
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${base}.draft`, value: { id: 'n1', title: 'v1' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id: 'n1' }) });
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    assert(pub.body.data.skipped !== true, 'first publish must not be skipped');
    assert(await versionCount(base) === 1, `expected 1 version, got ${await versionCount(base)}`);
    assert((await latestValue(base))?.title === 'v1', 'latest is v1');
    assert(!(await hasDraft(base)), 'draft consumed after publish');
});

await test('A genuine edit → publish appends .version.2 (history preserved)', async () => {
    const base = `${root()}.shared.notes.n1`;
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${base}.draft`, value: { id: 'n1', title: 'v2' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id: 'n1' }) });
    assert(pub.status === 200 && pub.body.data.skipped !== true, `changed publish not skipped: ${JSON.stringify(pub.body)}`);
    assert(await versionCount(base) === 2, `expected 2 versions, got ${await versionCount(base)}`);
    assert((await latestValue(base))?.title === 'v2', 'latest advanced to v2');
});

// ── A1: unchanged re-publish is a no-op ──
await test('A1: re-publishing a draft identical to .latest is skipped (no .version.3)', async () => {
    const base = `${root()}.shared.notes.n1`;
    // Write a draft byte-identical to the current .latest (title:'v2') and publish again.
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${base}.draft`, value: { id: 'n1', title: 'v2' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id: 'n1' }) });
    assert(pub.status === 200, `publish ${pub.status}`);
    assert(pub.body.data.skipped === true, `unchanged re-publish should report skipped:true, got ${JSON.stringify(pub.body.data)}`);
    assert(await versionCount(base) === 2, `no new version on no-op, still 2, got ${await versionCount(base)}`);
    assert(!(await hasDraft(base)), 'stale identical draft consumed even when skipped');
});

// ── A2: versioned:false keeps only .latest ──
await test('A2: publishing a versioned:false req writes .latest but NO .version.N', async () => {
    const base = `${root()}.shared.reqs.r1`;
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${base}.draft`, value: { id: 'r1', status: 'requested' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: 'shared.reqs', id: 'r1' }) });
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    assert(await versionCount(base) === 0, `versioned:false must create no versions, got ${await versionCount(base)}`);
    assert((await latestValue(base))?.status === 'requested', 'latest reflects requested');
});

await test('A2: advancing the req status re-publishes .latest and still writes no version', async () => {
    const base = `${root()}.shared.reqs.r1`;
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${base}.draft`, value: { id: 'r1', status: 'done' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: 'shared.reqs', id: 'r1' }) });
    assert(pub.status === 200 && pub.body.data.skipped !== true, `changed req publish not skipped: ${JSON.stringify(pub.body)}`);
    assert(await versionCount(base) === 0, `still no versions on versioned:false, got ${await versionCount(base)}`);
    assert((await latestValue(base))?.status === 'done', 'latest advanced to done');
});

await test('Cleanup owner A', async () => { const r = await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: auth() }); assert(r.status === 200, `del ${r.status}`); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
