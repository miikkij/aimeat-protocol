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
        AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_BOARDS: '1000',
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

        console.log('\nPhase 1: apex inline → 301 app origin');
        await test('apex GET ?mode=inline 301-redirects to the app origin path form', async () => {
            const res = await fetch(`${BASE}/v1/apps/${owner}/${filename}?mode=inline`, { redirect: 'manual' });
            assert(res.status === 301, `expected 301, got ${res.status}`);
            const loc = res.headers.get('location') ?? '';
            assert(loc === `http://${APP_HOST}:${PORT}/${owner}/${filename}`, `unexpected Location: ${loc}`);
        });

        await test('apex raw download (no mode) still serves on apex (attachment, not executed)', async () => {
            const res = await fetch(`${BASE}/v1/apps/${owner}/${filename}`, { redirect: 'manual' });
            assert(res.status === 200, `expected 200, got ${res.status}`);
            assert((res.headers.get('content-disposition') ?? '').includes('attachment'), 'download should be an attachment');
            assert((await res.text()) === HTML, 'download body matches');
        });

        console.log('\nPhase 2: app origin serves app HTML');
        await test('app-origin path form (x-app-origin) serves the app HTML', async () => {
            const res = await fetch(`${BASE}/${owner}/${filename}`, { headers: { 'x-app-origin': '1' } });
            assert(res.status === 200, `expected 200, got ${res.status}`);
            assert((await res.text()) === HTML, 'app-origin body matches');
        });

        await test('app-origin path form ignores non-.html paths (API still reachable)', async () => {
            // /v1/spec on the app host must NOT be swallowed by the path-form app route.
            const res = await fetch(`${BASE}/v1/spec`, { headers: { 'x-app-origin': '1' } });
            assert(res.status === 200, `/v1/spec on app host should still 200, got ${res.status}`);
        });

        console.log('\nPhase 3: assigned per-app subdomain');
        await test('operator assigns a subdomain; apex inline then 301s to <sub>.appHost', async () => {
            const create = await json('/v1/admin/subdomains', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ subdomain: 'demo', kind: 'app', target: `${owner}/${filename}` }),
            });
            assert(create.status === 201, `subdomain create failed: ${create.status} ${JSON.stringify(create.body)}`);
            const res = await fetch(`${BASE}/v1/apps/${owner}/${filename}?mode=inline`, { redirect: 'manual' });
            assert(res.status === 301, `expected 301, got ${res.status}`);
            assert((res.headers.get('location') ?? '') === `http://demo.${APP_HOST}:${PORT}/`, `unexpected Location: ${res.headers.get('location')}`);
        });

        await test('app-origin subdomain form (x-app-origin + x-subdomain) serves the app HTML at /', async () => {
            const res = await fetch(`${BASE}/`, { headers: { 'x-app-origin': '1', 'x-subdomain': 'demo' } });
            assert(res.status === 200, `expected 200, got ${res.status}`);
            assert((await res.text()) === HTML, 'subdomain-served body matches');
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
