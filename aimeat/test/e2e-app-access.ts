/**
 * @file test/e2e-app-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may OPEN an app, beside its access code (plan doc-mvcn6c7e4e5q, V2.7): the app's
 *   `open_to` setting (anyone, signed-in, organism:<id>) and the node's defaults for a new app.
 *
 *   The node this suite starts gives a new app `unlisted` and `signed-in` (AIMEAT_APP_DEFAULT_LISTING,
 *   AIMEAT_APP_DEFAULT_ACCESS), so the first publish proves the defaults and a later one proves that
 *   the owner's own choice is kept. Then each gate a caller meets: the apex read (401 without an
 *   account, 302 to the open page for a browser, 403 for an account the app does not open for), the
 *   app origin (a grant or nothing), POST /v1/apps/:owner/:filename/open (the address with a grant),
 *   an organism's members against an outsider, and an owner naming an organism they are not in.
 *
 *   Self-spawns its own node with the app origin provisioned.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-access
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V2.7).
 */
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostRequest } from './helpers/host-request.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';

const PORT = process.env.E2E_APP_ACCESS_PORT ?? '40267';
const BASE = `http://localhost:${PORT}`;
const APP_HOST = 'apps.access.test';
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-app-access.db');

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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

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
        AIMEAT_APP_HOST: APP_HOST, AIMEAT_APP_ORIGIN_ENABLED: 'true',
        AIMEAT_APP_DEFAULT_LISTING: 'unlisted', AIMEAT_APP_DEFAULT_ACCESS: 'signed-in',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_GHII: '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the app-access node' });
}

/** The app page on its own origin, the way a browser opens it. */
function onOrigin(sub: string, pathAndQuery: string, accept = 'text/html') {
    return hostRequest(BASE, pathAndQuery, `${sub}.${APP_HOST}:${PORT}`, { headers: { 'x-app-origin': '1', 'x-subdomain': sub, Accept: accept } });
}

async function main() {
    const server = await startServer();
    const stamp = Date.now() % 100000;
    const owner = `accowner${stamp}`, member = `accmember${stamp}`, outsider = `accout${stamp}`;
    const file = 'team-tool.html', sub = 'team-tool';
    const BODY = 'TEAM TOOL BODY';
    let ownerTok = '', memberTok = '', outsiderTok = '', orgId = '';
    const settings = (body: unknown, tok = ownerTok) => json(`/v1/apps/${file}`, { method: 'PATCH', headers: auth(tok), body: JSON.stringify(body) });
    try {
        console.log('\n=== Who may open an app ===\n');

        await test('setup: an owner, a member of the owner\'s organism and an outsider', async () => {
            ownerTok = (await registerOwner(BASE, owner)).token;
            memberTok = (await registerOwner(BASE, member)).token;
            outsiderTok = (await registerOwner(BASE, outsider)).token;
            const o = await json('/v1/organisms', { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ name: 'Talent Team', type: 'team', join_policy: 'open', visibility: 'private' }) });
            assert(o.status === 201, `org ${o.status}`);
            orgId = o.body.data.organism.id;
            const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(memberTok), body: '{}' });
            assert(j.status === 200 || j.status === 201, `join ${j.status}`);
        });

        await test('a FIRST publish takes the node\'s new-app defaults: unlisted, opens for signed-in people', async () => {
            const pub = await json('/v1/apps', { method: 'POST', headers: auth(ownerTok),
                body: JSON.stringify({ filename: file, content: b64(`<!DOCTYPE html><html><body><h1>${BODY}</h1></body></html>`), name: 'Team Tool', description: 'd', category: 'utility', tags: [] }) });
            assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body)}`);
            const s = await settings({ name: 'Team Tool' });
            assert(s.status === 200 && s.body.data.listing === 'unlisted' && s.body.data.open_to === 'signed-in', `settings: ${JSON.stringify(s.body.data)}`);
        });

        await test('the apex read: no account → 401, a browser → the open page, another account → the app', async () => {
            const anon = await json(`/v1/apps/${owner}/${file}`, { headers: { Accept: 'application/json' } });
            assert(anon.status === 401 && anon.body.error?.code === 'SIGN_IN_REQUIRED', `anon ${anon.status} ${JSON.stringify(anon.body.error)}`);
            const browser = await fetch(`${BASE}/v1/apps/${owner}/${file}?mode=inline`, { redirect: 'manual', headers: { Accept: 'text/html' } });
            assert(browser.status === 302 && (browser.headers.get('location') ?? '').startsWith('/v1/app-open?app='), `browser ${browser.status} ${browser.headers.get('location')}`);
            const other = await fetch(`${BASE}/v1/apps/${owner}/${file}`, { headers: auth(outsiderTok) });
            assert(other.status === 200 && (await other.text()).includes(BODY), `another account ${other.status}`);
        });

        await test('the app origin serves the app only with a grant; a browser without one goes to the open page', async () => {
            await fetch(`${BASE}/v1/apps/${owner}/${file}?mode=inline`, { redirect: 'manual', headers: auth(ownerTok) });   // assigns the subdomain
            const none = await onOrigin(sub, '/');
            assert(none.status === 302 && (none.header('location') ?? '').includes('/v1/app-open?app='), `no grant: ${none.status} ${none.header('location')}`);
            assert(!none.body.includes(BODY), 'the origin served the app without a grant');
            const open = await json(`/v1/apps/${owner}/${file}/open`, { method: 'POST', headers: auth(outsiderTok), body: '{}' });
            assert(open.status === 200, `open ${open.status} ${JSON.stringify(open.body)}`);
            const u = new URL(open.body.data.url);
            const page = await onOrigin(sub, `${u.pathname}${u.search}`);
            assert(page.status === 200 && page.body.includes(BODY), `granted: ${page.status}`);
            const anonOpen = await json(`/v1/apps/${owner}/${file}/open`, { method: 'POST', body: '{}' });
            assert(anonOpen.status === 401, `a stranger asked for the address: ${anonOpen.status}`);
        });

        await test('open_to an organism: a member opens it, an outsider is refused (403) on the apex and the open route', async () => {
            const s = await settings({ open_to: `organism:${orgId}` });
            assert(s.status === 200 && s.body.data.open_to === `organism:${orgId}`, `set organism: ${s.status} ${JSON.stringify(s.body)}`);
            const m = await json(`/v1/apps/${owner}/${file}/open`, { method: 'POST', headers: auth(memberTok), body: '{}' });
            assert(m.status === 200, `member open ${m.status}`);
            const o = await json(`/v1/apps/${owner}/${file}/open`, { method: 'POST', headers: auth(outsiderTok), body: '{}' });
            assert(o.status === 403 && o.body.error?.code === 'ACCESS_DENIED', `outsider open ${o.status} ${JSON.stringify(o.body.error)}`);
            const apex = await fetch(`${BASE}/v1/apps/${owner}/${file}`, { headers: auth(outsiderTok) });
            assert(apex.status === 403, `outsider apex ${apex.status}`);
            const own = await fetch(`${BASE}/v1/apps/${owner}/${file}`, { headers: auth(ownerTok) });
            assert(own.status === 200, `the owner always opens it: ${own.status}`);
        });

        await test('a grant for this app opens no other app', async () => {
            const pub2 = await json('/v1/apps', { method: 'POST', headers: auth(ownerTok),
                body: JSON.stringify({ filename: 'other-tool.html', content: b64('<!DOCTYPE html><html><body>OTHER</body></html>'), name: 'Other', description: 'd', category: 'utility', tags: [] }) });
            assert(pub2.status === 201, `publish 2 ${pub2.status}`);
            await fetch(`${BASE}/v1/apps/${owner}/other-tool.html?mode=inline`, { redirect: 'manual', headers: auth(ownerTok) });
            const m = await json(`/v1/apps/${owner}/${file}/open`, { method: 'POST', headers: auth(memberTok), body: '{}' });
            const grant = new URL(m.body.data.url).searchParams.get('access')!;
            const wrong = await onOrigin('other-tool', `/?access=${encodeURIComponent(grant)}`, 'application/json');
            assert(wrong.status === 404 && !wrong.body.includes('OTHER'), `a grant opened another app: ${wrong.status}`);
        });

        await test('FAILURE: an owner naming an organism they are not in is refused, and nothing in the same PATCH is written', async () => {
            const o2 = await json('/v1/organisms', { method: 'POST', headers: auth(outsiderTok), body: JSON.stringify({ name: 'Not Yours', type: 'team', visibility: 'private' }) });
            const foreign = o2.body.data.organism.id;
            const r = await settings({ name: 'Renamed By Mistake', open_to: `organism:${foreign}` });
            assert(r.status === 400 && /not an active member/.test(r.body.error?.message ?? ''), `refusal ${r.status} ${JSON.stringify(r.body.error)}`);
            const s = await settings({ forkable: false });
            assert(s.body.data.name === 'Team Tool' && s.body.data.open_to === `organism:${orgId}`, `something was written: ${JSON.stringify(s.body.data)}`);
            const bad = await settings({ open_to: 'everyone' });
            assert(bad.status === 400, `an unknown value: ${bad.status}`);
        });

        await test('the owner\'s own choice survives a new version: open to anyone stays open', async () => {
            const s = await settings({ open_to: 'anyone' });
            assert(s.status === 200 && s.body.data.open_to === 'anyone', `set anyone ${s.status}`);
            const pub = await json('/v1/apps', { method: 'POST', headers: auth(ownerTok),
                body: JSON.stringify({ filename: file, content: b64(`<!DOCTYPE html><html><body><h1>${BODY} v2</h1></body></html>`), name: 'Team Tool', description: 'd', category: 'utility', tags: [] }) });
            assert(pub.status === 201 || pub.status === 200, `republish ${pub.status}`);
            const anon = await fetch(`${BASE}/v1/apps/${owner}/${file}`);
            assert(anon.status === 200 && (await anon.text()).includes('v2'), `anyone opens it: ${anon.status}`);
            const after = await settings({ forkable: false });
            assert(after.body.data.open_to === 'anyone' && after.body.data.listing === 'unlisted', `kept: ${JSON.stringify(after.body.data)}`);
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
