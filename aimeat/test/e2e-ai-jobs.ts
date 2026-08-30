/**
 * @file e2e-ai-jobs.ts
 * @description Background AI jobs: a model call with a handle. Fifteen cases, and the three that
 *   this feature lives or dies on are 1/9 (a finished job is FOLDED into its day log and its live
 *   key deleted, because a key per run fills the node's key ceiling in weeks), 5/6 (a chain that
 *   could not continue ends FAILED, never done — green and wrong is the worst available outcome),
 *   and 7/8 (a callback may name only the job owner's OWN extension, checked at enqueue AND again
 *   at fire time, because installedBy is decided at install and a delete-and-reinstall outlives the
 *   first check).
 *
 *   WHY THIS SUITE OWNS ITS SERVER. Every refusal here is a boot-time number — the slot count, the
 *   node wait line, the per-owner brake, the chain depth, the prompt cap — and against the shared
 *   runner's node they all sit at production defaults, where none of them can be reached without
 *   starting hundreds of jobs. It follows the RUNNER'S backend rather than hardcoding sqlite, so
 *   "E2E on both backends" is a claim this suite is entitled to make.
 *
 *   NOTHING INSIDE THE NODE IS MOCKED. A local OpenAI-compatible stub stands in for the provider and
 *   nothing else: the node decrypts the settings, picks a model, opens a real socket and records
 *   what it observed. The stub can HOLD a request open, which is how a job is kept in `running`
 *   deterministically — otherwise every timing assertion here would be a race.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-ai-jobs.ts
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_AI_JOBS_PORT ?? '40297';
const BASE = `http://localhost:${PORT}`;
const STUB_PORT = parseInt(process.env.E2E_AI_JOBS_STUB_PORT ?? '40298', 10);
const STUB_BASE = `http://127.0.0.1:${STUB_PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';

// The numbers this suite pins, small enough that every refusal is reachable in a handful of calls.
const SLOTS = 1;
const MAX_QUEUED = 3;
const MAX_QUEUED_PER_OWNER = 2;
const MAX_CHAIN = 0;          // any on_done that starts another job is one step too deep
const MAX_PROMPT_BYTES = 4096;

const STUB_CONTENT = 'The harbour extension was approved 7-2. Construction begins in March.';
const STUB_MODEL = 'stub/ai-jobs-test-model';

const RUNNER_STORAGE = process.env.AIMEAT_STORAGE ?? '';
const USE_POSTGRES = RUNNER_STORAGE === 'postgres-kysely' && !!process.env.DATABASE_URL;
const DB_PATH = resolve(process.cwd(), 'test/.test-ai-jobs.db');
const dbArgs = USE_POSTGRES
    ? ['--db', 'postgres-kysely', '--db-url', process.env.DATABASE_URL as string]
    : ['--db', 'sqlite', '--db-path', DB_PATH];

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

// ── the stub provider ─────────────────────────────────────────────────────────
// It answers the OpenAI-compatible completions shape, and it can hold a request open so a job stays
// `running` for as long as the test needs. Holding is the only way to make "cancel a RUNNING job" or
// "the queue is full" deterministic rather than a race against however fast the machine is.

let stub: Server | null = null;
let holding = false;
const held: ServerResponse[] = [];
let completionsSeen = 0;

function answer(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        model: STUB_MODEL,
        choices: [{ message: { content: STUB_CONTENT }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 19, total_tokens: 30, cost: 0.0002 },
    }));
}

async function startStub(): Promise<void> {
    stub = createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            if ((req.url ?? '').includes('/chat/completions')) {
                completionsSeen++;
                if (holding) { held.push(res); return; }
                answer(res);
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        });
    });
    await new Promise<void>(r => stub!.listen(STUB_PORT, '127.0.0.1', () => r()));
}

function releaseHeld(): void {
    holding = false;
    while (held.length) { const res = held.shift(); try { answer(res!); } catch { /* socket already gone */ } }
}

// ── the node under test ───────────────────────────────────────────────────────

function cleanDbFile(): void {
    if (USE_POSTGRES) return;
    for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    const env: Record<string, string | undefined> = {
        ...process.env,
        AIMEAT_PORT: PORT,
        AIMEAT_BASE_URL: BASE,
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_STORAGE: USE_POSTGRES ? 'postgres-kysely' : 'sqlite',
        AIMEAT_SQLITE_PATH: USE_POSTGRES ? '' : DB_PATH,
        AIMEAT_DEV_MODE: 'true',
        AIMEAT_TEST_MODE: 'true',
        AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_RL_OPENROUTER: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
        AIMEAT_EXT_INSTALL_ROLE: 'owner',
        // The whole point of owning the server: these are boot-time numbers.
        AIMEAT_AI_JOB_SLOTS: String(SLOTS),
        AIMEAT_AI_JOB_MAX_QUEUED: String(MAX_QUEUED),
        AIMEAT_AI_JOB_MAX_QUEUED_PER_OWNER: String(MAX_QUEUED_PER_OWNER),
        AIMEAT_AI_JOB_MAX_CHAIN: String(MAX_CHAIN),
        AIMEAT_AI_JOB_MAX_PROMPT_BYTES: String(MAX_PROMPT_BYTES),
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', ...dbArgs],
        { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
    const began = Date.now();
    while (Date.now() - began < 60_000) {
        try { if ((await fetch(`${BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await sleep(300);
    }
    child.kill('SIGTERM');
    throw new Error('Server failed to start');
}

async function stopServer(child: ChildProcess, hard = false): Promise<void> {
    child.kill(hard ? 'SIGKILL' : 'SIGTERM');
    const began = Date.now();
    while (Date.now() - began < 20_000) {
        if (child.exitCode !== null || child.signalCode !== null) break;
        await sleep(100);
    }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    while (Date.now() - began < 30_000) {
        try { await fetch(`${BASE}/v1/spec`); } catch { return; }
        await sleep(150);
    }
}

// ── owners ────────────────────────────────────────────────────────────────────

interface Owner { name: string; gaii: string; token: string }

async function setupOwner(label: string): Promise<Owner> {
    const name = `aijob${label}${Date.now()}`.toLowerCase();
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: name, display_name: 'AI Jobs', password: 'AiJobsTest1234' }),
    });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}: ${JSON.stringify(tok.body)}`);
    return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

/** Point an owner at the local stub, with a budget big enough that nothing here hits it. */
async function pointAtStub(owner: Owner): Promise<void> {
    const r = await json('/v1/memory', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({
            key: 'openrouter.settings', visibility: 'private',
            value: { provider: 'custom', baseUrl: `${STUB_BASE}/v1`, model: STUB_MODEL, daily_budget_usd: 50 },
        }),
    });
    assert(r.status === 200 || r.status === 201, `settings ${r.status}: ${JSON.stringify(r.body?.error)}`);
}

const startJob = (owner: Owner, body: Record<string, unknown>) =>
    json('/v1/ai/jobs', { method: 'POST', headers: auth(owner.token), body: JSON.stringify(body) });
const getJob = (owner: Owner, id: string) => json(`/v1/ai/jobs/${id}`, { headers: auth(owner.token) });
const cancelJob = (owner: Owner, id: string) =>
    json(`/v1/ai/jobs/${id}/cancel`, { method: 'POST', headers: auth(owner.token) });
const listJobs = (owner: Owner, q = '') => json(`/v1/ai/jobs${q}`, { headers: auth(owner.token) });

async function waitForState(owner: Owner, id: string, states: string[], ms = 20_000): Promise<any> {
    const began = Date.now();
    for (;;) {
        const r = await getJob(owner, id);
        if (r.status === 200 && states.includes(r.body.data.state)) return r.body.data;
        if (Date.now() - began > ms) throw new Error(`job ${id} never reached ${states.join('|')} (last: ${r.status} ${JSON.stringify(r.body?.data?.state ?? r.body?.error)})`);
        await sleep(120);
    }
}

async function readMemory(owner: Owner, key: string) {
    return json(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth(owner.token) });
}

// ── extensions used by the callback cases ─────────────────────────────────────

function manifestFor(name: string, actionId: string): string {
    return `
extension: "1.0"
metadata:
  name: "${name}"
  version: "1.0.0"
  description: "AI job callback under test"
  author: "e2e"
required_apis:
  - memory
actions:
  - id: ${actionId}
    description: "on_done target"
    method: POST
    path: "/v1/ext/${name}/${actionId}"
    script: "actions/${actionId}.js"
limits:
  memory_mb: 16
  timeout_ms: 5000
  max_api_calls: 10
federation:
  advertise: false
`;
}

async function installExtension(owner: Owner, name: string, actionId: string, script: string) {
    const r = await json('/v1/extensions', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ manifest: manifestFor(name, actionId), scripts: { [`actions/${actionId}.js`]: script } }),
    });
    assert(r.status === 201, `install ${name}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const act = await json(`/v1/extensions/${name}/activate`, { method: 'POST', headers: auth(owner.token) });
    assert(act.status === 200, `activate ${name}: ${act.status} ${JSON.stringify(act.body?.error)}`);
}

// The three callback shapes the design names, each as small as it can be.
const SCRIPT_MARK = `export default async function(ctx, input) {
    await ctx.memory.set('callback.ran', { job_id: input.job_id, state: input.state, result_key: input.result_key });
    return { ok: true };
}`;
const SCRIPT_CHAIN = `export default async function(ctx, input) {
    const started = await ctx.ai.start({ prompt: 'the next link', result_key: 'aijob.chain.next' });
    await ctx.memory.set('chain.attempt', started);
    return { started: started };
}`;
const SCRIPT_THROW = `export default async function(ctx, input) {
    throw new Error('the callback refused to work');
}`;

// ── the run ───────────────────────────────────────────────────────────────────

(async () => {
    console.log('\n── AI Jobs (background model calls with a handle) ──');
    cleanDbFile();
    await startStub();
    let server = await startServer();

    const a = await setupOwner('a');
    const b = await setupOwner('b');
    await pointAtStub(a);
    await pointAtStub(b);

    // ── 1. Happy path ──
    let happyId = '';
    await test('1a. A start answers 202 with a job id, a queued state and a queue position', async () => {
        const r = await startJob(a, { prompt: 'Summarise the council meeting.', result_key: 'aijob.happy', result_visibility: 'owner', app_id: 'e2e-ai-jobs' });
        assert(r.status === 202, `expected 202, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(typeof r.body.data.job_id === 'string' && r.body.data.job_id.length > 0, 'job_id');
        assert(r.body.data.state === 'queued', `state ${r.body.data.state}`);
        assert(typeof r.body.data.queue_position === 'number', 'queue_position is a number');
        happyId = r.body.data.job_id;
    });

    await test('1b. It reaches done, and the answer is at result_key with the visibility asked for', async () => {
        const done = await waitForState(a, happyId, ['done', 'failed']);
        assert(done.state === 'done', `state ${done.state}: ${JSON.stringify(done.error)}`);
        assert(typeof done.cost_usd === 'number' && done.cost_usd > 0, `cost recorded: ${done.cost_usd}`);
        assert(done.tokens === 30, `tokens ${done.tokens}`);
        const rec = await readMemory(a, 'aijob.happy');
        assert(rec.status === 200, `result_key read ${rec.status}`);
        assert(rec.body.data.value === STUB_CONTENT, `result content: ${JSON.stringify(rec.body.data.value).slice(0, 80)}`);
        assert(rec.body.data.visibility === 'owner', `visibility ${rec.body.data.visibility}`);
    });

    await test('1c. THE FOLD: the live ai.jobs.<id> key is gone and the job is in ai.jobs.log.<day>', async () => {
        // A key per run fills the 1000-key ceiling in weeks. This is the assertion that says the
        // feature does not do that.
        const live = await readMemory(a, `ai.jobs.${happyId}`);
        assert(live.status === 404, `the live key should be deleted, got ${live.status}`);
        const day = new Date().toISOString().slice(0, 10);
        const log = await readMemory(a, `ai.jobs.log.${day}`);
        assert(log.status === 200, `day log ${log.status}`);
        assert(Array.isArray(log.body.data.value), 'the day log is an array');
        assert(log.body.data.value.some((e: any) => e.id === happyId), 'the finished job is in the day log');
        // And it is still readable by id through the door, which is what a handle means.
        const viaApi = await getJob(a, happyId);
        assert(viaApi.status === 200 && viaApi.body.data.state === 'done', 'a folded job is still readable by id');
    });

    // ── 2. The response does not wait for the work ──
    await test('2. 202 comes back while the provider is still holding the request', async () => {
        holding = true;
        const before = completionsSeen;
        const began = Date.now();
        const r = await startJob(a, { prompt: 'A slow one.', result_key: 'aijob.slow' });
        const elapsed = Date.now() - began;
        assert(r.status === 202, `expected 202, got ${r.status}`);
        assert(elapsed < 2000, `the start took ${elapsed}ms; it must not wait for the model`);
        // Give the runner a moment to actually be in the provider call, then prove it is stuck there.
        await sleep(600);
        assert(completionsSeen > before, 'the job did reach the provider');
        assert(held.length >= 1, 'and the provider is holding it, so the job is running');
        const live = await getJob(a, r.body.data.job_id);
        assert(live.body.data.state === 'running', `state while held: ${live.body.data.state}`);
    });

    // From here the single slot is occupied by that held job, so everything else queues.

    // ── 4. The owner's queued cap ──
    await test('4. A third queued job for one owner is refused 429 AI_JOB_LIMIT_REACHED', async () => {
        const q1 = await startJob(a, { prompt: 'q1', result_key: 'aijob.q1' });
        const q2 = await startJob(a, { prompt: 'q2', result_key: 'aijob.q2' });
        assert(q1.status === 202 && q2.status === 202, `queued two: ${q1.status}/${q2.status}`);
        const q3 = await startJob(a, { prompt: 'q3', result_key: 'aijob.q3' });
        assert(q3.status === 429, `expected 429, got ${q3.status}: ${JSON.stringify(q3.body?.error)}`);
        assert(q3.body.error.code === 'AI_JOB_LIMIT_REACHED', `code ${q3.body.error.code}`);
    });

    // ── 3. The node's wait line ──
    await test('3. Past the node wait line a start is 503 AI_JOB_QUEUE_FULL with Retry-After, and nothing is enqueued', async () => {
        const before = await listJobs(b, '?state=all');
        const beforeCount = before.body.data.count;
        const third = await startJob(b, { prompt: 'b1', result_key: 'aijob.b1' });
        assert(third.status === 202, `b's first queued: ${third.status}`);
        const full = await startJob(b, { prompt: 'b2', result_key: 'aijob.b2' });
        assert(full.status === 503, `expected 503, got ${full.status}: ${JSON.stringify(full.body?.error)}`);
        assert(full.body.error.code === 'AI_JOB_QUEUE_FULL', `code ${full.body.error.code}`);
        assert(!!full.headers.get('retry-after'), 'Retry-After is set');
        const after = await listJobs(b, '?state=all');
        assert(after.body.data.count === beforeCount + 1, `the refused start must not be enqueued: ${beforeCount} → ${after.body.data.count}`);
    });

    // ── 9. Cancel a queued job ──
    await test('9. Cancelling a queued job leaves it cancelled with nothing spent', async () => {
        const queued = (await listJobs(a, '?state=queued')).body.data.jobs;
        assert(queued.length > 0, 'there is a queued job to cancel');
        const target = queued[0];
        const r = await cancelJob(a, target.id);
        assert(r.status === 200, `cancel ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.state === 'cancelled', `state ${r.body.data.state}`);
        assert(r.body.data.cost_usd === undefined, `nothing spent, got ${r.body.data.cost_usd}`);
        const wrote = await readMemory(a, target.result_key);
        assert(wrote.status === 404, 'a cancelled queued job writes no result');
    });

    // ── 10. Cancel a running job ──
    await test('10. Cancelling a RUNNING job tears down the provider call and the job ends cancelled', async () => {
        const running = (await listJobs(a, '?state=running')).body.data.jobs;
        assert(running.length === 1, `one job should be running, found ${running.length}`);
        const usageBefore = (await json('/v1/ai/usage', { headers: auth(a.token) })).body.data.total_calls;
        const r = await cancelJob(a, running[0].id);
        assert(r.status === 200, `cancel ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.state === 'cancelled', `state ${r.body.data.state}`);
        // The socket was cut before the provider answered, so there was no charge to record and
        // none is invented. The other half of the rule — a settlement is never DISCARDED once the
        // provider has answered — is what case 1b measures, where the cost lands on the record.
        const usageAfter = (await json('/v1/ai/usage', { headers: auth(a.token) })).body.data.total_calls;
        assert(usageAfter === usageBefore, `an unanswered call must bill nothing: ${usageBefore} → ${usageAfter}`);
    });

    // ── 11. Cancel a terminal job ──
    await test('11. Cancelling a job that already finished is 409', async () => {
        const r = await cancelJob(a, happyId);
        assert(r.status === 409, `expected 409, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.error.code === 'AI_JOB_ALREADY_TERMINAL', `code ${r.body.error.code}`);
    });

    // ── 12. Another owner's job ──
    await test('12. Another owner\'s job is not found — 404 on read and on cancel, never 403', async () => {
        const read = await getJob(b, happyId);
        assert(read.status === 404, `read ${read.status}`);
        const stop = await cancelJob(b, happyId);
        assert(stop.status === 404, `cancel ${stop.status}`);
    });

    // Let the rest of the queue drain before the callback cases, so the single slot is free.
    releaseHeld();
    await test('drain: the queue empties once the provider answers', async () => {
        const began = Date.now();
        for (;;) {
            const live = (await listJobs(a, '?state=live')).body.data.count
                + (await listJobs(b, '?state=live')).body.data.count;
            if (live === 0) return;
            if (Date.now() - began > 30_000) throw new Error(`${live} jobs still live`);
            releaseHeld();
            await sleep(200);
        }
    });

    // ── 13. A result_key the server reads and trusts ──
    await test('13. A result_key under a reserved server prefix is refused 400', async () => {
        const r = await startJob(a, { prompt: 'x', result_key: 'ai-usage.today' });
        assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const r2 = await startJob(a, { prompt: 'x', result_key: `${b.gaii}::stolen` });
        assert(r2.status === 400, `a key naming another namespace: expected 400, got ${r2.status}`);
    });

    // ── 14. The prompt cap ──
    await test('14. A prompt over the byte cap is refused 413 AI_JOB_PROMPT_TOO_LARGE', async () => {
        const big = 'x'.repeat(MAX_PROMPT_BYTES + 1000);
        const r = await startJob(a, { prompt: big, result_key: 'aijob.big' });
        assert(r.status === 413, `expected 413, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.error.code === 'AI_JOB_PROMPT_TOO_LARGE', `code ${r.body.error.code}`);
    });

    await test('14b. The cap counts what input_keys ADD, not only what was typed', async () => {
        const seed = await json('/v1/memory', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ key: 'aijob.fat', value: 'y'.repeat(MAX_PROMPT_BYTES), visibility: 'private' }),
        });
        assert(seed.status === 201 || seed.status === 200, `seed ${seed.status}`);
        const r = await startJob(a, { prompt: 'short', input_keys: ['aijob.fat'], result_key: 'aijob.fat.out' });
        assert(r.status === 413, `expected 413, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    });

    // ── 7. A callback naming another owner's extension ──
    await installExtension(a, 'aijobmark', 'mark', SCRIPT_MARK);
    await test('7. on_done naming an extension this account does not own is refused 403 at enqueue', async () => {
        const r = await startJob(b, {
            prompt: 'x', result_key: 'aijob.b.callback',
            on_done: { extension: 'aijobmark', action: 'mark' },
        });
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.error.code === 'AI_JOB_CALLBACK_FORBIDDEN', `code ${r.body.error.code}`);
        // Same wording as an extension that does not exist at all: which extensions exist is not a
        // stranger's business, and a different message would answer that question.
        const missing = await startJob(b, {
            prompt: 'x', result_key: 'aijob.b.callback2',
            on_done: { extension: 'aijobnosuchthing', action: 'mark' },
        });
        assert(missing.status === 403 && missing.body.error.code === 'AI_JOB_CALLBACK_FORBIDDEN',
            `a missing extension must read the same: ${missing.status} ${missing.body?.error?.code}`);
    });

    await test('7b. The owner\'s OWN callback does run, and is handed the job id and the result key', async () => {
        const r = await startJob(a, {
            prompt: 'call me back', result_key: 'aijob.callback.result',
            on_done: { extension: 'aijobmark', action: 'mark' },
        });
        assert(r.status === 202, `start ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const done = await waitForState(a, r.body.data.job_id, ['done', 'failed']);
        assert(done.state === 'done', `state ${done.state}: ${JSON.stringify(done.error)}`);
        const mark = await json('/v1/memory/ext:aijobmark/callback.ran');
        assert(mark.status === 200, `the callback's own record ${mark.status}`);
        assert(mark.body.data.value.job_id === r.body.data.job_id, 'the callback was told which job');
        assert(mark.body.data.value.result_key === 'aijob.callback.result', 'and where the answer went');
    });

    // ── 6. A callback that throws fails the job ──
    await installExtension(a, 'aijobboom', 'boom', SCRIPT_THROW);
    await test('6. A job whose callback throws ends FAILED, never done', async () => {
        const r = await startJob(a, {
            prompt: 'this one breaks afterwards', result_key: 'aijob.boom.result',
            on_done: { extension: 'aijobboom', action: 'boom' },
        });
        assert(r.status === 202, `start ${r.status}`);
        const end = await waitForState(a, r.body.data.job_id, ['done', 'failed']);
        // Green and wrong is the worst available outcome. The answer IS written — the model was
        // paid and its bytes are real — and the job still says it did not finish, because the thing
        // that was supposed to happen next did not.
        assert(end.state === 'failed', `expected failed, got ${end.state}`);
        assert(end.error?.code === 'AI_JOB_CALLBACK_FAILED', `code ${end.error?.code}`);
        assert(end.chain_stopped === undefined, 'a thrown action is not a chain refusal, so chain_stopped stays unset');
        const wrote = await readMemory(a, 'aijob.boom.result');
        assert(wrote.status === 200, 'the answer was still written before the callback ran');
    });

    // ── 5. A chain that goes one step too deep ──
    await installExtension(a, 'aijobchain', 'next', SCRIPT_CHAIN);
    await test('5. A chain refused for depth fails the parent and records chain_stopped', async () => {
        const r = await startJob(a, {
            prompt: 'the first link', result_key: 'aijob.chain.first',
            on_done: { extension: 'aijobchain', action: 'next' },
        });
        assert(r.status === 202, `start ${r.status}`);
        const end = await waitForState(a, r.body.data.job_id, ['done', 'failed']);
        assert(end.state === 'failed', `expected failed, got ${end.state}`);
        assert(end.chain_stopped === 'chain_too_deep', `chain_stopped ${end.chain_stopped}`);
        // The extension was handed a decision rather than a throw, so it could have degraded.
        const attempt = await json('/v1/memory/ext:aijobchain/chain.attempt');
        assert(attempt.status === 200, `the extension recorded what it was told: ${attempt.status}`);
        assert(attempt.body.data.value.ok === false, 'ctx.ai.start answered with a decision, not a throw');
        assert(attempt.body.data.value.code === 'AI_JOB_CHAIN_TOO_DEEP', `code ${attempt.body.data.value.code}`);
        const next = await readMemory(a, 'aijob.chain.next');
        assert(next.status === 404, 'and no next job ran');
    });

    // ── 8. The callback's extension changes owner between enqueue and fire ──
    await test('8. A callback whose extension changed owner between enqueue and fire is refused at fire', async () => {
        holding = true;
        const r = await startJob(a, {
            prompt: 'the owner will change under this one', result_key: 'aijob.swap.result',
            on_done: { extension: 'aijobmark', action: 'mark' },
        });
        assert(r.status === 202, `start ${r.status}: ${JSON.stringify(r.body?.error)}`);
        await sleep(600);
        assert(held.length >= 1, 'the job is held in the provider call');

        // installedBy is decided at install, so a delete-and-reinstall by somebody else outlives the
        // enqueue check. This is why there are two.
        const del = await json('/v1/extensions/aijobmark', { method: 'DELETE', headers: auth(a.token) });
        assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body?.error)}`);
        await installExtension(b, 'aijobmark', 'mark', SCRIPT_MARK);

        releaseHeld();
        const end = await waitForState(a, r.body.data.job_id, ['done', 'failed']);
        assert(end.state === 'failed', `expected failed, got ${end.state}`);
        assert(end.error?.code === 'AI_JOB_CALLBACK_FAILED', `code ${end.error?.code}`);
        assert(/another owner/i.test(end.error?.message ?? ''), `the refusal names the reason: ${end.error?.message}`);
    });

    // ── 15. Restart reconciliation ──
    await test('15. A job left running by a dead process becomes failed: node_restarted', async () => {
        holding = true;
        const r = await startJob(a, { prompt: 'this one outlives its process', result_key: 'aijob.restart.result' });
        assert(r.status === 202, `start ${r.status}`);
        const id = r.body.data.job_id;
        await waitForState(a, id, ['running'], 10_000);

        await stopServer(server, true);          // SIGKILL: no graceful anything, like a real crash
        releaseHeld();
        server = await startServer();

        const after = await waitForState(a, id, ['failed', 'done', 'cancelled'], 20_000);
        assert(after.state === 'failed', `expected failed, got ${after.state}`);
        assert(after.error?.code === 'node_restarted', `code ${after.error?.code}`);
    });

    // ── cleanup ──
    releaseHeld();
    await stopServer(server);
    await new Promise<void>(r => { if (stub) stub.close(() => r()); else r(); });
    cleanDbFile();

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
    console.error('SUITE CRASHED:', err);
    process.exit(1);
});
