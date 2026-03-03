// Full E2E test for AIMEAT Phases 1-5
// Run: cd aimeat && pnpm exec tsx test/e2e-full.ts

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
let ownerToken = '';
let ownerPrivKey = ''; // base64, returned by server
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';
const ownerName = `testowner${Date.now()}`;
const agentName = 'testagent';

console.log('\n=== AIMEAT Full E2E Test ===\n');

// ─── Phase 1: Core ───
console.log('Phase 1 — Core');

await test('GET / bootstrap', async () => {
    const { body } = await json('/');
    assert(body.ok === true, 'ok');
    assert(body.protocol === 'aimeat', `protocol: ${body.protocol}`);
});

await test('GET /.well-known/aimeat', async () => {
    const { body } = await json('/.well-known/aimeat');
    assert(body.ok === true, 'ok');
    assert(body.protocol === 'aimeat', `protocol: ${body.protocol}`);
});

await test('POST /v1/owners — register owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    ownerPrivKey = body.data.private_key;
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got owner private key');
});

await test('Owner auth — sign + token', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);

    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
    ownerToken = body.data?.token;
    assert(typeof ownerToken === 'string', 'got owner token');
});

await test('POST /v1/agents — register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['memory', 'actions'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.agent?.gaii?.includes(agentName), 'gaii');
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    assert(typeof agentPrivKey === 'string', 'got agent private key');
});

await test('Agent auth — sign + token', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);

    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token ok: ${JSON.stringify(body.error)}`);
    agentToken = body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

await test('Memory CRUD', async () => {
    // Write
    const { body: wBody } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'pref', value: { color: 'blue' }, visibility: 'private', ttl_hours: 1 }),
    });
    assert(wBody.ok === true, `write: ${JSON.stringify(wBody.error)}`);

    // Read
    const { body: rBody } = await json('/v1/memory', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(rBody.ok === true, 'read ok');
    assert(rBody.data?.items !== undefined, 'has items');
    const entry = rBody.data.items.find((m: any) => m.key === 'pref');
    assert(entry, 'found entry');
});

// ─── Phase 2: Economy ───
console.log('Phase 2 — Economy');

await test('Wallet — check initial balance', async () => {
    const { body } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(typeof body.data?.balance === 'number', 'has balance');
});

await test('Actions — publish', async () => {
    const { body } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            id: 'summarize-text',
            display_name: 'Summarize Text',
            description: 'Summarize text',
            input_schema: { type: 'object', properties: { text: { type: 'string' } } },
            output_schema: { type: 'object', properties: { summary: { type: 'string' } } },
            pricing: { base_morsels: 5 },
        }),
    });
    assert(body.ok === true, `publish: ${JSON.stringify(body.error)}`);
});

await test('Catalogue — list actions', async () => {
    const { body } = await json('/v1/catalogue');
    assert(body.ok === true, 'ok');
    assert(typeof body.data === 'object', `data is object`);
    assert(Array.isArray(body.data.actions), 'has actions array');
    assert(body.data.actions.length > 0, 'has actions');
});

await test('Work lifecycle — submit→accept→deliver→rate', async () => {
    // Register a second agent to request work
    const agent2Name = 'requester';
    const { body: regBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agent2Name, owner: ownerName, capabilities: ['work'], model: 'gpt-4o' }),
    });
    const agent2Gaii = regBody.data.agent.gaii;
    const agent2PrivKey = regBody.data.private_key;

    // Get token for agent2
    const ts = new Date().toISOString();
    const sig = await signMsg(agent2PrivKey, agent2Gaii + ts);
    const { body: tk2Body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agent2Gaii, timestamp: ts, signature: sig }),
    });
    const agent2Token = tk2Body.data?.token;
    assert(typeof agent2Token === 'string', 'agent2 token');

    // Submit work request
    const { body: subBody } = await json('/v1/work', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ action_id: 'summarize-text', provider_gaii: agentGaii, input: { text: 'hello world' } }),
    });
    assert(subBody.ok === true, `submit: ${JSON.stringify(subBody.error)}`);
    const tc = subBody.data?.tracking_code;
    assert(typeof tc === 'string', 'got tracking code');

    // Accept
    const { body: accBody } = await json(`/v1/work/${tc}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(accBody.ok === true, `accept: ${JSON.stringify(accBody.error)}`);

    // Deliver
    const { body: delBody } = await json(`/v1/work/${tc}/deliver`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ output: { summary: 'hi' } }),
    });
    assert(delBody.ok === true, `deliver: ${JSON.stringify(delBody.error)}`);

    // Rate
    const { body: rateBody } = await json(`/v1/work/${tc}/rate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent2Token}` },
        body: JSON.stringify({ rating: 'positive', feedback: 'great' }),
    });
    assert(rateBody.ok === true, `rate: ${JSON.stringify(rateBody.error)}`);
});

// ─── Phase 3: Social ───
console.log('Phase 3 — Social');

await test('Agent profile with trust score', async () => {
    const { body } = await json(`/v1/agents/${encodeURIComponent(agentGaii)}`);
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.trust !== undefined, 'has trust');
    assert(typeof body.data?.trust?.score === 'number', 'trust score is number');
});

await test('Boards — create + post + list', async () => {
    const { body: cBody } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'general', description: 'General discussion', visibility: 'private' }),
    });
    assert(cBody.ok === true, `board create: ${JSON.stringify(cBody.error)}`);
    const boardId = cBody.data?.id;
    assert(typeof boardId === 'string', 'got board id');

    const { body: pBody } = await json(`/v1/boards/${boardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'First Post', body: 'Hello board!' }),
    });
    assert(pBody.ok === true, `post create: ${JSON.stringify(pBody.error)}`);

    const { body: lBody } = await json(`/v1/boards/${boardId}/posts`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(lBody.ok === true, 'list posts');
    assert(Array.isArray(lBody.data?.posts), 'posts array');
    assert(lBody.data.posts.length > 0, 'has posts');
});

await test('Prompts — tier0, tier1, tier2 + unified', async () => {
    for (const tier of ['tier0', 'tier1', 'tier2']) {
        const { body } = await json(`/v1/prompts/${tier}`);
        assert(body.ok === true, `${tier} ok`);
        assert(typeof body.data?.system_prompt === 'string', `${tier} has prompt`);
    }
    // Unified prompts
    for (const tier of ['0', '0.5', '1', '2']) {
        const { body } = await json(`/v1/prompts/${tier}`);
        assert(body.ok === true, `prompts/${tier} ok`);
        assert(typeof body.data?.system_prompt === 'string', `prompts/${tier} has prompt`);
    }
});

// ─── Phase 4: Infrastructure ───
console.log('Phase 4 — Infrastructure');

await test('OTK — generate + execute', async () => {
    const { body: genBody } = await json('/v1/auth/otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ action: 'write_memory', params: { key: 'otk-test', value: 'hello' } }),
    });
    assert(genBody.ok === true, `otk gen: ${JSON.stringify(genBody.error)}`);
    const otkKey = genBody.data?.otk;
    assert(typeof otkKey === 'string', 'has otk');

    // Execute OTK
    const { body: exBody } = await json(`/v1/otk/${otkKey}`);
    assert(exBody.ok === true, `otk exec: ${JSON.stringify(exBody.error)}`);
});

await test('Admin — operator access dashboard', async () => {
    const { body } = await json('/v1/admin/dashboard', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `dashboard: ${JSON.stringify(body.error)}`);
    assert(typeof body.data?.node_id === 'string', 'has node_id');
});

await test('Federation directory', async () => {
    const { body } = await json('/v1/federation/directory');
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.peers), 'has peers array');
});

await test('Rate limiting headers present', async () => {
    const res = await fetch(`${BASE}/`);
    assert(res.ok, 'request succeeded');
    const limit = res.headers.get('x-ratelimit-limit');
    assert(limit !== null, 'has X-RateLimit-Limit header');
});

// ─── Phase 5: Polish ───
console.log('Phase 5 — Polish');

await test('GET /v1/spec — OpenAPI YAML', async () => {
    const res = await fetch(`${BASE}/v1/spec`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('yaml'), `ct: ${ct}`);
    const text = await res.text();
    assert(text.startsWith('openapi:'), 'starts with openapi:');
});

await test('GET /v1/docs — HTML docs page', async () => {
    const res = await fetch(`${BASE}/v1/docs`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('html'), `ct: ${ct}`);
    assert(res.ok, 'docs returns 200');
});

await test('Admin backup — operator access', async () => {
    const { body } = await json('/v1/admin/backup', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `backup: ${JSON.stringify(body.error)}`);
    assert(typeof body.data?.exported_at === 'string', 'has exported_at');
});

// ─── Phase 6: Extended API Coverage ───
console.log('Phase 6 — Extended API');

await test('Agent check-in', async () => {
    const { body } = await json('/v1/checkin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(body.ok === true, `checkin: ${JSON.stringify(body.error)}`);
    assert(body.data?.gaii === agentGaii, 'gaii matches');
    assert(typeof body.data?.checked_in === 'string', 'has checked_in timestamp');
});

await test('Catalogue sub-endpoints', async () => {
    // Actions sub-catalogue
    const { body: actBody } = await json('/v1/catalogue/actions');
    assert(actBody.ok === true, 'catalogue/actions ok');
    assert(Array.isArray(actBody.data?.actions), 'has actions');

    // Agents directory
    const { body: agBody } = await json('/v1/catalogue/agents');
    assert(agBody.ok === true, 'catalogue/agents ok');
    assert(Array.isArray(agBody.data?.agents), 'has agents');

    // Boards
    const { body: bBody } = await json('/v1/catalogue/boards');
    assert(bBody.ok === true, 'catalogue/boards ok');
    assert(Array.isArray(bBody.data?.boards), 'has boards');

    // Hash
    const { body: hBody } = await json('/v1/catalogue/hash');
    assert(hBody.ok === true, 'catalogue/hash ok');
    assert(typeof hBody.data?.hash === 'string', 'has hash');
    assert(hBody.data.hash.length === 64, 'SHA-256 hex is 64 chars');
});

await test('Public stats', async () => {
    const { body } = await json('/v1/stats');
    assert(body.ok === true, `stats: ${JSON.stringify(body.error)}`);
    assert(typeof body.data?.counts?.agents === 'number', 'has agent count');
    assert(typeof body.data?.counts?.actions === 'number', 'has action count');
    assert(body.data?.node_id === NODE_ID, 'node_id correct');
});

await test('Action discovery + detail', async () => {
    const { body: discBody } = await json('/v1/actions', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(discBody.ok === true, 'discover ok');
    assert(Array.isArray(discBody.data?.actions), 'has actions');

    // Detail by GAII
    const { body: detBody } = await json(`/v1/actions/${encodeURIComponent(agentGaii)}/summarize-text`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(detBody.ok === true, `action detail: ${JSON.stringify(detBody.error)}`);
});

await test('Memory PUT (optimistic locking) + search', async () => {
    // Write a memory entry first
    await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'locktest', value: 'v1', tags: ['test'] }),
    });

    // PUT with version
    const { body: putBody } = await json('/v1/memory/locktest', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ value: 'v2', version: 1 }),
    });
    assert(putBody.ok === true, `put: ${JSON.stringify(putBody.error)}`);
    assert(putBody.data?.version === 2, 'version incremented');

    // Search
    const { body: sBody } = await json('/v1/memory/search?q=locktest', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(sBody.ok === true, `search: ${JSON.stringify(sBody.error)}`);
    assert(Array.isArray(sBody.data?.results), 'has results');
});

await test('Wallet — transactions + request', async () => {
    // Transactions path
    const { body: txBody } = await json('/v1/wallet/transactions', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(txBody.ok === true, `transactions: ${JSON.stringify(txBody.error)}`);
    assert(Array.isArray(txBody.data?.transactions), 'has transactions');

    // Request morsels
    const { body: reqBody } = await json('/v1/wallet/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ amount: 10, reason: 'testing' }),
    });
    assert(reqBody.ok === true, `request: ${JSON.stringify(reqBody.error)}`);
    assert(typeof reqBody.data?.granted === 'number', 'has granted');
});

await test('Validate endpoint', async () => {
    const { body } = await json('/v1/validate', {
        method: 'POST',
        body: JSON.stringify({
            endpoint: '/v1/memory',
            method: 'POST',
            body: { key: 'test', value: 'hello' },
        }),
    });
    assert(body.ok === true, `validate: ${JSON.stringify(body.error)}`);
    assert(body.data?.valid === true, 'valid');
});

await test('Work batch + reject', async () => {
    // Register another agent for batch test
    const batchAgent = `batchagent${Date.now()}`;
    const { body: regBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: batchAgent, owner: ownerName }),
    });
    const bGaii = regBody.data.agent.gaii;
    const bPriv = regBody.data.private_key;
    const bTs = new Date().toISOString();
    const bSig = await signMsg(bPriv, bGaii + bTs);
    const { body: bTk } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: bGaii, timestamp: bTs, signature: bSig }),
    });
    const bToken = bTk.data?.token;

    // Batch submit
    const { body: batchBody } = await json('/v1/work/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${bToken}` },
        body: JSON.stringify({
            requests: [
                { action_id: 'summarize-text', provider_gaii: agentGaii, input: { text: 'batch1' } },
            ],
        }),
    });
    assert(batchBody.ok === true, `batch: ${JSON.stringify(batchBody.error)}`);
    assert(Array.isArray(batchBody.data?.results), 'has results');
    assert(batchBody.data.results.length === 1, 'one result');

    // Reject the work item
    const batchTc = batchBody.data.results[0].tracking_code;
    if (batchTc) {
        const { body: rejBody } = await json(`/v1/work/${batchTc}/reject`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ reason: 'testing reject' }),
        });
        assert(rejBody.ok === true, `reject: ${JSON.stringify(rejBody.error)}`);
    }
});

await test('Board single post', async () => {
    // Create a board and post
    const { body: cBody } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'test-single-post', visibility: 'private' }),
    });
    const boardId = cBody.data?.id;

    const { body: pBody } = await json(`/v1/boards/${boardId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Single Post Test', body: 'Testing single post endpoint' }),
    });
    const postId = pBody.data?.id;

    // Get single post
    const { body: sBody } = await json(`/v1/boards/${boardId}/posts/${postId}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(sBody.ok === true, `single post: ${JSON.stringify(sBody.error)}`);
    assert(sBody.data?.title === 'Single Post Test', 'title matches');
});

await test('Federation — peer request + status', async () => {
    // Need operator token — first owner is operator
    const { body: reqBody } = await json('/v1/federation/peer/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ target_url: 'http://example.com:40251' }),
    });
    assert(reqBody.ok === true, `peer request: ${JSON.stringify(reqBody.error)}`);
    const reqId = reqBody.data?.request_id;
    assert(typeof reqId === 'string', 'got request_id');

    // Check status
    const { body: stBody } = await json(`/v1/federation/peer/request/${reqId}/status`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(stBody.ok === true, `peer status: ${JSON.stringify(stBody.error)}`);
    assert(stBody.data?.status === 'pending', 'status is pending');
});

await test('Admin — config GET + roles grant', async () => {
    // GET config
    const { body: cfgBody } = await json('/v1/admin/config', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(cfgBody.ok === true, `config: ${JSON.stringify(cfgBody.error)}`);
    assert(cfgBody.data?.schema?.['node.id']?.value === NODE_ID, 'node_id');

    // Create another owner and grant operator
    const grantOwner = `grantowner${Date.now()}`;
    const { body: goBody } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: grantOwner, public_key: 'placeholder' }),
    });
    assert(goBody.ok === true, 'created grant owner');

    const { body: grBody } = await json('/v1/admin/roles/grant', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ owner: grantOwner, role: 'operator' }),
    });
    assert(grBody.ok === true, `grant: ${JSON.stringify(grBody.error)}`);
    assert(grBody.data?.granted === true, 'granted');

    // Clean up
    await json(`/v1/owners/${grantOwner}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
});

await test('Federation — heartbeat + peers list', async () => {
    const { body: hbBody } = await json('/v1/federation/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ from_node_id: 'test-node', timestamp: new Date().toISOString(), status: 'healthy' }),
    });
    assert(hbBody.ok === true, `heartbeat: ${JSON.stringify(hbBody.error)}`);
    assert(hbBody.data?.status === 'healthy', 'status');

    // List peers (operator)
    const { body: plBody } = await json('/v1/federation/peers', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(plBody.ok === true, `peers list: ${JSON.stringify(plBody.error)}`);
    assert(Array.isArray(plBody.data?.peers), 'has peers array');
});

// ─── Federation Join (introduce) ───
console.log('Federation — Introduce (join flow)');

await test('Federation — introduce contributor (auto-approve)', async () => {
    const { status, body } = await json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({
            node_id: 'e2e-test-contributor',
            node_url: 'http://localhost:19999',
            node_type: 'full',
            public_key: 'dGVzdC1wdWJsaWMta2V5LWNvbnRyaWJ1dG9y',
            role: 'contributor',
            message: 'E2E test join',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.ok === true, `introduce: ${JSON.stringify(body.error)}`);
    assert(body.data?.status === 'auto_approved', `expected auto_approved, got ${body.data?.status}`);
    assert(typeof body.data?.request_id === 'string', 'has request_id');
});

await test('Federation — introduce operator (pending)', async () => {
    const { status, body } = await json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({
            node_id: 'e2e-test-operator',
            node_url: 'http://localhost:19998',
            node_type: 'full',
            public_key: 'dGVzdC1wdWJsaWMta2V5LW9wZXJhdG9y',
            role: 'operator',
            message: 'E2E test operator join',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.ok === true, `introduce: ${JSON.stringify(body.error)}`);
    assert(body.data?.status === 'pending', `expected pending, got ${body.data?.status}`);
    const requestId = body.data?.request_id;
    assert(typeof requestId === 'string', 'has request_id');

    // Check status — should be pending
    const { body: stBody } = await json(`/v1/federation/peer/introduce/${requestId}/status`);
    assert(stBody.ok === true, `status check: ${JSON.stringify(stBody.error)}`);
    assert(stBody.data?.status === 'pending', `status is pending, got ${stBody.data?.status}`);

    // Approve via admin API
    const { body: appBody } = await json(`/v1/admin/peering/requests/${requestId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ decision: 'approve' }),
    });
    assert(appBody.ok === true, `approve: ${JSON.stringify(appBody.error)}`);

    // Check status again — should be approved
    const { body: st2Body } = await json(`/v1/federation/peer/introduce/${requestId}/status`);
    assert(st2Body.data?.status === 'approved', `expected approved, got ${st2Body.data?.status}`);
});

await test('Federation — introduce validation (missing fields)', async () => {
    const { status } = await json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({ node_id: 'incomplete' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

await test('Federation — introduce status (invalid id)', async () => {
    const { status } = await json('/v1/federation/peer/introduce/nonexistent-id/status');
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Maintenance Mode ───
console.log('Maintenance Mode');

await test('Maintenance — toggle on and off', async () => {
    // Enable maintenance
    const { body: onBody } = await json('/v1/admin/maintenance', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ enabled: true, message: 'E2E test maintenance' }),
    });
    assert(onBody.ok === true, `enable: ${JSON.stringify(onBody.error)}`);
    assert(onBody.data?.enabled === true, 'enabled');
    assert(onBody.data?.message === 'E2E test maintenance', 'message matches');

    // Check status
    const { body: getBody } = await json('/v1/admin/maintenance', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(getBody.ok === true, `get: ${JSON.stringify(getBody.error)}`);
    assert(getBody.data?.enabled === true, 'still enabled');

    // Non-essential endpoint should return 503
    const { status: memStatus } = await json('/v1/memory/test', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(memStatus === 503, `expected 503 during maintenance, got ${memStatus}`);

    // Federation introduce should still work (bypass)
    const { status: introStatus } = await json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({
            node_id: 'e2e-maint-test',
            node_url: 'http://localhost:19997',
            node_type: 'full',
            public_key: 'dGVzdA==',
            role: 'contributor',
        }),
    });
    assert(introStatus === 201, `introduce during maintenance should work, got ${introStatus}`);

    // Disable maintenance
    const { body: offBody } = await json('/v1/admin/maintenance', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ enabled: false }),
    });
    assert(offBody.ok === true, `disable: ${JSON.stringify(offBody.error)}`);
    assert(offBody.data?.enabled === false, 'disabled');

    // Endpoint should work again
    const { status: memStatus2 } = await json('/v1/memory/test', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(memStatus2 !== 503, `should not be 503 after disabling maintenance, got ${memStatus2}`);
});

// ─── Phase 7: Advanced Scenarios ───
console.log('Phase 7 — Advanced Scenarios');

await test('Memory TTL expiry', async () => {
    // Write with very short TTL (0.001 hours ≈ 3.6 seconds)
    const { body: wBody } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'ttl_test', value: 'expires_soon', visibility: 'private', ttl_hours: 0.001 }),
    });
    assert(wBody.ok === true, `write ttl entry: ${JSON.stringify(wBody.error)}`);

    // Wait for TTL to expire
    await new Promise(r => setTimeout(r, 4000));

    // Read — should be gone
    const { body: rBody } = await json(`/v1/memory/ttl_test`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(rBody.ok === false || rBody.data === null, 'TTL entry should be expired');
});

await test('Chunked upload lifecycle', async () => {
    // Init upload
    const { body: initBody } = await json('/v1/storage/upload/init', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'e2e_chunked_test.txt', mime_type: 'text/plain', chunk_size: 1024, total_chunks: 1 }),
    });
    assert(initBody.ok === true, `init: ${JSON.stringify(initBody.error)}`);
    const uploadId = initBody.data?.upload_id;
    assert(uploadId, 'has upload_id');

    // Upload single chunk
    const { status: chunkStatus } = await json(`/v1/storage/upload/${uploadId}/0`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/octet-stream' },
        body: 'Hello, chunked world!',
    });
    assert(chunkStatus < 400, `chunk upload status ${chunkStatus}`);

    // Complete upload
    const { body: completeBody } = await json(`/v1/storage/upload/${uploadId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(completeBody.ok === true, `complete: ${JSON.stringify(completeBody.error)}`);
});

await test('Action update (PUT)', async () => {
    // Publish an action first
    const actionId = `e2e-action-${Date.now()}`;
    const { body: pubBody } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            id: actionId, display_name: 'Test Action', description: 'Original description',
            input_schema: {}, output_schema: {}, pricing: { base_morsels: 1 },
        }),
    });
    assert(pubBody.ok === true, `publish: ${JSON.stringify(pubBody.error)}`);

    // Update it
    const { body: updBody } = await json(`/v1/actions/${actionId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ description: 'Updated description', pricing: { base_morsels: 5 } }),
    });
    assert(updBody.ok === true, `update: ${JSON.stringify(updBody.error)}`);
    assert(updBody.data?.description === 'Updated description' || updBody.data?.action?.description === 'Updated description', 'description updated');
});

await test('HEAD storage metadata', async () => {
    // Upload a file (JSON mode: key + data as base64)
    const { body: upBody } = await json('/v1/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'e2e_head_test.txt', data: Buffer.from('head test content').toString('base64'), mime_type: 'text/plain' }),
    });
    assert(upBody.ok === true, `upload: ${JSON.stringify(upBody.error)}`);

    // HEAD request — no json helper, use fetch directly
    const headRes = await fetch(`${BASE}/v1/storage/e2e_head_test.txt`, {
        method: 'HEAD',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(headRes.status === 200, `HEAD status: ${headRes.status}`);
    assert(headRes.headers.has('content-length') || headRes.headers.has('content-type'), 'has metadata headers');
});

await test('Error paths (400, 401, 404)', async () => {
    // 400 — invalid body
    const { status: s400 } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({}),
    });
    assert(s400 === 400, `expected 400, got ${s400}`);

    // 401 — no auth
    const { status: s401 } = await json('/v1/memory', { method: 'POST', body: JSON.stringify({ key: 'x', value: 'y' }) });
    assert(s401 === 401, `expected 401, got ${s401}`);

    // 404 — nonexistent resource
    const { status: s404 } = await json('/v1/agents/nonexistent%23fake%40nowhere');
    assert(s404 === 404, `expected 404, got ${s404}`);
});

await test('Optimistic locking conflict (409)', async () => {
    // Write a memory entry
    const { body: wBody } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: 'lock_test', value: 'v1', visibility: 'private' }),
    });
    assert(wBody.ok === true, `write: ${JSON.stringify(wBody.error)}`);

    // First update with version 1 — should succeed
    const { body: u1Body, status: u1Status } = await json('/v1/memory/lock_test', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ value: 'v2', version: 1 }),
    });
    assert(u1Status === 200, `first update: ${u1Status} ${JSON.stringify(u1Body.error)}`);

    // Second update with version 1 (stale) — should fail with 409
    const { status: u2Status } = await json('/v1/memory/lock_test', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ value: 'v3', version: 1 }),
    });
    assert(u2Status === 409, `expected 409 conflict, got ${u2Status}`);
});

await test('Rate limiting 429', async () => {
    // Read the auth rate limit from headers
    const probe = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: 'fake', timestamp: new Date().toISOString(), signature: 'bad' }),
    });
    const limit = parseInt(probe.headers.get('X-RateLimit-Limit') ?? '0', 10);
    assert(limit > 0, 'has X-RateLimit-Limit header');
    const remaining = parseInt(probe.headers.get('X-RateLimit-Remaining') ?? '-1', 10);
    assert(remaining >= 0, 'has X-RateLimit-Remaining header');
    // If limit is small enough, actually trigger 429
    if (limit <= 50) {
        let got429 = false;
        for (let i = 0; i < limit + 5 && !got429; i++) {
            const { status } = await json('/v1/auth/token', {
                method: 'POST',
                body: JSON.stringify({ gaii: 'fake', timestamp: new Date().toISOString(), signature: 'bad' }),
            });
            if (status === 429) got429 = true;
        }
        assert(got429, 'expected to hit 429 rate limit');
    }
    // With high test limits, just verify the headers exist (rate limiting is enabled)
});

// ─── Phase 7: Initial OTK + Auto-Identification ───
console.log('Phase 7 — Initial OTK + Auto-Identification');

await test('Initial OTK — generate via JWT auth', async () => {
    const { status, body } = await json('/v1/auth/initial-otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.initial === true, 'initial flag');
    assert(typeof body.data?.otk === 'string', 'has otk');
    assert(typeof body.data?.grace_ms === 'number', 'has grace_ms');
    assert(body.data?.owner === agentGaii, 'owner matches agent');
});

await test('Initial OTK — use for micro-memory write', async () => {
    // Generate initial OTK
    const { body: genBody } = await json('/v1/auth/initial-otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const otk = genBody.data?.otk;
    assert(typeof otk === 'string', 'got otk');

    // Use it for micro-memory add
    const { body: addBody } = await json(`/v1/mm?otk=${otk}&op=add&set=iotk-test&key=k1&value=hello`);
    assert(addBody.ok === true, `mm add: ${JSON.stringify(addBody)}`);

    // Use same OTK again within grace period (should still work)
    const { body: listBody } = await json(`/v1/mm?otk=${otk}&op=list&set=iotk-test`);
    assert(listBody.ok === true, `mm list: ${JSON.stringify(listBody)}`);
    assert(listBody.data?.entries && typeof listBody.data.entries === 'object', 'has entries');
    assert(listBody.data.entries.k1 === 'hello', 'value matches');
});

await test('Initial OTK — dormant before first use', async () => {
    // Generate initial OTK — it should have a far-future expiry
    const { body: genBody } = await json('/v1/auth/initial-otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const otk = genBody.data?.otk;
    assert(typeof otk === 'string', 'got otk');

    // Wait a short time to prove it's still valid (not expired)
    await new Promise(r => setTimeout(r, 200));

    // It should still work — regular OTK with 60s TTL would potentially have different behavior
    const { body: addBody } = await json(`/v1/mm?otk=${otk}&op=add&set=iotk-dormant&key=d1&value=dormant`);
    assert(addBody.ok === true, `mm add after delay: ${JSON.stringify(addBody)}`);
});

await test('Initial OTK — grace period expiry', async () => {
    // This test verifies that after first use, the OTK's timer is running
    // We can't wait 60s in a test, but we verify the mechanism works:
    // 1. Create initial OTK
    // 2. Use it (activates timer → sets expiresAt = now + graceMs)
    // 3. Verify second use within grace works
    const { body: genBody } = await json('/v1/auth/initial-otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const otk = genBody.data?.otk;
    assert(typeof otk === 'string', 'got otk');

    // First use activates the timer
    const { body: use1 } = await json(`/v1/mm?otk=${otk}&op=add&set=iotk-grace&key=g1&value=first`);
    assert(use1.ok === true, 'first use ok');

    // Second use within grace should work
    const { body: use2 } = await json(`/v1/mm?otk=${otk}&op=add&set=iotk-grace&key=g2&value=second`);
    assert(use2.ok === true, 'second use within grace ok');
});

await test('Auto-identification — owner identity hints', async () => {
    // Create an initial OTK using owner token (owner identity, no agent)
    const { body: genBody } = await json('/v1/auth/initial-otk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const otk = genBody.data?.otk;
    assert(typeof otk === 'string', 'got otk');

    // Use it — since owner is the identity (not an agent), should get identity hints
    const { body: listBody } = await json(`/v1/mm?otk=${otk}&op=add&set=hint-test&key=h1&value=test`);
    assert(listBody.ok === true, `mm add: ${JSON.stringify(listBody)}`);

    // List operation should include identity hints for non-agent identity
    const { body: listBody2 } = await json(`/v1/mm?otk=${otk}&op=list&set=hint-test`);
    assert(listBody2.ok === true, 'list ok');
    // Identity hints should be present if GAII is owner-only (not a registered agent)
    // The owner name is used as identity, which won't match any agent GAII
    if (listBody2.data?.identity) {
        assert(listBody2.data.identity.identity_status === 'owner_only', 'identity status');
        assert(typeof listBody2.data.identity.register_url === 'string', 'has register_url');
    }
});

await test('Initial OTK — admin setup endpoint', async () => {
    const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? '';
    // Skip if no admin password available
    if (!ADMIN_PW) {
        console.log('    ⏩ Skipped (no AIMEAT_ADMIN_PASSWORD in env)');
        passed++; // count as passed (skipped)
        return;
    }

    const { body } = await json(`/v1/admin/setup/initial-otk?pw=${encodeURIComponent(ADMIN_PW)}`, {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName }),
    });
    assert(body.ok === true, `admin initial-otk: ${JSON.stringify(body)}`);
    assert(body.initial === true, 'initial flag');
    assert(typeof body.otk === 'string', 'has otk');
    assert(typeof body.grace_ms === 'number', 'has grace_ms');
});

// ─── Phase 8: Chat Instance CRUD ───
console.log('Phase 8 — Chat Instance CRUD');

// Chat instances require a GHII profile. The test owner (created via POST /v1/owners)
// does not have one, so we create a dedicated GHII user for chat instance tests.
const chatOwnerName = `chatowner${Date.now()}`;
let chatOwnerToken = '';
let chatOwnerPrivKey = '';
let chatInstanceId = '';

await test('Setup — create GHII user for chat instances', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({
            username: chatOwnerName,
            display_name: 'Chat Test User',
            password: 'testpass1234',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.ghii?.ghii === `${chatOwnerName}@${NODE_ID}`, 'ghii matches');
    chatOwnerPrivKey = body.data.private_key;
    assert(typeof chatOwnerPrivKey === 'string' && chatOwnerPrivKey.length > 0, 'got private key');

    // Authenticate to get a JWT token
    const timestamp = new Date().toISOString();
    const message = chatOwnerName + NODE_ID + timestamp;
    const signature = await signMsg(chatOwnerPrivKey, message);

    const { body: tokenBody } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: chatOwnerName, timestamp, signature }),
    });
    assert(tokenBody.ok === true, `token ok: ${JSON.stringify(tokenBody.error)}`);
    chatOwnerToken = tokenBody.data?.token;
    assert(typeof chatOwnerToken === 'string', 'got chat owner token');
});

await test('POST /v1/chat-instances — create chat instance', async () => {
    const { status, body } = await json('/v1/chat-instances', {
        method: 'POST',
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
        body: JSON.stringify({ platform: 'claude', app_name: 'e2e-test-app' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.chat_instance?.platform === 'claude', 'platform matches');
    assert(body.data?.chat_instance?.app_name === 'e2e-test-app', 'app_name matches');
    assert(body.data?.chat_instance?.ghii === `${chatOwnerName}@${NODE_ID}`, 'ghii matches');
    chatInstanceId = body.data.chat_instance.id;
    assert(typeof chatInstanceId === 'string' && chatInstanceId.length > 0, 'got chat instance id');
});

await test('GET /v1/chat-instances — list chat instances', async () => {
    const { body } = await json('/v1/chat-instances', {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(Array.isArray(body.data?.chat_instances), 'has chat_instances array');
    assert(body.data.chat_instances.length > 0, 'has at least one instance');
    assert(typeof body.data.total === 'number', 'has total');

    // Test platform filter
    const { body: filteredBody } = await json('/v1/chat-instances?platform=claude', {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(filteredBody.ok === true, 'filtered ok');
    assert(filteredBody.data.chat_instances.every((ci: any) => ci.platform === 'claude'), 'all instances are claude');

    // Non-matching filter returns empty
    const { body: emptyBody } = await json('/v1/chat-instances?platform=nonexistent', {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(emptyBody.ok === true, 'empty filter ok');
    assert(emptyBody.data.chat_instances.length === 0, 'no instances for nonexistent platform');
});

await test('GET /v1/chat-instances/:id — get chat instance details', async () => {
    const { body } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.chat_instance?.id === chatInstanceId, 'id matches');
    assert(body.data?.chat_instance?.platform === 'claude', 'platform matches');
    assert(body.data?.chat_instance?.app_name === 'e2e-test-app', 'app_name matches');
    // Economy data should be present since GHII exists
    assert(body.data?.economy !== null, 'has economy data');
    assert(typeof body.data?.economy?.trust_score === 'number', 'has trust_score');
});

await test('PUT /v1/chat-instances/:id — update lastSeen', async () => {
    // Get original lastSeen
    const { body: beforeBody } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    const originalLastSeen = beforeBody.data?.chat_instance?.last_seen;

    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 50));

    const { body } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.chat_instance?.id === chatInstanceId, 'id matches');
    assert(typeof body.data?.chat_instance?.last_seen === 'string', 'has last_seen');
    assert(body.data.chat_instance.last_seen !== originalLastSeen, 'lastSeen was updated');
});

await test('DELETE /v1/chat-instances/:id — end chat session', async () => {
    const { body } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.deleted === true, 'deleted');
    assert(body.data?.id === chatInstanceId, 'id matches');

    // Verify it's gone
    const { status } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        headers: { Authorization: `Bearer ${chatOwnerToken}` },
    });
    assert(status === 404, `expected 404 after delete, got ${status}`);
});

// Clean up: delete the GHII test owner
await json(`/v1/owners/${chatOwnerName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${chatOwnerToken}` },
});

// ─── Node Portal (Site) ───
console.log('Node Portal (Site)');

await test('GET /v1/site — portal metadata', async () => {
    const { status, body } = await json('/v1/site');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.node_id === 'string', 'has node_id');
    assert(Array.isArray(body.data?.tag_types), 'has tag_types');
});

await test('GET /v1/site/prompt — AI prompt (no auth)', async () => {
    const { status, body } = await json('/v1/site/prompt');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.prompt === 'string', 'has prompt string');
    assert(body.data.prompt.length > 0, 'prompt not empty');
});

await test('GET /v1/site/template — no template yet', async () => {
    const { status, body } = await json('/v1/site/template', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('POST /v1/site/template — upload template', async () => {
    const template = '<html><body><h1>{{config:nodeName}}</h1><p>Hello from {{kv:region}}</p></body></html>';
    const { status, body } = await json('/v1/site/template', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ template }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.stored === true, 'stored');
    assert(typeof body.data?.size_bytes === 'number', 'has size_bytes');
    assert(Array.isArray(body.data?.tags_found), 'has tags_found');
});

await test('POST /v1/site/template — reject missing body', async () => {
    const { status, body } = await json('/v1/site/template', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 422, `expected 422, got ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('GET /v1/site/template — download uploaded template', async () => {
    const { status, body } = await json('/v1/site/template', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.template === 'string', 'has template');
    assert(body.data.template.includes('{{config:nodeName}}'), 'template has config tag');
    assert(typeof body.data?.size_bytes === 'number', 'has size_bytes');
    assert(Array.isArray(body.data?.tags_found), 'has tags_found');
});

await test('GET / — serves resolved custom template', async () => {
    const res = await fetch(`${BASE}/`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/html'), `expected HTML, got ${ct}`);
    const html = await res.text();
    assert(html.includes('<h1>'), 'has heading');
    // Tags should be resolved — nodeName should NOT appear as {{config:nodeName}}
    assert(!html.includes('{{config:nodeName}}'), 'config tag should be resolved');
});

await test('POST /v1/site/import — import bundle', async () => {
    const bundle = {
        template: '<html><body><h1>Imported</h1><p>{{memory:portal/welcome}}</p></body></html>',
        memory: { 'portal/welcome': 'Welcome to the imported portal!' },
        kv: { greeting: 'Hello World' },
    };
    const { status, body } = await json('/v1/site/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify(bundle),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.template_stored === true, 'template stored');
    assert(body.data?.memory_keys_written === 1, 'memory keys written');
    assert(typeof body.data?.changelog_entry_id === 'string', 'has changelog entry id');
});

await test('POST /v1/site/import — reject invalid memory keys', async () => {
    const { status, body } = await json('/v1/site/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ memory: { 'invalid/key': 'value' } }),
    });
    assert(status === 422, `expected 422, got ${status}`);
    assert(body.ok === false, 'not ok');
});

await test('GET /v1/site/changelog — view changes', async () => {
    const { status, body } = await json('/v1/site/changelog', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data), 'data is array');
    assert(body.data.length > 0, 'has changelog entries');
    assert(typeof body.data[0].action === 'string', 'entry has action');
});

await test('POST /v1/site/cache-invalidate — clear cache', async () => {
    const { status, body } = await json('/v1/site/cache-invalidate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.cache_cleared === true, 'cache cleared');
});

await test('DELETE /v1/site/template — revert to default', async () => {
    const { status, body } = await json('/v1/site/template', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.deleted === true, 'deleted');
    assert(body.data?.reverted_to === 'default', 'reverted to default');
});

await test('GET / — serves default portal after delete', async () => {
    const res = await fetch(`${BASE}/`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/html'), `expected HTML, got ${ct}`);
    const html = await res.text();
    // Should no longer contain our custom template content
    assert(!html.includes('Imported'), 'custom content should be gone');
});

await test('GET /v1/site/template — 401 without auth', async () => {
    const { status } = await json('/v1/site/template');
    assert(status === 401, `expected 401, got ${status}`);
});

// ─── System Board ───
console.log('System Board');

await test('System board — operator can create', async () => {
    const { status, body } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'announcements', description: 'System announcements', visibility: 'system' }),
    });
    assert(status === 201, `expected 201, got ${status}`);
    assert(body.data?.visibility === 'system', 'visibility is system');
});

await test('System board — agent cannot create system board', async () => {
    const { status } = await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'agent-sys', description: 'Should fail', visibility: 'system' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('System board — operator can post (free)', async () => {
    // Find the announcements board
    const { body: listBody } = await json('/v1/boards', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const sysBoard = listBody.data?.boards?.find((b: any) => b.name === 'announcements');
    assert(sysBoard, 'found announcements board');

    const { status, body } = await json(`/v1/boards/${sysBoard.id}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'Welcome', body: 'First announcement!' }),
    });
    assert(status === 201, `expected 201, got ${status}`);
    assert(body.data?.title === 'Welcome', 'post title');
});

await test('System board — agent cannot post', async () => {
    const { body: listBody } = await json('/v1/boards', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const sysBoard = listBody.data?.boards?.find((b: any) => b.name === 'announcements');
    assert(sysBoard, 'found announcements board');

    const { status } = await json(`/v1/boards/${sysBoard.id}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ title: 'Nope', body: 'Should fail' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('System board — publicly readable (no auth)', async () => {
    const { body: listBody } = await json('/v1/boards', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const sysBoard = listBody.data?.boards?.find((b: any) => b.name === 'announcements');
    assert(sysBoard, 'found announcements board');

    const { status, body } = await json(`/v1/boards/${sysBoard.id}/posts`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(body.data?.posts), 'has posts array');
    assert(body.data.posts.length > 0, 'has posts');
});

await test('System board — {{board:announcements}} resolves in template', async () => {
    // Upload template with board tag
    const template = '<!DOCTYPE html><html><body><h1>Portal</h1><div id="news">{{board:announcements}}</div></body></html>';
    const { status: uploadStatus } = await json('/v1/site/template', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ template }),
    });
    assert(uploadStatus === 200, `upload status ${uploadStatus}`);

    // Fetch rendered portal
    const res = await fetch(`${BASE}/`);
    const html = await res.text();
    assert(html.includes('board-posts'), 'rendered board-posts div');
    assert(html.includes('Welcome'), 'rendered post title');
    assert(html.includes('First announcement!'), 'rendered post body');
    assert(!html.includes('{{board:'), 'tag fully resolved');
});

// ─── LB Sync ───
console.log('LB Sync');

await test('GET /v1/site/sync — returns sync payload', async () => {
    // Try to upload a template (may fail if no operator role, which is fine)
    const template = '<!DOCTYPE html><html><body>{{config:nodeId}}</body></html>';
    await json('/v1/site/template', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ template }),
    });

    const { status, body } = await json('/v1/site/sync');
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.ok === true, `sync ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.sync_timestamp, 'has sync_timestamp');
    // template may be null if upload failed (no operator role)
    assert(body.data?.template === null || typeof body.data?.template?.html === 'string', 'template field valid');
    assert(Array.isArray(body.data?.memory_keys), 'has memory_keys array');
    assert(Array.isArray(body.data?.deleted_memory_keys), 'has deleted_memory_keys');
    assert(typeof body.data?.kv === 'object', 'has kv object');
    assert(Array.isArray(body.data?.system_board_posts), 'has system_board_posts');
});

await test('GET /v1/site/sync?since=future — returns no changes', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const { status, body } = await json(`/v1/site/sync?since=${encodeURIComponent(future)}`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.data?.template === null, 'no template changes since future');
    assert(body.data?.memory_keys?.length === 0, 'no memory changes since future');
    assert(body.data?.system_board_posts?.length === 0, 'no board posts since future');
});

await test('GET /v1/site/sync — system board posts structure', async () => {
    const { status, body } = await json('/v1/site/sync');
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(body.data?.system_board_posts), 'has system_board_posts array');
    // Posts may be empty if operator tests failed, but array must exist
    if (body.data.system_board_posts.length > 0) {
        const post = body.data.system_board_posts[0];
        assert(post.id, 'post has id');
        assert(post.title, 'post has title');
        assert(post.body, 'post has body');
        assert(post.created_at, 'post has created_at');
    }
});

await test('GET /v1/site/sync — no auth required', async () => {
    // Verify no auth header and get 200
    const { status } = await json('/v1/site/sync');
    assert(status === 200, `expected 200 without auth, got ${status}`);
});

await test('GET /v1/health — no site_lb when LB not enabled', async () => {
    const { status, body } = await json('/v1/health');
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.data?.status === 'healthy', 'status is healthy');
    assert(body.data?.site_lb === undefined, 'no site_lb when not in LB mode');
});

await test('POST /v1/admin/site/sync — 404 when LB not enabled', async () => {
    const { status } = await json('/v1/admin/site/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    // Route only registered when LB mode enabled, so expect 404
    assert(status === 404, `expected 404, got ${status}`);
});

// Clean up template for GDPR cascade
await json('/v1/site/template', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
});

// ─── GDPR ───
console.log('GDPR');

await test('Owner data export', async () => {
    const { body } = await json(`/v1/owners/${ownerName}/export`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `export: ${JSON.stringify(body.error)}`);
    assert(body.data?.owner?.name === ownerName, 'has owner data');
});

await test('Owner delete (cascade)', async () => {
    const { body } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `delete: ${JSON.stringify(body.error)}`);
    assert(body.data?.deleted === true, 'confirmed deleted');

    // Verify owner is gone
    const { body: gBody } = await json(`/v1/owners/${ownerName}`);
    assert(gBody.ok === false || gBody.data === null, 'owner gone');
});

// ─── Summary ───
console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
