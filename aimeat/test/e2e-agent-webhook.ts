// E2E Tests for Agent Webhook CRUD
// Run: cd aimeat && pnpm exec tsx test/e2e-agent-webhook.ts

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
const ownerName = `whkowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'webhookbot';

// A publicly routable test URL that will accept POST (used for registration, not for delivery)
const WEBHOOK_URL = 'https://httpbin.org/post';
// A valid public domain that refuses connections (port 12345 not open)
const UNREACHABLE_URL = 'https://httpbin.org:12345/webhook-test';

console.log('\n=== AIMEAT Agent Webhook E2E Test ===\n');

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

// ─── Phase 1: Register webhook ───
console.log('\nPhase 1 -- Register Webhook');

await test('1. PUT webhook with valid URL (auto-generated secret)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: WEBHOOK_URL }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.url === WEBHOOK_URL, `url: ${body.data.url}`);
    assert(body.data.enabled === true, `enabled: ${body.data.enabled}`);
    // Auto-generated secret should be 64 hex chars (32 bytes)
    assert(typeof body.data.secret === 'string', 'secret is string');
    assert(body.data.secret.length === 64, `secret length: ${body.data.secret.length}`);
    assert(/^[0-9a-f]{64}$/.test(body.data.secret), 'secret is 64 hex chars');
});

// ─── Phase 2: Get webhook status ───
console.log('\nPhase 2 -- Get Webhook Status');

await test('2. GET webhook returns config (no secret exposed)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.configured === true, `configured: ${body.data.configured}`);
    assert(body.data.url === WEBHOOK_URL, `url: ${body.data.url}`);
    assert(body.data.enabled === true, `enabled: ${body.data.enabled}`);
    assert(body.data.fail_count === 0, `fail_count: ${body.data.fail_count}`);
    // GET should NOT expose the secret
    assert(body.data.secret === undefined, `secret should not be in GET response, got: ${body.data.secret}`);
});

// ─── Phase 3: Register with custom secret ───
console.log('\nPhase 3 -- Custom Secret');

await test('3. PUT webhook with custom secret', async () => {
    const customSecret = 'my-custom-secret-that-is-long-enough-for-validation';
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: WEBHOOK_URL, secret: customSecret }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.url === WEBHOOK_URL, `url: ${body.data.url}`);
    assert(body.data.secret === customSecret, `secret: ${body.data.secret}`);
    assert(body.data.enabled === true, `enabled: ${body.data.enabled}`);
});

// ─── Phase 4: Validation ───
console.log('\nPhase 4 -- Validation');

await test('4a. PUT with invalid URL returns 400', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: 'not-a-valid-url' }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

await test('4b. PUT with too-short secret returns 400', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: WEBHOOK_URL, secret: 'short' }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

await test('4c. PUT with missing url returns 400', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

// ─── Phase 5: Test delivery ───
console.log('\nPhase 5 -- Test Delivery');

await test('5. POST webhook test (unreachable URL -> delivered=false)', async () => {
    // First register with an unreachable URL so the test delivery fails
    const { status: putStatus } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: UNREACHABLE_URL }),
    });
    assert(putStatus === 200, `PUT status ${putStatus}`);

    // Now test delivery -- should fail since 192.0.2.1 is non-routable
    const { status, body } = await json(`/v1/agents/${agentName}/webhook/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.delivered === false, `delivered: ${body.data.delivered}`);
    assert(body.data.status === 'failed', `status: ${body.data.status}`);
    assert(typeof body.data.error === 'string' && body.data.error.length > 0, `error: ${body.data.error}`);
    assert(typeof body.data.latency_ms === 'number', `latency_ms type: ${typeof body.data.latency_ms}`);
});

// ─── Phase 6: Delivery log ───
console.log('\nPhase 6 -- Delivery Log');

await test('6. GET webhook log returns deliveries', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook/log`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.deliveries), 'deliveries is an array');
    assert(body.data.deliveries.length >= 1, `deliveries count: ${body.data.deliveries.length}`);
    // Check the most recent delivery entry
    const latest = body.data.deliveries[0];
    assert(latest.event === 'webhook.test', `event: ${latest.event}`);
    assert(typeof latest.status === 'string', `status type: ${typeof latest.status}`);
    assert(typeof latest.latencyMs === 'number' || typeof latest.latency_ms === 'number',
        'has latency field');
});

// ─── Phase 7: Delete webhook ───
console.log('\nPhase 7 -- Delete Webhook');

await test('7. DELETE webhook', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.removed === true, `removed: ${body.data.removed}`);
});

// ─── Phase 8: Verify removal ───
console.log('\nPhase 8 -- Verify Removal');

await test('8. GET webhook after DELETE shows not configured', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.configured === false, `configured: ${body.data.configured}`);
});

await test('9. POST webhook test without webhook returns 400', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

// ─── Phase 9: Agent can manage its own webhook ───
console.log('\nPhase 9 -- Agent Self-Management');

await test('10. Agent can PUT its own webhook', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ url: WEBHOOK_URL }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.url === WEBHOOK_URL, `url: ${body.data.url}`);
    assert(body.data.enabled === true, `enabled: ${body.data.enabled}`);
});

await test('11. Agent can GET its own webhook', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.configured === true, `configured: ${body.data.configured}`);
    assert(body.data.url === WEBHOOK_URL, `url: ${body.data.url}`);
});

await test('12. Agent can DELETE its own webhook', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.removed === true, `removed: ${body.data.removed}`);
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
console.log(`Agent Webhook E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
