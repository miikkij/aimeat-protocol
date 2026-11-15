/**
 * @file e2e-agent-activity.ts
 * @description E2E tests for agent activity: activityStats, GET /activity and its days window,
 *   the event log, the overview composite and GET /v1/agents?include=stats.
 *   Run: cd aimeat && pnpm exec tsx test/e2e-agent-activity.ts
 * @version-history
 *   2026-11-15 — Audit M033, M034, L004: a backdated history row proves the days window, the
 *     per-agent stats are cross-checked against a sibling with no tasks, and the activity_stats
 *     tautology became a real check.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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
import { registerOwner } from './helpers/owner-login.js';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage } from '../src/storage/interface.js';
import { serverSqlitePath, serverDbUrl } from './helpers/server-db.js';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function getToken(gaii: string, privKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = gaii + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = { gaii, timestamp, signature };
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
    const owner = await registerOwner(BASE, ownerName);
    ownerPrivKey = owner.privateKey;
    ownerToken = owner.token;
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
    agentToken = await getToken(agentGaii, agentPrivKey);
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
    const st = body.data.activity_stats;
    assert(typeof st?.tasksCompleted === 'number' && st.tasksCompleted >= 1,
        `activity_stats.tasksCompleted should be a number >= 1, got ${JSON.stringify(st)}`);

    // history should be filtered -- all records within last 7 days
    assert(Array.isArray(body.data.history), 'history is array');
    assert(body.data.history.length > 0, 'history holds today\'s task rows');
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString().split('T')[0];
    for (const record of body.data.history) {
        assert(record.date >= cutoff,
            `history record date ${record.date} should be >= ${cutoff}`);
    }
});

// Every row the HTTP routes write is dated today, so no window could exclude one. A row dated ten
// days back is planted straight into storage: ?days=7 must leave it out and ?days=30 must return it.
await test('4a. GET /activity?days=7 omits a 10-day-old history row that ?days=30 returns', async () => {
    const provider = (process.env.AIMEAT_DB ?? 'sqlite') as StorageProvider;
    if (provider !== 'sqlite' && provider !== 'postgres-kysely') { console.log(`     (skipped: the ${provider} backend lives inside the server)`); return; }
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString().split('T')[0];
    const storage: Storage = await createStorage({ provider, sqlitePath: serverSqlitePath(), dbUrl: serverDbUrl() });
    try {
        await storage.recordActivity({ agentGaii, date: old, hour: 3, metric: 'tasks_completed', value: 1 });
    } finally { await (storage as unknown as { close?: () => unknown }).close?.(); }
    const read = async (days: number) => (await json(`/v1/agents/${agentName}/activity?days=${days}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    })).body.data.history as Array<{ date: string }>;
    const week = await read(7);
    const month = await read(30);
    assert(week.length > 0 && !week.some(r => r.date === old), `?days=7 should omit ${old}, got ${JSON.stringify(week.map(r => r.date))}`);
    assert(month.some(r => r.date === old), `?days=30 should include ${old}, got ${JSON.stringify(month.map(r => r.date))}`);
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

// ─── Phase 5b: GET /activity/overview composite (mount fold) ───
console.log('\nPhase 5b -- GET /activity/overview composite');

await test('5b. GET /activity/overview folds activity + log + directives + webhook + telemetry', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/activity/overview`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'response ok');
    const d = body.data;

    // activity_stats matches GET /activity
    const single = await json(`/v1/agents/${agentName}/activity`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(d.activity && typeof d.activity === 'object', 'has activity sub-object');
    assert(d.activity.activity_stats?.tasksCompleted === single.body.data.activity_stats?.tasksCompleted,
        'activity_stats matches GET /activity');

    // log events mirror GET /activity/log — same shape, >= 2 lifecycle events, per_page 50
    assert(Array.isArray(d.log.events) && d.log.events.length >= 2, `log events >= 2, got ${d.log.events?.length}`);
    assert(d.log.pagination.per_page === 50, `per_page should be 50, got ${d.log.pagination.per_page}`);
    for (const evt of d.log.events) {
        assert(typeof evt.id === 'string' && typeof evt.taskTitle === 'string' && typeof evt.timestamp === 'string', 'event shape');
    }

    // directives sub-object present (budget_limits absent — this agent has no directives set)
    assert(d.directives && typeof d.directives === 'object', 'has directives sub-object');

    // webhook mirrors GET /webhook .data — not configured for this agent
    assert(d.webhook && d.webhook.configured === false, `webhook should be not-configured, got ${JSON.stringify(d.webhook)}`);

    // telemetry mirrors GET /telemetry .data shape
    assert(Array.isArray(d.telemetry.events) && d.telemetry.per_page === 50, 'telemetry has events array + per_page');
});

await test('5c. owner-or-self gate: a sibling agent gets 403, self gets 200', async () => {
    // Register a second agent under the SAME owner
    const { status: rStatus, body: rBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'actbot2', owner: ownerName, capabilities: ['memory'] }),
    });
    assert(rStatus === 201, `register agent2 status ${rStatus}: ${JSON.stringify(rBody)}`);
    const agent2Gaii = rBody.data.agent.gaii;
    const agent2Token = await getToken(agent2Gaii, rBody.data.private_key);

    // agent2 → agent1's overview: resolveAgentGaii builds actbot#owner (agent1); canAccess sees a non-self
    // agent session → 403 (the exact gate the folded /activity, /webhook, /telemetry endpoints enforce).
    const { status: crossStatus } = await json(`/v1/agents/${agentName}/activity/overview`, {
        headers: { Authorization: `Bearer ${agent2Token}` },
    });
    assert(crossStatus === 403, `sibling agent should get 403, got ${crossStatus}`);

    // agent2 → its OWN overview: self-access allowed.
    const { status: selfStatus } = await json('/v1/agents/actbot2/activity/overview', {
        headers: { Authorization: `Bearer ${agent2Token}` },
    });
    assert(selfStatus === 200, `self overview should be 200, got ${selfStatus}`);
});

// ─── Phase 6: GET /v1/agents?include=stats bulk overview ───
console.log('\nPhase 6 -- GET /v1/agents?include=stats');

await test('6. include=stats attaches per-agent task/message aggregates in one request', async () => {
    const { status, body } = await json('/v1/agents?include=stats', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const agent = (body.data.agents || []).find((a: any) => a.name === agentName);
    assert(agent, `agent ${agentName} present in list`);
    const stats = agent.stats;
    assert(stats && typeof stats === 'object', 'agent.stats present');

    // We completed 1 task and failed 1 task for this agent earlier in the run.
    assert(stats.tasks.done >= 1, `done >= 1, got ${stats.tasks.done}`);
    assert(stats.tasks.failed >= 1, `failed >= 1, got ${stats.tasks.failed}`);
    assert(stats.tasks.doneToday >= 1, `doneToday >= 1, got ${stats.tasks.doneToday}`);
    assert(typeof stats.tasks.lastTaskUpdateAt === 'string', 'lastTaskUpdateAt is set');
    assert(typeof stats.tasks.lastFailedAt === 'string', 'lastFailedAt is set');
    assert(typeof stats.messages.total === 'number', 'messages.total is a number');
    assert(Array.isArray(stats.active_tasks), 'active_tasks is an array');
});

await test('7. counts match the per-agent countTasksByAgent sums (cross-check)', async () => {
    const { body: capBody } = await json(`/v1/agents/${agentName}/capabilities`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const cap = capBody.data.activity_stats;
    const { body } = await json('/v1/agents?include=stats', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const agent = (body.data.agents || []).find((a: any) => a.name === agentName);
    const sibling = (body.data.agents || []).find((a: any) => a.name === 'actbot2');
    // Every task of this run was completed inside the run, so the lifetime counter on the agent
    // record and the per-agent task count agree exactly. actbot2 (test 5c) completed none: a count
    // taken from the owner's whole fleet would show its sibling's completion on it.
    assert(cap.tasksCompleted >= 1 && agent.stats.tasks.done === cap.tasksCompleted,
        `actbot done ${agent.stats.tasks.done} should equal capabilities tasksCompleted ${cap.tasksCompleted}`);
    assert(sibling, 'actbot2 present in list');
    assert(sibling.stats.tasks.done === 0 && sibling.stats.tasks.failed === 0,
        `actbot2 completed and failed nothing, got ${JSON.stringify(sibling.stats.tasks)}`);
});

await test('8. without include=stats, no stats field is attached (default projection)', async () => {
    const { body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const agent = (body.data.agents || []).find((a: any) => a.name === agentName);
    assert(agent && agent.stats === undefined, 'stats absent without include=stats');
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
