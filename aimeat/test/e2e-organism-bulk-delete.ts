/**
 * @file e2e-organism-bulk-delete.ts
 * @description E2E for POST /v1/organisms/:id/workspace/records/delete — the Phase 2 batched
 *   record-family delete. Covers the happy path (many records removed in one request, siblings spared),
 *   the append-only (create_only) namespace refusal (409), the input/membership guards, and — the
 *   security invariant (Rule 10) — CROSS-OWNER protection: a member cannot bulk-delete another member's
 *   records (their rows are skipped, not deleted).
 * @version-history
 *   v1.0.0 — 2026-07-15 — Initial: batched record delete happy path + append-only + cross-owner denial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-bulk-delete

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
    const name = `bd${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'BD', password: 'BulkDel12' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Organism Bulk Record Delete E2E ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'wsbulk';
const authA = () => ({ Authorization: `Bearer ${A.token}` });
const authB = () => ({ Authorization: `Bearer ${B.token}` });
const root = () => `organism.${orgId}.w.${WS}`;
const delUrl = () => `/v1/organisms/${orgId}/workspace/records/delete`;

await test('Setup: owner A + org + workspace (a normal + an append-only namespace) + records', async () => {
    A = await setupOwner('a');
    const o = await json('/v1/organisms', { method: 'POST', headers: authA(), body: JSON.stringify({ name: 'Bulk Delete Org', type: 'project', visibility: 'public', join_policy: 'open' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'WS', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'WS', kind: 'project', status: 'active', objectTypes: [
        { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
        { name: 'logentry', schemaRef: 'schema:log@1', namespace: 'shared.log', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', create_only: true },
    ] };
    const mr = await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
    for (const n of ['n1', 'n2', 'n3']) {
        await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `${root()}.shared.notes.${n}`, value: { id: n, body: `note ${n}` }, visibility: 'private' }) });
    }
    await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: `${root()}.shared.log.l1`, value: { id: 'l1', body: 'append-only' }, visibility: 'private' }) });
});

await test('Bulk delete n1 + n2 → 200, removes exactly those, spares n3', async () => {
    const r = await json(delUrl(), { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', ids: ['n1', 'n2'] }) });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.deleted.length === 2 && r.body.data.rows_removed === 2, `summary ${JSON.stringify(r.body.data)}`);
    const list = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.shared.notes`)}`, { headers: authA() });
    const keys = (list.body.data.items || []).map((i: any) => i.key);
    assert(!keys.includes(`${root()}.shared.notes.n1`) && !keys.includes(`${root()}.shared.notes.n2`), 'n1/n2 gone');
    assert(keys.includes(`${root()}.shared.notes.n3`), 'n3 survives');
});

await test('Bulk delete in an append-only (create_only) namespace → 409', async () => {
    const r = await json(delUrl(), { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: 'shared.log', ids: ['l1'] }) });
    assert(r.status === 409, `expected 409, got ${r.status}`);
    const still = await json(`/v1/memory/${encodeURIComponent(`${root()}.shared.log.l1`)}`, { headers: authA() });
    assert(still.status === 200, 'append-only record survives the refused delete');
});

await test('Missing namespace/ids → 400', async () => {
    const r = await json(delUrl(), { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, ids: [] }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('Non-member → 403', async () => {
    B = await setupOwner('b');
    const r = await json(delUrl(), { method: 'POST', headers: authB(), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', ids: ['n3'] }) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('CROSS-OWNER: a member cannot bulk-delete another member\'s record (Rule 10)', async () => {
    // B joins the open org and writes their OWN record into the shared namespace.
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: authB() });
    assert(j.status === 200 || j.status === 201, `join ${j.status}`);
    const w = await json('/v1/memory', { method: 'POST', headers: authB(), body: JSON.stringify({ key: `${root()}.shared.notes.b1`, value: { id: 'b1', body: 'B owns this' }, visibility: 'members' }) });
    assert(w.status === 201 || w.status === 200, `B write ${w.status}`);
    // A (a member) tries to bulk-delete B's record — B's rows are NOT owned by A, so nothing is deleted.
    const r = await json(delUrl(), { method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', ids: ['b1'] }) });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.body.data.rows_removed === 0, `A must not delete B's record, rows_removed=${r.body.data.rows_removed}`);
    assert((r.body.data.failed || []).some((f: any) => f.id === 'b1'), 'b1 reported as not deletable by A');
    // B's record still exists.
    const still = await json(`/v1/memory/${encodeURIComponent(`${root()}.shared.notes.b1`)}?owner_scope=true`, { headers: authB() });
    assert(still.status === 200, 'B\'s record survives A\'s attempted delete');
});

await test('Cleanup owners', async () => {
    await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: authA() });
    await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: authB() });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
