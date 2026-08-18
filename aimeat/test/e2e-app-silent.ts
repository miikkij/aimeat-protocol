/**
 * @file e2e-app-silent.ts
 * @description E2E for the seamless secure app SSO (H-2). Self-spawns a flag-on server and proves
 *   the silent bridge GET /v1/auth/app-grant-silent: the owner's OWN app (bound by its per-app
 *   subdomain origin) gets a scoped grant token from just the session cookie — no separate login —
 *   while another owner's app gets consent_required (no session leak), bad/non-subdomain origins are
 *   rejected, and a missing cookie yields login_required. Also checks the shim is injected into
 *   subdomain-served app HTML and the bridge page is framable only by app origins.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-app-silent.ts
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (H-2 seamless secure app SSO).
 *   v1.1.0 — 2026-07-19 — Phase 4 (scope-upgrade + own-app visible flow, Band Jam findings):
 *     silent re-request with MORE scopes upgrades the own-app grant in place (refresh follows);
 *     refresh_token never expands scopes on its own; the visible authorize flow rejects a
 *     redirect_uri on ANOTHER app's subdomain, exposes app_owner/origin_bound on the pending
 *     request, and the code exchange reports own=true only for the app's own origin-bound owner.
 *   v1.2.0 — 2026-08-11 — The subdomain-serve check addresses a real Host in the app family
 *     (helpers/host-request.ts). `x-app-origin` on its own stopped being an app origin when
 *     subdomain.ts v1.5.0 began requiring the Host to belong to the family it claims.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { hostRequest } from './helpers/host-request.js';

const PORT = process.env.E2E_SILENT_PORT ?? '40264';
const BASE = `http://localhost:${PORT}`;
const APP_HOST = 'apps.aimeat.test';
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-app-silent.db');

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

function setCookieHeaders(res: Response): string[] {
    const h: any = res.headers;
    return typeof h.getSetCookie === 'function' ? h.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean) as string[];
}
function extractRt(res: Response): string | null {
    for (const c of setCookieHeaders(res)) { const m = /(?:^|;\s*)aimeat_rt=([^;]*)/.exec(c); if (m) return decodeURIComponent(m[1]); }
    return null;
}
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers, rt: extractRt(res) };
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function cleanupDb() { for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { if (existsSync(f)) unlinkSync(f); } catch { /* */ } } }

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const env = {
        ...process.env, AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_APP_HOST: APP_HOST, AIMEAT_APP_ORIGIN_ENABLED: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', DB_PATH],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        try { if ((await fetch(`${BASE}/v1/spec`)).ok) return child; } catch { /* */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGTERM'); throw new Error('Server failed to start');
}

async function register(username: string): Promise<{ rt: string; token: string }> {
    const pw = 'SilentPw#2026';
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: pw }) });
    assert(reg.status === 201, `register ${username}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username, password: pw }) });
    assert(login.status === 200 && !!login.rt, `login ${username}: ${login.status}`);
    return { rt: login.rt!, token: login.body.data.token };
}
async function publish(token: string, filename: string, declaredScopes?: string): Promise<void> {
    // `declaredScopes` writes the app's own `<meta name="aimeat-scopes">`. That tag is what the node
    // reads when it decides whether a live grant still matches the app, so a test about drift needs
    // an app that actually declares something.
    const meta = declaredScopes ? `<meta name="aimeat-scopes" content="${declaredScopes}">` : '';
    const html = `<!DOCTYPE html><html><head>${meta}</head><body>app</body></html>`;
    const r = await json('/v1/apps', { method: 'POST', headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename, content: b64(html), name: filename, description: 'd', category: 'utility' }) });
    assert(r.status === 201, `publish ${filename}: ${r.status} ${JSON.stringify(r.body)}`);
}
async function assignSub(operatorToken: string, sub: string, target: string): Promise<void> {
    const r = await json('/v1/admin/subdomains', { method: 'POST', headers: { Authorization: `Bearer ${operatorToken}` },
        body: JSON.stringify({ subdomain: sub, kind: 'app', target }) });
    assert(r.status === 201, `assign ${sub}: ${r.status} ${JSON.stringify(r.body)}`);
}
/** Call the silent bridge endpoint as the apex bridge would: with the session cookie + app origin. */
async function silent(origin: string, scope: string, cookie: string | null, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
    if (cookie) headers['Cookie'] = `aimeat_rt=${encodeURIComponent(cookie)}`;
    const res = await fetch(`${BASE}/v1/auth/app-grant-silent?origin=${encodeURIComponent(origin)}&scope=${encodeURIComponent(scope)}`, { headers });
    const body = await res.json() as any;
    return body.data as { ok: boolean; error?: string; access_token?: string; scope?: string; refresh_token?: string; own?: boolean };
}
/** Start the VISIBLE authorize flow (PKCE) and return { status, requestId, body, verifier, redirect }. */
async function authorize(app: string, scope: string, redirectUri: string) {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
        app, response_type: 'code', scope, redirect_uri: redirectUri,
        code_challenge: challenge, code_challenge_method: 'S256',
    });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const loc = res.headers.get('location') ?? '';
    const m = /req=([^&]+)/.exec(loc);
    const body = res.status === 302 ? null : await res.json().catch(() => null) as any;
    return { status: res.status, requestId: m ? decodeURIComponent(m[1]) : null, body, verifier, redirect: redirectUri };
}
/** Approve a pending request as `token`'s owner and exchange the code (PKCE) for the token response. */
async function consentAndExchange(requestId: string, verifier: string, redirectUri: string, token: string) {
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ request_id: requestId }),
    });
    assert(con.status === 200, `consent: ${con.status} ${JSON.stringify(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }),
    });
    assert(tok.status === 200, `token: ${tok.status} ${JSON.stringify(tok.body)}`);
    return tok.body.data as { access_token: string; scope: string; app?: string; own?: boolean; refresh_token: string };
}

async function main() {
    const server = await startServer();
    try {
        const a = `silenta${Date.now() % 100000}`;   // owner A — also operator (first owner)
        const bn = `silentb${(Date.now() + 1) % 100000}`; // owner B
        console.log('\n=== H-2 Seamless Secure App SSO E2E ===\n');
        console.log('Phase 0: Setup (two owners, two apps, two subdomains)');

        const A = await register(a);
        const B = await register(bn);
        await publish(A.token, 'app-a.html');
        await publish(B.token, 'app-b.html');
        await assignSub(A.token, 'aaa', `${a}/app-a.html`); // A operator assigns both
        await assignSub(A.token, 'bbb', `${bn}/app-b.html`);
        // A third app of B's, used ONLY by the re-consent case below. That case has to leave a live
        // grant behind to have something to widen, and Phase 2 asserts that A holds no grant on B's
        // app at all — so the two cannot share a fixture.
        // …and it DECLARES one permission, which is the fact the drift tests turn on: a grant that
        // carries more than this is a grant the app itself no longer asks for.
        await publish(B.token, 'app-c.html', 'memory:read');
        await assignSub(A.token, 'ccc', `${bn}/app-c.html`);
        const ORIGIN_A = `https://aaa.${APP_HOST}`;
        const ORIGIN_B = `https://bbb.${APP_HOST}`;
        const ORIGIN_C = `https://ccc.${APP_HOST}`;

        console.log('\nPhase 1: Owner gets their OWN app token silently (no separate login)');
        await test('logged-in owner A → own app (aaa) issues a scoped token from the cookie alone', async () => {
            const r = await silent(ORIGIN_A, 'memory:read', A.rt);
            assert(r.ok === true, `expected ok, got ${JSON.stringify(r)}`);
            assert(!!r.access_token, 'access_token present');
            assert(r.scope === 'memory:read', `scope, got ${r.scope}`);
        });
        await test('that app token actually works (reads owner A memory namespace)', async () => {
            const r0 = await silent(ORIGIN_A, 'memory:read', A.rt);
            const v = await json('/v1/memory?limit=1', { headers: { Authorization: `Bearer ${r0.access_token}` } });
            assert(v.status === 200, `memory read with app token should pass, got ${v.status}`);
        });
        await test('app token with storage:write can POST /v1/storage (H-2: app role, not just agent)', async () => {
            const r0 = await silent(ORIGIN_A, 'storage:write', A.rt);
            assert(r0.ok && !!r0.access_token, `expected a storage token, got ${JSON.stringify(r0)}`);
            const up = await json('/v1/storage', {
                method: 'POST', headers: { Authorization: `Bearer ${r0.access_token}` },
                body: JSON.stringify({ key: 'shot.png', mime_type: 'image/png', visibility: 'private', data: b64('PNGBYTES') }),
            });
            assert(up.status === 200 || up.status === 201, `app token storage write should pass, got ${up.status} ${JSON.stringify(up.body)}`);
        });
        await test('app token WITHOUT storage scope is refused at /v1/storage (scope still enforced)', async () => {
            const r0 = await silent(ORIGIN_A, 'memory:read', A.rt); // memory-only token
            const up = await json('/v1/storage', {
                method: 'POST', headers: { Authorization: `Bearer ${r0.access_token}` },
                body: JSON.stringify({ key: 'nope.png', mime_type: 'image/png', visibility: 'private', data: b64('X') }),
            });
            assert(up.status === 403, `memory-only token must be denied storage write, got ${up.status}`);
        });

        /**
         * A grant used to be a SNAPSHOT of what the app declared the day it was made. Every later
         * refresh minted from that stored list without re-reading the app, so an app could narrow
         * its `<meta name="aimeat-scopes">` and keep the wider grant for as long as it kept
         * refreshing. Measured on aimeat.io on 2026-08-18: of 108 live grants, 2 matched the app's
         * current declaration and 106 carried permissions the app no longer asks for.
         *
         * Two directions, two answers, and the difference is the whole point: taking a permission
         * away needs nobody's approval, and gaining one needs the person's.
         */
        console.log('\nPhase 1b: A grant follows the app, and widening asks again');

        await test('a stranger\'s app that asks for LESS has its live grant narrowed, with no prompt', async () => {
            // A approves two permissions for B's app through the visible screen.
            const r0 = await authorize(`${bn}/app-c.html`, 'memory:read memory:write', `${ORIGIN_C}/callback`);
            assert(r0.status === 302 && !!r0.requestId, `authorize: ${r0.status}`);
            const granted = await consentAndExchange(r0.requestId!, r0.verifier, `${ORIGIN_C}/callback`, A.token);
            assert(granted.scope === 'memory:read memory:write', `approved scope, got ${granted.scope}`);

            // The app is updated and now asks for one. No consent screen: nobody has to approve
            // losing a permission, and a prompt here would train people to click through the one
            // that matters.
            const narrow = await silent(ORIGIN_C, 'memory:read', A.rt);
            assert(narrow.ok === true, `narrowing should be silent, got ${JSON.stringify(narrow)}`);
            assert(narrow.scope === 'memory:read', `the grant must follow the app down, got ${narrow.scope}`);

            // …and it is the stored grant that moved, not just this one token.
            const refreshed = await json('/v1/app-grants/token', {
                method: 'POST',
                body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: narrow.refresh_token }),
            });
            assert(refreshed.status === 200, `refresh: ${refreshed.status} ${JSON.stringify(refreshed.body)}`);
            assert(refreshed.body.data.scope === 'memory:read',
                `a refresh must not resurrect the wider grant, got ${refreshed.body.data.scope}`);
        });

        await test('a refresh alone brings a stale grant down to what the app declares', async () => {
            // The case the silent bridge cannot reach: an app that lives on refresh tokens and never
            // does another handshake. Its grant used to keep the old snapshot for as long as it kept
            // refreshing. app-c declares memory:read; this grant is approved for two.
            const r0 = await authorize(`${bn}/app-c.html`, 'memory:read memory:write', `${ORIGIN_C}/callback`);
            assert(r0.status === 302 && !!r0.requestId, `authorize: ${r0.status}`);
            const granted = await consentAndExchange(r0.requestId!, r0.verifier, `${ORIGIN_C}/callback`, A.token);
            assert(granted.scope === 'memory:read memory:write', `approved scope, got ${granted.scope}`);

            const refreshed = await json('/v1/app-grants/token', {
                method: 'POST',
                body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: granted.refresh_token }),
            });
            assert(refreshed.status === 200, `refresh: ${refreshed.status} ${JSON.stringify(refreshed.body)}`);
            assert(refreshed.body.data.scope === 'memory:read',
                `the refresh must follow the app's declaration, got ${refreshed.body.data.scope}`);
        });

        await test('a STRANGER\'s app that asks for MORE is sent back to consent, and the reply says why', async () => {
            // Owner A approves owner B's app once, through the visible screen, for one permission.
            const first = await authorize(`${bn}/app-c.html`, 'memory:read', `${ORIGIN_C}/callback`);
            assert(first.status === 302 && !!first.requestId, `authorize: ${first.status}`);
            await consentAndExchange(first.requestId!, first.verifier, `${ORIGIN_C}/callback`, A.token);

            // The same permission afterwards is silent — the approval is remembered.
            const same = await silent(ORIGIN_C, 'memory:read', A.rt);
            assert(same.ok === true, `a remembered approval must stay silent, got ${JSON.stringify(same)}`);

            // The app is updated and now wants one more. That is the moment the person has to be
            // asked again, and told which permission is the new one.
            const wider = await silent(ORIGIN_C, 'memory:read memory:write', A.rt);
            assert(wider.ok === false, `widening must not be silent, got ${JSON.stringify(wider)}`);
            assert(wider.error === 'consent_required', `expected consent_required, got ${wider.error}`);
            assert((wider as any).reason === 'app_updated', `expected reason app_updated, got ${(wider as any).reason}`);
            assert((wider as any).added === 'memory:write', `the new permission must be named, got ${(wider as any).added}`);

            // Refused means refused: the grant still carries only what was approved.
            const still = await silent(ORIGIN_C, 'memory:read', A.rt);
            assert(still.ok === true && still.scope === 'memory:read',
                `the refused widening must not have been written, got ${JSON.stringify(still)}`);
        });

        console.log('\nPhase 2: Security — no cross-user / cross-app leakage');
        await test('a NON-OPERATOR owner cannot point a subdomain at anybody\'s app', async () => {
            // The premise of everything above: an app origin is bound to the app whose owner controls
            // it. That binding is what the silent grant trusts when it decides whose session may be
            // turned into a scoped token — and both mappings here are assigned with A's token, where
            // A is the first owner on this suite's own fresh database and therefore the auto-promoted
            // operator. So replacing `...operatorOnly` with `requireAuth()` on POST
            // /v1/admin/subdomains leaves the whole suite green while any owner points a subdomain at
            // another owner's app.
            //
            // B is a plain owner. Their own app is not the point — the point is that the mapping is
            // not theirs to make.
            const own = await json('/v1/admin/subdomains', {
                method: 'POST', headers: { Authorization: `Bearer ${B.token}` },
                body: JSON.stringify({ subdomain: 'ccc', kind: 'app', target: `${bn}/app-b.html` }),
            });
            assert(own.status === 403, `a plain owner mapped a subdomain to their own app: ${own.status} ${JSON.stringify(own.body?.error)}`);

            const theirs = await json('/v1/admin/subdomains', {
                method: 'POST', headers: { Authorization: `Bearer ${B.token}` },
                body: JSON.stringify({ subdomain: 'ddd', kind: 'app', target: `${a}/app-a.html` }),
            });
            assert(theirs.status === 403, `a plain owner pointed a subdomain at ANOTHER owner's app: ${theirs.status}`);

            // And nothing was created, so no origin now resolves to a binding nobody approved.
            const ddd = await silent(`https://ddd.${APP_HOST}`, 'memory:read', B.rt);
            assert(ddd.ok === false, `the refused mapping still produced a working origin: ${JSON.stringify(ddd)}`);
        });
        await test('owner A on ANOTHER owner\'s app (bbb) → consent_required (session NOT leaked)', async () => {
            const r = await silent(ORIGIN_B, 'memory:read', A.rt);
            assert(r.ok === false && r.error === 'consent_required', `expected consent_required, got ${JSON.stringify(r)}`);
        });
        await test('an app is bound to its OWN subdomain origin — cannot request another app', async () => {
            // origin aaa always resolves to A's app; there is no way to ask for bbb's app from aaa.
            const r = await silent(ORIGIN_A, 'memory:read', A.rt);
            assert(r.ok === true, 'aaa → A own app ok'); // and bbb (above) is gated — apps can't cross.
        });
        await test('no session cookie → login_required (cannot authenticate silently)', async () => {
            const r = await silent(ORIGIN_A, 'memory:read', null);
            assert(r.ok === false && r.error === 'login_required', `expected login_required, got ${JSON.stringify(r)}`);
        });
        await test('non-subdomain origin (bare app host) → bad_origin', async () => {
            const r = await silent(`https://${APP_HOST}`, 'memory:read', A.rt);
            assert(r.ok === false && r.error === 'bad_origin', `expected bad_origin, got ${JSON.stringify(r)}`);
        });
        await test('apex origin → bad_origin (the apex itself is never an app origin)', async () => {
            const r = await silent(BASE, 'memory:read', A.rt);
            assert(r.ok === false && r.error === 'bad_origin', `expected bad_origin, got ${JSON.stringify(r)}`);
        });
        await test('ungrantable scope → invalid_scope', async () => {
            const r = await silent(ORIGIN_A, 'operator:all', A.rt);
            assert(r.ok === false && r.error === 'invalid_scope', `expected invalid_scope, got ${JSON.stringify(r)}`);
        });
        await test('unknown subdomain → unknown_app', async () => {
            const r = await silent(`https://nope.${APP_HOST}`, 'memory:read', A.rt);
            assert(r.ok === false && r.error === 'unknown_app', `expected unknown_app, got ${JSON.stringify(r)}`);
        });

        // SECURITY (C-1, 2026-08 audit): the app identity comes from `?origin=`, a value the caller
        // writes, and the endpoint reads the session cookie. App origins are SAME-SITE with the apex,
        // so SameSite=Strict sends the cookie: without a caller check, owner B's app could name an app
        // owner A owns and read back a token minted for A. `Sec-Fetch-Site` separates the apex bridge
        // (same-origin) from an app origin (same-site), and neither header can be set from script.
        await test('an app origin calling the bridge directly → bad_caller, no token (C-1)', async () => {
            const r = await silent(ORIGIN_A, 'memory:read memory:write', A.rt, {
                'Sec-Fetch-Site': 'same-site',
                'Origin': `https://evil.${APP_HOST}`,
            });
            assert(r.ok === false && r.error === 'bad_caller', `expected bad_caller, got ${JSON.stringify(r)}`);
            assert(!r.access_token, 'no token may be issued to a non-apex caller');
        });
        await test('a cross-site page calling the bridge → bad_caller (C-1)', async () => {
            const r = await silent(ORIGIN_A, 'memory:read', A.rt, { 'Sec-Fetch-Site': 'cross-site' });
            assert(r.ok === false && r.error === 'bad_caller', `expected bad_caller, got ${JSON.stringify(r)}`);
        });
        await test('an Origin header that is not the apex → bad_caller (C-1)', async () => {
            const r = await silent(ORIGIN_A, 'memory:read', A.rt, { 'Origin': `https://evil.${APP_HOST}` });
            assert(r.ok === false && r.error === 'bad_caller', `expected bad_caller, got ${JSON.stringify(r)}`);
        });
        await test('the apex bridge page itself still gets its token (C-1 does not break the flow)', async () => {
            const r = await silent(ORIGIN_A, 'memory:read', A.rt, { 'Sec-Fetch-Site': 'same-origin', 'Origin': BASE });
            assert(r.ok === true && !!r.access_token, `apex bridge must still work, got ${JSON.stringify(r)}`);
        });

        console.log('\nPhase 3: Wiring — shim injected, bridge framable only by app origins');
        await test('app HTML on the per-app subdomain is served (the SDK does the SSO itself)', async () => {
            // A real Host in the app family, not just the marker: since subdomain.ts v1.5.0 the
            // marker is only honoured on a Host that belongs to the family it claims.
            const res = await hostRequest(BASE, '/', `aaa.${APP_HOST}:${PORT}`, {
                headers: { 'x-app-origin': '1', 'x-subdomain': 'aaa' },
            });
            assert(res.status === 200, `subdomain serve: ${res.status}`);
        });
        await test('GET /app-silent.html is framable only by *.appHost (frame-ancestors, no X-Frame-Options)', async () => {
            const res = await fetch(`${BASE}/app-silent.html`);
            assert(res.status === 200, `bridge page: ${res.status}`);
            const csp = res.headers.get('content-security-policy') || '';
            assert(/frame-ancestors[^;]*\*\.apps\.aimeat\.test/.test(csp), `frame-ancestors should allow *.appHost, got: ${csp}`);
            assert(!res.headers.get('x-frame-options'), 'X-Frame-Options must be removed so app origins can frame it');
        });
        await test('GET /app-login.js and /app-silent.js serve', async () => {
            const a1 = await fetch(`${BASE}/app-login.js`); assert(a1.status === 200, `app-login.js: ${a1.status}`);
            const a2 = await fetch(`${BASE}/app-silent.js`); assert(a2.status === 200, `app-silent.js: ${a2.status}`);
        });

        console.log('\nPhase 4: Scope upgrades + own-app visible flow (Band Jam findings)');
        await test('own-app silent re-request with MORE scopes upgrades the grant in place', async () => {
            const r1 = await silent(ORIGIN_A, 'memory:read', A.rt);
            assert(r1.ok && r1.scope === 'memory:read', `initial narrow grant, got ${JSON.stringify(r1)}`);
            const r2 = await silent(ORIGIN_A, 'memory:read memory:write ai:use', A.rt);
            assert(r2.ok === true, `upgrade should auto-approve for the own app, got ${JSON.stringify(r2)}`);
            const s2 = (r2.scope || '').split(' ');
            assert(s2.includes('memory:write') && s2.includes('ai:use'), `upgraded scopes, got ${r2.scope}`);
            // The GRANT RECORD (not just the token) carries the new scopes: a refresh follows it.
            const ref = await json('/v1/app-grants/token', {
                method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: r2.refresh_token }),
            });
            assert(ref.status === 200, `refresh: ${ref.status}`);
            const rs = (ref.body.data.scope || '').split(' ');
            assert(rs.includes('memory:write') && rs.includes('ai:use'), `refresh reflects upgraded grant, got ${ref.body.data.scope}`);
        });
        await test('refresh_token never expands scopes on its own (follows the stored grant only)', async () => {
            const r1 = await silent(ORIGIN_B, 'memory:read', B.rt); // B's own app, narrow grant
            assert(r1.ok && !!r1.refresh_token, `B own-app grant, got ${JSON.stringify(r1)}`);
            const ref = await json('/v1/app-grants/token', {
                method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: r1.refresh_token }),
            });
            assert(ref.status === 200, `refresh: ${ref.status}`);
            assert(ref.body.data.scope === 'memory:read', `refresh must not widen, got ${ref.body.data.scope}`);
        });
        await test('visible authorize REJECTS a redirect_uri on another app\'s subdomain', async () => {
            const r = await authorize(`${a}/app-a.html`, 'memory:read', `${ORIGIN_B}/callback`);
            assert(r.status === 400, `expected 400, got ${r.status}`);
            assert(r.body?.error?.code === 'INVALID_REDIRECT_URI', `expected INVALID_REDIRECT_URI, got ${JSON.stringify(r.body?.error)}`);
        });
        await test('visible authorize on the app\'s OWN subdomain → request is origin_bound with app_owner', async () => {
            const r = await authorize(`${a}/app-a.html`, 'memory:read', `${ORIGIN_A}/callback`);
            assert(r.status === 302 && !!r.requestId, `authorize: ${r.status}`);
            const det = await json(`/v1/app-grants/request/${r.requestId}`);
            assert(det.status === 200, `request: ${det.status}`);
            assert(det.body.data.app_owner === a, `app_owner, got ${det.body.data.app_owner}`);
            assert(det.body.data.origin_bound === true, `origin_bound, got ${det.body.data.origin_bound}`);
        });
        await test('code exchange reports own=true when the app\'s own owner approves a bound request', async () => {
            const r = await authorize(`${a}/app-a.html`, 'memory:read', `${ORIGIN_A}/callback`);
            assert(r.status === 302 && !!r.requestId, `authorize: ${r.status}`);
            const tok = await consentAndExchange(r.requestId!, r.verifier, r.redirect, A.token);
            assert(tok.own === true, `own should be true, got ${JSON.stringify(tok.own)}`);
            assert(tok.app === `${a}/app-a.html`, `app echoed, got ${tok.app}`);
        });
        await test('code exchange reports own=false when ANOTHER owner approves the same app', async () => {
            const r = await authorize(`${a}/app-a.html`, 'memory:read', `${ORIGIN_A}/callback`);
            assert(r.status === 302 && !!r.requestId, `authorize: ${r.status}`);
            const tok = await consentAndExchange(r.requestId!, r.verifier, `${ORIGIN_A}/callback`, B.token);
            assert(tok.own === false, `own should be false for a non-owner, got ${JSON.stringify(tok.own)}`);
        });
        await test('bare app-host redirect (path-form app) stays allowed but NOT origin_bound', async () => {
            const r = await authorize(`${a}/app-a.html`, 'memory:read', `https://${APP_HOST}/apps/a/callback`);
            assert(r.status === 302 && !!r.requestId, `authorize: ${r.status}`);
            const det = await json(`/v1/app-grants/request/${r.requestId}`);
            assert(det.body.data.origin_bound === false, `origin_bound must be false, got ${det.body.data.origin_bound}`);
            const tok = await consentAndExchange(r.requestId!, r.verifier, `https://${APP_HOST}/apps/a/callback`, A.token);
            assert(tok.own === false, `unbound request never earns own even for the owner, got ${JSON.stringify(tok.own)}`);
        });

        console.log('\n─────────────────────────────────────');
        console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
        if (failed === 0) console.log('✅ All tests passed!');
    } finally {
        server.kill('SIGTERM');
        setTimeout(() => { if (!server.killed) server.kill('SIGKILL'); }, 3000);
        await new Promise(r => setTimeout(r, 500));
        cleanupDb();
    }
    process.exit(failed > 0 ? 1 : 0);
}
main();
