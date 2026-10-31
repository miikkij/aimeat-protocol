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
 *   2026-10-31 — A route the open list leaves out by name stays closed in other letters
 *     (/v1/auth/Anonymous, /v1/portfolio/Members), and the open routes beside them still pass
 *     (secaudit 2026-10-31 inv-07).
 *   2026-10-30 — The shell test opens the structure page, the secret allow page and the outside-app
 *     capability allow page too: the gate had its own copy of the page list and missed all three, so
 *     the structure page link an AI handed out answered SIGN_IN_REQUIRED on innokas.aimeat.io.
 *   2026-10-26 — POST /v1/federation/message/reaction joins the open list beside the receipt route:
 *     a signed peer message, refused without the messaging right or with a bad signature.
 *   2026-10-19 — The open list names the node's own documents, the live stream and the connection
 *     callback (signed-in browser audit; the cases are in e2e-content-access-browser.ts).
 *   v1.1.0 — 2026-10-18 — A stranger's browser gets the shell with the sign-in page at every page
 *     address, the open page and the other steps of signing in included (plan doc-mvcn6c7e4e5q, V1.5).
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
import { registerOwner, ownerToken } from './helpers/owner-login.js';

const PORT = process.env.E2E_CONTENT_GATE_PORT ?? '28265';
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
    'POST /v1/federation/message/receipt', 'POST /v1/federation/message/reaction','POST /v1/federation/network-policy/pull', 'POST /v1/federation/package-claims/{}', 'POST /v1/federation/packages/pull',
    'POST /v1/federation/peer/activate', 'POST /v1/federation/peer/introduce', 'POST /v1/federation/peer/request', 'POST /v1/federation/peers', 'POST /v1/federation/peers/{}/promote',
    'POST /v1/federation/ping', 'POST /v1/federation/presence', 'POST /v1/federation/replicate', 'POST /v1/federation/retract', 'POST /v1/federation/route', 'POST /v1/federation/settle',
    'POST /v1/federation/settle/outbound', 'POST /v1/federation/storage/grant', 'POST /v1/federation/templates/sync', 'POST /v1/federation/test', 'POST /v1/federation/trust-advisory',
    // The node describing itself to machines.
    'GET /v1/health', 'GET /v1/build', 'GET /v1/spec', 'GET /llms.txt', 'GET /llms-full.txt', 'GET /AGENTS.md', 'GET /agents.txt', 'GET /auth.md', 'GET /skill.md', 'GET /openapi.json',
    'GET /v1/libs', 'GET /v1/libs/aimeat-auth.js', 'GET /v1/libs/aimeat-{}.js', 'GET /v1/libs/portfolio-standalone.js', 'GET /v1/libs/test-harness',
    // The node's own documents a signed-in person's new tab opens, and what a browser sends with no
    // session by necessity: the live stream (its ticket) and a provider's redirect (state + cookie).
    // test/e2e-content-access-browser.ts holds the cases.
    'GET /sitemap.md', 'GET /.md', 'GET /v1/glossary.json', 'GET /v1/glossary.md', 'GET /v1/ai-transparency', 'GET /v1/ai-transparency.md', 'GET /v1/docs',
    'GET /v1/events', 'GET /v1/connections/callback',
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

        await test('a closed route spelled in other letters is closed: Express routes paths whatever their case', async () => {
            // The two routes the open list leaves out by name, in capitals: the shared anonymous token
            // (which would open the MCP endpoint to a stranger) and the published-members list.
            for (const [method, path] of [['POST', '/v1/auth/Anonymous'], ['POST', '/v1/AUTH/ANONYMOUS'], ['GET', '/v1/portfolio/Members'], ['GET', '/v1/Portfolio/MEMBERS']] as const) {
                const r = await json(path, { method, headers: { Accept: 'application/json' }, body: method === 'POST' ? '{}' : undefined });
                assert(r.status === 401 && r.body.error?.code === 'SIGN_IN_REQUIRED', `${method} ${path}: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)?.slice(0, 200)}`);
            }
            // USAGE: the open routes beside them still pass: the other sign-in steps and a person's portfolio page.
            const providers = await json('/v1/auth/providers');
            assert(providers.status === 200, `GET /v1/auth/providers ${providers.status} ${JSON.stringify(providers.body?.error)}`);
            const challenge = await json(`/v1/auth/challenge?owner=${owner}`);
            assert(challenge.status === 200, `GET /v1/auth/challenge ${challenge.status} ${JSON.stringify(challenge.body?.error)}`);
            const page = await fetch(`${BASE}/v1/portfolio/${owner}`, { headers: { Accept: 'text/html' } });
            assert(page.status === 200, `GET /v1/portfolio/${owner} ${page.status}`);
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

        await test('a stranger\'s browser gets the shell with the sign-in page at every page address, the steps of signing in included', async () => {
            // The shell routes on the client: it shows /views/sign-in-first.js in place of every view but
            // the steps of signing in (js/site.js signInFirst). The server's half is that every one of
            // these addresses answers the shell, never a 401 or a 404, and that the files it loads are there.
            for (const path of ['/', '/v1/portal', '/v1/how-it-works', '/v1/publicworkspaceviewer?org=x&ws=y', `/v1/portfolio/${owner}`,
                `/v1/app-open?app=${encodeURIComponent(`${owner}/${filename}`)}`, '/v1/invite?token=x', '/v1/app-grant', '/v1/oauth-round?state=x', '/v1/allow?agent=x&need=y',
                // The links an AI hands a person, which a new tab opens with no session.
                `/v1/appcat/structure?app=${encodeURIComponent(`${owner}/${filename}`)}`, '/v1/secret-allow?secret=x', '/v1/eco-capability-allow?app=x']) {
                const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'text/html' } });
                const body = await res.text();
                assert(res.status === 200, `${path}: ${res.status}`);
                assert(body.includes('"contentAccess":"signed-in"') && body.includes('/views/sign-in-first.js'), `${path}: not the signed-in-only shell`);
            }
            for (const file of ['/views/sign-in-first.js', '/views/app-open.js', '/js/site.js']) {
                const res = await fetch(`${BASE}${file}`);
                assert(res.status === 200, `${file}: ${res.status}`);
            }
            const site = await (await fetch(`${BASE}/js/site.js`)).text();
            const steps = /SIGN_IN_STEPS = new Set\(\[([^\]]*)\]\)/.exec(site)?.[1] ?? '';
            for (const step of ['/v1/app-grant', '/v1/app-open', '/v1/invite', '/v1/oauth-round', '/v1/allow']) {
                assert(steps.includes(`'${step}'`), `${step} is not a step of signing in: ${steps}`);
            }
            // FAILURE: a viewer of shared content is not a step of signing in; it asks for the sign-in.
            for (const viewer of ['/v1/publicworkspaceviewer', '/v1/publicknowledgeviewer', '/v1/portfolio', '/v1/portal']) {
                assert(!steps.includes(`'${viewer}'`), `${viewer} would reach a stranger without the sign-in`);
            }
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

        await test('an app origin serves the app its libraries and the sign-in steps, and still none of its documents', async () => {
            // The app page loads /v1/libs/aimeat-auth.js and aimeat-data.js from its own origin and signs
            // in there. They hold no content and are open on the apex; on the app origin they answered
            // 404 from 2026-10-18 11:29, so every app that uses them stopped knowing its person (seen on
            // innokas.aimeat.io 2026-10-19).
            const sub = 'gate-demo';
            const host = `${sub}.${APP_HOST}:${PORT}`;
            const originHeaders = { 'x-app-origin': '1', 'x-subdomain': sub };
            for (const lib of ['/v1/libs/aimeat-auth.js', '/v1/libs/aimeat-data.js']) {
                const res = await hostRequest(BASE, lib, host, { headers: { ...originHeaders, Accept: '*/*' } });
                assert(res.status === 200 && /javascript/.test(res.header('content-type') ?? ''), `${lib} on the app origin: ${res.status} ${res.header('content-type')}`);
            }
            const step = await hostRequest(BASE, '/v1/auth/providers', host, { headers: originHeaders });
            assert(step.status !== 404, `a sign-in step on the app origin: ${step.status}`);
            // FAILURE: content routes and the origin's own documents stay closed to a stranger there.
            for (const p of ['/v1/apps', `/v1/apps/${owner}/${filename}`, '/llms.txt', '/AGENTS.md']) {
                const res = await hostRequest(BASE, p, host, { headers: originHeaders });
                assert((res.status === 404 || res.status === 401) && !res.body.includes(APP_TEXT), `${p} on the app origin: ${res.status}`);
            }
        });

        await test('a browser tab opening the apex app read (the store\'s Open, a feed link) goes to the open page, never a 401', async () => {
            // A new tab carries no session: the SPA keeps it in localStorage. So a signed-in person's
            // Open from the app store reaches the gate exactly as a stranger's does, and the gate must
            // hand the browser to the open page, which holds the session (seen on innokas.aimeat.io
            // 2026-10-19: raw 401 SIGN_IN_REQUIRED for every app).
            const browser = { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
            const want = `/v1/app-open?app=${encodeURIComponent(`${owner}/${filename}`)}`;
            for (const q of ['?mode=inline', '?version=1&mode=inline', '?mode=frame', '']) {
                const res = await fetch(`${BASE}/v1/apps/${owner}/${filename}${q}`, { redirect: 'manual', headers: browser });
                const body = await res.text();
                assert(res.status === 302 && res.headers.get('location') === want, `${q || '(no query)'}: ${res.status} ${res.headers.get('location')} ${body.slice(0, 120)}`);
                assert(!body.includes(APP_TEXT), `${q}: the redirect carried the app`);
                assert(res.headers.get('cache-control') === 'no-store', `${q}: cacheable redirect`);
            }
            // FAILURE: an API caller without a credential still gets the 401, and so does any other route
            // under the app, a browser or not.
            const apiCall = await json(`/v1/apps/${owner}/${filename}?mode=inline`, { headers: { Accept: 'application/json' } });
            assert(apiCall.status === 401 && apiCall.body.error?.code === 'SIGN_IN_REQUIRED', `api caller: ${apiCall.status}`);
            const sub = await fetch(`${BASE}/v1/apps/${owner}/${filename}/versions`, { redirect: 'manual', headers: browser });
            assert(sub.status === 401, `a sub-route took the redirect: ${sub.status}`);
            const post = await fetch(`${BASE}/v1/apps/${owner}/${filename}`, { method: 'POST', redirect: 'manual', headers: { ...browser, 'Content-Type': 'application/json' }, body: '{}' });
            assert(post.status === 401, `a POST took the redirect: ${post.status}`);
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

        await test('a welcome page on its origin: a browser goes to the open page, an account opens it with a grant, and the page loads its libraries', async () => {
            // On a signed-in-only node every welcome page needs a sign-in. The gate answered 404 to the
            // page origin even with a page grant, so a person who opened someone's page got nothing.
            const PAGE_TEXT = 'GATE WELCOME PAGE';
            const up = await json('/v1/portfolio/upload', { method: 'PUT', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ html: `<!DOCTYPE html><html><head><title>W</title></head><body><h1>${PAGE_TEXT}</h1></body></html>`, enable: true }) });
            assert(up.status === 200, `upload ${up.status} ${JSON.stringify(up.body.error)}`);
            const host = `${owner}.${PORTFOLIO_HOST}:${PORT}`;
            const originHeaders = { 'x-portfolio-origin': '1', 'x-subdomain': owner };
            const browser = await hostRequest(BASE, '/', host, { headers: { ...originHeaders, Accept: 'text/html' } });
            assert(browser.status === 302 && (browser.header('location') ?? '').endsWith(`/v1/app-open?portfolio=${owner}`), `stranger's browser: ${browser.status} ${browser.header('location')}`);
            assert(!browser.body.includes(PAGE_TEXT), 'the redirect carried the page');
            const api = await hostRequest(BASE, '/', host, { headers: { ...originHeaders, Accept: 'application/json' } });
            assert(api.status === 404 && !api.body.includes(PAGE_TEXT), `stranger without a browser: ${api.status}`);
            const open = await json(`/v1/portfolio/${owner}/open`, { method: 'POST', headers: { Authorization: `Bearer ${otherToken}` }, body: '{}' });
            assert(open.status === 200 && typeof open.body.data?.url === 'string', `open ${open.status} ${JSON.stringify(open.body.error)}`);
            const u = new URL(open.body.data.url);
            const hop = await hostRequest(BASE, `${u.pathname}${u.search}`, host, { headers: { ...originHeaders, Accept: 'text/html' } });
            const cookie = (hop.header('set-cookie') ?? '').split(';')[0];
            assert(hop.status === 302 && cookie.startsWith('aimeat_page_access='), `the grant hop: ${hop.status}`);
            const page = await hostRequest(BASE, hop.header('location')!, host, { headers: { ...originHeaders, Accept: 'text/html', Cookie: cookie } });
            assert(page.status === 200 && page.body.includes(PAGE_TEXT), `the granted page: ${page.status}`);
            const lib = await hostRequest(BASE, '/v1/libs/aimeat-auth.js', host, { headers: { ...originHeaders, Accept: '*/*' } });
            assert(lib.status === 200, `a library on the page origin: ${lib.status}`);
            const content = await hostRequest(BASE, `/v1/portfolio/data/${owner}`, host, { headers: originHeaders });
            assert(content.status === 404 && !content.body.includes(PAGE_TEXT), `a content route on the page origin: ${content.status}`);
        });

        await test('signing out closes the app and the welcome page on their origins: the grant names the session it came from', async () => {
            // The grant cookie lives on the origin, which a sign-out on the apex cannot clear. It used to
            // keep opening the app for up to an hour after the person signed out (innokas.aimeat.io,
            // 2026-10-19: the page loaded two seconds after the sign-out).
            // A second sign-in of the owner: the app is open to one organism by now, and the owner's
            // first session stays signed in for the last check.
            const viewer = { token: await ownerToken(BASE, owner) };
            const granted = async (openPath: string, host: string, originHeaders: Record<string, string>, cookieName: string) => {
                const open = await json(openPath, { method: 'POST', headers: { Authorization: `Bearer ${viewer.token}` }, body: '{}' });
                assert(open.status === 200 && typeof open.body.data?.url === 'string', `${openPath}: ${open.status} ${JSON.stringify(open.body.error)}`);
                const u = new URL(open.body.data.url);
                const hop = await hostRequest(BASE, `${u.pathname}${u.search}`, host, { headers: { ...originHeaders, Accept: 'text/html' } });
                const cookie = (hop.header('set-cookie') ?? '').split(';')[0];
                assert(hop.status === 302 && cookie.startsWith(`${cookieName}=`), `${openPath} grant hop: ${hop.status}`);
                return { cookie, path: hop.header('location')! };
            };
            const appSub = 'gate-demo';
            const appHost = `${appSub}.${APP_HOST}:${PORT}`;
            const appHeaders = { 'x-app-origin': '1', 'x-subdomain': appSub };
            const pageHost = `${owner}.${PORTFOLIO_HOST}:${PORT}`;
            const pageHeaders = { 'x-portfolio-origin': '1', 'x-subdomain': owner };
            const a = await granted(`/v1/apps/${owner}/${filename}/open`, appHost, appHeaders, 'aimeat_app_access');
            const p = await granted(`/v1/portfolio/${owner}/open`, pageHost, pageHeaders, 'aimeat_page_access');
            const before = await hostRequest(BASE, a.path, appHost, { headers: { ...appHeaders, Accept: 'text/html', Cookie: a.cookie } });
            assert(before.status === 200 && before.body.includes(APP_TEXT), `the app before sign-out: ${before.status}`);
            const pageBefore = await hostRequest(BASE, p.path, pageHost, { headers: { ...pageHeaders, Accept: 'text/html', Cookie: p.cookie } });
            assert(pageBefore.status === 200, `the page before sign-out: ${pageBefore.status}`);

            const out = await json('/v1/auth/revoke', { method: 'POST', headers: { Authorization: `Bearer ${viewer.token}` }, body: '{}' });
            assert(out.status === 200, `sign-out ${out.status}`);

            const after = await hostRequest(BASE, a.path, appHost, { headers: { ...appHeaders, Accept: 'text/html', Cookie: a.cookie } });
            assert(after.status !== 200 && !after.body.includes(APP_TEXT), `the app after sign-out: ${after.status}`);
            const pageAfter = await hostRequest(BASE, p.path, pageHost, { headers: { ...pageHeaders, Accept: 'text/html', Cookie: p.cookie } });
            assert(pageAfter.status !== 200 && !pageAfter.body.includes('GATE WELCOME PAGE'), `the page after sign-out: ${pageAfter.status}`);
            // Only that session's grants end: the owner's other sign-in, still signed in, keeps the app open.
            const open = await json(`/v1/apps/${owner}/${filename}/open`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' });
            const u = new URL(open.body.data.url);
            const hop = await hostRequest(BASE, `${u.pathname}${u.search}`, appHost, { headers: { ...appHeaders, Accept: 'text/html' } });
            const still = await hostRequest(BASE, hop.header('location')!, appHost, { headers: { ...appHeaders, Accept: 'text/html', Cookie: (hop.header('set-cookie') ?? '').split(';')[0] } });
            assert(still.status === 200 && still.body.includes(APP_TEXT), `another signed-in person's grant: ${still.status}`);
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
