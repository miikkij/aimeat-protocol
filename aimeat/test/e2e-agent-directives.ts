// E2E Tests for Agent Directives
// Run: cd aimeat && pnpm exec tsx test/e2e-agent-directives.ts

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
const ownerName = `dirowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'dirbot';

console.log('\n=== AIMEAT Agent Directives E2E Test ===\n');

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

// ─── Phase 1: Owner Defaults ───
console.log('\nPhase 1 -- Owner Defaults');

await test('1. Set owner defaults', async () => {
    const { status, body } = await json('/v1/owner/agent-defaults', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            rules: [
                { id: 'owner-rule-1', description: 'Ask before destructive operations' },
                { id: 'owner-rule-2', description: 'Always use Finnish locale', details: 'Set Accept-Language header' },
            ],
            default_token_budget: 50000,
            default_memory_areas: [
                { key_prefix: 'logs.', description: 'Agent activity logs' },
            ],
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.defaults.rules.length === 2, `rules count: ${body.data.defaults.rules.length}`);
    assert(body.data.defaults.default_token_budget === 50000, `budget: ${body.data.defaults.default_token_budget}`);
    assert(body.data.defaults.default_memory_areas.length === 1, `memory areas: ${body.data.defaults.default_memory_areas.length}`);
});

await test('2. Get owner defaults', async () => {
    const { status, body } = await json('/v1/owner/agent-defaults', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.defaults.rules.length === 2, `rules count: ${body.data.defaults.rules.length}`);
    assert(body.data.defaults.rules[0].id === 'owner-rule-1', `first rule id: ${body.data.defaults.rules[0].id}`);
    assert(body.data.defaults.default_token_budget === 50000, `budget: ${body.data.defaults.default_token_budget}`);
});

// ─── Phase 2: Agent Directives ───
console.log('\nPhase 2 -- Agent Directives');

await test('3. Set agent directives', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/directives`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            purpose: 'Research assistant specializing in Finnish business data',
            rules: [
                { id: 'agent-rule-1', description: 'Prefer Finnish sources' },
                { id: 'agent-rule-2', description: 'Cite all data sources', details: 'Include URL and date' },
            ],
            memory_areas: [
                { key_prefix: 'research.', description: 'Research findings', csm_id: 'research-v1' },
                { key_prefix: 'cache.', description: 'Cached API responses' },
            ],
            resources: [
                { type: 'knowledge_package', reference: 'finnish-business-guide', description: 'Finnish business practices' },
            ],
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.directives.purpose === 'Research assistant specializing in Finnish business data',
        `purpose: ${body.data.directives.purpose}`);
    assert(body.data.directives.rules.length === 2, `rules count: ${body.data.directives.rules.length}`);
    assert(body.data.directives.memory_areas.length === 2, `memory areas: ${body.data.directives.memory_areas.length}`);
    assert(body.data.directives.resources.length === 1, `resources: ${body.data.directives.resources.length}`);
});

await test('4. Get merged directives -- all three layers', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/directives`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);

    // Verify purpose from agent-level directives
    assert(body.data.purpose === 'Research assistant specializing in Finnish business data',
        `purpose: ${body.data.purpose}`);

    // Verify rules from all three layers
    const rules = body.data.rules;
    const systemRules = rules.filter((r: any) => r.source === 'system');
    const ownerRules = rules.filter((r: any) => r.source === 'owner');
    const agentRules = rules.filter((r: any) => r.source === 'agent');

    assert(systemRules.length >= 1, `system rules count: ${systemRules.length}`);
    assert(ownerRules.length === 2, `owner rules count: ${ownerRules.length}`);
    assert(agentRules.length === 2, `agent rules count: ${agentRules.length}`);

    // Verify memory areas from agent-level
    assert(body.data.memory_areas.length === 2, `memory areas: ${body.data.memory_areas.length}`);
    assert(body.data.memory_areas[0].key_prefix === 'research.', `first area prefix: ${body.data.memory_areas[0].key_prefix}`);

    // Verify resources from agent-level
    assert(body.data.resources.length === 1, `resources: ${body.data.resources.length}`);
});

await test('5. System rules appear in merged view', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/directives`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);

    const systemRules = body.data.rules.filter((r: any) => r.source === 'system');
    assert(systemRules.length >= 1, `expected at least 1 system rule, got ${systemRules.length}`);

    // System rules should have system-N id format
    assert(systemRules[0].id.startsWith('system-'), `system rule id: ${systemRules[0].id}`);

    // System rules should come first in the array (before owner and agent rules)
    const firstSystemIndex = body.data.rules.findIndex((r: any) => r.source === 'system');
    const firstOwnerIndex = body.data.rules.findIndex((r: any) => r.source === 'owner');
    const firstAgentIndex = body.data.rules.findIndex((r: any) => r.source === 'agent');
    assert(firstSystemIndex < firstOwnerIndex, `system rules (${firstSystemIndex}) should come before owner rules (${firstOwnerIndex})`);
    assert(firstOwnerIndex < firstAgentIndex, `owner rules (${firstOwnerIndex}) should come before agent rules (${firstAgentIndex})`);
});

await test('6. Update agent directives', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/directives`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            purpose: 'Updated research assistant',
            rules: [
                { id: 'agent-rule-3', description: 'New rule after update' },
            ],
            memory_areas: [],
            resources: [],
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.directives.purpose === 'Updated research assistant', `purpose: ${body.data.directives.purpose}`);
    assert(body.data.directives.rules.length === 1, `rules count: ${body.data.directives.rules.length}`);
    assert(body.data.directives.rules[0].id === 'agent-rule-3', `rule id: ${body.data.directives.rules[0].id}`);

    // Verify merged view reflects update
    const { body: mergedBody } = await json(`/v1/agents/${agentName}/directives`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const agentRules = mergedBody.data.rules.filter((r: any) => r.source === 'agent');
    assert(agentRules.length === 1, `agent rules after update: ${agentRules.length}`);
    assert(agentRules[0].id === 'agent-rule-3', `agent rule id: ${agentRules[0].id}`);
});

await test('6b. Partial update MERGES -- omitted fields are preserved', async () => {
    // After test 6: purpose='Updated research assistant', rules=[agent-rule-3], memory_areas=[].
    // Send ONLY memory_areas (as the Data Access tab does). purpose + rules must survive.
    const { status } = await json(`/v1/agents/${agentName}/directives`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            memory_areas: [{ key_prefix: 'merged.', description: 'partial update area' }],
        }),
    });
    assert(status === 200, `status ${status}`);

    const { body } = await json(`/v1/agents/${agentName}/directives`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    // Agent-level fields set earlier must NOT have been wiped by the partial PUT.
    assert(body.data.purpose === 'Updated research assistant', `purpose clobbered: ${body.data.purpose}`);
    const agentRules = body.data.rules.filter((r: any) => r.source === 'agent');
    assert(agentRules.length === 1 && agentRules[0].id === 'agent-rule-3', `agent rule clobbered: ${JSON.stringify(agentRules)}`);
    // And the memory area we sent is now present.
    assert(body.data.memory_areas.some((m: any) => m.key_prefix === 'merged.'), `memory area not saved: ${JSON.stringify(body.data.memory_areas)}`);

    // Now send ONLY rules (as the Directives tab does); the memory area must survive.
    await json(`/v1/agents/${agentName}/directives`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ rules: [{ id: 'behavioral', description: '## Rules\n1. Be careful' }] }),
    });
    const { body: after } = await json(`/v1/agents/${agentName}/directives`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(after.data.memory_areas.some((m: any) => m.key_prefix === 'merged.'), `memory area wiped by rules update: ${JSON.stringify(after.data.memory_areas)}`);
    const aRules = after.data.rules.filter((r: any) => r.source === 'agent');
    assert(aRules.length === 1 && aRules[0].id === 'behavioral', `behavioral rule not saved: ${JSON.stringify(aRules)}`);
});

// ─── Phase 3: Delete ───
console.log('\nPhase 3 -- Delete');

await test('7. Delete agent directives', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/directives`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.deleted === true, 'deleted should be true');
});

await test('8. Get merged after delete -- only system + owner rules remain', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/directives`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);

    // Purpose should be empty (no agent directives)
    assert(body.data.purpose === '', `purpose should be empty: ${body.data.purpose}`);

    // Only system + owner rules should remain
    const agentRules = body.data.rules.filter((r: any) => r.source === 'agent');
    assert(agentRules.length === 0, `agent rules should be 0: ${agentRules.length}`);

    const systemRules = body.data.rules.filter((r: any) => r.source === 'system');
    assert(systemRules.length >= 1, `system rules should exist: ${systemRules.length}`);

    const ownerRules = body.data.rules.filter((r: any) => r.source === 'owner');
    assert(ownerRules.length === 2, `owner rules should remain: ${ownerRules.length}`);

    // Memory areas and resources should be empty
    assert(body.data.memory_areas.length === 0, `memory areas should be 0: ${body.data.memory_areas.length}`);
    assert(body.data.resources.length === 0, `resources should be 0: ${body.data.resources.length}`);
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
console.log(`Agent Directives E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
