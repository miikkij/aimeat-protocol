/**
 * @file e2e-intents.ts
 * @description The intent pool: the owner's list of what they mean to do here, and who may see it.
 *
 *   The refusals are the point. An intent pool is a to-do list written in the owner's own words,
 *   living in their memory namespace — so the tests that matter are the ones proving another owner
 *   cannot read it, an ecosystem app cannot read it, and the owner's own AGENT can (that last one
 *   is the whole design: the agent reads the pool through the memory route rather than through a
 *   route of its own, and if it could not, the browsing half of the feature would have to go).
 *
 *   Gate 0.2b from docs/internal/aiepooli/05-checklist.md is Phase 3 here: the route says in its
 *   own comment that it lets same-owner principals opt in, and that had never been run.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=intents
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (intent pool, phase 1 + gate 0.2b/0.3).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `int${Date.now() % 100000}`;
const stranger = `str${Date.now() % 100000}`;

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
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

let ownerToken = '';
let strangerToken = '';
let agentToken = '';
let ecoToken = '';
let intentId = '';

console.log('\n=== Intent Pool E2E Tests ===\n');
console.log('Phase 0: setup');

await test('Register the owner and a stranger', async () => {
    ownerToken = await registerOwner(owner);
    strangerToken = await registerOwner(stranger);
});

console.log('\nPhase 1: the pool itself');

await test('an empty pool is an empty list, not an error', async () => {
    const r = await json('/v1/intents', auth(ownerToken));
    assert(r.status === 200, `list ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(Array.isArray(r.body.data.intents) && r.body.data.intents.length === 0,
        `expected an empty pool, got ${JSON.stringify(r.body.data.intents)}`);
});

await test('create an intent', async () => {
    const r = await json('/v1/intents', auth(ownerToken, {
        method: 'POST',
        body: JSON.stringify({
            title: 'Uudista tervetulomatto', kind: 'document',
            prompt_ref: 'welcome-mat', origin: 'home.rooms.create',
        }),
    }));
    assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body.error)}`);
    const i = r.body.data.intent;
    intentId = i.id;
    assert(!!i.id && i.status === 'open', `bad shape: ${JSON.stringify(i)}`);
    assert(i.prompt_ref === 'welcome-mat', 'prompt_ref is a NAME, kept as given');
    assert(i.origin === 'home.rooms.create', 'origin is recorded — it is how we learn where intents come from');
});

await test('THE PROMPT TEXT IS NOT STORED — only its name', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(`intent.${intentId}`)}`, auth(ownerToken));
    assert(r.status === 200, `read record ${r.status}`);
    const raw = JSON.stringify(r.body.data.value);
    assert(raw.includes('welcome-mat'), 'the name is there');
    assert(raw.length < 1000, `the record should be small; a stored prompt would blow it up: ${raw.length} chars`);
});

await test('the record carries the tags the pool relies on, and NO ttl', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(`intent.${intentId}`)}`, auth(ownerToken));
    const e = r.body.data;
    assert(Array.isArray(e.tags) && e.tags.includes('intent') && e.tags.includes('intent:open'),
        `tags: ${JSON.stringify(e.tags)}`);
    assert(e.visibility === 'owner', `visibility should be owner, got ${e.visibility}`);
    // A pool that empties itself in 90 days is worse than no pool.
    assert(!e.expires_at && !e.ttl_hours, `an intent must not expire: ${JSON.stringify(e)}`);
});

await test('list it back', async () => {
    const r = await json('/v1/intents', auth(ownerToken));
    assert(r.body.data.intents.length === 1, `expected 1, got ${r.body.data.intents.length}`);
    assert(r.body.data.intents[0].id === intentId, 'the same intent comes back');
});

await test('move it to done', async () => {
    const r = await json(`/v1/intents/${intentId}`, auth(ownerToken, {
        method: 'PATCH', body: JSON.stringify({ status: 'done' }),
    }));
    assert(r.status === 200, `patch ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.intent.status === 'done', 'status moved');
    const mem = await json(`/v1/memory/${encodeURIComponent(`intent.${intentId}`)}`, auth(ownerToken));
    assert(mem.body.data.tags.includes('intent:done'), `the tag follows the status: ${JSON.stringify(mem.body.data.tags)}`);
});

await test('a bad kind is refused, with the vocabulary named', async () => {
    const r = await json('/v1/intents', auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ title: 'x', kind: 'invented-type' }),
    }));
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(/document/.test(r.body.error.message), 'the refusal lists the real vocabulary');
});

await test('a title is required', async () => {
    const r = await json('/v1/intents', auth(ownerToken, { method: 'POST', body: JSON.stringify({}) }));
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

console.log('\nPhase 2: whose pool it is');

await test("REFUSAL: another owner cannot read this pool", async () => {
    const r = await json('/v1/intents', auth(strangerToken));
    assert(r.status === 200, `the stranger has their own pool: ${r.status}`);
    assert(r.body.data.intents.length === 0,
        `a stranger must see NOTHING of another owner's pool, saw ${r.body.data.intents.length}`);
});

await test("REFUSAL: another owner cannot patch or delete this intent", async () => {
    const p = await json(`/v1/intents/${intentId}`, auth(strangerToken, {
        method: 'PATCH', body: JSON.stringify({ title: 'hijacked' }),
    }));
    assert(p.status === 404, `patch by a stranger must 404, got ${p.status}`);
    const d = await json(`/v1/intents/${intentId}`, auth(strangerToken, { method: 'DELETE' }));
    assert(d.status === 404, `delete by a stranger must 404, got ${d.status}`);
    // …and the intent is untouched.
    const mine = await json('/v1/intents', auth(ownerToken));
    assert(mine.body.data.intents[0].title === 'Uudista tervetulomatto', 'the title survived');
});

await test('REFUSAL: no session, no pool', async () => {
    const r = await json('/v1/intents');
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

console.log('\nPhase 3: GATE 0.2b — can the owner\'s own agent read the pool?');

await test("the owner's agent gets a token", async () => {
    const a = await json('/v1/agents/device-authorize', {
        method: 'POST', body: JSON.stringify({ agent_name: 'pool-reader', owner }),
    });
    assert(a.status === 200, `authorize ${a.status}`);
    const v = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({
            user_code: a.body.data.user_code, action: 'approve',
            scopes: ['memory:read', 'memory:write'], owner_token: ownerToken,
        }),
    });
    assert(v.status === 200, `approve ${v.status}: ${JSON.stringify(v.body.error)}`);
    const poll = await fetch(`${BASE}/v1/agents/device-token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: a.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    const creds = await poll.json() as any;
    assert(typeof creds.access_token === 'string', `no agent token: ${JSON.stringify(creds)}`);
    agentToken = creds.access_token;
});

await test('WITHOUT owner_scope the agent sees its own namespace, and the pool is not in it', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(`intent.${intentId}`)}`, auth(agentToken));
    assert(r.status !== 200, `the agent must not get the owner's record by default, got ${r.status}`);
});

await test('THE GATE: with owner_scope=true the agent CAN read the pool record', async () => {
    // If this refuses, the browsing half of the design falls away and is not worked around.
    const r = await json(`/v1/memory/${encodeURIComponent(`intent.${intentId}`)}?owner_scope=true`, auth(agentToken));
    assert(r.status === 200,
        `GATE 0.2b FAILED: the route claims to let same-owner principals opt in, got ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.value.title === 'Uudista tervetulomatto',
        `the agent read the wrong thing: ${JSON.stringify(r.body.data.value)}`);
});

await test('and can LIST the pool the same way', async () => {
    const r = await json('/v1/memory?owner_scope=true&prefix=intent.', auth(agentToken));
    assert(r.status === 200, `list ${r.status}: ${JSON.stringify(r.body.error)}`);
    const keys = (r.body.data.items ?? []).map((e: any) => e.key);
    assert(keys.includes(`intent.${intentId}`), `the pool should be listable: ${JSON.stringify(keys)}`);
});

await test('REFUSAL: the agent may not use the owner-only intents route', async () => {
    const r = await json('/v1/intents', auth(agentToken));
    assert(r.status === 403 || r.status === 401,
        `an agent token must not reach the owner route, got ${r.status}`);
});

console.log('\nPhase 3b: GATE 0.3 — an ecosystem app must NOT reach the pool');

await test('an ecosystem app is onboarded with memory scopes and its own data area', async () => {
    // Deliberately generous: memory:read AND a data area. The point is that neither buys the pool.
    const hello = await json('/v1/ecosystem-apps/hello', {
        method: 'POST',
        body: JSON.stringify({
            owner, app: 'pool-peeker', display_name: 'Pool Peeker',
            public_key: 'MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=',
            scopes: ['memory:read', 'memory:write'],
            data_areas: [{ area: 'memory', pattern: 'service.peeker.*', rights: ['read', 'write'] }],
        }),
    });
    assert(hello.status === 200, `hello ${hello.status}: ${JSON.stringify(hello.body)}`);
    const approve = await json(`/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ action: 'approve', scopes: ['memory:read', 'memory:write'] }),
    }));
    assert(approve.status === 200, `approve ${approve.status}: ${JSON.stringify(approve.body)}`);
    const tok = await json('/v1/ecosystem-apps/token', {
        method: 'POST',
        body: JSON.stringify({
            device_code: hello.body.data.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
    });
    assert(typeof tok.body.access_token === 'string', `no GEAI token: ${JSON.stringify(tok.body)}`);
    ecoToken = tok.body.access_token;
});

await test('GATE 0.3: owner_scope does NOT broaden an ecosystem app to the pool', async () => {
    // The whole point of owner_scope for an agent is the whole danger of it for an eco app: a GEAI
    // is fenced to its data areas, and this flag must not be the way around that fence.
    const list = await json('/v1/memory?owner_scope=true&prefix=intent.', auth(ecoToken));
    const keys = (list.body.data?.items ?? []).map((e: any) => e.key);
    assert(keys.length === 0,
        `an ecosystem app reached the owner's pool: ${JSON.stringify(keys)}`);
});

await test('GATE 0.3: nor can it read one intent by key', async () => {
    const openIntent = (await json('/v1/intents', auth(ownerToken))).body.data.intents[0];
    assert(!!openIntent, 'there is an intent to try for');
    const r = await json(`/v1/memory/${encodeURIComponent(`intent.${openIntent.id}`)}?owner_scope=true`, auth(ecoToken));
    assert(r.status !== 200,
        `an ecosystem app read an owner intent: ${r.status} ${JSON.stringify(r.body.data)}`);
});

await test('GATE 0.3: and the owner-only route refuses it outright', async () => {
    const r = await json('/v1/intents', auth(ecoToken));
    assert(r.status === 403 || r.status === 401, `expected a refusal, got ${r.status}`);
});

await test('GATE 0.3: owner_scope is not a way past the data-area fence AT ALL', async () => {
    // The pool is only the key that happened to catch this. A GEAI is fenced to its granted data
    // areas, so `owner_scope` must not hand it ANY owner key outside them — the same flag that is
    // correct for an agent is the whole danger for an app the owner fenced on purpose.
    const secret = 'e2e.intents.not-your-business';
    const w = await json('/v1/memory', auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ key: secret, value: { pin: 4242 }, visibility: 'private' }),
    }));
    assert(w.status === 200 || w.status === 201, `owner writes their own key: ${w.status} ${JSON.stringify(w.body.error)}`);
    const r = await json(`/v1/memory/${encodeURIComponent(secret)}?owner_scope=true`, auth(ecoToken));
    assert(r.status !== 200,
        `an ecosystem app read an owner key outside its data areas: ${r.status} ${JSON.stringify(r.body.data)}`);
});

console.log('\nPhase 4: closes_when is evaluated on READ, never stored');

await test('a suggestion whose condition is already true is not offered', async () => {
    // first_agent is true — the owner has just connected 'pool-reader'.
    const r = await json('/v1/intents', auth(ownerToken, {
        method: 'POST',
        body: JSON.stringify({ title: 'Kytke ensimmäinen agentti', closes_when: { check: 'first_agent' } }),
    }));
    assert(r.status === 201, `create ${r.status}`);
    const list = await json('/v1/intents', auth(ownerToken));
    const titles = list.body.data.intents.map((i: any) => i.title);
    assert(!titles.includes('Kytke ensimmäinen agentti'),
        `a satisfied suggestion must not be offered: ${JSON.stringify(titles)}`);
    assert(list.body.data.satisfied_hidden >= 1, 'the count says one was hidden, so an empty list can be explained');
});

await test('…but it is still THERE, not written done', async () => {
    const r = await json('/v1/intents?include=satisfied', auth(ownerToken));
    const found = r.body.data.intents.find((i: any) => i.title === 'Kytke ensimmäinen agentti');
    assert(!!found, 'the record still exists');
    assert(found.satisfied === true, 'it reports itself satisfied');
    assert(found.status === 'open', `its stored status is untouched — a suggestion is not "done": ${found.status}`);
});

await test('a suggestion whose condition is FALSE is offered', async () => {
    const r = await json('/v1/intents', auth(ownerToken, {
        method: 'POST',
        body: JSON.stringify({ title: 'Tee tervetulomatto', closes_when: { check: 'welcome_mat' } }),
    }));
    assert(r.status === 201, `create ${r.status}`);
    const list = await json('/v1/intents', auth(ownerToken));
    const titles = list.body.data.intents.map((i: any) => i.title);
    assert(titles.includes('Tee tervetulomatto'), `an unmet suggestion belongs on the list: ${JSON.stringify(titles)}`);
});

await test('an invented check is refused', async () => {
    const r = await json('/v1/intents', auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ title: 'x', closes_when: { check: 'make_me_rich' } }),
    }));
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

console.log('\nPhase 5: removal');

await test('delete removes it from the pool', async () => {
    const d = await json(`/v1/intents/${intentId}`, auth(ownerToken, { method: 'DELETE' }));
    assert(d.status === 200, `delete ${d.status}`);
    const list = await json('/v1/intents?include=satisfied', auth(ownerToken));
    assert(!list.body.data.intents.some((i: any) => i.id === intentId), 'it is gone');
});

await test('deleting it twice is a 404, not a second success', async () => {
    const d = await json(`/v1/intents/${intentId}`, auth(ownerToken, { method: 'DELETE' }));
    assert(d.status === 404, `expected 404, got ${d.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
