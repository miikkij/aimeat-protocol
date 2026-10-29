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
 *   2026-10-29 — The first visit after an erased name's portfolio origin passed to its next holder
 *     clears the old storage once; an unchanged holder's visits clear nothing (secaudit2026oct26
 *     round 8c, origin-handed-to-next-name-holder).
 *   2026-10-17 — A switched-off page's file answers 404 anonymously and 403 to another owner, and
 *     the owner still reads it (plan doc-mvcn6c7e4e5q, V0.3). Asserts the hole closed the same day:
 *     the file was public. The suite now refuses a second principal and left the exemptions.
 *   2026-10-16 — The node(s) this suite starts follow the run's backend (test/helpers/own-node-db.ts); they were SQLite on both runs (QA audit P1-02).
 *   v1.0.0 — 2026-07-03 — Initial (portfolio origin phases 0–5).
 *   v1.1.0 — 2026-08-12 — Every request that claims the portfolio origin now addresses one.
 *     subdomain.ts v1.5.0 honours `x-portfolio-origin` only on a Host in the portfolio family,
 *     because the header alone was enough to be served as an isolated origin from anywhere. The
 *     suite sent the marker to `localhost`, which is the shape the check exists to refuse, so it
 *     had been describing an attacker's request as the production one. `fetch` cannot set Host at
 *     all, hence the node:http helper.
 */
import { nodeEntryArgs } from './helpers/node-entry.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostRequest, type HostResponse } from './helpers/host-request.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { ownNodeDb } from './helpers/own-node-db.js';

const PORT = process.env.E2E_PORTFOLIO_ORIGIN_PORT ?? '28263';
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
    const db = await ownNodeDb(String(PORT), { sqlitePath: DB_PATH });
    const env = {
        ...process.env,
        ...db.env,
        AIMEAT_PORT: PORT,
        AIMEAT_BASE_URL: BASE,
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_PORTFOLIO_HOST: PORTFOLIO_HOST,
        AIMEAT_PORTFOLIO_ORIGIN_ENABLED: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000',
        AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_BOARDS: '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the portfolio-origin node' });
}

async function main() {
    const server = await startServer();
    try {
        const owner = `pforigin${Date.now() % 100000}`;
        const HTML = '<!DOCTYPE html><html><head><title>t</title></head><body><h1>PORTFOLIO ORIGIN DEMO</h1></body></html>';
        let token = '';
        let pageFileUrl = '';

        console.log('\n=== Portfolio Origin E2E ===\n');
        console.log('Setup (server flag ON, portfolio host ' + PORTFOLIO_HOST + ')');

        await test('register owner + token + agent', async () => {
            token = (await registerOwner(BASE, owner)).token;
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
            // The page's FILE is not a second way in (plan doc-mvcn6c7e4e5q, V0.3): the stored page
            // was a public file, readable at /v1/pub after its owner took it off the web.
            const meta = await json('/v1/portfolio/config', { headers: { Authorization: `Bearer ${token}` } });
            const fileUrl = meta.body.data?.html?.url as string | undefined;
            assert(!!fileUrl, `config names the stored page: ${JSON.stringify(meta.body.data?.html)}`);
            const anon = await fetch(`${BASE}${fileUrl}`);
            assert(anon.status === 404, `the switched-off page is readable anonymously at its file address: ${anon.status}`);
            const own = await fetch(`${BASE}${fileUrl}`, { headers: { Authorization: `Bearer ${token}` } });
            assert(own.status === 200 && (await own.text()).includes('PORTFOLIO ORIGIN DEMO'), `the owner previews the page: ${own.status}`);
            pageFileUrl = fileUrl!;
            // Re-enable for the remaining tests.
            await json('/v1/portfolio/config', {
                method: 'PUT', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ enabled: true, showBadge: false, tags: ['portfolio'] }),
            });
        });

        await test('a second signed-in owner is refused the page file (403)', async () => {
            assert(!!pageFileUrl, 'the previous test recorded the page file address');
            const otherToken = (await registerOwner(BASE, `pfother${Date.now() % 100000}`)).token;
            const other = await fetch(`${BASE}${pageFileUrl}`, { headers: { Authorization: `Bearer ${otherToken}` } });
            assert(other.status === 403, `another owner read the page file: ${other.status}`);
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

        // secaudit2026oct26 round 8c (routes/subdomains.ts:ensureAppSubdomain:origin-handed-to-next-name-holder).
        // The portfolio origin's label is the account name, and an erased name can be registered again
        // by somebody else. Visitors' browsers still hold what the old portfolio stored on that origin;
        // the first visit after the holder changed clears it once, as an app origin does.
        const visitPortfolio = async (sub: string, cookie?: string) => {
            const r = await hostRequest(BASE, '/', `${sub}.${PORTFOLIO_HOST}:${PORT}`, {
                headers: { 'x-portfolio-origin': '1', 'x-subdomain': sub, Accept: 'text/html', ...(cookie ? { Cookie: cookie } : {}) },
            });
            const set = /aimeat_origin_owner=[^;]*/.exec(r.header('set-cookie') ?? '')?.[0];
            return { status: r.status, clear: r.header('clear-site-data'), cookie: set ?? cookie };
        };
        const publishPortfolio = async (tok: string) => {
            const up = await fetch(`${BASE}/v1/portfolio/upload`, {
                method: 'PUT', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'text/html' }, body: HTML,
            });
            assert(up.status === 200, `upload status ${up.status}`);
            const cfg = await json('/v1/portfolio/config', {
                method: 'PUT', headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify({ enabled: true, tags: ['portfolio'] }),
            });
            assert(cfg.status === 200, `config status ${cfg.status}`);
        };

        await test('usage: a portfolio origin that keeps its holder keeps its visitors\' storage across visits', async () => {
            const first = await visitPortfolio(owner);
            const second = await visitPortfolio(owner, first.cookie);
            const third = await visitPortfolio(owner, second.cookie);
            assert(first.status === 200 && second.status === 200 && third.status === 200, `served: ${first.status} ${second.status} ${third.status}`);
            assert(!first.clear && !second.clear && !third.clear, `an unchanged origin cleared its storage: ${first.clear} ${second.clear} ${third.clear}`);
        });

        await test('the first visit after an erased name\'s portfolio origin passed to its next holder clears the old storage, once', async () => {
            const name = `pfreuse${Date.now() % 100000}`;
            const first = await registerOwner(BASE, name);
            await publishPortfolio(first.token);
            const before = await visitPortfolio(name);
            assert(before.status === 200 && !before.clear && !!before.cookie, `the first visit marks the origin's holder: ${JSON.stringify(before)}`);
            const del = await json(`/v1/owners/${name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${first.token}` } });
            assert(del.status === 200, `erase the holder: ${del.status} ${JSON.stringify(del.body?.error)}`);
            const next = await registerOwner(BASE, name);
            await publishPortfolio(next.token);
            const after = await visitPortfolio(name, before.cookie);
            assert(after.status === 200 && /"storage"/.test(after.clear ?? ''), `the old portfolio's storage stays readable to the next holder: ${JSON.stringify(after)}`);
            const again = await visitPortfolio(name, after.cookie);
            assert(again.status === 200 && !again.clear, `cleared again on the next visit: ${again.clear}`);
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
