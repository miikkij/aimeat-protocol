/**
 * @file test/e2e-secretary-disabled.ts
 * @description E2E for the Secretary + specialist agents when the feature is OFF (the prod default).
 *   Self-spawns a server with AIMEAT_SECRETARY_ENABLED=false — the shared CI runner pins it ON, so this
 *   suite owns its server. Verifies the hidden-by-default contract:
 *     - GET /v1/site/header-nav → features.secretary === false (the SPA shell gate);
 *     - the core Secretary + specialist routers are not mounted (404, not 401), so nothing is reachable;
 *     - the node otherwise boots and serves normally.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-secretary-disabled.ts
 * @version-history
 *   v1.0.0 — 2026-07-01 — Initial (Secretary opt-in / hidden-by-default path).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.E2E_SECRETARY_OFF_PORT ?? '40264';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-secretary-disabled.db');

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
        // The whole point of this suite: the Secretary feature is OFF. Set it explicitly so an ambient
        // AIMEAT_SECRETARY_ENABLED=true (e.g. exported in the shell) can't flip the server on.
        AIMEAT_SECRETARY_ENABLED: 'false',
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
        console.log('\n=== AIMEAT Secretary DISABLED E2E (opt-in / hidden-by-default) ===\n');

        await test('server boots + serves /v1/spec with the feature off', async () => {
            const { status } = await json('/v1/spec');
            assert(status === 200, `status ${status}`);
        });

        await test('GET /v1/site/header-nav → features.secretary === false', async () => {
            const { status, body } = await json('/v1/site/header-nav');
            assert(status === 200, `status ${status}`);
            assert(body.data.features && typeof body.data.features === 'object', 'features should be an object');
            assert(body.data.features.secretary === false, `expected features.secretary=false, got ${JSON.stringify(body.data.features)}`);
        });

        // A not-mounted route returns 404; a mounted-but-unauthenticated route would return 401. Asserting
        // 404 (not 401) proves the router is genuinely absent, not merely gated by auth.
        await test('POST /v1/specialists → 404 (specialists router not mounted)', async () => {
            const { status } = await json('/v1/specialists', { method: 'POST', body: JSON.stringify({ name: 'x', role: 'specialist' }) });
            assert(status === 404, `expected 404, got ${status}`);
        });

        await test('POST /v1/secretary/clarify → 404 (secretary router not mounted)', async () => {
            const { status } = await json('/v1/secretary/clarify', { method: 'POST', body: JSON.stringify({}) });
            assert(status === 404, `expected 404, got ${status}`);
        });
    } finally {
        server.kill('SIGTERM');
        setTimeout(() => { if (!server.killed) server.kill('SIGKILL'); }, 3000);
    }

    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
