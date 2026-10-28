/**
 * @file test/e2e-purpose-visitors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description PURPOSE: visitors without registration, and anonymous mode, are a supported path.
 *   On the runner's node (anonymous mode as the run sets it, off on the production-settings lane) a
 *   visitor with no credential reads an owner's public record and opens a published app. On a node
 *   whose operator turned anonymous mode on, started here: the token anybody can mint writes and reads
 *   its own `anonymous.*` record, runs a public extension action, and opens the App Catalog's cortex
 *   detail popup (`GET /v1/cortex/:name`). AIMEAT-PURPOSE.md use 5, invariant 20.
 *
 *   WHY IT EXISTS. The October 2026 audit's second wave made the minted anonymous token "nobody"
 *   everywhere, which was right for the people directory and wrong for the App Catalog popups and the
 *   landing pages that write their own anonymous data; every suite stayed green because the guard
 *   tier runs with anonymous mode off and nothing asserted the use. Each test here names the use and
 *   fails when the use is gone.
 *
 *   FAIL FIRST, 2026-10-21, both backends: with GET /v1/cortex/:name refusing the anonymous principal
 *   (routes/cortex.ts, the shape that removed the popup), test 6 is red; restored byte for byte.
 *
 *   THE NODE runs on the run's backend (test/helpers/own-node-db.ts) on E2E_PURPOSE_ANON_PORT, 28820
 *   by default, with production settings apart from anonymous mode.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-purpose-visitors
 * @version-history
 *   v1.0.0 -- 2026-10-21 -- Initial (wish wish-tarkoitustestit-e2e-sarjat-jotka-varmistavat-aimeatin-suunni).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { BASE, NODE_ID, assert, auth, harness, installExtension, json } from './helpers/purpose-kit.js';

const h = harness('Purpose: visitors without registration and anonymous mode');
const STAMP = Date.now().toString(36);
const ANON_PORT = parseInt(process.env.E2E_PURPOSE_ANON_PORT ?? '28820', 10);
const ANON = `http://127.0.0.1:${ANON_PORT}`;
const ANON_NODE_ID = `aimeat-test-001-anon${STAMP.slice(-6)}`;

const EXT = `purposepub${STAMP}`;
const EXT_MANIFEST = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'A landing page action anybody may run.', author: 'purpose' },
    actions: [{ id: 'hello', method: 'POST', path: '/hello', script: 'hello', public: true }],
    limits: { timeout_ms: 5000, max_api_calls: 2 },
}, null, 2);
const EXT_SCRIPTS = { hello: 'export default async function (ctx, input) { return { hello: "welcome, " + (input.name || "visitor"), anonymous: ctx.caller.anonymous === true }; }' };

// ── The runner's node: a visitor with no credential ──
const owner = await registerOwner(BASE, `purposevis${STAMP}`);
const PUBLIC_KEY = `purpose.${STAMP}.opening-hours`;
const APP = `purpose-landing-${STAMP}.html`;

await h.test('1. A visitor with no credential reads an owner\'s public record', async () => {
    const w = await json('/v1/memory', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ key: PUBLIC_KEY, value: { open: '9-17' }, visibility: 'public' }) });
    assert(w.status === 201, `the owner writes it: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const r = await json(`/v1/memory/${encodeURIComponent(`${owner.name}@${NODE_ID}`)}/${encodeURIComponent(PUBLIC_KEY)}`);
    assert(r.status === 200 && r.body.data?.value?.open === '9-17', `the visitor reads it: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

await h.test('2. A visitor with no credential opens a published app', async () => {
    const html = '<!DOCTYPE html><html><head><title>Landing</title></head><body>purpose landing page</body></html>';
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: APP, content: Buffer.from(html).toString('base64'), name: 'Purpose landing', description: 'purpose e2e', category: 'utility' }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body?.error)}`);
    const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(owner.name)}/${APP}`);
    const text = await res.text();
    assert(res.status === 200 && text.includes('purpose landing page'), `the visitor opens it: ${res.status} ${text.slice(0, 200)}`);
});

// ── A node whose operator turned anonymous mode on ──
const db = await ownNodeDb(`purpose-anon-${ANON_PORT}`);
let node: ChildProcess | null = null;

function nodeEnv(): NodeJS.ProcessEnv {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('AIMEAT_') || k === 'DATABASE_URL') delete env[k];
    Object.assign(env, db.env, {
        AIMEAT_PORT: String(ANON_PORT),
        AIMEAT_NODE_ID: ANON_NODE_ID,
        AIMEAT_ADMIN_PASSWORD: `Anon-Admin-${STAMP}-Pw!`,
        AIMEAT_ENCRYPTION_KEY: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
        AIMEAT_LOG_LEVEL: 'warn',
        AIMEAT_SMTP_HOST: '',
        AIMEAT_ANONYMOUS: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000', AIMEAT_LOGIN_RATE_LIMIT_MAX: '1000',
    });
    return env as NodeJS.ProcessEnv;
}

async function stopNode(): Promise<void> {
    const running = (n: ChildProcess) => n.exitCode === null && n.signalCode === null;
    if (!node || !running(node)) return;
    const exited = once(node, 'exit');
    node.kill('SIGTERM');
    await Promise.race([exited, new Promise(r => setTimeout(r, 10_000))]);
    if (running(node)) { node.kill('SIGKILL'); await exited; }
}

const anon = (path: string, opts: RequestInit = {}) => json(path, opts, ANON);
let minted = '';

try {
    await h.test('3. Setup: a node with anonymous mode on; its first owner shares a public action and a public record', async () => {
        node = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env: nodeEnv(), stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
        await waitForServer(node, ANON, { label: 'the anonymous-mode node' });
        const op = await registerOwner(ANON, `anonop${STAMP}`);
        await installExtension(op.token, EXT, EXT_MANIFEST, EXT_SCRIPTS, ANON);
        const w = await anon('/v1/memory', { method: 'POST', headers: auth(op.token), body: JSON.stringify({ key: PUBLIC_KEY, value: { open: '8-16' }, visibility: 'public' }) });
        assert(w.status === 201, `the public record: ${w.status} ${JSON.stringify(w.body?.error)}`);
        const r = await anon(`/v1/memory/${encodeURIComponent(`${op.name}@${ANON_NODE_ID}`)}/${encodeURIComponent(PUBLIC_KEY)}`);
        assert(r.status === 200 && r.body.data?.value?.open === '8-16', `a visitor reads it here too: ${r.status}`);
        const t = await anon('/v1/auth/anonymous', { method: 'POST' });
        assert(t.status === 200 && typeof t.body.data?.token === 'string', `anybody mints the anonymous token: ${t.status} ${JSON.stringify(t.body?.error)}`);
        minted = t.body.data.token;
    });

    await h.test('4. ANONYMOUS MODE: the minted token writes its own anonymous.* record and reads it back', async () => {
        const key = `anonymous.purpose-${STAMP}`;
        const w = await anon('/v1/memory', { method: 'POST', headers: auth(minted), body: JSON.stringify({ key, value: { cart: ['tea'] } }) });
        assert(w.status === 201, `the write: ${w.status} ${JSON.stringify(w.body?.error)}`);
        const r = await anon(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth(minted) });
        assert(r.status === 200 && r.body.data?.value?.cart?.[0] === 'tea', `the read: ${r.status} ${JSON.stringify(r.body?.error)}`);
        // Its own space is anonymous.*, and only that: everybody holds this token.
        const outside = await anon('/v1/memory', { method: 'POST', headers: auth(minted), body: JSON.stringify({ key: `purpose.${STAMP}.outside`, value: 1 }) });
        assert(outside.status === 403, `a write outside anonymous.*: ${outside.status} ${JSON.stringify(outside.body?.error)}`);
    });

    await h.test('5. A public extension action answers the minted token and a caller with no token', async () => {
        for (const headers of [auth(minted), {}]) {
            const r = await anon(`/v1/ext/${EXT}/hello`, { method: 'POST', headers, body: JSON.stringify({ name: 'guest' }) });
            assert(r.status === 200 && r.body.data?.hello === 'welcome, guest', `the action: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
        }
    });

    await h.test("6. The App Catalog's cortex popup: the minted token lists the public cortexes and opens one's detail", async () => {
        const list = await anon('/v1/cortex?status=active&visibility=public', { headers: auth(minted) });
        const exts = list.body?.data?.extensions ?? [];
        assert(list.status === 200 && exts.length > 0, `the strip: ${list.status} ${JSON.stringify(list.body?.error ?? list.body?.data)}`);
        const detail = await anon(`/v1/cortex/${encodeURIComponent(exts[0].name)}`, { headers: auth(minted) });
        assert(detail.status === 200 && detail.body.data?.name === exts[0].name && Array.isArray(detail.body.data.components),
            `the popup: ${detail.status} ${JSON.stringify(detail.body?.error)}`);
    });
} finally {
    await stopNode();
}

h.finish();
