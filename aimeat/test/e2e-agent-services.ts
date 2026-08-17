// E2E Tests for Agent Services (Work-to-Task Bridge)
// Run: cd aimeat && pnpm exec tsx test/e2e-agent-services.ts
//
// @version-history
//   v1.1.0 — 2026-08-17 — E2E quality, agent-services:257. The three agents in this file never crossed:
//     four hundred lines with no 401 and no 403 anywhere. Accepting a work item is taking on the job
//     and the payment attached to it, so who may accept is the whole of it. Test 3b creates a work
//     item of its own and has the REQUESTER try to accept it (403 ACCESS_DENIED) and an anonymous
//     caller too (401), then reads it back still pending. Its own item, because aimed at the suite's,
//     a broken gate makes the later provider accept answer 409 and the second failure says nothing.

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
// Provider owner (owns the agent that will accept work)
const providerOwnerName = `svcprov${Date.now()}`;
let providerOwnerPrivKey = '';
let providerOwnerToken = '';
let providerGaii = '';
let providerToken = '';
let providerPrivKey = '';
const providerAgentName = 'provbot';

// Requester owner (owns the agent that will send work requests)
const requesterOwnerName = `svcreq${Date.now()}`;
let requesterOwnerPrivKey = '';
let requesterOwnerToken = '';
let requesterGaii = '';
let requesterToken = '';
let requesterPrivKey = '';
const requesterAgentName = 'reqbot';

// Third agent (no directives, same owner as provider for simplicity in separate owner)
const noDirectivesOwnerName = `svcbare${Date.now()}`;
let noDirectivesOwnerPrivKey = '';
let noDirectivesOwnerToken = '';
let noDirectivesGaii = '';
let noDirectivesToken = '';
let noDirectivesPrivKey = '';
const noDirectivesAgentName = 'barebot';

let trackingCode = '';

console.log('\n=== AIMEAT Agent Services (Work-to-Task Bridge) E2E Test ===\n');

// ─── Setup ───
console.log('Setup -- Provider Owner & Agent');

await test('Register provider owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: providerOwnerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    providerOwnerPrivKey = body.data.private_key;
    providerOwnerToken = await getToken(providerOwnerName, providerOwnerPrivKey, false);
});

await test('Register provider agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerOwnerToken}` },
        body: JSON.stringify({
            name: providerAgentName,
            owner: providerOwnerName,
            capabilities: ['memory', 'actions'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    providerGaii = body.data.agent.gaii;
    providerPrivKey = body.data.private_key;
});

await test('Provider agent auth token', async () => {
    providerToken = await getToken(providerGaii, providerPrivKey, true);
    assert(typeof providerToken === 'string' && providerToken.length > 0, 'got provider token');
});

console.log('Setup -- Requester Owner & Agent');

await test('Register requester owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: requesterOwnerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    requesterOwnerPrivKey = body.data.private_key;
    requesterOwnerToken = await getToken(requesterOwnerName, requesterOwnerPrivKey, false);
});

await test('Register requester agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterOwnerToken}` },
        body: JSON.stringify({
            name: requesterAgentName,
            owner: requesterOwnerName,
            capabilities: ['memory', 'actions'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    requesterGaii = body.data.agent.gaii;
    requesterPrivKey = body.data.private_key;
});

await test('Requester agent auth token', async () => {
    requesterToken = await getToken(requesterGaii, requesterPrivKey, true);
    assert(typeof requesterToken === 'string' && requesterToken.length > 0, 'got requester token');
});

console.log('Setup -- No-directives Owner & Agent');

await test('Register no-directives owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: noDirectivesOwnerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    noDirectivesOwnerPrivKey = body.data.private_key;
    noDirectivesOwnerToken = await getToken(noDirectivesOwnerName, noDirectivesOwnerPrivKey, false);
});

await test('Register no-directives agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${noDirectivesOwnerToken}` },
        body: JSON.stringify({
            name: noDirectivesAgentName,
            owner: noDirectivesOwnerName,
            capabilities: ['memory', 'actions'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    noDirectivesGaii = body.data.agent.gaii;
    noDirectivesPrivKey = body.data.private_key;
});

await test('No-directives agent auth token', async () => {
    noDirectivesToken = await getToken(noDirectivesGaii, noDirectivesPrivKey, true);
    assert(typeof noDirectivesToken === 'string' && noDirectivesToken.length > 0, 'got no-directives token');
});

// ─── Phase 1: Set Up Directives for Provider ───
console.log('\nPhase 1 -- Set Up Directives');

await test('1. Set provider directives (enables task system)', async () => {
    const { status, body } = await json(`/v1/agents/${providerAgentName}/directives`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${providerOwnerToken}` },
        body: JSON.stringify({
            purpose: 'Test service provider agent',
            rules: [{ id: 'rule-1', description: 'Always deliver work on time' }],
            memory_areas: [],
            resources: [],
        }),
    });
    assert(status === 200 || status === 201, `status ${status}: ${JSON.stringify(body)}`);
});

// ─── Phase 2: Publish Action ───
console.log('\nPhase 2 -- Publish Action');

await test('2. Provider publishes action', async () => {
    const { status, body } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({
            id: 'test-scrape',
            display_name: 'Web Scraping',
            description: 'Scrapes a URL and returns its content',
            input_schema: { type: 'object', properties: { url: { type: 'string' } } },
            output_schema: { type: 'object', properties: { content: { type: 'string' } } },
            pricing: { base_morsels: 10 },
            tags: ['test', 'scraping'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.id === 'test-scrape', `action id: ${body.data.id}`);
});

// ─── Phase 3: Work Request & Accept ───
console.log('\nPhase 3 -- Work Request & Accept');

await test('3. Requester creates work request', async () => {
    const { status, body } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({
            action_id: 'test-scrape',
            provider_gaii: providerGaii,
            input: { url: 'https://example.com' },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.tracking_code === 'string', 'has tracking_code');
    assert(body.data.status === 'pending', `status: ${body.data.status}`);
    trackingCode = body.data.tracking_code;
});

/**
 * The three agents in this file never cross: the requester requests, the provider accepts and
 * delivers, and nobody is ever refused anything. Grep the file for 401 or 403 and there are none, in
 * four hundred lines. A work item names its provider, and accepting one is taking on the job and the
 * payment attached to it, so who may accept is the whole of it.
 *
 * Run BEFORE the provider's own accept, so the item is still pending and a stranger's accept would
 * really succeed if the gate were gone.
 */
await test('3b. Only the named provider can accept work — a stranger and an anonymous caller are refused', async () => {
    // A work item of its own. Aimed at the suite's item, a broken gate means the stranger's accept
    // succeeds and the provider's own accept below then answers 409 — two failures where one hole is,
    // and the second one says nothing about the gate.
    const made = await json('/v1/work/request', {
        method: 'POST', headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({ action_id: 'test-scrape', provider_gaii: providerGaii, input: { url: 'https://example.com/denial' } }),
    });
    assert(made.status === 201, `fixture work request: ${made.status}: ${JSON.stringify(made.body)}`);
    const fixtureCode = made.body.data.tracking_code as string;

    const stranger = await json(`/v1/work/${fixtureCode}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(stranger.status === 403, `the requester accepted its own work: ${stranger.status}: ${JSON.stringify(stranger.body)}`);
    assert(stranger.body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${stranger.body.error?.code}`);

    const anon = await json(`/v1/work/${fixtureCode}/accept`, { method: 'POST' });
    assert(anon.status === 401, `an anonymous caller reached the accept door: ${anon.status}`);

    // Refuse before you write: the item is still pending, so nothing was taken on.
    const readBack = await json(`/v1/work/${fixtureCode}`, {
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(readBack.status === 200, `read the work item: ${readBack.status}`);
    assert(readBack.body.data.status === 'pending',
        `a refused accept moved the item to ${readBack.body.data.status}`);
});

await test('4. Provider accepts work', async () => {
    const { status, body } = await json(`/v1/work/${trackingCode}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'accepted', `status: ${body.data.status}`);
});

// ─── Phase 3b: Work tab composite (mount fold) ───
console.log('\nPhase 3b -- GET /v1/work/overview composite');

await test('4b. GET /v1/work/overview == inbox + sent (owner session, batched)', async () => {
    // Provider owner: the just-accepted work item is in the inbox; sent is empty.
    const prov = await json('/v1/work/overview', { headers: { Authorization: `Bearer ${providerOwnerToken}` } });
    assert(prov.status === 200, `provider overview status ${prov.status}: ${JSON.stringify(prov.body)}`);
    const pd = prov.body.data;
    assert(Array.isArray(pd.inbox) && pd.inbox.some((w: any) => w.tracking_code === trackingCode), 'provider inbox has the accepted work item');
    const provInbox = await json('/v1/work/inbox', { headers: { Authorization: `Bearer ${providerOwnerToken}` } });
    assert(pd.inbox.length === provInbox.body.data.items.length, `inbox count matches /v1/work/inbox: ${pd.inbox.length} vs ${provInbox.body.data.items.length}`);

    // Requester owner: the work item is in sent.
    const reqOv = await json('/v1/work/overview', { headers: { Authorization: `Bearer ${requesterOwnerToken}` } });
    assert(reqOv.status === 200, `requester overview status ${reqOv.status}: ${JSON.stringify(reqOv.body)}`);
    const rd = reqOv.body.data;
    assert(Array.isArray(rd.sent) && rd.sent.some((w: any) => w.tracking_code === trackingCode), 'requester sent has the work item');
    const reqSent = await json('/v1/work/sent', { headers: { Authorization: `Bearer ${requesterOwnerToken}` } });
    assert(rd.sent.length === reqSent.body.data.items.length, `sent count matches /v1/work/sent: ${rd.sent.length} vs ${reqSent.body.data.items.length}`);
});

// ─── Phase 4: Verify Task Auto-Created ───
console.log('\nPhase 4 -- Verify Task Bridge');

await test('5. Task auto-created for provider', async () => {
    const { status, body } = await json(`/v1/agents/${providerAgentName}/tasks`, {
        headers: { Authorization: `Bearer ${providerOwnerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.tasks), 'has tasks array');
    const bridgedTask = body.data.tasks.find((t: any) => t.workTrackingCode === trackingCode);
    assert(bridgedTask !== undefined, `task with workTrackingCode "${trackingCode}" should exist`);
});

await test('6. Task has correct structure', async () => {
    const { status, body } = await json(`/v1/agents/${providerAgentName}/tasks`, {
        headers: { Authorization: `Bearer ${providerOwnerToken}` },
    });
    assert(status === 200, `status ${status}`);
    const bridgedTask = body.data.tasks.find((t: any) => t.workTrackingCode === trackingCode);
    assert(bridgedTask !== undefined, 'bridged task exists');
    assert(bridgedTask.title.includes('Web Scraping') || bridgedTask.title.includes('test-scrape'),
        `title should reference action: ${bridgedTask.title}`);
    assert(Array.isArray(bridgedTask.todos), 'has todos');
    assert(bridgedTask.todos.length >= 2, `should have >=2 todos, got ${bridgedTask.todos.length}`);
    assert(bridgedTask.status === 'queued', `status should be queued: ${bridgedTask.status}`);
});

// ─── Phase 5: Agent Without Directives ───
console.log('\nPhase 5 -- Agent Without Directives (No Task Created)');

await test('7. No-directives agent publishes action', async () => {
    const { status, body } = await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${noDirectivesToken}` },
        body: JSON.stringify({
            id: 'test-translate',
            display_name: 'Translation',
            description: 'Translates text between languages',
            input_schema: { type: 'object', properties: { text: { type: 'string' }, lang: { type: 'string' } } },
            output_schema: { type: 'object', properties: { translated: { type: 'string' } } },
            pricing: { base_morsels: 5 },
            tags: ['test'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
});

let noDirectivesTrackingCode = '';

await test('8. Requester sends work to no-directives agent', async () => {
    const { status, body } = await json('/v1/work/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({
            action_id: 'test-translate',
            provider_gaii: noDirectivesGaii,
            input: { text: 'Hello world', lang: 'fi' },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    noDirectivesTrackingCode = body.data.tracking_code;
});

await test('9. No-directives agent accepts work', async () => {
    const { status, body } = await json(`/v1/work/${noDirectivesTrackingCode}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${noDirectivesToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'accepted', `status: ${body.data.status}`);
});

await test('10. No task created for agent without directives', async () => {
    const { status, body } = await json(`/v1/agents/${noDirectivesAgentName}/tasks`, {
        headers: { Authorization: `Bearer ${noDirectivesOwnerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const bridgedTask = body.data.tasks.find((t: any) => t.workTrackingCode === noDirectivesTrackingCode);
    assert(bridgedTask === undefined, 'no task should be created for agent without directives');
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Delete provider owner (cascade)', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(providerOwnerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${providerOwnerToken}` },
    });
    assert(status === 200 || status === 204, `status: ${status}`);
});

await test('Delete requester owner (cascade)', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(requesterOwnerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${requesterOwnerToken}` },
    });
    assert(status === 200 || status === 204, `status: ${status}`);
});

await test('Delete no-directives owner (cascade)', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(noDirectivesOwnerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${noDirectivesOwnerToken}` },
    });
    assert(status === 200 || status === 204, `status: ${status}`);
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Agent Services E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
