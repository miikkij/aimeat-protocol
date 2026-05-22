// E2E Tests for Agent Messages
// Run: cd aimeat && pnpm exec tsx test/e2e-agent-messages.ts

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
const ownerName = `msgowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'msgbot';

let firstMessageId = '';
let firstThreadId = '';

console.log('\n=== AIMEAT Agent Messages E2E Test ===\n');

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

// ─── Phase 1: Send Messages ───
console.log('\nPhase 1 -- Send Messages');

await test('1. Owner sends inbound message', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            direction: 'inbound',
            content: 'Hello agent, please do something for me.',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.direction === 'inbound', `direction: ${body.data.message.direction}`);
    assert(body.data.message.status === 'pending', `status: ${body.data.message.status}`);
    assert(body.data.message.content === 'Hello agent, please do something for me.', 'content matches');
    assert(typeof body.data.message.id === 'string', 'has id');
    assert(typeof body.data.message.threadId === 'string', 'has threadId');
    firstMessageId = body.data.message.id;
    firstThreadId = body.data.message.threadId;
});

await test('2. Agent polls inbox -- pending message appears', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.messages), 'has messages array');
    assert(body.data.messages.length >= 1, `inbox should have >=1 messages, got ${body.data.messages.length}`);
    const pending = body.data.messages.find((m: any) => m.id === firstMessageId);
    assert(pending !== undefined, 'first message appears in inbox');
});

await test('3. Agent sends outbound response', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            direction: 'outbound',
            content: 'Done! Here is the result you asked for.',
            thread_id: firstThreadId,
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.direction === 'outbound', `direction: ${body.data.message.direction}`);
    assert(body.data.message.status === 'delivered', `status: ${body.data.message.status}`);
    assert(body.data.message.threadId === firstThreadId, 'same thread');
});

await test('4. Message with proposed_task metadata', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            direction: 'inbound',
            content: 'Can you scrape this website for me?',
            thread_id: firstThreadId,
            metadata: {
                proposed_task: {
                    title: 'Scrape website',
                    description: 'Scrape https://example.com and return the content',
                },
            },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.metadata !== undefined, 'has metadata');
    assert(body.data.message.metadata.proposedTask !== undefined, 'has proposedTask in metadata');
    assert(body.data.message.metadata.proposedTask.title === 'Scrape website', 'proposedTask title matches');
});

// ─── Phase 2: Update Status ───
console.log('\nPhase 2 -- Update Message Status');

await test('5. Update message status to processing', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages/${firstMessageId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ status: 'processing' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.status === 'processing', `status: ${body.data.message.status}`);
});

await test('6. Update message status to delivered', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages/${firstMessageId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ status: 'delivered' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.status === 'delivered', `status: ${body.data.message.status}`);
    assert(typeof body.data.message.processedAt === 'string', 'has processedAt');
});

// ─── Phase 3: Filtering ───
console.log('\nPhase 3 -- List & Filter');

await test('7. List messages with direction filter (inbound)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages?direction=inbound`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.messages), 'has messages array');
    assert(body.data.messages.length >= 2, `should have >=2 inbound messages, got ${body.data.messages.length}`);
    assert(body.data.messages.every((m: any) => m.direction === 'inbound'), 'all messages are inbound');
});

await test('8. List messages with thread_id filter', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages?thread_id=${firstThreadId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.messages), 'has messages array');
    assert(body.data.messages.length >= 3, `thread should have >=3 messages, got ${body.data.messages.length}`);
    assert(body.data.messages.every((m: any) => m.threadId === firstThreadId), 'all messages in same thread');
});

await test('9. Thread listing', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages/threads`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.threads), 'has threads array');
    assert(body.data.threads.length >= 1, `should have >=1 thread, got ${body.data.threads.length}`);
    const thread = body.data.threads.find((t: any) => t.threadId === firstThreadId);
    assert(thread !== undefined, 'our thread appears in listing');
    assert(thread.messageCount >= 3, `thread should have >=3 messages, got ${thread.messageCount}`);
});

// ─── Phase 4: Consolidated Inbox ───
console.log('\nPhase 4 -- Consolidated Inbox');

await test('10. Consolidated inbox shows pending messages', async () => {
    // Send a new inbound message that will stay pending (not yet processed)
    await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            direction: 'inbound',
            content: 'Another task for you -- this stays pending.',
        }),
    });

    const { status, body } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.pending_messages), 'has pending_messages array');
    assert(body.data.pending_messages.length >= 1, `should have >=1 pending message, got ${body.data.pending_messages.length}`);
    // Each entry should have preview and from fields
    const first = body.data.pending_messages[0];
    assert(typeof first.preview === 'string', 'pending message has preview');
    assert(typeof first.from === 'string', 'pending message has from');
    assert(typeof first.id === 'string', 'pending message has id');
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
console.log(`Agent Messages E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
