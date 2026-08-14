/**
 * @file test/e2e-mcp-agent-tasks.ts
 * @description The task lifecycle over MCP, which nothing exercised before this file.
 *
 *   That absence is the finding. No suite called aimeat_task_create, _propose_todos, _event, _todo
 *   or _complete over a real MCP session, so five differences between these tools and the REST
 *   routes they mirror survived every green run:
 *
 *     - a task delegated to a TASK-RUNNER agent stayed queued, waiting for a click the owner was
 *       told they would not need. The HTTP door flips it to active and appends the matching
 *       'started' event, so an auto-activated task reads the same as an owner-approved one.
 *     - proposing todos on an active task that already HAS a live plan was allowed, and the
 *       preserve step keeps only todos already marked 'outdated' — so a mid-run re-proposal
 *       silently deleted every in-progress and completed todo, completedAt stamps included. The
 *       plan the owner approved and the record of what was done, both gone, with no refusal.
 *     - an agent that briefly stalled and came back could not report progress or tick a todo: the
 *       HTTP door reads either as proof the agent is back and auto-resumes, these refused outright.
 *     - aimeat_task_complete carried no readiness bar, so an agent that may not report progress
 *       could still declare the whole task done.
 *
 *   The readiness case is not driven here: it needs a completed onboarding record at a low level,
 *   which e2e-agent-readiness already stands up. The STALL case is driven, on a second node, and the
 *   block above it says why a second node is the only way to reach that state.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-agent-tasks
 * @version-history
 *   v1.3.0 — 2026-08-14 — The completion, which was the last tool surface still writing its own
 *     records. Three cases for the three ways the two copies had drifted: a STALLED task completes
 *     over MCP (on a second node, because nothing else reaches that state), `deliverable_key`
 *     survives the tool as far as the owner's inbox and the public feed, and an AGENT completing
 *     over REST is stamped while its OWNER is not.
 *   v1.2.0 — 2026-08-14 — The dispatch scope: a sixth difference between this tool and the route
 *     it mirrors, and the one that made a published skill's central step impossible to follow.
 *   v1.1.0 — 2026-08-11 — Two more differences, from the step that moved the WRITES into
 *     services/agent-task-write.ts: telemetry accumulates instead of overwriting the task totals with
 *     the last event's numbers, and the title/description caps the HTTP route applies now apply here.
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit: the MCP task tools had no coverage at all).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

/** `base` is a parameter because the stall case runs against a second node. Defaults to the shared one. */
async function json(path: string, opts: RequestInit = {}, base: string = BASE) {
    const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

function parseSSE(text: string, id: number): any {
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (!data) continue;
        try { const m = JSON.parse(data); if (m.id === id) return m; } catch { /* not a JSON frame */ }
    }
    return {};
}

interface Session { base: string; token: string; sessionId: string; nextId: number }

async function rpc(s: Session, method: string, params: Record<string, any> = {}) {
    const id = s.nextId++;
    const res = await fetch(`${s.base}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${s.token}`,
            ...(s.sessionId ? { 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) s.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('text/event-stream') ? parseSSE(await res.text(), id) : await res.json() as any;
}

async function callTool(s: Session, name: string, args: Record<string, unknown>) {
    const body = await rpc(s, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    return { isError: body?.result?.isError === true || body?.error !== undefined, text };
}

/** One owner, and an MCP session for an agent in the given mode, on the node at `base`. */
async function setup(label: string, mode: string, base: string = BASE) {
    const owner = `mtask${label}${Date.now()}`;
    const reg = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'McpTaskFlow1234' }) }, base);
    let r = await reg();
    for (let i = 0; r.status === 429 && i < 8; i++) { await new Promise(res => setTimeout(res, 1500)); r = await reg(); }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ownerKey = r.body.data.private_key as string;

    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(ownerKey, owner + NODE_ID + ts) }),
    }, base);
    const ownerToken = tok.body.data.token as string;

    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: `ag${label}`, owner, capabilities: ['tasks'], model: 'gpt-4o', mode, scopes: ['*'] }),
    }, base);
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const agentGaii = ag.body.data.agent.gaii as string;
    const agentKey = ag.body.data.private_key as string;
    // There is no GET /v1/agents/:name to read the mode back, so the mode is proven by behaviour
    // instead: the task-runner's task must come out active and the interactive one queued. If the
    // mode had not taken, one of those two would fail.

    // The agent's own REST session, so the SAME principal can knock on the HTTP door and the two
    // doors can be compared without changing who is writing. An agent signs `gaii + timestamp`; an
    // owner signs `owner + nodeId + timestamp`.
    const agTs = new Date().toISOString();
    const agTok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp: agTs, signature: await sign(agentKey, agentGaii + agTs) }),
    }, base);
    assert(agTok.status === 200, `agent token ${agTok.status}: ${JSON.stringify(agTok.body?.error)}`);
    const agentToken = agTok.body.data.token as string;

    const client = await json('/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: `mcp tasks ${label}`, redirect_uris: [] }),
    }, base);
    const ats = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii: agentGaii,
        signature: await sign(agentKey, agentGaii + NODE_ID + ats), timestamp: ats,
    });
    const auth = await json(`/v1/mcp/authorize?${params}`, {}, base);
    const token = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: auth.body.code,
            client_id: client.body.client_id, client_secret: client.body.client_secret,
        }),
    }, base);
    assert(token.status === 200, `mcp token ${token.status}: ${JSON.stringify(token.body)}`);

    const session: Session = { base, token: token.body.access_token, sessionId: '', nextId: 1 };
    await rpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcp tasks e2e', version: '1.0.0' } });
    await fetch(`${base}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`, 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return { base, owner, ownerToken, agentToken, agentGaii, agentName: `ag${label}`, session };
}

// ── The stalled case, and why it costs a second node ────────────────────────────────────────────
//
// A task reaches 'stalled' exactly one way: the detector's clock. The threshold is
// AIMEAT_TASK_STALL_THRESHOLD_MINUTES, it defaults to 120, and it is read at boot. No HTTP door sets
// the state, none backdates lastEventAt, and the shared test node cannot carry a zero threshold
// because every other suite's active task would stall with it. So proving that a stalled task can be
// completed means a node started with the threshold at zero, and that is a second server.
//
// It runs on SQLite regardless of which backend the sweep targets, and that is an acceptable trade
// rather than a hidden gap: what is under test is a status string that both providers write through
// the same updateAgentTask, and the gate being proven is a shared constant in
// services/agent-task-fanout.ts. Everything storage-shaped in this suite still runs on both.
const STALL_PORT = process.env.E2E_MCP_TASK_STALL_PORT ?? '40289';
const STALL_BASE = `http://localhost:${STALL_PORT}`;
const STALL_DB = resolve(process.cwd(), 'test/.test-mcp-task-stall.db');

function removeStallDb() {
    for (const f of [STALL_DB, `${STALL_DB}-wal`, `${STALL_DB}-shm`]) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* a stray handle is not a test failure */ }
    }
}

async function startStallNode(): Promise<ChildProcess> {
    removeStallDb();
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', STALL_DB], {
        // The suite process is handed the runner's pins, so inheriting them is how this node gets the
        // same rate limits, ceilings and pinned-shut credentials the shared one has.
        env: {
            ...process.env,
            AIMEAT_PORT: STALL_PORT,
            AIMEAT_BASE_URL: STALL_BASE,
            AIMEAT_NODE_ID: NODE_ID,
            AIMEAT_DB_PATH: STALL_DB,
            // The whole reason this node exists.
            AIMEAT_TASK_STALL_THRESHOLD_MINUTES: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd(),
    });
    child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        try { if ((await fetch(`${STALL_BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(res => setTimeout(res, 300));
    }
    child.kill('SIGTERM');
    throw new Error(`the stall node did not come up on ${STALL_BASE}`);
}

/**
 * The drift this closes: the tool accepted only an ACTIVE task, so an agent that crashed, was
 * flipped to stalled by a clock rather than by any evidence the work had stopped, and then came back
 * holding a finished deliverable was told only active tasks can be completed. The HTTP door has
 * always taken both, on the stated ground that a late deliverable beats rejecting real work.
 */
async function runStalledCase(): Promise<void> {
    let node: ChildProcess;
    try {
        node = await startStallNode();
    } catch (err) {
        failed++;
        console.error(`  ❌ a STALLED task can be completed over MCP: ${(err as Error).message}`);
        return;
    }

    try {
        // First owner on a fresh node, which is what makes them the operator. That matters because
        // the stall detector is a scheduled job and only an operator may run one on demand.
        const s = await setup('stall', 'task-runner', STALL_BASE);

        await test('a STALLED task can be completed over MCP, as it always could over HTTP', async () => {
            const created = await callTool(s.session, 'aimeat_task_create', {
                target_agent: s.agentName, title: 'Crash, come back, hand it in',
                description: 'The agent goes quiet long enough to be marked stalled, then finishes.',
            });
            assert(!created.isError, `create failed: ${created.text.slice(0, 300)}`);
            const taskId = JSON.parse(created.text).task_id;

            const trigger = await json('/v1/admin/scheduler/jobs/core:task-stall-detection/trigger', {
                method: 'POST', headers: { Authorization: `Bearer ${s.ownerToken}` },
            }, STALL_BASE);
            assert(trigger.status === 200,
                `could not run the stall detector (${trigger.status}): ${JSON.stringify(trigger.body?.error)}`);

            // Without this the rest of the test would pass on an ACTIVE task and prove nothing.
            const stalled = await callTool(s.session, 'aimeat_task_get', { task_id: taskId });
            const before = JSON.parse(stalled.text);
            assert(before.status === 'stalled', `the task never stalled, so nothing below is a test of the stalled path: it is '${before.status}'`);

            const done = await callTool(s.session, 'aimeat_task_complete', {
                task_id: taskId, message: 'I came back, and here is the work.',
            });
            assert(!done.isError,
                'an agent that stalled and came back cannot report the work it finished: '
                + done.text.slice(0, 300));

            const after = await callTool(s.session, 'aimeat_task_get', { task_id: taskId });
            assert(JSON.parse(after.text).status === 'done',
                `the completion answered but the task is '${JSON.parse(after.text).status}'`);
        });

        await test('...while a QUEUED task is still refused, in the same words the HTTP door uses', async () => {
            const created = await callTool(s.session, 'aimeat_task_create', {
                target_agent: s.agentName, title: 'Not released yet', description: 'Queued.',
                status: 'draft',
            });
            const taskId = JSON.parse(created.text).task_id;
            const done = await callTool(s.session, 'aimeat_task_complete', { task_id: taskId });
            assert(done.isError, `a draft task was completed: ${done.text.slice(0, 200)}`);
            assert(/INVALID_STATE/.test(done.text) && /active or stalled/.test(done.text),
                `expected the shared refusal, got: ${done.text.slice(0, 200)}`);
        });
    } finally {
        node.kill('SIGTERM');
        await new Promise(res => setTimeout(res, 700));
        removeStallDb();
    }
}

console.log('\n=== MCP agent tasks (August 2026 audit) ===\n');

async function run() {
    const runner = await setup('run', 'task-runner');
    const interactive = await setup('int', 'interactive');

    let runnerTaskId = '';
    await test('a task delegated to a TASK-RUNNER agent starts on its own', async () => {
        const r = await callTool(runner.session, 'aimeat_task_create', {
            target_agent: runner.agentName,
            title: 'Auto-start please',
            description: 'The owner set this agent to task-runner precisely so this needs no click.',
        });
        assert(!r.isError, `create failed: ${r.text.slice(0, 300)}`);
        runnerTaskId = JSON.parse(r.text).task_id ?? JSON.parse(r.text).id;
        assert(!!runnerTaskId, `no task id in: ${r.text.slice(0, 300)}`);

        const got = await callTool(runner.session, 'aimeat_task_get', { task_id: runnerTaskId });
        assert(!got.isError, `get failed: ${got.text.slice(0, 300)}`);
        const task = JSON.parse(got.text).task ?? JSON.parse(got.text);
        assert(task.status === 'active', `expected an active task, got '${task.status}'`);
    });

    // A fleet runner recognises work by a `kind` entry in the SCOPE and takes its pointers from the
    // rest. The tool could not express any of that until 2026-08-14 — target_agent, title,
    // description, status, files and nothing else — while the HTTP door and the shared service both
    // took it. So a chat following a runner's own instructions built a task the runner would never
    // pick up, and every step reported success.
    await test('a dispatch scope survives the tool and comes back on the task', async () => {
        const created = await callTool(runner.session, 'aimeat_task_create', {
            target_agent: runner.agentName,
            title: 'Build the morning news agent',
            description: 'The person asked for an agent that fetches AI news every morning.',
            scope: [
                { name: 'kind', value: 'hatchery.create_agent', description: 'What the runner dispatches on' },
                { name: 'memory_key', value: 'news.ai.daily', type: 'memory_key' },
                { name: 'app_id', value: 'someone/news.html' },
            ],
        });
        assert(!created.isError, `create failed: ${created.text.slice(0, 300)}`);
        const taskId = JSON.parse(created.text).task_id ?? JSON.parse(created.text).id;

        const got = await callTool(runner.session, 'aimeat_task_get', { task_id: taskId });
        const task = JSON.parse(got.text).task ?? JSON.parse(got.text);
        const scope = (task.scope ?? []) as Array<{ name: string; value: string; type?: string }>;
        const byName = Object.fromEntries(scope.map(s => [s.name, s]));

        assert(byName.kind?.value === 'hatchery.create_agent', `kind lost: ${JSON.stringify(scope)}`);
        assert(byName.memory_key?.value === 'news.ai.daily', `memory_key lost: ${JSON.stringify(scope)}`);
        assert(byName.app_id?.value === 'someone/news.html', `app_id lost: ${JSON.stringify(scope)}`);
        // `type` is required by the record and optional on the tool, so the seam defaults it rather
        // than refusing a task over a field a caller has no reason to think about.
        assert(byName.kind?.type === 'text', `an omitted type must default to text, got ${byName.kind?.type}`);
        assert(byName.memory_key?.type === 'memory_key', `an explicit type must survive, got ${byName.memory_key?.type}`);
    });

    await test('and it carries the same \'started\' event an owner-approved task would', async () => {
        const r = await json(`/v1/agents/${runner.agentName}/tasks/${runnerTaskId}/events`, {
            headers: { Authorization: `Bearer ${runner.ownerToken}` },
        });
        assert(r.status === 200, `read ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const events = (r.body.data.events ?? r.body.data ?? []) as Array<{ type: string; message?: string }>;
        const started = events.find(e => e.type === 'started');
        assert(!!started, `no 'started' event; events: ${JSON.stringify(events.map(e => e.type))}`);
        assert(/task-runner/i.test(started!.message ?? ''), `event message does not name the reason: ${started!.message}`);
    });

    // The positive control. Without it "the task was active" could just mean every task is active.
    await test('a task for an INTERACTIVE agent still waits for the owner', async () => {
        const r = await callTool(interactive.session, 'aimeat_task_create', {
            target_agent: interactive.agentName,
            title: 'Ask me first',
            description: 'This agent is not a task-runner, so the queued-then-approve gate stands.',
        });
        assert(!r.isError, `create failed: ${r.text.slice(0, 300)}`);
        const id = JSON.parse(r.text).task_id ?? JSON.parse(r.text).id;
        const got = await callTool(interactive.session, 'aimeat_task_get', { task_id: id });
        const task = JSON.parse(got.text).task ?? JSON.parse(got.text);
        assert(task.status === 'queued', `expected a queued task, got '${task.status}'`);
    });

    await test('the first plan is accepted on the active task', async () => {
        const r = await callTool(runner.session, 'aimeat_task_propose_todos', {
            task_id: runnerTaskId,
            todos: [
                { title: 'Read the brief', order: 1 },
                { title: 'Do the work', order: 2 },
            ],
        });
        assert(!r.isError, `first plan refused: ${r.text.slice(0, 300)}`);
    });

    // An event reports what THIS step cost, so the task total is the running sum — which is what the
    // HTTP door has always stored. The tool OVERWROTE the totals with the last event's numbers, so an
    // agent reporting one AI call per event finished a forty-call task showing one, and the cost view
    // read from that. Two events reporting one call each is the smallest case that tells the two
    // apart: accumulate gives 2, overwrite gives 1.
    await test('telemetry from repeated events accumulates rather than overwriting', async () => {
        const step = async (n: number) => {
            const r = await callTool(runner.session, 'aimeat_task_event', {
                task_id: runnerTaskId,
                type: 'progress',
                message: `step ${n} of the work`,
                details: { telemetry: { ai_calls: 1, tokens_in: 100, tokens_out: 10 } },
            });
            assert(!r.isError, `event ${n} refused: ${r.text.slice(0, 300)}`);
        };
        await step(1);
        await step(2);

        const got = await callTool(runner.session, 'aimeat_task_get', { task_id: runnerTaskId });
        const task = JSON.parse(got.text).task ?? JSON.parse(got.text);
        const tel = task.telemetry ?? {};
        assert(tel.aiCalls === 2, `two events at one AI call each should total 2: ${JSON.stringify(tel)}`);
        assert(tel.tokensIn === 200, `tokens in should total 200: ${JSON.stringify(tel)}`);
        assert(tel.tokensOut === 20, `tokens out should total 20: ${JSON.stringify(tel)}`);
    });

    // The HTTP door caps a title at 256 characters and a description at 10 000. The tool declared
    // both as a bare string, so the same node accepted over MCP what it refused over HTTP and a UI
    // built for the capped row had to render the oversized one.
    await test('an over-long title is refused here as it is over HTTP', async () => {
        const r = await callTool(runner.session, 'aimeat_task_create', {
            target_agent: runner.agentName,
            title: 'x'.repeat(300),
            description: 'The cap is the same cap the HTTP route applies.',
        });
        assert(r.isError, `a 300-character title was accepted: ${r.text.slice(0, 200)}`);
        assert(/INVALID_INPUT|title/i.test(r.text), `expected the input refusal, got: ${r.text.slice(0, 200)}`);
    });

    await test('a SECOND plan mid-run is refused, and the first plan survives intact', async () => {
        const before = await callTool(runner.session, 'aimeat_task_get', { task_id: runnerTaskId });
        const beforeTodos = (JSON.parse(before.text).task ?? JSON.parse(before.text)).todos as Array<{ title: string }>;
        assert(beforeTodos.length === 2, `expected the 2 planned todos, got ${beforeTodos.length}`);

        const r = await callTool(runner.session, 'aimeat_task_propose_todos', {
            task_id: runnerTaskId,
            todos: [{ title: 'Actually, start over', order: 1 }],
        });
        assert(r.isError, `the re-plan was allowed: ${r.text.slice(0, 300)}`);
        assert(/plan-less|live plan|current: active/i.test(r.text),
            `expected the live-plan refusal, got: ${r.text.slice(0, 300)}`);

        const after = await callTool(runner.session, 'aimeat_task_get', { task_id: runnerTaskId });
        const afterTodos = (JSON.parse(after.text).task ?? JSON.parse(after.text)).todos as Array<{ title: string }>;
        assert(afterTodos.length === 2, `the plan was replaced anyway: ${JSON.stringify(afterTodos.map(t => t.title))}`);
        assert(afterTodos[0].title === 'Read the brief', `the original plan is gone: ${JSON.stringify(afterTodos.map(t => t.title))}`);
    });

    // ── What a completion sets off ──────────────────────────────────────────────────────────────
    //
    // Completing a task writes one record and sets off eight other things: the workflow run that
    // dispatched it advances, the open item behind it closes, the agent's counters move, the
    // runner's live-trace key is reclaimed, the automation report is sent and its advisory outbox
    // drained. All eight lived inside the HTTP handler, so this tool answered "completed: true" and
    // nothing downstream of it happened — the worst shape a side effect can have, because the
    // answer looked right.
    //
    // The counters are what a plain session can observe, and they are the FIRST thing the shared
    // fan-out does. If the counter moved, the fan-out ran.
    await test("completing over MCP moves the agent's own counters, as the HTTP door does", async () => {
        const read = async () => {
            const r = await json(`/v1/agents/${runner.agentName}/activity?days=1`, {
                headers: { Authorization: `Bearer ${runner.ownerToken}` },
            });
            assert(r.status === 200, `activity read ${r.status}: ${JSON.stringify(r.body?.error)}`);
            return JSON.stringify(r.body?.data ?? {});
        };
        const before = await read();

        const done = await callTool(runner.session, 'aimeat_task_complete', {
            task_id: runnerTaskId, message: 'Finished, and the rest of the node should know.',
        });
        assert(!done.isError, `complete failed: ${done.text.slice(0, 300)}`);

        const after = await read();
        assert(after !== before,
            `the activity record did not change on completion; it read ${before.slice(0, 250)}`);
    });

    // ── Naming the deliverable ──────────────────────────────────────────────────────────────────
    //
    // `deliverable_key` is the pointer from a finished task to the record that IS the finished work.
    // It is what the owner's task card and the Offers inbox link to, and a record written with
    // visibility=public reaches the node's activity feed only when a completion names it. The HTTP
    // door has taken it since the field existed; the tool's parameter list was task_id, message and
    // the provenance block, so an agent working entirely over MCP published its result into silence
    // and every step reported success.
    await test('a deliverable named over MCP reaches the owner\'s inbox and the public feed', async () => {
        const stamp = Date.now();
        const key = `deliverables/mcp-task-${stamp}`;
        const title = `Publish the weekly digest ${stamp}`;

        const created = await callTool(runner.session, 'aimeat_task_create', {
            target_agent: runner.agentName, title,
            description: 'Write the digest, publish it, and name where you put it.',
        });
        assert(!created.isError, `create failed: ${created.text.slice(0, 300)}`);
        const taskId = JSON.parse(created.text).task_id;

        const wrote = await callTool(runner.session, 'aimeat_memory_write', {
            key, value: { digest: 'Three things happened this week.' }, visibility: 'public',
        });
        assert(!wrote.isError, `the deliverable could not be written: ${wrote.text.slice(0, 300)}`);

        const done = await callTool(runner.session, 'aimeat_task_complete', {
            task_id: taskId, message: 'Digest published.', deliverable_key: key,
        });
        assert(!done.isError, `complete failed: ${done.text.slice(0, 300)}`);
        assert(JSON.parse(done.text).deliverable_key === key,
            'the tool did not store the key it was given, so nothing on the task points at the work: '
            + done.text.replace(/\s+/g, ' ').slice(0, 220));

        // The owner's aggregate view of everything that came back. A null here is the visible half of
        // the drift: the work exists, and nothing on the task says where.
        const inbox = await json('/v1/deliverables', { headers: { Authorization: `Bearer ${runner.ownerToken}` } });
        assert(inbox.status === 200, `deliverables ${inbox.status}: ${JSON.stringify(inbox.body?.error)}`);
        const row = (inbox.body.data.deliverables as Array<{ task_id: string; deliverable_key: string | null }>)
            .find(d => d.task_id === taskId);
        assert(!!row, `the completed task is missing from the owner's inbox entirely`);
        assert(row!.deliverable_key === key,
            `the task carries no deliverable key, so the owner cannot reach the work: ${JSON.stringify(row)}`);

        // And the public feed. The fan-out posts it without waiting, so this polls rather than reads
        // once. The `limit` is unusual on purpose: the route caches per (category, limit) for ten
        // seconds, and a limit nothing else in this suite uses cannot be served a stale copy.
        let onFeed = false;
        for (let i = 0; i < 20 && !onFeed; i++) {
            const feed = await json(`/v1/public/activity-feed?category=agents&limit=${37 + i}`);
            onFeed = (feed.body?.data?.items ?? []).some((it: { summary?: string }) => (it.summary ?? '').includes(title));
            if (!onFeed) await new Promise(res => setTimeout(res, 250));
        }
        assert(onFeed, 'the public deliverable never reached the activity feed');
    });

    // ── Who wrote the message decides the label, not which door it came through ─────────────────
    //
    // The completion message is what the OWNER reads when they look at what their agent did, so an
    // agent's is stamped like any other text a model writes for a person. Only the MCP tool minted
    // that record; the same agent completing the same task over HTTP was recorded as having said
    // nothing about how the text was made. The stamp now lives in the shared completion, where
    // provenanceForWrite decides from the PRINCIPAL. That is why the owner's own completion below
    // must stay unstamped, and why that half is the control rather than an afterthought.
    await test('an AGENT completing over REST is stamped, exactly as it is over MCP', async () => {
        const created = await callTool(runner.session, 'aimeat_task_create', {
            target_agent: runner.agentName, title: 'Report through the HTTP door',
            description: 'Same agent, same act, other door.',
        });
        const taskId = JSON.parse(created.text).task_id;

        const done = await json(`/v1/agents/${runner.agentName}/tasks/${taskId}/complete`, {
            method: 'POST', headers: { Authorization: `Bearer ${runner.agentToken}` },
            body: JSON.stringify({ message: 'Done, and a model wrote this sentence.' }),
        });
        assert(done.status === 200, `complete over REST ${done.status}: ${JSON.stringify(done.body?.error)}`);

        const ev = await json(`/v1/agents/${runner.agentName}/tasks/${taskId}/events`, {
            headers: { Authorization: `Bearer ${runner.ownerToken}` },
        });
        const completed = (ev.body.data.events as Array<{ type: string; details?: Record<string, unknown> }>)
            .find(e => e.type === 'completed');
        assert(!!completed, `no 'completed' event was appended at all`);
        assert(typeof completed!.details?.aiProvenanceId === 'string',
            'the HTTP door recorded no provenance for a message an agent wrote, so the same act is '
            + `stated on one surface and silent on the other: ${JSON.stringify(completed)}`);
    });

    await test('...and a HUMAN owner completing the same way is not', async () => {
        const created = await callTool(interactive.session, 'aimeat_task_create', {
            target_agent: interactive.agentName, title: 'The owner finishes this one',
            description: 'A person writing their own words is not an AI write.',
        });
        const taskId = JSON.parse(created.text).task_id;
        const started = await json(`/v1/agents/${interactive.agentName}/tasks/${taskId}/start`, {
            method: 'POST', headers: { Authorization: `Bearer ${interactive.ownerToken}` },
        });
        assert(started.status === 200, `start ${started.status}: ${JSON.stringify(started.body?.error)}`);

        const done = await json(`/v1/agents/${interactive.agentName}/tasks/${taskId}/complete`, {
            method: 'POST', headers: { Authorization: `Bearer ${interactive.ownerToken}` },
            body: JSON.stringify({ message: 'I checked it myself and it is fine.' }),
        });
        assert(done.status === 200, `owner complete ${done.status}: ${JSON.stringify(done.body?.error)}`);

        const ev = await json(`/v1/agents/${interactive.agentName}/tasks/${taskId}/events`, {
            headers: { Authorization: `Bearer ${interactive.ownerToken}` },
        });
        const completed = (ev.body.data.events as Array<{ type: string; details?: Record<string, unknown> }>)
            .find(e => e.type === 'completed');
        assert(!!completed, `no 'completed' event was appended at all`);
        assert(completed!.details?.aiProvenanceId === undefined,
            'a person\'s own words were recorded as model-written, which is a false statement about '
            + `authorship: ${JSON.stringify(completed)}`);
    });

    await runStalledCase();

    console.log('\nCleanup');
    await json(`/v1/owners/${runner.owner}`, { method: 'DELETE', headers: { Authorization: `Bearer ${runner.ownerToken}` } });
    await json(`/v1/owners/${interactive.owner}`, { method: 'DELETE', headers: { Authorization: `Bearer ${interactive.ownerToken}` } });

    console.log(`\nMCP agent tasks: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    if (failed > 0) process.exit(1);
}

void run();
