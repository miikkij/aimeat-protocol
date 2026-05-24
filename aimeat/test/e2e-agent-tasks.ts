// E2E Tests for Agent Tasks
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
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

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

await test('10. Complete task (active -> done)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ message: 'All steps finished successfully' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'done', `status: ${body.data.task.status}`);
    assert(typeof body.data.task.completedAt === 'string', 'has completedAt');
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

await test('13. Cannot delete completed task', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks/${queuedTaskId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 409, `expected 409, got ${status}`);
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
