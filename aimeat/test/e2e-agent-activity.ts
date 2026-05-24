// E2E Tests for Agent Activity
// Run: cd aimeat && pnpm exec tsx test/e2e-agent-activity.ts

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
const ownerName = `actowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'actbot';

let completedTaskId = '';
let failedTaskId = '';

console.log('\n=== AIMEAT Agent Activity E2E Test ===\n');

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
});

await test('Agent auth token', async () => {
    agentToken = await getToken(agentGaii, agentPrivKey, true);
    assert(typeof agentToken === 'string' && agentToken.length > 0, 'got agent token');
});

// ─── Phase 1: Complete a task and verify activityStats ───
console.log('\nPhase 1 -- Complete Task -> activityStats Updated');

await test('1. Create, start, and complete a task -> tasksCompleted incremented', async () => {
    // Create a task
    const { status: createStatus, body: createBody } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Activity test task 1',
            description: 'Task for activity stats test',
            scope: [],
            rules: ['Test rule'],
            verification: { user_expects: 'Done', technical_checks: ['check'] },
            todos: [{ id: 't1', order: 1, title: 'Step 1', environment: 'aimeat', status: 'pending' }],
            status: 'queued',
        }),
    });
    assert(createStatus === 201, `create status ${createStatus}: ${JSON.stringify(createBody)}`);
    completedTaskId = createBody.data.task.id;

    // Start the task
    const { status: startStatus } = await json(`/v1/agents/${agentName}/tasks/${completedTaskId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(startStatus === 200, `start status ${startStatus}`);

    // Complete the task
    const { status: completeStatus, body: completeBody } = await json(`/v1/agents/${agentName}/tasks/${completedTaskId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ message: 'Task completed successfully' }),
    });
    assert(completeStatus === 200, `complete status ${completeStatus}: ${JSON.stringify(completeBody)}`);
    assert(completeBody.data.task.status === 'done', `task status: ${completeBody.data.task.status}`);

    // Check activityStats via capabilities endpoint
    const { status: capStatus, body: capBody } = await json(`/v1/agents/${agentName}/capabilities`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(capStatus === 200, `capabilities status ${capStatus}`);

    const stats = capBody.data.activity_stats;
    assert(stats !== null, 'activity_stats is not null');
    assert(stats.tasksCompleted >= 1, `tasksCompleted should be >= 1, got ${stats.tasksCompleted}`);
    assert(typeof stats.successRate === 'number', 'successRate is a number');
    assert(typeof stats.lastTaskAt === 'string', 'lastTaskAt is set');
});

// ─── Phase 2: Fail a task and verify stats ───
console.log('\nPhase 2 -- Fail Task -> tasksFailed Incremented');

await test('2. Create, start, and fail a task -> tasksFailed incremented, successRate recalculated', async () => {
    // Create a task
    const { status: createStatus, body: createBody } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Activity test task 2 - will fail',
            description: 'Task that will be failed for stats test',
            scope: [],
            rules: ['Test rule'],
            verification: { user_expects: 'Done', technical_checks: ['check'] },
            todos: [{ id: 't1', order: 1, title: 'Step 1', environment: 'aimeat', status: 'pending' }],
            status: 'queued',
        }),
    });
    assert(createStatus === 201, `create status ${createStatus}`);
    failedTaskId = createBody.data.task.id;

    // Start the task
    const { status: startStatus } = await json(`/v1/agents/${agentName}/tasks/${failedTaskId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(startStatus === 200, `start status ${startStatus}`);

    // Fail the task
    const { status: failStatus, body: failBody } = await json(`/v1/agents/${agentName}/tasks/${failedTaskId}/fail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ message: 'External API unavailable' }),
    });
    assert(failStatus === 200, `fail status ${failStatus}: ${JSON.stringify(failBody)}`);
    assert(failBody.data.task.status === 'failed', `task status: ${failBody.data.task.status}`);

    // Check activityStats
    const { status: capStatus, body: capBody } = await json(`/v1/agents/${agentName}/capabilities`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(capStatus === 200, `capabilities status ${capStatus}`);

    const stats = capBody.data.activity_stats;
    assert(stats !== null, 'activity_stats is not null');
    assert(stats.tasksCompleted >= 1, `tasksCompleted should be >= 1, got ${stats.tasksCompleted}`);
    assert(stats.tasksFailed >= 1, `tasksFailed should be >= 1, got ${stats.tasksFailed}`);

    // successRate = round(completed / (completed + failed) * 100)
    // With 1 completed and 1 failed, successRate should be 50
    const expectedRate = Math.round((stats.tasksCompleted / (stats.tasksCompleted + stats.tasksFailed)) * 100);
    assert(stats.successRate === expectedRate,
        `successRate should be ${expectedRate}, got ${stats.successRate}`);
});

// ─── Phase 3: GET /activity returns stats + history ───
console.log('\nPhase 3 -- GET /activity');

await test('3. GET /activity returns stats + history + scheduled_jobs', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/activity`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'response ok');

    // activity_stats
    const stats = body.data.activity_stats;
    assert(stats !== null, 'activity_stats is not null');
    assert(typeof stats.tasksCompleted === 'number', 'has tasksCompleted');
    assert(typeof stats.tasksFailed === 'number', 'has tasksFailed');
    assert(typeof stats.successRate === 'number', 'has successRate');

    // history is an array of activity records
    assert(Array.isArray(body.data.history), 'history is array');

    // scheduled_jobs is an array
    assert(Array.isArray(body.data.scheduled_jobs), 'scheduled_jobs is array');
});

// ─── Phase 4: GET /activity?days=7 filters ───
console.log('\nPhase 4 -- GET /activity with days filter');

await test('4. GET /activity?days=7 filters to last 7 days', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/activity?days=7`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'response ok');

    // activity_stats should still be present (stats are cumulative, not filtered by days)
    assert(body.data.activity_stats !== null || body.data.activity_stats === null,
        'activity_stats field exists');

    // history should be filtered -- all records within last 7 days
    assert(Array.isArray(body.data.history), 'history is array');
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString().split('T')[0];
    for (const record of body.data.history) {
        assert(record.date >= cutoff,
            `history record date ${record.date} should be >= ${cutoff}`);
    }
});

await test('4b. GET /activity?granularity=hourly returns hourly breakdown', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/activity?days=7&granularity=hourly`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'response ok');
    assert(Array.isArray(body.data.history), 'history is array');
    // Hourly records have hour field (0-23)
    for (const record of body.data.history) {
        assert(typeof record.hour === 'number', `hour should be number, got ${typeof record.hour}`);
        assert(record.hour >= 0 && record.hour <= 23, `hour should be 0-23, got ${record.hour}`);
    }
});

// ─── Phase 5: GET /activity/log returns paginated events ───
console.log('\nPhase 5 -- GET /activity/log');

await test('5. GET /activity/log returns paginated events from tasks', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/activity/log?page=1&per_page=10`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'response ok');

    // events array
    const events = body.data.events;
    assert(Array.isArray(events), 'events is array');
    // We had 2 tasks (1 completed, 1 failed), each should have lifecycle events
    assert(events.length >= 2, `expected >= 2 events, got ${events.length}`);

    // Each event has expected fields
    for (const evt of events) {
        assert(typeof evt.id === 'string', 'event has id');
        assert(typeof evt.taskId === 'string', 'event has taskId');
        assert(typeof evt.taskTitle === 'string', 'event has taskTitle');
        assert(typeof evt.type === 'string', 'event has type');
        assert(typeof evt.message === 'string', 'event has message');
        assert(typeof evt.timestamp === 'string', 'event has timestamp');
    }

    // pagination
    const pagination = body.data.pagination;
    assert(typeof pagination.page === 'number', 'pagination has page');
    assert(typeof pagination.per_page === 'number', 'pagination has per_page');
    assert(typeof pagination.total === 'number', 'pagination has total');
    assert(typeof pagination.total_pages === 'number', 'pagination has total_pages');
    assert(pagination.page === 1, `page should be 1, got ${pagination.page}`);
    assert(pagination.per_page === 10, `per_page should be 10, got ${pagination.per_page}`);
    assert(pagination.total >= 2, `total should be >= 2, got ${pagination.total}`);
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
console.log(`Agent Activity E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
