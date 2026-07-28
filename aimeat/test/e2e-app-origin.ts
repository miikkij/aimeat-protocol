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
 *   v1.1.0 — 2026-07-28 — Phase 6: the app origin answers as itself — RFC 9728 protected-resource
 *     metadata naming this origin + the app's declared scopes, the 401 discovery hint, the injected
 *     self-activating WebMCP bridge (and its opt-out), and a WebMCP listing that describes an app
 *     with no tool manifest instead of 404ing.
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phases 1–2).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
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

/**
 * GET with an explicit Host header, on the app origin. `fetch` refuses to set Host, and Host is the
 * whole point here: production's proxy marks the host family without always naming the label, so the
 * label has to come from Host — a case no fetch-based assertion can even express.
 */
function rawJson(path: string, hostHeader: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const req = httpRequest({
            host: 'localhost', port: Number(PORT), path, method: 'GET',
            headers: { host: hostHeader, 'x-app-origin': '1', accept: 'application/json' },
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (err) { reject(new Error(`${res.statusCode}: ${data.slice(0, 200)} (${String(err)})`)); }
            });
        });
        req.on('error', reject);
        req.end();
    });
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
        const HTML = '<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="memory:read ai:use"></head>'
            + '<body><h1>app origin demo</h1></body></html>';
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

        // ── The agent arriving with nothing but the URL ─────────────────────────────────────
        // A published app is a single-file SPA: its body is empty until JavaScript runs, so a
        // fetching agent that does not execute scripts sees the meta tags and stops. Measured on a
        // live app, one concluded there was nothing agent-facing and downloaded 184 kB of source to
        // work out what the app does — while the MCP card, the WebMCP listing and a priced tool
        // manifest all existed. These two assertions are that agent's whole journey.

        await test('the served app names its own owner and app id, without running any script', async () => {
            const res = await fetch(`${BASE}/`, { headers: { 'x-app-origin': '1', 'x-subdomain': SUB } });
            assert(res.status === 200, `expected 200, got ${res.status}`);
            const body = await res.text();
            assert(body.includes('<noscript id="aimeat-agent-discovery">'), 'a script-free discovery block is present');
            assert(body.includes(`app_id: ${filename}`), `the app id is stated with its extension: ${filename}`);
            assert(body.includes(`owner:  ${owner}`), 'the owner is stated');
            assert(body.includes('/webmcp'), 'it points at the callable-tool listing');
            assert(body.includes('rel="mcp-server"'), 'and links the MCP server card for a raw-HTML reader');
        });

        await test('llms.txt on an app origin is THAT app, not the node builder guide', async () => {
            const res = await fetch(`${BASE}/llms.txt`, { headers: { 'x-app-origin': '1', 'x-subdomain': SUB } });
            assert(res.status === 200, `expected 200, got ${res.status}`);
            const body = await res.text();
            // The node-wide guide is app-BUILDING instructions; serving it here sent an agent that
            // habitually tries /llms.txt to the wrong manual, which is worse than a 404.
            assert(!body.includes('{{LIBRARY_PACKS_TABLE}}') && !/Client SDK Libraries/i.test(body),
                'it is not the node-wide builder guide');
            assert(body.includes(filename) || body.includes(owner),
                `it names the app or its owner: ${body.slice(0, 160)}`);
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

        // ── Phase 6: the app origin answers as ITSELF ──────────────────────────────────────
        // Each app origin is its own protected resource (own grant, own scopes, session-less host).
        // While every one of them answered `/.well-known/oauth-protected-resource` with the APEX's
        // MCP endpoint, a client following RFC 9728 §3.3 — which has it reject metadata whose
        // `resource` is not the resource being talked to — learned nothing about how to authenticate
        // here. The readiness scanner rejected it for exactly that reason.
        console.log('\nPhase 6: protected-resource metadata + the in-page WebMCP bridge');

        const APP_ORIGIN = `http://${SUB}.${APP_HOST}:${PORT}`;

        await test('apex protected-resource metadata is unchanged (the MCP endpoint)', async () => {
            const r = await json('/.well-known/oauth-protected-resource');
            assert(r.status === 200, `status ${r.status}`);
            assert(r.body.resource === `${BASE}/v1/mcp`, `apex resource changed: ${r.body.resource}`);
            assert(JSON.stringify(r.body.authorization_servers) === JSON.stringify([BASE]), `apex AS: ${JSON.stringify(r.body.authorization_servers)}`);
        });

        await test('the app origin names ITSELF as the resource, and the node as its authorization server', async () => {
            const res = await fetch(`${BASE}/.well-known/oauth-protected-resource`, { headers: { 'x-app-origin': '1', 'x-subdomain': SUB } });
            assert(res.status === 200, `status ${res.status}`);
            const body = await res.json() as any;
            assert(body.resource === APP_ORIGIN, `resource is this origin, got: ${body.resource}`);
            assert(JSON.stringify(body.authorization_servers) === JSON.stringify([BASE]),
                `the node issues the tokens: ${JSON.stringify(body.authorization_servers)}`);
            assert(body.aimeat?.app === `${owner}/${filename}`, `names the app: ${JSON.stringify(body.aimeat)}`);
            assert(body.aimeat?.app_id === filename, 'the app id keeps its extension');
        });

        // The shape production actually sends on this path: the proxy marks the host family and
        // leaves the label to the Host header. Read as "no subdomain", every app origin answered
        // as the bare app host — one resource identifier for all 76 of them, which is exactly the
        // wrong answer the metadata was rewritten to stop giving.
        await test('the label comes from Host when the proxy sends only the family marker', async () => {
            const body = await rawJson('/.well-known/oauth-protected-resource', `${SUB}.${APP_HOST}:${PORT}`);
            assert(body.resource === APP_ORIGIN, `expected this app's origin, got: ${body.resource}`);
            assert(body.aimeat?.app === `${owner}/${filename}`, `and the app it serves: ${JSON.stringify(body.aimeat)}`);
        });

        await test('the BARE app host stays the bare app host (no label invented)', async () => {
            const body = await rawJson('/.well-known/oauth-protected-resource', `${APP_HOST}:${PORT}`);
            assert(body.resource === `http://${APP_HOST}:${PORT}`, `bare host resource: ${body.resource}`);
            assert(body.aimeat === undefined, 'no app is named for the bare host');
        });

        await test('its scopes_supported are the ones the app itself declares', async () => {
            const res = await fetch(`${BASE}/.well-known/oauth-protected-resource`, { headers: { 'x-app-origin': '1', 'x-subdomain': SUB } });
            const body = await res.json() as any;
            const scopes: string[] = body.scopes_supported ?? [];
            assert(scopes.includes('memory:read') && scopes.includes('ai:use'),
                `expected the app's <meta name="aimeat-scopes">, got: ${JSON.stringify(scopes)}`);
        });

        await test('a 401 on the app origin points at THAT origin\'s metadata (RFC 9728 hint)', async () => {
            const res = await fetch(`${BASE}/v1/memory`, { headers: { 'x-app-origin': '1', 'x-subdomain': SUB } });
            assert(res.status === 401, `expected 401, got ${res.status}`);
            const wa = res.headers.get('www-authenticate') ?? '';
            assert(wa.includes(`resource_metadata="${APP_ORIGIN}/.well-known/oauth-protected-resource"`),
                `WWW-Authenticate should name this origin, got: ${wa}`);
        });

        await test('the served app loads the WebMCP bridge, self-activating, from its OWN origin', async () => {
            const res = await fetch(`${BASE}/`, { headers: { 'x-app-origin': '1', 'x-subdomain': SUB } });
            const body = await res.text();
            assert(body.includes('src="/v1/libs/aimeat-webmcp.js?expose=app"'),
                'the bridge is loaded relatively, so an app CSP of script-src \'self\' still allows it');
            assert(body.includes(`data-app="${filename}"`) && body.includes(`data-owner="${owner}"`),
                'and it is told which app it is, id with extension');
        });

        await test('an app that opts out is left alone', async () => {
            const quiet = 'origin-quiet.html';
            const quietHtml = '<!DOCTYPE html><html><head><meta name="aimeat-webmcp" content="off"></head><body>q</body></html>';
            const pub = await json('/v1/apps', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ filename: quiet, content: b64(quietHtml), name: 'Quiet', description: 'd', category: 'utility', tags: [] }),
            });
            assert(pub.status === 201, `publish: ${pub.status}`);
            await fetch(`${BASE}/v1/apps/${owner}/${quiet}?mode=inline`, { redirect: 'manual' }); // assigns the subdomain
            const res = await fetch(`${BASE}/`, { headers: { 'x-app-origin': '1', 'x-subdomain': 'origin-quiet' } });
            assert(res.status === 200, `expected 200, got ${res.status}`);
            const body = await res.text();
            assert(!body.includes('aimeat-webmcp.js'), 'no bridge was injected');
            assert(body.includes('<noscript id="aimeat-agent-discovery">'), 'the script-free discovery block still is');
        });

        await test('the WebMCP listing describes an app that sells nothing yet, instead of 404ing', async () => {
            const r = await json(`/v1/apps/${owner}/${filename}/webmcp`);
            assert(r.status === 200, `expected 200 for a published app with no tool manifest, got ${r.status}`);
            assert(Array.isArray(r.body.tools) && r.body.tools.length === 0, 'no tools, stated as an empty list');
            const s = r.body.app_surface;
            assert(s?.app === `${owner}/${filename}`, `app_surface names the app: ${JSON.stringify(s)}`);
            assert(s.scopes.includes('ai:use'), `and carries its declared scopes: ${JSON.stringify(s?.scopes)}`);
            assert(Array.isArray(s.skills) && Array.isArray(s.bundled_agents) && Array.isArray(s.exchange?.offerings),
                'skills, bundled agents and EXCHANGE listings are always present as lists');
        });

        await test('an app that does not exist is still a 404', async () => {
            const r = await json(`/v1/apps/${owner}/no-such-app.html/webmcp`);
            assert(r.status === 404, `expected 404, got ${r.status}`);
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
