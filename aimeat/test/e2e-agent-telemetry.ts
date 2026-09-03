/**
 * @file e2e-agent-telemetry.ts
 * @description E2E tests for agent telemetry endpoints (POST/GET /v1/agents/:name/telemetry).
 *   Tests event creation for llm_call and tool_call types, listing, type filtering,
 *   time-based filtering, and input validation.
 * @version-history
 *   v1.1.0 -- 2026-09-04 -- Phase 4: whose telemetry is it. Both directions, because telemetry
 *     carries what a model was asked and what it cost: a stranger writing into somebody else's
 *     agent poisons their usage record, and a stranger reading it learns what that agent has been
 *     doing. The positive control asserts the refused write did not land anyway, since a 403 that
 *     still writes is the worst of both. One of the 34 seeded into
 *     security/denial-coverage-exemptions.json on 2026-08-15 (quality plan stream B).
 *   v1.0.0 -- 2026-05-23 -- Initial creation
 */

// E2E Tests for Agent Telemetry
// Run: cd aimeat && pnpm exec tsx test/e2e-agent-telemetry.ts

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
const ownerName = `telowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'telbot';

let llmCallId = '';
let toolCallId = '';

console.log('\n=== AIMEAT Agent Telemetry E2E Test ===\n');

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

// ─── Phase 1: Create telemetry events ───
console.log('\nPhase 1 -- Create Telemetry Events');

await test('1. POST llm_call telemetry event -> 201', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            type: 'llm_call',
            data: {
                model: 'claude-opus-4-20250514',
                prompt_tokens: 1200,
                completion_tokens: 450,
                latency_ms: 2300,
            },
            session_id: 'sess-001',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.id === 'string' && body.data.id.length > 0, 'has id');
    llmCallId = body.data.id;
});

await test('2. POST tool_call telemetry event -> 201', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            type: 'tool_call',
            data: {
                tool_name: 'memory_read',
                success: true,
                latency_ms: 120,
            },
            session_id: 'sess-001',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.id === 'string' && body.data.id.length > 0, 'has id');
    toolCallId = body.data.id;
});

// ─── Phase 2: List and filter ───
console.log('\nPhase 2 -- List & Filter');

await test('3. GET telemetry -> 200, both events returned, count = 2', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/telemetry`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.events), 'events is an array');
    assert(body.data.count === 2, `count: ${body.data.count}, expected 2`);
    const ids = body.data.events.map((e: any) => e.id);
    assert(ids.includes(llmCallId), 'contains llm_call event');
    assert(ids.includes(toolCallId), 'contains tool_call event');
});

await test('4. GET telemetry?type=llm_call -> only llm_call events', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/telemetry?type=llm_call`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.count >= 1, `count: ${body.data.count}`);
    assert(
        body.data.events.every((e: any) => e.type === 'llm_call'),
        `not all events are llm_call: ${body.data.events.map((e: any) => e.type).join(', ')}`,
    );
});

await test('5. GET telemetry?since= -> time-filtered results', async () => {
    // Use a timestamp from before our test events -- should return all
    const pastTime = new Date(Date.now() - 60_000).toISOString();
    const { status: statusAll, body: bodyAll } = await json(
        `/v1/agents/${agentName}/telemetry?since=${encodeURIComponent(pastTime)}`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
    );
    assert(statusAll === 200, `status ${statusAll}: ${JSON.stringify(bodyAll)}`);
    assert(bodyAll.data.count >= 2, `expected >= 2 events with past since, got ${bodyAll.data.count}`);

    // Use a timestamp in the future -- should return 0
    const futureTime = new Date(Date.now() + 60_000).toISOString();
    const { status: statusNone, body: bodyNone } = await json(
        `/v1/agents/${agentName}/telemetry?since=${encodeURIComponent(futureTime)}`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
    );
    assert(statusNone === 200, `status ${statusNone}: ${JSON.stringify(bodyNone)}`);
    assert(bodyNone.data.count === 0, `expected 0 events with future since, got ${bodyNone.data.count}`);
});

// ─── Phase 3: Validation ───
console.log('\nPhase 3 -- Validation');

await test('6. POST telemetry with invalid type -> 400', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            type: 'invalid_type',
            data: {},
        }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

// ─── Phase 4: Whose telemetry is it ───
//
// Every call above is this owner writing and reading their own agent's telemetry, so it proves the
// shape of an event and says nothing about the address. Telemetry names the agent in the URL and
// carries what a model was asked and what it cost, which makes both directions worth asking: can a
// stranger WRITE events into somebody else's agent (poisoning their usage record), and can a
// stranger READ them (learning what that agent has been doing).
console.log('\nPhase 4 -- Whose telemetry is it');

const otherOwner = `telother${Date.now()}`;
let otherOwnerToken = '';

await test('7. Register a second owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST', body: JSON.stringify({ name: otherOwner, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    otherOwnerToken = await getToken(otherOwner, body.data.private_key, false);
});

await test('8. A second owner cannot write telemetry into this agent', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
        body: JSON.stringify({ type: 'llm_call', data: { model: 'planted', tokens: 999999 } }),
    });
    assert(status === 403 || status === 404, `expected 403 or 404, got ${status}: ${JSON.stringify(body)}`);
});

await test('9. A second owner cannot read this agent\'s telemetry', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/telemetry`, {
        headers: { Authorization: `Bearer ${otherOwnerToken}` },
    });
    assert(status === 403 || status === 404, `expected 403 or 404, got ${status}: ${JSON.stringify(body)}`);
});

await test('10. An unauthenticated caller cannot read it', async () => {
    const { status } = await json(`/v1/agents/${agentName}/telemetry`);
    assert(status === 401, `expected 401, got ${status}`);
});

await test('11. POSITIVE CONTROL: the owner still reads their own, and nothing was planted', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/telemetry`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `owner read ${status}`);
    const events: any[] = body.data?.events ?? body.data ?? [];
    assert(!JSON.stringify(events).includes('planted'),
        'the refused write landed anyway — a 403 that still wrote is the worst of both');
});

await test('12. Cascade-delete the second owner', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(otherOwner)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${otherOwnerToken}` },
    });
    assert(status === 200, `status ${status}`);
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
console.log(`Agent Telemetry E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
