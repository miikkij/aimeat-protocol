/**
 * @file e2e-agent-onboarding.ts
 * @description E2E tests for Hello Integration agent onboarding flow.
 *   Covers the full lifecycle: GET status before start, POST start, step
 *   confirmations (identify_platform, install_skill, read_directives,
 *   declare_services), unknown step rejection, already-passed idempotency,
 *   progress tracking, DELETE cancellation, role enforcement, full 11-step
 *   completion flow, readiness score verification, and auto-check on GET.
 * @version-history
 *   v1.1.0 -- 2026-05-24 -- Add full flow, readiness score, and auto-check tests (phases 7-9)
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
    assert(ob.steps.length === 13, `expected 13 steps, got ${ob.steps.length}`);

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

// ─── Phase 7: Full onboarding flow to completion ───
console.log('\nPhase 7 -- Full Onboarding Flow to Completion');

let fullTestTaskId = '';

await test('14. POST start to get a fresh onboarding with test task', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const ob = body.data.onboarding;
    assert(ob.status === 'in_progress', `expected in_progress, got ${ob.status}`);
    assert(ob.steps.length === 13, `expected 13 steps, got ${ob.steps.length}`);

    // Extract the test task ID from step 9 (accept_test_task)
    const taskStep = ob.steps.find((s: any) => s.id === 'accept_test_task');
    assert(taskStep, 'accept_test_task step must exist');
    assert(typeof taskStep.details?.testTaskId === 'string', 'accept_test_task should have testTaskId');
    fullTestTaskId = taskStep.details.testTaskId;
});

await test('15. Step 1: authenticate is auto-passed', async () => {
    const { body } = await json(`/v1/agents/${agentName}/onboarding`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const authStep = body.data.onboarding.steps.find((s: any) => s.id === 'authenticate');
    assert(authStep.status === 'passed', `authenticate should be passed, got ${authStep.status}`);
});

await test('16. Step 2: identify_platform via POST step', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/identify_platform`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ platform: 'hermes', platform_version: '2.1.0' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

await test('17. Step 3: install_skill via POST step', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/install_skill`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ version: 'v1', platform: 'hermes' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

await test('18. Step 4: report_capabilities -- PUT capabilities then POST step', async () => {
    // First PUT capabilities on the agent
    const { status: putStatus, body: putBody } = await json(`/v1/agents/${agentName}/capabilities`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            technical: [{ name: 'code_execution', type: 'skill' }],
            domain: ['web development'],
        }),
    });
    assert(putStatus === 200, `PUT capabilities status ${putStatus}: ${JSON.stringify(putBody)}`);

    // Now POST the step -- validator checks storage for capabilities
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/report_capabilities`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

await test('19. Step 5: read_directives via POST step', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/read_directives`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ confirmed: true }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

await test('20. Step 6: send_test_message -- POST message then POST step', async () => {
    // Send an outbound message as the agent
    const { status: msgStatus, body: msgBody } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            content: 'Hello from onboarding test',
            direction: 'outbound',
        }),
    });
    assert(msgStatus === 201, `POST message status ${msgStatus}: ${JSON.stringify(msgBody)}`);

    // Now POST the step -- validator checks for outbound messages
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/send_test_message`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

await test('21. Step 7: configure_delivery -- PUT webhook then POST step', async () => {
    // Register a webhook
    const { status: whStatus, body: whBody } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: 'https://httpbin.org/post' }),
    });
    assert(whStatus === 200, `PUT webhook status ${whStatus}: ${JSON.stringify(whBody)}`);

    // Now POST the step -- validator checks for webhook configuration
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/configure_delivery`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

await test('22. Step 8: report_telemetry -- POST telemetry then POST step', async () => {
    // Send a telemetry event as the agent
    const { status: telStatus, body: telBody } = await json(`/v1/agents/${agentName}/telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            type: 'agent_report',
            data: { status: 'healthy', uptime_seconds: 120 },
        }),
    });
    assert(telStatus === 201, `POST telemetry status ${telStatus}: ${JSON.stringify(telBody)}`);

    // Now POST the step -- validator checks for telemetry events
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/report_telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

await test('23. Step 9: accept_test_task -- PATCH todos onto test task then POST step', async () => {
    // Agent adds todos to the queued test task
    const { status: patchStatus, body: patchBody } = await json(`/v1/agents/${agentName}/tasks/${fullTestTaskId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            todos: [
                {
                    id: 'todo-1',
                    order: 1,
                    title: 'Verify system connectivity',
                    environment: 'agent',
                    status: 'pending',
                },
            ],
        }),
    });
    assert(patchStatus === 200, `PATCH task status ${patchStatus}: ${JSON.stringify(patchBody)}`);
    assert(patchBody.data.task.todos.length === 1, `expected 1 todo, got ${patchBody.data.task.todos.length}`);

    // Now POST the step -- validator checks for todos on test task
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/accept_test_task`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

await test('24. Step 11: declare_services (optional) BEFORE last required step', async () => {
    // Confirm optional step before the last required step so auto-complete
    // includes its bonus points in the baseline score
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/declare_services`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ services: [{ name: 'code-review', description: 'Automated code review' }] }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
});

await test('25. Step 10: complete_test_task -- triggers auto-complete with all steps passed', async () => {
    // Task may already be auto-started by onboarding validator -- check status first
    const { body: taskCheck } = await json(`/v1/agents/${agentName}/tasks/${fullTestTaskId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    if (taskCheck.data.task.status === 'queued') {
        const { status: startStatus } = await json(`/v1/agents/${agentName}/tasks/${fullTestTaskId}/start`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(startStatus === 200, `POST start status ${startStatus}`);
    }
    // Task should now be active (either auto-started or manually started above)

    // Complete the task (active -> done)
    const { status: completeStatus, body: completeBody } = await json(`/v1/agents/${agentName}/tasks/${fullTestTaskId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ message: 'Onboarding test task completed' }),
    });
    assert(completeStatus === 200, `POST complete status ${completeStatus}: ${JSON.stringify(completeBody)}`);
    assert(completeBody.data.task.status === 'done', `expected done, got ${completeBody.data.task.status}`);

    // Required post-onboarding setup: publish_commands + publish_config now gate auto-complete.
    // Write the memory entries so the validators pass.
    const { status: cmdStatus } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            key: `agents.${agentName}.commands`,
            value: [{ name: '/help', description: 'List commands', category: 'meta' }],
            visibility: 'owner',
        }),
    });
    assert(cmdStatus === 201 || cmdStatus === 200, `POST commands memory status ${cmdStatus}`);
    const { status: cfgStatus } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            key: `agents.config.${agentName}.connector`,
            value: { filename: 'test-connector', content: 'e2e test descriptor', platform: 'test' },
            visibility: 'owner',
        }),
    });
    assert(cfgStatus === 201 || cfgStatus === 200, `POST config memory status ${cfgStatus}`);

    // Now POST the step -- this is the last required step, should trigger auto-complete
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding/step/complete_test_task`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.step.status === 'passed', `expected passed, got ${body.data.step.status}`);
    assert(body.data.completed === true, `expected auto-complete, got completed=${body.data.completed}`);
});

await test('26. GET onboarding shows completed status after all steps', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const ob = body.data.onboarding;
    assert(ob.status === 'completed', `expected completed, got ${ob.status}`);

    // All 13 steps should be passed (12 required + optional declare_services filled in test 24).
    const passedSteps = ob.steps.filter((s: any) => s.status === 'passed');
    assert(passedSteps.length === 13, `expected 13 passed steps, got ${passedSteps.length}`);

    // completedAt should be set
    assert(typeof ob.completedAt === 'string', `completedAt should be set, got ${ob.completedAt}`);

    // post_onboarding_checklist is included alongside onboarding
    const checklist = body.data.post_onboarding_checklist;
    assert(checklist, 'post_onboarding_checklist present');
    assert(checklist.commands_registered === true, `commands_registered should be true, got ${checklist.commands_registered}`);
    assert(checklist.config_published === true, `config_published should be true, got ${checklist.config_published}`);
    assert(checklist.shared_tags_in_use === null, `shared_tags_in_use null when owner has not assigned tags, got ${checklist.shared_tags_in_use}`);
    assert(checklist.knowledge_packages_published === false, `knowledge_packages_published false (none authored), got ${checklist.knowledge_packages_published}`);
});

// ─── Phase 8: Readiness score tests ───
console.log('\nPhase 8 -- Readiness Score');

await test('27. Readiness score is calculated on completed onboarding', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/onboarding`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const ob = body.data.onboarding;
    assert(ob.status === 'completed', `expected completed, got ${ob.status}`);

    // readinessScore should be a number >= 0
    assert(typeof ob.readinessScore === 'number', `readinessScore should be number, got ${typeof ob.readinessScore}`);
    assert(ob.readinessScore >= 0, `readinessScore should be >= 0, got ${ob.readinessScore}`);

    // readinessLevel should be one of the valid levels
    const validLevels = ['basic', 'standard', 'full', 'expert'];
    assert(validLevels.includes(ob.readinessLevel), `readinessLevel should be one of ${validLevels.join('/')}, got ${ob.readinessLevel}`);
});

await test('28. Onboarding baseline is 100 when all steps (including optional) passed', async () => {
    const { body } = await json(`/v1/agents/${agentName}/onboarding`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const ob = body.data.onboarding;

    // Baseline: 10 required steps * 9 pts + 1 optional * 10 pts = 100
    assert(ob.onboardingBaseline === 100, `expected baseline 100, got ${ob.onboardingBaseline}`);
});

await test('29. Operational health is a number between 0 and 1', async () => {
    const { body } = await json(`/v1/agents/${agentName}/onboarding`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const ob = body.data.onboarding;

    assert(typeof ob.operationalHealth === 'number', `operationalHealth should be number, got ${typeof ob.operationalHealth}`);
    assert(ob.operationalHealth >= 0 && ob.operationalHealth <= 1,
        `operationalHealth should be 0-1, got ${ob.operationalHealth}`);
});

await test('30. Health components are present with expected structure', async () => {
    const { body } = await json(`/v1/agents/${agentName}/onboarding`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const ob = body.data.onboarding;
    const hc = ob.healthComponents;

    assert(hc !== null && hc !== undefined, 'healthComponents should exist');
    assert(typeof hc.deliveryHealth === 'number', `deliveryHealth should be number, got ${typeof hc.deliveryHealth}`);
    assert(typeof hc.telemetryContinuity === 'number', `telemetryContinuity should be number, got ${typeof hc.telemetryContinuity}`);
    assert(typeof hc.taskCompletion === 'number', `taskCompletion should be number, got ${typeof hc.taskCompletion}`);

    // All health components should be 0-1
    assert(hc.deliveryHealth >= 0 && hc.deliveryHealth <= 1,
        `deliveryHealth should be 0-1, got ${hc.deliveryHealth}`);
    assert(hc.telemetryContinuity >= 0 && hc.telemetryContinuity <= 1,
        `telemetryContinuity should be 0-1, got ${hc.telemetryContinuity}`);
    assert(hc.taskCompletion >= 0 && hc.taskCompletion <= 1,
        `taskCompletion should be 0-1, got ${hc.taskCompletion}`);
});

await test('31. Task completion health reflects completed test task', async () => {
    const { body } = await json(`/v1/agents/${agentName}/onboarding`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const ob = body.data.onboarding;

    // We completed 1 task, 0 failed -- taskCompletion should be 1.0
    assert(ob.healthComponents.taskCompletion === 1, `taskCompletion should be 1.0 (1 done, 0 failed), got ${ob.healthComponents.taskCompletion}`);
});

// ─── Phase 9: Auto-check tests ───
console.log('\nPhase 9 -- Auto-Check on GET');

// Register a second agent to test auto-check independently
const agent2Name = 'onboard-auto';
let agent2Gaii = '';
let agent2Token = '';
let agent2PrivKey = '';
let autoTestTaskId = '';

await test('32. Setup second agent for auto-check tests', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: agent2Name,
            owner: ownerName,
            capabilities: ['memory'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agent2Gaii = body.data.agent.gaii;
    agent2PrivKey = body.data.private_key;
    agent2Token = await getToken(agent2Gaii, agent2PrivKey, true);
});

await test('33. Start onboarding for second agent', async () => {
    const { status, body } = await json(`/v1/agents/${agent2Name}/onboarding/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const ob = body.data.onboarding;
    assert(ob.status === 'in_progress', `expected in_progress, got ${ob.status}`);

    const taskStep = ob.steps.find((s: any) => s.id === 'accept_test_task');
    autoTestTaskId = taskStep.details.testTaskId;
});

await test('34. Confirm manual steps (identify_platform, install_skill, read_directives, declare_services)', async () => {
    // These 4 steps require explicit POST step confirmation (api_call validation)
    for (const [stepId, payload] of [
        ['identify_platform', { platform: 'claude', platform_version: '4.0' }],
        ['install_skill', { version: 'v2', platform: 'claude' }],
        ['read_directives', { confirmed: true }],
        ['declare_services', { services: [] }],
    ] as [string, Record<string, unknown>][]) {
        const { status, body } = await json(`/v1/agents/${agent2Name}/onboarding/step/${stepId}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${agent2Token}` },
            body: JSON.stringify(payload),
        });
        assert(status === 200, `step ${stepId}: status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.step.status === 'passed', `step ${stepId}: expected passed, got ${body.data.step.status}`);
    }
});

await test('35. Provision server state for auto-checkable steps (no POST step yet)', async () => {
    // PUT capabilities
    const { status: capStatus } = await json(`/v1/agents/${agent2Name}/capabilities`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({
            technical: [{ name: 'text_generation', type: 'skill' }],
            domain: ['general'],
        }),
    });
    assert(capStatus === 200, `PUT capabilities failed: ${capStatus}`);

    // POST outbound message
    const { status: msgStatus } = await json(`/v1/agents/${agent2Name}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ content: 'Auto-check test message', direction: 'outbound' }),
    });
    assert(msgStatus === 201, `POST message failed: ${msgStatus}`);

    // PUT webhook
    const { status: whStatus } = await json(`/v1/agents/${agent2Name}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: 'https://httpbin.org/post' }),
    });
    assert(whStatus === 200, `PUT webhook failed: ${whStatus}`);

    // POST telemetry
    const { status: telStatus } = await json(`/v1/agents/${agent2Name}/telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ type: 'agent_report', data: { status: 'ok' } }),
    });
    assert(telStatus === 201, `POST telemetry failed: ${telStatus}`);

    // PATCH todos onto test task, then start + complete it
    const { status: todoStatus } = await json(`/v1/agents/${agent2Name}/tasks/${autoTestTaskId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({
            todos: [{
                id: 'auto-todo-1',
                order: 1,
                title: 'Auto-check verification',
                environment: 'agent',
                status: 'done',
            }],
        }),
    });
    assert(todoStatus === 200, `PATCH task todos failed: ${todoStatus}`);

    const { status: startStatus } = await json(`/v1/agents/${agent2Name}/tasks/${autoTestTaskId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(startStatus === 200, `POST task start failed: ${startStatus}`);

    const { status: doneStatus } = await json(`/v1/agents/${agent2Name}/tasks/${autoTestTaskId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ message: 'Auto-check task done' }),
    });
    assert(doneStatus === 200, `POST task complete failed: ${doneStatus}`);

    // Write the commands + config memory keys so publish_commands and publish_config auto-pass.
    await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({
            key: `agents.${agent2Name}.commands`,
            value: [{ name: '/ping', description: 'Auto-check ping', category: 'meta' }],
            visibility: 'owner',
        }),
    });
    await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({
            key: `agents.config.${agent2Name}.connector`,
            value: { filename: 'auto-check', content: 'auto-validate descriptor', platform: 'test' },
            visibility: 'owner',
        }),
    });
});

await test('36. GET auto-validates automatic steps and completes onboarding', async () => {
    // Before GET, the automatic steps (report_capabilities, send_test_message,
    // configure_delivery, report_telemetry, accept_test_task, complete_test_task)
    // should all still be pending. GET triggers checkAutoSteps().
    const { status, body } = await json(`/v1/agents/${agent2Name}/onboarding`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const ob = body.data.onboarding;

    // All auto-checkable steps should now be passed
    const autoStepIds = [
        'report_capabilities', 'send_test_message', 'configure_delivery',
        'report_telemetry', 'accept_test_task', 'complete_test_task',
        'publish_commands', 'publish_config',
    ];
    for (const stepId of autoStepIds) {
        const step = ob.steps.find((s: any) => s.id === stepId);
        assert(step.status === 'passed',
            `auto-check: ${stepId} should be passed, got ${step.status}`);
        assert(step.validationMethod === 'automatic',
            `auto-check: ${stepId} validationMethod should be automatic, got ${step.validationMethod}`);
    }

    // All 11 steps passed means onboarding auto-completes
    assert(ob.status === 'completed', `expected completed, got ${ob.status}`);
    assert(typeof ob.readinessScore === 'number', `readinessScore should be set after auto-complete`);
});

await test('37. Auto-check does not re-validate already-passed steps', async () => {
    // Call GET again -- steps should still be passed, timestamps should not change
    const { body: firstGet } = await json(`/v1/agents/${agent2Name}/onboarding`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const firstTimestamps = firstGet.data.onboarding.steps.map((s: any) => s.validatedAt);

    // Small delay to ensure timestamps would differ if re-validated
    await sleep(50);

    const { body: secondGet } = await json(`/v1/agents/${agent2Name}/onboarding`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const secondTimestamps = secondGet.data.onboarding.steps.map((s: any) => s.validatedAt);

    // All timestamps should be identical (no re-validation)
    for (let i = 0; i < firstTimestamps.length; i++) {
        assert(firstTimestamps[i] === secondTimestamps[i],
            `step ${i} timestamp changed on re-GET: ${firstTimestamps[i]} vs ${secondTimestamps[i]}`);
    }
});

// ─── Task-runner mode: reduced 5-step Hello Integration ───
const runnerName = 'onboard-runner';
let runnerGaii = '';
let runnerToken = '';
let runnerPrivKey = '';

await test('38. Create task-runner agent with mode=task-runner', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: runnerName,
            owner: ownerName,
            capabilities: ['memory'],
            mode: 'task-runner',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    runnerGaii = body.data.agent.gaii;
    runnerPrivKey = body.data.private_key;
    runnerToken = await getToken(runnerGaii, runnerPrivKey, true);
});

await test('39. Task-runner mode is persisted across reads', async () => {
    const { status, body } = await json('/v1/agents', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const runner = body.data.agents.find((a: any) => a.name === runnerName);
    assert(runner, 'task-runner agent missing from list');
    assert(runner.mode === 'task-runner', `expected mode=task-runner, got ${runner.mode}`);
});

await test('40. Task-runner onboarding has exactly 5 steps (reduced flow)', async () => {
    const { status, body } = await json(`/v1/agents/${runnerName}/onboarding/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const steps = body.data.onboarding.steps;
    assert(steps.length === 5, `expected 5 steps, got ${steps.length} (${steps.map((s: any) => s.id).join(',')})`);

    const expectedIds = ['authenticate', 'identify_platform', 'install_skill', 'report_capabilities', 'publish_config'];
    for (const id of expectedIds) {
        assert(steps.find((s: any) => s.id === id), `missing expected step: ${id}`);
    }
    // None of the omitted steps should appear
    const omitted = ['accept_test_task', 'complete_test_task', 'send_test_message', 'configure_delivery', 'report_telemetry', 'publish_commands', 'declare_services', 'read_directives'];
    for (const id of omitted) {
        assert(!steps.find((s: any) => s.id === id), `task-runner should not have step: ${id}`);
    }
});

await test('41. Task-runner auto-completes onboarding when all 5 steps pass', async () => {
    // identify_platform + install_skill require step confirmation (api_call validation)
    for (const [stepId, payload] of [
        ['identify_platform', { platform: 'crewai', platform_version: '0.1' }],
        ['install_skill', { version: 'v2', platform: 'crewai' }],
    ] as [string, Record<string, unknown>][]) {
        const { status, body } = await json(`/v1/agents/${runnerName}/onboarding/step/${stepId}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${runnerToken}` },
            body: JSON.stringify(payload),
        });
        assert(status === 200, `step ${stepId}: status ${status}: ${JSON.stringify(body)}`);
    }

    // report_capabilities + publish_config get auto-validated when underlying state exists
    const { status: capStatus } = await json(`/v1/agents/${runnerName}/capabilities`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${runnerToken}` },
        body: JSON.stringify({
            technical: [{ name: 'task_execution', type: 'tool' }],
            domain: ['marketing'],
        }),
    });
    assert(capStatus === 200, `PUT capabilities failed: ${capStatus}`);

    // publish_config: write agents.config.<name>.runtime memory
    const { status: memStatus, body: memBody } = await json(`/v1/memory`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${runnerToken}` },
        body: JSON.stringify({
            key: `agents.config.${runnerName}.runtime`,
            value: { runner: 'crewai', cwd: '/tmp/crew' },
            visibility: 'owner',
        }),
    });
    assert(memStatus === 200 || memStatus === 201, `POST publish_config memory failed: ${memStatus}: ${JSON.stringify(memBody)}`);

    // GET triggers auto-check -- all 5 should be passed and overall status completed
    const { status, body } = await json(`/v1/agents/${runnerName}/onboarding`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `GET onboarding status ${status}: ${JSON.stringify(body)}`);
    const ob = body.data.onboarding;
    for (const step of ob.steps) {
        assert(step.status === 'passed', `task-runner step ${step.id} should be passed, got ${step.status}`);
    }
    assert(ob.status === 'completed', `expected completed, got ${ob.status}`);
});

// ─── Summary ───
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
