/**
 * @file test/e2e-two-process-leases.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two processes of one node on one database: the run-once work (services/process-lease.ts,
 *   services/ai-jobs/reclaim.ts). Process A and process B have the same node id, the same database and
 *   different ports, as two processes behind a load balancer would. The suite checks:
 *     1. a queued AI job runs once: B restarting while A runs a job and holds one in its queue fails
 *        neither and runs neither, and B's adoption pass leaves them to A; A finishes both, and the
 *        provider is asked twice in all;
 *     2. a sweep runs once per round: the cross-node message retry (every 2 s on both) tries a message
 *        once per round, not once per process;
 *     3. killing the process that holds the jobs lets the other take them over after its lease runs
 *        out: A is killed with a job running and one queued; B fails the running one with
 *        node_restarted, as one process does after a crash (test/e2e-ai-jobs.ts case 15), and runs the
 *        queued one to done.
 *
 *   NOTHING INSIDE THE NODES IS MOCKED. A local OpenAI-compatible stub stands in for the provider; it
 *   can hold a request open, so a job stays running for as long as a case needs.
 *
 *   WHY. Until 2026-11-04 a starting process failed every running AI job on the node and ran every
 *   queued one again, the other process's live ones included, and every timed sweep ran in every
 *   process (codebase analysis 2026-11-03, high-availability report sections 2e and 6).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-two-process-leases
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item HA 2.5-2.7).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';

const BASE_PORT = Number(process.env.E2E_TWO_PROCESS_PORT ?? '28861');
const PORT_A = BASE_PORT;
const PORT_B = BASE_PORT + 1;
const STUB_PORT = BASE_PORT + 2;
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;
const STUB_BASE = `http://127.0.0.1:${STUB_PORT}`;
const NODE_ID = 'aimeat-two-process-001';
const STUB_MODEL = 'stub/two-process-model';
const RETRY_MS = 2000;
// services/process-lease.ts PROCESS_LEASE_MS and services/ai-jobs/reclaim.ts ADOPT_MS, with room.
const TAKEOVER_BUDGET_MS = 30_000 + 15_000 + 45_000;

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
let completions = 0;
function answer(res: ServerResponse): void {
    try {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            model: STUB_MODEL, choices: [{ message: { content: 'two-process answer' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10, cost: 0.0001 },
        }));
    } catch { /* the asking process is gone */ }
}
function release(): void { holding = false; while (held.length) answer(held.shift()!); }
const stub: Server = createServer((req, res) => {
    req.on('data', () => { /* drained */ });
    req.on('end', () => {
        if ((req.url ?? '').includes('/chat/completions')) {
            completions++;
            if (holding) { held.push(res); return; }
            answer(res);
            return;
        }
        res.writeHead(404); res.end();
    });
});
await new Promise<void>(r => stub.listen(STUB_PORT, '127.0.0.1', () => r()));

// ── the two processes ─────────────────────────────────────────────────────────

const db = await ownNodeDb('two-process');
const logs: Record<string, string> = { A: '', B: '' };

async function startProcess(label: 'A' | 'B'): Promise<ChildProcess> {
    const port = label === 'A' ? PORT_A : PORT_B;
    const base = label === 'A' ? BASE_A : BASE_B;
    const child = spawn(process.execPath, [...nodeEntryArgs(), 'start', ...db.args, '--port', String(port)], {
        cwd: process.cwd(),
        env: {
            ...process.env, ...db.env,
            AIMEAT_PORT: String(port), AIMEAT_BASE_URL: base, AIMEAT_NODE_ID: NODE_ID,
            AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_LOG_LEVEL: 'info',
            AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
            AIMEAT_RL_OPENROUTER: '1000', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
            AIMEAT_AI_JOB_SLOTS: '1',
            AIMEAT_MESSAGE_RETRY_INTERVAL_MS: String(RETRY_MS),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (c: Buffer) => { logs[label] += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { logs[label] += c.toString(); });
    return waitForServer(child, base, { label: `process ${label}` });
}

async function kill(child: ChildProcess): Promise<void> {
    child.kill('SIGKILL');
    for (let i = 0; i < 100 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
}

console.log('\n=== TWO PROCESSES, ONE DATABASE: RUN-ONCE WORK ===\n');

const procA = await startProcess('A');
// B starts once A has migrated the database, as a second process joins a running node.
let procB = await startProcess('B');

const owner = await registerOwner(BASE_A, `twoproc${Date.now()}`);
{
    const r = await json(BASE_A, '/v1/memory', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ key: 'openrouter.settings', visibility: 'private', value: { provider: 'custom', baseUrl: `${STUB_BASE}/v1`, model: STUB_MODEL, daily_budget_usd: 50 } }),
    });
    // A first write of a key answers 201 (routes/memory); the suite only needs it stored.
    assert(r.status === 201, `provider settings ${r.status}: ${JSON.stringify(r.body?.error)}`);
}

const startJob = (base: string, key: string) => json(base, '/v1/ai/jobs', {
    method: 'POST', headers: auth(owner.token), body: JSON.stringify({ prompt: `two processes: ${key}`, result_key: key }),
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

try {
    await test('1. A queued AI job runs once: B restarting beside A takes neither of A\'s jobs', async () => {
        holding = true;
        const before = completions;
        const one = await startJob(BASE_A, 'twoproc.one');
        assert(one.status === 202, `start one ${one.status}: ${JSON.stringify(one.body?.error)}`);
        await waitHeld(1);
        const two = await startJob(BASE_A, 'twoproc.two');
        assert(two.status === 202, `start two ${two.status}: ${JSON.stringify(two.body?.error)}`);
        const idOne = one.body.data.job_id as string, idTwo = two.body.data.job_id as string;

        // B restarts while A runs one job and holds the other in its queue; then B's adoption pass
        // runs at least once.
        await kill(procB);
        procB = await startProcess('B');
        await sleep(20_000);
        assert(completions - before === 1, `the provider was asked ${completions - before} times while A held the jobs, expected 1`);
        const seenOne = await stateOf(BASE_B, idOne), seenTwo = await stateOf(BASE_B, idTwo);
        assert(seenOne?.state === 'running', `the running job reads ${seenOne?.state} ${JSON.stringify(seenOne?.error)}`);
        assert(seenTwo?.state === 'queued', `the queued job reads ${seenTwo?.state} ${JSON.stringify(seenTwo?.error)}`);

        release();
        const endOne = await waitFor(BASE_A, idOne, ['done', 'failed', 'cancelled'], 20_000);
        const endTwo = await waitFor(BASE_A, idTwo, ['done', 'failed', 'cancelled'], 20_000);
        assert(endOne.state === 'done' && endTwo.state === 'done', `ended ${endOne.state} and ${endTwo.state}`);
        assert(completions - before === 2, `the provider was asked ${completions - before} times for two jobs`);
    });

    await test('2. A sweep runs once per round: the message retry tries a message once per round, not once per process', async () => {
        const sent = await json(BASE_A, '/v1/messages', {
            method: 'POST', headers: auth(owner.token),
            body: JSON.stringify({ to: 'bob@aimeat-nowhere-001-test', body: 'for a node this one does not know' }),
        });
        assert(sent.status === 201, `send ${sent.status}: ${JSON.stringify(sent.body?.error)}`);
        const id = sent.body.data.message.id as string;
        const from = Date.now() + 500;
        const windowMs = 8 * RETRY_MS;
        await sleep(windowMs);
        const to = Date.now();
        const stats = await json(BASE_B, '/v1/admin/messages/stats', { headers: auth(owner.token) });
        assert(stats.status === 200, `stats ${stats.status}: ${JSON.stringify(stats.body?.error)}`);
        const tries = (stats.body.data.recent as Array<{ messageId: string; createdAt: string }>)
            .filter(l => l.messageId === id && Date.parse(l.createdAt) >= from && Date.parse(l.createdAt) <= to).length;
        const rounds = windowMs / RETRY_MS;
        // One process per round: about `rounds` tries. Both processes every round would be twice that.
        assert(tries >= 3 && tries <= rounds + 2, `${tries} tries in ${rounds} rounds`);
        const skipped = (logs.A + logs.B).split('Sweep message-retry: another node process runs this round').length - 1;
        assert(skipped >= 3, `the process that does not run the rounds said so ${skipped} times`);
    });

    await test('3. Killing the process that holds the jobs lets the other take them over after its lease runs out', async () => {
        holding = true;
        const running = await startJob(BASE_A, 'twoproc.three');
        assert(running.status === 202, `start three ${running.status}`);
        await waitHeld(1);
        const queued = await startJob(BASE_A, 'twoproc.four');
        assert(queued.status === 202, `start four ${queued.status}`);
        const idRunning = running.body.data.job_id as string, idQueued = queued.body.data.job_id as string;

        await kill(procA);
        release();
        const began = Date.now();
        const endQueued = await waitFor(BASE_B, idQueued, ['done', 'failed', 'cancelled'], TAKEOVER_BUDGET_MS);
        const tookMs = Date.now() - began;
        assert(endQueued.state === 'done', `the queued job ended ${endQueued.state} ${JSON.stringify(endQueued.error)}`);
        const endRunning = await waitFor(BASE_B, idRunning, ['done', 'failed', 'cancelled'], 10_000);
        assert(endRunning.state === 'failed' && endRunning.error?.code === 'node_restarted',
            `the job that was running ended ${endRunning.state} ${endRunning.error?.code}`);
        console.log(`     (B took the jobs over ${Math.round(tookMs / 1000)} s after A was killed)`);
    });
} finally {
    await kill(procA).catch(() => undefined);
    await kill(procB).catch(() => undefined);
    stub.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.log('\n--- process A, last lines ---\n' + logs.A.split('\n').slice(-40).join('\n'));
    console.log('\n--- process B, last lines ---\n' + logs.B.split('\n').slice(-40).join('\n'));
}
process.exit(failed > 0 ? 1 : 0);
