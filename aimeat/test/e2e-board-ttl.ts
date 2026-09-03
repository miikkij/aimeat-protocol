/**
 * @file e2e-board-ttl.ts
 * @description E2E for board posts: TTL expiry and the default/custom ttl_hours arithmetic,
 *   reactions and replies, subscriptions with category filters and webhook fan-out, the public-board
 *   morsel price, and the access rules (private, shared, public, and the operator gate on creating a
 *   public board).
 * @version-history
 *   v1.0.0 -- 2026-02-26 -- Initial (T-6 board post TTL).
 *   v1.1.0 -- 2026-08-11 -- Phase 6 (Tier 0.5 one-time-key posting) removed with the routes it
 *     covered; a reply on a private board asks the board's access question (test 9).
 *   v1.2.0 -- 2026-08-12 -- August 2026 audit H-2: the operator-gated public-board creation is
 *     driven by the OWNER session, because an agent JWT no longer carries its owner's roles.
 *     Test 35 proves the operator gate with a non-operator owner session as well as an agent one.
 *   v1.3.0 -- 2026-08-30 -- Phase 9, with the RFC §27 reinstatement: the cursor page (37), a reply's
 *     inherited expiry (38), subscriptions gone with their board (39), and auto-hide enforced on the
 *     listing and the single-post read (40). All four failed on the source before the fix.
 *   v1.4.0 -- 2026-08-30 -- Test 35 turned around: any account opens a public board (35), up to the
 *     node's count (35b); system boards stay the operator's. Phase 10: the board's own rules (41),
 *     a notice extended and taken down (42), the poster's standing on the listing (43).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=board-ttl

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

await test('5a. …and reading it BY ID is a 404 too, not only the listing', async () => {
    // Ending only in the list is not ending. getPost had no TTL clause while listPosts did, so a
    // post whose lifetime had run out was gone from the board and still readable at its own
    // address — on both providers. Test 3 above proves the same read works while the post is live,
    // so this pair says the difference is the expiry and nothing else.
    const { status } = await json(`/v1/boards/${privateBoardId}/posts/${ttlPostId}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 404, `expired post still readable by id: status ${status}`);
});

await test('5b. The TTL cleanup job runs and the expired row is gone after it', async () => {
    // This used to read the expired post by id BEFORE the sweep and expect 200, using the
    // single-post read's TTL-blindness as its probe: 200 then 404 meant the row had really gone
    // rather than merely been filtered. That read now refuses an expired post — a post given a
    // lifetime should not be readable at its own address after it ends — so the probe went with it.
    //
    // The delete-rather-than-filter claim moved to test/unit/board-ttl-prune.test.ts, where
    // pruneExpiredBoardPosts is asked directly how many rows it removed. What is left here is what
    // HTTP can still see: the job is reachable, it runs, and the post is gone afterwards.
    // Until 2026-08-17 the Postgres backend failed the original — the job read posts and deleted nothing.
    const created = await json(`/v1/boards/${privateBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Prune me', body: 'Expired row for the sweep', ttl_hours: 0.0004 }),
    });
    assert(created.status === 201, `create status ${created.status}`);
    const pruneId = created.body.data.id;
    await sleep(2000);   // 0.0004h ≈ 1.44s

    const trig = await json('/v1/admin/scheduler/jobs/core:board-post-ttl-cleanup/trigger', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },   // first owner is auto-operator
    });
    assert(trig.status === 200, `trigger status ${trig.status}: ${JSON.stringify(trig.body)}`);

    const after = await json(`/v1/boards/${privateBoardId}/posts/${pruneId}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(after.status === 404, `pruned row must 404, got ${after.status}`);
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

// A30 (E2E test-quality audit) was raised against this test and does NOT hold: agent-B is a second
// agent of the SAME owner (see "Register agent-B"), so reacting on its owner's private board is
// exactly right and nothing here is cross-owner. What this test does not cover — and should not be
// read as covering — is a reaction from a DIFFERENT owner. services/board-write.ts:193 records that
// deliberately: "Neither door loads the board here, so a reaction lands on any post whose ids the
// caller knows … left as it is." That is a written decision, not an oversight, and changing it is a
// permission decision rather than a repair.
await test('8b. A second agent of the same owner reacts with a different emoji', async () => {
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

// Named for what it proves: agent-A created the shared board, so agent-A passes the subscribers gate
// as its BOARD OWNER. The gate's other arm is 'operator', which an agent session has not carried
// since H-2, so an agent token here is correct only while it is the board's owner.
await test('13. List subscribers (board owner = agent-A)', async () => {
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

// A public board is operator-only, and the first registered owner is the operator. This suite used
// agentToken here, which worked because POST /v1/auth/token copied the owner's 'owner' and
// 'operator' roles onto the agent JWT. Audit finding H-2 closed that: an agent session is exactly
// ['agent'] now, matching what device-auth, the MCP OAuth path and the refresh path always issued.
// So the operator credential is ownerToken, the owner session from the signing mint, whose roles
// come from the owner record. requireRole('agent') admits an owner session (operator > owner >
// agent), and requireScope steps aside for it. DO NOT switch this back to agentToken: the board
// would 403 again, and every public-board test after it would 404 on an id that was never minted.
await test('20. Create public board (operator)', async () => {
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
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
let nonOpAgentGaii = '';

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
    nonOpAgentGaii = aBody.data.agent.gaii;
    nonOpAgentToken = await getToken(nonOpAgentGaii, aBody.data.private_key, true);
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

let nonOpPublicBoardId = '';

await test('35. Any account opens a public board; a system board stays the operator\'s', async () => {
    // Until 2026-08-30 this test asserted the opposite: public boards were the operator's to create.
    // RFC §27 reinstated boards as the notice board a person keeps for their street or their club,
    // so a non-operator owner, and that owner's agent, both open one. The system board is the
    // control: same credential, same route, 403, so the 201s are about `public` alone.
    const { status: agentStatus, body: agentBody } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nonOpAgentToken}` },
        body: JSON.stringify({ name: 'Espoo notices (agent)', visibility: 'public' }),
    });
    assert(agentStatus === 201, `expected 201 for a non-operator agent, got ${agentStatus}: ${JSON.stringify(agentBody)}`);

    const { status: ownerStatus, body: ownerBody } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nonOpOwnerToken}` },
        body: JSON.stringify({ name: 'Espoo notices', visibility: 'public' }),
    });
    assert(ownerStatus === 201, `expected 201 for a non-operator owner session, got ${ownerStatus}: ${JSON.stringify(ownerBody)}`);
    nonOpPublicBoardId = ownerBody.data.id;

    const { status: systemStatus } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nonOpOwnerToken}` },
        body: JSON.stringify({ name: 'Not the node', visibility: 'system' }),
    });
    assert(systemStatus === 403, `expected 403 for a system board from a non-operator, got ${systemStatus}`);
});

await test('35b. The eleventh public board of one account is refused', async () => {
    // A fresh owner, so the count starts at zero and the two boards of test 35 do not skew it.
    const name = `bd-quota-${Date.now()}`;
    const { body: oBody } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    const token = await getToken(name, oBody.data.private_key, false);
    for (let i = 1; i <= 10; i++) {
        const { status } = await json('/v1/boards', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name: `Quota board ${i}`, visibility: 'public' }),
        });
        assert(status === 201, `board ${i} of 10: expected 201, got ${status}`);
    }
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'Quota board 11', visibility: 'public' }),
    });
    assert(status === 403 && body.error?.code === 'BOARD_QUOTA', `board 11: expected 403 BOARD_QUOTA, got ${status} ${body.error?.code}`);
    const { status: privStatus } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'Still a private one', visibility: 'private' }),
    });
    assert(privStatus === 201, `a private board is not counted: expected 201, got ${privStatus}`);
    await json(`/v1/owners/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
});

await test('36. Unsubscribe when not subscribed → 404', async () => {
    const { status } = await json(`/v1/boards/${privateBoardId}/subscribe`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Phase 9: Reinstated boards (2026-08-30) ───
// Four defects the RFC §27 reinstatement found, none of which any test had asserted: the cursor
// was accepted and ignored on Postgres (page two was page one), a reply carried no expiry, a
// deleted board left its subscriptions behind, and a post past the auto-hide threshold stayed
// visible to everyone. Each test here failed on the source before its fix.
console.log('\nPhase 9 — Pages, reply expiry, deletion, hiding');

let pageBoardId = '';
const pageIds: string[] = [];

await test('37. Three posts, a page of two, then the cursor page holds the third and nothing else', async () => {
    const { status: bStatus, body: bBody } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'Page Board', visibility: 'shared' }),
    });
    assert(bStatus === 201, `board: ${bStatus} ${JSON.stringify(bBody)}`);
    pageBoardId = bBody.data.id;
    for (const n of [1, 2, 3]) {
        const { status, body } = await json(`/v1/boards/${pageBoardId}/posts`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ title: `Page post ${n}`, body: `Body ${n}` }),
        });
        assert(status === 201, `post ${n}: ${status} ${JSON.stringify(body)}`);
        pageIds.push(body.data.id);
    }
    const { body: p1 } = await json(`/v1/boards/${pageBoardId}/posts?limit=2`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(p1.data.posts.length === 2, `page 1 holds ${p1.data.posts.length} posts`);
    assert(p1.data.cursor === p1.data.posts[1].id, `cursor ${p1.data.cursor} is the last post of page 1`);
    const { body: p2 } = await json(`/v1/boards/${pageBoardId}/posts?limit=2&cursor=${encodeURIComponent(p1.data.cursor)}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(p2.data.posts.length === 1, `page 2 holds ${p2.data.posts.length} posts (2 means the cursor was ignored)`);
    const seen = new Set<string>([...p1.data.posts.map((p: any) => p.id), ...p2.data.posts.map((p: any) => p.id)]);
    assert(seen.size === 3 && pageIds.every(id => seen.has(id)), 'the two pages cover all three posts once');
    assert(p2.data.cursor === undefined, `no cursor after the last page, got ${p2.data.cursor}`);
});

await test('38. A reply expires with the notice it answers', async () => {
    const { status: pStatus, body: post } = await json(`/v1/boards/${pageBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Expiring notice', body: 'Gone in two hours', ttl_hours: 2 }),
    });
    assert(pStatus === 201, `post: ${pStatus}`);
    const { status: rStatus, body: reply } = await json(`/v1/boards/${pageBoardId}/posts/${post.data.id}/replies`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ body: 'Still here?' }),
    });
    assert(rStatus === 201, `reply: ${rStatus} ${JSON.stringify(reply)}`);
    const { body: read } = await json(`/v1/boards/${pageBoardId}/posts/${reply.data.id}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(typeof post.data.ttl_expires_at === 'string', 'the notice has an expiry');
    assert(read.data.ttl_expires_at === post.data.ttl_expires_at,
        `reply expires ${read.data.ttl_expires_at}, notice ${post.data.ttl_expires_at}`);
    // The replies under the notice can be read together, and the listing counts them.
    const { status: lStatus, body: list } = await json(`/v1/boards/${pageBoardId}/posts/${post.data.id}/replies`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(lStatus === 200 && list.data.replies.length === 1 && list.data.replies[0].id === reply.data.id, `replies list: ${lStatus} ${JSON.stringify(list.data)}`);
    const { body: page } = await json(`/v1/boards/${pageBoardId}/posts?limit=10`, { headers: { Authorization: `Bearer ${agentToken}` } });
    const listed = page.data.posts.find((p: any) => p.id === post.data.id);
    assert(listed?.replies === 1, `the listing says ${listed?.replies} replies`);
});

await test('39. Deleting a board removes its subscriptions with it', async () => {
    const { status: sStatus } = await json(`/v1/boards/${pageBoardId}/subscribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({}),
    });
    assert(sStatus === 201, `subscribe: ${sStatus}`);
    const { status: dStatus } = await json(`/v1/boards/${pageBoardId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(dStatus === 200, `delete: ${dStatus}`);
    const { body } = await json('/v1/boards/subscriptions', {
        headers: { Authorization: `Bearer ${agent2Token}` },
    });
    assert(!body.data.subscriptions.some((s: any) => s.board_id === pageBoardId),
        'a subscription to the deleted board still lists');
});

await test('40. Five reports hide a public post from everyone but its author and the board owner', async () => {
    // The poster is the non-operator owner's agent, whose owner still holds its welcome balance
    // (test 23 drained the first owner's). The public board belongs to the operator owner.
    const { status: pStatus, body: post } = await json(`/v1/boards/${publicBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${nonOpAgentToken}` },
        body: JSON.stringify({ title: 'Reported notice', body: 'Five people will report this.' }),
    });
    assert(pStatus === 201, `post: ${pStatus} ${JSON.stringify(post)}`);
    const hiddenId = post.data.id;
    const reporters = [ownerToken, agentToken, agent2Token, nonOpOwnerToken, nonOpAgentToken];
    for (const [i, token] of reporters.entries()) {
        const { status, body } = await json('/v1/flags', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ targetType: 'board_post', targetId: hiddenId, reason: 'spam' }),
        });
        assert(status === 201, `report ${i + 1}: ${status} ${JSON.stringify(body)}`);
    }
    const { body: anonList } = await json(`/v1/boards/${publicBoardId}/posts?limit=100`);
    assert(!anonList.data.posts.some((p: any) => p.id === hiddenId), 'a stranger still sees the hidden post in the listing');
    const { status: anonOne } = await json(`/v1/boards/${publicBoardId}/posts/${hiddenId}`);
    assert(anonOne === 403, `a stranger opening the hidden post: expected 403, got ${anonOne}`);
    const { body: authorList } = await json(`/v1/boards/${publicBoardId}/posts?limit=100`, {
        headers: { Authorization: `Bearer ${nonOpAgentToken}` },
    });
    assert(authorList.data.posts.some((p: any) => p.id === hiddenId), 'the author no longer sees their own hidden post');
    const { status: ownerOne } = await json(`/v1/boards/${publicBoardId}/posts/${hiddenId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(ownerOne === 200, `the board owner opening the hidden post: expected 200, got ${ownerOne}`);
});

// ─── Phase 10: The board's own rules, a notice after publishing, the poster's standing ───
console.log('\nPhase 10 — Rules, resolving and extending, standing');

await test('41. The keeper sets the rules: who posts, the categories, the lifetime, the price', async () => {
    const rules = { posting: 'owner', categories: ['for-sale', 'wanted'], default_ttl_hours: 720, post_cost: 0 };
    const { status: rStatus, body: rBody } = await json(`/v1/boards/${nonOpPublicBoardId}/rules`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${nonOpOwnerToken}` },
        body: JSON.stringify({ rules }),
    });
    assert(rStatus === 200, `rules: ${rStatus} ${JSON.stringify(rBody)}`);
    assert(rBody.data.rules.posting === 'owner' && rBody.data.rules.post_cost === 0, `rules echoed: ${JSON.stringify(rBody.data.rules)}`);

    // A stranger may not set them, and a stranger may not post on an owner-only board.
    const { status: strangerRules } = await json(`/v1/boards/${nonOpPublicBoardId}/rules`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${agentToken}` }, body: JSON.stringify({ rules: null }),
    });
    assert(strangerRules === 403, `a stranger setting rules: expected 403, got ${strangerRules}`);
    const { status: strangerPost } = await json(`/v1/boards/${nonOpPublicBoardId}/posts`, {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Not mine to post', body: 'x', category: 'for-sale' }),
    });
    assert(strangerPost === 403, `a stranger posting on an owner-only board: expected 403, got ${strangerPost}`);

    // The keeper's own agent posts; a category outside the list is refused, one inside lands with
    // the board's default lifetime and at the board's price, which is nothing.
    const { status: badCat } = await json(`/v1/boards/${nonOpPublicBoardId}/posts`, {
        method: 'POST', headers: { Authorization: `Bearer ${nonOpAgentToken}` },
        body: JSON.stringify({ title: 'Wrong shelf', body: 'x', category: 'gossip' }),
    });
    assert(badCat === 400, `a category the board does not file: expected 400, got ${badCat}`);
    const { body: before } = await json('/v1/wallet', { headers: { Authorization: `Bearer ${nonOpAgentToken}` } });
    const { status: okStatus, body: okBody } = await json(`/v1/boards/${nonOpPublicBoardId}/posts`, {
        method: 'POST', headers: { Authorization: `Bearer ${nonOpAgentToken}` },
        body: JSON.stringify({ title: 'Bike for sale', body: 'Red, 16 inch, 60 euros.', category: 'for-sale' }),
    });
    assert(okStatus === 201, `post under a listed category: ${okStatus} ${JSON.stringify(okBody)}`);
    const hoursLeft = (new Date(okBody.data.ttl_expires_at).getTime() - Date.now()) / 3600_000;
    assert(hoursLeft > 719 && hoursLeft <= 720, `default lifetime 720 h, got ${hoursLeft.toFixed(1)} h`);
    const { body: after } = await json('/v1/wallet', { headers: { Authorization: `Bearer ${nonOpAgentToken}` } });
    assert(after.data.balance === before.data.balance, `a board priced at 0 charged ${before.data.balance - after.data.balance}`);

    // Back to the node's defaults.
    const { status: resetStatus, body: resetBody } = await json(`/v1/boards/${nonOpPublicBoardId}/rules`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${nonOpOwnerToken}` }, body: JSON.stringify({ rules: null }),
    });
    assert(resetStatus === 200 && resetBody.data.rules === undefined, `reset: ${resetStatus} ${JSON.stringify(resetBody.data)}`);
});

await test('42. A notice is given more time, then taken down as handled', async () => {
    const { status: pStatus, body: post } = await json(`/v1/boards/${nonOpPublicBoardId}/posts`, {
        method: 'POST', headers: { Authorization: `Bearer ${nonOpAgentToken}` },
        body: JSON.stringify({ title: 'Cat missing', body: 'Grey, red collar, Tapiola.', ttl_hours: 24 }),
    });
    assert(pStatus === 201, `post: ${pStatus} ${JSON.stringify(post)}`);
    const id = post.data.id;
    const { status: strangerStatus } = await json(`/v1/boards/${nonOpPublicBoardId}/posts/${id}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${agentToken}` }, body: JSON.stringify({ ttl_hours: 48 }),
    });
    assert(strangerStatus === 403, `a stranger extending: expected 403, got ${strangerStatus}`);
    const { status: extStatus, body: ext } = await json(`/v1/boards/${nonOpPublicBoardId}/posts/${id}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${nonOpAgentToken}` }, body: JSON.stringify({ ttl_hours: 48 }),
    });
    assert(extStatus === 200, `extend: ${extStatus} ${JSON.stringify(ext)}`);
    assert(new Date(ext.data.ttl_expires_at).getTime() > new Date(post.data.ttl_expires_at).getTime(), 'the expiry moved later');
    const { status: emptyStatus } = await json(`/v1/boards/${nonOpPublicBoardId}/posts/${id}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${nonOpAgentToken}` }, body: JSON.stringify({}),
    });
    assert(emptyStatus === 400, `neither ttl_hours nor resolved: expected 400, got ${emptyStatus}`);
    const { status: doneStatus, body: done } = await json(`/v1/boards/${nonOpPublicBoardId}/posts/${id}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${nonOpOwnerToken}` }, body: JSON.stringify({ resolved: true }),
    });
    assert(doneStatus === 200 && done.data.resolved === true, `the keeper resolves: ${doneStatus} ${JSON.stringify(done)}`);
    const { status: goneStatus } = await json(`/v1/boards/${nonOpPublicBoardId}/posts/${id}`);
    assert(goneStatus === 404, `a handled notice is gone: expected 404, got ${goneStatus}`);
});

await test('43. A reader sees the poster\'s standing: notices, thanks, since when', async () => {
    const { body: list } = await json(`/v1/boards/${nonOpPublicBoardId}/posts`);
    const mine = list.data.posts.find((p: any) => p.author_gaii === nonOpAgentGaii);
    assert(mine, 'the agent\'s bike notice is on the board');
    const { status: thanksStatus } = await json(`/v1/boards/${nonOpPublicBoardId}/posts/${mine.id}/react`, {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` }, body: JSON.stringify({ reaction: 'thanks' }),
    });
    assert(thanksStatus === 200 || thanksStatus === 201, `thanks: ${thanksStatus}`);
    const { body: again } = await json(`/v1/boards/${nonOpPublicBoardId}/posts`);
    const standing = again.data.authors?.[nonOpAgentGaii];
    assert(standing, `authors block carries ${nonOpAgentGaii}: ${JSON.stringify(again.data.authors)}`);
    assert(standing.posts >= 1, `posts ${standing.posts}`);
    assert(standing.thanks >= 1, `thanks ${standing.thanks}`);
    assert(typeof standing.since === 'string', `since ${standing.since}`);
    const { body: one } = await json(`/v1/boards/${nonOpPublicBoardId}/posts/${mine.id}`);
    assert(one.data.author?.thanks >= 1, `single post carries the author's standing: ${JSON.stringify(one.data.author)}`);
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
