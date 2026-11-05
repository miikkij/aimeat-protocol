/**
 * @file test/e2e-single-process-lease.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One process per node, the default (setting node.processes = single,
 *   AIMEAT_NODE_PROCESSES; services/process-lease.ts). A node process is named `<hostname>:<port>`, so
 *   a container recreated with a new hostname is a process of a new name. With several processes
 *   allowed, such a process waits for the previous holder's lease to run out before it takes its work:
 *   it skips the start-up @activate run and takes the queued AI jobs over only after the lease and the
 *   adoption pass (about 45 s). With one process, no other live process can exist, so a starting
 *   process takes every lease at once. The suite checks, on a node with the default setting:
 *     1. a process started under a new name while the previous process's lease still stands runs the
 *        @activate schedules at its start;
 *     2. the same process takes the previous process's queued AI job at once and runs it to done,
 *        and fails the job that was running with node_restarted, as one process does after a crash
 *        (test/e2e-ai-jobs.ts case 15).
 *
 *   HOW A NEW NAME IS MADE. Process A runs on one port and process B on another, on one database.
 *   The port is half of the process name, so B is a process of a new name exactly as a container with
 *   a new hostname is. A is killed (no stop, so its lease is not released), and its lease is then set
 *   to stand for ten more minutes, so the result does not depend on how long B takes to boot on a
 *   loaded machine: only the one-process rule lets B take the work while that lease stands.
 *
 *   NOTHING INSIDE THE NODES IS MOCKED. A local OpenAI-compatible stub stands in for the provider; it
 *   can hold a request open, so a job stays running for as long as the case needs.
 *
 *   WHY. Decision 6a of 2026-11-05 (codebase analysis 2026-11-03): one process is the default, and in
 *   that mode a node behaves as before the leases of 2026-11-04, also in a container. Several
 *   processes are switched on with the setting; test/e2e-two-process-leases.ts and
 *   test/e2e-two-process-bus.ts run with it on.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-single-process-lease
 * @version-history
 *   v1.0.0 -- 2026-11-05 -- Initial (codebase analysis 2026-11-03, decision 6a of 2026-11-05).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createStorage } from '../src/storage/storage-factory.js';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';

const PORT_A = 28871;
const PORT_B = 28872;
const STUB_PORT = 28873;
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;
const STUB_BASE = `http://127.0.0.1:${STUB_PORT}`;
const NODE_ID = 'aimeat-single-process-001';
const STUB_MODEL = 'stub/single-process-model';
// Well inside services/process-lease.ts PROCESS_LEASE_MS plus services/ai-jobs/reclaim.ts ADOPT_MS
// (30 s + 15 s), and A's lease stands ten minutes: only taking the work at once fits in it.
const AT_ONCE_MS = 20_000;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.log(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(base: string, path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ── the stub provider ─────────────────────────────────────────────────────────

let holding = false;
const held: ServerResponse[] = [];
function answer(res: ServerResponse): void {
    try {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            model: STUB_MODEL, choices: [{ message: { content: 'single-process answer' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10, cost: 0.0001 },
        }));
    } catch { /* the asking process is gone */ }
}
function release(): void { holding = false; while (held.length) answer(held.shift()!); }
const stub: Server = createServer((req, res) => {
    req.on('data', () => { /* drained */ });
    req.on('end', () => {
        if ((req.url ?? '').includes('/chat/completions')) {
            if (holding) { held.push(res); return; }
            answer(res);
            return;
        }
        res.writeHead(404); res.end();
    });
});
await new Promise<void>(r => stub.listen(STUB_PORT, '127.0.0.1', () => r()));

// ── the two processes, one after the other ────────────────────────────────────

const db = await ownNodeDb('single-process');
const logs: Record<string, string> = { A: '', B: '' };

async function startProcess(label: 'A' | 'B'): Promise<ChildProcess> {
    const port = label === 'A' ? PORT_A : PORT_B;
    const base = label === 'A' ? BASE_A : BASE_B;
    const env: NodeJS.ProcessEnv = {
        ...process.env, ...db.env,
        AIMEAT_PORT: String(port), AIMEAT_BASE_URL: base, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_LOG_LEVEL: 'info',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_RL_OPENROUTER: '1000', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
        AIMEAT_AI_JOB_SLOTS: '1',
    };
    // The default is what this suite tests, so the setting is left unset whatever the caller's shell has.
    delete env.AIMEAT_NODE_PROCESSES;
    const child = spawn(process.execPath, [...nodeEntryArgs(), 'start', ...db.args, '--port', String(port)], {
        cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (c: Buffer) => { logs[label] += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { logs[label] += c.toString(); });
    return waitForServer(child, base, { label: `process ${label}` });
}

async function kill(child: ChildProcess): Promise<void> {
    child.kill('SIGKILL');
    for (let i = 0; i < 100 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
}

/** Make A's process lease stand for ten more minutes, as a lease that has not run out yet. */
async function keepLeaseStanding(port: number): Promise<string> {
    const storage = db.provider === 'postgres-kysely'
        ? await createStorage({ provider: 'postgres-kysely', dbUrl: db.dbUrl })
        : await createStorage({ provider: 'sqlite', sqlitePath: db.sqlitePath });
    try {
        const system = `system@${NODE_ID}`;
        const rows = await storage.listMemory(system, { prefix: 'lease.process.' });
        const row = rows.find(r => typeof (r.value as { name?: unknown })?.name === 'string' && (r.value as { name: string }).name.endsWith(`:${port}`));
        assert(row, `no process lease of the process on port ${port}: ${rows.map(r => r.key).join(', ')}`);
        const until = new Date(Date.now() + 10 * 60_000).toISOString();
        const ok = await storage.setMemoryIfVersion!({ ...row, value: { ...(row.value as object), until }, version: row.version + 1, updatedAt: new Date().toISOString() }, row.version);
        assert(ok, 'the process lease changed while the suite wrote it');
        return (row.value as { name: string }).name;
    } finally { await (storage as unknown as { close?: () => unknown }).close?.(); }
}

console.log('\n=== ONE PROCESS PER NODE (THE DEFAULT): A NEW PROCESS NAME TAKES THE WORK AT ONCE ===\n');

const procA = await startProcess('A');
let procB: ChildProcess | null = null;

const owner = await registerOwner(BASE_A, `oneproc${Date.now()}`);
{
    const r = await json(BASE_A, '/v1/memory', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ key: 'openrouter.settings', visibility: 'private', value: { provider: 'custom', baseUrl: `${STUB_BASE}/v1`, model: STUB_MODEL, daily_budget_usd: 50 } }),
    });
    // A first write of a key answers 201 (routes/memory); the suite only needs it stored.
    assert(r.status === 201, `provider settings ${r.status}: ${JSON.stringify(r.body?.error)}`);
}

const startJob = (base: string, key: string) => json(base, '/v1/ai/jobs', {
    method: 'POST', headers: auth(owner.token), body: JSON.stringify({ prompt: `one process: ${key}`, result_key: key }),
});
async function stateOf(base: string, id: string): Promise<any> {
    const r = await json(base, `/v1/ai/jobs/${id}`, { headers: auth(owner.token) });
    return r.status === 200 ? r.body.data : null;
}
async function waitFor(base: string, id: string, states: string[], ms: number): Promise<any> {
    const began = Date.now();
    for (;;) {
        const job = await stateOf(base, id);
        if (job && states.includes(job.state)) return job;
        if (Date.now() - began > ms) throw new Error(`job ${id} never reached ${states.join('|')} (last ${job?.state})`);
        await sleep(250);
    }
}
async function waitHeld(n: number): Promise<void> {
    const began = Date.now();
    while (held.length < n) {
        assert(Date.now() - began < 20_000, `the provider holds ${held.length} request(s), expected ${n}`);
        await sleep(50);
    }
}
async function runsOf(base: string, id: string): Promise<number> {
    const r = await json(base, `/v1/schedules/${id}`, { headers: auth(owner.token) });
    assert(r.status === 200, `schedule read ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.runs as unknown[]).length;
}

try {
    // An @activate schedule: it runs at every start of the node.
    const made = await json(BASE_A, '/v1/schedules', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ kind: 'ai', cron: '@activate', prompt: 'say hello at the start', output_key: 'oneproc.activate', display_name: 'At the start' }),
    });
    assert(made.status === 201, `schedule ${made.status}: ${JSON.stringify(made.body?.error)}`);
    const scheduleId = made.body.data.schedule.id as string;
    const runsBefore = await runsOf(BASE_A, scheduleId);

    // A runs one job and holds the other in its queue (one slot), then is killed.
    holding = true;
    const running = await startJob(BASE_A, 'oneproc.running');
    assert(running.status === 202, `start running ${running.status}: ${JSON.stringify(running.body?.error)}`);
    await waitHeld(1);
    const queued = await startJob(BASE_A, 'oneproc.queued');
    assert(queued.status === 202, `start queued ${queued.status}: ${JSON.stringify(queued.body?.error)}`);
    const idRunning = running.body.data.job_id as string, idQueued = queued.body.data.job_id as string;

    await kill(procA);
    const nameA = await keepLeaseStanding(PORT_A);
    release();

    procB = await startProcess('B');
    const readyAt = Date.now();

    await test('1. A process of a new name runs the @activate schedules at its start while the previous lease stands', async () => {
        const began = Date.now();
        let runs = runsBefore;
        while (runs <= runsBefore && Date.now() - began < AT_ONCE_MS) { await sleep(500); runs = await runsOf(BASE_B, scheduleId); }
        assert(runs > runsBefore, `the @activate schedule did not run on B (runs ${runsBefore} before, ${runs} after ${Math.round((Date.now() - readyAt) / 1000)} s)`);
        assert(!logs.B.includes('another node process ran the'), 'B says another node process ran the @activate jobs');
    });

    await test('2. The same process takes the previous process\'s queued AI job at once, and fails the one that was running', async () => {
        const endQueued = await waitFor(BASE_B, idQueued, ['done', 'failed', 'cancelled'], AT_ONCE_MS);
        const tookMs = Date.now() - readyAt;
        assert(endQueued.state === 'done', `the queued job ended ${endQueued.state} ${JSON.stringify(endQueued.error)}`);
        const endRunning = await waitFor(BASE_B, idRunning, ['done', 'failed', 'cancelled'], 10_000);
        assert(endRunning.state === 'failed' && endRunning.error?.code === 'node_restarted',
            `the job that was running ended ${endRunning.state} ${endRunning.error?.code}`);
        console.log(`     (B ran the queued job ${Math.round(tookMs / 1000)} s after it was ready; the lease of ${nameA} stands for ten minutes)`);
    });
} finally {
    await kill(procA).catch(() => undefined);
    if (procB) await kill(procB).catch(() => undefined);
    stub.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.log('\n--- process A, last lines ---\n' + logs.A.split('\n').slice(-40).join('\n'));
    console.log('\n--- process B, last lines ---\n' + logs.B.split('\n').slice(-40).join('\n'));
}
process.exit(failed > 0 ? 1 : 0);
