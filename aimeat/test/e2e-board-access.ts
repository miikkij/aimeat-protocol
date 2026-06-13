/**
 * @file e2e-board-access.ts
 * @description E2E tests for board access control improvements.
 *   Verifies that shared boards auto-include same-owner agents, that private boards
 *   remain isolated, that external agents can be granted access via PATCH members,
 *   and that board listing aggregation works correctly for owners.
 * @version-history
 *   v1.0.0 — 2026-03-20 — Initial scaffold for board access control test suite
 *   v1.1.0 — 2026-03-20 — Implemented all test phases with real assertions
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-board-access.ts

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

// ─── State — Owner 1 (first owner = operator) ───
const owner1Name = `baowner1${Date.now()}`;
let owner1PrivKey = '';
let owner1Token = '';

// Agent-A: same owner as creator
let agentAGaii = '';
let agentAToken = '';

// Agent-B: same owner as creator (second agent under owner1)
let agentBGaii = '';
let agentBToken = '';

// ─── State — Owner 2 (external, non-operator) ───
const owner2Name = `baowner2${Date.now()}`;
let owner2PrivKey = '';
let owner2Token = '';

// Agent-C: belongs to owner2 (external agent)
let agentCGaii = '';
let agentCToken = '';

// Board IDs
let sharedBoardId = '';
let privateBoardId = '';
let agentBBoardId = '';
let agentCBoardId = '';

// Post IDs
let sharedBoardPostId = '';

console.log('\n=== AIMEAT Board Access Control E2E Test ===\n');

// ─── Setup ───
console.log('Setup — Owners & Agents');

await test('Register owner1 (gets operator role as first owner)', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: owner1Name, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    owner1PrivKey = body.data.private_key;
    owner1Token = await getToken(owner1Name, owner1PrivKey, false);
});

await test('Register agent-A (under owner1)', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner1Token}` },
        body: JSON.stringify({ name: 'ba-agent-a', owner: owner1Name, capabilities: ['boards'], model: 'gpt-4o' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentAGaii = body.data.agent.gaii;
    agentAToken = await getToken(agentAGaii, body.data.private_key, true);
});

await test('Register agent-B (under owner1, same owner as agent-A)', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner1Token}` },
        body: JSON.stringify({ name: 'ba-agent-b', owner: owner1Name, capabilities: ['boards'], model: 'gpt-4o' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentBGaii = body.data.agent.gaii;
    agentBToken = await getToken(agentBGaii, body.data.private_key, true);
});

await test('Register owner2 (external, non-operator)', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: owner2Name, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    owner2PrivKey = body.data.private_key;
    owner2Token = await getToken(owner2Name, owner2PrivKey, false);
});

await test('Register agent-C (under owner2, external agent)', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner2Token}` },
        body: JSON.stringify({ name: 'ba-agent-c', owner: owner2Name, capabilities: ['boards'], model: 'gpt-4o' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentCGaii = body.data.agent.gaii;
    agentCToken = await getToken(agentCGaii, body.data.private_key, true);
});

// ─── Phase 1: Same-owner shared board access ───
console.log('\nPhase 1 — Same-owner shared board access');

await test('1. agent-A creates a shared board', async () => {
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ name: 'BA Shared Board', visibility: 'shared' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    sharedBoardId = body.data.id;
    assert(sharedBoardId.startsWith('board-'), `id: ${sharedBoardId}`);
});

await test('2. agent-A posts to the shared board', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ title: 'Hello from agent-A', body: 'Initial shared board post' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    sharedBoardPostId = body.data.id;
    assert(sharedBoardPostId.startsWith('post-'), `post id: ${sharedBoardPostId}`);
});

await test('3. agent-B (same owner) can list the shared board in GET /v1/boards', async () => {
    const { status, body } = await json('/v1/boards', {
        headers: { Authorization: `Bearer ${agentBToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const boards: any[] = body.data.boards;
    const found = boards.find((b: any) => b.id === sharedBoardId);
    assert(!!found, `shared board ${sharedBoardId} not visible to agent-B; boards: ${boards.map((b: any) => b.id).join(', ')}`);
});

await test('4. agent-B can read posts on the shared board', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/posts`, {
        headers: { Authorization: `Bearer ${agentBToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const posts: any[] = body.data.posts;
    const found = posts.find((p: any) => p.id === sharedBoardPostId);
    assert(!!found, `agent-A's post not visible to agent-B`);
});

await test('5. agent-B can post to the shared board', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentBToken}` },
        body: JSON.stringify({ title: 'Hello from agent-B', body: 'Same-owner agent posting' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
});

await test('6. agent-B can subscribe to the shared board', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/subscribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentBToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.board_id === sharedBoardId, `board_id: ${body.data.board_id}`);
    // Cleanup subscription so it doesn't interfere with later tests
    await json(`/v1/boards/${sharedBoardId}/subscribe`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentBToken}` },
    });
});

// ─── Phase 2: Private board isolation ───
console.log('\nPhase 2 — Private board isolation');

await test('7. agent-A creates a private board', async () => {
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ name: 'BA Private Board', visibility: 'private' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    privateBoardId = body.data.id;
    assert(privateBoardId.startsWith('board-'), `id: ${privateBoardId}`);
});

await test('8. agent-B (same owner) CANNOT read posts on the private board', async () => {
    const { status } = await json(`/v1/boards/${privateBoardId}/posts`, {
        headers: { Authorization: `Bearer ${agentBToken}` },
    });
    assert(status === 403, `expected 403 (private board), got ${status}`);
});

await test('9. agent-C (external) CANNOT read posts on the private board', async () => {
    const { status } = await json(`/v1/boards/${privateBoardId}/posts`, {
        headers: { Authorization: `Bearer ${agentCToken}` },
    });
    assert(status === 403, `expected 403 (private board), got ${status}`);
});

// ─── Phase 3: External agent access via PATCH members ───
console.log('\nPhase 3 — External agent access via PATCH members');

await test('10. agent-C CANNOT read the shared board (not in allowedGaiis, different owner)', async () => {
    const { status } = await json(`/v1/boards/${sharedBoardId}/posts`, {
        headers: { Authorization: `Bearer ${agentCToken}` },
    });
    assert(status === 403, `expected 403 for external agent, got ${status}`);
});

await test('11. owner1 adds agent-C to shared board via PATCH /v1/boards/{id}/members', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/members`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${owner1Token}` },
        body: JSON.stringify({ add: [agentCGaii] }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const allowedGaiis: string[] = body.data.allowed_gaiis;
    assert(allowedGaiis.includes(agentCGaii), `agent-C not in allowed_gaiis after add: ${JSON.stringify(allowedGaiis)}`);
});

await test('12. agent-C CAN now read posts on the shared board', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/posts`, {
        headers: { Authorization: `Bearer ${agentCToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.posts), 'posts array');
});

await test('13. agent-C CAN post to the shared board after being added', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentCToken}` },
        body: JSON.stringify({ title: 'Hello from agent-C', body: 'External agent granted access' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
});

await test('14. owner1 removes agent-C from shared board via PATCH { remove: [...] }', async () => {
    const { status, body } = await json(`/v1/boards/${sharedBoardId}/members`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${owner1Token}` },
        body: JSON.stringify({ remove: [agentCGaii] }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const allowedGaiis: string[] = body.data.allowed_gaiis;
    assert(!allowedGaiis.includes(agentCGaii), `agent-C still in allowed_gaiis after remove: ${JSON.stringify(allowedGaiis)}`);
});

await test('15. agent-C CANNOT read the shared board after removal', async () => {
    const { status } = await json(`/v1/boards/${sharedBoardId}/posts`, {
        headers: { Authorization: `Bearer ${agentCToken}` },
    });
    assert(status === 403, `expected 403 after removal, got ${status}`);
});

// ─── Phase 4: PATCH members authorization ───
console.log('\nPhase 4 — PATCH members authorization');

await test('16. agent-A (agent session, not owner session) gets 403 on PATCH /v1/boards/{id}/members', async () => {
    const { status } = await json(`/v1/boards/${sharedBoardId}/members`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ add: [agentCGaii] }),
    });
    assert(status === 403, `expected 403 for agent session on PATCH members, got ${status}`);
});

await test('17. owner1 (operator) can PATCH members on a board owned by agent-C (different owner)', async () => {
    // First create a board under agent-C
    const { status: createStatus, body: createBody } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentCToken}` },
        body: JSON.stringify({ name: 'BA Agent-C Board', visibility: 'shared' }),
    });
    assert(createStatus === 201, `create board status ${createStatus}: ${JSON.stringify(createBody)}`);
    agentCBoardId = createBody.data.id;

    // owner1 (operator) PATCH members on agent-C's board
    const { status, body } = await json(`/v1/boards/${agentCBoardId}/members`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${owner1Token}` },
        body: JSON.stringify({ add: [agentAGaii] }),
    });
    assert(status === 200, `expected 200 for operator PATCH on foreign board, got ${status}: ${JSON.stringify(body)}`);
});

// ─── Phase 5: Board listing aggregation ───
console.log('\nPhase 5 — Board listing aggregation');

await test('18. agent-B creates a board so owner1 has boards from two of their agents', async () => {
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentBToken}` },
        body: JSON.stringify({ name: 'BA Agent-B Board', visibility: 'shared' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentBBoardId = body.data.id;
    assert(agentBBoardId.startsWith('board-'), `id: ${agentBBoardId}`);
});

await test('19. agent-A sees both agent-A board and agent-B board in GET /v1/boards (same owner)', async () => {
    const { status, body } = await json('/v1/boards', {
        headers: { Authorization: `Bearer ${agentAToken}` },
    });
    assert(status === 200, `status ${status}`);
    const ids = body.data.boards.map((b: any) => b.id);
    assert(ids.includes(sharedBoardId), `agent-A's own board ${sharedBoardId} not in list`);
    assert(ids.includes(agentBBoardId), `agent-B's board ${agentBBoardId} not visible to agent-A (same owner)`);
});

await test('20. owner2 token sees only boards created under owner2 (agent-C)', async () => {
    const { status, body } = await json('/v1/boards', {
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200, `status ${status}`);
    const ids: string[] = body.data.boards.map((b: any) => b.id);
    // agent-C's board should be visible to owner2
    assert(ids.includes(agentCBoardId), `agent-C's board ${agentCBoardId} not visible to owner2`);
    // agent-A's and agent-B's boards should NOT be visible to owner2 (shared boards of different owner)
    assert(!ids.includes(sharedBoardId), `owner1's shared board ${sharedBoardId} incorrectly visible to owner2`);
    assert(!ids.includes(agentBBoardId), `agent-B's board ${agentBBoardId} incorrectly visible to owner2`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade-delete owner2', async () => {
    if (!owner2Token) return;
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(owner2Name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

await test('Cascade-delete owner1', async () => {
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(owner1Name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner1Token}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

// ─── Summary ───
console.log(`\n${'═'.repeat(50)}`);
console.log(`Board Access E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));

writeFileSync('ba-results.txt', results.join('\n') + `\n\n${passed} passed, ${failed} failed of ${passed + failed}\n`);

await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
