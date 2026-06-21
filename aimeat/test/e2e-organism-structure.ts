/**
 * @file e2e-organism-structure.ts
 * @description E2E tests for the organism README, interactive-mindmap graph, and structure timeline:
 *   - GET/PUT /v1/organisms/:id (the free-form `readme` field, Osa A)
 *   - GET /v1/organisms/:id/graph + /workspace/graph (deterministic mindmap data, Osa C)
 *   - GET /v1/organisms/:id/structure/history (trackable-memory timeline, Osa D) — asserts that
 *     publishing content records a new structural snapshot and the previous version is archived.
 *   Happy path + failure modes: README round-trips, graph counts match, history grows on change and
 *   dedups when nothing changed, and a non-member is denied (403).
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial creation (README + graph + structure timeline / trackable memory).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-structure

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
    const name = `str${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Struct', password: 'Str12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Organism README + Graph + Structure Timeline E2E Test ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'wsstruct';
const root = () => `organism.${orgId}.w.${WS}`;
const auth = () => ({ Authorization: `Bearer ${A.token}` });

await test('Setup two owners', async () => { A = await setupOwner('a'); B = await setupOwner('b'); });

await test('Create organism + seed a workspace (records + document spaces)', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Structure Org', description: 'tagline', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;

    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Main', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Main', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
            { name: 'page', schemaRef: 'schema:page@1', namespace: 'shared.pages', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'document' },
        ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.shared.notes.n1`, value: { id: 'n1', title: 'First note' }, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.shared.pages.doc-1`, value: { id: 'doc-1', title: 'Welcome page', markdown: '# Welcome' }, visibility: 'private' }) });
});

// ── Osa A: organism README ──
await test('Organism README round-trips via PUT → GET', async () => {
    const md = '# Structure Org\n\nThis explains what the organism is about.\n\n```mermaid\nflowchart LR\n a-->b\n```';
    const put = await json(`/v1/organisms/${orgId}`, { method: 'PUT', headers: auth(), body: JSON.stringify({ readme: md }) });
    assert(put.status === 200, `put ${put.status}: ${JSON.stringify(put.body.error)}`);
    assert(put.body.data.readme === md, 'PUT echoes readme');
    const get = await json(`/v1/organisms/${orgId}`, { headers: auth() });
    assert(get.status === 200, `get ${get.status}`);
    assert(get.body.data.readme === md, `GET returns readme, got: ${JSON.stringify(get.body.data.readme)}`);
});

await test('README is empty string before being set on a fresh organism', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Fresh Org', type: 'project', visibility: 'public' }) });
    const fresh = o.body.data.organism.id;
    const get = await json(`/v1/organisms/${fresh}`, { headers: auth() });
    assert(get.body.data.readme === '', `fresh readme should be '', got ${JSON.stringify(get.body.data.readme)}`);
    await json(`/v1/organisms/${fresh}`, { method: 'DELETE', headers: auth() });
});

// ── Osa C: graph ──
await test('Organism graph: workspaces, spaces, counts, members', async () => {
    const r = await json(`/v1/organisms/${orgId}/graph`, { headers: auth() });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body.error)}`);
    const g = r.body.data.graph;
    assert(g.id === orgId && typeof g.name === 'string', 'graph identity');
    assert(Array.isArray(g.workspaces) && g.workspaces.length === 1, `1 workspace, got ${g.workspaces?.length}`);
    const w = g.workspaces[0];
    assert(w.id === WS && w.readable === true, 'workspace node readable');
    assert(w.totalRecords === 1 && w.totalDocuments === 1, `counts r=${w.totalRecords} d=${w.totalDocuments}`);
    const spaceNames = w.spaces.map((s: any) => s.name).sort();
    assert(spaceNames.includes('note') && spaceNames.includes('page'), `spaces: ${spaceNames}`);
    assert(Array.isArray(g.members) && g.members.some((m: any) => m.name === A.name && m.role === 'creator'), 'creator in members');
});

await test('Workspace graph: single workspace node with spaces', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/graph?ws=${WS}`, { headers: auth() });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.graph.id === WS, 'workspace graph root id');
    assert(r.body.data.graph.spaces.length === 2, `2 spaces, got ${r.body.data.graph.spaces.length}`);
});

await test('Workspace graph missing ?ws → 400', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/graph`, { headers: auth() });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

// ── Osa D: structure timeline / trackable memory ──
await test('Structure history exists after creation (initial snapshot)', async () => {
    const r = await json(`/v1/organisms/${orgId}/structure/history`, { headers: auth() });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.current && r.body.data.current.value && r.body.data.current.value.fingerprint, 'current fingerprint present');
    const fp = r.body.data.current.value.fingerprint;
    assert(fp.workspaces.length === 1 && fp.memberCount === 1, `fingerprint shape: ${JSON.stringify(fp)}`);
    assert(Array.isArray(r.body.data.history), 'history is array');
});

await test('Publishing content records a NEW structural snapshot (previous archived)', async () => {
    const before = await json(`/v1/organisms/${orgId}/structure/history`, { headers: auth() });
    const beforeVersion = before.body.data.current?.version ?? 0;
    const beforeHistory = before.body.data.history.length;

    // Add a draft note via memory then publish it → document/record count grows → fingerprint changes.
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.shared.notes.n2.draft`, value: { id: 'n2', title: 'Second note' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id: 'n2' }) });
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);

    const after = await json(`/v1/organisms/${orgId}/structure/history`, { headers: auth() });
    const afterVersion = after.body.data.current?.version ?? 0;
    assert(afterVersion > beforeVersion, `version should grow: ${beforeVersion} → ${afterVersion}`);
    assert(after.body.data.history.length > beforeHistory, `history should grow: ${beforeHistory} → ${after.body.data.history.length}`);
    // The newest archived version is the previous current, newest-first.
    assert(after.body.data.history[0].version === beforeVersion, `archived prev version ${after.body.data.history[0].version} === ${beforeVersion}`);
    // New current fingerprint reflects 2 records now.
    const w = after.body.data.current.value.fingerprint.workspaces.find((x: any) => x.id === WS);
    assert(w.totalRecords === 2, `records now 2, got ${w.totalRecords}`);
});

await test('Dedup: re-reading history without a change adds no new version', async () => {
    const a = await json(`/v1/organisms/${orgId}/structure/history`, { headers: auth() });
    const v1 = a.body.data.current.version;
    const b = await json(`/v1/organisms/${orgId}/structure/history`, { headers: auth() });
    const v2 = b.body.data.current.version;
    assert(v1 === v2, `no churn on unchanged structure: ${v1} vs ${v2}`);
});

// ── Failure modes ──
await test('Non-member is denied graph + structure history (403)', async () => {
    const bh = { Authorization: `Bearer ${B.token}` };
    const g = await json(`/v1/organisms/${orgId}/graph`, { headers: bh });
    assert(g.status === 403, `graph non-member should be 403, got ${g.status}`);
    const h = await json(`/v1/organisms/${orgId}/structure/history`, { headers: bh });
    assert(h.status === 403, `history non-member should be 403, got ${h.status}`);
});

await test('Unknown organism → 404', async () => {
    const r = await json('/v1/organisms/no-such-org/graph', { headers: auth() });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('Cleanup owner A', async () => { const r = await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: auth() }); assert(r.status === 200, `del ${r.status}`); });
await test('Cleanup owner B', async () => { const r = await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.token}` } }); assert(r.status === 200, `del ${r.status}`); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
