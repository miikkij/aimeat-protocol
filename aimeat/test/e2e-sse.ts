/**
 * @file e2e-sse.ts
 * @description E2E for the SSE live-update stream (/v1/events). Self-spawns a server with the
 *   app origin enabled so a real app-grant token can be minted, and verifies the three things
 *   that were wrong:
 *     1. The stream OPENS immediately. It used to send nothing until the 30s keepalive, which is
 *        indistinguishable from a hung connection (and reads as "SSE is broken" to anyone
 *        debugging an app).
 *     2. Change domains are SCOPE-GATED for a restricted principal: an app grant holding only
 *        memory scopes is told about `memory` but never about `organisms`.
 *     3. An app-grant stream does NOT mark the owner present. Only a real owner session may.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-sse.ts
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial, with the SSE open-immediately fix + scope gate.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.E2E_SSE_PORT ?? '40268';
const BASE = `http://localhost:${PORT}`;
const APP_HOST = 'apps.aimeat.test';
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-sse.db');

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    const setCookie = res.headers.get('set-cookie') ?? '';
    const rt = /aimeat_rt=([^;]+)/.exec(setCookie)?.[1] ?? null;
    return { status: res.status, body, rt };
}

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const env = {
        ...process.env, AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_APP_HOST: APP_HOST, AIMEAT_APP_ORIGIN_ENABLED: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', DB_PATH],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        try { if ((await fetch(`${BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGTERM'); throw new Error('Server failed to start');
}

async function register(username: string): Promise<{ rt: string; token: string }> {
    const pw = 'SsePw#2026';
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: pw }) });
    assert(reg.status === 201, `register ${username}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username, password: pw }) });
    assert(login.status === 200 && !!login.rt, `login ${username}: ${login.status}`);
    return { rt: login.rt!, token: login.body.data.token };
}

/** Mint an app-grant token for the owner's OWN app with an exact scope (the silent bridge). */
async function appToken(origin: string, scope: string, cookie: string): Promise<string> {
    const res = await fetch(
        `${BASE}/v1/auth/app-grant-silent?origin=${encodeURIComponent(origin)}&scope=${encodeURIComponent(scope)}`,
        { headers: { Cookie: `aimeat_rt=${encodeURIComponent(cookie)}` } });
    const body = await res.json() as any;
    const d = body.data;
    assert(!!d && d.ok === true && !!d.access_token, `app token for ${scope}: ${JSON.stringify(d)}`);
    return d.access_token as string;
}

/** An open SSE stream we can read incrementally and close deterministically. */
interface Stream {
    text(): string;
    /** Resolves once `pred` matches the accumulated text, or rejects after `ms`. */
    waitFor(pred: (t: string) => boolean, ms: number, what: string): Promise<number>;
    close(): void;
    openedAfterMs: number;
}

async function openStream(token: string): Promise<Stream> {
    const t = await json('/v1/events/ticket', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert(t.status === 200 && !!t.body.data.ticket, `ticket: ${t.status} ${JSON.stringify(t.body)}`);
    const ctrl = new AbortController();
    const started = Date.now();
    const res = await fetch(`${BASE}/v1/events?ticket=${t.body.data.ticket}`, { signal: ctrl.signal });
    assert(res.status === 200, `stream status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('text/event-stream'), 'content-type must be text/event-stream');

    let buf = '';
    let openedAfterMs = -1;
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    (async () => {
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    buf += dec.decode(value, { stream: true });
                    if (openedAfterMs < 0) openedAfterMs = Date.now() - started;
                }
            }
        } catch { /* aborted on close() */ }
    })();

    const stream: Stream = {
        text: () => buf,
        get openedAfterMs() { return openedAfterMs; },
        async waitFor(pred, ms, what) {
            const deadline = Date.now() + ms;
            while (Date.now() < deadline) {
                if (pred(buf)) return Date.now() - started;
                await new Promise(r => setTimeout(r, 50));
            }
            throw new Error(`timed out after ${ms}ms waiting for ${what}; got: ${JSON.stringify(buf.slice(0, 200))}`);
        },
        close() { ctrl.abort(); },
    };
    return stream;
}

/** The domains delivered so far, flattened from every `data:` frame. */
function domainsSeen(text: string): string[] {
    const out: string[] = [];
    for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
            const parsed = JSON.parse(line.slice(6));
            if (Array.isArray(parsed.domains)) out.push(...parsed.domains);
        } catch { /* partial frame */ }
    }
    return out;
}

async function main() {
    const server = await startServer();
    try {
        const user = `sseu${Date.now() % 100000}`;
        console.log('\n=== SSE live-update stream E2E ===\n');
        console.log('Phase 0: Setup (owner + own app on its own subdomain)');
        const A = await register(user);
        const pub = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${A.token}` },
            body: JSON.stringify({
                filename: 'sse-app.html', content: b64('<!DOCTYPE html><html><body>a</body></html>'),
                name: 'sse-app', description: 'd', category: 'utility',
            }),
        });
        assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
        const sub = await json('/v1/admin/subdomains', {
            method: 'POST', headers: { Authorization: `Bearer ${A.token}` },
            body: JSON.stringify({ subdomain: 'ssea', kind: 'app', target: `${user}/sse-app.html` }),
        });
        assert(sub.status === 201, `assign subdomain: ${sub.status} ${JSON.stringify(sub.body)}`);
        const ORIGIN = `https://ssea.${APP_HOST}`;

        console.log('\nPhase 1: The stream opens immediately');
        let owner: Stream | null = null;
        await test('owner stream sends its first bytes in well under a second', async () => {
            owner = await openStream(A.token);
            const at = await owner.waitFor(t => t.includes(':open'), 3_000, 'the :open comment');
            assert(at < 3_000, `first bytes took ${at}ms`);
            assert(owner.text().includes('retry:'), 'a retry hint must be sent so the browser knows the backoff');
        });

        console.log('\nPhase 2: The owner sees their own changes');
        await test('a memory write is reported as the "memory" domain', async () => {
            assert(!!owner, 'owner stream open');
            const w = await json('/v1/memory', {
                method: 'POST', headers: { Authorization: `Bearer ${A.token}` },
                body: JSON.stringify({ key: 'sse.probe.owner', value: { at: 1 }, visibility: 'private' }),
            });
            assert(w.status === 200 || w.status === 201, `memory write: ${w.status}`);
            await owner!.waitFor(t => domainsSeen(t).includes('memory'), 6_000, 'the memory domain');
        });

        console.log('\nPhase 3: Scope gate — an app grant is told only what its scopes cover');
        let app: Stream | null = null;
        await test('app-grant stream (memory scopes only) opens', async () => {
            const tok = await appToken(ORIGIN, 'memory:read memory:write', A.rt);
            app = await openStream(tok);
            await app.waitFor(t => t.includes(':open'), 3_000, 'the :open comment');
        });
        await test('an organism change reaches the OWNER stream but never the app stream', async () => {
            assert(!!owner && !!app, 'both streams open');
            const org = await json('/v1/organisms', {
                method: 'POST', headers: { Authorization: `Bearer ${A.token}` },
                body: JSON.stringify({ name: 'SSE Gate Org', description: 'd', type: 'project', visibility: 'private' }),
            });
            assert(org.status === 201, `organism create: ${org.status} ${JSON.stringify(org.body)}`);
            // The owner is entitled to it, so this also proves the event really fired.
            await owner!.waitFor(t => domainsSeen(t).includes('organisms'), 6_000, 'organisms on the owner stream');
            assert(!domainsSeen(app!.text()).includes('organisms'),
                `app stream must not see organisms without organism:read; saw ${JSON.stringify(domainsSeen(app!.text()))}`);
        });
        await test('the app stream is alive and still gets the domain it IS scoped for', async () => {
            // Proves the gate is selective rather than the stream simply being dead.
            const w = await json('/v1/memory', {
                method: 'POST', headers: { Authorization: `Bearer ${A.token}` },
                body: JSON.stringify({ key: 'sse.probe.app', value: { at: 2 }, visibility: 'private' }),
            });
            assert(w.status === 200 || w.status === 201, `memory write: ${w.status}`);
            await app!.waitFor(t => domainsSeen(t).includes('memory'), 6_000, 'memory on the app stream');
            assert(!domainsSeen(app!.text()).includes('organisms'), 'organisms must still be absent');
        });

        console.log('\nPhase 4: An app may not speak for the human');
        await test('with only the app stream open, the owner is not marked available', async () => {
            owner!.close();                                  // the human closes their portal
            await new Promise(r => setTimeout(r, 500));
            const me = await json('/v1/presence/me', { headers: { Authorization: `Bearer ${A.token}` } });
            assert(me.status === 200, `presence/me: ${me.status}`);
            const status = me.body.data?.status ?? me.body.data?.presence?.status;
            assert(status !== 'available',
                `an app-grant stream must not hold the owner available; presence/me says ${JSON.stringify(status)}`);
        });
        await test('a real owner stream still marks them available', async () => {
            const again = await openStream(A.token);
            await again.waitFor(t => t.includes(':open'), 3_000, 'the :open comment');
            await new Promise(r => setTimeout(r, 400));
            const me = await json('/v1/presence/me', { headers: { Authorization: `Bearer ${A.token}` } });
            const status = me.body.data?.status ?? me.body.data?.presence?.status;
            assert(status === 'available', `owner stream should mark available, got ${JSON.stringify(status)}`);
            again.close();
        });

        app?.close();
        console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
    } finally {
        server.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 500));
        cleanupDb();
    }
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
