/**
 * @file e2e-portfolio-read-hold.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's welcome page reads the owner's memory, when the owner opens it signed in,
 *   only when the page served now was written by a writer that may read memory or the owner allowed it
 *   (services/portfolio-read-hold.ts; audit H-9, f-2026aug-h-9).
 *
 *   Designed use, which must keep working: any agent of the owner may write the page (Jouni,
 *   2026-10-31), the owner's own page signs in silently on its origin, and a page from before the check
 *   keeps working. The hole: an agent that may write files but not read memory wrote a page, and the
 *   page then read the owner's memory through the owner's own visit (the silent bridge's memory:read
 *   token, a refresh of an earlier one, and the SPA viewer's fetch bridge with the owner's session).
 *
 *   Starts its OWN node with the portfolio origin on, as e2e-app-silent does for the app origin: the
 *   shared runner has no portfolio host.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=portfolio-read-hold
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (audit H-9).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForServer } from './helpers/wait-for-server.js';

const PORT = process.env.E2E_PORTFOLIO_HOLD_PORT ?? '28461';
const BASE = `http://localhost:${PORT}`;
const PORTFOLIO_HOST = 'portfolio.aimeat.test';
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-portfolio-read-hold.db');

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

function extractRt(res: Response): string | null {
    const h: any = res.headers;
    const all: string[] = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean) as string[];
    for (const c of all) { const m = /(?:^|;\s*)aimeat_rt=([^;]*)/.exec(c); if (m) return decodeURIComponent(m[1]); }
    return null;
}
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, rt: extractRt(res) };
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function cleanupDb() { for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { if (existsSync(f)) unlinkSync(f); } catch { /* */ } } }

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb(PORT, { sqlitePath: DB_PATH });
    const env = {
        ...process.env, ...db.env, AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_PORTFOLIO_HOST: PORTFOLIO_HOST, AIMEAT_PORTFOLIO_ORIGIN_ENABLED: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the portfolio-read-hold node' });
}

async function register(username: string): Promise<{ rt: string; token: string }> {
    const pw = 'PortfolioPw#2026';
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: pw }) });
    assert(reg.status === 201, `register ${username}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username, password: pw }) });
    assert(login.status === 200 && !!login.rt, `login ${username}: ${login.status}`);
    return { rt: login.rt!, token: login.body.data.token };
}

/** An agent of `owner` with exactly `scopes`, approved by the owner on the consent card. */
async function agent(owner: string, ownerToken: string, name: string, scopes: string[]): Promise<string> {
    const a = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: name, owner, scopes }) });
    assert(a.status === 200, `authorize ${name}: ${a.status} ${JSON.stringify(a.body?.error)}`);
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: a.body.data.user_code, action: 'approve', owner_token: ownerToken, scopes }) });
    assert(v.status === 200, `approve ${name}: ${v.status} ${JSON.stringify(v.body?.error)}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: a.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(t.status === 200, `device-token ${name}: ${t.status}`);
    return t.body.access_token as string;
}

/** The silent bridge as the apex bridge page calls it for the owner's portfolio origin. */
async function silent(username: string, cookie: string) {
    const origin = `https://${username}.${PORTFOLIO_HOST}`;
    const res = await fetch(`${BASE}/v1/auth/app-grant-silent?origin=${encodeURIComponent(origin)}&scope=memory:read`,
        { headers: { Cookie: `aimeat_rt=${encodeURIComponent(cookie)}` } });
    return ((await res.json()) as any).data as { ok: boolean; error?: string; reason?: string; request_id?: string | null; access_token?: string; refresh_token?: string; scope?: string };
}
const page = (word: string) => `<!DOCTYPE html><html><head><title>${word}</title></head><body><h1>${word}</h1></body></html>`;
async function uploadAsOwner(token: string, html: string) {
    const res = await fetch(`${BASE}/v1/portfolio/upload`, { method: 'PUT', headers: { ...bearer(token), 'Content-Type': 'text/html' }, body: html });
    return { status: res.status, body: await res.json() as any };
}
const uploadAsAgent = (token: string, html: string) =>
    json('/v1/portfolio/upload', { method: 'PUT', headers: bearer(token), body: JSON.stringify({ html }) });
const viewerReads = async (owner: string, token: string) => (await json(`/v1/portfolio/data/${owner}`, { headers: bearer(token) })).body.data;

let server: ChildProcess | null = null;
try {
    server = await startServer();
    console.log('\nPortfolio read hold (audit H-9)');

    const OWNER = `ph${Date.now() % 100000}`;
    const owner = await register(OWNER);
    // The first agent is the one the page is stored under (services/portfolio-config.ts portfolioWriteGaii).
    const writer = await agent(OWNER, owner.token, 'page-writer', ['storage:write', 'storage:read', 'memory:write']);
    const reader = await agent(OWNER, owner.token, 'page-reader', ['storage:write', 'memory:read', 'memory:write']);
    let earlierRefresh = '';
    let waitingRequest = '';

    await test('designed use: the owner\'s own page signs in silently on its origin and reads memory', async () => {
        const up = await uploadAsOwner(owner.token, page('mine'));
        assert(up.status === 200 && !up.body.data.memory_read, `upload: ${up.status} ${JSON.stringify(up.body.data ?? up.body.error)}`);
        assert((await json('/v1/portfolio/config', { method: 'PUT', headers: bearer(owner.token), body: JSON.stringify({ enabled: true }) })).status === 200, 'switched on');
        const s = await silent(OWNER, owner.rt);
        assert(s.ok === true && s.scope === 'memory:read' && !!s.refresh_token, `silent: ${JSON.stringify(s)}`);
        earlierRefresh = s.refresh_token!;
        assert((await viewerReads(OWNER, owner.token)).viewer_reads_memory === true, 'the SPA viewer reads with the owner\'s session');
    });

    await test('designed use: an agent without memory:read may write the page, and is told the page asks the owner first', async () => {
        const up = await uploadAsAgent(writer, page('by the writer'));
        assert(up.status === 200 && up.body.data.uploaded === true, `upload: ${up.status} ${JSON.stringify(up.body?.error)}`);
        const pr = up.body.data.memory_read?.publish_request;
        assert(!!pr?.request_id && pr.kind === 'portfolio-memory-read' && pr.status === 'awaiting_owner', `memory_read: ${JSON.stringify(up.body.data.memory_read)}`);
        waitingRequest = pr.request_id;
        const served = await fetch(`${BASE}/v1/portfolio/data/${OWNER}`);
        assert(String(((await served.json()) as any).data.portfolio_html).includes('by the writer'), 'the new page is served');
    });

    await test('the page that agent wrote does not get a memory token through the owner\'s visit', async () => {
        const s = await silent(OWNER, owner.rt);
        assert(s.ok === false && s.error === 'consent_required' && s.reason === 'portfolio_read_waits' && s.request_id === waitingRequest, `silent: ${JSON.stringify(s)}`);
    });

    await test('nor by refreshing a token the earlier page held', async () => {
        const r = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: earlierRefresh }) });
        assert(r.status === 403 && r.body.error?.code === 'PORTFOLIO_READ_WAITS', `refresh: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    });

    await test('nor through the SPA viewer with the owner\'s session', async () => {
        const d = await viewerReads(OWNER, owner.token);
        assert(d.viewer_reads_memory === false && d.memory_read_request === waitingRequest, `data: ${JSON.stringify({ r: d.viewer_reads_memory, q: d.memory_read_request })}`);
    });

    await test('the writer cannot answer the question about its own page', async () => {
        const r = await json(`/v1/publish-requests/${waitingRequest}/decision`, { method: 'POST', headers: bearer(writer), body: JSON.stringify({ decision: 'approve' }) });
        assert(r.status === 403, `decision by the writer: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('designed use: the owner allows it with one press, and the page reads as before', async () => {
        const r = await json(`/v1/publish-requests/${waitingRequest}/decision`, { method: 'POST', headers: bearer(owner.token), body: JSON.stringify({ decision: 'approve' }) });
        assert(r.status === 200 && r.body.data.request.state === 'approved', `decision: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data?.request?.state)}`);
        const s = await silent(OWNER, owner.rt);
        assert(s.ok === true && s.scope === 'memory:read', `silent after the press: ${JSON.stringify(s)}`);
        assert((await viewerReads(OWNER, owner.token)).viewer_reads_memory === true, 'the viewer reads again');
    });

    await test('designed use: an agent that may read memory writes the page with no question', async () => {
        const up = await uploadAsAgent(reader, page('by the reader'));
        assert(up.status === 200 && !up.body.data.memory_read, `upload: ${up.status} ${JSON.stringify(up.body.data?.memory_read ?? up.body?.error)}`);
        const s = await silent(OWNER, owner.rt);
        assert(s.ok === true, `silent: ${JSON.stringify(s)}`);
    });

    await test('a page changed outside the page routes waits too, and the owner is asked', async () => {
        const w = await json('/v1/storage', { method: 'POST', headers: bearer(writer),
            body: JSON.stringify({ key: 'portfolio/index.html', data: Buffer.from(page('side door')).toString('base64'), mime_type: 'text/html', visibility: 'owner' }) });
        assert(w.status === 201 || w.status === 200, `generic write: ${w.status} ${JSON.stringify(w.body?.error)}`);
        const served = await fetch(`${BASE}/v1/portfolio/data/${OWNER}`);
        assert(String(((await served.json()) as any).data.portfolio_html).includes('side door'), 'the generic write replaced the served page');
        const s = await silent(OWNER, owner.rt);
        assert(s.ok === false && s.reason === 'portfolio_read_waits' && !!s.request_id, `silent: ${JSON.stringify(s)}`);
        const list = await json('/v1/publish-requests', { headers: bearer(owner.token) });
        const asked = (list.body.data.requests ?? list.body.data.items ?? []) as any[];
        assert(asked.some(r => r.id === s.request_id && r.kind === 'portfolio-memory-read'), `the owner's list: ${JSON.stringify(asked.map(r => [r.id, r.kind, r.state]))}`);
    });

    await test('designed use: a page from before the check keeps reading (adopted on its first read)', async () => {
        const OTHER = `${OWNER}b`;
        const other = await register(OTHER);
        // No agent: the page is stored under the GHII, written by a generic file write, so no page route saw it.
        const w = await json('/v1/storage', { method: 'POST', headers: bearer(other.token),
            body: JSON.stringify({ key: 'portfolio/index.html', data: Buffer.from(page('old page')).toString('base64'), mime_type: 'text/html', visibility: 'owner' }) });
        assert(w.status === 201 || w.status === 200, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
        assert((await json('/v1/portfolio/config', { method: 'PUT', headers: bearer(other.token), body: JSON.stringify({ enabled: true }) })).status === 200, 'switched on');
        const s = await silent(OTHER, other.rt);
        assert(s.ok === true && s.scope === 'memory:read', `silent: ${JSON.stringify(s)}`);
    });
} finally {
    server?.kill();
    cleanupDb();
}

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
