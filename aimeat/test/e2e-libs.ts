/**
 * @file test/e2e-libs.ts
 * @description E2E tests for the served browser helper libraries (data, storage, social, wallet,
 *   work, markdown, organism, editor, commerce): exercises the same API calls the libraries make
 *   plus the /v1/libs catalogue and the generated JS sources themselves.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=libs
 * @version-history
 *   v1.3.0 — 2026-07-28 — aimeat-game.js coverage: every component exported, the NO-NETWORK and
 *     NO-HARDCODED-COLOUR boundary guards (the two promises the library makes and the two an
 *     edit could quietly break), the EN+FI strings, the --ag-* theming contract and its imported
 *     stylesheet parts, and the registry entry declaring no dependencies.
 *   v1.2.0 — 2026-07-28 — aimeat-exchange.js coverage (served source, every wrapped group, the
 *     no-duplication-of-commerce guard, and the registry entry with both dependencies)
 *   v1.1.0 — 2026-07-14 — aimeat-commerce.js coverage (served source + catalogue entry)
 *   v1.0.0 — 2026-07-14 — Header added; file pre-dates header standard
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

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

async function api(path: string, opts: RequestInit = {}): Promise<any> {
    const url = `${BASE}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> ?? {}) };
    const res = await fetch(url, { ...opts, headers });
    const data = await res.json() as any;
    return { ...data, _status: res.status };
}

async function authApi(path: string, jwt: string, opts: RequestInit = {}): Promise<any> {
    return api(path, { ...opts, headers: { ...(opts.headers as Record<string, string> ?? {}), Authorization: `Bearer ${jwt}` } });
}

async function rawFetch(path: string, jwt: string, opts: RequestInit = {}): Promise<Response> {
    return fetch(`${BASE}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${jwt}`, ...(opts.headers as Record<string, string> ?? {}) },
    });
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// ─── Setup: Register owner + agent ───

const username = `libtest${Date.now()}`;
let ownerPrivKey = '';
let ownerJwt = '';
let agentGaii = '';
let agentPrivKey = '';
let agentJwt = '';

// Second owner for cross-owner work tests
const username2 = `libtest2${Date.now()}`;
let ownerPrivKey2 = '';
let ownerJwt2 = '';

console.log(`\n=== AIMEAT Helper Libraries E2E Test ===\n`);
console.log(`Server: ${BASE}`);
console.log(`Username: ${username}\n`);

// Setup
console.log('Setup — Register owner & agent');

await test('Register owner via GHII', async () => {
    const data = await api('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username, display_name: 'Lib Test User' }),
    });
    assert(data.ok === true, `Registration failed: ${data.error?.message}`);
    ownerPrivKey = data.data.private_key;
});

await test('Get owner JWT', async () => {
    const timestamp = new Date().toISOString();
    const message = username + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);
    const data = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: username, timestamp, signature }),
    });
    assert(data.ok === true, `Owner auth failed: ${data.error?.message}`);
    ownerJwt = data.data.token;
});

await test('Register agent', async () => {
    const data = await authApi('/v1/agents', ownerJwt, {
        method: 'POST',
        body: JSON.stringify({ name: 'app', owner: username, display_name: 'Test App' }),
    });
    assert(data.ok === true, `Agent registration failed: ${data.error?.message}`);
    agentGaii = data.data.agent.gaii;
    agentPrivKey = data.data.private_key;
});

await test('Get agent JWT', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const data = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(data.ok === true, `Agent auth failed: ${data.error?.message}`);
    agentJwt = data.data.token;
});

// ═══════════════════════════════════════════════
// Phase 1: aimeat-data.js (Memory + Micro-Memory)
// ═══════════════════════════════════════════════
console.log('\n─── Phase 1: aimeat-data.js ───');

await test('data.set — write memory entry', async () => {
    const data = await authApi('/v1/memory', agentJwt, {
        method: 'POST',
        body: JSON.stringify({ key: 'todo.list', value: [{ text: 'Buy milk', done: false }], visibility: 'private' }),
    });
    assert(data.ok === true, `Set failed: ${data.error?.message}`);
    assert(data.data.key === 'todo.list', 'key mismatch');
});

await test('data.get — read memory entry', async () => {
    const data = await authApi('/v1/memory/todo.list', agentJwt);
    assert(data.ok === true, `Get failed: ${data.error?.message}`);
    assert(Array.isArray(data.data.value), 'value should be array');
    assert(data.data.value[0].text === 'Buy milk', 'value mismatch');
});

await test('data.set — write public memory', async () => {
    const data = await authApi('/v1/memory', agentJwt, {
        method: 'POST',
        body: JSON.stringify({ key: 'profile.bio', value: 'Hello world', visibility: 'public' }),
    });
    assert(data.ok === true, `Set public failed: ${data.error?.message}`);
});

await test('data.getPublic — read public memory (no auth)', async () => {
    const data = await api(`/v1/memory/${encodeURIComponent(agentGaii)}/profile.bio`);
    assert(data.ok === true, `Public read failed: ${data.error?.message}`);
    assert(data.data.value === 'Hello world', 'public value mismatch');
});

await test('data.list — list memory keys', async () => {
    const data = await authApi('/v1/memory', agentJwt);
    assert(data.ok === true, `List failed: ${data.error?.message}`);
    assert(data.data.items.length >= 2, 'should have at least 2 items');
});

await test('data.search — search memory', async () => {
    const data = await authApi('/v1/memory/search?q=todo', agentJwt);
    assert(data.ok === true, `Search failed: ${data.error?.message}`);
    assert(data.data.results.length >= 1, 'should find at least 1 result');
});

await test('data.update — optimistic locking update', async () => {
    // Get current version
    const entry = await authApi('/v1/memory/todo.list', agentJwt);
    const version = entry.data.version;

    const data = await authApi('/v1/memory/todo.list', agentJwt, {
        method: 'PUT',
        body: JSON.stringify({ value: [{ text: 'Buy milk', done: true }], version }),
    });
    assert(data.ok === true, `Update failed: ${data.error?.message}`);
});

await test('data.update — version conflict (409)', async () => {
    const data = await authApi('/v1/memory/todo.list', agentJwt, {
        method: 'PUT',
        body: JSON.stringify({ value: 'stale', version: 0 }),
    });
    assert(data.ok === false, 'should fail with version conflict');
    assert(data._status === 409, `expected 409, got ${data._status}`);
});

await test('data.delete — remove entry', async () => {
    const data = await authApi('/v1/memory/todo.list', agentJwt, { method: 'DELETE' });
    assert(data.ok === true, `Delete failed: ${data.error?.message}`);
    assert(data.data.deleted === true, 'should report deleted');
});

// Micro-memory
await test('data.micro.add — write micro-memory', async () => {
    const data = await api(`/v1/mm?op=add&set=testset&key=score&value=100`);
    assert(data.ok === true, `MM add failed: ${data.error?.message}`);
});

await test('data.micro.list — list micro-memory set', async () => {
    const data = await api(`/v1/mm?op=list&set=testset`);
    assert(data.ok === true, `MM list failed: ${data.error?.message}`);
    assert(data.data.entries.score === '100', 'score mismatch');
});

await test('data.micro.mod — modify micro-memory', async () => {
    const data = await api(`/v1/mm?op=mod&set=testset&key=score&value=200`);
    assert(data.ok === true, `MM mod failed: ${data.error?.message}`);
});

await test('data.micro.batch — batch write', async () => {
    const data = await api(`/v1/mm?op=batch&set=testset&key0=a&value0=1&key1=b&value1=2`);
    assert(data.ok === true, `MM batch failed: ${data.error?.message}`);
    assert(data.data.count === 2, `expected 2, got ${data.data.count}`);
});

await test('data.micro.del — delete micro-memory key', async () => {
    const data = await api(`/v1/mm?op=del&set=testset&key=a`);
    assert(data.ok === true, `MM del failed: ${data.error?.message}`);
});

await test('data.microSets — list all sets', async () => {
    const data = await api(`/v1/mm?op=list`);
    assert(data.ok === true, `MM list sets failed: ${data.error?.message}`);
    assert(data.data.sets.length >= 1, 'should have at least 1 set');
});

// ═══════════════════════════════════════════════
// Phase 2: aimeat-storage.js (File Upload/Download)
// ═══════════════════════════════════════════════
console.log('\n─── Phase 2: aimeat-storage.js ───');

await test('storage.upload — upload file (JSON base64)', async () => {
    const content = Buffer.from('Hello from storage test!').toString('base64');
    const data = await authApi('/v1/storage', agentJwt, {
        method: 'POST',
        body: JSON.stringify({ key: 'test-file.txt', data: content, mime_type: 'text/plain', visibility: 'private' }),
    });
    assert(data.ok === true, `Upload failed: ${data.error?.message}`);
    assert(data.data.key === 'test-file.txt', 'key mismatch');
    assert(data.data.size > 0, 'size should be > 0');
});

await test('storage.list — list files', async () => {
    const data = await authApi('/v1/storage', agentJwt);
    assert(data.ok === true, `List failed: ${data.error?.message}`);
    assert(data.data.files.length >= 1, 'should have at least 1 file');
    const found = data.data.files.find((f: any) => f.key === 'test-file.txt');
    assert(!!found, 'uploaded file should appear in list');
});

await test('storage.download — download file', async () => {
    const res = await rawFetch('/v1/storage/test-file.txt', agentJwt);
    assert(res.ok, `Download failed: ${res.status}`);
    const text = await res.text();
    assert(text === 'Hello from storage test!', `content mismatch: ${text}`);
});

await test('storage.metadata — HEAD file', async () => {
    const res = await rawFetch('/v1/storage/test-file.txt', agentJwt, { method: 'HEAD' });
    assert(res.ok, `HEAD failed: ${res.status}`);
    assert(res.headers.get('Content-Type')?.includes('text/plain'), 'content-type mismatch');
    assert(parseInt(res.headers.get('Content-Length') || '0') > 0, 'content-length should be > 0');
});

await test('storage.delete — delete file', async () => {
    const data = await authApi('/v1/storage/test-file.txt', agentJwt, { method: 'DELETE' });
    assert(data.ok === true, `Delete failed: ${data.error?.message}`);
});

await test('storage.upload+download — chunked upload lifecycle', async () => {
    // Init
    const initData = await authApi('/v1/storage/upload/init', agentJwt, {
        method: 'POST',
        body: JSON.stringify({ key: 'chunked-test.bin', mime_type: 'application/octet-stream', visibility: 'private', chunk_size: 1024, total_chunks: 2 }),
    });
    assert(initData.ok === true, `Init failed: ${initData.error?.message}`);
    const uploadId = initData.data.upload_id;

    // Upload 2 chunks
    const chunk0 = Buffer.alloc(1024, 0x41); // 'A' repeated
    const chunk1 = Buffer.alloc(512, 0x42);  // 'B' repeated
    for (const [i, chunk] of [chunk0, chunk1].entries()) {
        const res = await rawFetch(`/v1/storage/upload/${uploadId}/${i}`, agentJwt, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: chunk,
        });
        assert(res.ok, `Chunk ${i} upload failed: ${res.status}`);
    }

    // Complete
    const completeData = await authApi(`/v1/storage/upload/${uploadId}/complete`, agentJwt, { method: 'POST' });
    assert(completeData.ok === true, `Complete failed: ${completeData.error?.message}`);
    assert(completeData.data.key === 'chunked-test.bin', 'key mismatch');
    assert(completeData.data.size === 1536, `expected size 1536, got ${completeData.data.size}`);
});

// ═══════════════════════════════════════════════
// Phase 3: aimeat-social.js (Boards, Posts)
// ═══════════════════════════════════════════════
console.log('\n─── Phase 3: aimeat-social.js ───');

let testBoardId = '';

await test('social.createBoard — create a board', async () => {
    const data = await authApi('/v1/boards', agentJwt, {
        method: 'POST',
        body: JSON.stringify({ name: `libtest-${Date.now()}`, visibility: 'private', description: 'Test board for lib E2E' }),
    });
    assert(data.ok === true, `Create board failed: ${data.error?.message}`);
    testBoardId = data.data.id;
    assert(typeof testBoardId === 'string', 'should have board id');
});

await test('social.boards — list boards', async () => {
    const data = await authApi('/v1/boards', agentJwt);
    assert(data.ok === true, `List boards failed: ${data.error?.message}`);
    assert(data.data.boards.length >= 1, 'should have at least 1 board');
});

let testPostId = '';

await test('social.post — post to board', async () => {
    const data = await authApi(`/v1/boards/${testBoardId}/posts`, agentJwt, {
        method: 'POST',
        body: JSON.stringify({ title: 'Hello from E2E test', body: 'Testing the social library!', category: 'test' }),
    });
    assert(data.ok === true, `Post failed: ${data.error?.message}`);
    testPostId = data.data.id;
    assert(typeof testPostId === 'string', 'should have post id');
});

await test('social.posts — list posts', async () => {
    const data = await authApi(`/v1/boards/${testBoardId}/posts`, agentJwt);
    assert(data.ok === true, `List posts failed: ${data.error?.message}`);
    assert(data.data.posts.length >= 1, 'should have at least 1 post');
});

await test('social.getPost — get single post', async () => {
    const data = await authApi(`/v1/boards/${testBoardId}/posts/${testPostId}`, agentJwt);
    assert(data.ok === true, `Get post failed: ${data.error?.message}`);
    assert(data.data.title === 'Hello from E2E test', 'title mismatch');
});

await test('social.react — react to post', async () => {
    const data = await authApi(`/v1/boards/${testBoardId}/posts/${testPostId}/react`, agentJwt, {
        method: 'POST',
        body: JSON.stringify({ reaction: '👍' }),
    });
    assert(data.ok === true, `React failed: ${data.error?.message}`);
});

await test('social.reply — reply to post', async () => {
    const data = await authApi(`/v1/boards/${testBoardId}/posts/${testPostId}/replies`, agentJwt, {
        method: 'POST',
        body: JSON.stringify({ body: 'Great post!' }),
    });
    assert(data.ok === true, `Reply failed: ${data.error?.message}`);
    assert(typeof data.data.id === 'string', 'reply should have id');
});

await test('social.subscribe — subscribe to board', async () => {
    const data = await authApi(`/v1/boards/${testBoardId}/subscribe`, agentJwt, {
        method: 'POST',
        body: JSON.stringify({}),
    });
    assert(data.ok === true, `Subscribe failed: ${data.error?.message}`);
});

await test('social.subscriptions — list subscriptions', async () => {
    const data = await authApi('/v1/boards/subscriptions', agentJwt);
    assert(data.ok === true, `List subs failed: ${data.error?.message}`);
    assert(data.data.subscriptions.length >= 1, 'should have at least 1 subscription');
});

await test('social.unsubscribe — unsubscribe from board', async () => {
    const data = await authApi(`/v1/boards/${testBoardId}/subscribe`, agentJwt, { method: 'DELETE' });
    assert(data.ok === true, `Unsubscribe failed: ${data.error?.message}`);
});

// ═══════════════════════════════════════════════
// Phase 4: aimeat-wallet.js (Morsel Economy)
// ═══════════════════════════════════════════════
console.log('\n─── Phase 4: aimeat-wallet.js ───');

await test('wallet.balance — check balance', async () => {
    const data = await authApi('/v1/wallet', agentJwt);
    assert(data.ok === true, `Balance failed: ${data.error?.message}`);
    assert(typeof data.data.balance === 'number', 'balance should be number');
    assert(typeof data.data.available === 'number', 'available should be number');
});

await test('wallet.transactions — list transactions', async () => {
    const data = await authApi('/v1/wallet/transactions', agentJwt);
    assert(data.ok === true, `Transactions failed: ${data.error?.message}`);
    assert(Array.isArray(data.data.transactions), 'transactions should be array');
});

await test('wallet.history — legacy history', async () => {
    const data = await authApi('/v1/wallet/history', agentJwt);
    assert(data.ok === true, `History failed: ${data.error?.message}`);
    assert(Array.isArray(data.data.transactions), 'transactions should be array');
});

await test('wallet.request — request morsels', async () => {
    const data = await authApi('/v1/wallet/request', agentJwt, {
        method: 'POST',
        body: JSON.stringify({ amount: 10, reason: 'E2E test request' }),
    });
    assert(data.ok === true, `Request failed: ${data.error?.message}`);
    assert(typeof data.data.new_balance === 'number', 'new_balance should be number');
});

// ═══════════════════════════════════════════════
// Phase 5: aimeat-work.js (Catalogue + Work)
// ═══════════════════════════════════════════════
console.log('\n─── Phase 5: aimeat-work.js ───');

await test('work.catalogue — browse catalogue (public)', async () => {
    const data = await api('/v1/catalogue');
    assert(data.ok === true, `Catalogue failed: ${data.error?.message}`);
    assert(Array.isArray(data.data.actions), 'actions should be array');
});

await test('work.agents — browse agents (public)', async () => {
    const data = await api('/v1/catalogue/agents');
    assert(data.ok === true, `Agents failed: ${data.error?.message}`);
    assert(Array.isArray(data.data.agents), 'agents should be array');
});

await test('work.stats — get node stats (public)', async () => {
    const data = await api('/v1/stats');
    assert(data.ok === true, `Stats failed: ${data.error?.message}`);
    assert(typeof data.data.node_id === 'string', 'node_id should be string');
});

await test('work.hash — catalogue hash (public)', async () => {
    const data = await api('/v1/catalogue/hash');
    assert(data.ok === true, `Hash failed: ${data.error?.message}`);
    assert(typeof data.data.hash === 'string', 'hash should be string');
});

// Publish an action so we can test work requests
let testActionId = '';

await test('Publish action for work test', async () => {
    testActionId = `e2e-test-${Date.now()}`;
    const data = await authApi('/v1/actions', agentJwt, {
        method: 'POST',
        body: JSON.stringify({
            id: testActionId,
            display_name: 'E2E Test Action',
            description: 'Test action for work library E2E',
            category: 'utility',
            input_schema: { type: 'object', properties: { prompt: { type: 'string' } } },
            output_schema: { type: 'object', properties: { result: { type: 'string' } } },
            pricing: { base_morsels: 1 },
        }),
    });
    assert(data.ok === true, `Publish failed: ${data.error?.message}`);
});

await test('work.getAction — action detail (public)', async () => {
    const data = await api(`/v1/catalogue/${testActionId}`);
    assert(data.ok === true, `Get action failed: ${data.error?.message}`);
    assert(data.data.display_name === 'E2E Test Action', 'display_name mismatch');
});

// Register a second owner + agent for cross-owner work tests
let agent2Gaii = '';
let agent2Jwt = '';

await test('Register second owner via GHII', async () => {
    const data = await api('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: username2, display_name: 'Lib Test Provider Owner' }),
    });
    assert(data.ok === true, `Second owner registration failed: ${data.error?.message}`);
    ownerPrivKey2 = data.data.private_key;
});

await test('Get second owner JWT', async () => {
    const timestamp = new Date().toISOString();
    const message = username2 + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey2, message);
    const data = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: username2, timestamp, signature }),
    });
    assert(data.ok === true, `Second owner auth failed: ${data.error?.message}`);
    ownerJwt2 = data.data.token;
});

await test('Register provider agent under second owner', async () => {
    const data = await authApi('/v1/agents', ownerJwt2, {
        method: 'POST',
        body: JSON.stringify({ name: 'provider', owner: username2, display_name: 'Test Provider' }),
    });
    assert(data.ok === true, `Provider registration failed: ${data.error?.message}`);
    agent2Gaii = data.data.agent.gaii;
    const agent2PrivKey = data.data.private_key;

    // Get provider JWT
    const timestamp = new Date().toISOString();
    const message = agent2Gaii + timestamp;
    const signature = await signMsg(agent2PrivKey, message);
    const tokenData = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agent2Gaii, timestamp, signature }),
    });
    assert(tokenData.ok === true, `Provider auth failed: ${tokenData.error?.message}`);
    agent2Jwt = tokenData.data.token;
});

let trackingCode = '';

await test('work.request — submit work request', async () => {
    const data = await authApi('/v1/work/request', agentJwt, {
        method: 'POST',
        body: JSON.stringify({
            action_id: testActionId,
            provider_gaii: agent2Gaii,
            input: { prompt: 'Hello from test' },
        }),
    });
    assert(data.ok === true, `Work request failed: ${data.error?.message}`);
    trackingCode = data.data.tracking_code;
    assert(typeof trackingCode === 'string', 'should have tracking code');
    assert(data.data.status === 'pending', `expected pending, got ${data.data.status}`);
});

await test('work.inbox — provider inbox', async () => {
    const data = await authApi('/v1/work/inbox', agent2Jwt);
    assert(data.ok === true, `Inbox failed: ${data.error?.message}`);
    assert(data.data.items.length >= 1, 'should have at least 1 item');
});

await test('work.status — check work status', async () => {
    const data = await authApi(`/v1/work/${trackingCode}`, agentJwt);
    assert(data.ok === true, `Status failed: ${data.error?.message}`);
    assert(data.data.tracking_code === trackingCode, 'tracking code mismatch');
});

await test('work.accept — accept work', async () => {
    const data = await authApi(`/v1/work/${trackingCode}/accept`, agent2Jwt, { method: 'POST' });
    assert(data.ok === true, `Accept failed: ${data.error?.message}`);
});

await test('work.deliver — deliver output', async () => {
    const data = await authApi(`/v1/work/${trackingCode}/deliver`, agent2Jwt, {
        method: 'POST',
        body: JSON.stringify({ output: { result: 'Done!' } }),
    });
    assert(data.ok === true, `Deliver failed: ${data.error?.message}`);
});

await test('work.rate — rate delivery', async () => {
    const data = await authApi(`/v1/work/${trackingCode}/rate`, agentJwt, {
        method: 'POST',
        body: JSON.stringify({ rating: 'positive', comment: 'Great work!' }),
    });
    assert(data.ok === true, `Rate failed: ${data.error?.message}`);
});

// ═══════════════════════════════════════════════
// Phase 6: Library endpoints
// ═══════════════════════════════════════════════
console.log('\n─── Phase 6: Library Endpoints ───');

await test('GET /v1/libs — list all libraries', async () => {
    const data = await api('/v1/libs');
    assert(data.ok === true, `Libs list failed: ${data.error?.message}`);
    assert(data.libraries.length >= 6, `expected >= 6 libraries, got ${data.libraries.length}`);
    const names = data.libraries.map((l: any) => l.name);
    assert(names.includes('aimeat-auth'), 'missing aimeat-auth');
    assert(names.includes('aimeat-data'), 'missing aimeat-data');
    assert(names.includes('aimeat-storage'), 'missing aimeat-storage');
    assert(names.includes('aimeat-social'), 'missing aimeat-social');
    assert(names.includes('aimeat-wallet'), 'missing aimeat-wallet');
    assert(names.includes('aimeat-work'), 'missing aimeat-work');
});

await test('GET /v1/libs/aimeat-data.js — serves JavaScript', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-data.js`);
    assert(res.ok, `data lib failed: ${res.status}`);
    const text = await res.text();
    // The lib is componentized (SDK-libs migration): it attaches via _core `attach('data', …)`
    // rather than a literal `AIMEAT.data =`, so assert on stable data-surface markers instead.
    assert(text.includes('getPublic'), 'should expose the memory API (getPublic)');
    assert(text.includes('micro'), 'should include micro-memory support');
    assert(res.headers.get('Content-Type')?.includes('javascript'), 'should be javascript');
});

await test('GET /v1/libs/aimeat-storage.js — serves JavaScript', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-storage.js`);
    assert(res.ok, `storage lib failed: ${res.status}`);
    const text = await res.text();
    assert(text.includes('upload'), 'should expose the storage API (upload)'); // componentized: attaches via _core attach()
    assert(text.includes('enableDropZone'), 'should include drop zone helper');
});

await test('GET /v1/libs/aimeat-social.js — serves JavaScript', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-social.js`);
    assert(res.ok, `social lib failed: ${res.status}`);
    const text = await res.text();
    assert(text.includes('createBoard'), 'should expose the social API (createBoard)'); // componentized: attaches via _core attach()
    assert(text.includes('subscribe'), 'should include subscriptions');
});

await test('GET /v1/libs/aimeat-wallet.js — serves JavaScript', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-wallet.js`);
    assert(res.ok, `wallet lib failed: ${res.status}`);
    const text = await res.text();
    // Componentized (SDK-libs migration): attaches via _core `attach('wallet', …)` rather than a
    // literal `AIMEAT.wallet =`, so assert on stable wallet-surface markers instead.
    assert(text.includes('balance'), 'should expose the wallet API (balance)');
    assert(text.includes('mountBadge'), 'should include badge UI');
});

await test('GET /v1/libs/aimeat-work.js — serves JavaScript', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-work.js`);
    assert(res.ok, `work lib failed: ${res.status}`);
    const text = await res.text();
    assert(text.includes('catalogue'), 'should expose the work API (catalogue)'); // componentized: attaches via _core attach()
    assert(text.includes('waitFor'), 'should include polling helper');
});

await test('GET /v1/libs/aimeat-markdown.js — serves render + renderRich + renderToString', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-markdown.js`);
    assert(res.ok, `markdown lib failed: ${res.status}`);
    const text = await res.text();
    // Componentized (SDK-libs migration): attaches via _core `attach('md', …)` rather than a literal
    // `AIMEAT.md =`, so assert on a stable md-surface marker (sanitizeHref) instead.
    assert(text.includes('sanitizeHref'), 'should expose the markdown surface (sanitizeHref)');
    assert(text.includes('renderRich'), 'should include the rich pipeline');
    assert(text.includes('renderToString'), 'should include the string form');
    assert(text.includes('suppressErrorRendering'), 'mermaid init must suppress error-bomb rendering');
    assert(text.includes('md-mem-src'), 'should mark aimeat-memory fences for the live-embed post-pass');
    assert(text.includes('renderMemoryEmbeds'), 'should include the live memory-embed renderer');
});

await test('GET /v1/libs/aimeat-organism.js — serves normalized workspace client', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-organism.js`);
    assert(res.ok, `organism lib failed: ${res.status}`);
    const text = await res.text();
    // Componentized (SDK-libs migration): attaches via _core `attach('organism', …)` rather than a
    // literal `AIMEAT.organism =`, so assert on stable organism-surface markers instead.
    assert(text.includes('createWorkspace'), 'should expose the organism API (createWorkspace)');
    assert(text.includes('normalizeWorkspace'), 'should include the objects+drafts normalizer');
    assert(text.includes('writeDraft'), 'should include draft writes');
    assert(text.includes('/publish'), 'should include the publish call');
    assert(text.includes('stripMeta'), 'should strip _-prefixed read metadata before writes');
});

await test('GET /v1/libs/aimeat-editor.js — serves CM6 editor with fallback', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-editor.js`);
    assert(res.ok, `editor lib failed: ${res.status}`);
    const text = await res.text();
    // Componentized (SDK-libs migration): attaches via _core `attach('editor', …)` rather than a
    // literal `AIMEAT.editor =`, so assert on the stable editor-surface marker (split) instead.
    assert(text.includes('split'), 'should expose the editor API (split)');
    assert(text.includes('codemirror@6.0.2'), 'CM6 must be exact-pinned (the @6 range resolves to CM5 on esm.sh)');
    assert(text.includes('textarea'), 'should include the textarea fallback');
    assert(text.includes('toolbar'), 'should include the toolbar builder');
});

await test('GET /v1/libs/aimeat-commerce.js — serves checkout + money-formatting client', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-commerce.js`);
    assert(res.ok, `commerce lib failed: ${res.status}`);
    const text = await res.text();
    assert(text.includes('fmtMoney'), 'should expose the commerce API (fmtMoney)'); // componentized: attaches via _core attach()
    assert(text.includes('buyOffer'), 'should include the one-call purchase');
    assert(text.includes('/v1/commerce/checkout-sessions'), 'should call the checkout API');
    assert(text.includes('paymentRequired'), 'should surface the x402-style 402 accepts block');
    assert(text.includes('fmtMoney'), 'should include micro-unit money formatting');
    assert(text.includes('getAppTools'), 'should include the app-tool manifest read (TARGET-034 draft)');
    assert(res.headers.get('Content-Type')?.includes('javascript'), 'should be javascript');
});

await test('GET /v1/libs/aimeat-exchange.js — serves the market client (listings, contracts, earnings)', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-exchange.js`);
    assert(res.ok, `exchange lib failed: ${res.status}`);
    const text = await res.text();
    assert(res.headers.get('Content-Type')?.includes('javascript'), 'should be javascript');
    // Browsing + selling + contracts + earnings + demand — one endpoint per group, so a group that
    // silently stops being wired fails here rather than in an app.
    assert(text.includes('/v1/exchange/offerings'), 'should read the offerings surface');
    assert(text.includes('/v1/exchange/offerings/'), 'should reach one offering (detail/odps/consumers)');
    assert(text.includes('/odps.yaml'), 'should expose the ODPS YAML projection');
    assert(text.includes('/v1/exchange/reconcile'), 'should expose reconcile');
    assert(text.includes('/v1/exchange/entitlements'), 'should read the caller’s contracts');
    assert(text.includes('/v1/exchange/earnings'), 'should read the seller’s accrued earnings');
    assert(text.includes('/v1/exchange/needs'), 'should cover the demand side (needs + bids)');
    assert(text.includes('odpsCompleteness'), 'should ship the ODPS completeness meter');
    assert(text.includes('fmtUnit'), 'should ship the unit formatter');
    // Money formatting is aimeat-commerce's job — this library must DELEGATE, never restate it.
    assert(!/function fmtMoney|fmtMoney\s*\(micros/.test(text), 'must not re-implement fmtMoney (delegate to AIMEAT.commerce)');
    // esbuild emits 1000000 as 1e6, so the literal-only form of this guard could never fail.
    assert(!/\b(1000000|1e6)\b/.test(text), 'must not restate the money micro-unit constant (use AIMEAT.commerce.MONEY_UNIT)');
});

/** Strip comments so a claim about the CODE is not satisfied (or broken) by prose describing it. */
function withoutComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Load a served IIFE library and return the `AIMEAT` surface it attached, so a test can CALL the
 * thing rather than grep its source. A text assertion cannot tell "formats money" from "mentions
 * money", and the bug this exists for produced a perfectly plausible-looking string.
 */
async function loadServedLib(name: string, extraGlobals: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(`${BASE}/v1/libs/${name}`);
    assert(res.ok, `${name} failed to serve: ${res.status}`);
    const src = await res.text();
    // Just enough DOM for a library to finish loading. Anything that actually needs a browser is
    // out of scope here; this exists to reach the PURE functions, which is where the unit bugs are.
    const stubEl = () => ({
        style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute() {}, getAttribute: () => null, removeAttribute() {}, appendChild() {},
        addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    });
    const doc: any = {
        documentElement: stubEl(), head: stubEl(), body: stubEl(),
        createElement: stubEl, createTextNode: stubEl,
        querySelector: () => null, querySelectorAll: () => [],
        addEventListener() {}, removeEventListener() {},
    };
    const win: any = {
        AIMEAT: {}, location: { origin: BASE, href: BASE + '/' }, document: doc,
        navigator: { language: 'en' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        addEventListener() {}, removeEventListener() {}, fetch: () => Promise.reject(new Error('no network in this harness')),
        setTimeout, clearTimeout, console,
        ...extraGlobals,
    };
    win.window = win;
    win.globalThis = win;
    win.self = win;
    const vm = await import('node:vm');
    const ctx = vm.createContext(win);
    vm.runInContext(src, ctx);
    return win.AIMEAT;
}

await test('aimeat-exchange fmtUnit — money is money, morsels are morsels, and a bad unit THROWS', async () => {
    // aimeat-commerce owns money formatting; this library must delegate to it. The stub is that
    // contract, so a change that stopped delegating would fail here too.
    let delegated: any = null;
    const AIMEAT = await loadServedLib('aimeat-exchange.js');
    AIMEAT.commerce = {
        MONEY_UNIT: 1000000,
        fmtMoney: (micros: number, currency?: string) => {
            delegated = { micros, currency };
            return `${(micros / 1000000).toFixed(2)} ${currency ?? ''}`.trim();
        },
    };
    const { fmtUnit, fmtMorsels } = AIMEAT.exchange;

    // The two units, each in its own shape.
    assert(fmtUnit(1500000, 'money', 'EUR') === '1.50 EUR', `money: got "${fmtUnit(1500000, 'money', 'EUR')}"`);
    assert(delegated?.micros === 1500000 && delegated?.currency === 'EUR', 'money must delegate to AIMEAT.commerce.fmtMoney');
    assert(fmtUnit(10, 'morsels') === '10 morsels', `morsels: got "${fmtUnit(10, 'morsels')}"`);
    assert(fmtUnit(1, 'morsels') === '1 morsel', `singular morsel: got "${fmtUnit(1, 'morsels')}"`);
    assert(fmtMorsels(3) === '3 morsels', 'fmtMorsels stays plain integers');

    // The documented shorthand: omit the unit and pass a currency.
    assert(fmtUnit(1500000, undefined, 'EUR') === '1.50 EUR', 'omitted unit + currency must format as money');
    // Nothing at all still means morsels, which is the meter and the sensible default.
    assert(fmtUnit(7) === '7 morsels', 'no unit and no currency is morsels');

    // ── The regression this test exists for ──────────────────────────────────────────────────
    // `fmtUnit(17793800, 'EUR')` put the CURRENCY in the UNIT slot. The old implementation
    // evaluated isMoney as false and rendered 17.79 EUR as "17793800 morsels": right explanation,
    // wrong unit, wrong number by a factor of a million. Silently degrading to the other unit is
    // not a fallback, it is a wrong figure with a confident face on it (R-S8).
    let threw = false;
    let message = '';
    try { fmtUnit(17793800, 'EUR'); } catch (e: any) { threw = true; message = e.message; }
    assert(threw, 'fmtUnit(amount, "EUR") must THROW: a currency in the unit slot silently became morsels');
    assert(/EUR/.test(message) && /unit/i.test(message),
        `the error must name the offending unit and say what a unit is, got "${message}"`);
    assert(/money/.test(message), `the error must say how to spell it correctly, got "${message}"`);

    // Any other unknown unit, same treatment.
    let threw2 = false;
    try { fmtUnit(5, 'bananas'); } catch { threw2 = true; }
    assert(threw2, 'an unrecognised unit must throw rather than fall through to morsels');
});

await test('GET /v1/libs/aimeat-game.js — serves the gamification kit with every component', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-game.js`);
    assert(res.ok, `game lib failed: ${res.status}`);
    const text = await res.text();
    assert(res.headers.get('Content-Type')?.includes('javascript'), 'should be javascript');
    // One assertion per component: a component that silently stops being exported fails here
    // rather than as a missing screen in somebody's app.
    for (const part of [
        'menu', 'screen', 'modal', 'toast', 'confirm',
        'rail', 'meter', 'scoreBreakdown', 'badge', 'comingSoon', 'counter', 'streak',
        'leaderboard', 'statGrid', 'dataTable', 'card',
        'money', 'morsels', 'injectStyle', 'guardButtons', 'whileBusy',
    ]) {
        assert(text.includes(part), `should export ${part}`);
    }
    // The state machine an app depends on: a locked entry is readable and still reports its pick.
    assert(text.includes('lockReason'), 'a locked entry must be able to say why it is locked');
    assert(text.includes('ag-menu__item--locked'), 'a locked entry must be styled as locked, not disabled');
    // Money is integer micro-units, morsels are integers, and the meat emoji is never a unit.
    // esbuild normalises 1000000 to 1e6, so accept either spelling of the same constant.
    assert(/MONEY_UNIT\s*=\s*(1000000|1e6)\b/.test(text), 'money must use the 6-decimal micro-unit constant');
    assert(!text.includes('🥩'), 'morsels are plain integers — never the meat emoji');
});

await test('GET /v1/libs/aimeat-game.js — the version an app prints moves with the library', async () => {
    const [js, css] = await Promise.all([
        fetch(`${BASE}/v1/libs/aimeat-game.js`).then((r) => r.text()),
        fetch(`${BASE}/lib/aimeat-game.css`).then((r) => r.text()),
    ]);
    // EXCHANGE LAB puts AIMEAT.game.version on screen. It sat at 1.0.0 through three shipped
    // changes, which is worse than showing nothing — so the constant is pinned to the artefact
    // that actually carries a changelog, and this fails the moment the two drift.
    const shipped = js.match(/version:\s*["']([\d.]+)["']/)?.[1];
    const newest = css.match(/@version-history\s*\n\s*\*\s*v([\d.]+)/)?.[1];
    assert(shipped, 'the library must expose a version');
    assert(newest, 'the stylesheet must carry a version history');
    assert(shipped === newest,
        `AIMEAT.game.version (${shipped}) must match the newest stylesheet version (${newest})`);
});

await test('GET /v1/libs/aimeat-game.js — makes no network calls and hardcodes no colour', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-game.js`);
    const code = withoutComments(await res.text());
    // THE BOUNDARY. This library renders; the host supplies the data. A component that fetches has
    // the wrong boundary, and the whole "requires: []" registration is a lie the moment it does.
    assert(!/\bfetch\s*\(/.test(code), 'must not call fetch — the host supplies the data');
    assert(!/XMLHttpRequest|EventSource|WebSocket/.test(code), 'must not open any other transport either');
    assert(!code.includes('/v1/'), 'must not reference a node API path');
    // THE THEMING CONTRACT. Every colour is a CSS variable; a hex in the JS cannot be re-skinned.
    assert(!/#[0-9a-fA-F]{6}\b/.test(code), 'must not hardcode a colour in JavaScript');
    assert(!/rgba?\s*\(\s*\d/.test(code), 'must not hardcode a colour in JavaScript');
});

await test('GET /v1/libs/aimeat-game.js — ships English and Finnish for its own words', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-game.js`);
    const text = await res.text();
    // The kit's own strings, in both languages. Finnish written as Finnish, ä/ö intact.
    for (const word of ['Coming soon', 'Tulossa', 'Locked', 'Lukossa', 'morsels', 'morselia', 'Myöhemmin']) {
        assert(text.includes(word), `should ship the string "${word}"`);
    }
    // It follows the platform language control instead of inventing a second one.
    assert(text.includes('aimeat-lang'), 'should read the platform language key');
    assert(text.includes('aimeat-lang-change'), 'should react to the platform language event');
});

await test('GET /lib/aimeat-game.css — serves the theming contract, light and dark', async () => {
    const res = await fetch(`${BASE}/lib/aimeat-game.css`);
    assert(res.ok, `game stylesheet failed: ${res.status}`);
    const text = await res.text();
    const css = withoutComments(text);
    // The contract itself. A skin sets these and nothing else, so a token that disappears silently
    // breaks every skin an author has already written.
    for (const token of [
        '--ag-bg', '--ag-scene', '--ag-surface', '--ag-surface-image', '--ag-ink', '--ag-ink-dim',
        '--ag-line', '--ag-accent', '--ag-accent-2', '--ag-accent-ink', '--ag-accent-text',
        '--ag-ok', '--ag-warn', '--ag-err', '--ag-info', '--ag-locked', '--ag-focus',
        '--ag-radius', '--ag-radius-pill', '--ag-radius-round', '--ag-shadow', '--ag-glow', '--ag-tilt',
        '--ag-font', '--ag-font-display', '--ag-font-ui', '--ag-font-mono',
        '--ag-display-shadow', '--ag-label-caps', '--ag-touch', '--ag-menu-col', '--ag-menu-max',
        '--ag-screen-max', '--ag-actions-align', '--ag-select-w', '--ag-motion', '--ag-juice',
    ]) {
        assert(css.includes(token), `the theming contract must declare ${token}`);
    }
    // Light is the default and dark is a re-declaration of the same names.
    assert(css.includes(':root[data-theme=\'dark\']'), 'dark mode must re-declare the same tokens');
    // The parts the entry imports must actually be reachable, or the kit renders unstyled — and
    // the rules that matter live in THEM, not in the entry, so assert against what they serve.
    let parts = '';
    for (const part of ['shell.css', 'progress.css', 'board.css']) {
        assert(css.includes(part), `should import ${part}`);
        const partRes = await fetch(`${BASE}/lib/aimeat-game/${part}`);
        assert(partRes.ok, `/lib/aimeat-game/${part} failed: ${partRes.status}`);
        parts += withoutComments(await partRes.text());
    }
    // The rail's connectors are ::before/::after on the STEP, and ::after paints after the step's
    // children — so without an explicit lift the line is drawn straight across the step number.
    assert(/\.ag-rail__dot\s*\{[^}]*z-index:\s*1/.test(parts),
        'the rail node must paint above its connectors (z-index on .ag-rail__dot)');
    // A menu entry must contain its own text: each row sizes to its entry instead of stretching it.
    assert(parts.includes('grid-auto-rows: min-content'),
        'menu rows must size to their own entry, or a two-line label spills over its border');
    // A dark-theme-only wash breaks every light skin, in the entry and in the parts alike.
    assert(!/rgba\(\s*255\s*,\s*255\s*,\s*255/.test(css + parts), 'must not use rgba(255,255,255,…)');
});

await test('GET /v1/libs — catalogue lists markdown, organism, editor, commerce, exchange and game', async () => {
    const res = await fetch(`${BASE}/v1/libs`);
    assert(res.ok, `libs catalogue failed: ${res.status}`);
    const data = await res.json() as any;
    const names = (data.libraries ?? []).map((l: any) => l.name);
    for (const expected of ['aimeat-markdown', 'aimeat-organism', 'aimeat-editor', 'aimeat-commerce', 'aimeat-exchange', 'aimeat-game']) {
        assert(names.includes(expected), `catalogue should list ${expected} (got: ${names.join(', ')})`);
    }
    const commerce = (data.libraries ?? []).find((l: any) => l.name === 'aimeat-commerce');
    assert(commerce?.requires === 'aimeat-auth', 'aimeat-commerce must declare requires: aimeat-auth');
    const game = (data.libraries ?? []).find((l: any) => l.name === 'aimeat-game');
    // It depends on nothing, and saying otherwise would make an app load libraries it never uses.
    assert(!game?.requires, `aimeat-game must declare no dependencies, got "${game?.requires}"`);
    assert(game?.include?.includes('/lib/aimeat-game.css'),
        'aimeat-game must include its stylesheet — the JS alone renders unstyled');
    const exchange = (data.libraries ?? []).find((l: any) => l.name === 'aimeat-exchange');
    // Registered wrong = invisible to every AI-facing surface, which is the failure this catches.
    assert(exchange?.requires?.includes('aimeat-auth') && exchange?.requires?.includes('aimeat-commerce'),
        `aimeat-exchange must declare both dependencies, got "${exchange?.requires}"`);
});

// ─── Results ───
console.log('\n─────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
    console.log('⚠️  Some tests failed!');
    process.exit(1);
} else {
    console.log('✅ All tests passed!');
}
