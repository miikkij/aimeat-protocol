/**
 * @file e2e-agent-tasks.ts
 * @description E2E for the agent task surface: create, list, detail, start, complete, fail, todos,
 *   triage, buckets, search, and the live-trace reclaim that runs on completion.
 * @version-history
 *   v1.1.0 — 2026-08-17 — E2E quality, agent-tasks:325 and :359. One owner and one agent drove the
 *     whole file, so canAccessTask had only ever been asked about a principal it says yes to: 10e
 *     adds a second owner with its own agent, and 10f walks seven write doors as each of them and as
 *     an anonymous caller, against a fixture task of its own so a broken gate cannot take five later
 *     tests down with it. And 10d asserted that a deliverable survives the reclaim while writing it
 *     seventy lines AFTER the completion, so the sweep had run over a namespace that did not contain
 *     it; both records it now reads are seeded in 9f, before the completion, one of them another
 *     task's live key, which is what makes the assertion about the sweep's scope.
 *   v1.0.0 — pre-dates the header standard.
 */
// Run: cd aimeat && pnpm exec tsx test/e2e-agent-tasks.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any; headers: Headers }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        if (res.status === 429 && attempt < retries) {
            const retryAfter = Number(res.headers.get('Retry-After') || '5');
            await sleep(retryAfter * 1000 + 500);
            continue;
        }
        return { status: res.status, body, headers: res.headers };
    }
    throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent
        ? { gaii: ownerOrGaii, timestamp, signature }
        : { owner: ownerOrGaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// ─── State ───
const ownerName = `taskowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'taskbot';

let draftTaskId = '';
let queuedTaskId = '';
let failTaskId = '';

console.log('\n=== AIMEAT Agent Tasks E2E Test ===\n');

// ─── Setup ───
console.log('Setup -- Owner & Agent');

await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    ownerToken = await getToken(ownerName, ownerPrivKey, false);
});

await test('Register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['memory', 'actions'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    assert(typeof agentPrivKey === 'string', 'got agent private key');
});

await test('Agent auth token', async () => {
    agentToken = await getToken(agentGaii, agentPrivKey, true);
    assert(typeof agentToken === 'string' && agentToken.length > 0, 'got agent token');
});

// ─── Phase 1: Create tasks ───
console.log('\nPhase 1 -- Create Tasks');

await test('1. Create draft task', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Draft Task',
            description: 'A task in draft status',
            todos: [
                { id: 'todo-1', order: 1, title: 'Step 1', environment: 'agent', verification: 'check output' },
                { id: 'todo-2', order: 2, title: 'Step 2', environment: 'aimeat', verification: 'check data' },
            ],
            status: 'draft',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.title === 'Draft Task', `title: ${body.data.task.title}`);
    assert(body.data.task.status === 'draft', `status: ${body.data.task.status}`);
    assert(body.data.task.todos.length === 2, `todos: ${body.data.task.todos.length}`);
    draftTaskId = body.data.task.id;
});

await test('2. Create queued task', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Queued Task',
            description: 'A task ready to be picked up',
            scope: [{ name: 'target_url', value: 'https://example.com', type: 'url' }],
            rules: ['Rule 1', 'Rule 2'],
            verification: {
                user_expects: 'Data should be fetched',
                technical_checks: ['check-1', 'check-2'],
            },
            todos: [
                { id: 'qt-1', order: 1, title: 'Fetch data', environment: 'agent', verification: 'data returned' },
                { id: 'qt-2', order: 2, title: 'Store results', environment: 'aimeat', verification: 'memory updated' },
            ],
            status: 'queued',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'queued', `status: ${body.data.task.status}`);
    queuedTaskId = body.data.task.id;
});

// ─── Phase 2: List & Get ───
console.log('\nPhase 2 -- List & Get');

await test('3. List tasks by agent', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.tasks.length >= 2, `tasks count: ${body.data.tasks.length}`);
    assert(typeof body.data.total === 'number', 'has total');
});

await test('4. List tasks filtered by status', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks?status=queued`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.tasks.length >= 1, `queued tasks: ${body.data.tasks.length}`);
    assert(body.data.tasks.every((t: any) => t.status === 'queued'), 'all tasks are queued');
});

await test('5. Get task detail', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.id === queuedTaskId, `id: ${body.data.task.id}`);
    assert(body.data.task.todos.length === 2, `todos: ${body.data.task.todos.length}`);
    assert(body.data.task.scope.length === 1, `scope: ${body.data.task.scope.length}`);
    assert(body.data.task.rules.length === 2, `rules: ${body.data.task.rules.length}`);
});

// ─── Phase 3: Lifecycle ───
console.log('\nPhase 3 -- Task Lifecycle');

await test('6. Start task (queued -> active)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'active', `status: ${body.data.task.status}`);
});

await test('7. Append progress event', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}/event`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            type: 'progress',
            message: 'Working on step 1',
            details: { percent: 50 },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.event.type === 'progress', `type: ${body.data.event.type}`);
    assert(body.data.event.message === 'Working on step 1', `message: ${body.data.event.message}`);
});

await test('8. List events', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}/events`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    // Should have at least 2 events: 'started' from step 6 + 'progress' from step 7
    assert(body.data.events.length >= 2, `events count: ${body.data.events.length}`);
    assert(typeof body.data.total === 'number', 'has total');
});

await test('9. Update TODO status', async () => {
    // Fetch the task to get current todos
    const { body: getBody } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const todos = getBody.data.task.todos;
    // Mark first todo as done
    todos[0].status = 'done';
    todos[0].completed_at = new Date().toISOString();

    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ todos }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const updatedTodo = body.data.task.todos.find((t: any) => t.id === 'qt-1');
    assert(updatedTodo.status === 'done', `todo status: ${updatedTodo.status}`);
});

await test('9b. Update single todo via /todos/:todoId endpoint', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}/todos/qt-2`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ status: 'done' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const updatedTodo = body.data.todo;
    assert(updatedTodo.status === 'done', `todo status: ${updatedTodo.status}`);
    assert(typeof updatedTodo.completedAt === 'string', 'auto-set completedAt');
    // Verify full task returned too
    assert(body.data.task.todos.every((t: any) => t.status === 'done'), 'all todos now done');
});

await test('9c. Individual todo update rejects non-active tasks', async () => {
    // draftTaskId is still in draft status - should get 404 since we deleted it, let's use a queued one
    // Create a fresh queued task for this test
    const { body: createBody } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Queued for todo test',
            todos: [{ id: 'x-1', order: 1, title: 'Step', environment: 'agent' }],
            status: 'queued',
        }),
    });
    const testId = createBody.data.task.id;
    const { status } = await json(`/v1/agents/${agentName}/tasks/${testId}/todos/x-1`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ status: 'done' }),
    });
    assert(status === 409, `expected 409, got ${status}`);
    // Cleanup: delete it
    await json(`/v1/agents/${agentName}/tasks/${testId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
});

await test('9d. Individual todo update rejects nonexistent todoId', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}/todos/nonexistent`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ status: 'done' }),
    });
    assert(status === 404, `expected 404, got ${status}`);
});

// The runner writes a live-progress record while a task runs. Seeded here so test 10c can prove
// completion reclaims it (memory-key-shape audit: 991 of these had accumulated on aimeat.io, one
// per finished task, none ever removed).
const liveKeyForComplete = `agents.${agentName}.tasks.${queuedTaskId}.live`;

await test('9e. Agent writes a live-progress record while the task runs', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            key: liveKeyForComplete,
            value: { state: 'running', phase: 'step 1', elapsed_s: 12 },
            visibility: 'owner',
        }),
    });
    assert([200, 201].includes(status), `seed live key: ${status}: ${JSON.stringify(body)}`);
});

/**
 * The two records the reclaim must NOT eat, written HERE rather than after the completion.
 *
 * 10d used to write the deliverable seventy lines after the completion it claims the deliverable
 * survived, so the reclaim had swept a namespace that did not contain it yet and the assertion was
 * true of a record that had never been at risk. A prefix-scoped sweep can only be proven by records
 * that existed when it ran.
 *
 * Two of them: the deliverable, which sits outside the task prefix entirely, and a live key of a
 * DIFFERENT task, which sits under the same agent and the same shape and must survive because the
 * sweep is scoped to one task id.
 */
const otherTaskLiveKey = `agents.${agentName}.tasks.other-${Date.now()}.live`;

await test('9f. …and two records that the completion must leave alone', async () => {
    const deliverable = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'agents.dirbot.report', value: { body: 'the deliverable' }, visibility: 'owner' }),
    });
    assert([200, 201].includes(deliverable.status), `seed deliverable: ${deliverable.status}`);
    const otherTask = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: otherTaskLiveKey, value: { state: 'running' }, visibility: 'owner' }),
    });
    assert([200, 201].includes(otherTask.status), `seed the other task's live key: ${otherTask.status}`);
});

await test('10. Complete task (active -> done) with deliverable_key', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ message: 'All steps finished successfully', deliverable_key: 'agents.dirbot.report' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'done', `status: ${body.data.task.status}`);
    assert(typeof body.data.task.completedAt === 'string', 'has completedAt');
    assert(body.data.task.deliverableKey === 'agents.dirbot.report', `deliverableKey: ${body.data.task.deliverableKey}`);
});

await test('10b. deliverableKey persists on subsequent reads', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.task.deliverableKey === 'agents.dirbot.report', `deliverableKey after read: ${body.data.task.deliverableKey}`);
});

await test('10b2. THE ANSWER IS READABLE: a finished task reports what it produced', async () => {
    // Reported by crewaimeat-dev against a real run: a task-runner worked for 104 seconds, the task
    // went to `done`, and the answer could not be read back from anywhere. The completion MESSAGE
    // was written to the 'completed' event and nowhere else, and the deliverable pointer was on the
    // record but never returned — so the caller saw `status: "done"` and had to already know that a
    // second, differently-shaped endpoint existed before it could find out what happened.
    // A finished task whose result nobody can reach is indistinguishable from one that produced
    // nothing.
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    const outcome = body.data.outcome;
    assert(outcome, `no outcome on a done task: ${JSON.stringify(Object.keys(body.data))}`);
    assert(outcome.state === 'done', `state: ${outcome.state}`);
    // The agent's own sentence, on the same read as the status.
    assert(outcome.message === 'All steps finished successfully', `message: ${JSON.stringify(outcome.message)}`);
    assert(outcome.deliverable_key === 'agents.dirbot.report', `deliverable_key: ${outcome.deliverable_key}`);
    // An ADDRESS, not the content: a deliverable may be megabytes, and a task read that inlined it
    // would make every listing as expensive as its largest output.
    assert(outcome.deliverable_url?.includes('agents.dirbot.report'), `deliverable_url: ${outcome.deliverable_url}`);
    assert(typeof outcome.at === 'string', 'and when it happened');
});

await test('10b3. A task still running reports NO outcome, rather than an empty one', async () => {
    // An unfinished task has no outcome. Reporting an empty one would read as "finished with
    // nothing", which is the opposite of true.
    const created = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'Still going', description: 'not finished' }),
    });
    const id = created.body.data.task.id;
    const { body } = await json(`/v1/agents/${agentName}/tasks/${id}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.data.outcome === undefined, `a running task reported an outcome: ${JSON.stringify(body.data.outcome)}`);
});

await test('10c. Completing the task reclaims the live-progress record', async () => {
    // The reclaim is fired after the response (best-effort, must never fail a completion), so poll
    // rather than assume it has landed by the time /complete returned.
    let status = 0;
    for (let i = 0; i < 20; i++) {
        ({ status } = await json(`/v1/memory/${encodeURIComponent(liveKeyForComplete)}`, {
            headers: { Authorization: `Bearer ${agentToken}` },
        }));
        if (status === 404) break;
        await sleep(100);
    }
    assert(status === 404, `live key should be reclaimed on completion: got ${status}`);
});

/**
 * ONE OWNER AND ONE AGENT DRIVE THIS ENTIRE FILE. The two 403s it already has are state gates under
 * that same owner (request-changes is owner-only; an agent cannot release its own draft), not
 * identity gates. So canAccessTask, which every write and lifecycle door calls, has only ever been
 * asked about a principal it says yes to.
 *
 * Behind those doors: completing or failing another owner's task fans out into their workflows,
 * their counters and a publicly readable deliverable, under their name.
 */
const otherOwnerName = `taskother${Date.now()}`;
let otherOwnerToken = '';
let otherAgentToken = '';

await test('10e. A second owner and its own agent exist', async () => {
    const reg = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: otherOwnerName, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `register owner B: ${reg.status}: ${JSON.stringify(reg.body)}`);
    otherOwnerToken = await getToken(otherOwnerName, reg.body.data.private_key, false);

    const ag = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
        body: JSON.stringify({ name: 'otherbot', owner: otherOwnerName, capabilities: ['memory', 'actions'] }),
    });
    assert(ag.status === 201, `register B's agent: ${ag.status}: ${JSON.stringify(ag.body.error)}`);
    otherAgentToken = await getToken(ag.body.data.agent.gaii, ag.body.data.private_key, true);
});

await test('10f. Owner B and B\'s agent are refused every write door on A\'s task, and no credential too', async () => {
    // A task of its own, created for this case. The doors under test include DELETE and complete, so
    // aiming them at a task the rest of the file depends on would take five later tests down with it
    // whenever the gate is broken, and the redness would then say nothing about which hole it found.
    // A fresh queued task also means `complete` would really complete rather than answer 409.
    const created = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'Denial fixture', description: 'Only the refusals touch this one', status: 'queued' }),
    });
    assert(created.status === 201 || created.status === 200, `create the fixture task: ${created.status}`);
    const fixtureTaskId = created.body.data.task.id as string;
    // Started, so that complete and fail are state-valid: a queued task answers 409 on those doors
    // whoever asks, and a refusal that would have happened anyway proves nothing about identity.
    const started = await json(`/v1/agents/${agentName}/tasks/${fixtureTaskId}/start`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({}),
    });
    assert(started.status === 200, `start the fixture task: ${started.status}: ${JSON.stringify(started.body.error)}`);

    const before = await json(`/v1/agents/${agentName}/tasks/${fixtureTaskId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(before.status === 200, `read A's task: ${before.status}`);
    const statusBefore = before.body.data.task.status;
    const completedBefore = before.body.data.task.completedAt;

    const doors: Array<{ label: string; method: string; suffix: string; body?: unknown }> = [
        { label: 'complete', method: 'POST', suffix: '/complete', body: { message: 'hijacked' } },
        { label: 'fail', method: 'POST', suffix: '/fail', body: { error: 'hijacked' } },
        { label: 'event', method: 'POST', suffix: '/event', body: { type: 'progress', message: 'hijacked' } },
        { label: 'patch', method: 'PATCH', suffix: '', body: { title: 'hijacked' } },
        { label: 'rate', method: 'POST', suffix: '/rate', body: { rating: 1, comment: 'hijacked' } },
        { label: 'triage', method: 'PATCH', suffix: '/triage', body: { priority: 'low' } },
        { label: 'delete', method: 'DELETE', suffix: '' },
    ];

    const call = (token: string | null, d: typeof doors[number]) => json(
        `/v1/agents/${agentName}/tasks/${fixtureTaskId}${d.suffix}`,
        {
            method: d.method,
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
            ...(d.body ? { body: JSON.stringify(d.body) } : {}),
        },
    );

    const refused: string[] = [];
    for (const d of doors) {
        const asOwnerB = await call(otherOwnerToken, d);
        if (asOwnerB.status !== 403) refused.push(`owner B ${d.label} → ${asOwnerB.status}`);
        const asAgentB = await call(otherAgentToken, d);
        // The agent arm answers 403 on the doors that gate on the task, and 403 on the owner-only
        // ones too, so both are the same expectation here.
        if (asAgentB.status !== 403) refused.push(`B's agent ${d.label} → ${asAgentB.status}`);
        const anon = await call(null, d);
        if (anon.status !== 401) refused.push(`no credential ${d.label} → ${anon.status}`);
    }
    assert(refused.length === 0, `these doors did not refuse a stranger: ${refused.join(', ')}`);

    // A 403 that had already written would still be a defect, so the task is read back.
    const after = await json(`/v1/agents/${agentName}/tasks/${fixtureTaskId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(after.status === 200, `the task must still exist: ${after.status}`);
    assert(after.body.data.task.status === statusBefore,
        `the task's status moved: ${statusBefore} → ${after.body.data.task.status}`);
    assert(after.body.data.task.completedAt === completedBefore, 'the completion stamp moved');
    assert(after.body.data.task.title !== 'hijacked', 'the title was rewritten by a refused call');
});

await test('10d. Completing does NOT touch the deliverable, nor another task\'s live key', async () => {
    // Both records were written in 9f, BEFORE the completion, so the reclaim ran with them in place.
    // 10c has already proven the sweep happened (this task's own live key is 404), which is what
    // makes these two reads a statement about its scope rather than about its existence.
    const deliverable = await json(`/v1/memory/${encodeURIComponent('agents.dirbot.report')}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(deliverable.status === 200, `the deliverable must survive completion: got ${deliverable.status}`);

    const other = await json(`/v1/memory/${encodeURIComponent(otherTaskLiveKey)}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(other.status === 200, `another task's live key must survive: got ${other.status}`);
});

// ─── Phase 4: Fail scenario ───
console.log('\nPhase 4 -- Fail Task');

await test('11. Fail task', async () => {
    // Create another queued task, start it, then fail it
    const { body: createBody } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Task To Fail',
            description: 'Will be failed',
            todos: [{ id: 'f-1', order: 1, title: 'Step', environment: 'agent', verification: 'check' }],
            status: 'queued',
        }),
    });
    failTaskId = createBody.data.task.id;

    // Start it
    await json(`/v1/agents/${agentName}/tasks/${failTaskId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });

    // Fail it
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${failTaskId}/fail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ message: 'External API unavailable' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'failed', `status: ${body.data.task.status}`);
    assert(typeof body.data.task.completedAt === 'string', 'has completedAt');
});

await test('11b. FAILING a task keeps the live-progress record (it is the diagnosis)', async () => {
    // Deliberate asymmetry: on 'done' the record says what a finished task already reports, so it is
    // reclaimed; on 'failed' it is the last thing the agent said before it died, and the event log
    // does not carry the phase/elapsed detail. Deleting it there would cost the only evidence.
    const { body: created } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Task whose failure must stay diagnosable',
            description: 'Fails after writing progress',
            todos: [{ id: 'd-1', order: 1, title: 'Step', environment: 'agent', verification: 'check' }],
            status: 'queued',
        }),
    });
    const id = created.data.task.id;
    const liveKey = `agents.${agentName}.tasks.${id}.live`;

    await json(`/v1/agents/${agentName}/tasks/${id}/start`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const seed = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: liveKey, value: { state: 'running', phase: 'calling the API' }, visibility: 'owner' }),
    });
    assert([200, 201].includes(seed.status), `seed live key: ${seed.status}`);

    const failed = await json(`/v1/agents/${agentName}/tasks/${id}/fail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ message: 'External API unavailable' }),
    });
    assert(failed.status === 200, `fail: ${failed.status}`);

    await sleep(400);
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(liveKey)}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `live key must survive a FAILURE: got ${status}`);
    assert(body.data.value.phase === 'calling the API', 'the diagnosis is intact');

    // Cleanup: deleting the task sweeps the record (lifecycle.ts already did this).
    await json(`/v1/agents/${agentName}/tasks/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` },
    });
});

// ─── Phase 5: Delete ───
console.log('\nPhase 5 -- Delete');

await test('12. Delete draft task', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${draftTaskId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.deleted === true, 'deleted should be true');
});

await test('13. Active task cannot be deleted (409); pausing then deleting works', async () => {
    // Create a queued task and start it so it is 'active'.
    const { body: createBody } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Active task to protect',
            todos: [{ id: 'a-1', order: 1, title: 'Step', environment: 'agent' }],
            status: 'queued',
        }),
    });
    const activeId = createBody.data.task.id;
    await json(`/v1/agents/${agentName}/tasks/${activeId}/start`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    });

    // Deleting a running task must be refused.
    const refused = await json(`/v1/agents/${agentName}/tasks/${activeId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(refused.status === 409, `active delete: expected 409, got ${refused.status}`);

    // Pause it (active -> paused); a non-active task IS deletable.
    await json(`/v1/agents/${agentName}/tasks/${activeId}/pause`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const ok = await json(`/v1/agents/${agentName}/tasks/${activeId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(ok.status === 200, `paused delete: expected 200, got ${ok.status}: ${JSON.stringify(ok.body)}`);
    assert(ok.body.data.deleted === true, 'deleted should be true');
});

await test('13b. Deleting a failed task removes it and cleans operational traces', async () => {
    // failTaskId is in 'failed' state (Phase 4). Seed the two operational traces
    // that a deleted task would otherwise leave behind for the runner/UI:
    //   - the agent's live-status key (agent namespace)
    //   - the owner's cancel marker (owner GHII namespace) the daemon scans
    const liveKey = `agents.${agentName}.tasks.${failTaskId}.live`;
    const cancelKey = `agents.cancel.task.${failTaskId}`;

    const liveWrite = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: liveKey, value: { state: 'failed' }, visibility: 'owner' }),
    });
    assert([200, 201].includes(liveWrite.status), `seed live key: ${liveWrite.status}: ${JSON.stringify(liveWrite.body)}`);

    const cancelWrite = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: cancelKey, value: [failTaskId], visibility: 'owner' }),
    });
    assert([200, 201].includes(cancelWrite.status), `seed cancel marker: ${cancelWrite.status}: ${JSON.stringify(cancelWrite.body)}`);

    // Delete the failed task.
    const del = await json(`/v1/agents/${agentName}/tasks/${failTaskId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(del.status === 200, `delete failed task: expected 200, got ${del.status}: ${JSON.stringify(del.body)}`);

    // The task itself is gone.
    const gone = await json(`/v1/agents/${agentName}/tasks/${failTaskId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(gone.status === 404, `task should be gone: got ${gone.status}`);

    // The agent's live-status key was cleaned (agent namespace).
    const liveGone = await json(`/v1/memory/${encodeURIComponent(liveKey)}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(liveGone.status === 404, `live key should be cleaned: got ${liveGone.status}`);

    // The owner's cancel marker was cleaned (owner namespace).
    const cancelGone = await json(`/v1/memory/${encodeURIComponent(cancelKey)}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(cancelGone.status === 404, `cancel marker should be cleaned: got ${cancelGone.status}`);
});

// ─── Phase 6: Integration endpoints ───
console.log('\nPhase 6 -- Integration Endpoints');

await test('14. Inbox endpoint', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.queued_tasks), 'has queued_tasks array');
    assert(Array.isArray(body.data.active_tasks), 'has active_tasks array');
});

await test('15. Integration kit', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/integration-kit`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.kit === 'object', 'has kit object');
    assert(body.data.kit.agent_name === agentName, `agent_name: ${body.data.kit.agent_name}`);
    assert(typeof body.data.kit.watchdog_spec === 'object', 'has watchdog_spec');
    assert(typeof body.data.kit.error_protocol === 'object', 'has error_protocol');
});

// ─── Phase 7: Revision lifecycle (since 1.14.5) ───
console.log('\nPhase 7 -- Revision Lifecycle');

let revisionTaskId = '';
await test('16. Setup: owner creates a queued task with no todos', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Revision flow task',
            description: 'Owner will request changes mid-flow.',
            status: 'queued',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    revisionTaskId = body.data.task.id;
});

await test('17. Agent proposes initial TODO plan via /propose-todos', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${revisionTaskId}/propose-todos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            todos: [
                { title: 'Fetch source data', verification: 'has data' },
                { title: 'Summarise findings', verification: 'has summary' },
            ],
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'queued', `status: ${body.data.task.status}`);
    assert(body.data.task.todos.length === 2, `todo count: ${body.data.task.todos.length}`);
    assert(body.data.task.todos.every((t: any) => t.status === 'pending'), 'all proposed pending');
});

await test('18. Owner requests changes -> status revision_requested + todos outdated', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${revisionTaskId}/request-changes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ message: 'Add a verification step at the end and skip the summary.' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'revision_requested', `status: ${body.data.task.status}`);
    assert(body.data.task.todos.every((t: any) => t.status === 'outdated'), 'all todos outdated');
    assert(body.data.message && body.data.message.linkedTaskId === revisionTaskId, 'linked message stored');
});

await test('19. Request changes rejected when task has no pending todos', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks/${revisionTaskId}/request-changes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ message: 'Try again.' }),
    });
    assert(status === 409, `expected 409 (status is revision_requested), got ${status}`);
});

await test('20. Request changes is owner-only (agent gets 403)', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks/${revisionTaskId}/request-changes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ message: 'Cannot self-request.' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('21. Agent re-proposes -> status back to queued, outdated kept, new pending appended', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${revisionTaskId}/propose-todos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            todos: [
                { title: 'Fetch source data', verification: 'has data' },
                { title: 'Run verification checks', verification: 'all checks pass' },
            ],
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'queued', `status: ${body.data.task.status}`);
    const todos = body.data.task.todos;
    const outdated = todos.filter((t: any) => t.status === 'outdated');
    const pending = todos.filter((t: any) => t.status === 'pending');
    assert(outdated.length === 2, `outdated count: ${outdated.length}`);
    assert(pending.length === 2, `pending count: ${pending.length}`);
});

await test('22. Owner can /start the revised plan', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${revisionTaskId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'active', `status: ${body.data.task.status}`);
});

await test('22b. Propose-todos still 409s on an active task WITH a live plan (mid-execution guard)', async () => {
    // Plan-less active tasks (auto-activated at create) accept a FIRST proposal, but an active
    // task that already has non-outdated todos is mid-execution -- re-proposal must go via PATCH.
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${revisionTaskId}/propose-todos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ todos: [{ title: 'Sneaky mid-execution replan', verification: 'never' }] }),
    });
    assert(status === 409, `expected 409 on active task with a live plan, got ${status}: ${JSON.stringify(body)}`);
});

await test('23. Revision_requested event was logged with owner message', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${revisionTaskId}/events`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const revEvent = body.data.events.find((e: any) => e.type === 'revision_requested');
    assert(revEvent, 'revision_requested event present');
    assert(revEvent.message.includes('verification step'), `event message: ${revEvent.message}`);
});

// ─── Phase 8: Runner concurrency config ───
console.log('\nPhase 8 -- Concurrency config');

await test('24. max_concurrent_tasks defaults to 1', async () => {
    const { status, body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `status ${status}`);
    const a = body.data.agents.find((x: any) => x.name === agentName);
    assert(a, 'agent present in list');
    assert(a.max_concurrent_tasks === 1, `default should be 1, got ${a.max_concurrent_tasks}`);
});

await test('25. PATCH max-concurrent-tasks to 3', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/max-concurrent-tasks`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ max_concurrent_tasks: 3 }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.max_concurrent_tasks === 3, `value: ${body.data.max_concurrent_tasks}`);
});

await test('26. Integration kit exposes max_concurrent_tasks', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/integration-kit`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.kit.watchdog_spec.max_concurrent_tasks === 3,
        `kit value: ${body.data.kit.watchdog_spec.max_concurrent_tasks}`);
});

await test('27. Invalid max_concurrent_tasks rejected (0 and 99)', async () => {
    const lo = await json(`/v1/agents/${agentName}/max-concurrent-tasks`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ max_concurrent_tasks: 0 }),
    });
    assert(lo.status === 400, `expected 400 for 0, got ${lo.status}`);
    const hi = await json(`/v1/agents/${agentName}/max-concurrent-tasks`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ max_concurrent_tasks: 99 }),
    });
    assert(hi.status === 400, `expected 400 for 99, got ${hi.status}`);
});

// ─── Phase 9: Triage buckets & search ───
console.log('\nPhase 9 -- Triage buckets & search');

await test('28. Done task sits in Recent bucket; list returns bucket counts', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks?bucket=recent`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.counts && typeof body.data.counts.recent === 'number', 'has counts');
    assert(body.data.tasks.some((t: any) => t.id === queuedTaskId), 'completed task is in Recent');
});

await test('29. Keep moves the task to the Keep bucket', async () => {
    const r = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}/triage`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ triage: 'kept' }),
    });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.task.triage === 'kept', `triage: ${r.body.data.task.triage}`);
    const keep = await json(`/v1/agents/${agentName}/tasks?bucket=keep`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(keep.body.data.tasks.some((t: any) => t.id === queuedTaskId), 'in Keep bucket');
    assert(keep.body.data.counts.keep >= 1, `counts.keep: ${keep.body.data.counts.keep}`);
    const recent = await json(`/v1/agents/${agentName}/tasks?bucket=recent`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(!recent.body.data.tasks.some((t: any) => t.id === queuedTaskId), 'no longer in Recent');
});

await test('30. Archive moves the task to the Archive bucket', async () => {
    const r = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}/triage`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ triage: 'archived' }),
    });
    assert(r.status === 200, `status ${r.status}`);
    const arch = await json(`/v1/agents/${agentName}/tasks?bucket=archive`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(arch.body.data.tasks.some((t: any) => t.id === queuedTaskId), 'in Archive bucket');
});

await test('31. Restore (null) returns the task to Recent', async () => {
    const r = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}/triage`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ triage: null }),
    });
    assert(r.status === 200, `status ${r.status}`);
    assert(!r.body.data.task.triage, `triage cleared: ${r.body.data.task.triage}`);
    const recent = await json(`/v1/agents/${agentName}/tasks?bucket=recent`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(recent.body.data.tasks.some((t: any) => t.id === queuedTaskId), 'back in Recent');
});

await test('32. Search q filters by title/description', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks?q=Queued`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.tasks.length > 0, 'q returned results');
    assert(body.data.tasks.every((t: any) => `${t.title} ${t.description}`.toLowerCase().includes('queued')), 'all results match q');
});

await test('33. Triage rejects an invalid value (400)', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}/triage`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ triage: 'bogus' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

// ─── Phase: one live commission per (agent, fingerprint) ───
// The browser guard cannot see across a reload or a second tab; these are exactly those cases,
// where every duplicate would be a second agent run the owner pays for.
console.log('\nPhase 9 -- Commission dedupe');

const dedupeBody = {
    title: 'Summarise the week',
    description: 'Read this week entries and write one summary',
    status: 'queued' as const,
};
let firstDedupeId = '';

await test('34. First commission is created (201)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify(dedupeBody),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(!body.data.deduplicated, 'a first commission is not a duplicate');
    firstDedupeId = body.data.task.id;
});

await test('35. Identical commission returns the SAME task, not a second run (200)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify(dedupeBody),
    });
    assert(status === 200, `expected 200 (nothing created), got ${status}`);
    assert(body.data.deduplicated === true, 'response says deduplicated');
    assert(body.data.task.id === firstDedupeId, `same task: ${body.data.task.id} vs ${firstDedupeId}`);
    assert(body.data.existing_task_id === firstDedupeId, 'existing_task_id points at the open run');
    assert(typeof body.data.deduplicated_reason === 'string' && body.data.deduplicated_reason.length > 0,
        'carries a reason the UI can show');
});

await test('36. Whitespace/case noise is still the same commission', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ ...dedupeBody, title: '  Summarise   the WEEK ' }),
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.data.task.id === firstDedupeId, 'normalised to the same fingerprint');
});

await test('37. Five rapid identical commissions produce ONE task', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ ...dedupeBody, title: 'Race the guard' }),
    })));
    const ids = new Set(results.map(r => r.body?.data?.task?.id));
    assert(ids.size === 1, `expected 1 task from 5 clicks, got ${ids.size}: ${[...ids].join(', ')}`);
    const created = results.filter(r => r.status === 201).length;
    assert(created === 1, `exactly one 201, got ${created}`);
});

await test('38. A different job is not blocked', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ ...dedupeBody, description: 'A genuinely different job' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.id !== firstDedupeId, 'a new task');
});

await test('39. allow_duplicate commissions it again on purpose', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ ...dedupeBody, allow_duplicate: true }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.id !== firstDedupeId, 'a second, deliberate run');
});

await test('40. idempotency_key names the job even when the text differs', async () => {
    const first = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'Order 1', description: 'first wording', idempotency_key: 'order-4711' }),
    });
    assert(first.status === 201, `first: ${first.status}`);
    const second = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'Order 1 again', description: 'different wording', idempotency_key: 'order-4711' }),
    });
    assert(second.status === 200, `expected 200, got ${second.status}`);
    assert(second.body.data.task.id === first.body.data.task.id, 'same key, same task');
});

await test('41. The platform Idempotency-Key header still replays (no second task)', async () => {
    // A different, older mechanism (middleware/idempotency.ts): a UUID key replays the whole first
    // response for 24h. It must keep working on this route — and it must not create a second run.
    const h = { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': crypto.randomUUID() };
    const first = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: h, body: JSON.stringify({ title: 'Header order', description: 'one' }),
    });
    assert(first.status === 201, `first: ${first.status} ${JSON.stringify(first.body)}`);
    const second = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: h, body: JSON.stringify({ title: 'Header order', description: 'two' }),
    });
    assert(second.body.data.task.id === first.body.data.task.id, 'replayed the first response');
});

await test('41b. A non-UUID Idempotency-Key is rejected (400), unchanged', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': 'not-a-uuid' },
        body: JSON.stringify({ title: 'Bad key', description: 'x' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

await test('42. Once the run is finished, the same job can be ordered again', async () => {
    // Take the first commission to a terminal state the way the agent would.
    const start = await json(`/v1/agents/${agentName}/tasks/${firstDedupeId}/start`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(start.status === 200, `start: ${start.status} ${JSON.stringify(start.body)}`);
    const done = await json(`/v1/agents/${agentName}/tasks/${firstDedupeId}/complete`, {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ message: 'Summary written' }),
    });
    assert(done.status === 200, `complete: ${done.status} ${JSON.stringify(done.body)}`);

    const again = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify(dedupeBody),
    });
    assert(again.status === 201, `expected a fresh 201, got ${again.status}: ${JSON.stringify(again.body)}`);
    assert(again.body.data.task.id !== firstDedupeId, 'a new run, not the finished one');
});

// ─── Phase 11: draft is not a dead end ───
//
// FOUND BY A CREW, NOT BY US. A task created over plain REST without naming a status landed in
// 'draft', because the REST body schema defaulted there while the MCP tool and the connector both
// defaulted to 'queued'. Nothing anywhere moved a task OUT of draft: PATCH has no status field,
// /start demands queued|paused|stalled, and no route or service transitions one. So the documented
// agent-facing door created tasks in a state with no exit, and the 409 that followed read as a race
// rather than as the dead end it was. Every in-house caller had already learned to pass
// status:'queued' by hand — one of them with a comment saying REQUIRED — which is the shape of a
// default nobody wants.
console.log('\nPhase 11 -- Draft is not a dead end');

let releasableDraftId = '';

await test('43. Creating a task without naming a status queues it, as the other two doors do', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'No status named', description: 'The default decides' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'queued',
        `an omitted status must queue, not draft; got ${body.data.task.status}`);
});

await test('44. An explicit draft is still a draft', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'Held back', description: 'Owner reviews first', status: 'draft' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'draft', `status: ${body.data.task.status}`);
    releasableDraftId = body.data.task.id;
});

await test('45. The agent it is FOR cannot release someone else\'s draft', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks/${releasableDraftId}/queue`, {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('45b. That refusal reaches the caller as a sentence with somewhere to go', async () => {
    // END TO END, through the real door. There are unit tests on error() and on the refusal builders,
    // and neither of them proves that what a caller actually RECEIVES carries the floor: the envelope
    // is assembled in one place, serialised in another, and the middleware that appends the support
    // action runs in a third. Measured this morning across 490 refusal-shaped messages, 22 said what
    // to do next; this asserts that a real one now does.
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${releasableDraftId}/queue`, {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 403, `expected 403, got ${status}`);

    const message: string = body.error?.message ?? '';
    assert(message.length > 0, 'a refusal has to say something');
    // Not a word only we understand, and not an accusation. "Access denied" failed both.
    assert(!/\b(scope|namespace|principal|gaii|ghii|denied|forbidden)\b/i.test(message),
        `the sentence uses a word only we understand: "${message}"`);

    const actions: Array<{ description?: string }> = body.hints?.next_actions ?? [];
    assert(actions.length >= 2,
        `a refusal must offer something above the support line; got ${JSON.stringify(actions.map(a => a.description))}`);
    assert(actions.some(a => /message the people who run this node/i.test(a.description ?? '')),
        'the way to ask a human must survive all the way to the caller');
    assert(!/View API documentation/i.test(actions[0]?.description ?? ''),
        `the first thing offered is still the generic docs link: "${actions[0]?.description}"`);
});

await test('46. The owner releases the draft, and it becomes queued', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${releasableDraftId}/queue`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'queued', `status: ${body.data.task.status}`);
});

await test('47. The released task can then be started -- the exit actually leads somewhere', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${releasableDraftId}/start`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'active', `status: ${body.data.task.status}`);
});

await test('48. Releasing a task that is not a draft is refused, and the message names its state', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${releasableDraftId}/queue`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 409, `expected 409, got ${status}`);
    assert(String(body.error?.message ?? '').includes('active'),
        `the refusal must name the current state: ${JSON.stringify(body)}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade-delete owner', async () => {
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Agent Tasks E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
