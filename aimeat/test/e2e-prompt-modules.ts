/**
 * @file e2e-prompt-modules.ts
 * @description E2E tests for the tier1 prompt module system. Verifies module routes,
 *   bootloader content, module content quality, capabilities extensions (modules_loaded
 *   and limitations), and variable substitution in prompt templates.
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial test suite for tier1 prompt modules
 */

// E2E Tests for Tier1 Prompt Module System
// Run: cd aimeat && pnpm exec tsx test/e2e-prompt-modules.ts

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

// ── State ──
const ownerName = `modowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'modbot';

console.log('\n=== AIMEAT Tier1 Prompt Modules E2E Test ===\n');

// ── Setup ──
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

// ── Phase 1: Module Routes ──
console.log('\nPhase 1 -- Module Route Access');

const VALID_MODULES = ['tasks', 'messages', 'work', 'services', 'memory', 'activity', 'social'];

for (const mod of VALID_MODULES) {
    await test(`GET /v1/prompts/tier1/${mod} returns 200 with prompt`, async () => {
        const { status, body } = await json(`/v1/prompts/tier1/${mod}`, {
            headers: { Authorization: `Bearer ${agentToken}` },
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
        assert(body.ok === true, 'response ok');
        assert(body.data?.tier === '1', `tier is 1, got ${body.data?.tier}`);
        assert(body.data?.module === mod, `module is ${mod}, got ${body.data?.module}`);
        assert(typeof body.data?.system_prompt === 'string', 'has system_prompt');
        assert(body.data.system_prompt.length > 100, `prompt has content (${body.data.system_prompt.length} chars)`);
    });
}

await test('GET /v1/prompts/tier1/nonexistent returns 404', async () => {
    const { status, body } = await json('/v1/prompts/tier1/nonexistent', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.ok === false, 'response not ok');
});

await test('GET /v1/prompts/tier1/tasks without auth returns 401', async () => {
    const { status } = await json('/v1/prompts/tier1/tasks');
    assert(status === 401, `expected 401, got ${status}`);
});

// ── Phase 2: Bootloader Content ──
console.log('\nPhase 2 -- Bootloader Content');

await test('GET /v1/prompts/tier1 returns bootloader with module URLs', async () => {
    const { status, body } = await json('/v1/prompts/tier1', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    const prompt = body.data?.system_prompt as string;
    assert(prompt.includes('BOOT SEQUENCE'), 'has boot sequence');
    assert(prompt.includes('/v1/prompts/tier1/tasks'), 'references tasks module');
    assert(prompt.includes('/v1/prompts/tier1/messages'), 'references messages module');
    assert(prompt.includes('/v1/prompts/tier1/work'), 'references work module');
    assert(prompt.includes('/v1/prompts/tier1/services'), 'references services module');
    assert(prompt.includes('/v1/prompts/tier1/memory'), 'references memory module');
    assert(prompt.includes('/v1/prompts/tier1/activity'), 'references activity module');
    assert(prompt.includes('/v1/prompts/tier1/social'), 'references social module');
    assert(prompt.includes('modules_loaded'), 'mentions modules_loaded capability');
    assert(prompt.includes('limitations'), 'mentions limitations reporting');
});

// ── Phase 3: Module Content Quality ──
console.log('\nPhase 3 -- Module Content Quality');

await test('Tasks module contains required sections', async () => {
    const { body } = await json('/v1/prompts/tier1/tasks', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const prompt = body.data.system_prompt as string;
    assert(prompt.includes('POST /v1/agents/me/tasks/'), 'has task start endpoint');
    assert(prompt.includes('/event'), 'has event endpoint');
    assert(prompt.includes('/complete'), 'has complete endpoint');
    assert(prompt.includes('/fail'), 'has fail endpoint');
    assert(prompt.includes('telemetry'), 'mentions telemetry');
    assert(prompt.includes('tokens_in'), 'mentions token tracking');
    assert(prompt.includes('CAPABILITY REPORT'), 'has capability report section');
});

await test('Messages module contains required sections', async () => {
    const { body } = await json('/v1/prompts/tier1/messages', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const prompt = body.data.system_prompt as string;
    assert(prompt.includes('/messages/inbox'), 'has inbox endpoint');
    assert(prompt.includes('thread_id'), 'mentions threading');
    assert(prompt.includes('proposedTask'), 'mentions proposed tasks');
    assert(prompt.includes('tokens_used'), 'mentions token tracking in messages');
});

await test('Work module covers full lifecycle', async () => {
    const { body } = await json('/v1/prompts/tier1/work', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const prompt = body.data.system_prompt as string;
    assert(prompt.includes('/accept'), 'has accept');
    assert(prompt.includes('/reject'), 'has reject');
    assert(prompt.includes('/deliver'), 'has deliver');
    assert(prompt.includes('/progress'), 'has progress');
    assert(prompt.includes('/rate'), 'has rate');
    assert(prompt.includes('work-to-task bridge'), 'mentions bridge');
});

// ── Phase 4: Capabilities with modules_loaded and limitations ──
console.log('\nPhase 4 -- Capabilities Extensions');

await test('PUT capabilities with modules_loaded and limitations', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/capabilities`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            technical: [
                { name: 'aimeat-tasks', type: 'skill' },
                { name: 'aimeat-messages', type: 'skill' },
                { name: 'http-api-calls', type: 'skill' },
            ],
            domain: ['task management', 'communication'],
            languages: ['en'],
            modules_loaded: ['tasks', 'messages'],
            limitations: ['No persistent watchdog -- polling only during active conversation'],
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.ok === true, 'response ok');
    assert(Array.isArray(body.data.modules_loaded), 'returns modules_loaded');
    assert(body.data.modules_loaded.length === 2, `expected 2 modules, got ${body.data.modules_loaded.length}`);
    assert(body.data.modules_loaded.includes('tasks'), 'has tasks module');
    assert(Array.isArray(body.data.limitations), 'returns limitations');
    assert(body.data.limitations.length === 1, 'has 1 limitation');
});

await test('GET capabilities returns modules_loaded and limitations', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/capabilities`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.data.modules_loaded), 'has modules_loaded');
    assert(body.data.modules_loaded.includes('tasks'), 'persisted tasks module');
    assert(body.data.modules_loaded.includes('messages'), 'persisted messages module');
    assert(Array.isArray(body.data.limitations), 'has limitations');
});

await test('PUT capabilities accumulates modules', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/capabilities`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            technical: [
                { name: 'aimeat-tasks', type: 'skill' },
                { name: 'aimeat-messages', type: 'skill' },
                { name: 'aimeat-work-exchange', type: 'skill' },
                { name: 'http-api-calls', type: 'skill' },
            ],
            domain: ['task management', 'communication', 'work exchange'],
            languages: ['en'],
            modules_loaded: ['tasks', 'messages', 'work'],
            limitations: ['No persistent watchdog -- polling only during active conversation'],
        }),
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.modules_loaded.length === 3, `expected 3 modules, got ${body.data.modules_loaded.length}`);
    assert(body.data.modules_loaded.includes('work'), 'has work module');
});

// ── Phase 5: Variable Substitution ──
console.log('\nPhase 5 -- Variable Substitution');

await test('Module prompts substitute agent-specific variables', async () => {
    const { body } = await json('/v1/prompts/tier1/tasks', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const prompt = body.data.system_prompt as string;
    // Should NOT contain unresolved template variables
    assert(!prompt.includes('{{gaii}}'), 'no unresolved {{gaii}}');
    assert(!prompt.includes('{{node_id}}'), 'no unresolved {{node_id}}');
    assert(!prompt.includes('{{agent_name}}'), 'no unresolved {{agent_name}}');
});

// ── Cleanup ──
console.log('\nCleanup');

await test('Cascade-delete owner', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200 || status === 204, `delete owner: ${status}`);
});

// ── Summary ──
console.log(`\n${'='.repeat(40)}`);
console.log(`  Prompt Modules: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
