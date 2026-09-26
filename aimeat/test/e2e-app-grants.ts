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
 *   v1.4.1 — 2026-09-26 — The work-door comment says work:request is askable by an app now; the
 *     grant it tests holds no work word, so what it asserts is unchanged.
 *   v1.4.0 — 2026-09-16 — Phase 5b: openrouter.apikey and commerce.psp show no credential on any
 *     generic memory door (app grant, owner, operator), and the generic write doors refuse them.
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

    console.log('\nPhase 5b: The two records that hold a credential show no credential on any memory door');
    // THE LEAK: openrouter.apikey and commerce.psp are ordinary memory records. The owner's AI key
    // and the Stripe secrets inside them were returned whole (ciphertext, or a legacy plain value)
    // by every generic memory door, to an app grant with memory:read, to an agent with owner_scope
    // and to the operator. Those doors now show { configured: true } and a last-four hint.
    const AI_KEY = 'sk-or-e2e-owner-own-key-5d2b';
    const STRIPE_KEY = 'sk_test_e2e_generic_doors_71e0';
    const HOOK = 'whsec_e2e_generic_doors_c4a9';
    let readToken = '';
    const noCredential = (door: string, body: unknown) => {
        const text = JSON.stringify(body);
        for (const s of [AI_KEY, STRIPE_KEY, HOOK]) assert(!text.includes(s), `${door} returned a credential in the clear`);
        assert(!text.includes('"encrypted"'), `${door} returned a credential's ciphertext: ${text.slice(0, 240)}`);
        // A snippet or an excerpt carries a stretch of the value without its field name, so the
        // ciphertext itself is looked for too: iv:authTag:ct in hex (services/encryption.ts).
        assert(!/[0-9a-f]{24}:[0-9a-f]{32}/.test(text), `${door} returned a stretch of a credential's ciphertext: ${text.slice(0, 240)}`);
    };
    await test('setup: the owner stores an AI key and Stripe secrets through their own routes', async () => {
        const ai = await json('/v1/openrouter/settings', {
            method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ apiKey: AI_KEY }),
        });
        assert(ai.status === 200, `AI key: ${ai.status} ${JSON.stringify(ai.body?.error)}`);
        const st = await json('/v1/commerce/payout/stripe', {
            method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ secret_key: STRIPE_KEY, webhook_secret: HOOK }),
        });
        assert(st.status === 200, `Stripe: ${st.status} ${JSON.stringify(st.body?.error)}`);
        readToken = (await grantAppToken('memory:read')).access_token;
        assert(!!readToken, 'an app token with memory:read');
    });
    const doors: Array<[string, string]> = [
        ['GET /v1/memory/openrouter.apikey', '/v1/memory/openrouter.apikey'],
        ['GET /v1/memory/commerce.psp', '/v1/memory/commerce.psp'],
        ['GET /v1/memory/commerce.psp?owner_scope=true', '/v1/memory/commerce.psp?owner_scope=true'],
        ['GET /v1/memory', '/v1/memory?limit=500'],
        ['GET /v1/memory?prefix=commerce.', '/v1/memory?prefix=commerce.'],
        ['GET /v1/memory/search?q=apikey', '/v1/memory/search?q=apikey'],
        ['GET /v1/memory/search?q=psp', '/v1/memory/search?q=psp'],
        ['GET /v1/memory/export', '/v1/memory/export'],
        ['GET /v1/librarian/search?q=apikey', '/v1/librarian/search?q=apikey'],
        ['GET /v1/librarian/search?q=secretKey', '/v1/librarian/search?q=secretKey'],
    ];
    for (const [label, path] of doors) {
        await test(`${label} shows no credential, to the app and to the owner`, async () => {
            for (const [who, token] of [['app', readToken], ['owner', ownerToken]] as const) {
                const r = await json(path, { headers: { Authorization: `Bearer ${token}` } });
                noCredential(`${label} (${who}, ${r.status})`, r.body);
            }
        });
    }
    await test('the record still says a credential is set, with its last four characters', async () => {
        const r = await json('/v1/memory/commerce.psp', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(r.status === 200, `read ${r.status}`);
        assert(r.body.data.value.secretKey?.configured === true && r.body.data.value.secretKey?.hint === '…71e0',
            `secretKey shows configured and a hint: ${JSON.stringify(r.body.data.value)}`);
        const ai = await json('/v1/memory/openrouter.apikey', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(ai.body.data.value?.configured === true, `the AI key shows configured: ${JSON.stringify(ai.body.data.value)}`);
    });
    await test("the operator's memory screen shows no credential either", async () => {
        const ghii = encodeURIComponent(`${owner}@${NODE_ID}`);
        const get = await json(`/v1/admin/memory/${ghii}/commerce.psp`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(get.status === 200, `admin read ${get.status}`);
        noCredential('GET /v1/admin/memory/:owner/:key', get.body);
        const search = await json('/v1/admin/memory/search?q=secretKey', { headers: { Authorization: `Bearer ${ownerToken}` } });
        noCredential(`GET /v1/admin/memory/search (${search.status})`, search.body);
    });
    await test('the generic write doors refuse the two records, so a shown value cannot overwrite a key', async () => {
        const post = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ key: 'commerce.psp', value: { secretKey: { configured: true } } }),
        });
        assert(post.status === 403 && post.body?.error?.code === 'SECRET_RECORD', `POST: ${post.status} ${JSON.stringify(post.body?.error)}`);
        const put = await json('/v1/memory/openrouter.apikey', {
            method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ value: { configured: true }, version: 1 }),
        });
        assert(put.status === 403 && put.body?.error?.code === 'SECRET_RECORD', `PUT: ${put.status} ${JSON.stringify(put.body?.error)}`);
        const patch = await json('/v1/memory/commerce.psp', {
            method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ patch: { payTo: null } }),
        });
        assert(patch.status === 403 && patch.body?.error?.code === 'SECRET_RECORD', `PATCH: ${patch.status} ${JSON.stringify(patch.body?.error)}`);
        const imp = await json('/v1/memory/import', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ entries: [{ key: 'openrouter.apikey', value: { configured: true } }] }),
        });
        const failed = (imp.body?.data?.failed ?? []) as { key: string; reason: string }[];
        assert(failed.some(f => f.key === 'openrouter.apikey'), `import must refuse the record: ${JSON.stringify(imp.body).slice(0, 240)}`);
        // …and the credentials are still in place, because nothing overwrote them.
        const payout = await json('/v1/commerce/payout', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(payout.body.data.stripe?.configured === true, `Stripe still configured: ${JSON.stringify(payout.body.data.stripe)}`);
        const settings = await json('/v1/openrouter/settings', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(JSON.stringify(settings.body).includes('"hasApiKey":true'), `AI key still set: ${JSON.stringify(settings.body).slice(0, 200)}`);
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

    // A PERSON pressing a heart inside a published app. Until 2026-09-06 every board write from
    // every hosted app came back "Role \"agent\" required": the grant carries role 'app', which is
    // a sibling of 'agent' and satisfied neither. The scope is what fences an app here, and these
    // two cases are the whole rule — granted writes, ungranted is refused at the same door.
    await test('a granted app reacts, posts and subscribes on the person\'s behalf; an ungranted one cannot', async () => {
        const social = await grantAppToken('social:read social:write');
        const socialToken = social.access_token as string;
        const quiet = (await grantAppToken('memory:read')).access_token as string;

        const board = await json('/v1/boards', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ name: `grant-board-${Date.now() % 100000}`, description: 'app grant reactions', visibility: 'public' }),
        });
        assert(board.status === 201 || board.status === 200, `create board: ${board.status} ${JSON.stringify(board.body).slice(0, 160)}`);
        const boardId = board.body.data.board?.id ?? board.body.data.id;

        const post = await json(`/v1/boards/${boardId}/posts`, {
            method: 'POST', headers: { Authorization: `Bearer ${socialToken}` },
            body: JSON.stringify({ title: 'a tape', body: 'posted from inside an app' }),
        });
        assert(post.status === 201 || post.status === 200, `app post expected 2xx, got ${post.status} ${JSON.stringify(post.body.error ?? {})}`);
        const postId = post.body.data.post?.id ?? post.body.data.id;

        const react = await json(`/v1/boards/${boardId}/posts/${postId}/react`, {
            method: 'POST', headers: { Authorization: `Bearer ${socialToken}` },
            body: JSON.stringify({ reaction: '❤️' }),
        });
        assert(react.status === 200, `app react expected 200, got ${react.status} ${JSON.stringify(react.body.error ?? {})}`);

        const sub = await json(`/v1/boards/${boardId}/subscribe`, { method: 'POST', headers: { Authorization: `Bearer ${socialToken}` } });
        assert(sub.status === 200 || sub.status === 201, `app subscribe expected 2xx, got ${sub.status} ${JSON.stringify(sub.body.error ?? {})}`);

        // The fence: the same door, an app grant the owner never gave social:write to.
        const denied = await json(`/v1/boards/${boardId}/posts/${postId}/react`, {
            method: 'POST', headers: { Authorization: `Bearer ${quiet}` },
            body: JSON.stringify({ reaction: '❤️' }),
        });
        assert(denied.status === 403, `react without social:write expected 403, got ${denied.status}`);
        const deniedPost = await json(`/v1/boards/${boardId}/posts`, {
            method: 'POST', headers: { Authorization: `Bearer ${quiet}` },
            body: JSON.stringify({ title: 'no', body: 'no' }),
        });
        assert(deniedPost.status === 403, `post without social:write expected 403, got ${deniedPost.status}`);
        const anon = await json(`/v1/boards/${boardId}/posts/${postId}/react`, {
            method: 'POST', body: JSON.stringify({ reaction: '❤️' }),
        });
        assert(anon.status === 401, `no credential expected 401, got ${anon.status}`);
    });

    // The rest of the sweep: the doors written before role 'app' existed. Each one is the same
    // shape as the board reaction — a thing a PERSON does inside an app, refused because the
    // grant is not an agent. The scope beside each is what fences it, and four of these doors
    // carried no scope at all until now, so the widening had to add one.
    await test('the doors an app was refused by role alone now answer to the scope instead', async () => {
        const worker = (await grantAppToken('storage:write social:read')).access_token as string;
        const quiet = (await grantAppToken('memory:read')).access_token as string;
        const head = (tok: string) => ({ Authorization: `Bearer ${tok}` });

        // Not "it worked" but "it is no longer refused for being an app": a 403 naming the role is
        // the failure this closes. Anything else — 200, 404, 400 — means the door let us in and
        // the handler judged the request on its merits.
        async function admitted(path: string, method: string, tok: string, body?: any) {
            const r = await json(path, { method, headers: head(tok), body: body ? JSON.stringify(body) : undefined });
            assert(!(r.status === 403 && /Role "agent" required/.test(JSON.stringify(r.body.error ?? {}))),
                `${method} ${path} still refuses an app grant: ${r.status} ${JSON.stringify(r.body.error ?? {})}`);
            return r;
        }
        async function refused(path: string, method: string, tok: string, body?: any) {
            const r = await json(path, { method, headers: head(tok), body: body ? JSON.stringify(body) : undefined });
            assert(r.status === 403, `${method} ${path} without the scope expected 403, got ${r.status}`);
            return r;
        }

        await admitted('/v1/boards/subscriptions', 'GET', worker);
        await admitted('/v1/storage/upload/nope/0', 'PUT', worker);
        await refused('/v1/boards/subscriptions', 'GET', quiet);
        await refused('/v1/storage/upload/nope/0', 'PUT', quiet);

        // Work, disputes, the catalogue and actions are past the role gate too. This grant holds no
        // work word (`work:request` has been askable by an app since 2026-09-26, and `work:read` is
        // not in APP_GRANTABLE_SCOPES), so the refusal these assert is the SCOPE, never the role
        // again: the two are different failures, and only the scope is left to decide.
        for (const [path, method] of [['/v1/work/inbox', 'GET'], ['/v1/work/sent', 'GET'],
            ['/v1/work/overview', 'GET'], ['/v1/work/tc-does-not-exist/dispute', 'GET']] as const) {
            const r = await json(path, { method, headers: head(worker) });
            assert(r.status === 403, `${method} ${path} expected 403, got ${r.status}`);
            assert(!/Role "agent" required/.test(JSON.stringify(r.body.error ?? {})),
                `${method} ${path} must no longer refuse on the ROLE: ${JSON.stringify(r.body.error ?? {})}`);
        }
    });

    console.log('\nPhase 7: push:receive — an app registers ITS OWN device and reaches no other');

    // An installed app is its own origin, so allowing notifications inside it produces a second
    // endpoint, and what arrives there wears the app's name and icon rather than the node's. On iOS
    // that is the only way it ever does. The word that opens this is narrow on purpose: `push:manage`
    // lists and removes every device the person has, across every app and the node itself.
    const appDeviceEndpoint = `${BASE}/push-test-device/installed-app`;
    const otherDeviceEndpoint = `${BASE}/push-test-device/somebody-elses`;
    let pushAppToken = '';

    await test('an app holding push:receive registers a device, stamped with the app', async () => {
        pushAppToken = (await grantAppToken('push:receive')).access_token;
        assert(!!pushAppToken, 'push:receive app token minted');
        const r = await json('/v1/push/subscribe', {
            method: 'POST', headers: { Authorization: `Bearer ${pushAppToken}` },
            body: JSON.stringify({ endpoint: appDeviceEndpoint, keys: { p256dh: 'test-p256dh', auth: 'test-auth' } }),
        });
        assert(r.status === 201, `expected 201, got ${r.status} ${JSON.stringify(r.body)}`);
        // The app is read from the GRANT, never from the body: a caller naming its own app could
        // otherwise put the person's device into somebody else's stream.
        assert(r.body.data.subscription.app === `${owner}/${FILENAME}`,
            `expected the grant's app, got ${JSON.stringify(r.body.data.subscription.app)}`);
    });

    await test('push:receive does NOT open the list of every device the person has', async () => {
        const r = await json('/v1/push/subscriptions', { headers: { Authorization: `Bearer ${pushAppToken}` } });
        assert(r.status === 403, `listing stays behind push:manage; got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('an app cannot sign every device out by naming none', async () => {
        const r = await json('/v1/push/subscribe', {
            method: 'DELETE', headers: { Authorization: `Bearer ${pushAppToken}` },
        });
        assert(r.status === 400, `expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.error?.code === 'ENDPOINT_REQUIRED', `expected ENDPOINT_REQUIRED, got ${r.body.error?.code}`);
    });

    await test('an app cannot take back a device it did not register', async () => {
        // The owner's own browser registers one, the way the node's pages do.
        const mine = await json('/v1/push/subscribe', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ endpoint: otherDeviceEndpoint, keys: { p256dh: 'test-p256dh', auth: 'test-auth' } }),
        });
        assert(mine.status === 201, `owner subscribe ${mine.status}: ${JSON.stringify(mine.body)}`);

        const r = await json(`/v1/push/subscribe?endpoint=${encodeURIComponent(otherDeviceEndpoint)}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${pushAppToken}` },
        });
        // Absent and not-yours answer identically, so this cannot be used to ask which other apps
        // the person has allowed notifications in.
        assert(r.status === 404, `expected 404, got ${r.status} ${JSON.stringify(r.body)}`);

        // And it is still there: a refusal must not remove what it refused to remove.
        const list = await json('/v1/push/subscriptions', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(JSON.stringify(list.body.data).includes(otherDeviceEndpoint),
            `the owner's device must survive the refused delete: ${JSON.stringify(list.body.data)}`);
    });

    await test('an app CAN take back the device it registered itself', async () => {
        const r = await json(`/v1/push/subscribe?endpoint=${encodeURIComponent(appDeviceEndpoint)}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${pushAppToken}` },
        });
        assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log('\n─────────────────────────────────────');
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed === 0) console.log('✅ All tests passed!');
    process.exit(failed > 0 ? 1 : 0);
}

main();
