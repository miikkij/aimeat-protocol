// E2E Tests for Agent Integration Kit
// Run: cd aimeat && pnpm exec tsx test/e2e-integration-kit.ts

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
const ownerName = `kitowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'kitbot';

let taskId = '';

console.log('\n=== AIMEAT Integration Kit E2E Test ===\n');

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

// ─── Group 1: Poll Inbox ───
console.log('\nGroup 1 -- Poll Inbox');

await test('1. Empty inbox', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.queued_tasks), 'queued_tasks is array');
    assert(Array.isArray(body.data.active_tasks), 'active_tasks is array');
    assert(body.data.queued_tasks.length === 0, `expected 0 queued, got ${body.data.queued_tasks.length}`);
    assert(body.data.active_tasks.length === 0, `expected 0 active, got ${body.data.active_tasks.length}`);
});

await test('2. Create task, poll inbox', async () => {
    // Create a queued task
    const { status: createStatus, body: createBody } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Inbox Test Task',
            description: 'Task to verify inbox polling',
            todos: [
                { id: 'it-1', order: 1, title: 'Do something', environment: 'agent', verification: 'check' },
            ],
            status: 'queued',
        }),
    });
    assert(createStatus === 201, `create status ${createStatus}: ${JSON.stringify(createBody)}`);
    taskId = createBody.data.task.id;

    // Poll inbox -- should show the queued task
    const { status, body } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `inbox status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.queued_tasks.length >= 1, `expected >=1 queued, got ${body.data.queued_tasks.length}`);
    const found = body.data.queued_tasks.some((t: any) => t.id === taskId);
    assert(found, 'queued task not found in inbox');
});

await test('3. Inbox JSON schema', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert('queued_tasks' in body.data, 'missing queued_tasks field');
    assert('active_tasks' in body.data, 'missing active_tasks field');
    assert('pending_messages' in body.data, 'missing pending_messages field');
    assert(Array.isArray(body.data.queued_tasks), 'queued_tasks not array');
    assert(Array.isArray(body.data.active_tasks), 'active_tasks not array');
    assert(Array.isArray(body.data.pending_messages), 'pending_messages not array');
});

// ─── Group 2: Full Task Lifecycle ───
console.log('\nGroup 2 -- Full Task Lifecycle');

await test('4. Start task from inbox', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${taskId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'active', `status: ${body.data.task.status}`);
});

await test('5. Send progress events', async () => {
    // Event 1: progress
    const { status: s1, body: b1 } = await json(`/v1/agents/${agentName}/tasks/${taskId}/event`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            type: 'progress',
            message: 'Step 1 in progress',
            details: { percent: 33 },
        }),
    });
    assert(s1 === 201, `event 1 status ${s1}: ${JSON.stringify(b1)}`);

    // Event 2: todo_completed
    const { status: s2, body: b2 } = await json(`/v1/agents/${agentName}/tasks/${taskId}/event`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            type: 'todo_completed',
            message: 'TODO it-1 finished',
            details: { todoId: 'it-1' },
        }),
    });
    assert(s2 === 201, `event 2 status ${s2}: ${JSON.stringify(b2)}`);

    // Event 3: verification
    const { status: s3, body: b3 } = await json(`/v1/agents/${agentName}/tasks/${taskId}/event`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            type: 'verification',
            message: 'All checks passed',
            details: { checks: ['output_valid', 'data_stored'] },
        }),
    });
    assert(s3 === 201, `event 3 status ${s3}: ${JSON.stringify(b3)}`);
});

await test('6. Verify events recorded', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${taskId}/events`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    // Should have at least 4 events: 'started' auto-event + 3 manual events
    assert(body.data.events.length >= 4, `events count: ${body.data.events.length}, expected >=4`);
    // Verify we can find our 3 event types
    const types = body.data.events.map((e: any) => e.type);
    assert(types.includes('progress'), 'missing progress event');
    assert(types.includes('todo_completed'), 'missing todo_completed event');
    assert(types.includes('verification'), 'missing verification event');
});

await test('7. Complete task', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ message: 'All work finished successfully' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'done', `status: ${body.data.task.status}`);
    assert(typeof body.data.task.completedAt === 'string', 'has completedAt');
});

await test('8. Task appears in done list', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks?status=done`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.tasks.length >= 1, `done tasks: ${body.data.tasks.length}`);
    const found = body.data.tasks.some((t: any) => t.id === taskId);
    assert(found, 'completed task not found in done list');
});

// ─── Group 3: Integration Kit ───
console.log('\nGroup 3 -- Integration Kit');

await test('9. Integration kit endpoint', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/integration-kit`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.kit === 'object', 'has kit object');
    assert(body.data.kit.agent_name === agentName, `agent_name: ${body.data.kit.agent_name}`);
    assert(typeof body.data.kit.node_url === 'string', 'has node_url');
    assert(typeof body.data.kit.node_id === 'string', 'has node_id');
    assert(typeof body.data.kit.watchdog_spec === 'object', 'has watchdog_spec');
    assert(typeof body.data.kit.error_protocol === 'object', 'has error_protocol');
});

await test('10. Integration kit has correct endpoints', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/integration-kit`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    const ws = body.data.kit.watchdog_spec;
    assert(typeof ws.poll_interval_seconds === 'number', 'has poll_interval_seconds');
    assert(ws.inbox_endpoint === `/v1/agents/${agentName}/inbox`, `inbox_endpoint: ${ws.inbox_endpoint}`);
    assert(ws.task_event_endpoint === `/v1/agents/${agentName}/tasks/{id}/event`, `task_event_endpoint: ${ws.task_event_endpoint}`);
    assert(ws.task_todo_endpoint === `/v1/agents/${agentName}/tasks/{id}/todos/{todoId}`, `task_todo_endpoint: ${ws.task_todo_endpoint}`);
    assert(ws.task_complete_endpoint === `/v1/agents/${agentName}/tasks/{id}/complete`, `task_complete_endpoint: ${ws.task_complete_endpoint}`);
    assert(ws.task_fail_endpoint === `/v1/agents/${agentName}/tasks/{id}/fail`, `task_fail_endpoint: ${ws.task_fail_endpoint}`);

    const ep = body.data.kit.error_protocol;
    assert(typeof ep.max_retries === 'number', 'has max_retries');
    assert(Array.isArray(ep.backoff_seconds), 'has backoff_seconds');
    assert(ep.report_endpoint === `/v1/agents/${agentName}/tasks/{id}/fail`, `report_endpoint: ${ep.report_endpoint}`);
});

// ─── Group 4: Stall Detection ───
console.log('\nGroup 4 -- Stall Detection');

await test('11. Stall detection setup', async () => {
    // Create a new task, start it, and verify it exists as active.
    // Actual stall detection requires a background job and 30+ min, so we just
    // verify the task lifecycle supports the stall detection prerequisites.
    const { status: createStatus, body: createBody } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Stall Detection Task',
            description: 'Task to verify stall detection prerequisites',
            todos: [
                { id: 'sd-1', order: 1, title: 'Long running step', environment: 'agent', verification: 'check' },
            ],
            status: 'queued',
        }),
    });
    assert(createStatus === 201, `create status ${createStatus}: ${JSON.stringify(createBody)}`);
    const stallTaskId = createBody.data.task.id;

    // Start it
    const { status: startStatus, body: startBody } = await json(`/v1/agents/${agentName}/tasks/${stallTaskId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(startStatus === 200, `start status ${startStatus}: ${JSON.stringify(startBody)}`);
    assert(startBody.data.task.status === 'active', `expected active, got ${startBody.data.task.status}`);

    // Verify the task exists as active
    const { status: listStatus, body: listBody } = await json(`/v1/agents/${agentName}/tasks?status=active`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(listStatus === 200, `list status ${listStatus}`);
    const found = listBody.data.tasks.some((t: any) => t.id === stallTaskId);
    assert(found, 'active task not found in task list');

    // Verify the inbox shows it as active
    const { status: inboxStatus, body: inboxBody } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(inboxStatus === 200, `inbox status ${inboxStatus}`);
    const inboxFound = inboxBody.data.active_tasks.some((t: any) => t.id === stallTaskId);
    assert(inboxFound, 'active task not found in inbox');
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
console.log(`Integration Kit: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
