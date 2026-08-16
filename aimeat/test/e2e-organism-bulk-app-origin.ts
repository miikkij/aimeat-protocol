/**
 * @file e2e-organism-bulk-app-origin.ts
 * @description Regression test for the batched workspace endpoints under an APP-ORIGIN (H-2) token —
 *   the exact auth context the CADENCE app runs in (role 'app', not 'agent'). The batch record delete
 *   originally gated on requireRole('agent'), which app-origin tokens never satisfy, so the app could
 *   publish in bulk but not delete — a bug that slipped past the owner-token E2Es and only surfaced in
 *   prod. This drives the full app-grant flow (authorize→consent→token) to mint a role-'app' token with
 *   the CADENCE scopes, then writes drafts, publishRecords, and deleteRecords AS THE APP, asserting each
 *   succeeds (not 403). Reverting the fix (requireExternalPrincipal → requireRole('agent')) makes the
 *   deleteRecords step fail here — the guard-parity net (pitfalls §6).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-bulk-app-origin
 * @version-history
 *   v1.0.0 — 2026-07-15 — Initial: publishRecords + deleteRecords work under an H-2 app-origin token.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `bao${Date.now() % 1000000}`;
const FILENAME = 'cadence-like.html';
const REDIRECT = 'http://localhost:9911/callback';

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

let ownerToken = '';
let appToken = '';
let orgId = '';
const WS = 'wsapp';
const NS = 'crm.tasks';
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
const ownerAuth = () => ({ Authorization: `Bearer ${ownerToken}` });
const appAuth = () => ({ Authorization: `Bearer ${appToken}` });
const root = () => `organism.${orgId}.w.${WS}`;

async function grantAppToken(scope: string): Promise<string> {
    const q = new URLSearchParams({ app: `${owner}/${FILENAME}`, response_type: 'code', scope, redirect_uri: REDIRECT, code_challenge: codeChallenge, code_challenge_method: 'S256' });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: ownerAuth(), body: JSON.stringify({ request_id: rid }) });
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }) });
    return tok.body.data.access_token as string;
}

console.log('\n=== Batched workspace endpoints under an app-origin (H-2) token ===\n');

await test('Setup: owner + org + workspace + records namespace + published app', async () => {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp: ts, signature: await signMsg(reg.body.data.private_key, owner + NODE_ID + ts) }) });
    ownerToken = tok.body.data.token;
    // Publish a CADENCE-like app (the grant needs a real app to bind to) with the same scopes.
    const pub = await json('/v1/apps', { method: 'POST', headers: ownerAuth(), body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="memory:read memory:write memory:delete organism:write"></head><body>cadence-like</body></html>'), name: 'Cadence-like', description: 'app-origin bulk test', category: 'utility' }) });
    assert(pub.status === 201, `publish app ${pub.status}`);
    const o = await json('/v1/organisms', { method: 'POST', headers: ownerAuth(), body: JSON.stringify({ name: 'App Origin Bulk Org', type: 'project', visibility: 'public', join_policy: 'open' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: ownerAuth(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'WS', createdAt: new Date().toISOString(), createdBy: owner }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'WS', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: ownerAuth(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
});

await test('Mint an app-origin token (role app) with the CADENCE scopes', async () => {
    appToken = await grantAppToken('memory:read memory:write memory:delete organism:write');
    assert(!!appToken, 'got an app access token');
    // Sanity: it is NOT an agent — writing a draft works (memory:write), the org is the owner's.
    const w = await json('/v1/memory', { method: 'POST', headers: appAuth(), body: JSON.stringify({ key: `${root()}.${NS}.probe.draft`, value: { id: 'probe', title: 'probe' }, visibility: 'owner' }) });
    assert(w.status === 201 || w.status === 200, `app draft write ${w.status} ${JSON.stringify(w.body?.error)}`);
});

await test('APP publishRecords (batch) succeeds — not blocked by an agent-role gate', async () => {
    for (const id of ['a1', 'a2', 'a3']) {
        const w = await json('/v1/memory', { method: 'POST', headers: appAuth(), body: JSON.stringify({ key: `${root()}.${NS}.${id}.draft`, value: { id, title: `Task ${id}` }, visibility: 'owner' }) });
        assert(w.status === 201 || w.status === 200, `${id} draft ${w.status}`);
    }
    const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: appAuth(), body: JSON.stringify({ ws: WS, namespace: NS, instances: ['a1', 'a2', 'a3'] }) });
    assert(r.status === 200, `publishRecords status ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.published === 3, `published ${JSON.stringify(r.body.data)}`);
});

// This suite is a guard-parity net: it proves an app-origin token CAN reach these doors. It mints
// ONE grant carrying the full CADENCE scope set, so requireScope('memory:delete') on the batch delete
// was asserted by nothing — here or anywhere else. An app the owner granted read-only could wipe up
// to 2000 records per request and every test stayed green.
await test('A READ-ONLY app grant cannot batch-delete records → 403, and the records survive', async () => {
    const readOnly = await grantAppToken('memory:read');
    assert(!!readOnly, 'got a read-only app access token');

    const r = await json(`/v1/organisms/${orgId}/workspace/records/delete`, {
        method: 'POST', headers: { Authorization: `Bearer ${readOnly}` },
        body: JSON.stringify({ ws: WS, namespace: NS, ids: ['a1', 'a2', 'a3'] }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body?.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${r.body?.error?.code}`);
    assert(JSON.stringify(r.body?.error ?? '').includes('memory:delete'), `the refusal must name the missing word: ${JSON.stringify(r.body?.error)}`);

    // The refusal is about the WORD, not about the door: the same token still reads.
    const read = await json(`/v1/memory/${encodeURIComponent(`${root()}.${NS}.a1.latest`)}?owner_scope=true`, {
        headers: { Authorization: `Bearer ${readOnly}` },
    });
    assert(read.status === 200, `a read-only grant must still read, got ${read.status}: ${JSON.stringify(read.body?.error)}`);

    // Nothing was removed.
    const chk = await json(`/v1/memory/${encodeURIComponent(`${root()}.${NS}.a1.latest`)}?owner_scope=true&soft=1`, { headers: ownerAuth() });
    assert(chk.body.data.value !== null, 'the refused delete must leave the record standing');
});

await test('APP deleteRecords (batch) succeeds — the regression: app-origin must NOT hit a role-agent gate', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/records/delete`, { method: 'POST', headers: appAuth(), body: JSON.stringify({ ws: WS, namespace: NS, ids: ['a1', 'a2', 'a3'] }) });
    assert(r.status === 200, `deleteRecords status ${r.status} ${JSON.stringify(r.body?.error)} — a 403 "Role agent required" is the bug`);
    assert(r.body.data.rows_removed > 0, `expected rows removed, got ${JSON.stringify(r.body.data)}`);
    // Gone.
    const chk = await json(`/v1/memory/${encodeURIComponent(`${root()}.${NS}.a1.latest`)}?owner_scope=true&soft=1`, { headers: ownerAuth() });
    assert(chk.body.data.value === null, 'a1 record removed');
});

await test('Cleanup owner', async () => { await json(`/v1/owners/${owner}`, { method: 'DELETE', headers: ownerAuth() }); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
