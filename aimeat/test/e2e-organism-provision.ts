/**
 * @file e2e-organism-provision.ts
 * @description E2E for app-provisionable organisms + workspaces (the organism:write scope). Proves a
 *   published app (role 'app', H-2) holding organism:write may CREATE an organism and a schema-locked
 *   workspace for its OWNER — the same generalization of the organism:invite pattern — while an app
 *   WITHOUT the scope is 403, a non-member cannot create a workspace, the schema lock is enforced, and
 *   the role path (owner/agent) keeps working. Backs multi-tenant apps (each user provisions their own
 *   structured data space, e.g. CADENCE CRM).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=organism-provision
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial: organism:write scope + POST /v1/organisms/:id/workspaces + role-or-scope gate.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `prov${Date.now() % 100000}`;
const owner2 = `prov${(Date.now() + 7) % 100000}b`;
const FILENAME = 'crm-provision-demo.html';
const REDIRECT = 'http://localhost:9933/callback';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as Record<string, unknown> : { _raw: await res.text() };
    return { status: res.status, body: body as { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string } } };
}
async function signMsg(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

let ownerToken = '';

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const ts = new Date().toISOString();
    const sig = await signMsg((reg.body.data as { private_key: string }).private_key, name + NODE_ID + ts);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `token ${name}`);
    return (tok.body.data as { token: string }).token;
}

/** Full app-grant flow → an app access token carrying `scopes`. */
async function grantApp(scopes: string[]): Promise<string> {
    const q = new URLSearchParams({ app: `${owner}/${FILENAME}`, response_type: 'code', scope: scopes.join(' '), redirect_uri: REDIRECT, state: 'x', code_challenge: codeChallenge, code_challenge_method: 'S256' });
    const auth = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(auth.status === 302, `authorize: ${auth.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(auth.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ request_id: rid }) });
    assert(con.status === 200 && con.body.ok === true, `consent: ${con.status}`);
    const code = new URL((con.body.data as { redirect_url: string }).redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }) });
    assert(tok.status === 200 && tok.body.ok === true, `token: ${tok.status}`);
    return (tok.body.data as { access_token: string }).access_token;
}

const CRM_MANIFEST = {
    manifestVersion: '1', name: 'CRM', kind: 'project',
    objectTypes: [{ name: 'contact', namespace: 'crm.contacts', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:contact@1' }],
};
const CRM_SCHEMAS = {
    'crm.contacts': { type: 'object', additionalProperties: false, required: ['id', 'omistaja', 'tila'], properties: { id: { type: 'string' }, etunimi: { type: 'string' }, omistaja: { type: 'string' }, tila: { type: 'string', enum: ['uusi', 'asiakas'] } } },
};

async function main() {
    console.log('\n=== Organism/Workspace Provisioning (organism:write) E2E ===\n');
    let appWrite = '', appNoScope = '', orgId = '', ws = '', owner2Token = '';

    await test('setup: owner + owner2 + published app + two app grants', async () => {
        ownerToken = await registerOwner(owner);
        owner2Token = await registerOwner(owner2);
        const pub = await json('/v1/apps', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>crm</body></html>'), name: 'CRM Demo', description: 'crm', category: 'tool' }) });
        assert(pub.status === 201, `publish: ${pub.status}`);
        appWrite = await grantApp(['organism:write', 'memory:read', 'memory:write']);
        appNoScope = await grantApp(['memory:read']);
        assert(!!appWrite && !!appNoScope, 'both app tokens issued');
    });

    await test('app WITHOUT organism:write CANNOT create an organism → 403', async () => {
        const r = await json('/v1/organisms', { method: 'POST', headers: { Authorization: `Bearer ${appNoScope}` }, body: JSON.stringify({ name: 'Nope CRM', type: 'project', visibility: 'private' }) });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('app WITH organism:write CREATES an organism → 201 (scope path)', async () => {
        const r = await json('/v1/organisms', { method: 'POST', headers: { Authorization: `Bearer ${appWrite}` }, body: JSON.stringify({ name: 'My CRM', type: 'project', visibility: 'private', join_policy: 'invite_only' }) });
        assert(r.status === 201, `create org: ${r.status} ${JSON.stringify(r.body.error)}`);
        orgId = (r.body.data as { organism: { id: string } }).organism.id;
        assert(!!orgId, 'org id present');
    });

    await test('owner (role owner) can still create an organism → 201 (role path regression)', async () => {
        const r = await json('/v1/organisms', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: 'Owner Org', type: 'project', visibility: 'private' }) });
        assert(r.status === 201, `owner create org: ${r.status}`);
    });

    await test('app WITH organism:write CREATES a schema-locked workspace → 201', async () => {
        const r = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${appWrite}` }, body: JSON.stringify({ name: 'CRM', manifest: CRM_MANIFEST, schemas: CRM_SCHEMAS }) });
        assert(r.status === 201, `create ws: ${r.status} ${JSON.stringify(r.body.error)}`);
        ws = (r.body.data as { ws: string }).ws;
        assert(!!ws && ws.startsWith('ws-'), `ws id: ${ws}`);
        assert((r.body.data as { schemas_locked: string[] }).schemas_locked.includes('crm.contacts'), 'schema locked');
    });

    await test('schema lock enforced: a VALID contact writes → ok', async () => {
        const key = `organism.${orgId}.w.${ws}.crm.contacts.c1.latest`;
        const r = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ key, value: { id: 'c1', etunimi: 'Aino', omistaja: `${owner}@${NODE_ID}`, tila: 'uusi' }, visibility: 'owner' }) });
        assert(r.status === 200 || r.status === 201, `valid write: ${r.status} ${JSON.stringify(r.body.error)}`);
    });

    await test('schema lock enforced: an INVALID contact (bad enum + extra field) → 422', async () => {
        const key = `organism.${orgId}.w.${ws}.crm.contacts.c2.latest`;
        const r = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ key, value: { id: 'c2', omistaja: `${owner}@${NODE_ID}`, tila: 'NOPE', extra: 1 }, visibility: 'owner' }) });
        assert(r.status === 422, `expected 422, got ${r.status}`);
    });

    await test('app WITHOUT organism:write CANNOT create a workspace → 403', async () => {
        const r = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${appNoScope}` }, body: JSON.stringify({ name: 'X', manifest: CRM_MANIFEST, schemas: CRM_SCHEMAS }) });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('a non-member CANNOT create a workspace in someone else\'s org → 403', async () => {
        const r = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${owner2Token}` }, body: JSON.stringify({ name: 'X', manifest: CRM_MANIFEST, schemas: CRM_SCHEMAS }) });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('a malformed manifest (no manifestVersion) → 400', async () => {
        const bad = { name: 'X', kind: 'project', objectTypes: [{ name: 'contact', namespace: 'crm.contacts', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:contact@1' }] };
        const r = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${appWrite}` }, body: JSON.stringify({ name: 'Bad', manifest: bad, schemas: CRM_SCHEMAS }) });
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    console.log('\n─────────────────────────────────────');
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed === 0) console.log('✅ All tests passed!');
    process.exit(failed > 0 ? 1 : 0);
}

main();
