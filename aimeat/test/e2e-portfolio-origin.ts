/**
 * @file e2e-portfolio-origin.ts
 * @description E2E for the portfolio origin (`<username>.portfolio.<apex>`). Self-spawns a
 *   server with the portfolio origin provisioned (AIMEAT_PORTFOLIO_ORIGIN_ENABLED=true,
 *   AIMEAT_PORTFOLIO_HOST=portfolio.aimeat.test) — the shared CI runner keeps the flag OFF,
 *   so this suite owns its server. Verifies:
 *     - the origin serves the published portfolio at / (x-portfolio-origin + x-subdomain),
 *       with the standalone bridge injected (aimeat-auth.js + portfolio-standalone.js +
 *       memory:read scopes meta) and a CSP header;
 *     - the aimeat badge follows showBadge (default on, off when false);
 *     - uniform 404 for unknown users, reserved labels, and unpublished portfolios;
 *     - bare portfolio host 301s to the apex member showcase;
 *     - /v1 API is unaffected on the portfolio origin;
 *     - standalone_url is advertised on /v1/portfolio/config and data/:username.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-portfolio-origin.ts
 * @version-history
 *   v1.0.0 — 2026-07-03 — Initial (portfolio origin phases 0–5).
 *   v1.1.0 — 2026-08-12 — Every request that claims the portfolio origin now addresses one.
 *     subdomain.ts v1.5.0 honours `x-portfolio-origin` only on a Host in the portfolio family,
 *     because the header alone was enough to be served as an isolated origin from anywhere. The
 *     suite sent the marker to `localhost`, which is the shape the check exists to refuse, so it
 *     had been describing an attacker's request as the production one. `fetch` cannot set Host at
 *     all, hence the node:http helper.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostRequest, type HostResponse } from './helpers/host-request.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_PORTFOLIO_ORIGIN_PORT ?? '40263';
const BASE = `http://localhost:${PORT}`;
const PORTFOLIO_HOST = 'portfolio.aimeat.test';
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-portfolio-origin.db');
const BADGE_MARKER = 'Publish your own app';

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

/**
 * GET `path` as the portfolio origin actually receives it from nginx: a real Host in the portfolio
 * family plus the marker nginx stamps. Both halves are load-bearing since subdomain.ts v1.5.0 —
 * the marker counts only on a Host in its own family, and `fetch` cannot send a Host at all
 * (undici drops it as a forbidden header), so the helper opens the socket itself.
 *
 * `sub` is the username label, or null for the bare portfolio host.
 */
function portfolioGet(sub: string | null, path = '/'): Promise<HostResponse> {
    const host = sub ? `${sub}.${PORTFOLIO_HOST}:${PORT}` : `${PORTFOLIO_HOST}:${PORT}`;
    const headers: Record<string, string> = { 'x-portfolio-origin': '1' };
    if (sub) headers['x-subdomain'] = sub;
    return hostRequest(BASE, path, host, { headers });
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
        AIMEAT_PORTFOLIO_HOST: PORTFOLIO_HOST,
        AIMEAT_PORTFOLIO_ORIGIN_ENABLED: 'true',
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
        const owner = `pforigin${Date.now() % 100000}`;
        const HTML = '<!DOCTYPE html><html><head><title>t</title></head><body><h1>PORTFOLIO ORIGIN DEMO</h1></body></html>';
        let token = '';

        console.log('\n=== Portfolio Origin E2E ===\n');
        console.log('Setup (server flag ON, portfolio host ' + PORTFOLIO_HOST + ')');

        await test('register owner + token + agent', async () => {
            const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
            assert(status === 201, `owner status ${status}: ${JSON.stringify(body)}`);
            const priv = body.data.private_key;
            const ts = new Date().toISOString();
            const sig = await signMsg(priv, owner + NODE_ID + ts);
            const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp: ts, signature: sig }) });
            assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
            token = tok.body.data.token;
            const ag = await json('/v1/agents', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ name: 'pfagent', owner, capabilities: ['memory'] }),
            });
            assert(ag.status === 201, `agent status ${ag.status}: ${JSON.stringify(ag.body)}`);
        });

        await test('serve before publish → uniform 404', async () => {
            const r = await portfolioGet(owner);
            assert(r.status === 404, `expected 404, got ${r.status}`);
        });

        await test('publish portfolio (upload + enable)', async () => {
            const up = await fetch(`${BASE}/v1/portfolio/upload`, {
                method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/html' }, body: HTML,
            });
            assert(up.status === 200, `upload status ${up.status}`);
            const cfg = await json('/v1/portfolio/config', {
                method: 'PUT', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ enabled: true, tags: ['portfolio'] }),
            });
            assert(cfg.status === 200, `config status ${cfg.status}`);
        });

        console.log('\nServe on the portfolio origin');

        await test('GET / (x-portfolio-origin + x-subdomain) serves the portfolio HTML', async () => {
            const r = await portfolioGet(owner);
            assert(r.status === 200, `expected 200, got ${r.status}`);
            assert((r.header('content-type') ?? '').includes('text/html'), `content-type: ${r.header('content-type')}`);
            assert(r.body.includes('PORTFOLIO ORIGIN DEMO'), 'body contains the portfolio content');
        });

        await test('response carries a CSP header + nosniff', async () => {
            const r = await portfolioGet(owner);
            assert((r.header('content-security-policy') ?? '').includes('script-src'), 'CSP header present');
            assert(r.header('x-content-type-options') === 'nosniff', 'nosniff present');
        });

        await test('standalone bridge injected (auth SDK + shim + scopes meta)', async () => {
            const r = await portfolioGet(owner);
            assert(r.body.includes('/v1/libs/aimeat-auth.js'), 'aimeat-auth.js injected');
            assert(r.body.includes('/v1/libs/portfolio-standalone.js'), 'portfolio-standalone.js injected');
            assert(r.body.includes('name="aimeat-scopes"'), 'aimeat-scopes meta injected');
        });

        await test('aimeat badge present by default (showBadge unset)', async () => {
            const r = await portfolioGet(owner);
            assert(r.body.includes(BADGE_MARKER), 'badge injected by default');
        });

        await test('showBadge:false removes the badge', async () => {
            const cfg = await json('/v1/portfolio/config', {
                method: 'PUT', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ enabled: true, showBadge: false, tags: ['portfolio'] }),
            });
            assert(cfg.status === 200, `config status ${cfg.status}`);
            const r = await portfolioGet(owner);
            assert(r.status === 200, `expected 200, got ${r.status}`);
            assert(!r.body.includes(BADGE_MARKER), 'badge absent when showBadge=false');
        });

        console.log('\n404 parity + origin isolation');

        await test('unknown username → 404', async () => {
            const r = await portfolioGet('no-such-user-xyz');
            assert(r.status === 404, `expected 404, got ${r.status}`);
        });

        await test('reserved label → 404', async () => {
            const r = await portfolioGet('www');
            assert(r.status === 404, `expected 404, got ${r.status}`);
        });

        await test('unpublished (enabled:false) → 404', async () => {
            const cfg = await json('/v1/portfolio/config', {
                method: 'PUT', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ enabled: false, tags: ['portfolio'] }),
            });
            assert(cfg.status === 200, `config status ${cfg.status}`);
            const r = await portfolioGet(owner);
            assert(r.status === 404, `expected 404, got ${r.status}`);
            // Re-enable for the remaining tests.
            await json('/v1/portfolio/config', {
                method: 'PUT', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ enabled: true, showBadge: false, tags: ['portfolio'] }),
            });
        });

        await test('bare portfolio host (no label) 301s to the apex showcase', async () => {
            const r = await portfolioGet(null);
            assert(r.status === 301, `expected 301, got ${r.status}`);
            assert((r.header('location') ?? '').startsWith(BASE), `location: ${r.header('location')}`);
        });

        await test('/v1 API unaffected on the portfolio origin', async () => {
            const r = await portfolioGet(owner, '/v1/spec');
            assert(r.status === 200, `expected 200, got ${r.status}`);
        });

        console.log('\nAdvertised URLs + shim library');

        await test('/v1/portfolio/config advertises standalone_url', async () => {
            const { status, body } = await json('/v1/portfolio/config', { headers: { Authorization: `Bearer ${token}` } });
            assert(status === 200, `status ${status}`);
            assert(body.data?.standalone_url === `http://${owner}.${PORTFOLIO_HOST}:${PORT}/`,
                `standalone_url: ${body.data?.standalone_url}`);
        });

        await test('data/:username advertises standalone_url', async () => {
            const { status, body } = await json(`/v1/portfolio/data/${owner}`);
            assert(status === 200, `status ${status}`);
            assert(typeof body.data?.standalone_url === 'string' && body.data.standalone_url.includes(PORTFOLIO_HOST),
                `standalone_url: ${body.data?.standalone_url}`);
        });

        await test('GET /v1/libs/portfolio-standalone.js serves the shim', async () => {
            const res = await fetch(`${BASE}/v1/libs/portfolio-standalone.js`);
            assert(res.status === 200, `status ${res.status}`);
            const src = await res.text();
            assert(src.includes('aimeat-portfolio-fetch-result'), 'shim implements the bridge protocol');
            assert(src.includes(BASE), 'shim has the apex URL baked in');
        });
    } finally {
        server.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 500));
        cleanupDb();
    }

    console.log(`\n${'─'.repeat(40)}`);
    console.log(`Portfolio Origin E2E: ${passed} passed, ${failed} failed`);
    console.log(`${'─'.repeat(40)}\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
