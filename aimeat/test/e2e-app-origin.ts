/**
 * @file e2e-app-origin.ts
 * @description E2E for H-2 app-origin isolation (Phases 1–2). Self-spawns a server with the
 *   app origin provisioned (AIMEAT_APP_ORIGIN_ENABLED=true, AIMEAT_APP_HOST=apps.aimeat.test)
 *   — the shared CI runner keeps the flag OFF, so this suite owns its server. Verifies:
 *     - apex inline (runnable) app request 301s to the app origin (path form, or the
 *       assigned per-app subdomain when one exists);
 *     - the raw download form (attachment, not executed) still serves on apex;
 *     - the app origin serves app HTML via the path form (x-app-origin header) and via the
 *       subdomain form (x-app-origin + x-subdomain).
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-app-origin.ts
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phases 1–2).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_APP_ORIGIN_PORT ?? '40262';
const BASE = `http://localhost:${PORT}`;
const APP_HOST = 'apps.aimeat.test';
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-app-origin.db');

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

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const env = {
        ...process.env,
        AIMEAT_PORT: PORT,
        AIMEAT_BASE_URL: BASE,
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_APP_HOST: APP_HOST,
        AIMEAT_APP_ORIGIN_ENABLED: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000',
        // Phase 4 publishes 100 apps on purpose; the catalogue limiter must not be the thing
        // that stops it, or the scale assertion silently measures a smaller number.
        AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_BOARDS: '1000', AIMEAT_RL_CATALOGUE: '10000',
        // The per-owner app quota defaults to 50, and production is already past that (76), so a
        // scale test capped at 50 would measure less than reality. 200 keeps the headroom honest.
        AIMEAT_MAX_APPS_PER_AGENT: '200',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', DB_PATH],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        try { if ((await fetch(`${BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGTERM');
    throw new Error('Server failed to start');
}

async function main() {
    const server = await startServer();
    try {
        const owner = `apporigin${Date.now() % 100000}`;
        const filename = 'origin-demo.html';
        const HTML = '<!DOCTYPE html><html><body><h1>app origin demo</h1></body></html>';
        let token = '';

        console.log('\n=== H-2 App Origin Isolation E2E (Phases 1–2) ===\n');
        console.log('Phase 0: Setup (server flag ON, app host ' + APP_HOST + ')');

        await test('register owner', async () => {
            const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
            assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
            const priv = body.data.private_key;
            const ts = new Date().toISOString();
            const sig = await signMsg(priv, owner + NODE_ID + ts);
            const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp: ts, signature: sig }) });
            assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
            token = tok.body.data.token;
        });

        await test('publish an app', async () => {
            const { status, body } = await json('/v1/apps', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ filename, content: b64(HTML), name: 'Origin Demo', description: 'd', category: 'utility', tags: ['demo'] }),
            });
            assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        });

        // The app auto-gets a per-app subdomain derived from its filename ("origin-demo.html").
        const SUB = 'origin-demo';
        const sibFile = 'origin-sibling.html';
        const SUB2 = 'origin-sibling';

        await test('publish a second app for the same owner (the framer in Phase 5)', async () => {
            const r = await json('/v1/apps', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ filename: sibFile, content: b64(HTML), name: 'Sibling', description: 'd', category: 'utility', tags: [] }),
            });
            assert(r.status === 201, `sibling publish: ${r.status}`);
            await fetch(`${BASE}/v1/apps/${owner}/${sibFile}?mode=inline`, { redirect: 'manual' });
        });

        console.log('\nPhase 1: apex inline → 301 to the AUTO-ASSIGNED per-app subdomain (no manual step)');
        await test('apex GET ?mode=inline 301s to <auto-sub>.appHost', async () => {
            const res = await fetch(`${BASE}/v1/apps/${owner}/${filename}?mode=inline`, { redirect: 'manual' });
            assert(res.status === 301, `expected 301, got ${res.status}`);
            assert((res.headers.get('location') ?? '') === `http://${SUB}.${APP_HOST}:${PORT}/`, `unexpected Location: ${res.headers.get('location')}`);
        });

        await test('apex raw download (no mode) still serves on apex (attachment, not executed)', async () => {
            const res = await fetch(`${BASE}/v1/apps/${owner}/${filename}`, { redirect: 'manual' });
            assert(res.status === 200, `expected 200, got ${res.status}`);
            assert((res.headers.get('content-disposition') ?? '').includes('attachment'), 'download should be an attachment');
            assert((await res.text()) === HTML, 'download body matches');
        });

        console.log('\nPhase 2: bare-host path form auto-redirects to the per-app subdomain');
        await test('app-origin path form (x-app-origin) 302-redirects to the auto-assigned subdomain', async () => {
            const res = await fetch(`${BASE}/${owner}/${filename}`, { headers: { 'x-app-origin': '1' }, redirect: 'manual' });
            assert(res.status === 302, `expected 302, got ${res.status}`);
            assert((res.headers.get('location') ?? '') === `http://${SUB}.${APP_HOST}:${PORT}/`, `unexpected Location: ${res.headers.get('location')}`);
        });

        await test('app-origin path form ignores non-.html paths (API still reachable)', async () => {
            // /v1/spec on the app host must NOT be swallowed by the path-form app route.
            const res = await fetch(`${BASE}/v1/spec`, { headers: { 'x-app-origin': '1' } });
            assert(res.status === 200, `/v1/spec on app host should still 200, got ${res.status}`);
        });

        console.log('\nPhase 3: the per-app subdomain serves the app HTML with the SSO shim');
        await test('subdomain form (x-app-origin + x-subdomain) serves the app HTML at /', async () => {
            const res = await fetch(`${BASE}/`, { headers: { 'x-app-origin': '1', 'x-subdomain': SUB } });
            assert(res.status === 200, `expected 200, got ${res.status}`);
            const body = await res.text();
            assert(body.includes('app origin demo'), 'subdomain-served body contains the app content');
        });

        // ── Phase 4: the header must not grow with what the owner accumulates ───────────────
        // This is the test that was missing when frame-ancestors listed the owner's app origins:
        // it passed with two apps and took production down at 76, because the CSP header outgrew
        // the reverse proxy's buffer. The assertion is therefore a NUMBER and a COMPARISON, not
        // "the feature works".
        console.log('\nPhase 4: CSP header size is bounded and does NOT scale with app count');

        const cspOf = async (sub: string, query = '') => {
            const res = await fetch(`${BASE}/${query}`, { headers: { 'x-app-origin': '1', 'x-subdomain': sub } });
            return { csp: res.headers.get('content-security-policy') ?? '', res };
        };
        const headerBytes = (res: Response) => {
            let n = 0;
            res.headers.forEach((v, k) => { n += k.length + v.length + 4; });
            return n;
        };

        let cspSmall = '';
        await test('baseline CSP with few apps', async () => {
            const { csp } = await cspOf(SUB);
            cspSmall = csp;
            assert(csp.length > 0, 'expected a CSP header');
        });

        await test('publish 100 more apps for the SAME owner', async () => {
            for (let i = 0; i < 100; i++) {
                const f = `scale-${i}.html`;
                const r = await json('/v1/apps', {
                    method: 'POST', headers: { Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ filename: f, content: b64(HTML), name: `S${i}`, description: 'd', category: 'utility', tags: [] }),
                });
                assert(r.status === 201, `scale publish ${i}: ${r.status}`);
                // Assign each a subdomain, so they exist as potential ancestors.
                await fetch(`${BASE}/v1/apps/${owner}/${f}?mode=inline`, { redirect: 'manual' });
            }
        });

        await test('the CSP is BYTE-IDENTICAL at 100+ apps (nothing enumerated)', async () => {
            const { csp } = await cspOf(SUB);
            assert(csp === cspSmall, `CSP changed with app count.\n  before: ${cspSmall.length}B\n  after:  ${csp.length}B`);
        });

        await test('CSP stays under 2 KB and the whole header block under 4 KB (proxy buffer)', async () => {
            const { csp, res } = await cspOf(SUB);
            const total = headerBytes(res);
            // Printed, not just asserted: the previous failure was invisible precisely because
            // nothing ever reported a number.
            console.log(`     measured: CSP ${csp.length}B / 2048B budget · headers ${total}B / 4096B proxy buffer · 102 apps owned`);
            assert(csp.length < 2048, `CSP is ${csp.length}B, budget 2048B`);
            assert(total < 4096, `response headers total ${total}B, nginx default proxy_buffer_size is 4096B`);
        });

        // ── Phase 5: what a frame grant does, and what it refuses ──────────────────────────
        console.log('\nPhase 5: a frame grant names ONE origin, and fails closed');

        const FRAMER = `http://${SUB2}.${APP_HOST}:${PORT}`;
        let grantUrl = '';

        await test('minting a grant requires an Origin and returns a frame_url', async () => {
            const r = await json(`/v1/apps/${owner}/${filename}/frame-token`, {
                method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: FRAMER }, body: '{}',
            });
            assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body.error)}`);
            assert(r.body.data.granted_to === FRAMER, `granted_to ${r.body.data.granted_to}`);
            grantUrl = r.body.data.frame_url;
            assert(grantUrl.includes('frame='), `frame_url missing token: ${grantUrl}`);
        });

        await test('no Origin header → 400, never a grant to nobody', async () => {
            const r = await json(`/v1/apps/${owner}/${filename}/frame-token`, {
                method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}',
            });
            assert(r.status === 400, `expected 400, got ${r.status}`);
        });

        await test('a valid grant adds EXACTLY ONE ancestor', async () => {
            const q = '?' + grantUrl.split('?')[1];
            const { csp } = await cspOf(SUB, q);
            const fa = (csp.match(/frame-ancestors ([^;]*)/) ?? ['', ''])[1].trim();
            assert(fa.includes(FRAMER), `granted origin missing: ${fa}`);
            assert(fa.split(/\s+/).length === 3, `expected self + apex + one grant, got: ${fa}`);
        });

        await test('a grant for ANOTHER app does not widen this one', async () => {
            const r = await json(`/v1/apps/${owner}/${sibFile}/frame-token`, {
                method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: FRAMER }, body: '{}',
            });
            const otherToken = r.body.data.frame_url.split('frame=')[1];
            const { csp } = await cspOf(SUB, `?frame=${otherToken}`);
            const fa = (csp.match(/frame-ancestors ([^;]*)/) ?? ['', ''])[1].trim();
            assert(!fa.includes(FRAMER), `a grant for a different app must not apply here: ${fa}`);
        });

        await test('a garbage grant fails CLOSED (strict CSP, page still serves)', async () => {
            const { csp, res } = await cspOf(SUB, '?frame=not-a-token');
            assert(res.status === 200, `page must still serve, got ${res.status}`);
            const fa = (csp.match(/frame-ancestors ([^;]*)/) ?? ['', ''])[1].trim();
            assert(fa.split(/\s+/).length === 2, `expected self + apex only, got: ${fa}`);
        });

        await test('X-Frame-Options is dropped only WHEN a grant applies', async () => {
            const granted = await fetch(`${BASE}/?${grantUrl.split('?')[1]}`, { headers: { 'x-app-origin': '1', 'x-subdomain': SUB } });
            assert(granted.headers.get('x-frame-options') === null, 'with a grant the legacy header must be gone');
            const plain = await fetch(`${BASE}/`, { headers: { 'x-app-origin': '1', 'x-subdomain': SUB } });
            assert(plain.headers.get('x-frame-options') !== null, 'without a grant it must stay');
        });

        await test('another owner cannot mint a grant for someone else\'s app', async () => {
            const nm = `outsider${Date.now() % 100000}`;
            const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: nm, public_key: 'placeholder' }) });
            assert(reg.status === 201, `outsider register: ${reg.status} ${JSON.stringify(reg.body.error ?? '')}`);
            const ts = new Date().toISOString();
            const sig = await signMsg(reg.body.data.private_key, nm + NODE_ID + ts);
            const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: nm, timestamp: ts, signature: sig }) });
            const r = await json(`/v1/apps/${owner}/${filename}/frame-token`, {
                method: 'POST', headers: { Authorization: `Bearer ${tk.body.data.token}`, Origin: FRAMER }, body: '{}',
            });
            assert(r.status === 404, `outsider must not mint (expected 404, got ${r.status})`);
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
