/**
 * @file test/e2e-agent-v2-tasks.ts
 * @description Agent v2 V5: the handle a caller holds while work runs, in MCP's task shape.
 *
 *   THE STATE MAPPING IS ASSERTED, NOT ASSUMED. `cancelled` and `canceled` differ by one letter and
 *   `input_required` and `input-required` by one character, which is exactly the kind of difference
 *   that produces a border bug nobody sees. Every one of the eight A2A states this node can report
 *   is read off a real task here, including the three that are recovered from what sits beside the
 *   status: `submitted` from a task nobody started, `rejected` and `auth-required` from an error
 *   code.
 *
 *   THE RACE IS RUN, NOT DESCRIBED. A worker completing while the caller cancels is the reason the
 *   store's update is conditional, so the suite fires both at once and asserts that exactly one
 *   won and the other was told 409 rather than told nothing.
 *
 *   AND THE DASHBOARD TASKS ARE STILL THERE. /v1/agents/:name/tasks keeps its own store, its own
 *   statuses and its own answers, with no v2 task in it.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-v2-tasks
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the feature.
 */
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

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

async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const owner = `v5${label}${Date.now().toString(36)}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AgentV5Pass12345' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AgentV5Pass12345' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    return { owner, ownerToken: tok.body.data.token as string, ghii: `${owner}@${NODE_ID}` };
}

async function addAgent(owner: string, ownerToken: string, name: string) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner, capabilities: [], mode: 'interactive', scopes: ['*'] }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }),
    });
    return { name, gaii, token: tok.body.data.token as string };
}

async function run(): Promise<void> {
    console.log('\n🧪 Agent v2 V5 — the task handle, and the two names for its five states\n');

    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const authA = { Authorization: `Bearer ${a.ownerToken}` };
    const authB = { Authorization: `Bearer ${b.ownerToken}` };

    const caller = await addAgent(a.owner, a.ownerToken, 'caller');
    const worker = await addAgent(a.owner, a.ownerToken, 'worker');
    const stranger = await addAgent(b.owner, b.ownerToken, 'stranger');
    const authCaller = { Authorization: `Bearer ${caller.token}` };
    const authWorker = { Authorization: `Bearer ${worker.token}` };

    /** Ask for one piece of work, and hand back the handle. */
    async function ask(headers: Record<string, string>, assignedTo: string, text = 'Do the thing.', extra: Record<string, unknown> = {}) {
        const r = await json('/v1/agents/v2/tasks', {
            method: 'POST', headers,
            body: JSON.stringify({ assignedTo, input: [{ kind: 'text', text }], ...extra }),
        });
        assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body?.error)}`);
        return r.body.data.task as any;
    }

    let firstTaskId = '';
    let firstContextId = '';

    // ── 1. The handle ─────────────────────────────────────────────────────────

    await test('a new task is working, unstarted, and reports itself as submitted on A2A', async () => {
        const task = await ask(authCaller, worker.gaii, 'Summarise the draft.', { pollIntervalMs: 2000, ttlMs: 60_000 });
        firstTaskId = task.taskId;
        firstContextId = task.contextId;
        assert(task.status === 'working', `MCP has no queued status, so it starts working: got ${task.status}`);
        assert(task.startedAt === null, 'and nobody has picked it up');
        // The distinction A2A keeps and MCP does not, recovered from startedAt rather than stored.
        assert(task.a2a_state === 'submitted', `so A2A reads it as submitted, got ${task.a2a_state}`);
        assert(task.terminal === false, 'and it is not terminal');
        assert(task.contextId === task.taskId, 'a task with no context names itself');
        assert(task.pollIntervalMs === 2000 && task.ttlMs === 60_000, 'and the poll advice comes back');
    });

    await test('the assignee reporting progress is what turns submitted into working', async () => {
        const r = await json(`/v1/agents/v2/tasks/${firstTaskId}/status`, {
            method: 'POST', headers: authWorker,
            body: JSON.stringify({ status: 'working', statusMessage: 'Reading it now.' }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const t = r.body.data.task;
        assert(typeof t.startedAt === 'string', 'the first move sets startedAt');
        assert(t.a2a_state === 'working', `and A2A now reads working, got ${t.a2a_state}`);
        assert(t.statusMessage === 'Reading it now.', 'with the line a person reads');
    });

    await test('input_required is input-required on A2A, and auth-required when the code says so', async () => {
        const plain = await json(`/v1/agents/v2/tasks/${firstTaskId}/status`, {
            method: 'POST', headers: authWorker,
            body: JSON.stringify({ status: 'input_required', statusMessage: 'Which draft?' }),
        });
        assert(plain.status === 200, `expected 200, got ${plain.status}`);
        // One hyphen apart, which is the whole reason the two vocabularies are kept separate.
        assert(plain.body.data.task.a2a_state === 'input-required',
            `expected input-required, got ${plain.body.data.task.a2a_state}`);

        const authNeeded = await json(`/v1/agents/v2/tasks/${firstTaskId}/status`, {
            method: 'POST', headers: authWorker,
            body: JSON.stringify({ status: 'input_required', error: { code: 'AUTH_REQUIRED', message: 'Needs the mailbox connected.' } }),
        });
        assert(authNeeded.status === 200, `expected 200, got ${authNeeded.status}`);
        assert(authNeeded.body.data.task.a2a_state === 'auth-required',
            `expected auth-required, got ${authNeeded.body.data.task.a2a_state}`);
    });

    await test('completing needs a result, and the task settles', async () => {
        const noResult = await json(`/v1/agents/v2/tasks/${firstTaskId}/status`, {
            method: 'POST', headers: authWorker, body: JSON.stringify({ status: 'completed' }),
        });
        assert(noResult.status === 400, `completing empty-handed is refused, got ${noResult.status}`);
        assert((noResult.body.error.details.defects as any[]).some(d => d.field === 'result'),
            'and the refusal names the missing result');

        const done = await json(`/v1/agents/v2/tasks/${firstTaskId}/status`, {
            method: 'POST', headers: authWorker,
            body: JSON.stringify({ status: 'completed', result: [{ kind: 'text', text: 'Here is the summary.' }] }),
        });
        assert(done.status === 200, `expected 200, got ${done.status}: ${JSON.stringify(done.body?.error)}`);
        const t = done.body.data.task;
        assert(t.status === 'completed' && t.a2a_state === 'completed', 'both vocabularies agree here');
        assert(t.terminal === true, 'and it is terminal');
        assert(typeof t.completedAt === 'string', 'with the moment it settled');
        assert(t.result[0].text === 'Here is the summary.', 'and the result it came back with');
    });

    await test('a terminal task does not move again, whoever asks', async () => {
        const again = await json(`/v1/agents/v2/tasks/${firstTaskId}/status`, {
            method: 'POST', headers: authWorker,
            body: JSON.stringify({ status: 'working', statusMessage: 'Actually, one more thing.' }),
        });
        assert(again.status === 409, `expected 409, got ${again.status}`);
        const cancel = await json(`/v1/agents/v2/tasks/${firstTaskId}/cancel`, { method: 'POST', headers: authCaller });
        assert(cancel.status === 409, `and cancelling a finished task is 409 too, got ${cancel.status}`);
    });

    // ── 2. Failure, refusal and cancellation ──────────────────────────────────

    await test('failing needs a code and a message, and reads as failed on both protocols', async () => {
        const task = await ask(authCaller, worker.gaii, 'Something impossible.');
        const noError = await json(`/v1/agents/v2/tasks/${task.taskId}/status`, {
            method: 'POST', headers: authWorker, body: JSON.stringify({ status: 'failed' }),
        });
        assert(noError.status === 400, `failing with no reason is refused, got ${noError.status}`);

        const failed = await json(`/v1/agents/v2/tasks/${task.taskId}/status`, {
            method: 'POST', headers: authWorker,
            body: JSON.stringify({ status: 'failed', error: { code: 'NO_SOURCE', message: 'The draft is not where it said.' } }),
        });
        assert(failed.status === 200, `expected 200, got ${failed.status}`);
        assert(failed.body.data.task.a2a_state === 'failed', `expected failed, got ${failed.body.data.task.a2a_state}`);
    });

    await test('a refusal to start reads as rejected on A2A, which is failed here', async () => {
        const task = await ask(authCaller, worker.gaii, 'Not my job.');
        const r = await json(`/v1/agents/v2/tasks/${task.taskId}/status`, {
            method: 'POST', headers: authWorker,
            body: JSON.stringify({ status: 'failed', error: { code: 'REJECTED', message: 'Not something I do.' } }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.body.data.task.status === 'failed', 'MCP has one word for an end that did not work');
        assert(r.body.data.task.a2a_state === 'rejected', `and A2A has two, got ${r.body.data.task.a2a_state}`);
    });

    await test('cancelling is the caller\'s, and reads as canceled with one L', async () => {
        const task = await ask(authCaller, worker.gaii, 'Never mind this one.');
        const byWorker = await json(`/v1/agents/v2/tasks/${task.taskId}/cancel`, {
            method: 'POST', headers: authWorker, body: JSON.stringify({ reason: 'I would rather not.' }),
        });
        assert(byWorker.status === 403, `the assignee cannot cancel, got ${byWorker.status}`);
        assert(byWorker.body.error.message.toLowerCase().includes('failed'),
            'and is told what to do instead');

        const r = await json(`/v1/agents/v2/tasks/${task.taskId}/cancel`, {
            method: 'POST', headers: authCaller, body: JSON.stringify({ reason: 'Changed my mind.' }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.body.data.task.status === 'cancelled', 'MCP spells it with two');
        assert(r.body.data.task.a2a_state === 'canceled', `A2A spells it with one, got ${r.body.data.task.a2a_state}`);
        assert(r.body.data.task.statusMessage === 'Changed my mind.', 'and the reason is kept');
    });

    await test('the caller cannot write a status, which is the worker\'s testimony', async () => {
        const task = await ask(authCaller, worker.gaii);
        const r = await json(`/v1/agents/v2/tasks/${task.taskId}/status`, {
            method: 'POST', headers: authCaller,
            body: JSON.stringify({ status: 'completed', result: [{ kind: 'text', text: 'I say it is done.' }] }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('the account holder can do both, because the account is theirs', async () => {
        const task = await ask(authCaller, worker.gaii);
        const status = await json(`/v1/agents/v2/tasks/${task.taskId}/status`, {
            method: 'POST', headers: authA, body: JSON.stringify({ status: 'input_required', statusMessage: 'Owner stepped in.' }),
        });
        assert(status.status === 200, `owner status ${status.status}: ${JSON.stringify(status.body?.error)}`);
        const cancel = await json(`/v1/agents/v2/tasks/${task.taskId}/cancel`, { method: 'POST', headers: authA });
        assert(cancel.status === 200, `owner cancel ${cancel.status}`);
    });

    // ── 3. The race the conditional update exists for ─────────────────────────

    await test('a worker completing while the caller cancels: one wins, the other is told', async () => {
        const task = await ask(authCaller, worker.gaii, 'Race me.');
        const [complete, cancel] = await Promise.all([
            json(`/v1/agents/v2/tasks/${task.taskId}/status`, {
                method: 'POST', headers: authWorker,
                body: JSON.stringify({ status: 'completed', result: [{ kind: 'text', text: 'Done first.' }] }),
            }),
            json(`/v1/agents/v2/tasks/${task.taskId}/cancel`, { method: 'POST', headers: authCaller }),
        ]);
        const wins = [complete.status, cancel.status].filter(s => s === 200).length;
        const loses = [complete.status, cancel.status].filter(s => s === 409).length;
        assert(wins === 1 && loses === 1,
            `exactly one should win and one be told 409, got ${complete.status} and ${cancel.status}`);

        const after = await json(`/v1/agents/v2/tasks/${task.taskId}`, { headers: authA });
        const t = after.body.data.task;
        assert(t.terminal === true, 'the task settled');
        assert(t.status === (complete.status === 200 ? 'completed' : 'cancelled'),
            `and it settled as whichever call was told it had won, got ${t.status}`);
    });

    // ── 4. The roster ─────────────────────────────────────────────────────────

    await test('the roster narrows by assignee, caller, context and status', async () => {
        const open = await ask(authCaller, worker.gaii, 'Still open.', { contextId: firstContextId });

        const mine = await json(`/v1/agents/v2/tasks?assigned_to=${encodeURIComponent(worker.gaii)}&status=working`, { headers: authWorker });
        assert(mine.status === 200, `expected 200, got ${mine.status}`);
        const ids = (mine.body.data.tasks as any[]).map(t => t.taskId);
        assert(ids.includes(open.taskId), 'the open one is in the worker roster');
        assert((mine.body.data.tasks as any[]).every(t => t.status === 'working'), 'and nothing settled is');

        const byContext = await json(`/v1/agents/v2/tasks?context_id=${encodeURIComponent(firstContextId)}`, { headers: authA });
        assert((byContext.body.data.tasks as any[]).length >= 2, 'the exchange holds both tasks filed under it');

        const asked = await json(`/v1/agents/v2/tasks?created_by=${encodeURIComponent(caller.gaii)}`, { headers: authA });
        assert((asked.body.data.tasks as any[]).every(t => t.createdBy === caller.gaii), 'and the caller sees what it asked for');
    });

    await test('a status filter naming something that is not a status is refused, not ignored', async () => {
        // A filter that does not filter returns everything and reads as a working query, which is
        // how a roster loop silently starts picking up finished work.
        const r = await json('/v1/agents/v2/tasks?status=in_progress', { headers: authWorker });
        assert(r.status === 400, `expected 400, got ${r.status}`);
        assert(r.body.error.message.includes('in_progress'), 'and it says which word was wrong');
    });

    // ── 5. What it refuses across accounts ────────────────────────────────────

    await test('work cannot be given to a principal on another account', async () => {
        const r = await json('/v1/agents/v2/tasks', {
            method: 'POST', headers: authCaller,
            body: JSON.stringify({ assignedTo: stranger.gaii, input: [{ kind: 'text', text: 'hello' }] }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('another account cannot read, move or cancel this one\'s tasks', async () => {
        const read = await json(`/v1/agents/v2/tasks/${firstTaskId}`, { headers: authB });
        assert(read.status === 404, `expected 404, got ${read.status}`);
        const move = await json(`/v1/agents/v2/tasks/${firstTaskId}/status`, {
            method: 'POST', headers: authB, body: JSON.stringify({ status: 'working' }),
        });
        assert(move.status === 404, `expected 404, got ${move.status}`);
        const cancel = await json(`/v1/agents/v2/tasks/${firstTaskId}/cancel`, { method: 'POST', headers: authB });
        assert(cancel.status === 404, `expected 404, got ${cancel.status}`);
        const list = await json('/v1/agents/v2/tasks', { headers: authB });
        assert((list.body.data.tasks as any[]).length === 0, 'and the roster has nothing of ours in it');
    });

    // ── 6. The turns and the work are one thing ───────────────────────────────

    await test('a turn can be filed against a task, and a turn against a task that does not exist cannot', async () => {
        const task = await ask(authCaller, worker.gaii, 'Talk to me about this.');
        const turn = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authWorker,
            body: JSON.stringify({ to: caller.gaii, role: 'agent', taskId: task.taskId, contextId: task.contextId, parts: [{ kind: 'text', text: 'Started.' }] }),
        });
        assert(turn.status === 201, `expected 201, got ${turn.status}: ${JSON.stringify(turn.body?.error)}`);
        assert(turn.body.data.message.taskId === task.taskId, 'the turn carries the task');

        const read = await json(`/v1/agents/v2/messages?task_id=${encodeURIComponent(task.taskId)}`, { headers: authCaller });
        assert((read.body.data.messages as any[]).length === 1, 'and the task\'s turns read back by it');

        const ghost = await json('/v1/agents/v2/messages', {
            method: 'POST', headers: authWorker,
            body: JSON.stringify({ to: caller.gaii, taskId: 'a4d2b0e6-0000-4000-8000-000000000000', parts: [{ kind: 'text', text: 'x' }] }),
        });
        assert(ghost.status === 404, `a turn filed against nothing is refused, got ${ghost.status}`);
    });

    // ── 7. The dashboard tasks, unchanged ─────────────────────────────────────

    await test('the dashboard task store answers exactly what it answered, with no v2 task in it', async () => {
        const made = await json(`/v1/agents/${worker.name}/tasks`, {
            method: 'POST', headers: authA,
            body: JSON.stringify({ title: 'A dashboard task', description: 'The kind with a title and todos.' }),
        });
        assert(made.status === 200 || made.status === 201, `dashboard create ${made.status}: ${JSON.stringify(made.body?.error)}`);

        const list = await json(`/v1/agents/${worker.name}/tasks`, { headers: authA });
        assert(list.status === 200, `dashboard list ${list.status}`);
        const flat = JSON.stringify(list.body);
        assert(flat.includes('A dashboard task'), 'the dashboard task is in the dashboard store');
        assert(!flat.includes('Summarise the draft.'), 'and no v2 task has leaked into it');
        // The v2 statuses are not the dashboard's statuses either. If they had been folded into one
        // store, a dashboard reader would be seeing words its own UI has never had to render.
        assert(!flat.includes('input_required'), 'nor any v2 status word');
    });

    await test('and the v2 roster has no dashboard task in it', async () => {
        const r = await json('/v1/agents/v2/tasks?limit=200', { headers: authA });
        assert(!JSON.stringify(r.body).includes('A dashboard task'), 'two stores, two answers');
    });
}

run().then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
});
