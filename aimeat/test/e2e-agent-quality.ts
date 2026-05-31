// E2E Tests for Agent Quality tab (task ratings + statistics rollups)
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-quality

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
    const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// ─── State ───
const ownerName = `qualowner${Date.now()}`;
let ownerToken = '';
const agentName = 'qualbot';        // the agent whose deliverables get rated
let agentGaii = '';
let agentToken = '';
const parentName = 'orchestrator';  // a same-owner agent that delegates + rates
let parentToken = '';

let doneTaskId = '';
let secondDoneTaskId = '';
let openTaskId = '';

console.log('\n=== AIMEAT Agent Quality E2E Test ===\n');

// ─── Setup ───
console.log('Setup -- Owner & two agents');

await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerToken = await getToken(ownerName, body.data.private_key, false);
});

await test('Register agent (ratee) + orchestrator (rater)', async () => {
    const a = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'] }),
    });
    assert(a.status === 201, `agent: ${JSON.stringify(a.body)}`);
    agentGaii = a.body.data.agent.gaii;
    agentToken = await getToken(agentGaii, a.body.data.private_key, true);

    const p = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: parentName, owner: ownerName, capabilities: ['memory'] }),
    });
    assert(p.status === 201, `orchestrator: ${JSON.stringify(p.body)}`);
    parentToken = await getToken(p.body.data.agent.gaii, p.body.data.private_key, true);
});

// Helper: create a task, start it (owner), complete it (agent) -> returns task id in 'done'.
async function makeDoneTask(title: string): Promise<string> {
    const c = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title, status: 'queued' }),
    });
    const id = c.body.data.task.id;
    await json(`/v1/agents/${agentName}/tasks/${id}/start`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    await json(`/v1/agents/${agentName}/tasks/${id}/complete`, {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ message: 'done' }),
    });
    return id;
}

await test('Setup: two done tasks + one open task', async () => {
    doneTaskId = await makeDoneTask('Generate a limerick');
    secondDoneTaskId = await makeDoneTask('Research market figures');
    const o = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'Still open', status: 'queued' }),
    });
    openTaskId = o.body.data.task.id;
});

// ─── Phase 1: Rating happy paths ───
console.log('\nPhase 1 -- Rating');

await test('1. Owner rates a creative task 5★ (output-alone OK)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${doneTaskId}/rate`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ stars: 5, context: 'creative', comment: 'great' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.rating?.stars === 5, `stars: ${body.data.task.rating?.stars}`);
    assert(body.data.task.rating?.context === 'creative', `context: ${body.data.task.rating?.context}`);
    assert(body.data.task.rating?.raterType === 'human-owner', `raterType: ${body.data.task.rating?.raterType}`);
});

await test('2. Owner rates a factual task without grounding (human exempt) -> 200', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${secondDoneTaskId}/rate`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ stars: 2, context: 'factual', comment: 'facts were off' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.rating?.stars === 2, `stars: ${body.data.task.rating?.stars}`);
    assert(body.data.task.rating?.sourceGrounded === false, 'human ungrounded allowed');
});

// ─── Phase 2: Source-grounding hard gate ───
console.log('\nPhase 2 -- Source-grounding hard gate');

await test('3. Same-owner agent rates factual WITHOUT source_grounded -> 422 GROUNDING_REQUIRED', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${secondDoneTaskId}/rate`, {
        method: 'POST', headers: { Authorization: `Bearer ${parentToken}` },
        body: JSON.stringify({ stars: 5, context: 'factual' }),
    });
    assert(status === 422, `expected 422, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'GROUNDING_REQUIRED', `code: ${JSON.stringify(body.error)}`);
});

await test('4. Same-owner agent rates factual WITH source_grounded -> 200, raterType source-grounded-agent', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${secondDoneTaskId}/rate`, {
        method: 'POST', headers: { Authorization: `Bearer ${parentToken}` },
        body: JSON.stringify({ stars: 1, context: 'factual', source_grounded: true, unsupported: 15, evaluated_model: 'claude-opus-4-8' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.rating?.raterType === 'source-grounded-agent', `raterType: ${body.data.task.rating?.raterType}`);
    assert(body.data.task.rating?.unsupported === 15, `unsupported: ${body.data.task.rating?.unsupported}`);
    assert(body.data.task.rating?.evaluatedModel === 'claude-opus-4-8', 'model stamped');
});

await test('5. Agent rates a creative task output-alone -> 200 (creative is exempt)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${doneTaskId}/rate`, {
        method: 'POST', headers: { Authorization: `Bearer ${parentToken}` },
        body: JSON.stringify({ stars: 4, context: 'creative' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.task.rating?.raterType === 'agent', `raterType: ${body.data.task.rating?.raterType}`);
});

// ─── Phase 3: Rejections ───
console.log('\nPhase 3 -- Rejections');

await test('6. Agent cannot rate its OWN deliverable -> 403', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks/${doneTaskId}/rate`, {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ stars: 5, context: 'creative' }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
});

await test('7. Cannot rate a non-done (open) task -> 409', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks/${openTaskId}/rate`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ stars: 3, context: 'creative' }),
    });
    assert(status === 409, `expected 409, got ${status}`);
});

await test('8. Invalid stars (out of range) -> 400', async () => {
    const { status } = await json(`/v1/agents/${agentName}/tasks/${doneTaskId}/rate`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ stars: 9, context: 'creative' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

// ─── Phase 4: Statistics rollup ───
console.log('\nPhase 4 -- Statistics rollup');

await test('9. GET /statistics returns per-context reviews + performance', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/statistics`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const { performance, reviews } = body.data;
    assert(performance.tasks.total >= 3, `tasks.total: ${performance.tasks.total}`);
    assert(performance.tasks.completed >= 2, `completed: ${performance.tasks.completed}`);
    // creative bucket: last write wins per task -> doneTask is creative (rated twice, latest = agent 4★)
    assert(reviews.byContext.creative, 'has creative bucket');
    assert(reviews.byContext.factual, 'has factual bucket');
    // factual: latest rating on secondDoneTask = 1★ (source-grounded agent)
    assert(reviews.byContext.factual.avgStars === 1, `factual avg: ${reviews.byContext.factual.avgStars}`);
    assert(reviews.byContext.factual.sourceGroundedN === 1, `groundedN: ${reviews.byContext.factual.sourceGroundedN}`);
    assert(reviews.byContext.factual.lowConfidence === true, 'small sample flagged low-confidence');
    assert(reviews.overall.n >= 2, `overall n: ${reviews.overall.n}`);
});

await test('10. Statistics written to public cache key (agents.<name>.statistics.reviews)', async () => {
    // The recompute writes a public memory entry under the owner's GHII, so the
    // owner reads it back by key without an ?agent override (resolveIdentity ->
    // owner GHII).
    const key = `agents.${agentName}.statistics.reviews`;
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const value = body.data?.value ?? body.data?.entry?.value ?? body.data;
    assert(value && typeof value === 'object', 'cache value present');
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade-delete owner', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Agent Quality E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
