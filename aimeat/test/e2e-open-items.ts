/**
 * @file e2e-open-items.ts
 * @description Open items: the owner's list of what they are going to do here, and who may see it.
 *
 *   The refusals are the point. This list is written in the owner's own words and lives in their
 *   memory namespace — so the tests that matter are the ones proving another owner
 *   cannot read it, an ecosystem app cannot read it, and the owner's own AGENT can (that last one
 *   is the whole design: the agent reads the list through the memory route rather than through a
 *   route of its own, and if it could not, the browsing half of the feature would have to go).
 *
 *   Gate 0.2b from docs/internal/aiepooli/05-checklist.md is Phase 3 here: the route says in its
 *   own comment that it lets same-owner principals opt in, and that had never been run.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=open-items
 * @version-history
 *   v1.0.0 — 2026-08-09 — Replaces e2e-intents.ts. One key instead of one record per item, a
 *     flipped state instead of open→done, and the agent now WRITES the list rather than only
 *     reading it, so the conflict path is covered too.
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
let itemId = '';
let promotedItemId = '';
let promotedTaskId = '';

console.log('\n=== Open Items E2E Tests ===\n');
console.log('Phase 0: setup');

await test('Register the owner and a stranger', async () => {
    ownerToken = await registerOwner(owner);
    strangerToken = await registerOwner(stranger);
});

console.log('\nPhase 1: the list itself');

await test('an empty list is an empty list, not an error', async () => {
    const r = await json('/v1/open-items', auth(ownerToken));
    assert(r.status === 200, `list ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(Array.isArray(r.body.data.items) && r.body.data.items.length === 0,
        `expected an empty list, got ${JSON.stringify(r.body.data.items)}`);
});

await test('switch something on', async () => {
    const r = await json('/v1/open-items', auth(ownerToken, {
        method: 'POST',
        body: JSON.stringify({
            title: 'Uudista tervetulomatto', kind: 'document',
            prompt_ref: 'welcome-mat', origin: 'home.rooms.create',
        }),
    }));
    assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body.error)}`);
    const i = r.body.data.item;
    itemId = i.id;
    assert(!!i.id && i.status === 'open', `bad shape: ${JSON.stringify(i)}`);
    assert(i.prompt_ref === 'welcome-mat', 'prompt_ref is a NAME, kept as given');
    assert(i.origin === 'home.rooms.create', 'origin is recorded — it is how we learn where items come from');
});

await test('THE PROMPT TEXT IS NOT STORED — only its name', async () => {
    const r = await json('/v1/memory/open-items.list', auth(ownerToken));
    assert(r.status === 200, `read record ${r.status}`);
    const raw = JSON.stringify(r.body.data.value);
    assert(raw.includes('welcome-mat'), 'the name is there');
    assert(raw.length < 1000, `the record should be small; a stored prompt would blow it up: ${raw.length} chars`);
});

await test('the record carries the tags the list relies on, and NO ttl', async () => {
    const r = await json('/v1/memory/open-items.list', auth(ownerToken));
    const e = r.body.data;
    assert(Array.isArray(e.tags) && e.tags.includes('open-items'),
        `tags: ${JSON.stringify(e.tags)}`);
    assert(e.visibility === 'owner', `visibility should be owner, got ${e.visibility}`);
    // A list that empties itself in 90 days is worse than no list.
    assert(!e.expires_at && !e.ttl_hours, `the list must not expire: ${JSON.stringify(e)}`);
});

await test('list it back', async () => {
    const r = await json('/v1/open-items', auth(ownerToken));
    assert(r.body.data.items.length === 1, `expected 1, got ${r.body.data.items.length}`);
    assert(r.body.data.items[0].id === itemId, 'the same item comes back');
});

await test('THERE IS NO DONE — status done is refused, switching off is DELETE', async () => {
    const r = await json(`/v1/open-items/${itemId}`, auth(ownerToken, {
        method: 'PATCH', body: JSON.stringify({ status: 'done' }),
    }));
    assert(r.status === 400, `done must not be a status, got ${r.status}`);
});

await test('switch it off: it leaves the list, and a record of it stays', async () => {
    const off = await json(`/v1/open-items/${itemId}`, auth(ownerToken, { method: 'DELETE' }));
    assert(off.status === 200, `switch off ${off.status}: ${JSON.stringify(off.body.error)}`);
    const list = await json('/v1/open-items', auth(ownerToken));
    assert(list.body.data.items.length === 0, 'it is off the list');
    // "Does anything here get done" must still have an answer.
    const stats = await json('/v1/open-items/stats', auth(ownerToken));
    assert(stats.body.data.closed === 1, `the closed record must survive: ${JSON.stringify(stats.body.data)}`);
    assert(stats.body.data.open === 0, 'and it is not counted as open');
});

await test('switch something on again, so the rest of the run has an item', async () => {
    const r = await json('/v1/open-items', auth(ownerToken, {
        method: 'POST',
        body: JSON.stringify({ title: 'Uudista tervetulomatto', prompt_ref: 'welcome-mat', origin: 'home.rooms.create' }),
    }));
    assert(r.status === 201, `create ${r.status}`);
    itemId = r.body.data.item.id;
});

await test('a bad kind is refused, with the vocabulary named', async () => {
    const r = await json('/v1/open-items', auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ title: 'x', kind: 'invented-type' }),
    }));
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(/document/.test(r.body.error.message), 'the refusal lists the real vocabulary');
});

await test('a title is required', async () => {
    const r = await json('/v1/open-items', auth(ownerToken, { method: 'POST', body: JSON.stringify({}) }));
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

console.log('\nPhase 2: whose list it is');

await test("REFUSAL: another owner cannot read this list", async () => {
    const r = await json('/v1/open-items', auth(strangerToken));
    assert(r.status === 200, `the stranger has their own list: ${r.status}`);
    assert(r.body.data.items.length === 0,
        `a stranger must see NOTHING of another owner's list, saw ${r.body.data.items.length}`);
});

await test("REFUSAL: another owner cannot patch or switch off this item", async () => {
    const p = await json(`/v1/open-items/${itemId}`, auth(strangerToken, {
        method: 'PATCH', body: JSON.stringify({ title: 'hijacked' }),
    }));
    assert(p.status === 404, `patch by a stranger must 404, got ${p.status}`);
    const d = await json(`/v1/open-items/${itemId}`, auth(strangerToken, { method: 'DELETE' }));
    assert(d.status === 404, `delete by a stranger must 404, got ${d.status}`);
    // …and the item is untouched.
    const mine = await json('/v1/open-items', auth(ownerToken));
    assert(mine.body.data.items[0].title === 'Uudista tervetulomatto', 'the title survived');
});

await test('REFUSAL: no session, no list', async () => {
    const r = await json('/v1/open-items');
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

console.log('\nPhase 3: GATE 0.2b — can the owner\'s own agent read the list?');

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

await test('WITHOUT owner_scope the agent sees its own namespace, and the list is not in it', async () => {
    const r = await json('/v1/memory/open-items.list', auth(agentToken));
    assert(r.status !== 200, `the agent must not get the owner's record by default, got ${r.status}`);
});

await test('THE GATE: with owner_scope=true the agent CAN read the list record', async () => {
    // If this refuses, the browsing half of the design falls away and is not worked around.
    const r = await json('/v1/memory/open-items.list?owner_scope=true', auth(agentToken));
    assert(r.status === 200,
        `GATE 0.2b FAILED: the route claims to let same-owner principals opt in, got ${r.status}: ${JSON.stringify(r.body.error)}`);
    const readItems = r.body.data.value?.items ?? [];
    assert(readItems.some((i: any) => i.title === 'Uudista tervetulomatto'),
        `the agent read the wrong thing: ${JSON.stringify(r.body.data.value).slice(0, 300)}`);
});

await test('one read gives the agent the WHOLE list, not a scan', async () => {
    const r = await json('/v1/memory/open-items.list?owner_scope=true', auth(agentToken));
    assert(r.status === 200, `read ${r.status}: ${JSON.stringify(r.body.error)}`);
    const items = r.body.data.value?.items ?? [];
    assert(Array.isArray(items) && items.some((i: any) => i.id === itemId),
        `the list should arrive in one read: ${JSON.stringify(items).slice(0, 300)}`);
});

await test('REFUSAL: the agent may not use the owner-only route', async () => {
    const r = await json('/v1/open-items', auth(agentToken));
    assert(r.status === 403 || r.status === 401,
        `an agent token must not reach the owner route, got ${r.status}`);
});

console.log('\nPhase 3b: GATE 0.3 — an ecosystem app must NOT reach the list');

await test('an ecosystem app is onboarded with memory scopes and its own data area', async () => {
    // Deliberately generous: memory:read AND a data area. The point is that neither buys the list.
    const hello = await json('/v1/ecosystem-apps/hello', {
        method: 'POST',
        body: JSON.stringify({
            owner, app: 'list-peeker', display_name: 'List Peeker',
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

await test('GATE 0.3: owner_scope does NOT broaden an ecosystem app to the list', async () => {
    // The whole point of owner_scope for an agent is the whole danger of it for an eco app: a GEAI
    // is fenced to its data areas, and this flag must not be the way around that fence.
    const list = await json('/v1/memory?owner_scope=true&prefix=open-items.', auth(ecoToken));
    const keys = (list.body.data?.items ?? []).map((e: any) => e.key);
    assert(keys.length === 0,
        `an ecosystem app reached the owner's list: ${JSON.stringify(keys)}`);
});

await test('GATE 0.3: nor can it read the list by key', async () => {
    const r = await json('/v1/memory/open-items.list?owner_scope=true', auth(ecoToken));
    assert(r.status !== 200,
        `an ecosystem app read the owner's list: ${r.status} ${JSON.stringify(r.body.data)}`);
});

await test('GATE 0.3: and the owner-only route refuses it outright', async () => {
    const r = await json('/v1/open-items', auth(ecoToken));
    assert(r.status === 403 || r.status === 401, `expected a refusal, got ${r.status}`);
});

await test('GATE 0.3: owner_scope is not a way past the data-area fence AT ALL', async () => {
    // The list is only the key that happened to catch this. A GEAI is fenced to its granted data
    // areas, so `owner_scope` must not hand it ANY owner key outside them — the same flag that is
    // correct for an agent is the whole danger for an app the owner fenced on purpose.
    const secret = 'e2e.open-items.not-your-business';
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
    const r = await json('/v1/open-items', auth(ownerToken, {
        method: 'POST',
        body: JSON.stringify({ title: 'Kytke ensimmäinen agentti', closes_when: { check: 'first_agent' } }),
    }));
    assert(r.status === 201, `create ${r.status}`);
    const list = await json('/v1/open-items', auth(ownerToken));
    const titles = list.body.data.items.map((i: any) => i.title);
    assert(!titles.includes('Kytke ensimmäinen agentti'),
        `a satisfied suggestion must not be offered: ${JSON.stringify(titles)}`);
    assert(list.body.data.satisfied_hidden >= 1, 'the count says one was hidden, so an empty list can be explained');
});

await test('…but it is still THERE, not written done', async () => {
    const r = await json('/v1/open-items?include=satisfied', auth(ownerToken));
    const found = r.body.data.items.find((i: any) => i.title === 'Kytke ensimmäinen agentti');
    assert(!!found, 'the record still exists');
    assert(found.satisfied === true, 'it reports itself satisfied');
    assert(found.status === 'open', `its stored status is untouched — a suggestion is not "done": ${found.status}`);
});

await test('a suggestion whose condition is FALSE is offered', async () => {
    const r = await json('/v1/open-items', auth(ownerToken, {
        method: 'POST',
        body: JSON.stringify({ title: 'Tee tervetulomatto', closes_when: { check: 'welcome_mat' } }),
    }));
    assert(r.status === 201, `create ${r.status}`);
    const list = await json('/v1/open-items', auth(ownerToken));
    const titles = list.body.data.items.map((i: any) => i.title);
    assert(titles.includes('Tee tervetulomatto'), `an unmet suggestion belongs on the list: ${JSON.stringify(titles)}`);
});

await test('an invented check is refused', async () => {
    const r = await json('/v1/open-items', auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ title: 'x', closes_when: { check: 'make_me_rich' } }),
    }));
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

console.log('\nPhase 4b: an item handed to an agent');

await test('a task carries the item reference, and the item carries the task', async () => {
    const made = await json('/v1/open-items', auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ title: 'Tee ensimmäinen appi', prompt_ref: 'build-app' }),
    }));
    assert(made.status === 201, `create ${made.status}`);
    promotedItemId = made.body.data.item.id;

    const task = await json('/v1/agents/pool-reader/tasks', auth(ownerToken, {
        method: 'POST',
        body: JSON.stringify({
            title: 'Tee ensimmäinen appi', description: 'From the list', status: 'queued',
            resources: { memory_keys: [`open-items.list#${promotedItemId}`] },
        }),
    }));
    assert(task.status === 201 || task.status === 200, `task ${task.status}: ${JSON.stringify(task.body.error)}`);
    promotedTaskId = task.body.data.task?.id ?? task.body.data.id;
    assert(!!promotedTaskId, `no task id: ${JSON.stringify(task.body.data)}`);

    // The link the plan calls a NEW read path: nothing read this field before the list did.
    const read = await json(`/v1/agents/pool-reader/tasks/${promotedTaskId}`, auth(ownerToken));
    const keys = read.body.data.task?.resources?.memoryKeys ?? read.body.data.task?.resources?.memory_keys ?? [];
    assert(keys.includes(`open-items.list#${promotedItemId}`),
        `the task must say which item it came from: ${JSON.stringify(read.body.data.task?.resources)}`);

    const patched = await json(`/v1/open-items/${promotedItemId}`, auth(ownerToken, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'working', agent: `pool-reader#${owner}@${NODE_ID}` }),
    }));
    assert(patched.status === 200, `patch ${patched.status}`);
    assert(patched.body.data.item.status === 'working', 'the item shows somebody is on it');
});

await test('COMPLETING THE TASK CLOSES THE INTENT — the server does it, not the agent', async () => {
    // A queued task is started before it can be completed; the list changes nothing about that.
    // The OWNER starts it — an agent may not start its own work, which is the point of the gate.
    const started = await json(`/v1/agents/pool-reader/tasks/${promotedTaskId}/start`, auth(ownerToken, {
        method: 'POST', body: JSON.stringify({}),
    }));
    assert(started.status === 200, `start ${started.status}: ${JSON.stringify(started.body.error)}`);
    const done = await json(`/v1/agents/pool-reader/tasks/${promotedTaskId}/complete`, auth(agentToken, {
        method: 'POST', body: JSON.stringify({ message: 'done' }),
    }));
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);

    // The close is best-effort and fired after the response, so give it a moment before reading.
    await new Promise(r => setTimeout(r, 250));
    const list = await json('/v1/open-items?include=satisfied', auth(ownerToken));
    const it = list.body.data.items.find((i: any) => i.id === promotedItemId);
    assert(!it, 'a completed task must take its item OFF the list');
    const stats = await json('/v1/open-items/stats', auth(ownerToken));
    assert(stats.body.data.closedByAgent >= 1,
        `and the close must be attributed to the agent: ${JSON.stringify(stats.body.data)}`);
});

await test('an agent WITHOUT memory:write-as-owner cannot write the list', async () => {
    const w = await json('/v1/memory', auth(agentToken, {
        method: 'POST',
        body: JSON.stringify({ key: 'open-items.list', value: { items: [] }, owner_scope: true }),
    }));
    assert(w.status === 403,
        `the scope is what buys this, and this agent does not hold it, got ${w.status}`);
});

console.log('\nPhase 5: removal');

await test('DELETE takes it off the list', async () => {
    const d = await json(`/v1/open-items/${itemId}`, auth(ownerToken, { method: 'DELETE' }));
    assert(d.status === 200, `delete ${d.status}`);
    const list = await json('/v1/open-items?include=satisfied', auth(ownerToken));
    assert(!list.body.data.items.some((i: any) => i.id === itemId), 'it is gone');
});

await test('switching it off twice is a 404, not a second success', async () => {
    const d = await json(`/v1/open-items/${itemId}`, auth(ownerToken, { method: 'DELETE' }));
    assert(d.status === 404, `expected 404, got ${d.status}`);
});

console.log('\nPhase 6: three writers, one key');

await test('the whole list is ONE record, not one per item', async () => {
    for (const title of ['a', 'b', 'c']) {
        const r = await json('/v1/open-items', auth(ownerToken, {
            method: 'POST', body: JSON.stringify({ title }),
        }));
        assert(r.status === 201, `create ${title}: ${r.status}`);
    }
    const keys = (await json('/v1/memory?prefix=open-items.', auth(ownerToken))).body.data.items ?? [];
    assert(keys.length === 1,
        `three items must live in ONE key, found ${keys.length}: ${JSON.stringify(keys.map((k: any) => k.key))}`);
});

await test('a stale write is refused rather than overwriting what somebody else just did', async () => {
    const before = await json('/v1/memory/open-items.list', auth(ownerToken));
    const staleVersion = before.body.data.version;
    assert(typeof staleVersion === 'number', `the record must carry a version: ${JSON.stringify(before.body.data)}`);

    const added = await json('/v1/open-items', auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ title: 'added in between' }),
    }));
    assert(added.status === 201, `create ${added.status}`);

    const clobber = await json('/v1/memory/open-items.list', auth(ownerToken, {
        method: 'PUT',
        body: JSON.stringify({ value: { version: 1, items: [], closed: [] }, version: staleVersion }),
    }));
    assert(clobber.status === 409,
        `a stale write must be refused, got ${clobber.status}: ${JSON.stringify(clobber.body)}`);

    const after = await json('/v1/open-items', auth(ownerToken));
    assert(after.body.data.items.some((i: any) => i.title === 'added in between'),
        'the write that got there first must still be on the list');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
