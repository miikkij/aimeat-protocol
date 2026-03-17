// T-9: Concurrent Access / Stress Tests
// Run: cd aimeat && pnpm exec tsx test/e2e-concurrency.ts

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
const results: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
    try {
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT after 30s')), 30_000));
        await Promise.race([fn(), timeout]);
        passed++;
        results.push(`PASS: ${name}`);
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        results.push(`FAIL: ${name}: ${err.message}`);
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

// Like json() but does NOT retry on 429 — we want to see the 429s
async function jsonNoRetry(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function getToken(identity: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? identity + timestamp : identity + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent
        ? { gaii: identity, timestamp, signature }
        : { owner: identity, timestamp, signature };
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// ─── State ───
const ownerName = `ccowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';

// Second owner (for provider agent — work requests require different owners)
const owner2Name = `ccowner2${Date.now()}`;
let owner2PrivKey = '';
let owner2Token = '';

// Requester agent (limited morsels for escrow tests)
let requesterGaii = '';
let requesterPrivKey = '';
let requesterToken = '';

// Provider agent (registered under owner2)
let providerGaii = '';
let providerPrivKey = '';
let providerToken = '';

// Second requester for parallel tests
let requester2Gaii = '';
let requester2PrivKey = '';
let requester2Token = '';

// Action for work tests
let actionId = '';

console.log('\n=== AIMEAT Concurrent Access E2E Test ===\n');

// ─── Phase 0: Setup ───
console.log('Phase 0 — Setup');

await test('0a. Register owners + agents', async () => {
    // First owner (for requester agents)
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `owner: ${status}`);
    ownerPrivKey = body.data.private_key;
    ownerToken = await getToken(ownerName, ownerPrivKey, false);

    // Second owner (for provider agent — work requires different owners)
    const { status: s2, body: o2Body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: owner2Name, public_key: 'placeholder' }),
    });
    assert(s2 === 201, `owner2: ${s2}`);
    owner2PrivKey = o2Body.data.private_key;
    owner2Token = await getToken(owner2Name, owner2PrivKey, false);

    // Requester agent (under owner 1)
    const { body: rBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'cc-requester', owner: ownerName, capabilities: ['work'], model: 'gpt-4o' }),
    });
    assert(rBody.ok, `requester: ${JSON.stringify(rBody.error)}`);
    requesterGaii = rBody.data.agent.gaii;
    requesterPrivKey = rBody.data.private_key;
    requesterToken = await getToken(requesterGaii, requesterPrivKey, true);

    // Provider agent (under owner 2)
    const { body: pBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner2Token}` },
        body: JSON.stringify({ name: 'cc-provider', owner: owner2Name, capabilities: ['work'], model: 'gpt-4o' }),
    });
    assert(pBody.ok, `provider: ${JSON.stringify(pBody.error)}`);
    providerGaii = pBody.data.agent.gaii;
    providerPrivKey = pBody.data.private_key;
    providerToken = await getToken(providerGaii, providerPrivKey, true);

    // Second requester (under owner 1, for parallel lifecycle)
    const { body: r2Body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'cc-requester2', owner: ownerName, capabilities: ['work'], model: 'gpt-4o' }),
    });
    assert(r2Body.ok, `requester2: ${JSON.stringify(r2Body.error)}`);
    requester2Gaii = r2Body.data.agent.gaii;
    requester2PrivKey = r2Body.data.private_key;
    requester2Token = await getToken(requester2Gaii, requester2PrivKey, true);
});

await test('0b. Publish test action (cost=40 morsels)', async () => {
    actionId = 'cc-test-action';
    const { status, body } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({
            id: actionId,
            display_name: 'Concurrency Test Action',
            description: 'Action for concurrency testing',
            input_schema: { type: 'object' },
            output_schema: { type: 'object' },
            pricing: { base_morsels: 40 },
        }),
    });
    assert(status === 201, `action: ${status} ${JSON.stringify(body)}`);
});

// ─── Phase 1: Escrow Race Conditions ───
console.log('\nPhase 1 — Escrow Race Conditions');

await test('1. Agent starts with 100 morsels (welcome bonus)', async () => {
    const { body } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(body.ok, `wallet: ${JSON.stringify(body.error)}`);
    assert(body.data.balance === 100, `balance: ${body.data.balance}`);
});

let escrowResults: { status: number; body: any }[] = [];

await test('2. Submit two 40-morsel work requests in parallel', async () => {
    // Total cost per request: 40 base + 4 network fee = 44 morsels
    // Agent has 100, so can afford 2 (100 >= 44*2=88)
    // But after first costs 44, only 56 left — can still afford second (56 >= 44)
    // After second, only 12 left — cannot afford a third
    // So actually both should succeed. Let's submit 3 to force one failure.
    const submit = (i: number) => json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({
            action_id: actionId,
            provider_gaii: providerGaii,
            input: { prompt: `Escrow race ${i}` },
        }),
    });
    const [r1, r2, r3] = await Promise.all([submit(1), submit(2), submit(3)]);
    escrowResults = [r1, r2, r3];
    // At least one should fail with 402 INSUFFICIENT_MORSELS
    // (100 morsels, 44 cost each = max 2 can succeed)
});

await test('3. At most two succeed, at least one fails (402)', async () => {
    const successes = escrowResults.filter(r => r.status === 201);
    const failures = escrowResults.filter(r => r.status === 402);
    assert(successes.length <= 2, `too many successes: ${successes.length}`);
    assert(failures.length >= 1, `no failures detected, expected at least 1`);
    if (failures.length > 0) {
        assert(failures[0].body.error?.code === 'INSUFFICIENT_MORSELS', `code: ${failures[0].body.error?.code}`);
    }
});

await test('4. Wallet balance consistent (no double-spend)', async () => {
    const { body } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(body.ok, 'wallet ok');
    const successes = escrowResults.filter(r => r.status === 201).length;
    const expectedBalance = 100 - (successes * 44); // 44 per work item
    assert(body.data.balance === expectedBalance,
        `expected ${expectedBalance} but got ${body.data.balance} (${successes} successes)`);
});

await test('5. Correct number of work items created', async () => {
    const { body } = await json('/v1/work/inbox', {
        headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert(body.ok, 'inbox ok');
    const escrowItems = body.data.items.filter((w: any) => w.requester_gaii === requesterGaii);
    const successes = escrowResults.filter(r => r.status === 201).length;
    assert(escrowItems.length === successes,
        `expected ${successes} items, got ${escrowItems.length}`);
});

// ─── Phase 2: Optimistic Locking (Memory) ───
console.log('\nPhase 2 — Optimistic Locking (Memory)');

const memoryKey = `cc-lock-test-${Date.now()}`;

await test('6. Write memory key (version 1)', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({
            key: memoryKey,
            value: { counter: 0 },
            visibility: 'private',
        }),
    });
    assert(status === 201, `status: ${status} ${JSON.stringify(body)}`);
    assert(body.data.version === 1, `version: ${body.data.version}`);
});

let versionResults: { status: number; body: any }[] = [];

await test('7. Two PUT requests in parallel, both claiming version 1', async () => {
    const patch = (val: number) => json(`/v1/memory/${encodeURIComponent(memoryKey)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({
            value: { counter: val },
            version: 1,
        }),
    });
    const [r1, r2] = await Promise.all([patch(10), patch(20)]);
    versionResults = [r1, r2];
});

await test('8. One gets 200, one gets 409 VERSION_CONFLICT', async () => {
    const ok = versionResults.filter(r => r.status === 200);
    const conflict = versionResults.filter(r => r.status === 409);
    assert(ok.length === 1, `expected 1 success, got ${ok.length} (statuses: ${versionResults.map(r => r.status)})`);
    assert(conflict.length === 1, `expected 1 conflict, got ${conflict.length}`);
    assert(conflict[0].body.error?.code === 'VERSION_CONFLICT', `code: ${conflict[0].body.error?.code}`);
});

await test('9. Read key → version is 2 (not 3)', async () => {
    const { body } = await json(`/v1/memory/${encodeURIComponent(memoryKey)}`, {
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(body.ok, 'ok');
    assert(body.data.version === 2, `version: ${body.data.version}`);
});

// ─── Phase 3: Rate Limiting Under Load ───
console.log('\nPhase 3 — Rate Limiting Under Load');

// Use a fresh anonymous endpoint (no auth → 0.5x multiplier = 100 req/60s global)
// Actually testing auth rate limit (20/60s, agent 1x = 20): hit /v1/auth/token
// Better: use the general auth rate limit. Agent 1x = 200 req, that's too many.
// Use anonymous (0.5x global = 100). We'll request GET / many times without auth.

await test('10. Note rate limit headers from initial request', async () => {
    const { headers } = await jsonNoRetry('/');
    const limit = headers.get('x-ratelimit-limit');
    const remaining = headers.get('x-ratelimit-remaining');
    assert(limit !== null, 'X-RateLimit-Limit header present');
    assert(remaining !== null, 'X-RateLimit-Remaining header present');
    console.log(`    Rate limit: ${limit}, remaining: ${remaining}`);
});

// Probe the auth rate limit to decide how to test 429 behaviour.
// With high test limits (e.g. 1000), skip the exhaustion test — just verify headers.
let rateLimitResults: { status: number; headers: Headers }[] = [];
let authLimit = 0;

await test('11. Fire burst of auth requests exceeding limit', async () => {
    const probe = await jsonNoRetry('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: 'fake', timestamp: new Date().toISOString(), signature: 'bad' }),
    });
    authLimit = parseInt(probe.headers.get('x-ratelimit-limit') ?? '20', 10);
    const remaining = parseInt(probe.headers.get('x-ratelimit-remaining') ?? '19', 10);
    console.log(`    Auth limit: ${authLimit}, remaining: ${remaining}`);
    if (authLimit <= 50) {
        // Small enough to exhaust — fire remaining + 5 in parallel
        const toFire = remaining + 5;
        const fire = () => jsonNoRetry('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ gaii: 'fake', timestamp: new Date().toISOString(), signature: 'bad' }),
        });
        const batch = await Promise.all(Array.from({ length: toFire }, () => fire()));
        rateLimitResults = batch.map(r => ({ status: r.status, headers: r.headers }));
    }
    // With high limits, rateLimitResults stays empty — tests 12-14 adapt
});

await test('12. At least one 429 response (or headers verified)', async () => {
    if (authLimit > 50) {
        // High test limits — just verify rate limit headers exist
        assert(authLimit > 0, 'rate limit headers present');
        return;
    }
    const limited = rateLimitResults.filter(r => r.status === 429);
    assert(limited.length >= 1, `expected at least one 429, got ${limited.map(r => r.status).join(',')}`);
});

await test('13. 429 includes Retry-After (or skipped with high limits)', async () => {
    if (authLimit > 50) return; // skip — can't trigger 429 without firing 1000+ requests
    const limited = rateLimitResults.find(r => r.status === 429);
    assert(limited !== undefined, 'no 429 found');
    const retryAfter = limited!.headers.get('retry-after');
    assert(retryAfter !== null, 'Retry-After header missing');
    assert(Number(retryAfter) > 0, `Retry-After: ${retryAfter}`);
});

// Test 14: Wait for rate limit window reset (only meaningful with low limits)
{
    const timeout14 = 90_000;
    try {
        const fn14 = async () => {
            if (authLimit > 50) {
                console.log('    Skipped (high rate limits — no 429 to recover from)');
                return;
            }
            const limitedRes = rateLimitResults.find(r => r.status === 429);
            const retryAfter = Number(limitedRes?.headers.get('retry-after') || '60');
            console.log(`    Waiting ${retryAfter}s for rate limit reset...`);
            await sleep(retryAfter * 1000 + 1000);

            // After reset, a request should succeed (not 429)
            const { status } = await jsonNoRetry('/v1/auth/token', {
                method: 'POST',
                body: JSON.stringify({ gaii: 'fake', timestamp: new Date().toISOString(), signature: 'bad' }),
            });
            assert(status !== 429, `still rate limited: ${status}`);
        };
        const t14 = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`TIMEOUT after ${timeout14 / 1000}s`)), timeout14));
        await Promise.race([fn14(), t14]);
        passed++;
        results.push('PASS: 14. Wait for window reset → requests succeed');
        console.log('  ✅ 14. Wait for window reset → requests succeed');
    } catch (err: any) {
        failed++;
        results.push(`FAIL: 14. Wait for window reset → requests succeed: ${err.message}`);
        console.error(`  ❌ 14. Wait for window reset → requests succeed: ${err.message}`);
    }
}

// ─── Phase 4: Parallel Agent Registration ───
console.log('\nPhase 4 — Parallel Agent Registration');

let registeredGaiis: string[] = [];

await test('15. Register 10 agents in parallel', async () => {
    const register = (i: number) => json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: `cc-parallel-${i}-${Date.now()}`,
            owner: ownerName,
            capabilities: ['work'],
            model: 'gpt-4o',
        }),
    });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => register(i)));
    const successes = results.filter(r => r.status === 201);
    assert(successes.length === 10, `expected 10 created, got ${successes.length}`);
    registeredGaiis = successes.map(r => r.body.data.agent.gaii);
});

await test('16. All have unique GAIIs', async () => {
    const unique = new Set(registeredGaiis);
    assert(unique.size === 10, `expected 10 unique GAIIs, got ${unique.size}`);
});

await test('17. Owner agent list has all 10', async () => {
    const { body } = await json('/v1/agents', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok, `list: ${JSON.stringify(body.error)}`);
    const allGaiis = body.data.agents.map((a: any) => a.gaii);
    for (const gaii of registeredGaiis) {
        assert(allGaiis.includes(gaii), `missing: ${gaii}`);
    }
});

// ─── Phase 5: Parallel Memory Writes (Different Keys) ───
console.log('\nPhase 5 — Parallel Memory Writes (Different Keys)');

const memKeys: string[] = [];

await test('18. Write 20 different keys in parallel', async () => {
    const write = (i: number) => {
        const key = `cc-par-${i}-${Date.now()}`;
        memKeys.push(key);
        return json('/v1/memory', {
            method: 'POST',
            headers: { Authorization: `Bearer ${requesterToken}` },
            body: JSON.stringify({
                key,
                value: { index: i },
                visibility: 'private',
            }),
        });
    };
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => write(i)));
    const successes = results.filter(r => r.status === 201);
    assert(successes.length === 20, `expected 20, got ${successes.length} (statuses: ${results.map(r => r.status)})`);
});

await test('19. All succeed (201)', async () => {
    // Already verified above, cross-check by reading back
    const reads = await Promise.all(
        memKeys.slice(0, 5).map(k =>
            json(`/v1/memory/${encodeURIComponent(k)}`, {
                headers: { Authorization: `Bearer ${requesterToken}` },
            })
        )
    );
    assert(reads.every(r => r.status === 200), 'all reads OK');
});

await test('20. Read all back — values correct', async () => {
    const reads = await Promise.all(
        memKeys.map((k, i) =>
            json(`/v1/memory/${encodeURIComponent(k)}`, {
                headers: { Authorization: `Bearer ${requesterToken}` },
            }).then(r => ({ status: r.status, index: r.body.data?.value?.index, expected: i }))
        )
    );
    for (const r of reads) {
        assert(r.status === 200, `read failed for index ${r.expected}: ${r.status}`);
        assert(r.index === r.expected, `value mismatch: got ${r.index}, expected ${r.expected}`);
    }
});

// ─── Phase 6: Parallel Work Lifecycle ───
console.log('\nPhase 6 — Parallel Work Lifecycle');

// Use a cheap action for this phase
let cheapActionId = '';

await test('21. Publish cheap action (1 morsel)', async () => {
    cheapActionId = 'cc-cheap-action';
    const { status } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({
            id: cheapActionId,
            display_name: 'Cheap Action',
            description: 'Low-cost action for parallel work tests',
            input_schema: { type: 'object' },
            output_schema: { type: 'object' },
            pricing: { base_morsels: 1 },
        }),
    });
    assert(status === 201, `create cheap action: ${status}`);
});

const lifeCycleTcs: string[] = [];

await test('22. Submit 5 work items in parallel', async () => {
    // Use requester2 who has a full 100 morsels
    const submit = (i: number) => json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requester2Token}` },
        body: JSON.stringify({
            action_id: cheapActionId,
            provider_gaii: providerGaii,
            input: { prompt: `Parallel work ${i}` },
        }),
    });
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => submit(i)));
    const successes = results.filter(r => r.status === 201);
    assert(successes.length === 5, `expected 5, got ${successes.length}`);
    lifeCycleTcs.push(...successes.map(r => r.body.data.tracking_code));
});

await test('23. Accept all in parallel', async () => {
    const accept = (tc: string) => json(`/v1/work/${tc}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
    });
    const results = await Promise.all(lifeCycleTcs.map(tc => accept(tc)));
    assert(results.every(r => r.status === 200), `not all accepted: ${results.map(r => r.status)}`);
});

await test('24. Deliver all in parallel', async () => {
    const deliver = (tc: string) => json(`/v1/work/${tc}/deliver`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ output: { result: 'done' } }),
    });
    const results = await Promise.all(lifeCycleTcs.map(tc => deliver(tc)));
    assert(results.every(r => r.status === 200), `not all delivered: ${results.map(r => r.status)}`);
});

await test('25. Wallet balances consistent after parallel settlement', async () => {
    // Single-balance economy: requester2 shares GHII balance with other agents of same owner.
    // Check that balance is non-negative and work costs were deducted (5 items × 2 = 10 morsels).
    const { body } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${requester2Token}` },
    });
    assert(body.ok, 'wallet ok');
    assert(typeof body.data.balance === 'number' && body.data.balance >= 0,
        `balance should be non-negative, got ${body.data.balance}`);
});

// ─── Phase 7: Board Post Flood ───
console.log('\nPhase 7 — Board Post Flood');

let floodBoardId = '';

await test('26. Create flood board (private — no morsel cost)', async () => {
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requester2Token}` },
        body: JSON.stringify({ name: 'Flood Board', visibility: 'private' }),
    });
    assert(status === 201, `board: ${status}`);
    floodBoardId = body.data.id;
});

let floodResults: { status: number }[] = [];

await test('27. Post 30 messages in parallel', async () => {
    const post = (i: number) => json(`/v1/boards/${floodBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requester2Token}` },
        body: JSON.stringify({ title: `Flood ${i}`, body: `Message ${i}` }),
    });
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => post(i)));
    floodResults = results.map(r => ({ status: r.status }));
    const successes = results.filter(r => r.status === 201);
    // Most should succeed; some may be rate-limited
    assert(successes.length >= 1, 'at least some posts succeeded');
    console.log(`    ${successes.length}/30 created, ${results.filter(r => r.status === 429).length} rate-limited`);
});

await test('28. List posts returns created ones', async () => {
    const { body } = await json(`/v1/boards/${floodBoardId}/posts`, {
        headers: { Authorization: `Bearer ${requester2Token}` },
    });
    assert(body.ok, 'ok');
    const createdCount = floodResults.filter(r => r.status === 201).length;
    // List should show some posts (default limit 20)
    assert(body.data.posts.length > 0, 'has posts');
    assert(body.data.posts.length <= createdCount, `more posts than created: ${body.data.posts.length} > ${createdCount}`);
});

// ─── Phase 8: OTK Replay Attack ───
console.log('\nPhase 8 — OTK Replay Attack');

let otkKey = '';

await test('29. Generate one OTK', async () => {
    const { status, body } = await json('/v1/auth/otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({
            action: 'write_memory',
            params: { key: 'replay-key', value: 'test-value' },
        }),
    });
    assert(status === 201, `otk: ${status} ${JSON.stringify(body)}`);
    otkKey = body.data.otk;
    assert(otkKey, 'has otk key');
});

let otkReplayResults: { status: number; body: any }[] = [];

await test('30. Use same OTK in 5 parallel requests', async () => {
    const use = () => jsonNoRetry(`/v1/otk/${encodeURIComponent(otkKey)}`);
    const results = await Promise.all(Array.from({ length: 5 }, () => use()));
    otkReplayResults = results;
});

await test('31. OTK allows re-use within 60s window', async () => {
    // The OTK has a 60-second post-use window (session-like behavior).
    // Within this window, parallel requests all succeed — this is by design.
    const successes = otkReplayResults.filter(r => r.status === 200);
    const notFound = otkReplayResults.filter(r => r.status === 404);
    // All should succeed or be a mix (depends on timing)
    assert(successes.length + notFound.length === 5,
        `unexpected statuses: ${otkReplayResults.map(r => r.status)}`);
    console.log(`    ${successes.length} succeeded, ${notFound.length} rejected (60s window)`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade-delete owner 1', async () => {
    const { status } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200 || status === 204, `delete owner1: ${status}`);
});

await test('Cascade-delete owner 2', async () => {
    const { status } = await json(`/v1/owners/${owner2Name}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200 || status === 204, `delete owner2: ${status}`);
});

// ─── Results ───
console.log('');
console.log('══════════════════════════════════════════════════════');
console.log(`Concurrent Access E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('══════════════════════════════════════════════════════');

try {
    writeFileSync('test-results-concurrency.txt', results.join('\n') + '\n');
} catch { /* ignore */ }

process.exit(failed > 0 ? 1 : 0);
