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
 *   v1.3.0 — 2026-08-17 — GET /request/:id also proves the `description_keys` localization chain
 *     (override key first, shared sentence tree second) that the consent UI resolves client-side.
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phase 3).
 *   v1.2.0 — 2026-07-25 — Add Phase 2d: one live grant per (owner, app). Re-consent updates the
 *     live grant instead of stacking a duplicate (the bug that grew one account to 86 grants),
 *     REPLACES scopes so a narrower approval narrows access, and kills the previous refresh token.
 *     A revoked grant is never resurrected — the next approval is a fresh authorization.
 *   v1.1.0 — 2026-07-10 — Add Phase 2c: reserved-key guard — a granted app with memory:write cannot
 *     write server-trusted owner keys (openrouter.*, ai-usage.*, profile.*) on POST/PUT/import; the
 *     owner is unaffected (guard is app-scoped). Closes the C-2 app-grant key-exfil class.
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
let appRefreshBeforeReconsent = '';
let grantId = '';

// PKCE
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

/** Run the full authorize→consent→token flow and return the whole token payload (access_token,
 *  refresh_token, grant_id, scope). Callers that only want the access token read .access_token. */
async function grantAppToken(scope: string): Promise<any> {
    const q = new URLSearchParams({
        app: `${owner}/${FILENAME}`, response_type: 'code', scope,
        redirect_uri: REDIRECT, code_challenge: codeChallenge, code_challenge_method: 'S256',
    });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ request_id: rid }),
    });
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
    });
    return tok.body.data;
}

/** How many live grants the owner holds for the app under test. */
async function liveGrantsForApp(): Promise<any[]> {
    const r = await json('/v1/app-grants', { headers: { Authorization: `Bearer ${ownerToken}` } });
    return (r.body.data.grants as any[]).filter(g => g.app === `${owner}/${FILENAME}`);
}

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
            body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>grant</body></html>'), name: 'Grant Demo', description: 'grant demo app', category: 'utility' }),
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
        // The localization chain the consent UI resolves client-side: app-context override first,
        // the shared agent sentence tree second. Served so API consumers localize the same way.
        const keys = r.body.data.scopes[0].description_keys;
        assert(Array.isArray(keys) && keys.length === 2, 'scope has the ordered description_keys chain');
        assert(keys[0] === 'appGrant.scopeText.memory.read', `override key first, got ${keys[0]}`);
        assert(keys[1] === 'profile.agents.scopeUi.scopeText.memory.read', `shared key second, got ${keys[1]}`);
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
        appRefreshBeforeReconsent = appRefresh; // Phase 2d proves re-consent kills this one
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

    console.log('\nPhase 2b: web_message (popup) mode + Advanced scope subset');
    await test('response_mode=web_message is echoed, and consent grants only the approved subset', async () => {
        const q = new URLSearchParams({
            app: `${owner}/${FILENAME}`, response_type: 'code', response_mode: 'web_message',
            scope: 'memory:read storage:read storage:write', redirect_uri: REDIRECT,
            state: 's2', code_challenge: codeChallenge, code_challenge_method: 'S256',
        });
        const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
        assert(res.status === 302, `authorize: ${res.status}`);
        const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')![1]);
        const det = await json(`/v1/app-grants/request/${rid}`);
        assert(det.body.data.response_mode === 'web_message', `response_mode echoed, got ${det.body.data.response_mode}`);
        assert(det.body.data.scopes.length === 3, `3 scopes requested, got ${det.body.data.scopes.length}`);
        // Approve only a SUBSET (storage:read); an unrequested scope (operator:all) is filtered out.
        const con = await json('/v1/app-grants/authorize-consent', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ request_id: rid, scopes: ['storage:read', 'operator:all'] }),
        });
        assert(con.status === 200, `consent: ${con.status} ${JSON.stringify(con.body)}`);
        const code2 = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
        const tok = await json('/v1/app-grants/token', {
            method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: code2, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
        });
        assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${JSON.stringify(tok.body)}`);
        assert(tok.body.data.scope === 'storage:read', `granted subset only (storage:read), got "${tok.body.data.scope}"`);
        // Re-consent UPDATES the owner's live grant for this app instead of stacking a second one.
        assert(tok.body.data.grant_id === grantId, `expected the live grant ${grantId} to be reused, got ${tok.body.data.grant_id}`);
        appRefresh = tok.body.data.refresh_token;
    });

    console.log('\nPhase 2d: One live grant per (owner, app)');
    await test('a second consent does NOT create a duplicate — exactly one live grant for the app', async () => {
        const grants = await liveGrantsForApp();
        assert(grants.length === 1, `expected exactly 1 live grant, got ${grants.length}: ${JSON.stringify(grants.map(g => g.grant_id))}`);
        assert(grants[0].grant_id === grantId, 'the single live grant is the original one');
    });

    await test('re-consent REPLACES scopes (a narrower approval narrows the grant)', async () => {
        // Phase 2 granted memory:read; Phase 2b approved only storage:read. A union would have kept
        // memory:read alive — the Advanced subset must be able to take access AWAY, not just add.
        const [g] = await liveGrantsForApp();
        assert(g.scopes.length === 1 && g.scopes[0] === 'storage:read', `expected exactly ["storage:read"], got ${JSON.stringify(g.scopes)}`);
    });

    await test('re-consent rotates the refresh token: the pre-consent one is dead (401)', async () => {
        // The trade-off of one live grant per app: the previous refresh token stops working. Apps
        // self-heal (silent bridge / consent re-issues), but the old token must NOT survive.
        const r = await json('/v1/app-grants/token', {
            method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: appRefreshBeforeReconsent }),
        });
        assert(r.status === 401, `stale refresh token should be 401, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log('\nPhase 2c: Reserved-key guard (a granted app cannot poison server-trusted owner keys)');
    let writeToken = '';
    await test('mint an app token WITH memory:write', async () => {
        const d = await grantAppToken('memory:write');
        writeToken = d.access_token;
        appRefresh = d.refresh_token;
        assert(!!writeToken, 'memory:write app token minted');
        assert(d.grant_id === grantId, `still the same live grant, got ${d.grant_id}`);
    });
    await test('app with memory:write CAN write a normal (non-reserved) key', async () => {
        const r = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${writeToken}` },
            body: JSON.stringify({ key: 'grantapp.data', value: { a: 1 } }),
        });
        assert(r.status === 201, `normal write should pass (201 Created), got ${r.status} ${JSON.stringify(r.body)}`);
    });
    for (const rk of ['openrouter.settings', 'openrouter.apikey', 'ai-usage.2026-01-01', 'profile.x.directory_listed']) {
        await test(`app CANNOT write reserved key "${rk}" via POST (403 RESERVED_KEY)`, async () => {
            const r = await json('/v1/memory', {
                method: 'POST', headers: { Authorization: `Bearer ${writeToken}` },
                body: JSON.stringify({ key: rk, value: { provider: 'custom', baseUrl: 'https://attacker.example/v1' } }),
            });
            assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
            assert(r.body?.error?.code === 'RESERVED_KEY', `expected RESERVED_KEY, got ${r.body?.error?.code}`);
        });
    }
    await test('reserved-key block also covers PUT /v1/memory/:key', async () => {
        const r = await json(`/v1/memory/${encodeURIComponent('openrouter.settings')}`, {
            method: 'PUT', headers: { Authorization: `Bearer ${writeToken}` },
            body: JSON.stringify({ value: { baseUrl: 'https://attacker.example/v1' }, version: 1 }),
        });
        assert(r.status === 403 && r.body?.error?.code === 'RESERVED_KEY', `PUT expected 403 RESERVED_KEY, got ${r.status} ${r.body?.error?.code}`);
    });
    await test('reserved-key block also covers POST /v1/memory/import (per-entry)', async () => {
        const r = await json('/v1/memory/import', {
            method: 'POST', headers: { Authorization: `Bearer ${writeToken}` },
            body: JSON.stringify({ entries: [{ key: 'openrouter.apikey', value: { encrypted: 'x' } }, { key: 'grantapp.ok', value: { a: 1 } }] }),
        });
        assert(r.status === 200, `import status ${r.status}`);
        const failed = (r.body?.data?.failed ?? []) as { key: string; reason: string }[];
        assert(failed.some((f) => f.key === 'openrouter.apikey' && /reserved/i.test(f.reason)), `import should reject the reserved key, got ${JSON.stringify(failed)}`);
    });
    await test('guard is app-scoped: the OWNER is NOT blocked from a reserved key', async () => {
        const r = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ key: 'ai-usage.e2e-owner-marker', value: { total_cost_usd: 0 } }),
        });
        assert(r.body?.error?.code !== 'RESERVED_KEY', `owner must not be RESERVED_KEY-blocked, got ${r.status} ${JSON.stringify(r.body)}`);
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
        // Scopes are whatever the LAST consent approved (Phase 2c: memory:write) — see Phase 2d.
        assert(g.app === `${owner}/${FILENAME}` && g.scopes.includes('memory:write'), `grant shows app + last-approved scopes, got ${JSON.stringify(g.scopes)}`);
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

    // A9 (E2E test-quality audit). The test above proves the REFRESH token is dead and the grant is
    // off the list. The access token it already issued was never asked about, and that is the one the
    // app is holding: it carries no session id, so the per-request revocation check could not see it,
    // and revoke cleared only the refresh token. For up to its 15-minute TTL the app kept reading and
    // writing the owner's memory after the owner pressed Revoke and was told "It loses access
    // immediately" (locales/en.json profile.apps.revokeConfirm). 401 rather than 403 is the point:
    // the credential is dead, not merely short of a scope. Against the pre-fix source this fails.
    await test('after revoke, the access token it already issued stops working', async () => {
        const r = await json('/v1/memory?limit=1', { headers: { Authorization: `Bearer ${appAccess}` } });
        assert(r.status === 401, `a revoked grant's access token expected 401, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
        assert(!r.body?.data, `a revoked grant's access token was served data: ${JSON.stringify(r.body?.data ?? null).slice(0, 200)}`);

        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${appAccess}` },
            body: JSON.stringify({ key: 'revoked-app-write', value: 'should never land', visibility: 'private' }),
        });
        assert(w.status === 401, `a revoked grant's access token expected 401 on write, got ${w.status}`);
        const check = await json('/v1/memory/revoked-app-write', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(check.status === 404, `the revoked app's write landed in the owner's memory (${check.status})`);
    });

    await test('after revoke, consenting again creates a NEW grant (reuse covers live grants only)', async () => {
        // The one-live-grant rule must not resurrect a revoked grant: the owner said no, so the next
        // approval is a fresh authorization with its own id, and there is still exactly one live row.
        const d = await grantAppToken('memory:read');
        assert(!!d.grant_id && d.grant_id !== grantId, `expected a new grant id, got ${d.grant_id} (old ${grantId})`);
        const grants = await liveGrantsForApp();
        assert(grants.length === 1, `expected exactly 1 live grant after re-grant, got ${grants.length}`);
    });

    // ── Scope parity across the twin routes (2026-08 audit H-11, H-12) ──
    // An app-grant token's `sub` IS the owner's GHII, so requireScope is the only thing standing
    // between a narrowly consented app and the owner's whole keyspace. The list and single-key reads
    // enforced memory:read; export, search and bundle enforced nothing, and the /v1/memory/files
    // trio was an unscoped twin of /v1/storage over the same file store. A token holding one
    // unrelated scope must be refused by all six, and the owner's own session must be unaffected.
    let narrowToken = '';
    await test('mint an app token with ONLY catalogue:read (no memory, no storage)', async () => {
        const d = await grantAppToken('catalogue:read');
        narrowToken = d.access_token;
        assert(!!narrowToken, 'got a token');
    });

    for (const [label, path] of [
        ['GET /v1/memory/export', '/v1/memory/export'],
        ['GET /v1/memory/search', '/v1/memory/search?q=a'],
    ] as const) {
        await test(`app without memory:read is refused by ${label} (H-11)`, async () => {
            const r = await json(path, { headers: { Authorization: `Bearer ${narrowToken}` } });
            assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
        });
    }

    await test('app without memory:read is refused by POST /v1/memory/bundle (H-11)', async () => {
        const r = await json('/v1/memory/bundle', {
            method: 'POST', headers: { Authorization: `Bearer ${narrowToken}` },
            body: JSON.stringify({ keys: ['anything'] }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
    });

    await test('app without storage:write is refused by POST /v1/memory/files (H-12)', async () => {
        const r = await json('/v1/memory/files', {
            method: 'POST', headers: { Authorization: `Bearer ${narrowToken}` },
            body: JSON.stringify({ key: 'x.txt', data: 'aGk=', content_type: 'text/plain' }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
    });

    await test('app without storage:read is refused by GET /v1/memory/files/:key (H-12)', async () => {
        const r = await json('/v1/memory/files/x.txt', { headers: { Authorization: `Bearer ${narrowToken}` } });
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
    });

    await test('app without storage:write is refused by PATCH .../visibility (H-12)', async () => {
        const r = await json('/v1/memory/files/x.txt/visibility', {
            method: 'PATCH', headers: { Authorization: `Bearer ${narrowToken}` },
            body: JSON.stringify({ visibility: 'public' }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
    });

    await test('the OWNER is unaffected by the new scope gates (export still 200)', async () => {
        const r = await json('/v1/memory/export', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(r.status === 200, `owner export must still work, got ${r.status}`);
    });

    await test('an app WITH memory:read still reaches export (the gate is a scope, not a ban)', async () => {
        const d = await grantAppToken('memory:read');
        const r = await json('/v1/memory/export', { headers: { Authorization: `Bearer ${d.access_token}` } });
        assert(r.status === 200, `expected 200 with memory:read, got ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
    });

    /**
     * The operator's view of the same facts.
     *
     * Every question about tightening a gate — would this refuse an app that is alive today? — needed
     * a list nobody could produce: GET /v1/app-grants answers for ONE owner, and no operator surface
     * carried scopes at all. Measured on aimeat.io on 2026-08-18, that gap made the decision a guess
     * taken on whichever account happened to be logged in: 108 grants readable, and 29 other owners'
     * grants invisible.
     */
    console.log('\nPhase 6: The operator can see the whole node');

    await test('an operator lists every app grant beside what each app declares today', async () => {
        // This suite's owner is the first on a cleared database, so it is the node operator.
        const r = await json('/v1/admin/app-grants', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(r.status === 200, `admin grants: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        const rows = r.body.data.grants as any[];
        const mine = rows.find(g => g.app === `${owner}/${FILENAME}`);
        assert(!!mine, `this suite's grant must be listed: ${JSON.stringify(rows.map(g => g.app))}`);
        assert(Array.isArray(mine.scopes) && mine.scopes.length > 0, `the grant carries its scopes: ${JSON.stringify(mine)}`);
        // The fixture app declares no <meta name="aimeat-scopes">, and that is its own answer: null,
        // not the empty list, so a wide grant on it is not reported as drift.
        assert(mine.declared_scopes === null, `an app that declares nothing must read as null, got ${JSON.stringify(mine.declared_scopes)}`);
        assert(mine.extra_scopes.length === 0, `nothing to call drift without a declaration, got ${JSON.stringify(mine.extra_scopes)}`);
        assert(typeof r.body.data.drifted === 'number' && typeof r.body.data.undeclared === 'number',
            `the two counts an operator acts on must be there: ${JSON.stringify(r.body.data).slice(0, 200)}`);
    });

    await test('a grant WIDER than its app now declares is named as drift', async () => {
        // Give the live grant two permissions first — the drift is the DIFFERENCE, so a grant that
        // already matches the new declaration proves nothing either way.
        await grantAppToken('memory:read storage:read');
        const declared = '<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="memory:read"></head><body>grant</body></html>';
        const pub = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ filename: FILENAME, content: b64(declared), name: 'Grant Demo', description: 'grant demo app', category: 'utility' }),
        });
        assert(pub.status === 201 || pub.status === 200, `republish: ${pub.status} ${JSON.stringify(pub.body).slice(0, 160)}`);

        const r = await json('/v1/admin/app-grants', { headers: { Authorization: `Bearer ${ownerToken}` } });
        const mine = (r.body.data.grants as any[]).find(g => g.app === `${owner}/${FILENAME}`);
        assert(!!mine, 'the grant is still listed after the republish');
        assert(JSON.stringify(mine.declared_scopes) === JSON.stringify(['memory:read']),
            `the declaration must be read from the app itself, got ${JSON.stringify(mine.declared_scopes)}`);
        assert(mine.extra_scopes.length > 0,
            `a grant carrying words the app no longer asks for must be named: ${JSON.stringify(mine)}`);
        assert(!mine.extra_scopes.includes('memory:read'), 'a declared scope is not drift');
        assert(r.body.data.drifted >= 1, `the drift count must see it: ${r.body.data.drifted}`);
    });

    await test('the agent listing carries the scopes their owner approved', async () => {
        const ag = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ name: 'grantscopebot', owner, capabilities: ['memory'], scopes: ['memory:read'] }),
        });
        assert(ag.status === 201, `register agent: ${ag.status} ${JSON.stringify(ag.body.error)}`);
        const r = await json('/v1/admin/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(r.status === 200, `admin agents: ${r.status}`);
        const row = (r.body.data.agents as any[]).find(x => x.gaii === ag.body.data.agent.gaii);
        assert(!!row, 'the agent is listed');
        assert(JSON.stringify(row.default_scopes) === JSON.stringify(['memory:read']),
            `the operator must see what the owner approved, got ${JSON.stringify(row.default_scopes)}`);
    });

    await test('a plain owner is refused both operator listings, and so is a caller with none', async () => {
        const plain = `grantplain${Date.now() % 100000}`;
        const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: plain, public_key: 'placeholder' }) });
        assert(reg.status === 201, `register: ${reg.status}`);
        const ts = new Date().toISOString();
        const sig = await signMsg(reg.body.data.private_key, plain + NODE_ID + ts);
        const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: plain, timestamp: ts, signature: sig }) });
        const plainToken = tok.body.data.token;

        const g = await json('/v1/admin/app-grants', { headers: { Authorization: `Bearer ${plainToken}` } });
        assert(g.status === 403, `app-grants expected 403, got ${g.status}`);
        const a = await json('/v1/admin/agents', { headers: { Authorization: `Bearer ${plainToken}` } });
        assert(a.status === 403, `agents expected 403, got ${a.status}`);
        const anon = await json('/v1/admin/app-grants');
        assert(anon.status === 401, `no credential expected 401, got ${anon.status}`);
    });


    console.log('\n─────────────────────────────────────');
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed === 0) console.log('✅ All tests passed!');
    process.exit(failed > 0 ? 1 : 0);
}

main();
