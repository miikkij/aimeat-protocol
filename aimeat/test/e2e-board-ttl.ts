// T-6: Board Post TTL E2E Tests
// Run: cd aimeat && pnpm exec tsx test/e2e-board-ttl.ts

import * as http from 'node:http';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

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
const ownerName = `bdowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';

// Second agent for subscription/access tests
let agent2Token = '';
let agent2Gaii = '';

// Board IDs created during tests
let privateBoardId = '';
let sharedBoardId = '';
let publicBoardId = '';

// Post IDs
let ttlPostId = '';       // short-TTL post for expiration test
let defaultTtlPostId = '';
let customTtlPostId = '';
let reactionPostId = '';
let replyId = '';

console.log('\n=== AIMEAT Board TTL E2E Test ===\n');

// ─── Setup ───
console.log('Setup — Owner & Agents');

await test('Register owner (gets operator role)', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    ownerToken = await getToken(ownerName, ownerPrivKey, false);
});

await test('Register agent-A', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'bd-agent-a', owner: ownerName, capabilities: ['boards'], model: 'gpt-4o' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    agentToken = await getToken(agentGaii, agentPrivKey, true);
});

await test('Register agent-B', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'bd-agent-b', owner: ownerName, capabilities: ['boards'], model: 'gpt-4o' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agent2Gaii = body.data.agent.gaii;
    const a2PrivKey = body.data.private_key;
    agent2Token = await getToken(agent2Gaii, a2PrivKey, true);
});

// ─── Phase 1: Post TTL Expiration ───
console.log('\nPhase 1 — Post TTL Expiration');

await test('1. Create private board', async () => {
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'TTL Test Board', visibility: 'private' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    privateBoardId = body.data.id;
    assert(privateBoardId.startsWith('board-'), `id: ${privateBoardId}`);
});

await test('2. Post with short TTL (0.001h ≈ 3.6s)', async () => {
    const { status, body } = await json(`/v1/boards/${privateBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Expires soon', body: 'This post will expire quickly', ttl_hours: 0.001 }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ttlPostId = body.data.id;
    assert(body.data.ttl_expires_at, 'ttl_expires_at present');
});

await test('3. Read post immediately → visible', async () => {
    const { status, body } = await json(`/v1/boards/${privateBoardId}/posts/${ttlPostId}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.id === ttlPostId, `id: ${body.data.id}`);
    assert(body.data.title === 'Expires soon', `title: ${body.data.title}`);
});

await test('4–5. Wait 4s then list posts → expired post filtered out', async () => {
    await sleep(4000);
    const { status, body } = await json(`/v1/boards/${privateBoardId}/posts`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    const ids = body.data.posts.map((p: any) => p.id);
    assert(!ids.includes(ttlPostId), `expired post still in list: ${ids}`);
});

await test('6. Post with default TTL (168h)', async () => {
    const { status, body } = await json(`/v1/boards/${privateBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Default TTL', body: 'Seven day post' }),
    });
    assert(status === 201, `status ${status}`);
    defaultTtlPostId = body.data.id;
    const expiresAt = new Date(body.data.ttl_expires_at).getTime();
    const expectedMs = Date.now() + 168 * 3600_000;
    const diff = Math.abs(expiresAt - expectedMs);
    assert(diff < 10_000, `ttl_expires_at off by ${diff}ms`);
});

await test('7. Post with custom TTL (24h)', async () => {
    const { status, body } = await json(`/v1/boards/${privateBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Custom TTL', body: 'One day post', ttl_hours: 24 }),
    });
    assert(status === 201, `status ${status}`);
    customTtlPostId = body.data.id;
    const expiresAt = new Date(body.data.ttl_expires_at).getTime();
    const expectedMs = Date.now() + 24 * 3600_000;
    const diff = Math.abs(expiresAt - expectedMs);
    assert(diff < 10_000, `ttl_expires_at off by ${diff}ms`);
});

// ─── Phase 2: Reactions & Replies ───
console.log('\nPhase 2 — Reactions & Replies');

// Use the default TTL post for reactions/replies
reactionPostId = defaultTtlPostId;

await test('8. Add reaction to post', async () => {
    const { status, body } = await json(`/v1/boards/${privateBoardId}/posts/${reactionPostId}/react`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ reaction: '👍' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.reacted === true, `reacted: ${body.data.reacted}`);
    assert(body.data.reaction === '👍', `reaction: ${body.data.reaction}`);
});

await test('8b. Second agent reacts with different emoji', async () => {
    const { status, body } = await json(`/v1/boards/${privateBoardId}/posts/${reactionPostId}/react`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ reaction: '🚀' }),
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.reacted === true, 'reacted');
});

await test('8c. Idempotent reaction (same agent, same emoji)', async () => {
    const { status } = await json(`/v1/boards/${privateBoardId}/posts/${reactionPostId}/react`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ reaction: '👍' }),
    });
    assert(status === 200, `status ${status}`);
});

await test('8d. Verify reactions on post', async () => {
    const { body } = await json(`/v1/boards/${privateBoardId}/posts/${reactionPostId}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const reactions = body.data.reactions;
    assert(reactions['👍']?.length === 1, `thumbs up: ${reactions['👍']?.length}`);
    assert(reactions['🚀']?.length === 1, `rocket: ${reactions['🚀']?.length}`);
});

await test('9. A stranger cannot reply on a PRIVATE board', async () => {
    // agent2 does not own this board. Posting to it has always been refused; REPLYING was not,
    // because neither door applied the board's access rule to a reply — both checked only that the
    // parent post existed. The rule is one function now (services/board-post.ts), so a reply asks
    // the same question a post does.
    const { status, body } = await json(`/v1/boards/${privateBoardId}/posts/${reactionPostId}/replies`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ body: 'this should not land' }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body?.error?.code === 'ACCESS_DENIED', `code: ${JSON.stringify(body?.error)}`);
});

await test('9b. The board OWNER can reply on their own private board', async () => {
    const { status, body } = await json(`/v1/boards/${privateBoardId}/posts/${reactionPostId}/replies`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ body: 'Great post, thanks for sharing!' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    replyId = body.data.id;
    assert(replyId.startsWith('reply-'), `reply id: ${replyId}`);
    assert(body.data.reply_to === reactionPostId, `reply_to: ${body.data.reply_to}`);
});

await test('10. Reply not in list, but readable individually', async () => {
    const { body: listBody } = await json(`/v1/boards/${privateBoardId}/posts`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const ids = listBody.data.posts.map((p: any) => p.id);
    assert(!ids.includes(replyId), `reply should not be in post list`);

    const { status, body } = await json(`/v1/boards/${privateBoardId}/posts/${replyId}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.reply_to === reactionPostId, `reply_to: ${body.data.reply_to}`);
    assert(body.data.body === 'Great post, thanks for sharing!', `body: ${body.data.body}`);
});

// ─── Phase 3: Board Subscriptions ───
console.log('\nPhase 3 — Board Subscriptions');

// Create a shared board so agent-B has access for subscription tests
await test('10b. Create shared board for subscriptions', async () => {
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'Shared Sub Board', visibility: 'shared', allowed_gaiis: [agent2Gaii] }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    sharedBoardId = body.data.id;
});

// Spin up a tiny HTTP server to capture webhook callbacks
const webhookPayloads: any[] = [];
const webhookServer = http.createServer((req, res) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
        try { webhookPayloads.push(JSON.parse(data)); } catch { /* ignore */ }
        res.writeHead(200);
        res.end('ok');
    });
});
await new Promise<void>(resolve => webhookServer.listen(0, '127.0.0.1', resolve));
const webhookPort = (webhookServer.address() as any).port;
const webhookUrl = `http://127.0.0.1:${webhookPort}/hook`;

await test('11. Subscribe to board (agent-B)', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/subscribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ callback_url: webhookUrl }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.board_id === sharedBoardId, `board_id: ${body.data.board_id}`);
    assert(body.data.callback_url === webhookUrl, `callback_url: ${body.data.callback_url}`);
});

await test('11b. Duplicate subscribe → 409', async () => {
    const { status } = await json(`/v1/boards/${sharedBoardId}/subscribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ callback_url: webhookUrl }),
    });
    assert(status === 409, `expected 409, got ${status}`);
});

await test('12. List own subscriptions (agent-B)', async () => {
    const { body } = await json('/v1/boards/subscriptions', {
        headers: { Authorization: `Bearer ${agent2Token}` },
    });
    assert(body.ok === true, 'ok');
    assert(body.data.subscriptions.some((s: any) => s.board_id === sharedBoardId), 'subscription found');
});

await test('13. List subscribers (owner/operator = agent-A)', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/subscribers`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.subscribers.some((s: any) => s.gaii === agent2Gaii), 'agent-B is subscriber');
});

await test('14. Post to board → subscriber webhook fired', async () => {
    webhookPayloads.length = 0;
    const { status } = await json(`/v1/boards/${sharedBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Webhook test', body: 'Should notify agent-B' }),
    });
    assert(status === 201, `status ${status}`);

    // Wait for the fire-and-forget webhook
    await sleep(2000);
    assert(webhookPayloads.length >= 1, `expected webhook payload, got ${webhookPayloads.length}`);
    assert(webhookPayloads[0].event === 'board.new_post', `event: ${webhookPayloads[0].event}`);
    assert(webhookPayloads[0].board_id === sharedBoardId, `board_id: ${webhookPayloads[0].board_id}`);
});

await test('15. Unsubscribe (agent-B)', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/subscribe`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agent2Token}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.unsubscribed === true, 'unsubscribed');
});

await test('16. Post after unsubscribe → no webhook', async () => {
    webhookPayloads.length = 0;
    const { status } = await json(`/v1/boards/${sharedBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'No notify', body: 'Should not trigger webhook' }),
    });
    assert(status === 201, `status ${status}`);
    await sleep(2000);
    assert(webhookPayloads.length === 0, `unexpected webhook: ${webhookPayloads.length}`);
});

// ─── Phase 4: Subscription Filters ───
console.log('\nPhase 4 — Subscription Filters');

await test('17. Subscribe with category filter', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/subscribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ callback_url: webhookUrl, filters: { categories: ['announcements'] } }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.filters?.categories?.includes('announcements'), 'filter set');
});

await test('18. Post matching category → webhook fired', async () => {
    webhookPayloads.length = 0;
    const { status } = await json(`/v1/boards/${sharedBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Important', body: 'Matching category post', category: 'announcements' }),
    });
    assert(status === 201, `status ${status}`);
    await sleep(2000);
    assert(webhookPayloads.length >= 1, `expected webhook, got ${webhookPayloads.length}`);
    assert(webhookPayloads[0].category === 'announcements', `category: ${webhookPayloads[0].category}`);
});

await test('19. Post non-matching category → no webhook', async () => {
    webhookPayloads.length = 0;
    const { status } = await json(`/v1/boards/${sharedBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Misc', body: 'Non-matching category post', category: 'random' }),
    });
    assert(status === 201, `status ${status}`);
    await sleep(2000);
    assert(webhookPayloads.length === 0, `unexpected webhook: ${webhookPayloads.length}`);
});

// Clean up webhook server + filter subscription
webhookServer.close();
await json(`/v1/boards/${sharedBoardId}/subscribe`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${agent2Token}` },
});

// ─── Phase 5: Public Board Morsel Costs ───
console.log('\nPhase 5 — Public Board Morsel Costs');

// First owner = operator, so agent-A's owner can create public boards
// But we need to use the owner token (which has operator role) to create public boards
// Actually, the route requires agent auth + operator role. The first owner's agents should have operator.
// Let's check: the owner token has roles=['owner','operator'], but we need agent role too.
// Create public board with owner token — nope, needs agent role.
// Use agentToken — agent-A's owner is the first owner, so agent-A should have operator role.

await test('20. Create public board (operator)', async () => {
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'Public Economy Board', visibility: 'public' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    publicBoardId = body.data.id;
});

await test('21. Check agent wallet before posting', async () => {
    const { status, body } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    // Default morsel balance is usually 100
    assert(typeof body.data.balance === 'number', `balance: ${body.data.balance}`);
});

let balanceBefore = 0;

await test('22. Post to public board → morsels deducted', async () => {
    // Get balance before
    const { body: walletBefore } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    balanceBefore = walletBefore.data.balance;

    const postBody = 'This is a public board post. Testing morsel cost deduction for public posts.';
    const { status, body } = await json(`/v1/boards/${publicBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Public Post', body: postBody }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);

    // Check balance after — should be less
    const { body: walletAfter } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });

    // Cost formula: baseCost(5) + ceil(body.length/1000 * costPerKb(2))
    const expectedCost = 5 + Math.ceil((postBody.length / 1000) * 2);
    const actualDeduction = balanceBefore - walletAfter.data.balance;
    assert(actualDeduction === expectedCost,
        `expected ${expectedCost} morsels deducted, got ${actualDeduction} (before: ${balanceBefore}, after: ${walletAfter.data.balance})`);
});

await test('23. Post with insufficient morsels → 402', async () => {
    // Single-balance economy: both agents share the owner's GHII balance.
    // Query actual balance and drain it with expensive posts (cost 25 each).
    const { body: w } = await json('/v1/wallet', { headers: { Authorization: `Bearer ${agent2Token}` } });
    const remaining = w.data?.balance ?? 0;
    const drainBody = 'x'.repeat(10000);
    const costPerPost = 5 + Math.ceil((drainBody.length / 1000) * 2); // 25
    const drainCount = Math.floor(remaining / costPerPost);
    for (let i = 0; i < drainCount; i++) {
        const { status } = await json(`/v1/boards/${publicBoardId}/posts`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${agent2Token}` },
            body: JSON.stringify({ title: `Drain ${i + 1}`, body: drainBody }),
        });
        assert(status === 201, `drain post ${i + 1} failed: ${status}`);
    }
    // Now balance < 25 morsels. Post another expensive one that costs 25 — should fail.
    const { status, body } = await json(`/v1/boards/${publicBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ title: 'Expensive Post', body: drainBody }),
    });
    assert(status === 402, `expected 402, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'INSUFFICIENT_MORSELS', `code: ${body.error?.code}`);
});

// Phase 6 held four Tier 0.5 tests for GET /v1/boards/:boardId/posts/new?otk=. That route was
// deleted on 2026-08-11 with the rest of the deprecated one-time-key write paths, so the behaviour
// they covered no longer exists and the assertions went with it. Posting is POST
// /v1/boards/:boardId/posts, covered in Phase 3.

// ─── Phase 7: Board Access Control ───
console.log('\nPhase 7 — Board Access Control');

await test('28. Non-owner agent-B cannot list private board posts', async () => {
    const { status } = await json(`/v1/boards/${privateBoardId}/posts`, {
        headers: { Authorization: `Bearer ${agent2Token}` },
    });
    // agent-B is same owner but board.ownerGaii = agentAGaii, not agent-B's GAII
    // Unless agent-B is in allowedGaiis
    assert(status === 403, `expected 403, got ${status}`);
});

await test('29. Unauthenticated cannot access private board', async () => {
    const { status } = await json(`/v1/boards/${privateBoardId}/posts`);
    assert(status === 401 || status === 403, `expected 401 or 403, got ${status}`);
});

await test('30. Public board posts readable without auth', async () => {
    const { status, body } = await json(`/v1/boards/${publicBoardId}/posts`);
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.data.posts), 'posts array');
});

// Create a non-operator owner+agent for tests 31 and 35 (shared to save auth requests)
let nonOpOwnerName = '';
let nonOpOwnerToken = '';
let nonOpAgentToken = '';

await test('31-pre. Create non-operator owner+agent', async () => {
    nonOpOwnerName = `bd-noop-${Date.now()}`;
    const { body: oBody } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: nonOpOwnerName, public_key: 'placeholder' }),
    });
    nonOpOwnerToken = await getToken(nonOpOwnerName, oBody.data.private_key, false);
    const { body: aBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nonOpOwnerToken}` },
        body: JSON.stringify({ name: 'noop-agent', owner: nonOpOwnerName, capabilities: ['boards'], model: 'gpt-4o' }),
    });
    nonOpAgentToken = await getToken(aBody.data.agent.gaii, aBody.data.private_key, true);
});

await test('31. Non-operator, non-owner cannot list subscribers → 403', async () => {
    const { status } = await json(`/v1/boards/${privateBoardId}/subscribers`, {
        headers: { Authorization: `Bearer ${nonOpAgentToken}` },
    });
    assert(status === 403, `expected 403, got ${status}`);
});

// ─── Phase 8: Error Paths ───
console.log('\nPhase 8 — Error Paths');

await test('32. Post to non-existent board → 404', async () => {
    const { status } = await json('/v1/boards/board-nonexistent/posts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Nope', body: 'Board does not exist' }),
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('33. React to non-existent post → 404', async () => {
    const { status } = await json(`/v1/boards/${privateBoardId}/posts/post-nonexistent/react`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ reaction: '👎' }),
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('34. Reply to non-existent post → 404', async () => {
    const { status } = await json(`/v1/boards/${privateBoardId}/posts/post-nonexistent/replies`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ body: 'Reply to nothing' }),
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('35. Non-operator create public board → 403', async () => {
    const { status } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nonOpAgentToken}` },
        body: JSON.stringify({ name: 'Should Fail', visibility: 'public' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('36. Unsubscribe when not subscribed → 404', async () => {
    const { status } = await json(`/v1/boards/${privateBoardId}/subscribe`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade-delete non-operator owner', async () => {
    if (!nonOpOwnerName) return; // skip if 31-pre failed
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(nonOpOwnerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${nonOpOwnerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

await test('Cascade-delete owner', async () => {
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

// ─── Summary ───
console.log(`\n${'═'.repeat(50)}`);
console.log(`Board TTL E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));

// Write results to file (process.exit doesn't flush stdout reliably when piped)
writeFileSync('t6-results.txt', results.join('\n') + `\n\n${passed} passed, ${failed} failed of ${passed + failed}\n`);

await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
