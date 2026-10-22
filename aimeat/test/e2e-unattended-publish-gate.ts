/**
 * @file test/e2e-unattended-publish-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An extension's ctx.files.write and ctx.datapackage.publish, and a workflow's
 *   datapackage step, meet the publish gate the upload and data package routes meet.
 *
 *   WHY THIS SUITE EXISTS. On a node whose publish gate is on, an agent without publish:public that
 *   publishes a data package through POST /v1/datapackages, or uploads a public file through POST
 *   /v1/storage, gets it stored at the level it had and a request the owner approves. The same agent
 *   made a package or a file public at once through an extension it installed (attended, and on its
 *   @activate schedule in the owner's namespace) or through a workflow datapackage step, and no request
 *   was filed (secaudit 2026-10, v68 and v69). The contrast exists only on a node with the gate on, so
 *   this suite starts its own node with AIMEAT_PUBLISH_GATE=agents; every other suite keeps its node's
 *   default.
 *
 *   WHAT IS PROVEN. The refusals, each against the route's control: the agent's package and file
 *   through its own extension (attended and @activate), through a workflow datapackage step it saved,
 *   and through a workflow extension step it saved that calls the owner's producer, all stay
 *   unreadable to an anonymous reader and each files one request naming the agent; the owner's
 *   approval opens the same address. And the uses that must not change, on the same node: the owner
 *   in person through the same extension and the same workflows, an agent holding publish:public, a
 *   republish of a package already public, and an owner-installed producer on its @activate schedule
 *   all publish public at once. Last, what exists at the update: an extension an agent installed, and
 *   a workflow an agent saved, before the node first ran this rule keep publishing public, until the
 *   extension's code or the workflow's definition changes.
 * @structure
 *   - Phase 1 the node, the owner and two agents
 *   - Phase 2 ctx.datapackage.publish, attended (v68)
 *   - Phase 3 ctx.files.write, attended (v69)
 *   - Phase 4 the @activate schedule, unattended (v68, v69)
 *   - Phase 5 workflows (v68)
 *   - Phase 6 what exists at the update keeps working
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-unattended-publish-gate
 * @version-history
 *   2026-10-22 — The agent is refused the approval of the request its own extension filed, with a 403
 *     (check:denial-coverage).
 *   2026-10-22 — Initial (secaudit 2026-10, v68 and v69).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb, type OwnNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner, ownerToken } from './helpers/owner-login.js';
import { createStorage } from '../src/storage/storage-factory.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_UNATTENDED_GATE_PORT ?? '40949';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const STAMP = Date.now().toString(36).slice(-6);
const KEEP_STEP_KEY = 'migrations.extension-publish-gate-keep';

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
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}
/** An anonymous GET of a published address: its status. */
async function anon(url: string): Promise<number> {
    return (await fetch(url.startsWith('http') ? url : `${BASE}${url}`)).status;
}

const sign = async (privB64: string, message: string): Promise<string> =>
    Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');

// ── the node, started twice on one database ──

const db: OwnNodeDb = await ownNodeDb('unattended-publish-gate');
async function startServer(): Promise<ChildProcess> {
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_PUBLISH_GATE: 'agents',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_GHII: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the unattended publish-gate node' });
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

// ── the extension ──

const SCRIPTS = (tag: string) => ({
    pkg: `export default async function(ctx, input){ return await ctx.datapackage.publish({ name: input.name, changes: 'probe ${tag}', resources: [{ name: 'rows', rows: [{ a: 1 }, { a: 2 }], schema: 'infer' }] }); }`,
    file: `export default async function(ctx, input){ return await ctx.files.write(input.key, input.b64, { mime: 'text/plain', visibility: 'public' }); }`,
    act: `export default async function(ctx){
        var f = await ctx.files.write('probe-activate.txt', '${b64('written on activate')}', { mime: 'text/plain', visibility: 'public' });
        var p = await ctx.datapackage.publish({ name: '${tag}-act', changes: 'on activate', resources: [{ name: 'rows', rows: [{ a: 1 }], schema: 'infer' }] });
        return { f: f, p: p };
    }`,
});
function manifest(name: string, withActivate: boolean, version = '1.0.0'): string {
    return JSON.stringify({
        metadata: { name, version, description: 'unattended publish gate e2e', author: 'e2e' },
        actions: [
            { id: 'pkg', method: 'POST', path: '/pkg', script: 'pkg' },
            { id: 'file', method: 'POST', path: '/file', script: 'file' },
            { id: 'act', method: 'POST', path: '/act', script: 'act' },
        ],
        ...(withActivate ? { schedules: [{ id: 'first-run', action: 'act', cron: '@activate' }] } : {}),
        limits: { timeout_ms: 10000, max_api_calls: 8 },
    });
}
async function install(token: string, name: string, withActivate: boolean, scripts = SCRIPTS(name)): Promise<void> {
    const inst = await json('/v1/extensions', { method: 'POST', headers: bearer(token), body: JSON.stringify({ manifest: manifest(name, withActivate), scripts }) });
    assert(inst.status === 201, `install ${name}: ${inst.status} ${short(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${name}/activate`, { method: 'POST', headers: bearer(token) });
    assert(act.status === 200, `activate ${name}: ${act.status} ${short(act.body?.error)}`);
}
async function invoke(token: string, ext: string, action: string, input: Record<string, unknown>): Promise<any> {
    const r = await json(`/v1/ext/${ext}/${action}`, { method: 'POST', headers: bearer(token), body: JSON.stringify(input) });
    assert(r.status === 200, `invoke ${ext}/${action}: ${r.status} ${short(r.body?.error)}`);
    return r.body.data?.result ?? r.body.data;
}

// ── the workflows ──

async function settle(token: string, wfId: string, runId: string): Promise<any> {
    for (let i = 0; i < 80; i++) {
        const { body } = await json(`/v1/workflows/${wfId}/runs/${runId}`, { headers: bearer(token) });
        const run = body.data?.run ?? body.data;
        if (run && !['running', 'waiting-step'].includes(run.status)) return run;
        await sleep(250);
    }
    const { body } = await json(`/v1/workflows/${wfId}/runs/${runId}`, { headers: bearer(token) });
    return body.data?.run ?? body.data;
}
async function runWorkflow(token: string, wfId: string): Promise<any> {
    const r = await json(`/v1/workflows/${wfId}/run`, { method: 'POST', headers: bearer(token), body: JSON.stringify({ mode: 'full', target: 'live' }) });
    assert(r.status === 200, `run ${wfId}: ${r.status} ${short(r.body?.error ?? r.body?.data)}`);
    return settle(token, wfId, r.body.data.run?.runId ?? r.body.data.runId);
}
async function saveWorkflow(token: string, wfId: string, steps: unknown[], title = 'publish gate'): Promise<void> {
    const def = { title: { en_US: title }, description: { en_US: 'e2e' }, trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect', steps };
    const s = await json(`/v1/workflows/${wfId}`, { method: 'PUT', headers: bearer(token), body: JSON.stringify(def) });
    assert(s.status === 200, `save ${wfId}: ${s.status} ${short(s.body?.data?.errors ?? s.body?.error)}`);
}
const dpStep = (name: string) => ({
    id: 'publish', description: { en_US: 'publish' }, required_to_function: 'none',
    action: { kind: 'datapackage', name, from_key: 'gate.rows', rows_at: 'rows', changes: 'from a workflow' },
});
const extStep = (ext: string, name: string) => ({
    id: 'produce', description: { en_US: 'produce' }, required_to_function: 'none',
    action: { kind: 'extension', extension: ext, action: 'pkg', input: { name }, result_to_key: `gate.${name}.result` },
});

// ── the owner's view ──

let ownerName = '';
let ownerGhii = '';
let ownerTok = '';
async function requests(): Promise<any[]> {
    const r = await json('/v1/publish-requests', { headers: bearer(ownerTok) });
    assert(r.status === 200, `publish requests ${r.status}: ${short(r.body)}`);
    return r.body.data?.requests ?? [];
}
async function waitingFor(kind: string, name: string): Promise<any | undefined> {
    return (await requests()).find(q => q.kind === kind && q.name === name && q.state === 'awaiting_owner');
}
async function approve(id: string): Promise<void> {
    const d = await json(`/v1/publish-requests/${id}/decision`, { method: 'POST', headers: bearer(ownerTok), body: JSON.stringify({ decision: 'approve' }) });
    assert(d.status === 200 && d.body.data?.request?.state === 'approved', `approve ${id}: ${d.status} ${short(d.body)}`);
}
const pkgUrl = (name: string) => `/v1/datapackages/${encodeURIComponent(ownerName)}/${name}`;

console.log('\n=== Extensions and workflows meet the publish gate ===\n');
console.log('Phase 1 — the node, the owner and two agents');

let server = await startServer();

let agentGaii = '';
let agentTok = '';
let agentPrivate = '';
let wordTok = '';
const EXT = `upg${STAMP}`;
const OWNEXT = `upgown${STAMP}`;

async function agentToken(gaii: string, priv: string): Promise<string> {
    const ts = new Date().toISOString();
    const at = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(priv, gaii + ts) }) });
    assert(at.status === 200 && at.body.data?.token, `agent token ${at.status}: ${short(at.body)}`);
    return at.body.data.token as string;
}

await test('the owner, an agent on full access without publish:public, and an agent holding it', async () => {
    const owner = await registerOwner(BASE, `upg${STAMP}`);
    ownerName = owner.name; ownerGhii = owner.ghii; ownerTok = owner.token;
    const mk = async (name: string, scopes: string[]) => {
        const a = await json('/v1/agents', { method: 'POST', headers: bearer(ownerTok), body: JSON.stringify({ name, owner: ownerName, model: 'gpt-4o', scopes }) });
        assert(a.status === 201, `agent ${name}: ${a.status} ${short(a.body)}`);
        return { gaii: a.body.data.agent.gaii as string, priv: a.body.data.private_key as string, scopes: a.body.data.agent.scopes ?? a.body.data.agent.default_scopes ?? [] };
    };
    const plain = await mk('upgplain', ['*', 'memory:read-as-owner']);
    assert(!plain.scopes.includes('publish:public'), `the plain agent must not hold publish:public: ${short(plain.scopes)}`);
    agentGaii = plain.gaii; agentPrivate = plain.priv;
    agentTok = await agentToken(plain.gaii, plain.priv);
    const worded = await mk('upgword', ['*', 'publish:public']);
    wordTok = await agentToken(worded.gaii, worded.priv);
    // The rows a workflow datapackage step publishes, in the owner's namespace.
    const w = await json('/v1/memory', { method: 'POST', headers: bearer(ownerTok), body: JSON.stringify({ key: 'gate.rows', value: { rows: [{ a: 1 }, { a: 2 }] }, visibility: 'private' }) });
    assert(w.status === 201, `rows ${w.status}: ${short(w.body)}`);
});

console.log('\nPhase 2 — ctx.datapackage.publish, attended (v68)');

await test('control: the agent\'s POST /v1/datapackages is held and asked about', async () => {
    const r = await json('/v1/datapackages', { method: 'POST', headers: bearer(agentTok), body: JSON.stringify({ name: `${EXT}-ctl`, changes: 'control', resources: [{ name: 'rows', rows: [{ a: 1 }] }] }) });
    assert(r.status === 202 && r.body.data?.publish_request?.status === 'awaiting_owner', `the gate is not on: ${r.status} ${short(r.body)}`);
    assert(await anon(pkgUrl(`${EXT}-ctl`)) !== 200, 'the held control package is readable anonymously');
});

let attendedRequest = '';
await test('the agent\'s own extension publishes at the kept level and files a request naming the agent', async () => {
    await install(agentTok, EXT, false);
    const out = await invoke(agentTok, EXT, 'pkg', { name: `${EXT}-b` });
    assert(out?.publishRequest?.status === 'awaiting_owner', `no waiting request in the answer: ${short(out)}`);
    assert(await anon(out.descriptorUrl) !== 200, `the descriptor is readable anonymously: ${out.descriptorUrl}`);
    assert(await anon(pkgUrl(`${EXT}-b`)) !== 200, 'the package is readable anonymously');
    const q = await waitingFor('datapackage', `${EXT}-b`);
    assert(q && q.requested_by?.principal === agentGaii, `no request naming the agent: ${short(await requests())}`);
    attendedRequest = q.id;
});

await test('the agent cannot approve the request its own extension filed (403), and the package stays closed', async () => {
    const d = await json(`/v1/publish-requests/${attendedRequest}/decision`, { method: 'POST', headers: bearer(agentTok), body: JSON.stringify({ decision: 'approve' }) });
    assert(d.status === 403, `the agent's own approval: ${d.status} ${short(d.body)}`);
    assert(await anon(pkgUrl(`${EXT}-b`)) !== 200, 'the package opened on the agent\'s approval');
});

await test('the owner\'s approval opens the same address', async () => {
    await approve(attendedRequest);
    assert(await anon(pkgUrl(`${EXT}-b`)) === 200, 'the approved package is still closed');
});

await test('kept: the owner in person through the same extension publishes public at once', async () => {
    const out = await invoke(ownerTok, EXT, 'pkg', { name: `${EXT}-own` });
    assert(!out?.publishRequest, `the owner was asked: ${short(out)}`);
    assert(await anon(out.descriptorUrl) === 200, 'the owner\'s package is not public');
});

await test('kept: an agent holding publish:public publishes public at once', async () => {
    const out = await invoke(wordTok, EXT, 'pkg', { name: `${EXT}-word` });
    assert(!out?.publishRequest && await anon(out.descriptorUrl) === 200, `the worded agent was held: ${short(out)}`);
});

await test('kept: the agent republishing a package already public is not asked', async () => {
    const out = await invoke(agentTok, EXT, 'pkg', { name: `${EXT}-own` });
    assert(!out?.publishRequest, `a republish of a public package was asked about: ${short(out)}`);
    assert(await anon(pkgUrl(`${EXT}-own`)) === 200, 'the public package closed');
});

console.log('\nPhase 3 — ctx.files.write, attended (v69)');

await test('control: the agent\'s public POST /v1/storage is stored private and asked about', async () => {
    const key = `${EXT}-control.txt`;
    const r = await json('/v1/storage', { method: 'POST', headers: bearer(agentTok), body: JSON.stringify({ key, data: b64('control'), mime_type: 'text/plain', visibility: 'public' }) });
    assert(r.status === 202, `the gate is not on for files: ${r.status} ${short(r.body)}`);
    assert(await anon(`/v1/pub/${encodeURIComponent(agentGaii)}/${key}`) !== 200, 'the held control file is readable');
});

let fileRequest = '';
let fileUrl = '';
await test('the agent\'s public write through its extension is stored private and files a request', async () => {
    const out = await invoke(agentTok, EXT, 'file', { key: 'probe.txt', b64: b64('probe-v69') });
    assert(out?.visibility === 'private', `stored as ${out?.visibility}: ${short(out)}`);
    assert(out?.publishRequest?.status === 'awaiting_owner', `no waiting request: ${short(out)}`);
    fileUrl = out.url;
    assert(await anon(fileUrl) !== 200, `the file is readable anonymously: ${fileUrl}`);
    const q = await waitingFor('file', `ext/${EXT}/probe.txt`);
    assert(q && q.requested_by?.principal === agentGaii, `no file request naming the agent: ${short(await requests())}`);
    fileRequest = q.id;
});

await test('the owner\'s approval opens the url the write returned', async () => {
    await approve(fileRequest);
    assert(await anon(fileUrl) === 200, 'the approved file is still closed');
});

await test('kept: the owner in person, and an agent holding publish:public, write public at once', async () => {
    const own = await invoke(ownerTok, EXT, 'file', { key: 'owner.txt', b64: b64('owner') });
    assert(own.visibility === 'public' && !own.publishRequest && await anon(own.url) === 200, `owner: ${short(own)}`);
    const word = await invoke(wordTok, EXT, 'file', { key: 'word.txt', b64: b64('word') });
    assert(word.visibility === 'public' && !word.publishRequest && await anon(word.url) === 200, `worded agent: ${short(word)}`);
});

console.log('\nPhase 4 — the @activate schedule, unattended (v68, v69)');

const ACTEXT = `upgact${STAMP}`;
await test('the agent\'s extension on @activate: its file and package in the owner\'s namespace wait for the owner', async () => {
    await install(agentTok, ACTEXT, true);
    let q: any;
    for (let i = 0; i < 60 && !q; i++) { q = await waitingFor('datapackage', `${ACTEXT}-act`); if (!q) await sleep(250); }
    assert(q && q.requested_by?.principal === agentGaii, `no package request from the @activate run: ${short(await requests())}`);
    assert(await anon(pkgUrl(`${ACTEXT}-act`)) !== 200, 'the @activate package is public');
    assert(await anon(`/v1/pub/${encodeURIComponent(ownerGhii)}/ext/${ACTEXT}/probe-activate.txt`) !== 200, 'the @activate file is public at the owner\'s address');
    const f = await waitingFor('file', `ext/${ACTEXT}/probe-activate.txt`);
    assert(f && f.requested_by?.principal === agentGaii, `no file request from the @activate run: ${short(await requests())}`);
});

await test('kept: the owner\'s own producer on @activate publishes public at once', async () => {
    await install(ownerTok, OWNEXT, true);
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { ok = await anon(pkgUrl(`${OWNEXT}-act`)) === 200; if (!ok) await sleep(250); }
    assert(ok === true, 'the owner-installed producer\'s @activate package is not public');
    assert(await anon(`/v1/pub/${encodeURIComponent(ownerGhii)}/ext/${OWNEXT}/probe-activate.txt`) === 200, 'its file is not public');
});

console.log('\nPhase 5 — workflows (v68)');

await test('the agent\'s workflow datapackage step publishes at the kept level and files a request', async () => {
    await saveWorkflow(agentTok, 'upg-agent-dp', [dpStep(`${EXT}-wfa`)]);
    const run = await runWorkflow(agentTok, 'upg-agent-dp');
    assert(run.steps.publish.state === 'green', `publish step ${run.steps.publish.state}: ${short(run)}`);
    assert(await anon(pkgUrl(`${EXT}-wfa`)) !== 200, 'the workflow package is public');
    const q = await waitingFor('datapackage', `${EXT}-wfa`);
    assert(q && q.requested_by?.principal === agentGaii, `no request naming the agent: ${short(await requests())}`);
});

await test('kept: the owner in person running the same workflow publishes public at once', async () => {
    await saveWorkflow(ownerTok, 'upg-owner-dp', [dpStep(`${EXT}-wfo`)]);
    const run = await runWorkflow(ownerTok, 'upg-owner-dp');
    assert(run.steps.publish.state === 'green', `publish step ${run.steps.publish.state}`);
    assert(await anon(pkgUrl(`${EXT}-wfo`)) === 200, 'the owner\'s workflow package is not public');
});

await test('the agent\'s workflow extension step on the owner\'s producer waits for the owner', async () => {
    await saveWorkflow(agentTok, 'upg-agent-ext', [extStep(OWNEXT, `${EXT}-wfx`)]);
    const run = await runWorkflow(agentTok, 'upg-agent-ext');
    assert(run.steps.produce.state === 'green', `produce step ${run.steps.produce.state}: ${short(run)}`);
    assert(await anon(pkgUrl(`${EXT}-wfx`)) !== 200, 'the package is public');
    assert(await waitingFor('datapackage', `${EXT}-wfx`), `no request: ${short(await requests())}`);
});

await test('kept: the owner in person running the agent\'s workflow on the owner\'s producer publishes public', async () => {
    await saveWorkflow(ownerTok, 'upg-owner-ext', [extStep(OWNEXT, `${EXT}-wfy`)]);
    const run = await runWorkflow(ownerTok, 'upg-owner-ext');
    assert(run.steps.produce.state === 'green', `produce step ${run.steps.produce.state}`);
    assert(await anon(pkgUrl(`${EXT}-wfy`)) === 200, 'the owner\'s run did not publish public');
});

console.log('\nPhase 6 — what exists at the update keeps working');

const OLDEXT = `upgold${STAMP}`;
await test('before the step: an agent-installed producer run by the owner\'s workflow is asked about', async () => {
    await install(agentTok, OLDEXT, false);
    await saveWorkflow(ownerTok, 'upg-old-ext', [extStep(OLDEXT, `${EXT}-old1`)]);
    const run = await runWorkflow(ownerTok, 'upg-old-ext');
    assert(run.steps.produce.state === 'green', `produce step ${run.steps.produce.state}: ${short(run)}`);
    assert(await anon(pkgUrl(`${EXT}-old1`)) !== 200, 'the agent-installed code published public unattended');
    await saveWorkflow(agentTok, 'upg-old-dp', [dpStep(`${EXT}-old2`)]);
});

await test('the node restarts as if updated now: the agent-installed extension and the agent-saved workflow are kept', async () => {
    await stopServer(server);
    await withStorage(async s => { await s.deleteMemory(`system@${NODE_ID}`, KEEP_STEP_KEY); });
    server = await startServer();
    ownerTok = await ownerToken(BASE, ownerName);
    agentTok = await agentToken(agentGaii, agentPrivate);
    const kept = await withStorage(async s => (await s.getMemory(`system@${NODE_ID}`, KEEP_STEP_KEY))?.value as any);
    assert(kept?.kept && Object.hasOwn(kept.kept, OLDEXT), `the step did not keep ${OLDEXT}: ${short(kept)}`);
});

await test('kept: the agent-installed producer publishes public again, unattended, as before the update', async () => {
    const run = await runWorkflow(ownerTok, 'upg-old-ext');
    assert(run.steps.produce.state === 'green', `produce step ${run.steps.produce.state}`);
    // Not a raise any more would hide the keep, so a new package name.
    await saveWorkflow(ownerTok, 'upg-old-ext2', [extStep(OLDEXT, `${EXT}-old3`)]);
    const run2 = await runWorkflow(ownerTok, 'upg-old-ext2');
    assert(run2.steps.produce.state === 'green', `produce step ${run2.steps.produce.state}`);
    assert(await anon(pkgUrl(`${EXT}-old3`)) === 200, 'the kept extension was held');
});

await test('kept: the agent-saved workflow publishes public as before the update', async () => {
    const run = await runWorkflow(agentTok, 'upg-old-dp');
    assert(run.steps.publish.state === 'green', `publish step ${run.steps.publish.state}`);
    assert(await anon(pkgUrl(`${EXT}-old2`)) === 200, 'the kept workflow was held');
});

await test('a code change ends the keep: the redeployed extension is asked about again', async () => {
    const changed = { ...SCRIPTS(OLDEXT), pkg: SCRIPTS(OLDEXT).pkg.replace('probe ', 'changed ') };
    const re = await json(`/v1/extensions/${OLDEXT}`, { method: 'PUT', headers: bearer(agentTok), body: JSON.stringify({ manifest: manifest(OLDEXT, false, '1.0.1'), scripts: changed }) });
    assert(re.status === 200, `redeploy ${re.status}: ${short(re.body?.error)}`);
    await json(`/v1/extensions/${OLDEXT}/activate`, { method: 'POST', headers: bearer(agentTok) });
    await saveWorkflow(ownerTok, 'upg-old-ext3', [extStep(OLDEXT, `${EXT}-old4`)]);
    const run = await runWorkflow(ownerTok, 'upg-old-ext3');
    assert(run.steps.produce.state === 'green', `produce step ${run.steps.produce.state}`);
    assert(await anon(pkgUrl(`${EXT}-old4`)) !== 200, 'changed code still published public unattended');
});

await test('a save ends the keep: the agent\'s re-saved workflow is asked about again', async () => {
    await saveWorkflow(agentTok, 'upg-old-dp', [dpStep(`${EXT}-old5`)], 'saved again');
    const run = await runWorkflow(agentTok, 'upg-old-dp');
    assert(run.steps.publish.state === 'green', `publish step ${run.steps.publish.state}`);
    assert(await anon(pkgUrl(`${EXT}-old5`)) !== 200, 'the re-saved workflow published public');
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
await stopServer(server);
process.exit(failed > 0 ? 1 : 0);
