// Full E2E test for AIMEAT Phases 1-5
// Run: cd aimeat && pnpm exec tsx test/e2e-full.ts

const BASE = 'http://localhost:3117';
const NODE_ID = 'meat-local-001-dev';

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
        body: JSON.stringify({ name: ownerName }),
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

await test('Prompts — tier0, tier1, tier2', async () => {
    for (const tier of ['tier0', 'tier1', 'tier2']) {
        const { body } = await json(`/v1/prompts/${tier}`);
        assert(body.ok === true, `${tier} ok`);
        assert(typeof body.data?.system_prompt === 'string', `${tier} has prompt`);
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

await test('Admin — non-operator denied', async () => {
    const { body } = await json('/v1/admin/dashboard', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === false, 'non-operator denied');
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

await test('Admin backup — non-operator denied', async () => {
    const { body } = await json('/v1/admin/backup', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === false, 'non-operator denied');
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
