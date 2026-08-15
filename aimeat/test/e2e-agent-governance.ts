// E2E Tests for Agent Governance (budget controls, owner-only start, task pause, readiness gates, admin endpoints)
// Run: cd aimeat && pnpm exec tsx test/e2e-agent-governance.ts

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
const ownerName = `govowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'govbot';
let taskId = '';

// Non-operator owner (second owner has no operator role)
const owner2Name = `govowner2${Date.now()}`;
let owner2PrivKey = '';
let owner2Token = '';

console.log('\n=== AIMEAT Agent Governance E2E Test ===\n');

// ─── Setup ───
console.log('Setup -- Owner & Agent');

await test('Register owner (first = operator)', async () => {
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

await test('Register second owner (non-operator)', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: owner2Name, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}`);
    owner2PrivKey = body.data.private_key;
    owner2Token = await getToken(owner2Name, owner2PrivKey, false);
});

// ─── Phase 1: Budget directives (an instruction to the agent, not a node-enforced cap) ───
//
// A14 (E2E test-quality audit). This phase was titled "Budget Controls", which reads as a claim
// that the node refuses spending past the limit. It does not, and that is by design: an external
// agent's tokens are bought from its own vendor with its own key, so the node never sees them and
// has nothing to meter. `budget_limits` is an instruction the owner writes into the agent's
// directives for the agent to honour, plus a number the Activity tab shows beside self-reported
// telemetry. An exhaustive grep for budgetLimits across src/ finds the schema, the two directives
// routes and the read below — no enforcement site anywhere. The tests therefore assert what this
// actually is: a document the owner writes and the AGENT can read back, which is the whole
// mechanism. Anyone adding real metering later should rename the phase and add a refusal test.
console.log('\nPhase 1 -- Budget directives (instruction to the agent, not enforced by the node)');

await test('PUT directives with budgetLimits succeeds', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/directives`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            purpose: 'Test governance agent',
            budget_limits: {
                max_tokens_per_task: 10000,
                max_tokens_per_day: 50000,
                max_tasks_per_day: 5,
                alert_threshold: 80,
            },
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'response ok');
});

await test('GET directives returns budgetLimits', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/directives`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.budget_limits !== undefined, 'budget_limits present');
    assert(body.data.budget_limits.max_tokens_per_task === 10000, 'max_tokens_per_task correct');
    assert(body.data.budget_limits.max_tokens_per_day === 50000, 'max_tokens_per_day correct');
    assert(body.data.budget_limits.max_tasks_per_day === 5, 'max_tasks_per_day correct');
    assert(body.data.budget_limits.alert_threshold === 80, 'alert_threshold correct');
});

// The half that makes the feature a feature: the AGENT can read the budget it is asked to honour.
// The test above reads with the owner's token, which proves storage round-trips and nothing about
// whether the instruction reaches the party expected to follow it. Delete the budgetLimits block
// from the directives read (routes/agent-directives.ts) and this goes red while the owner-side
// assertions above stay green.
await test('the AGENT can read the budget it is asked to honour', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/directives`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `agent directives read ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    assert(body.data.budget_limits !== undefined,
        'the agent cannot see the budget it is expected to respect — the instruction reaches nobody');
    assert(body.data.budget_limits.max_tokens_per_day === 50000,
        `agent sees max_tokens_per_day ${body.data.budget_limits.max_tokens_per_day}`);
});

// ─── Phase 2: Owner-Only Task Start ───
console.log('\nPhase 2 -- Owner-Only Task Start');

await test('Create a queued task', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Governance test task',
            description: 'For testing owner-only start',
            status: 'queued',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    taskId = body.data.task.id;
});

await test('Agent cannot start task (403)', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks/${taskId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 403, `Expected 403 but got ${status}`);
});

await test('Owner can start task (200)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${taskId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'active', 'task is now active');
});

// ─── Phase 3: Task Pause ───
console.log('\nPhase 3 -- Task Pause');

await test('Agent cannot pause task (403)', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks/${taskId}/pause`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 403, `Expected 403 but got ${status}`);
});

await test('Owner can pause active task (200)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${taskId}/pause`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.status === 'paused', 'task is now paused');
});

await test('Cannot pause already paused task (409)', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks/${taskId}/pause`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 409, `Expected 409 but got ${status}`);
});

// ─── Phase 4: Admin Endpoints ───
console.log('\nPhase 4 -- Admin Endpoints');

await test('Operator can access GET /admin/platforms', async () => {
    const { status, body } = await json('/v1/admin/platforms', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.platforms), 'platforms is an array');
});

await test('Non-operator gets 403 on GET /admin/platforms', async () => {
    const { status } = await json('/v1/admin/platforms', {
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 403, `Expected 403 but got ${status}`);
});

await test('Operator can access GET /admin/agents/onboarding', async () => {
    const { status, body } = await json('/v1/admin/agents/onboarding', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(typeof body.data.completed === 'number', 'completed count present');
    assert(typeof body.data.in_progress === 'number', 'in_progress count present');
});

await test('Operator can access GET /admin/agents/readiness', async () => {
    const { status, body } = await json('/v1/admin/agents/readiness', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.distribution !== undefined, 'distribution present');
    assert(typeof body.data.total === 'number', 'total count present');
});

await test('Operator can access GET /admin/skill-bundles', async () => {
    const { status, body } = await json('/v1/admin/skill-bundles', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.bundles !== undefined, 'bundles present');
});

await test('Operator can POST /admin/skill-bundles/regenerate', async () => {
    const { status, body } = await json('/v1/admin/skill-bundles/regenerate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.regenerated === true, 'regenerated flag');
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Delete owner cascades (cleanup)', async () => {
    const { status } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200 || status === 204, `status ${status}`);
});

await test('Delete second owner (cleanup)', async () => {
    const { status } = await json(`/v1/owners/${owner2Name}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200 || status === 204, `status ${status}`);
});

// ─── Summary ───
console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
