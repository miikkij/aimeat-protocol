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
 *   The stall and readiness cases are not driven here: both need the stall detector's clock and a
 *   completed onboarding record at a low level, which e2e-agent-readiness already stands up. What
 *   this file proves is the two that a plain session reaches.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-agent-tasks
 * @version-history
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

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
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

interface Session { token: string; sessionId: string; nextId: number }

async function rpc(s: Session, method: string, params: Record<string, any> = {}) {
    const id = s.nextId++;
    const res = await fetch(`${BASE}/v1/mcp`, {
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

/** One owner, and an MCP session for an agent in the given mode. */
async function setup(label: string, mode: string) {
    const owner = `mtask${label}${Date.now()}`;
    const reg = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'McpTaskFlow1234' }) });
    let r = await reg();
    for (let i = 0; r.status === 429 && i < 8; i++) { await new Promise(res => setTimeout(res, 1500)); r = await reg(); }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);

    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    const ownerToken = tok.body.data.token as string;

    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: `ag${label}`, owner, capabilities: ['tasks'], model: 'gpt-4o', mode, scopes: ['*'] }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const agentGaii = ag.body.data.agent.gaii as string;
    const agentKey = ag.body.data.private_key as string;
    // There is no GET /v1/agents/:name to read the mode back, so the mode is proven by behaviour
    // instead: the task-runner's task must come out active and the interactive one queued. If the
    // mode had not taken, one of those two would fail.

    const client = await json('/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: `mcp tasks ${label}`, redirect_uris: [] }),
    });
    const ats = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii: agentGaii,
        signature: await sign(agentKey, agentGaii + NODE_ID + ats), timestamp: ats,
    });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    const token = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: auth.body.code,
            client_id: client.body.client_id, client_secret: client.body.client_secret,
        }),
    });
    assert(token.status === 200, `mcp token ${token.status}: ${JSON.stringify(token.body)}`);

    const session: Session = { token: token.body.access_token, sessionId: '', nextId: 1 };
    await rpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcp tasks e2e', version: '1.0.0' } });
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`, 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return { owner, ownerToken, agentGaii, agentName: `ag${label}`, session };
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

    console.log('\nCleanup');
    await json(`/v1/owners/${runner.owner}`, { method: 'DELETE', headers: { Authorization: `Bearer ${runner.ownerToken}` } });
    await json(`/v1/owners/${interactive.owner}`, { method: 'DELETE', headers: { Authorization: `Bearer ${interactive.ownerToken}` } });

    console.log(`\nMCP agent tasks: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    if (failed > 0) process.exit(1);
}

void run();
