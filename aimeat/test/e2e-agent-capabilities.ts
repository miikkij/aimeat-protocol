// E2E Tests for Agent Capabilities
// Run: cd aimeat && pnpm exec tsx test/e2e-agent-capabilities.ts

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
const ownerName = `capowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'capbot';

console.log('\n=== AIMEAT Agent Capabilities E2E Test ===\n');

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

// ─── Phase 1: PUT capabilities ───
console.log('\nPhase 1 -- PUT Capabilities');

await test('1. PUT capabilities with technical + domain + languages', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/capabilities`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            technical: [
                { name: 'filesystem', type: 'mcp' },
                { name: 'web-search', type: 'tool' },
                { name: 'code-review', type: 'skill' },
            ],
            domain: ['software-engineering', 'data-analysis'],
            languages: ['en', 'fi', 'sv'],
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'response ok');

    const tech = body.data.technical_capabilities;
    assert(Array.isArray(tech), 'technical_capabilities is array');
    assert(tech.length === 3, `expected 3 technical caps, got ${tech.length}`);
    assert(tech[0].name === 'filesystem', `first tech name: ${tech[0].name}`);
    assert(tech[0].type === 'mcp', `first tech type: ${tech[0].type}`);

    const domain = body.data.domain_capabilities;
    assert(Array.isArray(domain), 'domain_capabilities is array');
    // domain entries + language entries merged: 2 domain + 3 languages = 5
    assert(domain.length === 5, `expected 5 domain caps, got ${domain.length}`);
    assert(domain.includes('software-engineering'), 'has software-engineering domain');
    assert(domain.includes('Language: en'), 'has Language: en');
    assert(domain.includes('Language: fi'), 'has Language: fi');
});

// ─── Phase 2: GET capabilities ───
console.log('\nPhase 2 -- GET Capabilities');

await test('2. GET capabilities returns what was set', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/capabilities`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'response ok');

    const tech = body.data.technical_capabilities;
    assert(tech.length === 3, `expected 3 technical caps, got ${tech.length}`);
    assert(tech.some((c: any) => c.name === 'filesystem' && c.type === 'mcp'), 'has filesystem mcp');
    assert(tech.some((c: any) => c.name === 'web-search' && c.type === 'tool'), 'has web-search tool');
    assert(tech.some((c: any) => c.name === 'code-review' && c.type === 'skill'), 'has code-review skill');

    const domain = body.data.domain_capabilities;
    assert(domain.length === 5, `expected 5 domain caps, got ${domain.length}`);
    assert(domain.includes('data-analysis'), 'has data-analysis domain');
    assert(domain.includes('Language: sv'), 'has Language: sv');

    // activity_stats should be present (possibly null if no tasks run)
    assert('activity_stats' in body.data, 'response has activity_stats field');
});

// ─── Phase 3: Overwrite capabilities ───
console.log('\nPhase 3 -- Overwrite Capabilities');

await test('3. Overwrite capabilities (full replace, not merge)', async () => {
    // PUT entirely new capabilities -- should replace, not merge
    const { status, body } = await json(`/v1/agents/${agentName}/capabilities`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            technical: [
                { name: 'database', type: 'tool' },
            ],
            domain: ['devops'],
            languages: ['de'],
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);

    const tech = body.data.technical_capabilities;
    assert(tech.length === 1, `expected 1 technical cap after overwrite, got ${tech.length}`);
    assert(tech[0].name === 'database', `tech name: ${tech[0].name}`);
    assert(tech[0].type === 'tool', `tech type: ${tech[0].type}`);

    const domain = body.data.domain_capabilities;
    // 1 domain + 1 language = 2
    assert(domain.length === 2, `expected 2 domain caps after overwrite, got ${domain.length}`);
    assert(domain.includes('devops'), 'has devops');
    assert(domain.includes('Language: de'), 'has Language: de');

    // Verify old capabilities are gone
    assert(!domain.includes('software-engineering'), 'old domain removed');
    assert(!tech.some((c: any) => c.name === 'filesystem'), 'old tech removed');

    // Verify via GET as well
    const { body: getBody } = await json(`/v1/agents/${agentName}/capabilities`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(getBody.data.technical_capabilities.length === 1, 'GET confirms 1 tech cap');
    assert(getBody.data.domain_capabilities.length === 2, 'GET confirms 2 domain caps');
});

// ─── Phase 4: Empty arrays clear capabilities ───
console.log('\nPhase 4 -- Clear Capabilities');

await test('4. Empty arrays clear capabilities', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/capabilities`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            technical: [],
            domain: [],
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);

    const tech = body.data.technical_capabilities;
    assert(tech.length === 0, `expected 0 technical caps, got ${tech.length}`);

    const domain = body.data.domain_capabilities;
    assert(domain.length === 0, `expected 0 domain caps, got ${domain.length}`);

    // Verify via GET
    const { body: getBody } = await json(`/v1/agents/${agentName}/capabilities`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(getBody.data.technical_capabilities.length === 0, 'GET confirms 0 tech caps');
    assert(getBody.data.domain_capabilities.length === 0, 'GET confirms 0 domain caps');
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
console.log(`Agent Capabilities E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
