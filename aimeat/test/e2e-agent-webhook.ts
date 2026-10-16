/**
 * @file test/e2e-agent-webhook.ts
 * @description E2E tests for agent webhook CRUD, its delivery log, and the operator backup's
 *   handling of the webhook secret.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-agent-webhook
 * @version-history
 *   v1.2.0 — 2026-10-16 — A real receiver (QA audit F07a-01). The suite starts a loopback HTTP listener
 *     and registers it, so the delivery is RECEIVED: the X-AIMEAT-Signature is recomputed over the body
 *     that arrived with the webhook secret, the event header and the envelope are read, a 2xx answer
 *     gives delivered: true and the success stamp, a 500 gives a failed delivery, and a real event
 *     (task.queued, from a queued task) arrives signed through the dispatcher. The httpbin.org
 *     addresses are gone: the node resolved them over DNS when the webhook was stored, so the suite
 *     failed on a machine without internet, and the "unreachable" test passed on any failure. The
 *     unreachable address is now a closed loopback port. Test 5's comment named 192.0.2.1.
 *   v1.1.0 — 2026-10-09 — 3b: the operator's admin backup carries no webhook secret or URL (secrets
 *     audit 2026-10-09, finding 1.9).
 *   v1.0.0 — pre-dates the header standard.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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
import { createHash, createHmac } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerOwner } from './helpers/owner-login.js';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function getToken(gaii: string, privKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + timestamp);
    const payload = { gaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// ─── State ───
const ownerName = `whkowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'webhookbot';

// ─── The receiver: a loopback listener that records every delivery and answers with `receiverStatus` ───
interface Delivery { path: string; headers: http.IncomingHttpHeaders; raw: string; body: any }
const received: Delivery[] = [];
let receiverStatus = 200;
const receiver = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c.toString(); });
    req.on('end', () => {
        let body: any;
        try { body = JSON.parse(raw); } catch { body = { _unparsed: raw }; }
        received.push({ path: req.url ?? '', headers: req.headers, raw, body });
        res.writeHead(receiverStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: receiverStatus < 300 }));
    });
});
await new Promise<void>(r => receiver.listen(0, '127.0.0.1', () => r()));
const RECEIVER_PORT = (receiver.address() as AddressInfo).port;
// The test server runs with AIMEAT_ALLOW_PRIVATE_EGRESS, so a loopback address is a valid webhook.
const WEBHOOK_URL = `http://127.0.0.1:${RECEIVER_PORT}/hook`;
// A loopback port that was free a moment ago and is closed now: the connection is refused at once,
// with no DNS and no network in the way.
const closedPort = await new Promise<number>(r => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => r(p)); }); });
const UNREACHABLE_URL = `http://127.0.0.1:${closedPort}/webhook-test`;

/** The signature a receiver recomputes: HMAC-SHA256 over the exact bytes that arrived. */
function expectedSignature(secret: string, raw: string): string {
    return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}
async function waitForDelivery(pred: (d: Delivery) => boolean, ms = 15_000): Promise<Delivery> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const hit = received.find(pred);
        if (hit) return hit;
        await sleep(100);
    }
    throw new Error(`no matching delivery within ${ms} ms; received: ${JSON.stringify(received.map(d => ({ path: d.path, event: d.headers['x-aimeat-event'] })))}`);
}

console.log('\n=== AIMEAT Agent Webhook E2E Test ===\n');

// ─── Setup ───
console.log('Setup -- Owner & Agent');

await test('Register owner', async () => {
    const owner = await registerOwner(BASE, ownerName);
    ownerPrivKey = owner.privateKey;
    ownerToken = owner.token;
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
    agentToken = await getToken(agentGaii, agentPrivKey);
    assert(typeof agentToken === 'string' && agentToken.length > 0, 'got agent token');
});

// ─── Phase 1: Register webhook ───
console.log('\nPhase 1 -- Register Webhook');

await test('1. PUT webhook with valid URL (auto-generated secret)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: WEBHOOK_URL }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.url === WEBHOOK_URL, `url: ${body.data.url}`);
    assert(body.data.enabled === true, `enabled: ${body.data.enabled}`);
    // Auto-generated secret should be 64 hex chars (32 bytes)
    assert(typeof body.data.secret === 'string', 'secret is string');
    assert(body.data.secret.length === 64, `secret length: ${body.data.secret.length}`);
    assert(/^[0-9a-f]{64}$/.test(body.data.secret), 'secret is 64 hex chars');
});

// ─── Phase 2: Get webhook status ───
console.log('\nPhase 2 -- Get Webhook Status');

await test('2. GET webhook returns config (no secret exposed)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.configured === true, `configured: ${body.data.configured}`);
    assert(body.data.url === WEBHOOK_URL, `url: ${body.data.url}`);
    assert(body.data.enabled === true, `enabled: ${body.data.enabled}`);
    assert(body.data.fail_count === 0, `fail_count: ${body.data.fail_count}`);
    // GET should NOT expose the secret
    assert(body.data.secret === undefined, `secret should not be in GET response, got: ${body.data.secret}`);
});

// ─── Phase 3: Register with custom secret ───
console.log('\nPhase 3 -- Custom Secret');

await test('3. PUT webhook with custom secret', async () => {
    const customSecret = 'my-custom-secret-that-is-long-enough-for-validation';
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: WEBHOOK_URL, secret: customSecret }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.url === WEBHOOK_URL, `url: ${body.data.url}`);
    assert(body.data.secret === customSecret, `secret: ${body.data.secret}`);
    assert(body.data.enabled === true, `enabled: ${body.data.enabled}`);
});

// Secrets audit 2026-10-09, finding 1.9: GET /v1/admin/backup spread whole agent rows, so every
// agent's plaintext webhook signing secret was in the file. The owner here is the first owner on a
// cleared database, so it is the operator.
await test('3b. The admin backup lists the agent and leaves its webhook secret and URL out', async () => {
    const { status, body } = await json('/v1/admin/backup', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `backup ${status}: ${JSON.stringify(body?.error)}`);
    const text = JSON.stringify(body);
    assert(!text.includes('my-custom-secret-that-is-long-enough-for-validation'), 'the webhook secret is in the backup');
    const row = (body.data.agents as any[]).find(a => a.gaii === agentGaii);
    assert(!!row && row.name === agentName && typeof row.publicKey === 'string', `the agent is listed: ${JSON.stringify(row)}`);
    assert(!('webhookSecret' in row) && !('webhookUrl' in row), `no webhook credential fields: ${Object.keys(row).join(',')}`);
    assert(Array.isArray(body.data.omitted) && body.data.omitted.length > 0, `the backup says what it left out: ${JSON.stringify(body.data.omitted)}`);
});

// ─── Phase 4: Validation ───
console.log('\nPhase 4 -- Validation');

await test('4a. PUT with invalid URL returns 400', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: 'not-a-valid-url' }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

await test('4b. PUT with too-short secret returns 400', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: WEBHOOK_URL, secret: 'short' }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

await test('4c. PUT with missing url returns 400', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({}),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

// ─── Phase 5: Test delivery ───
console.log('\nPhase 5 -- Test Delivery');

await test('5. POST webhook test (unreachable URL -> delivered=false)', async () => {
    // First register with an unreachable URL so the test delivery fails
    const { status: putStatus } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: UNREACHABLE_URL }),
    });
    assert(putStatus === 200, `PUT status ${putStatus}`);

    // Now test delivery: the port is closed, so the connection is refused
    const { status, body } = await json(`/v1/agents/${agentName}/webhook/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.delivered === false, `delivered: ${body.data.delivered}`);
    assert(body.data.status === 'failed', `status: ${body.data.status}`);
    assert(typeof body.data.error === 'string' && body.data.error.length > 0, `error: ${body.data.error}`);
    assert(typeof body.data.latency_ms === 'number', `latency_ms type: ${typeof body.data.latency_ms}`);
});

// QA audit F07a-01: no test RECEIVED a delivery, so the signature, the body and delivered: true were
// asserted nowhere. These tests read what arrives at the listener.
const SIGNING_SECRET = 'receiver-checks-this-secret-0123456789';

await test('5b. POST webhook test to a live receiver: delivered, signed with the webhook secret over the body that arrived', async () => {
    const put = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ url: WEBHOOK_URL, secret: SIGNING_SECRET }),
    });
    assert(put.status === 200, `PUT ${put.status}: ${JSON.stringify(put.body)}`);
    receiverStatus = 200;
    received.length = 0;
    const { status, body } = await json(`/v1/agents/${agentName}/webhook/test`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200 && body.data.delivered === true && body.data.status === 'success' && body.data.http_status === 200,
        `answer: ${status} ${JSON.stringify(body.data)}`);
    const d = await waitForDelivery(x => x.headers['x-aimeat-event'] === 'webhook.test');
    assert(d.path === '/hook', `path: ${d.path}`);
    assert(d.headers['content-type']?.startsWith('application/json') === true, `content-type: ${d.headers['content-type']}`);
    assert(d.headers['x-aimeat-signature'] === expectedSignature(SIGNING_SECRET, d.raw),
        `the signature does not verify over the body: ${d.headers['x-aimeat-signature']}`);
    assert(d.headers['x-aimeat-signature'] !== expectedSignature('some-other-secret-0123456789', d.raw), 'any secret verifies');
    assert(d.body.event === 'webhook.test' && d.body.agent === agentGaii, `body: ${d.raw.slice(0, 200)}`);
    const cfg = await json(`/v1/agents/${agentName}/webhook`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(typeof cfg.body.data.last_success === 'string', `the success is stamped: ${JSON.stringify(cfg.body.data)}`);
});

await test('5c. A receiver that answers 500 is a failed delivery with its status, not a success', async () => {
    receiverStatus = 500;
    received.length = 0;
    try {
        const { status, body } = await json(`/v1/agents/${agentName}/webhook/test`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(status === 200 && body.data.delivered === false && body.data.status === 'failed' && body.data.http_status === 500,
            `answer: ${status} ${JSON.stringify(body.data)}`);
        await waitForDelivery(x => x.headers['x-aimeat-event'] === 'webhook.test');
    } finally { receiverStatus = 200; }
});

// ─── Phase 6: Delivery log ───
console.log('\nPhase 6 -- Delivery Log');

await test('6. GET webhook log returns deliveries', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook/log`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.deliveries), 'deliveries is an array');
    assert(body.data.deliveries.length >= 1, `deliveries count: ${body.data.deliveries.length}`);
    // Check the most recent delivery entry
    const latest = body.data.deliveries[0];
    assert(latest.event === 'webhook.test', `event: ${latest.event}`);
    assert(typeof latest.status === 'string', `status type: ${typeof latest.status}`);
    assert(typeof latest.latencyMs === 'number' || typeof latest.latency_ms === 'number',
        'has latency field');
});

// A real event, through the dispatcher every node event uses (services/webhook-dispatcher.ts), not the
// test route: a queued task tells the agent with task.queued (task.approved when the owner's autonomy
// setting starts it at once), signed the same way, with a delivery id and the v1 envelope.
await test('6a. A queued task reaches the receiver as a signed task event in the v1 envelope, and is logged as delivered', async () => {
    received.length = 0;
    receiverStatus = 200;
    const t = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: 'Webhook task', description: 'Delivered to the receiver', status: 'queued' }),
    });
    assert(t.status === 201, `task ${t.status}: ${JSON.stringify(t.body?.error)}`);
    const taskId = t.body.data.task.id;
    const d = await waitForDelivery(x => ['task.queued', 'task.approved'].includes(String(x.headers['x-aimeat-event'])));
    assert(d.headers['x-aimeat-signature'] === expectedSignature(SIGNING_SECRET, d.raw), 'the task event signature does not verify');
    assert(/^[0-9a-f-]{36}$/.test(String(d.headers['x-aimeat-delivery'])), `delivery id: ${d.headers['x-aimeat-delivery']}`);
    assert(d.body.event === d.headers['x-aimeat-event'] && d.body.agent_gaii === agentGaii && d.body.version,
        `envelope: ${d.raw.slice(0, 300)}`);
    assert(d.body.data?.task_id === taskId, `task id in the event: ${JSON.stringify(d.body.data)}`);
    // The dispatcher records the outcome after the response; give it a moment.
    let logged: any = null;
    for (let i = 0; i < 50 && !logged; i++) {
        const log = await json(`/v1/agents/${agentName}/webhook/log`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        logged = (log.body.data.deliveries as any[]).find(x => x.event === d.body.event && x.status === 'success');
        if (!logged) await sleep(100);
    }
    assert(!!logged, 'the delivery log has no success entry for the task event');
    const cfg = await json(`/v1/agents/${agentName}/webhook`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(cfg.body.data.fail_count === 0, `a success resets the fail count: ${cfg.body.data.fail_count}`);
});

// ─── Phase 6b: Integration subtab composite (mount fold) ───
console.log('\nPhase 6b -- GET /integration/overview composite');

await test('6b. GET /integration/overview folds webhook + delivery log + onboarding checklist', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/integration/overview`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'response ok');
    const d = body.data;
    // webhook mirrors GET /webhook — configured (tests 1/3 set it), url present
    assert(d.webhook && d.webhook.configured === true, `webhook should be configured, got ${JSON.stringify(d.webhook)}`);
    assert(typeof d.webhook.url === 'string', 'webhook has url');
    // deliveries mirror GET /webhook/log — array with the earlier test delivery
    assert(Array.isArray(d.deliveries.deliveries) && d.deliveries.deliveries.length >= 1, `deliveries >= 1, got ${d.deliveries.deliveries?.length}`);
    // onboarding checklist mirrors GET /onboarding's post_onboarding_checklist exactly (null when
    // not-started; the computed object otherwise).
    const ob = await json(`/v1/agents/${agentName}/onboarding`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const expected = ob.body?.data?.post_onboarding_checklist ?? null;
    assert(JSON.stringify(d.onboarding.post_onboarding_checklist) === JSON.stringify(expected),
        `checklist should match GET /onboarding: got ${JSON.stringify(d.onboarding.post_onboarding_checklist)} vs ${JSON.stringify(expected)}`);
});

await test('6c. integration/overview owner-or-self: a sibling agent gets 403', async () => {
    const { status: rStatus, body: rBody } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'whkbot2', owner: ownerName, capabilities: ['memory'] }),
    });
    assert(rStatus === 201, `register agent2 ${rStatus}: ${JSON.stringify(rBody)}`);
    const a2Token = await getToken(rBody.data.agent.gaii, rBody.data.private_key);
    const { status } = await json(`/v1/agents/${agentName}/integration/overview`, {
        headers: { Authorization: `Bearer ${a2Token}` },
    });
    assert(status === 403, `sibling agent should get 403, got ${status}`);
});

// ─── Phase 7: Delete webhook ───
console.log('\nPhase 7 -- Delete Webhook');

await test('7. DELETE webhook', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.removed === true, `removed: ${body.data.removed}`);
});

// ─── Phase 8: Verify removal ───
console.log('\nPhase 8 -- Verify Removal');

await test('8. GET webhook after DELETE shows not configured', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.configured === false, `configured: ${body.data.configured}`);
});

await test('9. POST webhook test without webhook returns 400', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

// ─── Phase 9: Agent can manage its own webhook ───
console.log('\nPhase 9 -- Agent Self-Management');

await test('10. Agent can PUT its own webhook', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ url: WEBHOOK_URL }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.url === WEBHOOK_URL, `url: ${body.data.url}`);
    assert(body.data.enabled === true, `enabled: ${body.data.enabled}`);
});

await test('11. Agent can GET its own webhook', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.configured === true, `configured: ${body.data.configured}`);
    assert(body.data.url === WEBHOOK_URL, `url: ${body.data.url}`);
});

await test('12. Agent can DELETE its own webhook', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/webhook`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.removed === true, `removed: ${body.data.removed}`);
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

receiver.close();

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Agent Webhook E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
