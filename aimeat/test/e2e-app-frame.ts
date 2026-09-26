/**
 * @file e2e-app-frame.ts
 * @description E2E for apps on a node that several people share and that has no app origin (audit
 *   A7-1). Such an app runs in an isolated frame that shares no session with the node's own pages.
 *   Self-spawns a node with the app origin OFF and a fresh database, and proves:
 *     - one owner: the app is served on the node's own address exactly as before;
 *     - a second owner joins: a browser that opens an app gets the frame page and never the app's
 *       bytes; the bytes come only under a Content-Security-Policy `sandbox` without
 *       allow-same-origin (an opaque origin: no cookie, no storage and no session of the node), for
 *       every way they are asked for, a draft preview included;
 *     - the frame page gets the app its OWN scoped grant from the session cookie (the owner's own
 *       app silently, another person's app only through consent), the grant works from an opaque
 *       origin, and it is not the session: an owner-only door refuses it;
 *     - the app cannot mint a grant from inside the frame, and a consent redirect naming another
 *       app's address is refused.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-app-frame.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { waitForServer } from './helpers/wait-for-server.js';

const PORT = process.env.E2E_APP_FRAME_PORT ?? '40266';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-app-frame.db');

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
/** A GET that keeps the raw body and headers, for the page and the app bytes. */
async function page(path: string, headers: Record<string, string> = {}) {
    const res = await fetch(`${BASE}${path}`, { headers, redirect: 'manual' });
    return { status: res.status, headers: res.headers, text: await res.text() };
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** What a browser sends when a person opens a link (a top-level navigation). */
const NAVIGATION = { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', Accept: 'text/html' };
/** What a browser sends when a page loads a document into an iframe of its own. */
const IN_FRAME = { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin', Accept: 'text/html' };

/** The tokens of the CSP `sandbox` directive, or null when the policy has none. */
function sandboxOf(csp: string): string[] | null {
    const d = csp.split(';').map(s => s.trim()).find(s => s === 'sandbox' || s.startsWith('sandbox '));
    return d ? d.split(/\s+/).slice(1) : null;
}
function directive(csp: string, name: string): string {
    return (csp.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' ')) ?? '').slice(name.length + 1);
}

function cleanupDb() { for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { if (existsSync(f)) unlinkSync(f); } catch { /* */ } } }

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const env: Record<string, string | undefined> = {
        ...process.env, AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        // The case under test: no app origin. The host is left out so it derives to nothing.
        AIMEAT_APP_ORIGIN_ENABLED: 'false',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000',
    };
    delete env.AIMEAT_APP_HOST;
    const child = spawn('node', [...nodeEntryArgs(), 'start', '--db', 'sqlite', '--db-path', DB_PATH],
        { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the app-frame node' });
}

async function register(username: string): Promise<{ rt: string; token: string }> {
    const pw = 'FramePw#2026';
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: pw }) });
    assert(reg.status === 201, `register ${username}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username, password: pw }) });
    assert(login.status === 200 && !!login.rt, `login ${username}: ${login.status}`);
    return { rt: login.rt!, token: login.body.data.token };
}

/**
 * An app that says who it is and tries the one thing an app on the node's own address could always
 * do: read the signed-in person's stored session. In the isolated frame that read has nothing to find.
 */
function appHtml(marker: string): string {
    return '<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="memory:read memory:write">'
        + `<title>${marker}</title></head><body><h1 id="m">${marker}</h1>`
        + '<script>window.__probe=(function(){try{return JSON.parse(localStorage.getItem("aimeat_session")||"null")}catch(e){return "blocked"}})();</script>'
        + '</body></html>';
}
async function publish(token: string, filename: string, marker: string): Promise<void> {
    const r = await json('/v1/apps', { method: 'POST', headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename, content: b64(appHtml(marker)), name: filename, description: 'd', category: 'utility' }) });
    assert(r.status === 201, `publish ${filename}: ${r.status} ${JSON.stringify(r.body)}`);
}

/** Call the grant door the way the frame page does: same-origin, with the session cookie. */
async function frameGrant(app: string, scope: string, cookie: string | null, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', ...extraHeaders };
    if (cookie) headers.Cookie = `aimeat_rt=${encodeURIComponent(cookie)}`;
    const res = await fetch(`${BASE}/v1/auth/app-grant-silent?app=${encodeURIComponent(app)}&scope=${encodeURIComponent(scope)}`, { headers });
    const body = await res.json() as any;
    return body.data as { ok: boolean; error?: string; access_token?: string; refresh_token?: string; scope?: string; own?: boolean; app?: string };
}

/** Start the VISIBLE authorize flow (PKCE) and return what it answered. */
async function authorize(app: string, scope: string, redirectUri: string) {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
        app, response_type: 'code', response_mode: 'web_message', scope, redirect_uri: redirectUri,
        code_challenge: challenge, code_challenge_method: 'S256',
    });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const loc = res.headers.get('location') ?? '';
    const m = /req=([^&]+)/.exec(loc);
    const body = res.status === 302 ? null : await res.json().catch(() => null) as any;
    return { status: res.status, requestId: m ? decodeURIComponent(m[1]) : null, body, verifier, redirect: redirectUri };
}
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
    return tok.body.data as { access_token: string; scope: string; app?: string; own?: boolean };
}

async function main() {
    const server = await startServer();
    try {
        const a = `framea${Date.now() % 100000}`;       // the first owner, and the operator
        const bn = `frameb${(Date.now() + 7) % 100000}`; // the second person who joins
        const SOLO = 'solo.html', OTHER = 'other.html';
        console.log('\n=== Apps in an isolated frame on a shared node without an app origin (A7-1) ===\n');

        console.log('Phase 1: one owner — nothing changes');
        const A = await register(a);
        await publish(A.token, SOLO, 'MARK-SOLO');
        await test('one owner: opening the app serves the app itself on the node\'s own address', async () => {
            const r = await page(`/v1/apps/${a}/${SOLO}?mode=inline`, NAVIGATION);
            assert(r.status === 200, `status ${r.status}`);
            assert(r.text.includes('MARK-SOLO'), 'the app\'s own bytes are the page');
            assert(sandboxOf(r.headers.get('content-security-policy') ?? '') === null,
                `no sandbox on a node only one person uses, got ${r.headers.get('content-security-policy')}`);
        });
        await test('one owner: the frame grant door hands out nothing', async () => {
            const r = await frameGrant(`${a}/${SOLO}`, 'memory:read', A.rt);
            assert(r.ok === false && !r.access_token, `expected no grant, got ${JSON.stringify(r)}`);
        });

        console.log('\nPhase 2: a second person joins — every app moves into the isolated frame');
        const B = await register(bn);
        await publish(B.token, OTHER, 'MARK-OTHER');
        // The node re-reads how many people it serves at most a couple of seconds late.
        let host = await page(`/v1/apps/${bn}/${OTHER}?mode=inline`, NAVIGATION);
        for (let i = 0; i < 20 && host.text.includes('MARK-OTHER'); i++) {
            await new Promise(r => setTimeout(r, 300));
            host = await page(`/v1/apps/${bn}/${OTHER}?mode=inline`, NAVIGATION);
        }
        await test('two owners: opening another person\'s app gets the frame page, never the app\'s bytes', async () => {
            assert(host.status === 200, `status ${host.status}`);
            assert((host.headers.get('content-type') ?? '').includes('text/html'), 'an HTML page');
            assert(!host.text.includes('MARK-OTHER'), 'the app\'s own bytes must not be the page on the node\'s address');
            assert(host.text.includes('/app-frame.js'), 'the page loads the frame script');
            const csp = host.headers.get('content-security-policy') ?? '';
            assert(directive(csp, 'frame-ancestors') === "'self'", `the frame page is framed only by the node itself, got ${csp}`);
            assert(!directive(csp, 'script-src').includes("'unsafe-inline'"), `the frame page runs no inline script, got ${csp}`);
        });
        await test('two owners: the owner\'s own app is framed the same way', async () => {
            const r = await page(`/v1/apps/${a}/${SOLO}?mode=inline`, NAVIGATION);
            assert(r.status === 200 && !r.text.includes('MARK-SOLO') && r.text.includes('/app-frame.js'),
                `expected the frame page, got ${r.status} ${r.text.slice(0, 200)}`);
        });
        await test('the app\'s bytes come into the frame only in an opaque-origin sandbox', async () => {
            const r = await page(`/v1/apps/${bn}/${OTHER}?mode=frame`, IN_FRAME);
            assert(r.status === 200, `status ${r.status}`);
            assert(r.text.includes('MARK-OTHER'), 'the frame gets the app');
            assert(!(r.headers.get('content-disposition') ?? '').includes('attachment'), 'runnable, not a download');
            const sb = sandboxOf(r.headers.get('content-security-policy') ?? '');
            assert(!!sb && sb.includes('allow-scripts'), `a sandbox that lets the app run, got ${JSON.stringify(sb)}`);
            assert(!sb!.includes('allow-same-origin'), 'never allow-same-origin: that flag would hand the app the node\'s origin');
            const fa = directive(r.headers.get('content-security-policy') ?? '', 'frame-ancestors');
            assert(!fa.includes('*'), `framed by the node only, got ${fa}`);
        });
        await test('a caller that is not a browser also gets the bytes only in the sandbox', async () => {
            const r = await page(`/v1/apps/${bn}/${OTHER}?mode=inline`);
            assert(r.status === 200 && r.text.includes('MARK-OTHER'), `status ${r.status}`);
            const sb = sandboxOf(r.headers.get('content-security-policy') ?? '');
            assert(!!sb && !sb.includes('allow-same-origin'), `sandboxed without allow-same-origin, got ${JSON.stringify(sb)}`);
        });
        await test('the frame support script runs before the app\'s own first script', async () => {
            const r = await page(`/v1/apps/${bn}/${OTHER}?mode=frame`, IN_FRAME);
            const shim = r.text.indexOf('__AIMEAT_FRAME__');
            const own = r.text.indexOf('window.__probe');
            assert(shim >= 0, 'the frame support script is in the document');
            assert(own > shim, 'and it comes first');
        });
        await test('a draft preview is framed the same way', async () => {
            const put = await json(`/v1/apps/${a}/${SOLO}/draft`, { method: 'PUT', headers: { Authorization: `Bearer ${A.token}` },
                body: JSON.stringify({ content: b64(appHtml('MARK-DRAFT')) }) });
            assert(put.status === 200, `draft save: ${put.status} ${JSON.stringify(put.body)}`);
            const pt = await json(`/v1/apps/${a}/${SOLO}/draft/preview-token`, { method: 'POST', headers: { Authorization: `Bearer ${A.token}` } });
            assert(pt.status === 200, `preview token: ${pt.status}`);
            const tok = encodeURIComponent(pt.body.data.token);
            const nav = await page(`/v1/apps/${a}/${SOLO}?mode=inline&preview=${tok}`, NAVIGATION);
            assert(nav.status === 200 && !nav.text.includes('MARK-DRAFT') && nav.text.includes('/app-frame.js'),
                `the preview link opens the frame page, got ${nav.status} ${nav.text.slice(0, 120)}`);
            const fr = await page(`/v1/apps/${a}/${SOLO}?mode=frame&preview=${tok}`, IN_FRAME);
            assert(fr.status === 200 && fr.text.includes('MARK-DRAFT'), `the frame gets the draft, got ${fr.status}`);
            const sb = sandboxOf(fr.headers.get('content-security-policy') ?? '');
            assert(!!sb && !sb.includes('allow-same-origin'), `the draft is sandboxed too, got ${JSON.stringify(sb)}`);
        });
        await test('the frame script is served fresh, and the node\'s libraries answer an opaque origin', async () => {
            const js = await page('/app-frame.js');
            assert(js.status === 200 && /javascript/.test(js.headers.get('content-type') ?? ''), `frame script: ${js.status}`);
            assert((js.headers.get('cache-control') ?? '').includes('no-cache'), `revalidated on every load, got ${js.headers.get('cache-control')}`);
            const lib = await fetch(`${BASE}/lib/chartjs@4.js`, { headers: { Origin: 'null' } });
            assert(lib.headers.get('access-control-allow-origin') === '*', `a /lib file is readable from the frame, got ${lib.headers.get('access-control-allow-origin')}`);
        });

        console.log('\nPhase 3: the app talks to the node with its own grant');
        let ownToken = '';
        await test('the frame page gets the owner\'s own app its own scoped grant from the cookie', async () => {
            const r = await frameGrant(`${a}/${SOLO}`, 'memory:read memory:write', A.rt);
            assert(r.ok === true && !!r.access_token, `expected a grant, got ${JSON.stringify(r)}`);
            assert(r.own === true, 'the owner\'s own app');
            assert(r.scope === 'memory:read memory:write', `the declared scopes, got ${r.scope}`);
            ownToken = r.access_token!;
        });
        await test('the grant works from the frame\'s opaque origin', async () => {
            const res = await fetch(`${BASE}/v1/memory?limit=1`, { headers: { Origin: 'null', Authorization: `Bearer ${ownToken}` } });
            assert(res.status === 200, `memory read with the app grant, got ${res.status}`);
            assert(res.headers.get('access-control-allow-origin') === 'null', `the browser lets the frame read it, got ${res.headers.get('access-control-allow-origin')}`);
        });
        await test('the grant is not the session: an owner-only door refuses it', async () => {
            const res = await fetch(`${BASE}/v1/auth/sessions`, { headers: { Authorization: `Bearer ${ownToken}` } });
            assert(res.status === 403, `an app grant must not list the person's sign-ins, got ${res.status}`);
        });
        await test('another person\'s app gets nothing without consent', async () => {
            const r = await frameGrant(`${bn}/${OTHER}`, 'memory:read', A.rt);
            assert(r.ok === false && r.error === 'consent_required' && !r.access_token, `expected consent_required, got ${JSON.stringify(r)}`);
        });
        await test('the app cannot mint a grant from inside the frame', async () => {
            const r = await frameGrant(`${a}/${SOLO}`, 'memory:read', A.rt, { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' });
            assert(r.ok === false && r.error === 'bad_caller', `expected bad_caller, got ${JSON.stringify(r)}`);
        });
        await test('consent for another person\'s app completes on the frame page\'s own address', async () => {
            const redirect = `${BASE}/v1/apps/${bn}/${OTHER}`;
            const r = await authorize(`${bn}/${OTHER}`, 'memory:read', redirect);
            assert(r.status === 302 && !!r.requestId, `authorize: ${r.status} ${JSON.stringify(r.body)}`);
            const tok = await consentAndExchange(r.requestId!, r.verifier, redirect, A.token);
            assert(!!tok.access_token && tok.own === false, `a grant that is not the approver's own, got ${JSON.stringify({ own: tok.own })}`);
            const again = await frameGrant(`${bn}/${OTHER}`, 'memory:read', A.rt);
            assert(again.ok === true && !!again.access_token, `once approved, the frame page gets it silently, got ${JSON.stringify(again)}`);
        });
        await test('the owner\'s own app is recognised in the consent flow on its own address', async () => {
            const r = await authorize(`${a}/${SOLO}`, 'memory:read', `${BASE}/v1/apps/${a}/${SOLO}`);
            assert(r.status === 302 && !!r.requestId, `authorize: ${r.status}`);
            const det = await json(`/v1/app-grants/request/${r.requestId}`);
            assert(det.body.data.origin_bound === true && det.body.data.app_owner === a, `bound to the app, got ${JSON.stringify(det.body.data)}`);
        });
        await test('a consent redirect naming another app\'s address, or any other page, is refused', async () => {
            const wrongApp = await authorize(`${bn}/${OTHER}`, 'memory:read', `${BASE}/v1/apps/${a}/${SOLO}`);
            assert(wrongApp.status === 400 && wrongApp.body?.error?.code === 'INVALID_REDIRECT_URI', `another app's address: ${wrongApp.status}`);
            const spa = await authorize(`${bn}/${OTHER}`, 'memory:read', `${BASE}/v1/profile`);
            assert(spa.status === 400 && spa.body?.error?.code === 'INVALID_REDIRECT_URI', `a node page: ${spa.status}`);
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
