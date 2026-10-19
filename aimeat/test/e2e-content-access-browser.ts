/**
 * @file test/e2e-content-access-browser.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On a node set to signed-in content access, what a SIGNED-IN person's browser sends
 *   without a credential still works: a new tab, a link, an EventSource, a provider's redirect.
 *
 *   The SPA keeps the session in localStorage, so every request the browser makes on its own (not a
 *   script's fetch) carries no Authorization header even for a person who is signed in. The content
 *   access gate (middleware/content-access-gate.ts) refused each of them with a raw 401 before the
 *   route could answer. Each case here sends exactly what a browser sends (no Authorization, the
 *   browser's Accept) and is paired with what a stranger gets from the same address. Found by the
 *   signed-in browser audit (scripts/check-signed-in-browser.mjs) on 2026-10-19.
 *
 *   Self-spawns its own node (the shared runner keeps the node open).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-content-access-browser
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial.
 */
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';

const PORT = process.env.E2E_CONTENT_BROWSER_PORT ?? '40481';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-content-access-browser.db');
/** What a browser sends for a page load and a new tab. */
const PAGE_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** A request as the browser sends it: no Authorization header, the given Accept. */
async function browser(path: string, accept = PAGE_ACCEPT) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual', headers: { Accept: accept } });
    const ct = res.headers.get('content-type') ?? '';
    // An event stream never ends; read only what a refusal would carry.
    const body = ct.includes('event-stream') ? '' : await res.text();
    if (ct.includes('event-stream')) await res.body?.cancel();
    return { status: res.status, ct, body };
}
const refusedByGate = (r: { status: number; body: string }) => r.status === 401 && r.body.includes('SIGN_IN_REQUIRED');

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
        AIMEAT_ANONYMOUS: 'true',
        AIMEAT_CONNECTIONS_ENABLED: 'true',
        AIMEAT_ENCRYPTION_KEY: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
        AIMEAT_RL_GLOBAL: '100000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_GHII: '10000', AIMEAT_RL_OWNERS: '10000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the signed-in-only node' });
}

async function main() {
    const server = await startServer();
    const owner = `brwowner${Date.now() % 100000}`;
    const APP_NAME = 'Browser Audit App';
    let token = '';
    try {
        console.log('\n=== Signed-in content access: what a signed-in browser sends without a credential ===\n');

        await test('an owner registers and publishes an app (content the documents below must not name)', async () => {
            token = (await registerOwner(BASE, owner)).token;
            const pub = await fetch(`${BASE}/v1/apps`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ filename: 'browser-audit.html', content: b64(`<!DOCTYPE html><html><head><title>${APP_NAME}</title></head><body>x</body></html>`), name: APP_NAME, description: 'd', category: 'utility', tags: [] }) });
            assert(pub.status === 201, `publish ${pub.status}`);
        });

        await test('the node\'s own documents the showroom pages link to open in a new tab, and name no person or app', async () => {
            // Each is a link on a page a signed-in person reads (the front page footer, the everything,
            // glossary, transparency and app guide pages). A new tab carries no session.
            for (const path of ['/sitemap.md', '/v1/everything.md', '/v1/glossary.md?lang=fi', '/v1/glossary.json?lang=fi', '/v1/transparency.md',
                '/v1/ai-transparency.md', '/v1/schemas/ai-provenance/v1.json', '/v1/docs']) {
                const r = await browser(path);
                assert(r.status === 200, `${path}: ${r.status} ${r.body.slice(0, 120)}`);
                assert(!r.body.includes(owner) && !r.body.includes(APP_NAME), `${path} named the owner or the app`);
            }
            // The statement sends a browser to its page, which is the shell.
            const statement = await browser('/v1/ai-transparency');
            assert(statement.status === 302, `/v1/ai-transparency for a browser: ${statement.status}`);
        });

        await test('FAILURE: the documents stay closed where they hold content, and the API stays closed', async () => {
            for (const path of ['/v1/apps', '/v1/ai-transparency/mine', '/v1/catalogue', '/v1/glossary/x']) {
                const r = await browser(path, 'application/json');
                assert(refusedByGate(r), `${path} answered a stranger ${r.status}`);
            }
        });

        await test('the live stream opens for a signed-in person: the ticket is minted with the session, the EventSource carries only the ticket', async () => {
            const t = await fetch(`${BASE}/v1/events/ticket`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
            const ticket = ((await t.json()) as any)?.data?.ticket;
            assert(t.status === 200 && typeof ticket === 'string', `ticket ${t.status}`);
            const es = await browser(`/v1/events?ticket=${encodeURIComponent(ticket)}`, 'text/event-stream');
            assert(es.status === 200 && es.ct.includes('text/event-stream'), `stream: ${es.status} ${es.ct} ${es.body.slice(0, 120)}`);
        });

        await test('FAILURE: a stranger gets no ticket, and a stream address without a valid ticket opens nothing', async () => {
            const t = await fetch(`${BASE}/v1/events/ticket`, { method: 'POST' });
            assert(t.status === 401, `a stranger's ticket: ${t.status}`);
            const v = await fetch(`${BASE}/v1/events/visitor-ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            assert(v.status === 401, `a stranger's visitor ticket: ${v.status}`);
            for (const path of ['/v1/events?ticket=forged', '/v1/events']) {
                const r = await browser(path, 'text/event-stream');
                assert(!r.ct.includes('event-stream') && (r.status === 401 || r.status === 400), `${path}: ${r.status} ${r.ct}`);
            }
        });

        await test('a mail provider\'s redirect back reaches the connection callback, which answers for itself', async () => {
            // The browser comes from the provider's consent page with no session of ours. The callback's
            // own gates are the single-use state and the round cookie: an unknown state connects nothing.
            const r = await browser('/v1/connections/callback?state=unknown&code=x');
            assert(!refusedByGate(r), `the gate refused the callback: ${r.status}`);
            assert(r.status >= 400 && r.ct.includes('text/plain') && !r.body.includes(owner), `callback: ${r.status} ${r.ct} ${r.body.slice(0, 120)}`);
        });

        await test('the shell puts the session on its own reads before any view loads, and the files are served', async () => {
            // The views read /v1/apps, /v1/public/node-totals and the like with a plain fetch; on this node
            // js/closed-node-fetch.js adds the session (a stranger has none, so the gate still refuses).
            const shell = await browser('/v1/home');
            const at = shell.body.indexOf("import '/js/closed-node-fetch.js'");
            assert(shell.status === 200 && at > 0, 'the shell does not import closed-node-fetch.js');
            assert(at < shell.body.indexOf("import('/views/"), 'closed-node-fetch.js is imported after a view');
            for (const file of ['/js/closed-node-fetch.js', '/js/session-src.js', '/lib/live-updates.js']) {
                const r = await browser(file, '*/*');
                assert(r.status === 200, `${file}: ${r.status}`);
            }
            const live = (await browser('/lib/live-updates.js', '*/*')).body;
            assert(/!jwt && \(!visitorOk \|\| closedNode\(\)\)/.test(live), 'live-updates.js still asks this node for a visitor ticket');
            const withSession = await fetch(`${BASE}/v1/apps`, { headers: { Authorization: `Bearer ${token}` } });
            assert(withSession.status === 200, `the same read with the session: ${withSession.status}`);
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
