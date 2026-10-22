/**
 * @file e2e-account-events-task-keep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: an app grant made before the update keeps reading a task's title and decline
 *   reason in the account's event record and the home feed (services/account-event-task-keep.ts).
 *   Since secaudit 2026-10, v89, those fields reach only the owner in person, an app grant holding
 *   task:read and the task's own agent (services/account-event-view.ts). The developer's ruling,
 *   2026-10-22: an app grant that existed before this update, holding memory:read but not task:read,
 *   keeps seeing them as before; a grant made after the update needs task:read. A published app's
 *   permissions change only when its author republishes it.
 *
 *   The suite starts its own node twice on one database, as e2e-unattended-publish-gate.ts does: the
 *   first start makes the grant, the second start runs the once-only step again with its record
 *   deleted, as a node updated now would.
 *
 *   KEPT (red without the step): the earlier grant gets the title and the reason on the window, the
 *   archive and the feed.
 *   REFUSED: before the step, the same grant gets the row withheld; a grant made after the step
 *   without task:read gets it withheld; the kept grant loses the keep once its owner narrows it; a
 *   sibling agent made before the step is not kept (the ruling covers apps only).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-account-events-task-keep
 * @version-history
 *   v1.0.1 — 2026-10-22 — The sibling agent and the app grant are refused the worker's task decline,
 *     with a 403 each (check:denial-coverage).
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v89; the developer's ruling of 2026-10-22).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb, type OwnNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner, ownerToken } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';
import { createStorage } from '../src/storage/storage-factory.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_TASK_KEEP_PORT ?? '40987';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const TAG = Date.now().toString(36).slice(-6);
const KEEP_STEP_KEY = 'migrations.account-event-task-content.keep';
const REDIRECT = 'http://localhost:9922/callback';
/** SHIPPED_DEFAULT_AGENT_SCOPES (src/config.ts): no task:read. */
const SHIPPED_DEFAULT = ['memory:read', 'memory:write', 'memory:delete', 'catalogue:read', 'organism:read', 'agent:read', 'messages:send', 'storage:write'];
const TITLE = `probe-title-${TAG}`;
const REASON = `probe-reason-${TAG}`;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => String(JSON.stringify(v) ?? v).slice(0, 400);
const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}

// ── the node, started twice on one database ──

const db: OwnNodeDb = await ownNodeDb('account-events-task-keep');
async function startServer(): Promise<ChildProcess> {
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_GHII: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the task-keep node' });
}
async function stopServer(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        await once(child, 'exit');
        clearTimeout(timer);
    }
    const began = Date.now();
    while (Date.now() - began < 30_000) {
        try { await fetch(`${BASE}/v1/spec`); } catch { return; }
        await sleep(150);
    }
}
async function withStorage<T>(fn: (s: Awaited<ReturnType<typeof createStorage>>) => Promise<T>): Promise<T> {
    const storage = db.provider === 'postgres-kysely'
        ? await createStorage({ provider: 'postgres-kysely', dbUrl: db.dbUrl })
        : await createStorage({ provider: 'sqlite', sqlitePath: db.sqlitePath });
    try { return await fn(storage); }
    finally { await (storage as unknown as { close?: () => unknown }).close?.(); }
}

// ── the app grants ──

const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

interface Grant { access: string; refresh: string; id: string }

/** Publish an app of the owner and grant it `scopes` through the consent flow. */
async function publishAndGrant(ownerTok: string, ownerName: string, filename: string, scopes: string[]): Promise<Grant> {
    const pub = await json('/v1/apps', {
        method: 'POST', headers: bearer(ownerTok),
        body: JSON.stringify({ filename, content: Buffer.from('<!DOCTYPE html><html><body>events</body></html>').toString('base64'), name: filename, description: 'reads what happened', category: 'utility' }),
    });
    assert(pub.status === 201, `publish ${pub.status}: ${short(pub.body)}`);
    const q = new URLSearchParams({
        app: `${ownerName}/${filename}`, response_type: 'code', scope: scopes.join(' '),
        redirect_uri: REDIRECT, state: 'x', code_challenge: codeChallenge, code_challenge_method: 'S256',
    });
    const authz = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(authz.status === 302, `authorize: ${authz.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(authz.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: bearer(ownerTok), body: JSON.stringify({ request_id: rid }) });
    assert(con.status === 200 && con.body.ok, `consent: ${con.status} ${short(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
    });
    assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${short(tok.body)}`);
    return { access: tok.body.data.access_token, refresh: tok.body.data.refresh_token, id: tok.body.data.grant_id };
}

/** A fresh access token for a grant, minted from the grant as it stands now. */
async function refresh(g: Grant): Promise<Grant> {
    const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: g.refresh }) });
    assert(tok.status === 200 && tok.body.ok, `refresh: ${tok.status} ${short(tok.body)}`);
    return { access: tok.body.data.access_token, refresh: tok.body.data.refresh_token, id: g.id };
}

async function agentToken(gaii: string, priv: string): Promise<string> {
    const ts = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(priv, 'base64'));
    const at = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: Buffer.from(sig).toString('base64') }) });
    assert(at.status === 200 && at.body.data?.token, `agent token ${at.status}: ${short(at.body)}`);
    return at.body.data.token as string;
}

// ── the reads ──

type Row = { kind: string; at: string; link?: string | null; data?: Record<string, string>; withheld?: string[] };
async function rows(path: string, token: string): Promise<Row[]> {
    const r = await json(path, { headers: bearer(token) });
    assert(r.status === 200, `${path} ${r.status}: ${short(r.body?.error)}`);
    return (r.body.data.events ?? r.body.data.items) as Row[];
}
const WINDOW = '/v1/account/events';
const ARCHIVE = '/v1/account/events/archive?limit=500';
const FEED = '/v1/home/feed';
let workerName = '';
const declined = (list: Row[]) => list.find(r => r.kind === 'agent_task_declined' && r.data?.agent === workerName);

function assertFull(row: Row | undefined, where: string): void {
    assert(row?.data?.title === TITLE && row.data?.reason === REASON && !row.withheld, `${where}: the title and the reason did not reach this reader: ${short(row)}`);
}
function assertWithheld(row: Row | undefined, where: string): void {
    assert(row !== undefined, `${where}: the row is gone`);
    assert(row.data?.title === undefined && row.data?.reason === undefined, `${where}: the task's content reached this reader: ${short(row)}`);
    assert(row.data?.agent === workerName && Array.isArray(row.withheld) && row.withheld.includes('title'), `${where}: the row lost its agent or its withheld list: ${short(row)}`);
}

console.log('\n=== App grants made before the update keep a task\'s title and reason in the event record (secaudit 2026-10, v89) ===\n');

let server = await startServer();
let ownerName = '';
let ownerTok = '';
let worker!: McpAgent;
let sibling!: McpAgent;
let early!: Grant;

await test('Setup: an owner, a worker agent and a sibling, an app granted memory:read without task:read, and a declined task', async () => {
    const owner = await registerOwner(BASE, `tk${TAG}`);
    ownerName = owner.name; ownerTok = owner.token;
    worker = await makeAgent(BASE, owner, SHIPPED_DEFAULT);
    workerName = worker.name;
    sibling = await makeAgent(BASE, owner, SHIPPED_DEFAULT);
    early = await publishAndGrant(ownerTok, ownerName, `tkearly${TAG}.html`, ['memory:read', 'memory:write']);
    const t = await json(`/v1/agents/${worker.name}/tasks`, { method: 'POST', headers: bearer(ownerTok), body: JSON.stringify({ title: TITLE, description: 'probe' }) });
    assert(t.status === 201, `task ${t.status}: ${short(t.body)}`);
    const d = await json(`/v1/agents/${worker.name}/tasks/${t.body.data.task.id}/decline`, { method: 'POST', headers: bearer(worker.token), body: JSON.stringify({ reason: REASON }) });
    assert(d.status === 200, `decline ${d.status}: ${short(d.body)}`);
    let seen = false;
    for (let i = 0; i < 40 && !seen; i++) {
        seen = !!declined(await rows(WINDOW, ownerTok));
        if (!seen) await sleep(250);
    }
    assert(seen === true, 'the owner never saw the declined row');
});

await test('before the step: the grant gets the row without the title and the reason, as the new rule says', async () => {
    assertWithheld(declined(await rows(WINDOW, early.access)), 'window');
    assertWithheld(declined(await rows(FEED, early.access)), 'feed');
});

await test('the node restarts as if updated now, and the step lists the earlier grant and no agent', async () => {
    await stopServer(server);
    await withStorage(async s => { await s.deleteMemory(`system@${NODE_ID}`, KEEP_STEP_KEY); });
    server = await startServer();
    ownerTok = await ownerToken(BASE, ownerName);
    sibling = { ...sibling, token: await agentToken(sibling.gaii, sibling.privateKey) };
    early = await refresh(early);
    const kept = await withStorage(async s => (await s.getMemory(`system@${NODE_ID}`, KEEP_STEP_KEY))?.value as any);
    const ids = (kept?.grants ?? []).map((g: { grantId: string }) => g.grantId);
    assert(ids.includes(early.id), `the step did not keep ${early.id}: ${short(kept)}`);
    assert(!JSON.stringify(kept).includes(sibling.gaii), `the step kept an agent: ${short(kept)}`);
});

await test('kept: the earlier grant gets the title and the reason on the window and the feed', async () => {
    assertFull(declined(await rows(WINDOW, early.access)), 'kept, window');
    assertFull(declined(await rows(FEED, early.access)), 'kept, feed');
});

await test('not kept: a sibling agent made before the step still gets the row without them', async () => {
    assertWithheld(declined(await rows(WINDOW, sibling.token)), 'sibling, window');
    assertWithheld(declined(await rows(FEED, sibling.token)), 'sibling, feed');
});

await test('not kept: a grant made after the step without task:read gets the row without them', async () => {
    const late = await publishAndGrant(ownerTok, ownerName, `tklate${TAG}.html`, ['memory:read', 'memory:write']);
    assert(late.id !== early.id, 'the later app reused the earlier grant');
    assertWithheld(declined(await rows(WINDOW, late.access)), 'later grant, window');
    assertWithheld(declined(await rows(FEED, late.access)), 'later grant, feed');
});

await test('kept: the earlier grant gets them on the archive too', async () => {
    const window = Number((await json(WINDOW, { headers: bearer(ownerTok) })).body.data.window);
    for (let i = 0; i < window; i++) {
        const r = await json(WINDOW, { method: 'POST', headers: bearer(early.access), body: JSON.stringify({ kind: 'filler', data: { n: String(i) } }) });
        assert(r.status === 201, `filler ${i}: ${r.status}`);
    }
    let moved = false;
    for (let i = 0; i < 40 && !moved; i++) {
        moved = !!declined(await rows(ARCHIVE, ownerTok));
        if (!moved) await sleep(250);
    }
    assert(moved === true, 'the declined row never reached the archive');
    assertFull(declined(await rows(ARCHIVE, early.access)), 'kept, archive');
    assertWithheld(declined(await rows(ARCHIVE, sibling.token)), 'sibling, archive');
});

await test('a narrowing ends the keep: once the owner takes a word away, the next token reads by the new rule', async () => {
    const p = await json(`/v1/app-grants/${early.id}`, { method: 'PATCH', headers: bearer(ownerTok), body: JSON.stringify({ scopes: ['memory:read'] }) });
    assert(p.status === 200, `narrow ${p.status}: ${short(p.body)}`);
    early = await refresh(early);
    // The row is in the archive by now (the test above), so the archive is where it is read.
    assertWithheld(declined(await rows(ARCHIVE, early.access)), 'narrowed, archive');
});

await test('refused: the sibling agent and the app grant cannot decline the worker\'s task (403 each), and the task stays open', async () => {
    const t = await json(`/v1/agents/${worker.name}/tasks`, { method: 'POST', headers: bearer(ownerTok), body: JSON.stringify({ title: `second-${TAG}`, description: 'probe' }) });
    assert(t.status === 201, `task ${t.status}: ${short(t.body)}`);
    const id = t.body.data.task.id as string;
    for (const [who, tok] of [['sibling agent', sibling.token], ['app grant', early.access]] as const) {
        const d = await json(`/v1/agents/${worker.name}/tasks/${id}/decline`, { method: 'POST', headers: bearer(tok), body: JSON.stringify({ reason: `by-${who}` }) });
        assert(d.status === 403, `the ${who}'s decline: ${d.status} ${short(d.body)}`);
    }
    const after = await json(`/v1/agents/${worker.name}/tasks/${id}`, { headers: bearer(ownerTok) });
    assert(after.status === 200 && after.body.data?.task?.status !== 'declined', `the task after the refusals: ${after.status} ${short(after.body?.data?.task ?? after.body)}`);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
await stopServer(server);
process.exit(failed > 0 ? 1 : 0);
