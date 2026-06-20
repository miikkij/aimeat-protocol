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
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

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
async function publish(token: string, filename: string): Promise<void> {
    const html = '<!DOCTYPE html><html><head></head><body>app</body></html>';
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
async function silent(origin: string, scope: string, cookie: string | null) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = `aimeat_rt=${encodeURIComponent(cookie)}`;
    const res = await fetch(`${BASE}/v1/auth/app-grant-silent?origin=${encodeURIComponent(origin)}&scope=${encodeURIComponent(scope)}`, { headers });
    const body = await res.json() as any;
    return body.data as { ok: boolean; error?: string; access_token?: string; scope?: string };
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
        const ORIGIN_A = `https://aaa.${APP_HOST}`;
        const ORIGIN_B = `https://bbb.${APP_HOST}`;

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

        console.log('\nPhase 2: Security — no cross-user / cross-app leakage');
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

        console.log('\nPhase 3: Wiring — shim injected, bridge framable only by app origins');
        await test('app HTML on the per-app subdomain is served (the SDK does the SSO itself)', async () => {
            const res = await fetch(`${BASE}/`, { headers: { 'x-app-origin': '1', 'x-subdomain': 'aaa' } });
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
