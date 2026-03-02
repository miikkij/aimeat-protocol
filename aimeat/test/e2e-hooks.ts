// T-7: Hook Execution E2E Tests
// Run: cd aimeat && pnpm exec tsx test/e2e-hooks.ts

import * as http from 'node:http';
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
const ownerName = `hkowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentPrivKey = '';
let agentToken = '';

// Second agent (provider for work)
let providerGaii = '';
let providerPrivKey = '';
let providerToken = '';

// Hook actions
let hookActionId = '';
let hookAction2Id = '';
let postHookActionId = '';

// Board
let boardId = '';

// Mock webhook server
let hookShouldAllow = true;
let hookShouldError = false;
const hookPayloads: any[] = [];

const hookServer = http.createServer((req, res) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
        try { hookPayloads.push(JSON.parse(data)); } catch { /* ignore */ }

        if (hookShouldError) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal hook error' }));
            return;
        }

        if (hookShouldAllow) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ allowed: true }));
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ allowed: false, reason: 'Test block' }));
        }
    });
});

console.log('\n=== AIMEAT Hook Execution E2E Test ===\n');

// ─── Phase 1: Setup ───
console.log('Phase 1 — Setup');

await new Promise<void>(resolve => hookServer.listen(0, '127.0.0.1', resolve));
const hookPort = (hookServer.address() as any).port;
const hookUrl = `http://127.0.0.1:${hookPort}/hook`;

await test('1. Mock webhook server started', async () => {
    assert(hookPort > 0, `port: ${hookPort}`);
    console.log(`    Hook server on port ${hookPort}`);
});

await test('2. Register owner (operator) + agents', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `owner: ${status}`);
    ownerPrivKey = body.data.private_key;
    ownerToken = await getToken(ownerName, ownerPrivKey, false);

    // Agent-A (requester)
    const { body: aBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'hk-requester', owner: ownerName, capabilities: ['work'], model: 'gpt-4o' }),
    });
    assert(aBody.ok, `agent-A: ${JSON.stringify(aBody.error)}`);
    agentGaii = aBody.data.agent.gaii;
    agentPrivKey = aBody.data.private_key;
    agentToken = await getToken(agentGaii, agentPrivKey, true);

    // Agent-B (provider)
    const { body: bBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'hk-provider', owner: ownerName, capabilities: ['work'], model: 'gpt-4o' }),
    });
    assert(bBody.ok, `agent-B: ${JSON.stringify(bBody.error)}`);
    providerGaii = bBody.data.agent.gaii;
    providerPrivKey = bBody.data.private_key;
    providerToken = await getToken(providerGaii, providerPrivKey, true);
});

await test('3. Publish action with webhook URL', async () => {
    hookActionId = 'hook-test-action';
    const { status, body } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({
            id: hookActionId,
            display_name: 'Hook Test Action',
            description: 'Action used for hook testing',
            input_schema: { type: 'object' },
            output_schema: { type: 'object' },
            pricing: { base_morsels: 0 },
            webhook_url: hookUrl,
        }),
    });
    assert(status === 201, `action: ${status} ${JSON.stringify(body)}`);
});

await test('4. Configure pre_work_request hook', async () => {
    const { status, body } = await json('/v1/admin/hooks/pre_work_request', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ actions: [hookActionId] }),
    });
    assert(status === 200, `hook config: ${status} ${JSON.stringify(body)}`);
    assert(body.data.actions.includes(hookActionId), 'action in hook list');
});

// ─── Phase 2: Pre-Hook Blocking (pre_work_request) ───
console.log('\nPhase 2 — Pre-Hook Blocking (pre_work_request)');

await test('5. Hook allows → work request succeeds', async () => {
    hookShouldAllow = true;
    hookShouldError = false;
    hookPayloads.length = 0;

    const { status, body } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            action_id: hookActionId,
            provider_gaii: providerGaii,
            input: { prompt: 'Hello hook' },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.tracking_code, 'has tracking_code');
});

await test('6. Hook server received context', async () => {
    assert(hookPayloads.length >= 1, `expected webhook payload, got ${hookPayloads.length}`);
    const payload = hookPayloads[0];
    assert(payload.hook === 'pre_work_request', `hook: ${payload.hook}`);
    assert(payload.action_ref === hookActionId, `action_ref: ${payload.action_ref}`);
    assert(payload.context.requester_gaii === agentGaii, `requester_gaii: ${payload.context.requester_gaii}`);
    assert(payload.context.action_id === hookActionId, `action_id: ${payload.context.action_id}`);
    assert(payload.context.provider_gaii === providerGaii, `provider_gaii: ${payload.context.provider_gaii}`);
    assert(payload.node_id === NODE_ID, `node_id: ${payload.node_id}`);
    assert(typeof payload.timestamp === 'string', 'has timestamp');
});

await test('7. Hook blocks → work request rejected (403)', async () => {
    hookShouldAllow = false;
    hookShouldError = false;

    const { status, body } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            action_id: hookActionId,
            provider_gaii: providerGaii,
            input: { prompt: 'Should be blocked' },
        }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'HOOK_REJECTED', `code: ${body.error?.code}`);
});

await test('8. Blocked work was NOT created', async () => {
    // List work from provider inbox — blocked request shouldn't appear
    const { body } = await json('/v1/work/inbox', {
        headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert(body.ok, 'ok');
    // Inbox only shows work for this provider; blocked requests should be absent
    const blocked = body.data.items?.filter((w: any) =>
        w.action_id === hookActionId && w.status === 'pending') ?? [];
    // We should have at most 1 pending from test 5 (the allowed one)
    assert(blocked.length <= 1, `expected <=1 pending items, found ${blocked.length}`);
});

// ─── Phase 3: Pre-Hook Failure = Block (fail-closed) ───
console.log('\nPhase 3 — Pre-Hook Failure = Block (fail-closed)');

await test('9. Hook returns 500 → work request blocked', async () => {
    hookShouldAllow = true;
    hookShouldError = true;

    const { status, body } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            action_id: hookActionId,
            provider_gaii: providerGaii,
            input: { prompt: 'Hook 500' },
        }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'HOOK_REJECTED', `code: ${body.error?.code}`);
});

await test('10. Hook server unreachable → work request blocked', async () => {
    // Point hook to a non-existent port
    // Use a second action pointing to bad URL
    const badActionId = 'hook-unreachable';
    const { status: createStatus } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({
            id: badActionId,
            display_name: 'Unreachable Hook',
            description: 'Hook action pointing to unreachable URL',
            input_schema: { type: 'object' },
            output_schema: { type: 'object' },
            pricing: { base_morsels: 0 },
            webhook_url: 'http://127.0.0.1:1/unreachable',
        }),
    });
    assert(createStatus === 201, `create action: ${createStatus}`);

    // Configure hook to use the unreachable action
    const { status: cfgStatus } = await json('/v1/admin/hooks/pre_work_request', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ actions: [badActionId] }),
    });
    assert(cfgStatus === 200, `config: ${cfgStatus}`);

    const { status, body } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            action_id: hookActionId,
            provider_gaii: providerGaii,
            input: { prompt: 'Hook unreachable' },
        }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'HOOK_REJECTED', `code: ${body.error?.code}`);

    // Restore hook to the working action
    await json('/v1/admin/hooks/pre_work_request', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ actions: [hookActionId] }),
    });
});

// ─── Phase 4: Post-Hook (post_settlement) ───
console.log('\nPhase 4 — Post-Hook (post_settlement)');

await test('11. Register post_settlement hook action', async () => {
    postHookActionId = 'hook-post-settle';
    const { status } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({
            id: postHookActionId,
            display_name: 'Post Settlement Hook',
            description: 'Fires after settlement',
            input_schema: { type: 'object' },
            output_schema: { type: 'object' },
            pricing: { base_morsels: 0 },
            webhook_url: hookUrl,
        }),
    });
    assert(status === 201, `create action: ${status}`);
});

await test('12. Configure post_settlement hook', async () => {
    const { status } = await json('/v1/admin/hooks/post_settlement', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ actions: [postHookActionId] }),
    });
    assert(status === 200, `config: ${status}`);
});

let workTrackingCode = '';

await test('13. Full work lifecycle: request → accept → deliver', async () => {
    hookShouldAllow = true;
    hookShouldError = false;
    hookPayloads.length = 0;

    // Request
    const { status: reqStatus, body: reqBody } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            action_id: hookActionId,
            provider_gaii: providerGaii,
            input: { prompt: 'Full lifecycle' },
        }),
    });
    assert(reqStatus === 201, `request: ${reqStatus}`);
    workTrackingCode = reqBody.data.tracking_code;

    // Accept (provider)
    const { status: accStatus } = await json(`/v1/work/${workTrackingCode}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert(accStatus === 200, `accept: ${accStatus}`);

    // Deliver (provider)
    const { status: delStatus } = await json(`/v1/work/${workTrackingCode}/deliver`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ output: { result: 'Done' } }),
    });
    assert(delStatus === 200, `deliver: ${delStatus}`);
});

await test('14. Post-settlement hook received context', async () => {
    // Give a moment for fire-and-forget hooks
    await sleep(1000);

    // Find the post_settlement payload
    const settlePayload = hookPayloads.find(p => p.hook === 'post_settlement');
    assert(settlePayload !== undefined, 'post_settlement payload not received');
    assert(settlePayload.context.tracking_code === workTrackingCode, `tc: ${settlePayload?.context?.tracking_code}`);
    assert(settlePayload.context.provider_gaii === providerGaii, `provider: ${settlePayload?.context?.provider_gaii}`);
    assert(settlePayload.context.requester_gaii === agentGaii, `requester: ${settlePayload?.context?.requester_gaii}`);
    assert(typeof settlePayload.context.cost === 'object', 'cost is object');
});

await test('15. Post-hook failure does not block delivery', async () => {
    // Create work with hooks in good state (pre_work_request hook is still active)
    hookShouldAllow = true;
    hookShouldError = false;

    const { body: reqBody } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            action_id: hookActionId,
            provider_gaii: providerGaii,
            input: { prompt: 'Post-hook fail test' },
        }),
    });
    assert(reqBody.ok, `work request failed: ${JSON.stringify(reqBody.error)}`);
    const tc = reqBody.data.tracking_code;

    await json(`/v1/work/${tc}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
    });

    // NOW enable hook errors so post_settlement fires and fails
    hookShouldError = true;

    const { status } = await json(`/v1/work/${tc}/deliver`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ output: { result: 'OK despite hook failure' } }),
    });
    // Delivery should succeed even though post_settlement hook returns 500
    assert(status === 200, `expected 200, got ${status}`);

    hookShouldError = false;
});

// ─── Phase 5: Pre-Hook on Federation (pre_federation_peer) ───
console.log('\nPhase 5 — Pre-Hook on Federation');

await test('16. Configure pre_federation_peer hook', async () => {
    const { status } = await json('/v1/admin/hooks/pre_federation_peer', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ actions: [hookActionId] }),
    });
    assert(status === 200, `config: ${status}`);
});

await test('17. Hook allows → peering request created', async () => {
    hookShouldAllow = true;
    hookPayloads.length = 0;

    const { status, body } = await json('/v1/federation/peer/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            target_url: 'http://remote-node.example.com',
            target_node_id: 'remote-001',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.request_id, 'has request_id');
});

await test('18. Federation hook received correct context', async () => {
    const payload = hookPayloads.find(p => p.hook === 'pre_federation_peer');
    assert(payload !== undefined, 'pre_federation_peer payload not received');
    assert(payload.context.target_url === 'http://remote-node.example.com', `target_url: ${payload?.context?.target_url}`);
    assert(payload.context.target_node_id === 'remote-001', `target_node_id: ${payload?.context?.target_node_id}`);
});

await test('19. Hook blocks → peering request rejected', async () => {
    hookShouldAllow = false;

    const { status, body } = await json('/v1/federation/peer/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            target_url: 'http://blocked-node.example.com',
            target_node_id: 'blocked-001',
        }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'HOOK_REJECTED', `code: ${body.error?.code}`);
});

// ─── Phase 6: Pre-Hook on Boards (pre_board_post) ───
console.log('\nPhase 6 — Pre-Hook on Boards');

await test('20. Create private board', async () => {
    hookShouldAllow = true;
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'Hook Board', visibility: 'private' }),
    });
    assert(status === 201, `board: ${status} ${JSON.stringify(body)}`);
    boardId = body.data.id;
});

await test('21. Configure pre_board_post hook', async () => {
    const { status } = await json('/v1/admin/hooks/pre_board_post', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ actions: [hookActionId] }),
    });
    assert(status === 200, `config: ${status}`);
});

await test('22. Hook allows → board post created', async () => {
    hookShouldAllow = true;
    hookPayloads.length = 0;

    const { status, body } = await json(`/v1/boards/${boardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Allowed Post', body: 'Hook said OK' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
});

await test('23. Board hook received correct context', async () => {
    const payload = hookPayloads.find(p => p.hook === 'pre_board_post');
    assert(payload !== undefined, 'pre_board_post payload not received');
    assert(payload.context.board_id === boardId, `board_id: ${payload?.context?.board_id}`);
    assert(payload.context.author_gaii === agentGaii, `author_gaii: ${payload?.context?.author_gaii}`);
});

await test('24. Hook blocks → board post rejected', async () => {
    hookShouldAllow = false;

    const { status, body } = await json(`/v1/boards/${boardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Blocked Post', body: 'Hook said no' }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'HOOK_REJECTED', `code: ${body.error?.code}`);
});

// ─── Phase 7: Multiple Hooks on Same Event ───
console.log('\nPhase 7 — Multiple Hooks on Same Event');

await test('25. Register second hook action', async () => {
    hookAction2Id = 'hook-test-action-2';
    const { status } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({
            id: hookAction2Id,
            display_name: 'Hook Test Action 2',
            description: 'Second hook action for multi-hook test',
            input_schema: { type: 'object' },
            output_schema: { type: 'object' },
            pricing: { base_morsels: 0 },
            webhook_url: hookUrl,
        }),
    });
    assert(status === 201, `create action: ${status}`);
});

await test('26. Configure two hooks on pre_work_request', async () => {
    const { status, body } = await json('/v1/admin/hooks/pre_work_request', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ actions: [hookActionId, hookAction2Id] }),
    });
    assert(status === 200, `config: ${status}`);
    assert(body.data.actions.length === 2, `expected 2 actions, got ${body.data.actions.length}`);
});

await test('27. Both hooks allow → work created', async () => {
    hookShouldAllow = true;
    hookShouldError = false;
    hookPayloads.length = 0;

    const { status, body } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            action_id: hookActionId,
            provider_gaii: providerGaii,
            input: { prompt: 'Both hooks allow' },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);

    // Both hooks should have been called
    const workHooks = hookPayloads.filter(p => p.hook === 'pre_work_request');
    assert(workHooks.length === 2, `expected 2 hook calls, got ${workHooks.length}`);
});

// For testing "first allows, second blocks" we need two separate mock servers
// or track call count. Since we have one server, we'll flip the flag after the first call.
let hookCallCount = 0;
const originalHandler = hookServer.listeners('request')[0] as any;

await test('28. First hook allows, second blocks → work blocked', async () => {
    // Replace hook server handler to allow first call, block second
    hookCallCount = 0;
    hookServer.removeAllListeners('request');
    hookServer.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
        let data = '';
        req.on('data', (chunk: string) => { data += chunk; });
        req.on('end', () => {
            try { hookPayloads.push(JSON.parse(data)); } catch { /* ignore */ }
            hookCallCount++;
            if (hookCallCount <= 1) {
                // First hook allows
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ allowed: true }));
            } else {
                // Second hook blocks
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ allowed: false, reason: 'Second hook blocks' }));
            }
        });
    });

    hookPayloads.length = 0;

    const { status, body } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            action_id: hookActionId,
            provider_gaii: providerGaii,
            input: { prompt: 'Second hook blocks' },
        }),
    });
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'HOOK_REJECTED', `code: ${body.error?.code}`);
    assert(hookCallCount === 2, `expected 2 hook calls, got ${hookCallCount}`);

    // Restore original handler behavior
    hookServer.removeAllListeners('request');
    hookServer.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
        let data = '';
        req.on('data', (chunk: string) => { data += chunk; });
        req.on('end', () => {
            try { hookPayloads.push(JSON.parse(data)); } catch { /* ignore */ }
            if (hookShouldError) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal hook error' }));
                return;
            }
            if (hookShouldAllow) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ allowed: true }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ allowed: false, reason: 'Test block' }));
            }
        });
    });
});

// ─── Phase 8: Hook Admin Management ───
console.log('\nPhase 8 — Hook Admin Management');

await test('29. GET /v1/admin/hooks → list all hooks', async () => {
    const { status, body } = await json('/v1/admin/hooks', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status: ${status}`);
    const hooks = body.data.extension_hooks;
    assert(hooks.pre_work_request !== undefined, 'has pre_work_request');
    assert(hooks.post_settlement !== undefined, 'has post_settlement');
    assert(hooks.pre_board_post !== undefined, 'has pre_board_post');
    assert(hooks.pre_federation_peer !== undefined, 'has pre_federation_peer');
});

await test('30. DELETE hook → clears actions', async () => {
    const { status, body } = await json('/v1/admin/hooks/pre_board_post', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status: ${status}`);
    assert(body.data.cleared === true, 'cleared');
    assert(body.data.actions.length === 0, 'empty actions');
});

await test('31. Board post succeeds after hook cleared', async () => {
    hookShouldAllow = false; // Would block if hook was still active

    const { status } = await json(`/v1/boards/${boardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'No Hook Post', body: 'Hook cleared, this should work' }),
    });
    assert(status === 201, `expected 201, got ${status}`);
});

await test('32. Invalid hook name → 400', async () => {
    const { status, body } = await json('/v1/admin/hooks/invalid_hook_name', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ actions: [hookActionId] }),
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'INVALID_INPUT', `code: ${body.error?.code}`);
});

await test('33. Invalid actions format → 400', async () => {
    const { status, body } = await json('/v1/admin/hooks/pre_work_request', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ actions: 'not-an-array' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

// ─── Phase 9: Post-Hook (post_work_delivery) ───
console.log('\nPhase 9 — Post-Hook (post_work_delivery)');

await test('34. Configure post_work_delivery hook', async () => {
    const { status } = await json('/v1/admin/hooks/post_work_delivery', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ actions: [hookActionId] }),
    });
    assert(status === 200, `config: ${status}`);
});

await test('35. Delivery triggers post_work_delivery hook', async () => {
    hookShouldAllow = true;
    hookShouldError = false;
    hookPayloads.length = 0;

    // Clear pre_work_request to avoid hook interference
    await json('/v1/admin/hooks/pre_work_request', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });

    const { body: reqBody } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            action_id: hookActionId,
            provider_gaii: providerGaii,
            input: { prompt: 'Test post_work_delivery' },
        }),
    });
    const tc = reqBody.data.tracking_code;

    await json(`/v1/work/${tc}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
    });

    await json(`/v1/work/${tc}/deliver`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ output: { result: 'PWD test' } }),
    });

    await sleep(1000);

    const deliveryPayload = hookPayloads.find(p => p.hook === 'post_work_delivery');
    assert(deliveryPayload !== undefined, 'post_work_delivery payload not received');
    assert(deliveryPayload.context.tracking_code === tc, `tc: ${deliveryPayload?.context?.tracking_code}`);
    assert(deliveryPayload.context.provider_gaii === providerGaii, `provider: ${deliveryPayload?.context?.provider_gaii}`);
    assert(deliveryPayload.context.requester_gaii === agentGaii, `requester: ${deliveryPayload?.context?.requester_gaii}`);
});

// ─── Phase 10: Hook with no webhookUrl (no-op placeholder) ───
console.log('\nPhase 10 — No-op Hook (action without webhookUrl)');

await test('36. Action without webhookUrl → allows by default', async () => {
    const noopActionId = 'hook-noop-action';
    const { status: createStatus } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({
            id: noopActionId,
            display_name: 'No-op Hook Action',
            description: 'Action without webhookUrl',
            input_schema: { type: 'object' },
            output_schema: { type: 'object' },
            pricing: { base_morsels: 0 },
            // No webhook_url
        }),
    });
    assert(createStatus === 201, `create: ${createStatus}`);

    // Configure as pre_work_request hook
    await json('/v1/admin/hooks/pre_work_request', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ actions: [noopActionId] }),
    });

    // Work request should still succeed (no-op hook allows)
    const { status } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            action_id: hookActionId,
            provider_gaii: providerGaii,
            input: { prompt: 'No-op hook test' },
        }),
    });
    assert(status === 201, `expected 201, got ${status}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

// Reset all hooks
await test('Reset hooks', async () => {
    for (const hookName of ['pre_work_request', 'post_settlement', 'pre_federation_peer', 'pre_board_post', 'post_work_delivery']) {
        await json(`/v1/admin/hooks/${hookName}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
    }
});

hookServer.close();

await test('Cascade-delete owner', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status: ${status}`);
});

// ─── Summary ───
console.log(`\n${'═'.repeat(50)}`);
console.log(`Hook Execution E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));

writeFileSync('t7-results.txt', results.join('\n') + `\n\n${passed} passed, ${failed} failed of ${passed + failed}\n`);

await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
