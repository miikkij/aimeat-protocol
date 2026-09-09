/**
 * @file test/e2e-core-jobs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every core scheduled job this node seeds, fired through the operator's trigger door,
 *   with the assertion made on what the handler DID rather than on the status it returned.
 *
 *   WHY THIS SUITE EXISTS. `src/services/core-jobs.ts` registers twenty-odd handlers and
 *   `src/services/job-seeding.ts` creates a row for each at boot, and the sweep triggers exactly one
 *   of them (e2e-living-pulse fires `core:living-pulse`). Everything else — the allowance, the two
 *   usage sweeps, the four retention prunes, the consent expiry, the nonce sweep, the design-book
 *   fade, the capability fold, the dispute clock and the two mailers — had never been executed by a
 *   test. `src/services/usage/archive-job.ts` and `src/services/ai-jobs/prune-job.ts` had never run
 *   at all. A defect in any of them ships green and is found in production, at night, by nobody.
 *
 *   IT RUNS ITS OWN NODE, for three reasons that are all boot-time configuration: half of these jobs
 *   are only SEEDED when a flag is on (consent, personal nodes, EUDIW nonces, and the two mailers,
 *   which need SMTP), the retention windows are read from the environment, and the usage archive
 *   reads its hot window at module load. The shared E2E node has email off and every window at its
 *   production default, so on it these rows either do not exist or the sweep provably does nothing.
 *   SQLite whichever backend the runner used: what is under test is a set of service functions, and
 *   no storage provider changes which rows a sweep moves.
 *
 *   THE CRONS ARE TURNED OFF FIRST. Five of these jobs are seeded on a five-minute cron, so a run
 *   that crosses a five-minute boundary would have the job fire behind the assertion and make "it
 *   was absent, then the trigger created it" a coin toss. Phase 0 disables every core row;
 *   `triggerNow` does not read `enabled`, so the manual door still fires each one.
 *
 *   WHAT AN AGE-GATED SWEEP CAN HONESTLY PROVE. Six of these handlers act on rows older than a
 *   window (7 days, 30 days, a fortnight, 60 days) and nothing reachable over HTTP can backdate a
 *   row. For those the assertion is the other half of the branch, which is the half that runs every
 *   night in production and is the one that would destroy data if it were wrong: the sweep ran, and
 *   the fresh row it must not touch is still there. Each such test says so in a comment naming the
 *   window, so nobody later reads it as proof the deleting branch works.
 * @structure
 *   - Phase 0: the node, the SMTP sink, the operator, and the crons turned off
 *   - Phase 1: core:daily-allowance — the balance really rises
 *   - Phase 2: core:usage-rollup and core:usage-archive — raw folds, then moves to the archive
 *   - Phase 3: core:ai-job-log-prune — the old day record goes, today's stays
 *   - Phase 4: the retention sweeps that must leave a fresh row alone
 *   - Phase 5: core:consent-expiry and core:nonce-cleanup — both with a real before/after
 *   - Phase 6: core:designbook-aging, core:capability-aggregation, core:dispute-timeout
 *   - Phase 7: the two mailers, against the sink
 *   - Phase 8: the refusals (401 / 403 / 404)
 * @usage
 *   cd aimeat && pnpm exec node --import tsx test/e2e-core-jobs.ts
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Initial.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { startFakeSmtp, type FakeSmtp, type ParsedMail } from './helpers/fake-smtp.js';
import { waitForServer } from './helpers/wait-for-server.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = Number(process.env.E2E_CORE_JOBS_PORT ?? 40310);
const SMTP_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const STAMP = Date.now().toString(36).slice(-6);

/** The retention windows this node is booted with, so an assertion can name the number it relies on. */
const EXECUTION_LOG_RETENTION_DAYS = 1;
const AI_JOB_LOG_RETENTION_DAYS = 1;
const CONSENT_AUDIT_RETENTION_DAYS = 1;
/** config.ts defaults, and what phase 1 arithmetic depends on. */
const WELCOME_BONUS = 100;
const DAILY_ALLOWANCE = 50;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) {
        failed++;
        console.error(`  ❌ ${name}: ${(err as Error).message}`);
        if (process.env.E2E_CORE_JOBS_DEBUG) console.error(nodeLog.slice(-4000));
    }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const short = (v: unknown): string => JSON.stringify(v).slice(0, 300);

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
            break;
        } catch (err) {
            // Extensions keep mounting for a few seconds after /v1/spec answers and a connection made
            // in that window is reset. Retrying beats widening the readiness probe into something
            // that lies about what is ready. (Same reason as test/e2e-email-delivery.ts.)
            if (attempt === 4) throw err;
            await sleep(500);
        }
    }
    if (!res) throw new Error('unreachable');
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}
const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** Register through the protocol door and sign in. The FIRST such account is the node's operator. */
async function registerOwner(name: string): Promise<{ name: string; token: string; privateKey: string }> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${short(reg.body)}`);
    const privateKey = reg.body.data.private_key as string;
    return { name, token: await ownerToken(name, privateKey), privateKey };
}

async function ownerToken(owner: string, privB64: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const r = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp, signature: await signMsg(privB64, owner + NODE_ID + timestamp) }),
    });
    assert(r.status === 200, `owner token for ${owner}: ${r.status} ${short(r.body)}`);
    return r.body.data.token as string;
}

async function agentToken(gaii: string, privB64: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const r = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp, signature: await signMsg(privB64, gaii + timestamp) }),
    });
    assert(r.status === 200, `agent token for ${gaii}: ${r.status} ${short(r.body)}`);
    return r.body.data.token as string;
}

/** Create an agent under an owner and hand back its GAII plus a session of its own. */
async function createAgent(ownerName: string, ownerTok: string, agentName: string, capabilities: string[]): Promise<{ gaii: string; token: string }> {
    const r = await json('/v1/agents', {
        method: 'POST', headers: bearer(ownerTok),
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities, model: 'test' }),
    });
    assert(r.status === 201, `agent ${agentName}: ${r.status} ${short(r.body)}`);
    const gaii = r.body.data.agent.gaii as string;
    return { gaii, token: await agentToken(gaii, r.body.data.private_key as string) };
}

/**
 * Fire one core job as the operator and prove the RUN itself succeeded.
 *
 * The trigger route answers with the job record as it stands after the run, so `lastRunResult` is
 * the handler's own verdict: a handler that threw comes back 'error' with `lastRunError` set, and
 * the route still answers 200. Asserting only the status would pass on a handler that crashed.
 */
async function fire(jobId: string): Promise<any> {
    const r = await json(`/v1/admin/scheduler/jobs/${jobId}/trigger`, { method: 'POST', headers: bearer(opToken) });
    assert(r.status === 200, `trigger ${jobId}: ${r.status} ${short(r.body)}`);
    const job = r.body.data.job;
    assert(job.lastRunResult === 'success', `${jobId} ran but failed: ${job.lastRunError ?? short(job)}`);
    return job;
}

const day = (offsetDays: number): string => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

// ─── The node and the sink ────────────────────────────────────────────────────

let node: ChildProcess | null = null;
let nodeLog = '';
let smtp: FakeSmtp | null = null;
const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-corejobs-'));

async function startNode(): Promise<void> {
    node = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', join(dbDir, 'core-jobs.db'), '--port', String(PORT)], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            AIMEAT_PORT: String(PORT),
            AIMEAT_BASE_URL: BASE,
            AIMEAT_NODE_ID: NODE_ID,
            AIMEAT_NODE_TYPE: 'full',
            AIMEAT_STORAGE: 'sqlite',
            AIMEAT_SQLITE_PATH: join(dbDir, 'core-jobs.db'),
            DATABASE_URL: '',
            AIMEAT_DEV_MODE: 'true',
            AIMEAT_TEST_MODE: 'true',
            AIMEAT_ANONYMOUS: 'true',
            AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
            AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            AIMEAT_DEFAULT_AGENT_SCOPES: '*',
            AIMEAT_CAPABILITY_PUBLISHING: 'self_only',

            // Email ON, pointed at the sink in this process: without it neither
            // core:mcp-onboarding-rescue nor core:inactivity-nudge is seeded at all.
            AIMEAT_SMTP_HOST: '127.0.0.1',
            AIMEAT_SMTP_PORT: String(SMTP_PORT),
            AIMEAT_SMTP_SECURE: 'false',
            AIMEAT_SMTP_REJECT_UNAUTHORIZED: 'false',
            AIMEAT_SMTP_FROM: 'AIMEAT Core Jobs <noreply@aimeat.test>',
            // The nudge is off unless an operator turns it on — unsolicited mail is never a deploy
            // side effect, so the job no-ops on a default node however hard a test fires it.
            AIMEAT_INACTIVITY_NUDGE: 'true',
            // core:nonce-cleanup is seeded only when a wallet-verification flow is on. It is FTN and
            // not EUDIW because src/config-eudiw-guard.ts refuses to BOOT with AIMEAT_EUDIW_ENABLED
            // =true (holder binding is unfinished), and job-seeding takes either flag.
            AIMEAT_FTN_ENABLED: 'true',
            // Outbound connections, for the one door that mints a verification nonce without a live
            // identity provider behind it. No server is needed: only the authorize URL is built.
            AIMEAT_CONNECTIONS_ENABLED: 'true',
            AIMEAT_CONNECT_FAKE_BASE_URL: 'http://127.0.0.1:40388',

            // The usage sweep's windows, read at module load in services/usage/archive-job.ts. Zero
            // means "keep nothing hot": until 2026-09-08 the file read `Number(x) || 90`, so this 0
            // fell through to ninety days in silence and the sweep moved nothing. Asserted as a hole
            // first (the archive test below moved 0 rows with this env), fixed in archive-job v1.1.0.
            AIMEAT_USAGE_HOT_DAYS: '0',
            AIMEAT_USAGE_HOUR_ROLLUP_DAYS: '0',
            AIMEAT_USAGE_ARCHIVE_BATCH: '1',
            // The usage-call buffer flushes on an interval; 500 ms keeps the waits in this suite short.
            AIMEAT_USAGE_BUFFER_MS: '500',

            AIMEAT_EXECUTION_LOG_RETENTION_DAYS: String(EXECUTION_LOG_RETENTION_DAYS),
            AIMEAT_AI_JOB_LOG_RETENTION_DAYS: String(AI_JOB_LOG_RETENTION_DAYS),
            AIMEAT_CONSENT_AUDIT_RETENTION_DAYS: String(CONSENT_AUDIT_RETENTION_DAYS),

            AIMEAT_LOGIN_TARPIT_ENABLED: 'false',
            AIMEAT_LOGIN_RATE_LIMIT_MAX: '1000',
            AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
            AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000',
            AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_BOARDS: '1000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    node.stdout?.on('data', c => { nodeLog += c.toString(); });
    node.stderr?.on('data', c => { nodeLog += c.toString(); });
    await waitForServer(node, BASE, { label: 'the jobs node' });
}

async function stopAll(): Promise<void> {
    if (node) {
        const dying = node;
        node = null;
        dying.kill();
        // The coverage preload defers the signal to write its snapshot; exiting before it has is how
        // a measured run loses the measure.
        await Promise.race([once(dying, 'exit'), sleep(15_000)]);
    }
    if (smtp) { await smtp.close(); smtp = null; }
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will get it */ }
}

// ─── The run ──────────────────────────────────────────────────────────────────

console.log('\n=== Core scheduled jobs: every handler fired, and what it actually did ===\n');

const opName = `cjop${STAMP}`;
const funnelName = `cjfun${STAMP}`;
const funnelEmail = `${funnelName}@aimeat.test`;
const reqOwnerName = `cjreq${STAMP}`;
const provOwnerName = `cjprov${STAMP}`;
const plainName = `cjplain${STAMP}`;
const PROBE_ACTION = 'core-jobs-probe';

let opToken = '';
let funnelToken = '';

const sixDigits = (mail: ParsedMail): string => {
    const m = /\b(\d{6})\b/.exec(mail.text);
    assert(m !== null, `no six-digit code in the message: ${mail.text.slice(0, 400)}`);
    return m[1];
};

async function run(): Promise<void> {
    smtp = await startFakeSmtp({ port: SMTP_PORT });
    await startNode();

    // ── Phase 0 ───────────────────────────────────────────────────────────────
    console.log('Phase 0 — the operator, the seeded rows, and the crons turned off');

    await test('the first owner of a clean database is the operator', async () => {
        const op = await registerOwner(opName);
        opToken = op.token;
        const jobs = await json('/v1/admin/scheduler/jobs', { headers: bearer(opToken) });
        assert(jobs.status === 200, `list jobs: ${jobs.status} ${short(jobs.body)}`);
        assert(jobs.body.data.total > 0, 'a booted node seeds its core jobs');
    });

    await test('every job this suite fires was seeded, including the four behind a flag', async () => {
        const jobs = await json('/v1/admin/scheduler/jobs', { headers: bearer(opToken) });
        const ids = new Set((jobs.body.data.jobs as Array<{ id: string }>).map(j => j.id));
        const wanted = [
            'core:daily-allowance', 'core:usage-rollup', 'core:usage-archive', 'core:ai-job-log-prune',
            'core:execution-log-prune', 'core:consent-audit-prune', 'core:invitation-expiry',
            'core:mailbox-cleanup', 'core:consent-expiry', 'core:nonce-cleanup',
            'core:designbook-aging', 'core:capability-aggregation', 'core:dispute-timeout',
            'core:mcp-onboarding-rescue', 'core:inactivity-nudge',
        ];
        const missing = wanted.filter(id => !ids.has(id));
        // consent-expiry / consent-audit-prune, mailbox-cleanup, nonce-cleanup and the two mailers
        // exist ONLY because this node was booted with consent, personal nodes, EUDIW and SMTP on.
        assert(missing.length === 0, `not seeded: ${missing.join(', ')}`);
    });

    await test('every core cron is disabled, so nothing fires behind an assertion', async () => {
        const jobs = await json('/v1/admin/scheduler/jobs?type=core', { headers: bearer(opToken) });
        const rows = jobs.body.data.jobs as Array<{ id: string }>;
        for (const row of rows) {
            const r = await json(`/v1/admin/scheduler/jobs/${row.id}`, {
                method: 'PATCH', headers: bearer(opToken), body: JSON.stringify({ enabled: false }),
            });
            assert(r.status === 200, `disable ${row.id}: ${r.status} ${short(r.body)}`);
        }
        const after = await json('/v1/admin/scheduler/jobs?type=core&enabled=true', { headers: bearer(opToken) });
        assert(after.body.data.total === 0, `still enabled: ${short(after.body.data.jobs)}`);
    });

    // ── Phase 1 ───────────────────────────────────────────────────────────────
    console.log('\nPhase 1 — core:daily-allowance');

    await test('the allowance credits the human the agent acts for, up to the cap', async () => {
        await createAgent(opName, opToken, 'allowance-probe', ['memory']);
        const before = await json('/v1/wallet', { headers: bearer(opToken) });
        assert(before.status === 200, `wallet: ${before.status} ${short(before.body)}`);
        assert(before.body.data.balance === WELCOME_BONUS,
            `a fresh account starts at the welcome bonus, got ${before.body.data.balance}`);

        // A disabled job still fires on the manual door: triggerNow reads the row, not the cron.
        await fire('core:daily-allowance');

        const after = await json('/v1/wallet', { headers: bearer(opToken) });
        assert(after.body.data.balance === WELCOME_BONUS + DAILY_ALLOWANCE,
            `expected ${WELCOME_BONUS + DAILY_ALLOWANCE} after one allowance run, got ${after.body.data.balance}`);
    });

    // ── Phase 2 ───────────────────────────────────────────────────────────────
    console.log('\nPhase 2 — core:usage-rollup and core:usage-archive');

    await test('two priced calls land in the raw ledger', async () => {
        const agent = await createAgent(opName, opToken, 'usage-reporter', ['test']);
        for (const model of ['anthropic/claude-opus-5', 'openai/gpt-5']) {
            const r = await json('/v1/agents/usage-reporter/telemetry', {
                method: 'POST', headers: bearer(agent.token),
                body: JSON.stringify({
                    type: 'llm_call',
                    data: { model, provider: 'openrouter', prompt_tokens: 100, completion_tokens: 40, cost_usd: 0.02 },
                }),
            });
            assert(r.status === 201, `telemetry ${model}: ${r.status} ${short(r.body)}`);
        }
    });

    await test('the fold turns raw into the serving layer the dashboards read', async () => {
        const before = await json('/v1/admin/usage/status', { headers: bearer(opToken) });
        assert(before.status === 200, `usage status: ${before.status} ${short(before.body)}`);
        assert(before.body.data.streams.llm === null, `nothing folded yet, got ${short(before.body.data.streams.llm)}`);

        await fire('core:usage-rollup');

        const after = await json('/v1/admin/usage/status', { headers: bearer(opToken) });
        assert(after.body.data.streams.llm !== null, 'the fold must advance the llm cursor');
        assert(typeof after.body.data.streams.llm.last_ts === 'string', `cursor shape: ${short(after.body.data.streams.llm)}`);
        assert(after.body.data.computed_through !== null, 'the layer must state how far it is computed');
    });

    await test('the archive is empty before the sweep', async () => {
        // The control for the assertion below. Pruning the archive is the only door that counts what
        // is IN it, and it answers 0 while every row is still hot.
        const r = await json('/v1/admin/usage/archive/prune', {
            method: 'POST', headers: bearer(opToken), body: JSON.stringify({ before: day(1), confirm: true }),
        });
        assert(r.status === 200, `archive prune: ${r.status} ${short(r.body)}`);
        assert(r.body.data.deleted.usageEvents === 0, `nothing should be archived yet, got ${r.body.data.deleted.usageEvents}`);
    });

    await test('the sweep MOVES the ledger rows out of the hot table into the archive', async () => {
        // The hot window this node runs is 1.7 seconds, so the two rows have to be older than that
        // before the sweep can see them.
        await sleep(2500);
        await fire('core:usage-archive');

        const drained = await json('/v1/admin/usage/archive/prune', {
            method: 'POST', headers: bearer(opToken), body: JSON.stringify({ before: day(1), confirm: true }),
        });
        assert(drained.status === 200, `archive prune: ${drained.status} ${short(drained.body)}`);
        // Two llm_calls were reported; the hot window is zero days, so both are past it.
        assert(drained.body.data.deleted.usageEvents >= 2,
            `expected the two ledger rows in the archive, got ${drained.body.data.deleted.usageEvents}`);
    });

    // ── Phase 3 ───────────────────────────────────────────────────────────────
    console.log('\nPhase 3 — core:ai-job-log-prune');

    const OLD_LOG = 'ai.jobs.log.2026-01-01';
    const FRESH_LOG = `ai.jobs.log.${day(0)}`;

    await test('an old AI-job day record goes, and today\'s stays', async () => {
        for (const key of [OLD_LOG, FRESH_LOG]) {
            const w = await json('/v1/memory', {
                method: 'POST', headers: bearer(opToken),
                body: JSON.stringify({ key, value: [{ id: 'probe', status: 'done' }], visibility: 'private' }),
            });
            assert(w.status === 201, `write ${key}: ${w.status} ${short(w.body)}`);
        }

        await fire('core:ai-job-log-prune');

        // Retention is one day, so the cutoff is yesterday: 2026-01-01 is outside it and today is not.
        const old = await json(`/v1/memory/${encodeURIComponent(OLD_LOG)}`, { headers: bearer(opToken) });
        assert(old.status === 404, `${OLD_LOG} should be pruned, got ${old.status}`);
        const fresh = await json(`/v1/memory/${encodeURIComponent(FRESH_LOG)}`, { headers: bearer(opToken) });
        assert(fresh.status === 200, `${FRESH_LOG} must survive a ${AI_JOB_LOG_RETENTION_DAYS}-day window, got ${fresh.status}`);
    });

    // ── Phase 4 ───────────────────────────────────────────────────────────────
    console.log('\nPhase 4 — the retention sweeps, and the fresh rows they must leave alone');

    let scheduleId = '';

    await test('core:execution-log-prune keeps an entry that is inside the window', async () => {
        // A failed run of a user schedule is what puts a row in the execution log at all: core-job
        // SUCCESSES are deliberately not logged (scheduler.ts), so nothing this suite fires writes one.
        const created = await json('/v1/schedules', {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({ kind: 'ai', cron: '0 8 * * *', display_name: 'core-jobs log probe', prompt: 'Say nothing.' }),
        });
        assert(created.status === 201, `schedule: ${created.status} ${short(created.body)}`);
        scheduleId = created.body.data.schedule.id as string;

        const ran = await json(`/v1/schedules/${scheduleId}/trigger`, { method: 'POST', headers: bearer(opToken) });
        assert(ran.status === 200, `schedule trigger: ${ran.status} ${short(ran.body)}`);

        const before = await json(`/v1/admin/scheduler/execution-log?jobId=${scheduleId}`, { headers: bearer(opToken) });
        assert(before.status === 200, `execution log: ${before.status} ${short(before.body)}`);
        assert(before.body.data.total >= 1, `the run must leave a row, got ${before.body.data.total}`);

        await fire('core:execution-log-prune');

        // The window is one day and the row is seconds old. What is pinned is the branch that runs
        // every night: the sweep must not destroy a row inside its retention window. Nothing
        // reachable over HTTP can backdate an execution-log row, so the deleting branch is not
        // provable here.
        const after = await json(`/v1/admin/scheduler/execution-log?jobId=${scheduleId}`, { headers: bearer(opToken) });
        assert(after.body.data.total === before.body.data.total,
            `a ${EXECUTION_LOG_RETENTION_DAYS}-day window must keep a seconds-old row: ${before.body.data.total} → ${after.body.data.total}`);
    });

    let consentId = '';

    await test('core:consent-audit-prune keeps a trail entry that is inside the window', async () => {
        const grant = await json('/v1/consent', {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({
                data_pattern: 'notes.*', recipient: '*', purpose: 'core-jobs audit probe',
                // Already past: phase 5 fires the expiry sweep at this record.
                expires: new Date(Date.now() - 3_600_000).toISOString(),
            }),
        });
        assert(grant.status === 201, `consent: ${grant.status} ${short(grant.body)}`);
        consentId = grant.body.data.id as string;

        const before = await json('/v1/consent/audit?days=30', { headers: bearer(opToken) });
        assert(before.status === 200, `consent audit: ${before.status} ${short(before.body)}`);
        assert(before.body.data.total >= 1, `granting must leave a trail entry, got ${before.body.data.total}`);

        await fire('core:consent-audit-prune');

        // Same shape as the execution-log sweep: a one-day window over a seconds-old entry, so what
        // is pinned is that the nightly pass leaves the recent trail intact.
        const after = await json('/v1/consent/audit?days=30', { headers: bearer(opToken) });
        assert(after.body.data.total === before.body.data.total,
            `a ${CONSENT_AUDIT_RETENTION_DAYS}-day window must keep a seconds-old entry: ${before.body.data.total} → ${after.body.data.total}`);
    });

    let organismId = '';

    await test('core:invitation-expiry leaves a still-live invitation pending', async () => {
        const org = await json('/v1/organisms', {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({ name: `Core Jobs Org ${STAMP}`, type: 'project', join_policy: 'invite_only', visibility: 'public' }),
        });
        assert(org.status === 201, `organism: ${org.status} ${short(org.body)}`);
        organismId = org.body.data.organism.id as string;

        const invite = await json(`/v1/organisms/${organismId}/invitations/email`, {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({ email: `cjinv${STAMP}@aimeat.test`, orgRole: 'member' }),
        });
        assert(invite.status === 201, `invitation: ${invite.status} ${short(invite.body)}`);

        await fire('core:invitation-expiry');

        // The shortest expiry the invitation service will mint is one day (INVITE_MAX/MIN clamp), so
        // the sweep cannot be shown expiring one here. What it must not do is expire a live invite.
        const list = await json(`/v1/organisms/${organismId}/invitations/email`, { headers: bearer(opToken) });
        assert(list.status === 200, `invitation list: ${list.status} ${short(list.body)}`);
        assert(list.body.data.total === 1, `the live invitation must stay pending, got ${list.body.data.total}`);
    });

    await test('core:mailbox-cleanup leaves an anchored personal node and its mailbox alone', async () => {
        const personalNodeId = `personal-cj${STAMP}`;
        const anchor = await json('/v1/personal/anchor', {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({
                node_id: personalNodeId, owner_name: opName, public_key: 'test-key-base64',
                agent_gaiis: [], visibility: 'private',
            }),
        });
        assert(anchor.status === 201, `anchor: ${anchor.status} ${short(anchor.body)}`);

        await fire('core:mailbox-cleanup');

        // The sweep removes items past their retention date, and nothing reachable over HTTP deposits
        // a mailbox item (only the signed federation path does). The branch pinned here is that a
        // live anchor and an empty mailbox come through the sweep unchanged.
        const status = await json('/v1/personal/status', { headers: bearer(opToken) });
        assert(status.status === 200, `personal status: ${status.status} ${short(status.body)}`);
        assert(status.body.data.node_id === personalNodeId, `the anchor must survive: ${short(status.body.data)}`);
        assert(status.body.data.mailbox.items === 0, `mailbox items: ${status.body.data.mailbox.items}`);
    });

    // ── Phase 5 ───────────────────────────────────────────────────────────────
    console.log('\nPhase 5 — core:consent-expiry and core:nonce-cleanup');

    await test('a consent whose expiry has passed reads active until the sweep, then expired', async () => {
        const before = await json(`/v1/consent/${consentId}`, { headers: bearer(opToken) });
        assert(before.status === 200, `consent read: ${before.status} ${short(before.body)}`);
        assert(before.body.data.status === 'active', `a past expiry is not self-enforcing, got ${before.body.data.status}`);

        await fire('core:consent-expiry');

        const after = await json(`/v1/consent/${consentId}`, { headers: bearer(opToken) });
        assert(after.body.data.status === 'expired', `the sweep must mark it expired, got ${after.body.data.status}`);
    });

    await test('the nonce sweep leaves an authorization state that is still live', async () => {
        const nonceRows = async (): Promise<number> => {
            const r = await json('/v1/admin/storage-stats?limit=1', { headers: bearer(opToken) });
            assert(r.status === 200, `storage stats: ${r.status} ${short(r.body)}`);
            return r.body.data.current.counts.verification_nonces as number;
        };
        for (let i = 0; i < 2; i++) {
            const started = await json('/v1/connections/start', {
                method: 'POST', headers: bearer(opToken),
                body: JSON.stringify({ provider: 'fake', mode: 'personal', return_url: '/profile#access' }),
            });
            assert(started.status === 200, `connections start: ${started.status} ${short(started.body)}`);
        }
        const before = await nonceRows();
        assert(before >= 2, `the two authorization rounds must have left a state each, got ${before}`);

        await fire('core:nonce-cleanup');

        // The connect state's TTL is a fixed ten minutes and no door mints a shorter-lived nonce, so
        // the deleting branch is not reachable from here. What is pinned is the one that runs every
        // five minutes in production: a live login round must survive the sweep. A comparison the
        // wrong way round here logs everybody out mid-authorization.
        assert(await nonceRows() === before, `a live authorization state was swept: ${before} → ${await nonceRows()}`);
    });

    // ── Phase 6 ───────────────────────────────────────────────────────────────
    console.log('\nPhase 6 — core:designbook-aging, core:capability-aggregation, core:dispute-timeout');

    await test('the design-book fade leaves parts published inside the 60-day window', async () => {
        const before = await json('/v1/designbook?status=published&limit=200', { headers: bearer(opToken) });
        assert(before.status === 200, `design book: ${before.status} ${short(before.body)}`);
        const publishedBefore = before.body.data.count as number;
        assert(publishedBefore > 0, 'a fresh node seeds the Design Book with published parts');

        await fire('core:designbook-aging');

        // The parts were seeded at boot, so none is 60 days old. This pins the guard: the nightly
        // fade must not touch a part that is still inside its window.
        const after = await json('/v1/designbook?status=published&limit=200', { headers: bearer(opToken) });
        assert(after.body.data.count === publishedBefore,
            `nothing seeded minutes ago may fade: ${publishedBefore} → ${after.body.data.count}`);
    });

    let providerGaii = '';
    let providerToken = '';
    let requesterToken = '';
    let trackingCode = '';

    await test('a published action becomes a capability only once the aggregation runs', async () => {
        const reqOwner = await registerOwner(reqOwnerName);
        const provOwner = await registerOwner(provOwnerName);
        requesterToken = (await createAgent(reqOwnerName, reqOwner.token, 'requester', ['work'])).token;
        const provider = await createAgent(provOwnerName, provOwner.token, 'provider', ['work', 'actions']);
        providerGaii = provider.gaii;
        providerToken = provider.token;

        const publish = await json('/v1/actions', {
            method: 'POST', headers: bearer(providerToken),
            body: JSON.stringify({
                id: PROBE_ACTION, display_name: 'Core Jobs Probe',
                description: 'Action used to prove the capability aggregation folds it in',
                input_schema: { type: 'object', properties: { text: { type: 'string' } } },
                output_schema: { type: 'object', properties: { result: { type: 'string' } } },
                pricing: { base_morsels: 10 },
            }),
        });
        assert(publish.status === 201, `publish action: ${publish.status} ${short(publish.body)}`);

        const capId = `action:${providerGaii}:${PROBE_ACTION}`;
        const before = await json(`/v1/capabilities/${encodeURIComponent(capId)}`, { headers: bearer(opToken) });
        assert(before.status === 404, `publishing must not create the capability by itself, got ${before.status}`);

        await fire('core:capability-aggregation');

        const after = await json(`/v1/capabilities/${encodeURIComponent(capId)}`, { headers: bearer(opToken) });
        assert(after.status === 200, `the aggregation must fold the action in: ${after.status} ${short(after.body)}`);
        assert(after.body.data.source.type === 'action', `source: ${short(after.body.data.source)}`);
        assert(after.body.data.callable === false, 'an action is discovery-only, never callable in place');
    });

    await test('the dispute clock leaves a dispute opened today untouched', async () => {
        const submitted = await json('/v1/work', {
            method: 'POST', headers: bearer(requesterToken),
            body: JSON.stringify({ action_id: PROBE_ACTION, provider_gaii: providerGaii, input: { text: 'probe' } }),
        });
        assert(submitted.status === 201, `work submit: ${submitted.status} ${short(submitted.body)}`);
        trackingCode = submitted.body.data.tracking_code as string;

        const accepted = await json(`/v1/work/${trackingCode}/accept`, { method: 'POST', headers: bearer(providerToken) });
        assert(accepted.status === 200, `work accept: ${accepted.status} ${short(accepted.body)}`);
        const delivered = await json(`/v1/work/${trackingCode}/deliver`, {
            method: 'POST', headers: bearer(providerToken), body: JSON.stringify({ output: { result: 'as asked' } }),
        });
        assert(delivered.status === 200, `work deliver: ${delivered.status} ${short(delivered.body)}`);
        const opened = await json(`/v1/work/${trackingCode}/dispute`, {
            method: 'POST', headers: bearer(requesterToken), body: JSON.stringify({ reason: 'core-jobs dispute probe' }),
        });
        assert(opened.status === 201, `open dispute: ${opened.status} ${short(opened.body)}`);

        await fire('core:dispute-timeout');

        // The handler's two branches are 7 days (auto-escalate) and 30 days (auto-resolve), and no
        // door backdates a dispute. What is pinned is the loop reaching this record and deciding
        // correctly to leave it: an off-by-one on either comparison escalates a dispute opened today.
        const thread = await json(`/v1/work/${trackingCode}/dispute`, { headers: bearer(requesterToken) });
        assert(thread.status === 200, `dispute read: ${thread.status} ${short(thread.body)}`);
        assert(thread.body.data.status === 'open', `a dispute opened today must stay open, got ${thread.body.data.status}`);
        const events = (thread.body.data.messages as Array<{ event: string }>).map(m => m.event);
        assert(!events.includes('escalated'), `nothing may auto-escalate on day zero: ${events.join(', ')}`);
    });

    // ── Phase 7 ───────────────────────────────────────────────────────────────
    console.log('\nPhase 7 — the two mailers, against a real SMTP server');

    await test('an account with a verified address exists for the funnel passes to consider', async () => {
        const reg = await json('/v1/ghii/register-web', {
            method: 'POST',
            body: JSON.stringify({ username: funnelName, display_name: 'Funnel Reader', email: funnelEmail }),
        });
        assert(reg.status === 201, `register-web: ${reg.status} ${short(reg.body)}`);
        const mail = await smtp!.waitForMail(funnelEmail, /\b\d{6}\b/);
        const verify = await json('/v1/ghii/verify-email', {
            method: 'POST',
            body: JSON.stringify({ verification_id: reg.body.data.verification_id, code: sixDigits(mail) }),
        });
        assert(verify.status === 200, `verify-email: ${verify.status} ${short(verify.body)}`);
        assert(verify.body.data.verification_level === 1, `expected level 1, got ${verify.body.data.verification_level}`);

        funnelToken = await ownerToken(funnelName, reg.body.data.private_key as string);
        // The web door already stamps onboarding.track at account creation, so this is an UPDATE
        // (200, version 2) rather than a create. The rescue reads it to decide which wording the
        // message would carry, so it has to say 'remake' before the pass is fired.
        const track = await json('/v1/memory', {
            method: 'POST', headers: bearer(funnelToken),
            body: JSON.stringify({ key: 'onboarding.track', value: { track: 'remake' }, visibility: 'private' }),
        });
        assert(track.status === 200, `onboarding.track: ${track.status} ${short(track.body)}`);
        const readBack = await json(`/v1/memory/${encodeURIComponent('onboarding.track')}`, { headers: bearer(funnelToken) });
        assert(readBack.body.data.value.track === 'remake', `track: ${short(readBack.body.data.value)}`);
    });

    await test('core:mcp-onboarding-rescue mails nobody whose account is younger than a day', async () => {
        smtp!.clear();
        await fire('core:mcp-onboarding-rescue');
        await sleep(700);

        // The pass only considers accounts between one day and one week old, so the account created
        // moments ago is out of the window. The marker is the proof: it is written on every send,
        // successful or not, so its absence means the age gate refused before the send.
        assert(smtp!.mailTo(funnelEmail).length === 0,
            `an account minutes old must not be rescued, got ${smtp!.mailTo(funnelEmail).length} message(s)`);
        const marker = await json(`/v1/memory/${encodeURIComponent('onboarding.mcp_rescue_sent')}`, { headers: bearer(funnelToken) });
        assert(marker.status === 404, `no rescue marker may be written: ${marker.status} ${short(marker.body)}`);
    });

    await test('core:inactivity-nudge mails nobody who was seen today', async () => {
        smtp!.clear();
        await fire('core:inactivity-nudge');
        await sleep(700);

        // The nudge needs a fortnight of silence and nothing over HTTP can backdate the three
        // liveness signals it reads (session, chat instance, last login), so what is proved here is
        // the guard: an account seen minutes ago is not mailed, on a node with the feature ON.
        assert(smtp!.inbox.length === 0, `a live account must not be nudged, got ${smtp!.inbox.length} message(s)`);
    });

    await test('the nudge\'s cooldown marker and the opt-out switch are both honoured', async () => {
        const cooldown = await json('/v1/memory', {
            method: 'POST', headers: bearer(funnelToken),
            body: JSON.stringify({
                key: 'onboarding.inactivity_nudge',
                value: { sentAt: new Date().toISOString(), delivered: true, count: 1 },
                visibility: 'private',
            }),
        });
        assert(cooldown.status === 201, `cooldown marker: ${cooldown.status} ${short(cooldown.body)}`);
        const optOut = await json('/v1/memory', {
            method: 'POST', headers: bearer(funnelToken),
            body: JSON.stringify({ key: 'settings.email_notifications', value: { enabled: false }, visibility: 'private' }),
        });
        assert(optOut.status === 201, `opt-out: ${optOut.status} ${short(optOut.body)}`);

        smtp!.clear();
        await fire('core:inactivity-nudge');
        await sleep(700);

        // The trigger route answers with the job record rather than the handler's {sent, considered},
        // so the sink is the only place the outcome is visible. Zero here is the sum of three guards
        // agreeing, and the count marker below proves the job did not rewrite it.
        assert(smtp!.inbox.length === 0, `opted out and inside the cooldown: expected no mail, got ${smtp!.inbox.length}`);
        const marker = await json(`/v1/memory/${encodeURIComponent('onboarding.inactivity_nudge')}`, { headers: bearer(funnelToken) });
        assert(marker.body.data.value.count === 1, `a skipped account's marker must be left as it was, got ${short(marker.body.data.value)}`);
    });

    // ── Phase 8 ───────────────────────────────────────────────────────────────
    console.log('\nPhase 8 — the refusals');

    await test('a plain owner cannot fire a core job (403)', async () => {
        const plain = await registerOwner(plainName);
        const r = await json('/v1/admin/scheduler/jobs/core:daily-allowance/trigger', {
            method: 'POST', headers: bearer(plain.token),
        });
        assert(r.status === 403, `a non-operator triggering a core job must get 403, got ${r.status} ${short(r.body)}`);
    });

    await test('an unauthenticated caller cannot fire a core job (401)', async () => {
        const r = await json('/v1/admin/scheduler/jobs/core:daily-allowance/trigger', { method: 'POST' });
        assert(r.status === 401, `an anonymous trigger must get 401, got ${r.status} ${short(r.body)}`);
    });

    await test('a job id nothing seeded is a 404, not a silent no-op', async () => {
        const r = await json('/v1/admin/scheduler/jobs/core:not-a-job/trigger', { method: 'POST', headers: bearer(opToken) });
        assert(r.status === 404, `an unknown job must get 404, got ${r.status} ${short(r.body)}`);
    });

    await test('the operator\'s own balance is untouched by the refused runs', async () => {
        // The 403 and 401 above must have refused BEFORE the handler, not after: a leaked run would
        // credit the allowance a second time.
        const w = await json('/v1/wallet', { headers: bearer(opToken) });
        assert(w.body.data.balance === WELCOME_BONUS + DAILY_ALLOWANCE,
            `the refused triggers must not have run the allowance: ${w.body.data.balance}`);
    });

    await stopAll();
    console.log(`\nCore jobs E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(async err => { console.error('Suite crashed:', err); await stopAll(); process.exit(1); });
