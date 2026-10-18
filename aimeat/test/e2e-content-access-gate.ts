/**
 * @file test/e2e-content-access-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A node set to signed-in content access (AIMEAT_CONTENT_ACCESS=signed-in) serves nothing
 *   to a caller who is not one of its accounts (plan doc-mvcn6c7e4e5q, V1.7).
 *
 *   THE GUARD. Every route the code declares (scripts/check-openapi-routes.ts --list) is called with
 *   no credential, on a node that also runs the shared anonymous identity, and must answer 401
 *   SIGN_IN_REQUIRED unless it is on the gate's open list (middleware/content-access-gate.ts). The
 *   open routes the code declares are compared with OPEN_CODE_ROUTES below, so a route opened to
 *   strangers is a change to this file a reviewer sees, never a side effect of a new router.
 *
 *   Then what the open list leaves a stranger: the shell without the node's apps in it, a robots.txt
 *   that disallows everything, the bootstrap saying `content_access`, an app origin that sends the
 *   browser to the open page and serves nothing itself, and a portfolio origin that answers 404. And
 *   what an account gets: the API, and an app opened through POST /v1/apps/:owner/:filename/open.
 *
 *   Self-spawns its own node (the shared runner keeps the node open), with the app and portfolio
 *   origins provisioned.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-content-access-gate
 * @version-history
 *   v1.0.1 — 2026-10-18 — The granted origin answers the grant with a 302 and the grant cookie, and
 *     serves on the cookie (plan doc-mvcn6c7e4e5q, V2).
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V1.7).
 */
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostRequest } from './helpers/host-request.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';

const PORT = process.env.E2E_CONTENT_GATE_PORT ?? '40265';
const BASE = `http://localhost:${PORT}`;
const APP_HOST = 'apps.gate.test';
const PORTFOLIO_HOST = 'portfolio.gate.test';
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-content-access-gate.db');

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/**
 * The routes the code declares that a stranger still reaches on a signed-in-only node. Each is on
 * OPEN_ROUTES in middleware/content-access-gate.ts with its reason. Adding one here is a decision
 * that a person without an account may call it.
 */
const OPEN_CODE_ROUTES = new Set<string>([
    // The shell, its files and the operator's own pages (no content in this mode).
    'GET /', 'GET /spa.html', 'GET /app-silent.html', 'GET /app-catalog.html', 'GET /everything', 'GET /start', 'GET /v1/portal', 'GET /v1/echat',
    'GET /v1/portfolio/{}', 'GET /v1/use-with-ai/{}/{}', 'GET /v1/connect', 'GET /v1/connect/{}', 'GET /v1/connect/install', 'GET /v1/connect/mcp.json',
    'GET /v1/privacy', 'GET /v1/privacy/{}', 'GET /v1/terms', 'GET /v1/terms/{}', 'GET /v1/admin/ui', 'GET /v1/admin/setup', 'GET /v1/agents/verify', 'GET /v1/oauth/consent',
    'GET /v1/site/header-nav', 'GET /v1/portal/cookie-consent.js', 'GET /v1/portal/platforms', 'GET /v1/portal/prompt/{}', 'GET /v1/portal/prompts', 'GET /v1/portal/prompts/{}',
    'GET /favicon.ico', 'GET /favicon.svg', 'GET /sw.js', 'GET /app-frame.js', 'GET /app-frame-core.js', 'GET /robots.txt', 'GET /{}.txt', 'GET /docs/specs/{}',
    // Sign-in, registration, recovery, invitations, setup.
    'GET /v1/auth/app-grant-silent', 'GET /v1/auth/challenge', 'GET /v1/auth/providers', 'GET /v1/auth/sessions', 'DELETE /v1/auth/sessions', 'DELETE /v1/auth/sessions/others', 'DELETE /v1/auth/sessions/{}',
    'POST /v1/auth/refresh', 'POST /v1/auth/revoke', 'POST /v1/auth/token', 'POST /v1/auth/token/exchange',
    'POST /v1/ghii', 'POST /v1/owners', 'POST /v1/ghii/register-web', 'POST /v1/ghii/verify-email', 'GET /v1/ghii/username-available',
    'POST /v1/ghii/login', 'POST /v1/ghii/login/attach-email', 'POST /v1/ghii/login/passkey/options', 'POST /v1/ghii/login/passkey/verify',
    'GET /v1/ghii/login/pending', 'GET /v1/ghii/login/{}', 'GET /v1/ghii/login/{}/callback', 'POST /v1/ghii/login/{}/finalize',
    'GET /v1/ghii/login/saml/{}', 'POST /v1/ghii/login/saml/{}/acs', 'POST /v1/ghii/login/saml/{}/finalize',
    'POST /v1/ghii/magic-link', 'GET /v1/ghii/magic-link/open', 'GET /v1/ghii/magic-link/verify', 'POST /v1/ghii/magic-link/second-factor',
    'POST /v1/ghii/totp/verify', 'POST /v1/ghii/account/recover', 'POST /v1/ghii/email/confirm', 'POST /v1/ghii/email/verify', 'POST /v1/ghii/password/reset', 'POST /v1/ghii/password/reset-request',
    'GET /v1/ghii/verify/eudiw/request', 'POST /v1/ghii/verify/eudiw', 'POST /v1/ghii/verify/eudiw/callback', 'GET /v1/ghii/verify/ftn/authorize', 'GET /v1/ghii/verify/ftn/callback', 'POST /v1/ghii/verify/ftn',
    'POST /v1/registration-invites', 'GET /v1/invitations/{}', 'POST /v1/invitations/{}/accept',
    'GET /v1/setup/status', 'GET /v1/setup/wizard', 'POST /v1/setup/init', 'POST /v1/admin/setup/auth', 'POST /v1/admin/setup/register', 'POST /v1/admin/setup/token', 'GET /v1/sso/{}/metadata',
    // Agents and apps becoming principals: MCP, OAuth, device authorization, app grants.
    'GET /v1/mcp', 'POST /v1/mcp', 'DELETE /v1/mcp', 'GET /v2/mcp/{}', 'POST /v2/mcp/{}', 'DELETE /v2/mcp/{}',
    'GET /v1/mcp/authorize', 'POST /v1/mcp/authorize-consent', 'POST /v1/mcp/register', 'POST /v1/mcp/token', 'POST /v1/mcp/token/revoke',
    'GET /.well-known/aimeat', 'GET /.well-known/api-catalog', 'GET /.well-known/did.json', 'GET /.well-known/http-message-signatures-directory',
    'GET /.well-known/oauth-authorization-server', 'GET /.well-known/oauth-protected-resource',
    'POST /v1/agents/device-authorize', 'POST /v1/agents/device-token', 'POST /v1/agents/verify', 'GET /v1/agents/device-authorize/pending', 'GET /v1/agents/verify/info/{}', 'POST /v1/agents/v2/token',
    'GET /v1/app-grants/authorize', 'GET /v1/app-grants/request/{}', 'GET /v1/app-grants/scopes', 'POST /v1/app-grants/authorize-consent', 'POST /v1/app-grants/token',
    'GET /v1/oauth-rounds/{}', 'POST /v1/oauth-rounds/{}/approve',
    // Routes that carry their own credential.
    'GET /v1/download/{}', 'PUT /v1/upload/{}', 'GET /v1/connections/media/{}/{}', 'GET /v1/outbound/unsubscribe', 'POST /v1/outbound/unsubscribe',
    'GET /v1/docsign/wallet', 'GET /v1/docsign/wallet/{}/document/{}', 'GET /v1/docsign/wallet/{}/request', 'POST /v1/docsign/wallet/response', 'POST /v1/docsign/wallet/{}/response', 'POST /',
    'POST /v1/commerce/webhooks/stripe/{}',
    // Federation: signed protocol messages and the handshake.
    'GET /v1/federation/node-card', 'GET /v1/federation/peer/introduce/{}/status', 'GET /v1/federation/peer/request/{}/status',
    'POST /v1/federation/auth/verify', 'POST /v1/federation/book/pull', 'POST /v1/federation/book/rebuild', 'POST /v1/federation/broadcast', 'POST /v1/federation/catalogue-sync',
    'POST /v1/federation/cross-node/work', 'POST /v1/federation/genesis-catalogue-ingest', 'POST /v1/federation/genesis-memory-read', 'POST /v1/federation/genesis-peer',
    'POST /v1/federation/heartbeat', 'POST /v1/federation/key-exchange', 'POST /v1/federation/link-invites', 'POST /v1/federation/memory/list', 'POST /v1/federation/message',
    'POST /v1/federation/message/receipt', 'POST /v1/federation/network-policy/pull', 'POST /v1/federation/package-claims/{}', 'POST /v1/federation/packages/pull',
    'POST /v1/federation/peer/activate', 'POST /v1/federation/peer/introduce', 'POST /v1/federation/peer/request', 'POST /v1/federation/peers', 'POST /v1/federation/peers/{}/promote',
    'POST /v1/federation/ping', 'POST /v1/federation/presence', 'POST /v1/federation/replicate', 'POST /v1/federation/route', 'POST /v1/federation/settle',
    'POST /v1/federation/settle/outbound', 'POST /v1/federation/storage/grant', 'POST /v1/federation/templates/sync', 'POST /v1/federation/test', 'POST /v1/federation/trust-advisory',
    // The node describing itself to machines.
    'GET /v1/health', 'GET /v1/build', 'GET /v1/spec', 'GET /llms.txt', 'GET /llms-full.txt', 'GET /AGENTS.md', 'GET /agents.txt', 'GET /auth.md', 'GET /skill.md', 'GET /openapi.json',
    'GET /v1/libs', 'GET /v1/libs/aimeat-auth.js', 'GET /v1/libs/aimeat-{}.js', 'GET /v1/libs/portfolio-standalone.js', 'GET /v1/libs/test-harness',
]);

function codeRoutes(): Array<{ method: string; path: string }> {
    const out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/check-openapi-routes.ts', '--list'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const rows: Array<{ method: string; path: string }> = [];
    for (const line of out.split('\n')) {
        const m = /^[ !-] (GET|POST|PUT|PATCH|DELETE) (\S+)/.exec(line);
        if (m) rows.push({ method: m[1], path: m[2] });
    }
    return rows;
}

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb(PORT, { sqlitePath: DB_PATH });
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_CONTENT_ACCESS: 'signed-in',
        // The shared anonymous identity is on, so a request with no credential carries one: the
        // gate must refuse it as it refuses no credential at all.
        AIMEAT_ANONYMOUS: 'true',
        AIMEAT_APP_HOST: APP_HOST, AIMEAT_APP_ORIGIN_ENABLED: 'true',
        AIMEAT_PORTFOLIO_HOST: PORTFOLIO_HOST, AIMEAT_PORTFOLIO_ORIGIN_ENABLED: 'true',
        AIMEAT_RL_GLOBAL: '100000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '10000',
        AIMEAT_RL_BOARDS: '10000', AIMEAT_RL_CATALOGUE: '10000', AIMEAT_RL_GHII: '10000', AIMEAT_RL_OWNERS: '10000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the signed-in-only node' });
}

async function main() {
    const server = await startServer();
    const owner = `gateowner${Date.now() % 100000}`;
    const other = `gateother${Date.now() % 100000}`;
    const filename = 'gate-demo.html';
    const APP_TEXT = 'GATE DEMO APP BODY';
    let token = '', otherToken = '';
    try {
        console.log('\n=== Signed-in content access: the node serves nothing to strangers ===\n');

        await test('an owner registers and signs in through the gate, and publishes an app', async () => {
            token = (await registerOwner(BASE, owner)).token;
            otherToken = (await registerOwner(BASE, other)).token;
            const pub = await json('/v1/apps', { method: 'POST', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ filename, content: b64(`<!DOCTYPE html><html><head><title>Gate Demo</title></head><body><h1>${APP_TEXT}</h1></body></html>`), name: 'Gate Demo', description: 'd', category: 'utility', tags: [] }) });
            assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body)}`);
        });

        await test('EVERY route the code declares refuses a stranger with 401 SIGN_IN_REQUIRED, outside the reviewed open list', async () => {
            const routes = codeRoutes();
            assert(routes.length > 1000, `the route list looks short: ${routes.length}`);
            const { isOpenRoute } = await import('../src/middleware/content-access-gate.js');
            const openDeclared: string[] = [];
            const leaks: string[] = [];
            for (const r of routes) {
                const path = r.path.replace(/\{\}/g, 'x');
                if (isOpenRoute(r.method, path)) { openDeclared.push(`${r.method} ${r.path}`); continue; }
                const res = await fetch(`${BASE}${path}`, { method: r.method, redirect: 'manual', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: r.method === 'GET' || r.method === 'DELETE' ? undefined : '{}' });
                let code = '';
                try { code = ((await res.json()) as any)?.error?.code ?? ''; } catch { /* not json */ }
                if (res.status !== 401 || code !== 'SIGN_IN_REQUIRED') leaks.push(`${r.method} ${r.path} → ${res.status} ${code}`);
            }
            assert(leaks.length === 0, `routes that answered a stranger something else:\n    ${leaks.join('\n    ')}`);
            const unexpected = openDeclared.filter(r => !OPEN_CODE_ROUTES.has(r));
            const gone = [...OPEN_CODE_ROUTES].filter(r => !openDeclared.includes(r));
            assert(unexpected.length === 0 && gone.length === 0,
                `the open routes changed. Newly open:\n    ${unexpected.join('\n    ')}\n  No longer declared:\n    ${gone.join('\n    ')}`);
        });

        await test('an account reads the API; the same read without one is refused', async () => {
            const mine = await json('/v1/apps', { headers: { Authorization: `Bearer ${token}` } });
            assert(mine.status === 200, `account read ${mine.status}`);
            const anon = await json('/v1/apps');
            assert(anon.status === 401 && anon.body.error?.code === 'SIGN_IN_REQUIRED', `anon read ${anon.status} ${JSON.stringify(anon.body.error)}`);
        });

        await test('the shell a stranger gets carries no app and says the node is signed-in only', async () => {
            const res = await fetch(`${BASE}/`, { headers: { Accept: 'text/html' } });
            const body = await res.text();
            assert(res.status === 200, `shell ${res.status}`);
            assert(!body.includes('Gate Demo'), 'the shell named an app');
            assert(body.includes('"contentAccess":"signed-in"'), 'window.__SITE does not say signed-in');
            const md = await fetch(`${BASE}/?format=md`);
            assert(!(await md.text()).includes('Gate Demo'), 'the markdown front page named an app');
        });

        await test('robots.txt disallows everything, and the bootstrap says content_access', async () => {
            const robots = await (await fetch(`${BASE}/robots.txt`)).text();
            assert(/Disallow: \/\s*$/m.test(robots), `robots: ${robots}`);
            const boot = await json('/?format=json');
            assert(boot.body.data?.this_node?.content_access === 'signed-in', `bootstrap: ${JSON.stringify(boot.body.data?.this_node)}`);
        });

        await test('an app origin sends a stranger\'s browser to the open page and serves none of the app', async () => {
            await fetch(`${BASE}/v1/apps/${owner}/${filename}?mode=inline`, { redirect: 'manual', headers: { Authorization: `Bearer ${token}` } });
            const sub = 'gate-demo';
            const page = await hostRequest(BASE, '/', `${sub}.${APP_HOST}:${PORT}`, { headers: { 'x-app-origin': '1', 'x-subdomain': sub, Accept: 'text/html' } });
            assert(page.status === 302 && (page.header('location') ?? '').includes('/v1/app-open?app='), `origin: ${page.status} ${page.header('location')}`);
            assert(!page.body.includes(APP_TEXT), 'the origin served the app');
            const api = await hostRequest(BASE, '/', `${sub}.${APP_HOST}:${PORT}`, { headers: { 'x-app-origin': '1', 'x-subdomain': sub } });
            assert(api.status === 404 && !api.body.includes(APP_TEXT), `origin without html: ${api.status}`);
            const llms = await hostRequest(BASE, '/llms.txt', `${sub}.${APP_HOST}:${PORT}`, { headers: { 'x-app-origin': '1', 'x-subdomain': sub } });
            assert(llms.status === 404, `origin llms.txt: ${llms.status}`);
        });

        await test('an account opens the app: the open route hands an address with a grant, and the origin serves it', async () => {
            for (const tk of [token, otherToken]) {
                const open = await json(`/v1/apps/${owner}/${filename}/open`, { method: 'POST', headers: { Authorization: `Bearer ${tk}` }, body: '{}' });
                assert(open.status === 200 && typeof open.body.data?.url === 'string', `open ${open.status} ${JSON.stringify(open.body)}`);
                const u = new URL(open.body.data.url);
                const originHeaders = { 'x-app-origin': '1', 'x-subdomain': u.hostname.split('.')[0], Accept: 'text/html' };
                // The origin moves the grant from the address to a cookie (302), and serves on the cookie.
                const hop = await hostRequest(BASE, `${u.pathname}${u.search}`, `${u.hostname}:${PORT}`, { headers: originHeaders });
                const cookie = (hop.header('set-cookie') ?? '').split(';')[0];
                assert(hop.status === 302 && cookie.startsWith('aimeat_app_access='), `the grant hop: ${hop.status}`);
                const page = await hostRequest(BASE, hop.header('location')!, `${u.hostname}:${PORT}`, { headers: { ...originHeaders, Cookie: cookie } });
                assert(page.status === 200 && page.body.includes(APP_TEXT), `the granted origin: ${page.status}`);
            }
            const anonOpen = await json(`/v1/apps/${owner}/${filename}/open`, { method: 'POST', body: '{}' });
            assert(anonOpen.status === 401, `a stranger asked for the address: ${anonOpen.status}`);
        });

        await test('signed in is not enough for an app its owner opened to one organism: another account gets 403', async () => {
            const o = await json('/v1/organisms', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'Gate Team', type: 'team', visibility: 'private' }) });
            assert(o.status === 201, `org ${o.status}`);
            const set = await json(`/v1/apps/${filename}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ open_to: `organism:${o.body.data.organism.id}` }) });
            assert(set.status === 200, `open_to ${set.status} ${JSON.stringify(set.body)}`);
            const other = await json(`/v1/apps/${owner}/${filename}/open`, { method: 'POST', headers: { Authorization: `Bearer ${otherToken}` }, body: '{}' });
            assert(other.status === 403 && other.body.error?.code === 'ACCESS_DENIED', `another account: ${other.status} ${JSON.stringify(other.body.error)}`);
        });

        await test('a portfolio origin answers a stranger 404', async () => {
            const p = await hostRequest(BASE, '/', `${owner}.${PORTFOLIO_HOST}:${PORT}`, { headers: { 'x-portfolio-origin': '1', 'x-subdomain': owner } });
            assert(p.status === 404, `portfolio origin ${p.status}`);
        });

        console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
    } finally {
        server.kill('SIGTERM');
        setTimeout(() => { if (!server.killed) server.kill('SIGKILL'); }, 3000);
        await new Promise(r => setTimeout(r, 500));
        cleanupDb();
    }
    process.exit(failed > 0 ? 1 : 0);
}

main();
