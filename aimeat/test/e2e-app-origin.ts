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
 *   v1.5.0 — 2026-08-15 — Phase 7 gains the way BACK to the code field: a browser meeting the
 *     code-gated app on its own origin with no usable grant is bounced to the apex unlock page and
 *     the round trip completes, while ?unlock=1 without a grant, and any non-browser Accept, keep
 *     the uniform 404. The app origin is the address people actually hold, and until now it
 *     answered them with NOT_FOUND JSON and no field to type into.
 *   v1.4.0 — 2026-08-11 — Phase 7 (audit H-19): a code-gated app is redirected like every other app,
 *     the apex hands out a one-app grant only once the code matches, and the app origin serves
 *     against that grant and nothing else — cross-app and cross-owner grants refused, and the app's
 *     unauthenticated discovery documents stay closed.
 *   v1.3.0 — 2026-08-11 — Phases 8–9: a forged origin marker. Every app-origin request now carries a
 *     real Host in the app family (helpers/host-request.ts), because the marker alone stopped being
 *     believed; two new tests send the marker from the apex Host and expect the apex answer. The
 *     apex-only guards on the node's discovery documents and robots.txt moved here from
 *     e2e-agent-readiness.ts, which runs on a server with no app host at all.
 *   v1.2.0 — 2026-07-30 — Phase 4: the app-origin CSP permits WebAssembly compilation
 *     ('wasm-unsafe-eval'), still refuses eval(), and COEP stays off (no cross-origin isolation).
 *   v1.1.0 — 2026-07-28 — Phase 6: the app origin answers as itself — RFC 9728 protected-resource
 *     metadata naming this origin + the app's declared scopes, the 401 discovery hint, the injected
 *     self-activating WebMCP bridge (and its opt-out), and a WebMCP listing that describes an app
 *     with no tool manifest instead of 404ing.
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phases 1–2).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostRequest, type HostResponse } from './helpers/host-request.js';

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
 * A GET the way an app origin actually receives it: a real Host in the app family, plus the family
 * marker nginx stamps. Both halves are load-bearing. `fetch` refuses to set Host, so nothing in it
 * can express this shape — and since subdomain.ts v1.5.0 the marker is only believed on a Host in
 * that family, so a fetch with the header alone is no longer an app origin at all.
 *
 * `sub` names the per-app subdomain, or null for the bare app host (the path form).
 * `label: 'header'` also sends `x-subdomain`, which most nginx locations do; `label: 'host'` leaves
 * it out, which is what `/.well-known/*` does, so the server has to read the label off the Host.
 */
function onAppOrigin(
    path: string,
    sub: string | null,
    label: 'header' | 'host' = 'header',
    extra: Record<string, string> = {},
): Promise<HostResponse> {
    const host = sub ? `${sub}.${APP_HOST}:${PORT}` : `${APP_HOST}:${PORT}`;
    const headers: Record<string, string> = { 'x-app-origin': '1', ...extra };
    if (sub && label === 'header') headers['x-subdomain'] = sub;
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
        await test('app-origin path form (bare app host) 302-redirects to the auto-assigned subdomain', async () => {
            const res = await onAppOrigin(`/${owner}/${filename}`, null);
            assert(res.status === 302, `expected 302, got ${res.status}`);
            assert((res.header('location') ?? '') === `http://${SUB}.${APP_HOST}:${PORT}/`, `unexpected Location: ${res.header('location')}`);
        });

        await test('app-origin path form ignores non-.html paths (API still reachable)', async () => {
            // /v1/spec on the app host must NOT be swallowed by the path-form app route.
            const res = await onAppOrigin('/v1/spec', null);
            assert(res.status === 200, `/v1/spec on app host should still 200, got ${res.status}`);
        });

        console.log('\nPhase 3: the per-app subdomain serves the app HTML with the SSO shim');
        await test('the per-app subdomain serves the app HTML at /', async () => {
            const res = await onAppOrigin('/', SUB);
            assert(res.status === 200, `expected 200, got ${res.status}`);
            assert(res.body.includes('app origin demo'), 'subdomain-served body contains the app content');
        });

        // ── The agent arriving with nothing but the URL ─────────────────────────────────────
        // A published app is a single-file SPA: its body is empty until JavaScript runs, so a
        // fetching agent that does not execute scripts sees the meta tags and stops. Measured on a
        // live app, one concluded there was nothing agent-facing and downloaded 184 kB of source to
        // work out what the app does — while the MCP card, the WebMCP listing and a priced tool
        // manifest all existed. These two assertions are that agent's whole journey.

        await test('the served app names its own owner and app id, without running any script', async () => {
            const res = await onAppOrigin('/', SUB);
            assert(res.status === 200, `expected 200, got ${res.status}`);
            const body = res.body;
            assert(body.includes('<noscript id="aimeat-agent-discovery">'), 'a script-free discovery block is present');
            assert(body.includes(`app_id: ${filename}`), `the app id is stated with its extension: ${filename}`);
            assert(body.includes(`owner:  ${owner}`), 'the owner is stated');
            assert(body.includes('/webmcp'), 'it points at the callable-tool listing');
            assert(body.includes('rel="mcp-server"'), 'and links the MCP server card for a raw-HTML reader');
        });

        await test('llms.txt on an app origin is THAT app, not the node builder guide', async () => {
            const res = await onAppOrigin('/llms.txt', SUB);
            assert(res.status === 200, `expected 200, got ${res.status}`);
            const body = res.body;
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
            const res = await onAppOrigin(`/${query}`, sub);
            return { csp: res.header('content-security-policy') ?? '', res };
        };
        // Counted off rawHeaders, which is the wire form the proxy buffer actually holds: name,
        // value, ': ' and CRLF per header. A parsed Headers object would hide repeats and casing.
        const headerBytes = (res: HostResponse) => {
            let n = 0;
            for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) n += res.rawHeaders[i].length + res.rawHeaders[i + 1].length + 4;
            return n;
        };

        let cspSmall = '';
        await test('baseline CSP with few apps', async () => {
            const { csp } = await cspOf(SUB);
            cspSmall = csp;
            assert(csp.length > 0, 'expected a CSP header');
        });

        await test('script-src permits WebAssembly compilation but still refuses eval()', async () => {
            const { csp, res } = await cspOf(SUB);
            const scriptSrc = (csp.match(/script-src ([^;]*)/) ?? ['', ''])[1];
            // Without this an app cannot run wasm AT ALL — the browser blocks compilation, so
            // self-hosting the .wasm does not help (verified on Chrome, 2026-07-30).
            assert(scriptSrc.includes("'wasm-unsafe-eval'"), `wasm is blocked: script-src ${scriptSrc}`);
            // 'unsafe-eval' would also unlock eval()/new Function(); nothing needs it.
            assert(!scriptSrc.includes("'unsafe-eval'"), `script-src must not permit eval(): ${scriptSrc}`);
            // Wasm here is single-threaded: no COOP/COEP, so crossOriginIsolated stays false and
            // node libs without CORP keep loading.
            assert(!res.header('cross-origin-embedder-policy'), 'COEP must stay off on app origins');
            // Compiling is half of it: a wasm runtime fetches its own module from a blob: URL the
            // app made (the ffmpeg.wasm toBlobURL idiom). Without blob: here a real encode dies at
            // "Refused to connect", after the module has already been allowed to compile.
            const connectSrc = (csp.match(/connect-src ([^;]*)/) ?? ['', ''])[1];
            assert(connectSrc.includes('blob:'), `a wasm runtime cannot fetch its own module: connect-src ${connectSrc}`);
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
            const granted = await onAppOrigin(`/?${grantUrl.split('?')[1]}`, SUB);
            assert(granted.header('x-frame-options') === null, 'with a grant the legacy header must be gone');
            const plain = await onAppOrigin('/', SUB);
            assert(plain.header('x-frame-options') !== null, 'without a grant it must stay');
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
            const res = await onAppOrigin('/.well-known/oauth-protected-resource', SUB);
            assert(res.status === 200, `status ${res.status}`);
            const body = res.json<any>();
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
            const body = (await onAppOrigin('/.well-known/oauth-protected-resource', SUB, 'host')).json<any>();
            assert(body.resource === APP_ORIGIN, `expected this app's origin, got: ${body.resource}`);
            assert(body.aimeat?.app === `${owner}/${filename}`, `and the app it serves: ${JSON.stringify(body.aimeat)}`);
        });

        await test('the BARE app host stays the bare app host (no label invented)', async () => {
            const body = (await onAppOrigin('/.well-known/oauth-protected-resource', null)).json<any>();
            assert(body.resource === `http://${APP_HOST}:${PORT}`, `bare host resource: ${body.resource}`);
            assert(body.aimeat === undefined, 'no app is named for the bare host');
        });

        await test('its scopes_supported are the ones the app itself declares', async () => {
            const body = (await onAppOrigin('/.well-known/oauth-protected-resource', SUB)).json<any>();
            const scopes: string[] = body.scopes_supported ?? [];
            assert(scopes.includes('memory:read') && scopes.includes('ai:use'),
                `expected the app's <meta name="aimeat-scopes">, got: ${JSON.stringify(scopes)}`);
        });

        await test('a 401 on the app origin points at THAT origin\'s metadata (RFC 9728 hint)', async () => {
            const res = await onAppOrigin('/v1/memory', SUB);
            assert(res.status === 401, `expected 401, got ${res.status}`);
            const wa = res.header('www-authenticate') ?? '';
            assert(wa.includes(`resource_metadata="${APP_ORIGIN}/.well-known/oauth-protected-resource"`),
                `WWW-Authenticate should name this origin, got: ${wa}`);
        });

        await test('the served app loads the WebMCP bridge, self-activating, from its OWN origin', async () => {
            const body = (await onAppOrigin('/', SUB)).body;
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
            const res = await onAppOrigin('/', 'origin-quiet');
            assert(res.status === 200, `expected 200, got ${res.status}`);
            const body = res.body;
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

        // ── Phase 7: a code-gated app is isolated like every other app ─────────────────────
        // It used to be the exception: the apex refused to redirect an access-coded app, so after
        // the visitor typed the right code the app ran on the SAME origin as their session — the
        // one place an author who asked for protection least wants it. The gate now sits on the
        // UNLOCK. The apex still checks the code and then hands out a grant naming this one app;
        // the app origin has no session and verifies nothing but that grant.
        console.log('\nPhase 7: the gate moved from the app HTML to the unlock (H-19)');

        const gatedFile = 'gated-demo.html';
        const GATED_SUB = 'gated-demo';
        const CODE = 'sekret99';
        const GATED_HTML = '<!DOCTYPE html><html><head><title>Gated</title></head><body>gated secret body</body></html>';
        const gatedPath = `/v1/apps/${owner}/${gatedFile}`;
        let grantQuery = '';

        await test('publish a code-gated app', async () => {
            const r = await json('/v1/apps', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    filename: gatedFile, content: b64(GATED_HTML), name: 'Gated', description: 'd',
                    category: 'utility', tags: [], access_code: CODE,
                }),
            });
            assert(r.status === 201, `publish: ${r.status} ${JSON.stringify(r.body.error ?? '')}`);
        });

        await test('a browser without the code gets the unlock page, never a redirect', async () => {
            const res = await fetch(`${BASE}${gatedPath}?mode=inline`, {
                headers: { Accept: 'text/html' }, redirect: 'manual',
            });
            assert(res.status === 403, `expected the unlock page, got ${res.status}`);
            const body = await res.text();
            assert(body.includes('<form') && body.includes('name="code"'), 'the code field is the page');
            assert(!body.includes('gated secret body'), 'and it carries none of the app');
        });

        await test('the WRONG code still gets the unlock page', async () => {
            const res = await fetch(`${BASE}${gatedPath}?mode=inline&code=nope`, {
                headers: { Accept: 'text/html' }, redirect: 'manual',
            });
            assert(res.status === 403, `expected 403, got ${res.status}`);
        });

        await test('the RIGHT code 302s to the app origin with a grant, and serves nothing here', async () => {
            const res = await fetch(`${BASE}${gatedPath}?mode=inline&code=${CODE}`, {
                headers: { Accept: 'text/html' }, redirect: 'manual',
            });
            // The whole point of H-19: the apex answers with a redirect rather than the app bytes.
            assert(res.status === 302, `expected 302, got ${res.status}`);
            const loc = res.headers.get('location') ?? '';
            assert(loc.startsWith(`http://${GATED_SUB}.${APP_HOST}:${PORT}/`), `unexpected Location: ${loc}`);
            assert(loc.includes('access='), `no grant in the redirect: ${loc}`);
            // A 301 to an address holding an expiring grant is one the browser keeps reusing after
            // the grant is dead, which is why this one must not be cacheable.
            assert((res.headers.get('cache-control') ?? '').includes('no-store'), 'the gated redirect must not be cached');
            assert(!(await res.text()).includes('gated secret body'), 'the apex must not have served the app');
            grantQuery = loc.slice(loc.indexOf('?'));
        });

        await test('the app origin serves the gated app WITH the grant', async () => {
            const res = await onAppOrigin(`/${grantQuery}`, GATED_SUB);
            assert(res.status === 200, `expected 200, got ${res.status}`);
            assert(res.body.includes('gated secret body'), 'the app bytes belong on the app origin');
        });

        await test('and answers the uniform 404 WITHOUT one', async () => {
            for (const q of ['', '?access=', '?access=not-a-token']) {
                const res = await onAppOrigin(`/${q}`, GATED_SUB);
                assert(res.status === 404, `"${q}" should look like an unknown subdomain, got ${res.status}`);
            }
        });

        // ── The way back to the code field ────────────────────────────────────────────────
        // The app origin IS the address people hold: the catalog opens it, aimeat_app_list hands
        // it out, a shared link carries it. The code form lives on the apex, so without this a
        // stranger following that link — and the owner reloading after the hour-long grant died —
        // met NOT_FOUND JSON with nothing to type into.
        const asBrowser = { Accept: 'text/html,application/xhtml+xml' };

        await test('a BROWSER with no grant is sent to the apex code form, not the 404', async () => {
            const res = await onAppOrigin('/', GATED_SUB, 'header', asBrowser);
            assert(res.status === 302, `expected a bounce to the unlock page, got ${res.status}`);
            const loc = res.header('location') ?? '';
            assert(loc === `${BASE}/v1/apps/${owner}/${gatedFile}?mode=inline&unlock=1`, `unexpected Location: ${loc}`);
            assert((res.header('cache-control') ?? '').includes('no-store'), 'an unlock hop must not be cached');
            assert(!res.body.includes('gated secret body'), 'and it carries none of the app');
        });

        await test('an EXPIRED-looking grant bounces the same way — the reload case', async () => {
            const res = await onAppOrigin('/?access=not-a-token', GATED_SUB, 'header', asBrowser);
            assert(res.status === 302, `a dead grant must lead back to the field, got ${res.status}`);
        });

        await test('the whole round trip: origin → code form → grant → the app', async () => {
            const bounce = await onAppOrigin('/', GATED_SUB, 'header', asBrowser);
            const unlockUrl = bounce.header('location') ?? '';
            // What the form does with the code typed into it: the same GET, code added.
            const submitted = await fetch(`${unlockUrl}&code=${CODE}`, {
                headers: asBrowser, redirect: 'manual',
            });
            assert(submitted.status === 302, `the right code must mint a grant, got ${submitted.status}`);
            const back = submitted.headers.get('location') ?? '';
            assert(back.includes('access='), `no grant on the way back: ${back}`);
            assert(back.includes('unlock=1'), `the bounce mark must survive the hop: ${back}`);
            const served = await onAppOrigin(`/${back.slice(back.indexOf('?'))}`, GATED_SUB, 'header', asBrowser);
            assert(served.status === 200, `the unlocked app must serve, got ${served.status}`);
            assert(served.body.includes('gated secret body'), 'and it must be the app');
        });

        await test('the bounce is single: ?unlock=1 without a usable grant is the 404 again', async () => {
            for (const q of ['?unlock=1', '?access=not-a-token&unlock=1']) {
                const res = await onAppOrigin(`/${q}`, GATED_SUB, 'header', asBrowser);
                assert(res.status === 404, `"${q}" must stop here rather than ping-pong, got ${res.status}`);
            }
        });

        await test('an API caller keeps the uniform 404 — the door is for humans only', async () => {
            const res = await onAppOrigin('/', GATED_SUB, 'header', { Accept: 'application/json' });
            assert(res.status === 404, `an agent must still see an unknown subdomain, got ${res.status}`);
        });

        await test('a grant for ANOTHER app does not open this one', async () => {
            // origin-demo is ungated, so it has no grant of its own; mint one for a second gated
            // app instead and spend it on the first.
            const otherFile = 'gated-other.html';
            const pub = await json('/v1/apps', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    filename: otherFile, content: b64(GATED_HTML), name: 'Gated2', description: 'd',
                    category: 'utility', tags: [], access_code: CODE,
                }),
            });
            assert(pub.status === 201, `publish: ${pub.status}`);
            const red = await fetch(`${BASE}/v1/apps/${owner}/${otherFile}?mode=inline&code=${CODE}`, {
                headers: { Accept: 'text/html' }, redirect: 'manual',
            });
            assert(red.status === 302, `the second app must redirect with a grant, got ${red.status}`);
            const otherLoc = red.headers.get('location') ?? '';
            const otherQuery = otherLoc.slice(otherLoc.indexOf('?'));
            const res = await onAppOrigin(`/${otherQuery}`, GATED_SUB);
            assert(res.status === 404, `a grant for a different app must not open this one, got ${res.status}`);
        });

        await test('a grant does not open the SAME filename owned by someone else', async () => {
            const other = `gatedout${Date.now() % 100000}`;
            const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: other, public_key: 'placeholder' }) });
            assert(reg.status === 201, `register: ${reg.status}`);
            const ts = new Date().toISOString();
            const tk = await json('/v1/auth/token', {
                method: 'POST',
                body: JSON.stringify({ owner: other, timestamp: ts, signature: await signMsg(reg.body.data.private_key, other + NODE_ID + ts) }),
            });
            const otherToken = tk.body.data.token;
            const pub = await json('/v1/apps', {
                method: 'POST', headers: { Authorization: `Bearer ${otherToken}` },
                body: JSON.stringify({
                    filename: gatedFile, content: b64('<html><body>someone else</body></html>'), name: 'Gated', description: 'd',
                    category: 'utility', tags: [], access_code: CODE,
                }),
            });
            assert(pub.status === 201, `publish: ${pub.status}`);
            // The second owner's app gets its own subdomain; their grant carries their name, so it
            // must be worthless against the first owner's app of the same filename.
            const red = await fetch(`${BASE}/v1/apps/${other}/${gatedFile}?mode=inline&code=${CODE}`, {
                headers: { Accept: 'text/html' }, redirect: 'manual',
            });
            assert(red.status === 302, `the other owner's app must redirect with a grant, got ${red.status}`);
            const loc = red.headers.get('location') ?? '';
            const res = await onAppOrigin(`/${loc.slice(loc.indexOf('?'))}`, GATED_SUB);
            assert(res.status === 404, `a cross-owner grant must not open this app, got ${res.status}`);
        });

        await test('the gated app publishes no agent-facing documents of its own', async () => {
            // A grant opens the app for whoever unlocked it; it does not make the app public. These
            // documents are read with no credential at all, so they describe the NODE here, exactly
            // as they did before a gated app could be served on this origin.
            const llms = await onAppOrigin(`/llms.txt${grantQuery}`, GATED_SUB);
            assert(!llms.body.includes(`${owner}/${gatedFile}`), `llms.txt names the gated app: ${llms.body.slice(0, 160)}`);
            const card = await onAppOrigin(`/.well-known/mcp.json${grantQuery}`, GATED_SUB);
            let described: string | undefined;
            try { described = card.json<{ app?: { app_id?: string } }>().app?.app_id; }
            catch (err) { console.log(`     (mcp.json was not JSON, which is also not the app card: ${String(err).slice(0, 60)})`); }
            assert(described !== gatedFile, 'the MCP server card must not describe a gated app');
        });

        // ── Phase 8: the marker is a claim, and the Host is what decides it ─────────────────
        // Until 2026-08-11 `X-App-Origin: 1` was believed on its own. Anything the app origin is
        // trusted to be — a separate origin, a resource with its own identity, the one place user
        // HTML is allowed to run — was therefore available to any client willing to add a request
        // header, and the apex nginx block that was supposed to blank the three markers had stopped
        // doing so with nothing anywhere reporting it. These two send the marker from the apex Host.
        console.log('\nPhase 8: an origin marker from the apex Host is not an app origin');

        await test('a forged X-App-Origin leaves the apex answering as the apex (RFC 9728)', async () => {
            const body = (await hostRequest(BASE, '/.well-known/oauth-protected-resource', `localhost:${PORT}`, {
                headers: { 'x-app-origin': '1', 'x-subdomain': SUB },
            })).json<any>();
            assert(body.resource === `${BASE}/v1/mcp`, `the apex must keep its own identity, got: ${body.resource}`);
            assert(body.aimeat === undefined, `no app may be named for an apex request: ${JSON.stringify(body.aimeat)}`);
        });

        // The escalation the header bought: `?mode=inline` is redirected to the isolated origin
        // precisely BECAUSE the request is on the apex, and the redirect is skipped for a request
        // already on the app origin. A forged marker took that exit and ran the app's HTML on the
        // origin that holds the session.
        await test('a forged X-App-Origin does not get app HTML executed on the apex', async () => {
            const res = await hostRequest(BASE, `/v1/apps/${owner}/${filename}?mode=inline`, `localhost:${PORT}`, {
                headers: { 'x-app-origin': '1' },
            });
            assert(res.status === 301, `expected the apex redirect, got ${res.status}`);
            assert((res.header('location') ?? '') === `http://${SUB}.${APP_HOST}:${PORT}/`, `unexpected Location: ${res.header('location')}`);
            assert(!res.body.includes('app origin demo'), 'the app body was served on the apex origin');
        });

        // ── Phase 9: the node's own documents stay on the apex ─────────────────────────────
        // These lived in e2e-agent-readiness.ts, which runs against the shared CI server. That
        // server has no app host configured at all, so after the Host check there is no way to be
        // on an app origin there and the assertions could only ever have been made with a forged
        // header. Here the origin is real.
        console.log('\nPhase 9: node discovery documents do not answer on an app origin');

        const UNMAPPED = 'nosuchapp';

        await test('sitemap.md, AGENTS.md and llms-full.txt 404 on an app origin', async () => {
            for (const p of ['/sitemap.md', '/AGENTS.md', '/agents.md', '/llms-full.txt']) {
                const r = await onAppOrigin(p, UNMAPPED);
                assert(r.status === 404, `${p} on an app origin → ${r.status}, expected 404`);
            }
        });

        await test('the node robots.txt does not leak onto an app origin', async () => {
            const apex = await json('/robots.txt');
            assert(String(apex.body._raw ?? '').includes('Content-Signal'), 'apex robots.txt missing');
            const onApp = await onAppOrigin('/robots.txt', UNMAPPED);
            // Its Sitemap: line names the apex, so serving it here would be a crawl policy about
            // somebody else published under the app's name.
            assert(!onApp.body.includes('Content-Signal'), 'the node robots.txt answered on an app origin');
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
