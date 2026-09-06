/**
 * @file e2e-living-hooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `living-hooks`, the two doors a living document uses to talk to the world, against a
 *   real node and a real receiver.
 *
 *   The happy path is two tests; everything else is a refusal, and each refusal names the door it
 *   holds:
 *     - the extension is INSTALLED AND ACTIVE on a fresh node, without anybody uploading it
 *     - an owner sends to a receiver on a host they allowed, and the whole body arrives
 *     - a host nobody allowed is refused in words that say how to allow it (ALLOWLIST_REFUSED)
 *     - a guest is refused at the door (401), before any script runs
 *     - an agent without memory:write may not send (SCOPE_DENIED) and may still read
 *     - the minute's ceiling trips (RATE_LIMITED) and the receiver stops seeing calls
 *     - a read with a path returns the value, and the second read inside ten seconds makes no call
 *     - raw takes a numeric body as a number
 *     - a path with nowhere to go is BAD_PATH, and a non-JSON body is UPSTREAM_FAILED
 *     - a secret named as {{secret:NAME}} arrives at the receiver resolved, and appears nowhere in
 *       the answer the caller gets
 *     - a header nobody allowed is refused (HEADER_REFUSED)
 *     - a body over 256 kB is refused (PAYLOAD_TOO_LARGE) and nothing is sent
 *
 *   FIRST FAIL. Against the tree before this capability, the first test fails: GET
 *   /v1/extensions/living-hooks is a 404, because nothing seeded an extension on this node and
 *   there was no living-hooks to seed. Every test after it fails the same way. The assertion that
 *   asserts the new hole is named with `// HOLE:` where a test could otherwise be mistaken for one
 *   the old tree already satisfied.
 *
 *   THE RECEIVER runs on 127.0.0.1, which safeFetch refuses on a public node and admits here
 *   because the runner pins AIMEAT_ALLOW_PRIVATE_EGRESS=true (run-e2e-server.ts) — the same flag
 *   e2e-connections and e2e-ai-jobs use to put a real counterparty on the machine.
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=living-hooks

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { LIVING_HOOKS } from '../src/data/builtin-extensions/living-hooks.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const RECEIVER_PORT = parseInt(process.env.E2E_LIVING_HOOKS_PORT ?? '40665', 10);
const RECEIVER_HOST = '127.0.0.1';
const RECEIVER = `http://${RECEIVER_HOST}:${RECEIVER_PORT}`;
const SECRET_NAME = 'HOOK_TOKEN';
const SECRET_VALUE = 'zz-living-hooks-secret-zz';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function setupOwner(label: string) {
    const name = `lh${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Living Hooks', password: 'LivHook12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

/** Device-auth (RFC 8628): an agent token for `owner` carrying exactly `scopes`. */
async function mintAgentToken(owner: { name: string; token: string }, agentName: string, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: owner.name }) });
    assert(da.status === 200 && da.body?.ok, `device-authorize ${da.status}`);
    const approve = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: owner.token }),
    });
    assert(approve.status === 200 && approve.body?.ok, `approve ${approve.status} ${JSON.stringify(approve.body?.error)}`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200 && typeof poll.body?.token === 'string', `device-token ${poll.status}`);
    return poll.body.token as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Invoke one of the two actions and hand back what the sandbox answered. */
async function call(action: 'send' | 'read', token: string, input: unknown) {
    const r = await json(`/v1/ext/living-hooks/${action}`, { method: 'POST', headers: auth(token), body: JSON.stringify(input) });
    return { status: r.status, envelope: r.body, data: r.body?.data ?? null, error: r.body?.data?.error ?? null };
}

// ── The receiver: a real HTTP server on this machine, recording what actually arrived ──
interface Delivery { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }
const deliveries: Delivery[] = [];
let reads = 0;
let receiver: Server | null = null;

function startReceiver(): Promise<void> {
    return new Promise((resolve, reject) => {
        receiver = createServer((req, res) => {
            let body = '';
            req.on('data', c => { body += c; });
            req.on('end', () => {
                const url = req.url ?? '/';
                if (req.method === 'GET') {
                    reads++;
                    if (url.startsWith('/prices')) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ updatedAt: '2026-09-06T09:00:00Z', prices: [{ hour: 0, price: 4.2 }, { hour: 1, price: 5.5 }] }));
                        return;
                    }
                    if (url.startsWith('/raw')) {
                        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end('  18.42\n');
                        return;
                    }
                    if (url.startsWith('/notjson')) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end('<html>nope</html>');
                        return;
                    }
                    if (url.startsWith('/boom')) {
                        res.writeHead(503, { 'Content-Type': 'application/json' });
                        res.end('{"why":"down"}');
                        return;
                    }
                    res.writeHead(404).end('no');
                    return;
                }
                deliveries.push({ method: req.method ?? '', url, headers: req.headers, body });
                res.writeHead(url.startsWith('/refuse') ? 500 : 202, { 'Content-Type': 'application/json' });
                res.end('{"received":true}');
            });
        });
        receiver.on('error', reject);
        receiver.listen(RECEIVER_PORT, RECEIVER_HOST, () => resolve());
    });
}

function stopReceiver(): Promise<void> {
    return new Promise(resolve => { if (!receiver) return resolve(); receiver.close(() => resolve()); });
}

console.log('\n=== Living hooks E2E ===\n');

await startReceiver();

const owner = await setupOwner('op');          // first owner on a cleared database: also the operator
const stranger = await setupOwner('other');

// ── The extension arrives with the node ───────────────────────────────────────────────────────
console.log('\n-- Shipped with the node --');

await test('living-hooks is installed on a fresh node, without anybody uploading it', async () => {
    // HOLE: nothing seeded an extension at boot before this change, so this was a 404.
    // The seed is started at boot and not awaited, like every other seeder here, so give it a
    // moment rather than racing it. Two seconds is far past the one manifest parse and one write
    // it costs; a real failure still fails, it just takes two seconds to say so.
    let r = await json('/v1/extensions/living-hooks', { headers: auth(owner.token) });
    for (let i = 0; i < 20 && r.status === 404; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        r = await json('/v1/extensions/living-hooks', { headers: auth(owner.token) });
    }
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ext = r.body.data.extension;
    assert(ext.status === 'active', `expected active, got ${ext.status}`);
    assert(ext.version === LIVING_HOOKS.version, `version ${ext.version} != shipped ${LIVING_HOOKS.version}`);
    assert(ext.installedBy === 'system', `installedBy: ${ext.installedBy}`);
    const ids = (ext.actions as { id: string }[]).map(a => a.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['read', 'send']), `actions: ${ids.join(', ')}`);
});

await test('its description is written for a person, not for a protocol', async () => {
    const r = await json('/v1/extensions/living-hooks', { headers: auth(owner.token) });
    const d = String(r.body.data.extension.description);
    assert(d.length > 80, 'the description says almost nothing');
    assert(!/\bAPI\b|\bendpoint\b/i.test(d), `the description reads like a protocol note: ${d}`);
});

// ── The allowlist ─────────────────────────────────────────────────────────────────────────────
console.log('\n-- The allowlist --');

await test('with no allowlist set, a send is refused in words that say how to allow the host', async () => {
    const r = await call('send', owner.token, { url: `${RECEIVER}/hook`, body: { hello: 'world' } });
    assert(r.status === 200, `expected the action to answer, got ${r.status}`);
    assert(r.error?.code === 'ALLOWLIST_REFUSED', `code: ${JSON.stringify(r.data)}`);
    assert(r.error.message.includes(RECEIVER_HOST), 'the refusal does not name the host');
    assert(r.error.message.includes('living-hooks.settings'), 'the refusal does not say where to allow it');
    assert(r.error.message.includes('allow_hosts'), 'the refusal does not name the field');
    assert(deliveries.length === 0, 'a refused send still reached the receiver');
});

await test('the owner allows the host by writing one record in their own memory', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ key: 'living-hooks.settings', value: { allow_hosts: [RECEIVER_HOST] }, visibility: 'public' }),
    });
    assert(w.status === 201, `memory write ${w.status}: ${JSON.stringify(w.body?.error)}`);
});

await test("one owner's allowlist does not open the door for another owner", async () => {
    const r = await call('send', stranger.token, { url: `${RECEIVER}/hook`, body: { hello: 'stranger' } });
    assert(r.error?.code === 'ALLOWLIST_REFUSED', `the stranger was let through: ${JSON.stringify(r.data)}`);
    assert(deliveries.length === 0, "the stranger's send reached the receiver");
});

// ── Sending ───────────────────────────────────────────────────────────────────────────────────
console.log('\n-- Sending --');

const PAYLOAD = {
    document: { key: 'living.solar', title: 'Aurinko ja akku', register: 'fi' },
    at: '2026-09-06T12:00:00.000Z',
    transition: { node: 'battery', from: 'charging', to: 'exporting', event: 'full' },
    values: { soc: { value: 100, unit: '%', label: 'Varaus' }, power: { value: 3.4, unit: 'kW', label: 'Teho' } },
    machines: { battery: 'exporting' },
    trigger: { id: 'stamp', label: 'The stamp' },
};

await test('the whole body arrives at the receiver, unchanged', async () => {
    const r = await call('send', owner.token, { url: `${RECEIVER}/hook`, body: PAYLOAD });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(r.data.ok === true, `ok: ${JSON.stringify(r.data)}`);
    assert(r.data.status === 202, `status: ${r.data.status}`);
    assert(typeof r.data.ms === 'number' && r.data.ms >= 0, `ms: ${r.data.ms}`);
    assert(deliveries.length === 1, `deliveries: ${deliveries.length}`);
    const got = JSON.parse(deliveries[0].body);
    assert(JSON.stringify(got) === JSON.stringify(PAYLOAD), 'the body that arrived is not the body that was sent');
    assert(deliveries[0].method === 'POST', `method: ${deliveries[0].method}`);
    assert(String(deliveries[0].headers['content-type']).includes('application/json'), 'no JSON content type');
});

await test('PUT is a method too, and anything else is refused', async () => {
    deliveries.length = 0;
    const put = await call('send', owner.token, { url: `${RECEIVER}/hook`, method: 'PUT', body: { a: 1 } });
    assert(put.error === null && put.data.ok === true, `PUT refused: ${JSON.stringify(put.error)}`);
    assert(deliveries[0].method === 'PUT', `arrived as ${deliveries[0].method}`);
    const del = await call('send', owner.token, { url: `${RECEIVER}/hook`, method: 'DELETE', body: { a: 1 } });
    assert(del.error?.code === 'INVALID_INPUT', `DELETE was allowed: ${JSON.stringify(del.data)}`);
});

await test("a receiver that answers 500 is UPSTREAM_FAILED, carrying the receiver's status", async () => {
    const r = await call('send', owner.token, { url: `${RECEIVER}/refuse`, body: { a: 1 } });
    assert(r.error?.code === 'UPSTREAM_FAILED', `code: ${JSON.stringify(r.data)}`);
    assert(r.error.status === 500, `the upstream status is missing: ${JSON.stringify(r.error)}`);
});

await test('a body over 256 kB is refused, and nothing is sent', async () => {
    deliveries.length = 0;
    const r = await call('send', owner.token, { url: `${RECEIVER}/hook`, body: { blob: 'x'.repeat(270_000) } });
    assert(r.error?.code === 'PAYLOAD_TOO_LARGE', `code: ${JSON.stringify(r.data)}`);
    assert(r.error.limit === 262144, `limit: ${r.error.limit}`);
    assert(deliveries.length === 0, 'an over-sized body still reached the receiver');
});

await test('a header nobody allowed is refused by name, and nothing is sent', async () => {
    deliveries.length = 0;
    const r = await call('send', owner.token, { url: `${RECEIVER}/hook`, headers: { Cookie: 'session=1' }, body: { a: 1 } });
    assert(r.error?.code === 'HEADER_REFUSED', `code: ${JSON.stringify(r.data)}`);
    assert(r.error.message.includes('Cookie'), 'the refusal does not name the header');
    assert(deliveries.length === 0, 'the refused header call still reached the receiver');
});

await test('an X-Living- header goes through', async () => {
    deliveries.length = 0;
    const r = await call('send', owner.token, { url: `${RECEIVER}/hook`, headers: { 'X-Living-Trigger': 'stamp' }, body: { a: 1 } });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(deliveries[0].headers['x-living-trigger'] === 'stamp', `header did not arrive: ${JSON.stringify(deliveries[0].headers)}`);
});

// ── Who may call ──────────────────────────────────────────────────────────────────────────────
console.log('\n-- Who may call --');

await test('a guest is refused at the door, before any script runs', async () => {
    const r = await json('/v1/ext/living-hooks/send', { method: 'POST', body: JSON.stringify({ url: `${RECEIVER}/hook`, body: { a: 1 } }) });
    assert(r.status === 401, `expected 401, got ${r.status}`);
    const rr = await json('/v1/ext/living-hooks/read', { method: 'POST', body: JSON.stringify({ url: `${RECEIVER}/prices` }) });
    assert(rr.status === 401, `expected 401 on read, got ${rr.status}`);
});

const readOnlyAgent = await mintAgentToken(owner, 'lh-reader', ['memory:read']);
const writeAgent = await mintAgentToken(owner, 'lh-writer', ['memory:read', 'memory:write']);

await test('an agent without memory:write may not send, and the refusal says which word is missing', async () => {
    deliveries.length = 0;
    const r = await call('send', readOnlyAgent, { url: `${RECEIVER}/hook`, body: { a: 1 } });
    assert(r.error?.code === 'SCOPE_DENIED', `code: ${JSON.stringify(r.data)}`);
    assert(r.error.message.includes('memory:write'), 'the refusal does not name the permission');
    assert(deliveries.length === 0, 'a scope-refused send reached the receiver');
});

await test('an agent WITH memory:write sends on its owner behalf, under its owner allowlist', async () => {
    deliveries.length = 0;
    const r = await call('send', writeAgent, { url: `${RECEIVER}/hook`, body: { by: 'agent' } });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(deliveries.length === 1, 'the agent send did not arrive');
});

await test('an agent with memory:read may read', async () => {
    const r = await call('read', readOnlyAgent, { url: `${RECEIVER}/prices`, path: 'prices[0].price' });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(r.data.value === 4.2, `value: ${JSON.stringify(r.data)}`);
});

// ── Reading ───────────────────────────────────────────────────────────────────────────────────
console.log('\n-- Reading --');

await test('a path picks one value out of the answer', async () => {
    const r = await call('read', owner.token, { url: `${RECEIVER}/prices?a=1`, path: 'prices[1].price' });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(r.data.value === 5.5, `value: ${JSON.stringify(r.data)}`);
    assert(typeof r.data.fetchedAt === 'string', 'no fetchedAt');
    assert(String(r.data.contentType).includes('application/json'), `contentType: ${r.data.contentType}`);
});

await test('the same address inside ten seconds makes no second call', async () => {
    const before = reads;
    const first = await call('read', owner.token, { url: `${RECEIVER}/prices?cache=1`, path: 'prices[0].price' });
    assert(first.error === null, `first read refused: ${JSON.stringify(first.error)}`);
    const afterFirst = reads;
    assert(afterFirst === before + 1, `the first read made ${afterFirst - before} calls`);
    const second = await call('read', owner.token, { url: `${RECEIVER}/prices?cache=1`, path: 'prices[0].price' });
    assert(second.error === null, `second read refused: ${JSON.stringify(second.error)}`);
    assert(reads === afterFirst, `the cached read still called out (${reads - afterFirst} times)`);
    assert(second.data.cached === true, 'the second read is not marked cached');
    assert(second.data.fetchedAt === first.data.fetchedAt, 'the cached answer claims a new fetch time');
});

await test('a second path over the same cached answer is read out of the one call', async () => {
    const before = reads;
    const r = await call('read', owner.token, { url: `${RECEIVER}/prices?cache=1`, path: 'prices[1].price' });
    assert(r.data.value === 5.5, `value: ${JSON.stringify(r.data)}`);
    assert(reads === before, 'the second path made another call');
});

await test('raw takes a numeric body as a number', async () => {
    const r = await call('read', owner.token, { url: `${RECEIVER}/raw`, raw: true });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(r.data.value === 18.42, `value: ${JSON.stringify(r.data.value)} (${typeof r.data.value})`);
    assert(typeof r.data.value === 'number', `value is a ${typeof r.data.value}`);
});

await test('raw and path together are refused rather than one silently winning', async () => {
    const r = await call('read', owner.token, { url: `${RECEIVER}/raw`, raw: true, path: 'a.b' });
    assert(r.error?.code === 'INVALID_INPUT', `code: ${JSON.stringify(r.data)}`);
});

await test('a path with nowhere to go is BAD_PATH and says where it stopped', async () => {
    const r = await call('read', owner.token, { url: `${RECEIVER}/prices?bad=1`, path: 'prices[9].price' });
    assert(r.error?.code === 'BAD_PATH', `code: ${JSON.stringify(r.data)}`);
    assert(r.error.message.includes('prices'), 'the refusal does not say where it stopped');
});

await test('a body that is not JSON is UPSTREAM_FAILED, not BAD_PATH', async () => {
    const r = await call('read', owner.token, { url: `${RECEIVER}/notjson`, path: 'a.b' });
    assert(r.error?.code === 'UPSTREAM_FAILED', `code: ${JSON.stringify(r.data)}`);
});

await test("a reader that answers 503 carries the far end's status", async () => {
    const r = await call('read', owner.token, { url: `${RECEIVER}/boom`, path: 'why' });
    assert(r.error?.code === 'UPSTREAM_FAILED', `code: ${JSON.stringify(r.data)}`);
    assert(r.error.status === 503, `status: ${JSON.stringify(r.error)}`);
});

await test('a host nobody allowed is refused on the read door too', async () => {
    const r = await call('read', owner.token, { url: 'https://not-allowed.example/prices', path: 'a' });
    assert(r.error?.code === 'ALLOWLIST_REFUSED', `code: ${JSON.stringify(r.data)}`);
    assert(r.error.message.includes('not-allowed.example'), 'the refusal does not name the host');
});

// ── The secret that stays out of the document ────────────────────────────────────────────────
console.log('\n-- The secret --');

await test('the operator stores a secret in the extension settings', async () => {
    const withSecret = LIVING_HOOKS.manifest.replace('default: ""', `default: '{"${SECRET_NAME}":"${SECRET_VALUE}"}'`);
    assert(withSecret !== LIVING_HOOKS.manifest, 'the manifest no longer has the secrets default this test replaces');
    const r = await json('/v1/extensions/living-hooks', {
        method: 'PUT', headers: auth(owner.token),
        body: JSON.stringify({ manifest: withSecret, scripts: LIVING_HOOKS.scripts }),
    });
    assert(r.status === 200, `PUT ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('a header naming the secret arrives at the receiver resolved', async () => {
    deliveries.length = 0;
    const r = await call('send', owner.token, {
        url: `${RECEIVER}/hook`,
        headers: { Authorization: `Bearer {{secret:${SECRET_NAME}}}` },
        body: { a: 1 },
    });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(deliveries.length === 1, 'nothing arrived');
    assert(deliveries[0].headers.authorization === `Bearer ${SECRET_VALUE}`,
        `the header did not resolve: ${String(deliveries[0].headers.authorization)}`);
});

await test('the secret appears nowhere in what the caller is told', async () => {
    const r = await call('send', owner.token, {
        url: `${RECEIVER}/hook`,
        headers: { Authorization: `Bearer {{secret:${SECRET_NAME}}}` },
        body: { a: 1 },
    });
    assert(!JSON.stringify(r.envelope).includes(SECRET_VALUE), 'the answer carries the secret back');
});

await test('the extension record masks the secret rather than showing it', async () => {
    const r = await json('/v1/extensions/living-hooks', { headers: auth(owner.token) });
    assert(!JSON.stringify(r.body).includes(SECRET_VALUE), 'the extension record shows the secret in the clear');
});

await test('a placeholder naming a secret that is not set is refused by name, and nothing is sent', async () => {
    deliveries.length = 0;
    const r = await call('send', owner.token, {
        url: `${RECEIVER}/hook`, headers: { Authorization: 'Bearer {{secret:NOT_SET}}' }, body: { a: 1 },
    });
    assert(r.error?.code === 'SECRET_UNKNOWN', `code: ${JSON.stringify(r.data)}`);
    assert(r.error.message.includes('NOT_SET'), 'the refusal does not name the secret');
    assert(!r.error.message.includes(SECRET_VALUE), 'the refusal leaks another secret');
    assert(deliveries.length === 0, 'the refused call reached the receiver');
});

// ── The pacer ─────────────────────────────────────────────────────────────────────────────────
console.log('\n-- The pacer (60 sends a minute) --');

await test('the minute ceiling trips, and the receiver stops seeing calls', async () => {
    deliveries.length = 0;
    let refusedAt = 0;
    let refusal: any = null;
    // The window opened on the first send of this suite, so the ceiling is reached inside this loop.
    for (let i = 1; i <= 70; i++) {
        const r = await call('send', owner.token, { url: `${RECEIVER}/hook`, body: { i } });
        if (r.error?.code === 'RATE_LIMITED') { refusedAt = i; refusal = r.error; break; }
        assert(r.error === null, `send ${i} failed for another reason: ${JSON.stringify(r.error)}`);
    }
    assert(refusedAt > 0, 'the ceiling never tripped in 70 sends');
    assert(refusal.limit === 60, `the refusal claims a limit of ${refusal.limit}`);
    assert(deliveries.length === refusedAt - 1, `${deliveries.length} arrived, ${refusedAt - 1} were accepted`);
    // And it stays refused for the rest of the minute.
    const again = await call('send', owner.token, { url: `${RECEIVER}/hook`, body: { after: true } });
    assert(again.error?.code === 'RATE_LIMITED', `the ceiling let one through: ${JSON.stringify(again.data)}`);
});

await test('a paced-out sender can still read: the two ceilings are apart', async () => {
    const r = await call('read', owner.token, { url: `${RECEIVER}/prices?after=1`, path: 'prices[0].price' });
    assert(r.error === null, `the read was refused too: ${JSON.stringify(r.error)}`);
    assert(r.data.value === 4.2, `value: ${JSON.stringify(r.data)}`);
});

await stopReceiver();

console.log(`\n=== Living hooks: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
