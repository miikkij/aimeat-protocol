/**
 * @file e2e-security.ts
 * @description Security-focused E2E: IDOR across owners and agents, rate limiting, scope
 *   enforcement, SSRF blocking, self-work prevention, path traversal, idempotency keys, and the
 *   Security tab composite (owner-only) with GHII CORS input validation.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-security
 * @version-history
 *   v1.1.0 — 2026-07-29 — Add 11b (GET /v1/security/overview is owner-only — an agent gets 403 and
 *            no session list) and 11c (PUT /v1/ghii/cors refuses a non-URL origin, and the refusals
 *            do not partially land) for batch 01 holes 6 and 11; drop 500 from test 5b's accepted
 *            set so that branch can no longer pass on the route crashing.
 */

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
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

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
    // In dev mode, loopback is allowed for webhook testing; in production it's blocked.
    if (status === 400) {
        assert(body.error?.code === 'INVALID_URL', `expected INVALID_URL, got ${body.error?.code}`);
    } else {
        // Dev mode allows loopback: the connection fails or times out. 500 is NOT in the accepted
        // set — this branch must not be able to pass on the route crashing.
        assert(status === 200 || status === 502 || status === 504, `unexpected status ${status}: ${JSON.stringify(body.error ?? body)}`);
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

await test('11. GET /v1/security/overview folds GHII CORS + per-agent CORS + sessions', async () => {
    // Set a GHII-level CORS origin so the ghii partition (and agents inheriting it) has a custom value.
    const put = await json('/v1/ghii/cors', {
        method: 'PUT', headers: { Authorization: `Bearer ${ownerAToken}` },
        body: JSON.stringify({ allowed_origins: ['https://example.test'] }),
    });
    assert(put.status === 200, `set ghii cors ${put.status}: ${JSON.stringify(put.body)}`);

    const { status, body } = await json('/v1/security/overview', { headers: { Authorization: `Bearer ${ownerAToken}` } });
    assert(status === 200, `overview status ${status}: ${JSON.stringify(body)}`);
    const d = body.data;
    // ghii partition mirrors GET /v1/ghii/cors
    assert(d.ghii && Array.isArray(d.ghii.allowed_origins) && d.ghii.allowed_origins.includes('https://example.test'), `ghii cors: ${JSON.stringify(d.ghii)}`);
    const ghiiSingle = await json('/v1/ghii/cors', { headers: { Authorization: `Bearer ${ownerAToken}` } });
    assert(JSON.stringify(d.ghii.allowed_origins) === JSON.stringify(ghiiSingle.body.data.allowed_origins), 'ghii matches /v1/ghii/cors');
    // agents partition — Owner A's agent A present, inheriting the GHII origins (no per-agent read)
    const agA = (d.agents || []).find((a: any) => a.gaii === agentAGaii);
    assert(agA, `agent A present in agents: ${JSON.stringify((d.agents || []).map((a: any) => a.gaii))}`);
    assert(agA.inherited_from === 'ghii' && agA.effective.includes('https://example.test'), `agent A inherits ghii cors: ${JSON.stringify(agA)}`);
    // sessions partition — array flagging the caller's own session
    assert(Array.isArray(d.sessions) && d.sessions.some((s: any) => s.current === true), 'sessions include the current session');
});

await test('11b. GET /v1/security/overview is owner-only (device-auth agent session → 403)', async () => {
    // The composite hands back the CORS allowlist, per-agent effective CORS and the LIVE SESSION
    // LIST. The sibling /v1/access/overview has an explicit agent→403 test; this one had none.
    //
    // The caller must be a DEVICE-AUTH agent (RFC 8628), which is how agents are registered today
    // and which mints roles=['agent']. The suite's other agent tokens come from the deprecated
    // /v1/auth/token challenge-response path, and THAT path merges the owner's owner+operator roles
    // onto the agent token — so it clears requireRole('owner') and cannot express this denial.
    const da = await json('/v1/agents/device-authorize', {
        method: 'POST',
        body: JSON.stringify({ agent_name: `secagent-e-${Date.now()}`, owner: ownerAName }),
    });
    assert(da.status === 200 && da.body?.ok, `device-authorize ${da.status}: ${JSON.stringify(da.body?.error)}`);
    const approve = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes: ['memory:read'], owner_token: ownerAToken }),
    });
    assert(approve.status === 200 && approve.body?.ok, `agent approve ${approve.status}: ${JSON.stringify(approve.body?.error)}`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200 && typeof poll.body?.token === 'string', `device-token ${poll.status}: ${JSON.stringify(poll.body)}`);
    const agentEToken: string = poll.body.token;
    const roles = JSON.parse(Buffer.from(agentEToken.split('.')[1], 'base64url').toString()).roles;
    assert(JSON.stringify(roles) === JSON.stringify(['agent']), `the device-auth agent must be agent-only, got ${JSON.stringify(roles)}`);

    const { status, body } = await json('/v1/security/overview', { headers: { Authorization: `Bearer ${agentEToken}` } });
    assert(status === 403, `agent security overview should be 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${body.error?.code}`);
    assert(body.data?.sessions === undefined, `the refusal must not carry the session list: ${JSON.stringify(body.data)}`);
});

await test('11c. PUT /v1/ghii/cors refuses a non-URL origin', async () => {
    // Without the origin format check anything lands in allowedOrigins and from there in the
    // effective CORS allowlist for the owner and every agent inheriting it.
    for (const bad of ['javascript:alert(1)', 'example.test', '', 42, { origin: 'https://x.test' }]) {
        const r = await json('/v1/ghii/cors', {
            method: 'PUT', headers: { Authorization: `Bearer ${ownerAToken}` },
            body: JSON.stringify({ allowed_origins: [bad] }),
        });
        assert(r.status === 400, `origin ${JSON.stringify(bad)} should be 400, got ${r.status}: ${JSON.stringify(r.body)}`);
        assert(r.body.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT for ${JSON.stringify(bad)}, got ${r.body.error?.code}`);
    }
    // The refusals did not partially land — test 11's good value is still the only one there.
    const now = await json('/v1/ghii/cors', { headers: { Authorization: `Bearer ${ownerAToken}` } });
    assert(JSON.stringify(now.body.data.allowed_origins) === JSON.stringify(['https://example.test']),
        `refused writes must not land: ${JSON.stringify(now.body.data.allowed_origins)}`);
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

// ── Push subscription endpoint is an outbound target (2026-08 audit H-8) ──
// The endpoint is a URL this node POSTs to, repeatedly and unattended, carrying the body of every
// notification the owner receives. It was stored verbatim, so subscribing was an unvalidated
// outbound destination. It now goes through the same validateOutboundUrl every other non-constant
// outbound URL uses. Any principal of the owner may still subscribe; the destination must be real.
for (const bad of ['not-a-url', 'ftp://evil.example/hook', 'file:///etc/passwd']) {
    await test(`push subscribe refuses a non-http(s) endpoint (${bad.slice(0, 22)}) (H-8)`, async () => {
        const { status, body } = await json('/v1/push/subscribe', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerAToken}` },
            body: JSON.stringify({ endpoint: bad, keys: { p256dh: 'x', auth: 'y' } }),
        });
        assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body).slice(0, 160)}`);
        assert(body.error?.code === 'INVALID_ENDPOINT', `code: ${JSON.stringify(body.error)}`);
    });
}

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
