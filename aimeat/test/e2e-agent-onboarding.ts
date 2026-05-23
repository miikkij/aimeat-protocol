/**
 * @file e2e-agent-onboarding.ts
 * @description E2E tests for Hello Integration agent onboarding flow.
 *   Covers the full lifecycle: GET status before start, POST start, step
 *   confirmations (identify_platform, install_skill, read_directives,
 *   declare_services), unknown step rejection, already-passed idempotency,
 *   progress tracking, DELETE cancellation, and role enforcement.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation
 */

// E2E Tests for Agent Onboarding (Hello Integration)
// Run: cd aimeat && pnpm exec tsx test/e2e-agent-onboarding.ts

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
const ownerName = `obowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'onboard-bot';

console.log('\n=== AIMEAT Agent Onboarding E2E Test ===\n');

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

// ─── Phase 1: Onboarding before start ───
console.log('\nPhase 1 -- Status Before Start');

await test('1. GET onboarding after registration shows auto-started in_progress', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const ob = body.data.onboarding;
    assert(ob !== null, 'onboarding should auto-start on agent registration');
    assert(ob.status === 'in_progress', `expected in_progress, got ${ob.status}`);
    assert(ob.steps[0].id === 'authenticate', 'first step is authenticate');
    assert(ob.steps[0].status === 'passed', 'authenticate auto-passed on registration');
});

// ─── Phase 2: Start onboarding ───
console.log('\nPhase 2 -- Start Onboarding');

let testTaskId = '';

await test('2. POST start returns in_progress with 11 steps', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const ob = body.data.onboarding;
    assert(ob.status === 'in_progress', `expected in_progress, got ${ob.status}`);
    assert(ob.steps.length === 11, `expected 11 steps, got ${ob.steps.length}`);

    // First step (authenticate) should already be passed
    const authStep = ob.steps[0];
    assert(authStep.id === 'authenticate', `first step should be authenticate, got ${authStep.id}`);
    assert(authStep.status === 'passed', `authenticate should be passed, got ${authStep.status}`);

    // Step 9 (accept_test_task, index 8) should have testTaskId in details
    const taskStep = ob.steps[8];
    assert(taskStep.id === 'accept_test_task', `step 9 should be accept_test_task, got ${taskStep.id}`);
    assert(typeof taskStep.details?.testTaskId === 'string', 'accept_test_task should have testTaskId');
    testTaskId = taskStep.details.testTaskId;
});

await test('3. POST start works with agent token (agents inherit owner roles)', async () => {
    // In AIMEAT, agent tokens authenticated via Ed25519 inherit their owner's roles,
    // so the same-owner agent CAN hit owner-only endpoints.
    const { status } = await json(`/v1/agents/${agentName}/onboarding/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `expected 200, got ${status}`);
});

// ─── Phase 3: Step confirmations ───
console.log('\nPhase 3 -- Step Confirmations');

await test('4. POST step identify_platform passes with valid payload', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/identify_platform`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ platform: 'hermes', platform_version: '2.1.0' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
    assert(body.data.step.id === 'identify_platform', `expected identify_platform, got ${body.data.step.id}`);
});

await test('5. POST step install_skill passes with valid payload', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/install_skill`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ version: 'v1', platform: 'hermes' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

await test('6. POST step read_directives passes with confirmed: true', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/read_directives`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ confirmed: true }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

await test('7. POST step declare_services passes with empty services', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/declare_services`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ services: [] }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

// ─── Phase 4: Edge cases ───
console.log('\nPhase 4 -- Edge Cases');

await test('8. POST step with unknown ID returns 400', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/nonexistent_step`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'INVALID_STEP', `expected INVALID_STEP, got ${body.error?.code}`);
});

await test('9. POST step on already-passed step returns 200 with already passed', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/identify_platform`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ platform: 'hermes', platform_version: '2.1.0' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
    assert(
        body.data.message === 'Step already passed',
        `expected 'Step already passed', got '${body.data.message}'`,
    );
});

// ─── Phase 5: Progress tracking ───
console.log('\nPhase 5 -- Progress Tracking');

await test('10. GET onboarding shows progress after step confirmations', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const ob = body.data.onboarding;
    assert(ob !== null, 'onboarding should exist');
    assert(ob.status === 'in_progress' || ob.status === 'completed', `status should be in_progress or completed, got ${ob.status}`);

    // Count passed steps -- we confirmed authenticate (auto), identify_platform,
    // install_skill, read_directives, declare_services = at least 5
    const passedSteps = ob.steps.filter((s: any) => s.status === 'passed');
    assert(passedSteps.length >= 5, `expected at least 5 passed steps, got ${passedSteps.length}`);

    // Verify the steps we confirmed are passed
    const identifyStep = ob.steps.find((s: any) => s.id === 'identify_platform');
    assert(identifyStep.status === 'passed', 'identify_platform should still be passed');
    const installStep = ob.steps.find((s: any) => s.id === 'install_skill');
    assert(installStep.status === 'passed', 'install_skill should still be passed');
    const directivesStep = ob.steps.find((s: any) => s.id === 'read_directives');
    assert(directivesStep.status === 'passed', 'read_directives should still be passed');
    const servicesStep = ob.steps.find((s: any) => s.id === 'declare_services');
    assert(servicesStep.status === 'passed', 'declare_services should still be passed');
});

// ─── Phase 6: Cancellation ───
console.log('\nPhase 6 -- Cancellation');

await test('11. DELETE onboarding returns 200', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.deleted === true, 'deleted should be true');
});

await test('12. DELETE works with agent token (agents inherit owner roles)', async () => {
    // Re-start first so there is something to delete
    await json(`/v1/agents/${agentName}/onboarding/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });

    // In AIMEAT, agent tokens inherit their owner's roles, so this succeeds
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.data.deleted === true, 'deleted should be true');
});

await test('13. GET after delete returns not_started', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'not_started', `expected not_started, got ${body.data.status}`);
    assert(body.data.onboarding === null, 'onboarding should be null after delete');
});

// ─── Summary ───
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
