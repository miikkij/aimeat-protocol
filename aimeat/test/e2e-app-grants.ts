/**
 * @file e2e-app-grants.ts
 * @description E2E for the explicit scoped app-grant flow (H-2 Phase 3). Drives the full
 *   OAuth-like, PKCE-protected code exchange and proves the issued token's blast radius is
 *   exactly the granted scopes — never the ambient session:
 *     authorize → consent (owner) → code → token; granted memory:read works, ungranted
 *     memory:write is 403; refresh rotates; revoke kills the grant (refresh 401, list empty).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-app-grants
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phase 3).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `grant${Date.now() % 100000}`;
const FILENAME = 'grant-demo.html';
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
    return { status: res.status, body, headers: res.headers };
}
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

let ownerToken = '';
let appAccess = '';
let appRefresh = '';
let grantId = '';

// PKCE
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

async function main() {
    console.log('\n=== App Grants (scoped, user-approved) E2E ===\n');
    console.log('Phase 0: Setup');

    await test('register owner + token + publish app', async () => {
        const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
        assert(reg.status === 201, `register: ${reg.status} ${JSON.stringify(reg.body)}`);
        const ts = new Date().toISOString();
        const sig = await signMsg(reg.body.data.private_key, owner + NODE_ID + ts);
        const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp: ts, signature: sig }) });
        assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
        ownerToken = tok.body.data.token;
        const pub = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>grant</body></html>'), name: 'Grant Demo', category: 'utility' }),
        });
        assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    });

    console.log('\nPhase 1: Authorize → consent → code');
    let requestId = '';
    await test('GET /authorize (PKCE) 302-redirects to the consent page with a request id', async () => {
        const q = new URLSearchParams({
            app: `${owner}/${FILENAME}`, response_type: 'code', scope: 'memory:read',
            redirect_uri: REDIRECT, state: 'xyz', code_challenge: codeChallenge, code_challenge_method: 'S256',
        });
        const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
        assert(res.status === 302, `expected 302, got ${res.status}`);
        const loc = res.headers.get('location') ?? '';
        const m = /\/v1\/app-grant\?req=([^&]+)/.exec(loc);
        assert(!!m, `expected consent redirect, got ${loc}`);
        requestId = decodeURIComponent(m![1]);
    });

    await test('GET /request/:id shows the app + requested scopes', async () => {
        const r = await json(`/v1/app-grants/request/${requestId}`);
        assert(r.status === 200 && r.body.ok, `request lookup: ${r.status}`);
        assert(r.body.data.app === `${owner}/${FILENAME}`, 'app matches');
        assert(r.body.data.scopes.length === 1 && r.body.data.scopes[0].scope === 'memory:read', 'scope listed with description');
        assert(!!r.body.data.scopes[0].description, 'scope has a human description');
    });

    await test('rejects an ungrantable scope at authorize', async () => {
        const q = new URLSearchParams({
            app: `${owner}/${FILENAME}`, response_type: 'code', scope: 'operator:all',
            redirect_uri: REDIRECT, code_challenge: codeChallenge, code_challenge_method: 'S256',
        });
        const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
        assert(res.status === 400, `expected 400 for bad scope, got ${res.status}`);
    });

    await test('rejects a redirect_uri that is not on the app origin (open-redirect guard)', async () => {
        const q = new URLSearchParams({
            app: `${owner}/${FILENAME}`, response_type: 'code', scope: 'memory:read',
            redirect_uri: 'https://evil.example.com/x', code_challenge: codeChallenge, code_challenge_method: 'S256',
        });
        const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
        assert(res.status === 400, `expected 400 for off-origin redirect, got ${res.status}`);
    });

    let code = '';
    await test('owner approves → authorize-consent returns redirect_url with a code', async () => {
        const r = await json('/v1/app-grants/authorize-consent', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ request_id: requestId }),
        });
        assert(r.status === 200 && r.body.ok, `consent: ${r.status} ${JSON.stringify(r.body)}`);
        const url = new URL(r.body.data.redirect_url);
        assert(url.origin + url.pathname === REDIRECT, 'redirect_url targets the app callback');
        assert(url.searchParams.get('state') === 'xyz', 'state echoed');
        code = url.searchParams.get('code') ?? '';
        assert(!!code, 'code present');
    });

    await test('consent requires an authenticated owner (401 without token)', async () => {
        const r = await json('/v1/app-grants/authorize-consent', { method: 'POST', body: JSON.stringify({ request_id: 'nope' }) });
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    console.log('\nPhase 2: Token exchange (PKCE) + scoped access');
    await test('POST /token (authorization_code + verifier) issues scoped access + refresh', async () => {
        const r = await json('/v1/app-grants/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
        });
        assert(r.status === 200 && r.body.ok, `token: ${r.status} ${JSON.stringify(r.body)}`);
        appAccess = r.body.data.access_token;
        appRefresh = r.body.data.refresh_token;
        grantId = r.body.data.grant_id;
        assert(!!appAccess && !!appRefresh && !!grantId, 'access+refresh+grant_id present');
        assert(r.body.data.scope === 'memory:read', 'scope echoed');
    });

    await test('the code is single-use (replay fails)', async () => {
        const r = await json('/v1/app-grants/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
        });
        assert(r.status === 400, `code replay should fail, got ${r.status}`);
    });

    await test('granted scope works: app token may READ the owner\'s memory', async () => {
        // memory:read is granted → requireScope passes → handler runs (404 for a missing key,
        // which still proves the scope check let us through; a 403 would mean scope denied).
        const r = await json('/v1/memory?limit=1', { headers: { Authorization: `Bearer ${appAccess}` } });
        assert(r.status === 200, `memory list with app token should pass scope, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('ungranted scope blocked: app token may NOT WRITE memory (403)', async () => {
        const r = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${appAccess}` },
            body: JSON.stringify({ key: 'x', value: { a: 1 } }),
        });
        assert(r.status === 403, `memory write should be scope-denied, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body?.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${r.body?.error?.code}`);
    });

    console.log('\nPhase 3: Refresh + manage + revoke');
    await test('refresh_token rotates and re-mints an access token', async () => {
        const r = await json('/v1/app-grants/token', {
            method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: appRefresh }),
        });
        assert(r.status === 200 && r.body.ok, `refresh: ${r.status} ${JSON.stringify(r.body)}`);
        assert(!!r.body.data.refresh_token && r.body.data.refresh_token !== appRefresh, 'refresh token rotated');
        appRefresh = r.body.data.refresh_token;
    });

    await test('owner lists the grant', async () => {
        const r = await json('/v1/app-grants', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(r.status === 200 && r.body.ok, `list: ${r.status}`);
        const g = r.body.data.grants.find((x: any) => x.grant_id === grantId);
        assert(!!g, 'grant present in owner list');
        assert(g.app === `${owner}/${FILENAME}` && g.scopes.includes('memory:read'), 'grant shows app + scopes');
    });

    await test('owner revokes the grant', async () => {
        const r = await json(`/v1/app-grants/${grantId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(r.status === 200 && r.body.ok, `revoke: ${r.status}`);
    });

    await test('after revoke, refresh is rejected (401) and the grant is gone from the list', async () => {
        const ref = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: appRefresh }) });
        assert(ref.status === 401, `refresh after revoke should be 401, got ${ref.status}`);
        const list = await json('/v1/app-grants', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(!list.body.data.grants.find((x: any) => x.grant_id === grantId), 'revoked grant no longer listed');
    });

    console.log('\n─────────────────────────────────────');
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed === 0) console.log('✅ All tests passed!');
    process.exit(failed > 0 ? 1 : 0);
}

main();
