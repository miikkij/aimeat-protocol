/**
 * @file test/e2e-capability-update-fields.ts
 * @description E2E for the fields PUT /v1/capabilities/{id} takes from its body.
 *
 *   THE RULE. A capability update takes the fields a capability's writer may set and no other key,
 *   and it takes the same ones on both storage backends. The source of a capability changes through
 *   the `source` object only. That object is normalised and checked as at create, and the webhook
 *   policy reads the normalised source, whatever shape `source` arrived in. A key that is not a
 *   field of the update is dropped: the answer is 200 and carries the stored record, as it does for
 *   a field the node owns (trust, stats).
 *
 *   AND WHAT STAYS. An owner and an owner's agent change the source of their own capability with a
 *   `source` object, set and change a webhook the node's policy admits, clear a webhook, and send a
 *   whole stored record back with one field changed.
 * @structure
 *   Phase 1: the runner's node (capabilityWebhooks 'disabled', capabilityPublishing 'self_only')
 *   Phase 2: a node of this suite with capabilityWebhooks 'allowlist_only'
 * @usage
 *   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-capability-update-fields
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { suitePort } from './helpers/free-port.js';
import { registerOwner, setupOperator } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';

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

async function json(path: string, opts: RequestInit = {}, base = BASE) {
    const res = await fetch(`${base}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const suffix = Math.random().toString(36).slice(2, 8);
const OFF_LIST = 'https://elsewhere.test/hook';
const MANUAL = { type: 'manual', ref: 'manual', version: '1.0.0' };
const EXTENSION = { type: 'extension', ref: `ext:updfields-${suffix}:run`, version: '2.0.0' };

interface Actor { label: string; token: string }

/** One node's three callers: an owner who is not the operator, that owner's agent, and a second owner. */
interface Cast { alice: Actor; agent: Actor; bob: Actor; names: Array<{ name: string; token: string }> }

async function makeCast(base: string, tag: string): Promise<Cast> {
    // The first account on a node is its operator. Alice and Bob come after it, so neither is exempt
    // from a policy the operator is exempt from.
    const first = await setupOperator(base, ADMIN_PW, `updf-op-${tag}-${suffix}`);
    const alice = await registerOwner(base, `updf-alice-${tag}-${suffix}`);
    const bob = await registerOwner(base, `updf-bob-${tag}-${suffix}`);
    const agent = await makeAgent(base, alice, ['work:request', 'capability:write']);
    return {
        alice: { label: 'the owner', token: alice.token },
        agent: { label: 'the owner\'s agent', token: agent.token },
        bob: { label: 'a second owner', token: bob.token },
        names: [{ name: bob.name, token: bob.token }, { name: alice.name, token: alice.token }, { name: first.name, token: first.token }],
    };
}

let serial = 0;
/** Create a private capability as `who` and answer its id. */
async function create(who: Actor, fields: Record<string, unknown>, base = BASE): Promise<string> {
    const id = `updf-${suffix}-${++serial}`;
    const made = await json('/v1/capabilities', {
        method: 'POST', headers: auth(who.token),
        body: JSON.stringify({ id, name: `Update fields ${serial}`, summary: 'fixture', visibility: 'private', source: MANUAL, ...fields }),
    }, base);
    assert(made.status === 201, `${who.label} creates ${id}: ${made.status} ${JSON.stringify(made.body.error)}`);
    return id;
}

async function put(who: Actor, id: string, patch: unknown, base = BASE) {
    return json(`/v1/capabilities/${id}`, { method: 'PUT', headers: auth(who.token), body: JSON.stringify(patch) }, base);
}

async function read(who: Actor, id: string, base = BASE) {
    const got = await json(`/v1/capabilities/${id}`, { headers: auth(who.token) }, base);
    assert(got.status === 200, `${who.label} reads ${id}: ${got.status}`);
    return got.body.data;
}

const sourceText = (source: unknown) => JSON.stringify(source);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Delete the cast's accounts, and answer the names whose delete did not answer ok. */
async function removeCast(cast: Cast, base: string): Promise<string[]> {
    const left: string[] = [];
    for (const { name, token } of cast.names) {
        const gone = await json(`/v1/owners/${name}`, { method: 'DELETE', headers: auth(token) }, base);
        if (gone.body?.ok !== true) left.push(`${name}: ${gone.status}`);
    }
    return left;
}

console.log('\n=== Capability update: the fields a PUT takes ===\n');

// ─── Phase 1: the runner's node ───
console.log('Phase 1: capabilityWebhooks=disabled');

let cast!: Cast;

await test('Setup: an owner who is not the operator, the owner\'s agent, a second owner', async () => {
    cast = await makeCast(BASE, 'p1');
    const { body } = await json('/v1/capabilities');
    assert(body.data?.policy?.webhooks === 'disabled', `this node's webhook policy: ${body.data?.policy?.webhooks}`);
});

console.log('Designed use');

for (const who of ['alice', 'agent'] as const) {
    await test(`${who}: a PUT with a source object changes the source of the caller's own capability`, async () => {
        const actor = cast[who];
        const id = await create(actor, {});
        const res = await put(actor, id, { source: EXTENSION });
        assert(res.status === 200, `expected 200, got ${res.status} ${JSON.stringify(res.body.error)}`);
        assert(same(res.body.data.source, EXTENSION), `answered source: ${sourceText(res.body.data.source)}`);
        assert(same((await read(actor, id)).source, EXTENSION), 'the stored source is the one sent');
        const back = await put(actor, id, { source: MANUAL });
        assert(back.status === 200 && same((await read(actor, id)).source, MANUAL),
            `back to manual: ${back.status} ${JSON.stringify(back.body.error)}`);
    });

    await test(`${who}: a whole stored record sent back with one field changed is accepted`, async () => {
        const actor = cast[who];
        const id = await create(actor, { source: EXTENSION });
        const record = await read(actor, id);
        const res = await put(actor, id, { ...record, summary: 'edited with the whole record' });
        assert(res.status === 200, `expected 200, got ${res.status} ${JSON.stringify(res.body.error)}`);
        const stored = await read(actor, id);
        assert(stored.summary === 'edited with the whole record', `summary: ${stored.summary}`);
        assert(same(stored.source, EXTENSION), `the source is unchanged: ${sourceText(stored.source)}`);
    });

    await test(`${who}: a webhook on a non-manual source is stored and cleared, as before`, async () => {
        const actor = cast[who];
        const id = await create(actor, { source: EXTENSION });
        const set = await put(actor, id, { webhookUrl: OFF_LIST });
        assert(set.status === 200 && (await read(actor, id)).webhookUrl === OFF_LIST,
            `set: ${set.status} ${JSON.stringify(set.body.error)}`);
        const cleared = await put(actor, id, { webhookUrl: null });
        assert(cleared.status === 200 && (await read(actor, id)).webhookUrl === null,
            `clear: ${cleared.status} ${JSON.stringify(cleared.body.error)}`);
    });
}

console.log('The source changes through the source object only');

for (const who of ['alice', 'agent'] as const) {
    await test(`${who}: sourceType, sourceRef and sourceVersion in the body do not change the stored source`, async () => {
        const actor = cast[who];
        const id = await create(actor, {});
        const res = await put(actor, id, { summary: 'flat keys', sourceType: 'extension', sourceRef: 'ext:..:memory', sourceVersion: '9.9.9' });
        const stored = await read(actor, id);
        assert(same(stored.source, MANUAL), `the stored source must stay ${sourceText(MANUAL)}, got ${sourceText(stored.source)} (PUT answered ${res.status})`);
        assert(res.status === 200, `the other field is taken: expected 200, got ${res.status} ${JSON.stringify(res.body.error)}`);
        assert(stored.summary === 'flat keys', `summary: ${stored.summary}`);
    });
}

await test('A source kind only the node writes cannot be set with sourceType', async () => {
    const id = await create(cast.alice, {});
    const res = await put(cast.alice, id, { sourceType: 'app-tool', sourceRef: `app-tool:updf-${suffix}:run` });
    const stored = await read(cast.alice, id);
    assert(same(stored.source, MANUAL), `the stored source must stay manual, got ${sourceText(stored.source)} (PUT answered ${res.status})`);
});

await test('A source kind only the node writes is refused in a source object: 400', async () => {
    const id = await create(cast.alice, {});
    const res = await put(cast.alice, id, { source: { type: 'app-tool', ref: `app-tool:updf-${suffix}:run`, version: '1.0.0' } });
    assert(res.status === 400 && res.body.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${res.status} ${res.body.error?.code}`);
    assert(same((await read(cast.alice, id)).source, MANUAL), 'the stored source stays manual');
});

console.log('The webhook policy reads the source the record will carry');

for (const who of ['alice', 'agent'] as const) {
    await test(`${who}: sourceType 'manual' in the body does not turn a record that holds a webhook into a manual one`, async () => {
        const actor = cast[who];
        // Allowed at create: a webhook on a non-manual source is never called.
        const id = await create(actor, { source: EXTENSION, webhookUrl: OFF_LIST });
        const res = await put(actor, id, { sourceType: 'manual', sourceRef: 'manual' });
        const stored = await read(actor, id);
        assert(stored.source.type === 'extension', `the stored source type must stay extension, got '${stored.source.type}' with webhook '${stored.webhookUrl}' (PUT answered ${res.status})`);
    });

    for (const [label, value] of [['null', null], ['a string', 'manual'], ['a number', 0]] as const) {
        await test(`${who}: a source that is ${label} on a record that holds a webhook is refused: 403 WEBHOOKS_DISABLED`, async () => {
            const actor = cast[who];
            const id = await create(actor, { source: EXTENSION, webhookUrl: OFF_LIST });
            const res = await put(actor, id, { source: value });
            const stored = await read(actor, id);
            assert(stored.source.type === 'extension', `the stored source type must stay extension, got '${stored.source.type}' with webhook '${stored.webhookUrl}' (PUT answered ${res.status})`);
            assert(res.status === 403 && res.body.error?.code === 'WEBHOOKS_DISABLED',
                `expected 403 WEBHOOKS_DISABLED, got ${res.status} ${res.body.error?.code}`);
        });
    }
}

console.log('Other keys');

await test('A key that is no field of a capability is dropped: 200, and the other fields are stored', async () => {
    const id = await create(cast.alice, {});
    const res = await put(cast.alice, id, { summary: 'with an unknown key', notACapabilityField: 1 });
    assert(res.status === 200, `expected 200, got ${res.status} ${JSON.stringify(res.body.error)}`);
    assert(!('notACapabilityField' in res.body.data), 'the answer is the stored record, without the unknown key');
    assert((await read(cast.alice, id)).summary === 'with an unknown key', 'the summary is stored');
});

await test('A second owner is refused with 403 whatever keys the body holds, and the record stays', async () => {
    const id = await create(cast.alice, {});
    for (const patch of [{ sourceType: 'extension', sourceRef: 'ext:..:memory' }, { source: EXTENSION }, { notACapabilityField: 1 }]) {
        const res = await put(cast.bob, id, patch);
        assert(res.status === 403 && res.body.error?.code === 'FORBIDDEN', `${JSON.stringify(patch)}: expected 403 FORBIDDEN, got ${res.status} ${res.body.error?.code}`);
    }
    assert(same((await read(cast.alice, id)).source, MANUAL), 'the stored source stays manual');
});

await test('Cleanup of phase 1', async () => {
    const left = await removeCast(cast, BASE);
    assert(left.length === 0, `accounts not deleted: ${left.join(', ')}`);
});

// ─── Phase 2: a node with an allowlist ───
// The webhook policy is read at start, so this needs a node of the suite's own. Its port is in the
// block of e2e-capability-webhook-update (every block of helpers/free-port.ts is taken): a lane runs
// one suite at a time, and both suites stop their node.
console.log('\nPhase 2: capabilityWebhooks=allowlist_only');

const ALT_PORT = String(suitePort(31100, BASE));
const ALT_BASE = `http://127.0.0.1:${ALT_PORT}`;
const ALT_DB = resolve(process.cwd(), `test/.updfields-allowlist-${ALT_PORT}.db`);
const ALLOWED = 'https://hooks.example.test/first';
const ALLOWED_OTHER = 'https://hooks.example.test/second';
let altNode: ChildProcess | null = null;
let alt!: Cast;

function cleanupAltDb() {
    for (const f of [ALT_DB, ALT_DB + '-wal', ALT_DB + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* a leftover file is not worth failing over */ }
    }
}

await test('Start a node with capabilityWebhooks=allowlist_only', async () => {
    cleanupAltDb();
    const db = await ownNodeDb(ALT_PORT, { sqlitePath: ALT_DB });
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], {
        env: {
            ...process.env,
            ...db.env,
            AIMEAT_PORT: ALT_PORT,
            AIMEAT_BASE_URL: ALT_BASE,
            AIMEAT_CAPABILITY_WEBHOOKS: 'allowlist_only',
            AIMEAT_CAPABILITY_WEBHOOK_DOMAIN_ALLOWLIST: 'hooks.example.test',
            AIMEAT_CAPABILITY_PUBLISHING: 'self_only',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
    });
    altNode = await waitForServer(child, ALT_BASE, { label: `the allowlist node on port ${ALT_PORT}` });
    alt = await makeCast(ALT_BASE, 'p2');
    const { body } = await json('/v1/capabilities', {}, ALT_BASE);
    assert(body.data?.policy?.webhooks === 'allowlist_only', `alt node policy: ${body.data?.policy?.webhooks}`);
});

for (const who of ['alice', 'agent'] as const) {
    await test(`${who}: sets a webhook on a listed domain, changes it to another listed address, and clears it`, async () => {
        const actor = alt[who];
        const id = await create(actor, {}, ALT_BASE);
        const set = await put(actor, id, { webhookUrl: ALLOWED }, ALT_BASE);
        assert(set.status === 200 && (await read(actor, id, ALT_BASE)).webhookUrl === ALLOWED,
            `set: ${set.status} ${JSON.stringify(set.body.error)}`);
        const changed = await put(actor, id, { webhookUrl: ALLOWED_OTHER }, ALT_BASE);
        assert(changed.status === 200 && (await read(actor, id, ALT_BASE)).webhookUrl === ALLOWED_OTHER,
            `change: ${changed.status} ${JSON.stringify(changed.body.error)}`);
        const cleared = await put(actor, id, { webhookUrl: null }, ALT_BASE);
        assert(cleared.status === 200 && (await read(actor, id, ALT_BASE)).webhookUrl === null,
            `clear: ${cleared.status} ${JSON.stringify(cleared.body.error)}`);
    });

    await test(`${who}: a record with a listed webhook changes its source to an extension and back to manual`, async () => {
        const actor = alt[who];
        const id = await create(actor, { webhookUrl: ALLOWED }, ALT_BASE);
        const out = await put(actor, id, { source: EXTENSION }, ALT_BASE);
        assert(out.status === 200 && same((await read(actor, id, ALT_BASE)).source, EXTENSION),
            `to extension: ${out.status} ${JSON.stringify(out.body.error)}`);
        const back = await put(actor, id, { source: MANUAL }, ALT_BASE);
        const stored = await read(actor, id, ALT_BASE);
        assert(back.status === 200 && same(stored.source, MANUAL) && stored.webhookUrl === ALLOWED,
            `back to manual: ${back.status} ${JSON.stringify(back.body.error)}`);
    });

    await test(`${who}: a webhook on a domain that is not listed is refused: 403 WEBHOOK_DOMAIN_NOT_ALLOWED`, async () => {
        const actor = alt[who];
        const id = await create(actor, {}, ALT_BASE);
        const res = await put(actor, id, { webhookUrl: OFF_LIST }, ALT_BASE);
        assert(res.status === 403 && res.body.error?.code === 'WEBHOOK_DOMAIN_NOT_ALLOWED',
            `expected 403 WEBHOOK_DOMAIN_NOT_ALLOWED, got ${res.status} ${res.body.error?.code}`);
        assert((await read(actor, id, ALT_BASE)).webhookUrl === null, 'nothing is stored');
    });

    await test(`${who}: a record that holds an unlisted webhook does not become manual with sourceType or a source that is no object`, async () => {
        const actor = alt[who];
        const id = await create(actor, { source: EXTENSION, webhookUrl: OFF_LIST }, ALT_BASE);
        const flat = await put(actor, id, { sourceType: 'manual', sourceRef: 'manual' }, ALT_BASE);
        let stored = await read(actor, id, ALT_BASE);
        assert(stored.source.type === 'extension', `after sourceType: the stored type must stay extension, got '${stored.source.type}' (PUT answered ${flat.status})`);
        const bare = await put(actor, id, { source: null }, ALT_BASE);
        stored = await read(actor, id, ALT_BASE);
        assert(stored.source.type === 'extension', `after source null: the stored type must stay extension, got '${stored.source.type}' (PUT answered ${bare.status})`);
        assert(bare.status === 403 && bare.body.error?.code === 'WEBHOOK_DOMAIN_NOT_ALLOWED',
            `source null: expected 403 WEBHOOK_DOMAIN_NOT_ALLOWED, got ${bare.status} ${bare.body.error?.code}`);
    });
}

await test('A webhookUrl that is not a string is refused at create and at update: 400 INVALID_INPUT', async () => {
    // The policy reads the URL and the record stores it, so both read one value: a string or none.
    const id = `updf-${suffix}-hooklist`;
    const made = await json('/v1/capabilities', {
        method: 'POST', headers: auth(alt.alice.token),
        body: JSON.stringify({ id, name: 'Hook list', summary: 'fixture', visibility: 'private', source: MANUAL, webhookUrl: [ALLOWED] }),
    }, ALT_BASE);
    assert(made.status === 400 && made.body.error?.code === 'INVALID_INPUT', `create: expected 400 INVALID_INPUT, got ${made.status} ${made.body.error?.code}`);
    const kept = await create(alt.alice, { webhookUrl: ALLOWED }, ALT_BASE);
    const res = await put(alt.alice, kept, { webhookUrl: [ALLOWED_OTHER] }, ALT_BASE);
    assert(res.status === 400 && res.body.error?.code === 'INVALID_INPUT', `update: expected 400 INVALID_INPUT, got ${res.status} ${res.body.error?.code}`);
    assert((await read(alt.alice, kept, ALT_BASE)).webhookUrl === ALLOWED, 'the stored webhook is unchanged');
});

await test('An empty webhookUrl clears the webhook and reads as null', async () => {
    const id = await create(alt.alice, { webhookUrl: ALLOWED }, ALT_BASE);
    const res = await put(alt.alice, id, { webhookUrl: '' }, ALT_BASE);
    assert(res.status === 200 && res.body.data.webhookUrl === null, `expected 200 and null, got ${res.status} ${JSON.stringify(res.body.data?.webhookUrl)}`);
    assert((await read(alt.alice, id, ALT_BASE)).webhookUrl === null, 'the stored webhook is null');
});

await test('Stop the allowlist node', async () => {
    assert(altNode !== null, 'the allowlist node was started');
    const left = await removeCast(alt, ALT_BASE);
    const ended = new Promise<void>(r => altNode!.once('exit', () => r()));
    altNode!.kill('SIGTERM');
    await Promise.race([ended, new Promise(r => setTimeout(r, 5000))]);
    if (!altNode!.killed) altNode!.kill('SIGKILL');
    cleanupAltDb();
    assert(left.length === 0, `accounts not deleted: ${left.join(', ')}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
