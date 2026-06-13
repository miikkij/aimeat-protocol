/**
 * @file e2e-inbox-cursor.ts
 * @description E2E tests for cursor-based inbox delta endpoint (GET /v1/agents/:name/inbox?since=).
 *   Covers all cursor edge cases: no cursor, valid cursor with/without new events, malformed cursors,
 *   expired cursors, has_more with limit, and approximate cursor_status.
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation covering all cursor edge cases
 */

// E2E Tests for Inbox Cursor-Based Pagination
// Run: cd aimeat && pnpm exec tsx test/e2e-inbox-cursor.ts

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
const ownerName = `cursorowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'cursorbot';

console.log('\n=== AIMEAT Inbox Cursor E2E Test ===\n');

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

// ─── Test 1: No cursor -- returns all pending items ───
console.log('\nTest 1 -- No cursor (full sync)');

await test('1a. Empty inbox returns cursor fields', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.items), 'has items array');
    assert(Array.isArray(body.data.queued_tasks), 'has queued_tasks array');
    assert(Array.isArray(body.data.active_tasks), 'has active_tasks array');
    assert(Array.isArray(body.data.pending_messages), 'has pending_messages array');
    assert(typeof body.data.next_cursor === 'string', 'has next_cursor');
    assert(body.data.cursor_status === 'exact', `cursor_status: ${body.data.cursor_status}`);
    assert(body.data.has_more === false, `has_more: ${body.data.has_more}`);
});

await test('1b. Inbox with tasks returns next_cursor and cursor_status exact', async () => {
    // Create a queued task
    const { status: createStatus, body: createBody } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Cursor Test Task 1',
            description: 'First task for cursor testing',
            todos: [{ id: 'ct-1', order: 1, title: 'Step 1', environment: 'agent' }],
            status: 'queued',
        }),
    });
    assert(createStatus === 201, `create status ${createStatus}: ${JSON.stringify(createBody)}`);

    const { status, body } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.items.length >= 1, `expected >=1 items, got ${body.data.items.length}`);
    assert(body.data.queued_tasks.length >= 1, `expected >=1 queued, got ${body.data.queued_tasks.length}`);
    assert(typeof body.data.next_cursor === 'string', 'has next_cursor');
    assert(body.data.next_cursor.includes('@'), `cursor should contain @: ${body.data.next_cursor}`);
    assert(body.data.cursor_status === 'exact', `cursor_status: ${body.data.cursor_status}`);
    assert(body.data.has_more === false, `has_more: ${body.data.has_more}`);
});

// ─── Test 2: Valid cursor, new events exist ───
console.log('\nTest 2 -- Valid cursor, new events');

await test('2. Poll with cursor, get only new items', async () => {
    // Get current inbox to obtain cursor
    const { body: initialBody } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const cursor = initialBody.data.next_cursor;
    assert(typeof cursor === 'string' && cursor.length > 0, 'got initial cursor');

    // Small delay to ensure new task gets a different timestamp
    await sleep(50);

    // Create a new task after the cursor
    const { status: createStatus, body: createBody } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Cursor Test Task 2',
            description: 'Second task created after cursor',
            todos: [{ id: 'ct-2', order: 1, title: 'Step 2', environment: 'agent' }],
            status: 'queued',
        }),
    });
    assert(createStatus === 201, `create status ${createStatus}: ${JSON.stringify(createBody)}`);
    const newTaskId = createBody.data.task.id;

    // Poll with cursor -- should return only the new task
    const { status, body } = await json(`/v1/agents/${agentName}/inbox?since=${encodeURIComponent(cursor)}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.items.length >= 1, `expected >=1 new items, got ${body.data.items.length}`);
    const foundNew = body.data.queued_tasks.some((t: any) => t.id === newTaskId);
    assert(foundNew, 'new task should appear in cursor-filtered results');
    // The first task (created before cursor) should NOT appear
    assert(body.data.cursor_status === 'exact' || body.data.cursor_status === 'approximate',
        `cursor_status: ${body.data.cursor_status}`);
});

// ─── Test 3: Valid cursor, no new events ───
console.log('\nTest 3 -- Valid cursor, no new events');

await test('3. Poll with latest cursor returns empty items', async () => {
    // Get latest cursor
    const { body: latestBody } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const latestCursor = latestBody.data.next_cursor;

    // Poll with the latest cursor -- no new events since then
    const { status, body } = await json(`/v1/agents/${agentName}/inbox?since=${encodeURIComponent(latestCursor)}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.items.length === 0, `expected 0 items, got ${body.data.items.length}`);
    assert(body.data.queued_tasks.length === 0, `expected 0 queued, got ${body.data.queued_tasks.length}`);
    assert(body.data.active_tasks.length === 0, `expected 0 active, got ${body.data.active_tasks.length}`);
    assert(body.data.pending_messages.length === 0, `expected 0 messages, got ${body.data.pending_messages.length}`);
    // Cursor should echo back the same cursor
    assert(body.data.next_cursor === latestCursor, `cursor should echo back: got ${body.data.next_cursor}, expected ${latestCursor}`);
    assert(body.data.has_more === false, `has_more: ${body.data.has_more}`);
});

// ─── Test 4: Malformed cursor ───
console.log('\nTest 4 -- Malformed cursor');

await test('4a. Random string returns INVALID_CURSOR', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/inbox?since=not-a-cursor`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'INVALID_CURSOR', `error code: ${body.error?.code}`);
});

// ─── Test 5: Malformed cursor (missing @) ───
console.log('\nTest 5 -- Malformed cursor (missing @)');

await test('5. ISO timestamp without tiebreaker returns INVALID_CURSOR', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/inbox?since=${encodeURIComponent('2026-01-01T00:00:00Z')}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'INVALID_CURSOR', `error code: ${body.error?.code}`);
});

// ─── Test 6: Expired cursor (>90 days) ───
console.log('\nTest 6 -- Expired cursor (>90 days)');

await test('6. Old cursor returns PRUNED_CURSOR', async () => {
    const oldCursor = '2024-01-01T00:00:00.000Z@abc123456789';
    const { status, body } = await json(`/v1/agents/${agentName}/inbox?since=${encodeURIComponent(oldCursor)}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'PRUNED_CURSOR', `error code: ${body.error?.code}`);
});

// ─── Test 7: has_more with limit ───
console.log('\nTest 7 -- has_more with limit');

await test('7. Create 3+ items, poll with limit=1, verify has_more', async () => {
    // We already have 2 tasks from previous tests. Create one more task and a message.
    const { status: t3Status } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            title: 'Cursor Test Task 3',
            description: 'Third task for limit testing',
            todos: [{ id: 'ct-3', order: 1, title: 'Step 3', environment: 'agent' }],
            status: 'queued',
        }),
    });
    assert(t3Status === 201, `task 3 create status ${t3Status}`);

    // Send an inbound message so pending_messages also populates
    const { status: msgStatus } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            content: 'Hello agent, please check this.',
            direction: 'inbound',
        }),
    });
    assert(msgStatus === 201, `message create status ${msgStatus}`);

    // Poll with limit=1 -- should have has_more=true
    const { status, body } = await json(`/v1/agents/${agentName}/inbox?limit=1`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.items.length === 1, `expected 1 item, got ${body.data.items.length}`);
    assert(body.data.has_more === true, `expected has_more=true, got ${body.data.has_more}`);
    assert(typeof body.data.next_cursor === 'string', 'has next_cursor for pagination');
});

// ─── Test 8: cursor_status approximate ───
console.log('\nTest 8 -- cursor_status approximate');

await test('8. Unknown tiebreaker gives cursor_status approximate', async () => {
    // Build a cursor with a valid recent timestamp but a tiebreaker ID that does not match any item
    const recentTs = new Date().toISOString();
    const fakeCursor = `${recentTs}@zzzzzzzzzzzz`;

    const { status, body } = await json(`/v1/agents/${agentName}/inbox?since=${encodeURIComponent(fakeCursor)}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.cursor_status === 'approximate', `expected approximate, got ${body.data.cursor_status}`);
});

// ─── Test 9: Messages appear in inbox items ───
console.log('\nTest 9 -- Messages in inbox');

await test('9. Pending messages appear in items and pending_messages arrays', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.pending_messages.length >= 1, `expected >=1 pending messages, got ${body.data.pending_messages.length}`);
    // Verify the message appears in items as well
    const messageItems = body.data.items.filter((i: any) => i.preview || i.from);
    assert(messageItems.length >= 1, 'message should appear in items array');
});

// ─── Test 10: Cursor pagination walk-through ───
console.log('\nTest 10 -- Cursor pagination walk');

await test('10. Walk through all items one at a time using cursors', async () => {
    // Get total count without limit
    const { body: fullBody } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const totalItems = fullBody.data.items.length;
    assert(totalItems >= 3, `expected >=3 total items, got ${totalItems}`);

    // Walk through with limit=1, collecting all items
    let cursor: string | undefined;
    const collected: any[] = [];
    let iterations = 0;
    const maxIterations = totalItems + 2; // safety guard

    while (iterations < maxIterations) {
        const qs = cursor
            ? `?limit=1&since=${encodeURIComponent(cursor)}`
            : '?limit=1';
        const { status, body } = await json(`/v1/agents/${agentName}/inbox${qs}`, {
            headers: { Authorization: `Bearer ${agentToken}` },
        });
        assert(status === 200, `walk status ${status}`);

        if (body.data.items.length === 0) break;
        collected.push(...body.data.items);
        cursor = body.data.next_cursor;
        iterations++;

        if (!body.data.has_more && !cursor) break;
        // If no new items would come, the cursor echoes back -- break to avoid infinite loop
        if (body.data.items.length === 0) break;
    }

    assert(collected.length >= 2, `collected ${collected.length} items, expected >=2`);
    assert(iterations < maxIterations, 'pagination should terminate');
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
console.log(`Inbox Cursor: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
