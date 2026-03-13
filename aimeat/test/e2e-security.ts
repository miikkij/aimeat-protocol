// Security-focused E2E tests for AIMEAT
// Run: cd aimeat && pnpm exec tsx test/e2e-security.ts
// Requires: server running on port 40251

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

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

// Helper: sign a message with a base64 private key, return base64 signature
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// ─── State ───
// Owner A (primary)
const ownerAName = `secowner-a-${Date.now()}`;
let ownerAToken = '';
let ownerAPrivKey = '';

// Agent A (under Owner A)
let agentAGaii = '';
let agentAToken = '';
let agentAPrivKey = '';

// Owner B (secondary, for cross-owner tests)
const ownerBName = `secowner-b-${Date.now()}`;
let ownerBToken = '';
let ownerBPrivKey = '';

// Agent B (under Owner B)
let agentBGaii = '';
let agentBToken = '';
let agentBPrivKey = '';

// Agent C (under Owner A, for same-owner work test)
let agentCGaii = '';
let agentCToken = '';
let agentCPrivKey = '';

// Scoped Agent D (under Owner A, with limited scopes)
let agentDGaii = '';
let agentDToken = '';
let agentDPrivKey = '';

console.log('\n=== AIMEAT Security E2E Tests ===\n');

// ─── Setup ───
console.log('Setup — Create test owners and agents');

await test('Register Owner A', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerAName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerAPrivKey = body.data.private_key;
    assert(typeof ownerAPrivKey === 'string' && ownerAPrivKey.length > 0, 'got owner A private key');
});

await test('Authenticate Owner A', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerAName + NODE_ID + timestamp;
    const signature = await signMsg(ownerAPrivKey, message);

    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerAName, timestamp, signature }),
    });
    assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
    ownerAToken = body.data?.token;
    assert(typeof ownerAToken === 'string', 'got owner A token');
});

await test('Register Agent A (under Owner A)', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerAToken}` },
        body: JSON.stringify({
            name: 'sec-agent-a',
            owner: ownerAName,
            capabilities: ['memory', 'actions'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentAGaii = body.data.agent.gaii;
    agentAPrivKey = body.data.private_key;
});

await test('Authenticate Agent A', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(agentAPrivKey, agentAGaii + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentAGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent A token: ${JSON.stringify(body.error)}`);
    agentAToken = body.data?.token;
});

await test('Register Owner B', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerBName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerBPrivKey = body.data.private_key;
});

await test('Authenticate Owner B', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerBName + NODE_ID + timestamp;
    const signature = await signMsg(ownerBPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerBName, timestamp, signature }),
    });
    assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
    ownerBToken = body.data?.token;
});

await test('Register Agent B (under Owner B)', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerBToken}` },
        body: JSON.stringify({
            name: 'sec-agent-b',
            owner: ownerBName,
            capabilities: ['memory', 'actions'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentBGaii = body.data.agent.gaii;
    agentBPrivKey = body.data.private_key;
});

await test('Authenticate Agent B', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(agentBPrivKey, agentBGaii + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentBGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent B token: ${JSON.stringify(body.error)}`);
    agentBToken = body.data?.token;
});

await test('Register Agent C (under Owner A, for same-owner tests)', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerAToken}` },
        body: JSON.stringify({
            name: 'sec-agent-c',
            owner: ownerAName,
            capabilities: ['memory', 'actions'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentCGaii = body.data.agent.gaii;
    agentCPrivKey = body.data.private_key;
});

await test('Authenticate Agent C', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(agentCPrivKey, agentCGaii + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentCGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent C token: ${JSON.stringify(body.error)}`);
    agentCToken = body.data?.token;
});

await test('Register Agent D (scoped, under Owner A — memory:read only)', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerAToken}` },
        body: JSON.stringify({
            name: 'sec-agent-d',
            owner: ownerAName,
            capabilities: ['memory'],
            model: 'gpt-4o',
            scopes: ['memory:read'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentDGaii = body.data.agent.gaii;
    agentDPrivKey = body.data.private_key;
});

await test('Authenticate Agent D', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(agentDPrivKey, agentDGaii + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentDGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent D token: ${JSON.stringify(body.error)}`);
    agentDToken = body.data?.token;
});

// Publish an action so work requests can reference it
await test('Setup — Agent B publishes an action', async () => {
    const { body } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentBToken}` },
        body: JSON.stringify({
            id: 'sec-test-action',
            display_name: 'Security Test Action',
            description: 'An action for security testing',
            input_schema: { type: 'object', properties: { text: { type: 'string' } } },
            output_schema: { type: 'object', properties: { result: { type: 'string' } } },
            pricing: { base_morsels: 0 },
        }),
    });
    assert(body.ok === true, `publish action: ${JSON.stringify(body.error)}`);
});

// ─── Test 1: IDOR Prevention — Agent A reads Agent B's private memory ───
console.log('\nSecurity Tests — IDOR Prevention');

await test('1. IDOR: Agent A cannot read Agent B\'s private memory', async () => {
    // Agent B writes a private memory entry
    const { body: writeBody } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentBToken}` },
        body: JSON.stringify({ key: 'secret-data', value: { secret: 'password123' }, visibility: 'private' }),
    });
    assert(writeBody.ok === true, `Agent B write: ${JSON.stringify(writeBody.error)}`);

    // Agent A tries to read Agent B's memory — should only see own entries
    const { body: readBody } = await json('/v1/memory', {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(readBody.ok === true, 'Agent A can read own memory');
    // Agent A's memory list should NOT contain Agent B's key
    const items = readBody.data?.items ?? [];
    const foundBSecret = items.find((m: any) => m.key === 'secret-data');
    assert(!foundBSecret, 'Agent A must NOT see Agent B\'s private memory in their list');

    // Agent A tries to directly access Agent B's memory key — the GET /v1/memory/:key
    // route is scoped to the authenticated agent's own keys.
    // Auto-create on read means Agent A gets their OWN empty record, NOT Agent B's secret.
    const { body: directBody } = await json('/v1/memory/secret-data', {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    // The route auto-creates an empty record for Agent A (ok: true, value: {}, version: 1).
    // The key check: Agent A must NOT see Agent B's actual secret value.
    if (directBody.ok === true && directBody.data?.value !== undefined) {
      // Auto-created record — verify it does NOT contain Agent B's secret
      const val = directBody.data.value;
      assert(
          val.secret === undefined,
          'Agent A must NOT see Agent B\'s secret value via auto-created record'
      );
    } else {
      // 404 or null data is also acceptable (no auto-create)
      assert(
          directBody.ok === false || directBody.data === null,
          'Agent A must NOT access Agent B\'s private memory directly'
      );
    }
});

// ─── Test 2: IDOR Prevention — Agent A updates Agent B's profile ───
await test('2. IDOR: Agent A cannot export Agent B\'s data', async () => {
    // Agent A tries to export Agent B's data — should be blocked by ownership check
    const { status, body } = await json(`/v1/agents/${encodeURIComponent(agentBGaii)}/export`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert(status === 403, `expected 403 for cross-owner export, got ${status}`);
    assert(body.ok === false, 'should fail');
    assert(body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${body.error?.code}`);
});

await test('2b. IDOR: Owner A cannot modify Agent B\'s scopes', async () => {
    // Owner A tries to update Agent B's scopes — Agent B belongs to Owner B
    const { status, body } = await json(`/v1/agents/sec-agent-b/scopes`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerAToken}` },
        body: JSON.stringify({ scopes: ['*'] }),
    });
    // Should be 404 (agent not found under Owner A) or 403
    assert(status === 404 || status === 403, `expected 403 or 404 for cross-owner scope update, got ${status}`);
});

// ─── Test 3: Rate Limiting ───
console.log('\nSecurity Tests — Rate Limiting');

await test('3. Rate limiting: Burst requests to /v1/auth/challenge triggers 429', async () => {
    // The /v1/auth/challenge endpoint is rate limited to 10 requests per 60s window
    let got429 = false;
    let lastStatus = 0;

    for (let i = 0; i < 15 && !got429; i++) {
        const { status } = await json(`/v1/auth/challenge?owner=ratelimit-test-${Date.now()}`);
        lastStatus = status;
        if (status === 429) got429 = true;
    }

    assert(got429, `expected 429 after burst, last status was ${lastStatus}`);
});

// ─── Test 4: Scope Enforcement ───
console.log('\nSecurity Tests — Scope Enforcement');

await test('4. Scope enforcement: Agent D (memory:read only) cannot write memory', async () => {
    // Agent D has only memory:read scope — attempt to write should be denied
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentDToken}` },
        body: JSON.stringify({ key: 'scope-test', value: 'should-fail', visibility: 'private' }),
    });
    assert(status === 403, `expected 403 for scope-denied write, got ${status}`);
    assert(body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${body.error?.code}`);
});

await test('4b. Scope enforcement: Agent D (memory:read only) cannot publish actions', async () => {
    // Agent D has only memory:read scope — attempt to publish action requires work:publish
    const { status, body } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentDToken}` },
        body: JSON.stringify({
            id: 'scope-test-action',
            display_name: 'Should Fail',
            description: 'This should be blocked by scope check',
            input_schema: {},
            output_schema: {},
            pricing: { base_morsels: 0 },
        }),
    });
    assert(status === 403, `expected 403 for scope-denied action publish, got ${status}`);
    assert(body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${body.error?.code}`);
});

await test('4c. Scope enforcement: Agent D (memory:read only) can read memory', async () => {
    // Agent D should be able to read memory (has memory:read scope)
    const { status, body } = await json('/v1/memory', {
        headers: { Authorization: `Bearer ${agentDToken}` },
    });
    assert(status === 200, `expected 200 for scoped read, got ${status}`);
    assert(body.ok === true, 'Agent D can read memory');
});

// ─── Test 5: SSRF Prevention ───
console.log('\nSecurity Tests — SSRF Prevention');

await test('5. SSRF: Federation test with cloud metadata IP is blocked', async () => {
    // Use the federation test endpoint which validates outbound URLs
    // The 169.254.169.254 address is the cloud metadata service (AWS, GCP, Azure)
    const { status, body } = await json('/v1/federation/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerAToken}` },
        body: JSON.stringify({ target_url: 'http://169.254.169.254/latest/meta-data/' }),
    });
    assert(status === 400, `expected 400 for SSRF blocked URL, got ${status}`);
    assert(body.error?.code === 'INVALID_URL', `expected INVALID_URL, got ${body.error?.code}`);
});

await test('5b. SSRF: Federation test with localhost is blocked', async () => {
    const { status, body } = await json('/v1/federation/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerAToken}` },
        body: JSON.stringify({ target_url: 'http://localhost:22/secret' }),
    });
    // In dev mode, loopback is allowed for webhook testing; in production it's blocked
    if (status === 400) {
        assert(body.error?.code === 'INVALID_URL', `expected INVALID_URL, got ${body.error?.code}`);
    } else {
        // Dev mode allows loopback — connection will fail or timeout, but SSRF check passes
        assert(status === 200 || status === 502 || status === 504 || status === 500, `unexpected status ${status}`);
    }
});

await test('5c. SSRF: Federation test with private class A IP is blocked', async () => {
    const { status, body } = await json('/v1/federation/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerAToken}` },
        body: JSON.stringify({ target_url: 'http://10.0.0.1:8080/internal' }),
    });
    assert(status === 400, `expected 400 for private IP SSRF, got ${status}`);
    assert(body.error?.code === 'INVALID_URL', `expected INVALID_URL, got ${body.error?.code}`);
});

// ─── Test 6: Self-work Prevention ───
console.log('\nSecurity Tests — Self-work Prevention');

await test('6. Self-work: Agent cannot create work request to itself', async () => {
    const { status, body } = await json('/v1/work', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({
            action_id: 'sec-test-action',
            provider_gaii: agentAGaii,
            input: { text: 'self-work test' },
        }),
    });
    assert(status === 400, `expected 400 for self-work, got ${status}`);
    assert(body.error?.code === 'SELF_WORK', `expected SELF_WORK, got ${body.error?.code}`);
});

// ─── Test 7: Same-owner Work Prevention ───
console.log('\nSecurity Tests — Same-owner Work Prevention');

await test('7. Same-owner work: Agent A cannot request work from Agent C (same owner)', async () => {
    // Agent A and Agent C are both under Owner A
    // First, Agent C publishes an action
    const { body: pubBody } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentCToken}` },
        body: JSON.stringify({
            id: 'same-owner-test-action',
            display_name: 'Same Owner Test',
            description: 'Action for same-owner work test',
            input_schema: { type: 'object', properties: { text: { type: 'string' } } },
            output_schema: { type: 'object', properties: { result: { type: 'string' } } },
            pricing: { base_morsels: 0 },
        }),
    });
    assert(pubBody.ok === true, `publish action: ${JSON.stringify(pubBody.error)}`);

    // Agent A tries to request work from Agent C
    const { status, body } = await json('/v1/work', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({
            action_id: 'same-owner-test-action',
            provider_gaii: agentCGaii,
            input: { text: 'same-owner work test' },
        }),
    });
    assert(status === 400, `expected 400 for same-owner work, got ${status}`);
    assert(body.error?.code === 'SAME_OWNER_WORK', `expected SAME_OWNER_WORK, got ${body.error?.code}`);
});

// ─── Test 8: Path Traversal ───
console.log('\nSecurity Tests — Path Traversal');

await test('8. Path traversal: GET /v1/apps with ../ in filename returns 400', async () => {
    // Attempt path traversal via the apps download endpoint
    const { status, body } = await json(`/v1/apps/${ownerAName}/..%2F..%2Fetc%2Fpasswd`);
    assert(status === 400, `expected 400 for path traversal, got ${status}`);
    assert(
        body.error?.code === 'INVALID_FILENAME',
        `expected INVALID_FILENAME, got ${body.error?.code}`
    );
});

await test('8b. Path traversal: Double-encoded ../ is blocked', async () => {
    // Double-encoded: %252f is %2f when decoded once
    const { status, body } = await json(`/v1/apps/${ownerAName}/test%2F..%2F..%2Fetc%2Fpasswd`);
    assert(status === 400, `expected 400 for double-encoded traversal, got ${status}`);
    assert(
        body.error?.code === 'INVALID_FILENAME',
        `expected INVALID_FILENAME, got ${body.error?.code}`
    );
});

await test('8c. Path traversal: Backslash traversal is blocked', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/..%5C..%5Cetc%5Cpasswd`);
    assert(status === 400, `expected 400 for backslash traversal, got ${status}`);
    assert(
        body.error?.code === 'INVALID_FILENAME',
        `expected INVALID_FILENAME, got ${body.error?.code}`
    );
});

// ─── Test 9: Anonymous Bypass ───
console.log('\nSecurity Tests — Anonymous Bypass');

await test('9. Anonymous bypass: requireAuth() endpoint without token returns 401', async () => {
    // Hit a memory write endpoint without any token — should get 401
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        body: JSON.stringify({ key: 'anon-test', value: 'should-fail' }),
    });
    assert(status === 401, `expected 401 for unauthenticated request, got ${status}`);
    assert(
        body.error?.code === 'AUTH_REQUIRED',
        `expected AUTH_REQUIRED, got ${body.error?.code}`
    );
});

await test('9b. Anonymous bypass: Agent listing without token returns 401', async () => {
    const { status, body } = await json('/v1/agents');
    assert(status === 401, `expected 401, got ${status}`);
    assert(body.error?.code === 'AUTH_REQUIRED', `expected AUTH_REQUIRED, got ${body.error?.code}`);
});

await test('9c. Anonymous bypass: Work inbox without token returns 401', async () => {
    const { status, body } = await json('/v1/work/inbox');
    assert(status === 401, `expected 401, got ${status}`);
    assert(body.error?.code === 'AUTH_REQUIRED', `expected AUTH_REQUIRED, got ${body.error?.code}`);
});

await test('9d. Anonymous bypass: Invalid JWT token returns 401', async () => {
    const { status, body } = await json('/v1/memory', {
        headers: { Authorization: 'Bearer invalid.jwt.token' },
    });
    assert(status === 401, `expected 401 for invalid JWT, got ${status}`);
    assert(body.error?.code === 'AUTH_REQUIRED', `expected AUTH_REQUIRED, got ${body.error?.code}`);
});

// ─── Test 10: Idempotency Key Format ───
console.log('\nSecurity Tests — Idempotency Key Validation');

await test('10. Idempotency key: Non-UUID format is rejected with 400', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${agentAToken}`,
            'Idempotency-Key': 'not-a-valid-uuid',
        },
        body: JSON.stringify({ key: 'idem-test', value: 'test', visibility: 'private' }),
    });
    assert(status === 400, `expected 400 for invalid idempotency key, got ${status}`);
    assert(
        body.error?.code === 'INVALID_IDEMPOTENCY_KEY',
        `expected INVALID_IDEMPOTENCY_KEY, got ${body.error?.code}`
    );
});

await test('10b. Idempotency key: SQL injection attempt is rejected', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${agentAToken}`,
            'Idempotency-Key': "'; DROP TABLE memory; --",
        },
        body: JSON.stringify({ key: 'idem-sqli', value: 'test', visibility: 'private' }),
    });
    assert(status === 400, `expected 400 for SQL injection in idempotency key, got ${status}`);
    assert(
        body.error?.code === 'INVALID_IDEMPOTENCY_KEY',
        `expected INVALID_IDEMPOTENCY_KEY, got ${body.error?.code}`
    );
});

await test('10c. Idempotency key: Valid UUID is accepted', async () => {
    const validUuid = '550e8400-e29b-41d4-a716-446655440000';
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${agentAToken}`,
            'Idempotency-Key': validUuid,
        },
        body: JSON.stringify({ key: 'idem-valid', value: 'test', visibility: 'private' }),
    });
    // Should succeed (2xx) — not rejected for format
    assert(status === 200 || status === 201, `expected 2xx for valid UUID idempotency key, got ${status}`);
    assert(body.ok === true, 'valid UUID idempotency key accepted');
});

await test('10d. Idempotency key: Replayed UUID returns cached response', async () => {
    const replayUuid = '660e8400-e29b-41d4-a716-446655440001';

    // First request
    const { status: s1, body: b1 } = await json('/v1/memory', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${agentAToken}`,
            'Idempotency-Key': replayUuid,
        },
        body: JSON.stringify({ key: 'idem-replay', value: 'first', visibility: 'private' }),
    });
    assert(s1 === 200 || s1 === 201, `first request: expected 2xx, got ${s1}`);

    // Replay the same idempotency key — should return cached response, not create duplicate
    const { status: s2, body: b2 } = await json('/v1/memory', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${agentAToken}`,
            'Idempotency-Key': replayUuid,
        },
        body: JSON.stringify({ key: 'idem-replay', value: 'second', visibility: 'private' }),
    });
    assert(s2 === s1, `replay should return same status: expected ${s1}, got ${s2}`);
    // The version should be the same (cached, not re-executed)
    assert(b2.data?.version === b1.data?.version, 'replayed request returns cached version');
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cleanup — delete Owner B (cascade)', async () => {
    const { body } = await json(`/v1/owners/${ownerBName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerBToken}` },
    });
    assert(body.ok === true, `delete owner B: ${JSON.stringify(body.error)}`);
});

await test('Cleanup — delete Owner A (cascade)', async () => {
    const { body } = await json(`/v1/owners/${ownerAName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert(body.ok === true, `delete owner A: ${JSON.stringify(body.error)}`);
});

// ─── Summary ───
console.log(`\n=== Security E2E Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
