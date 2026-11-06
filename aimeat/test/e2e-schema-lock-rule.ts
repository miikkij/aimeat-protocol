/**
 * @file e2e-schema-lock-rule.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may set a schema lock on which key pattern, and what a delete or a cortex
 *   deactivation may remove (services/schema-lock-rule.ts; QA audit 2026-10-16, S2-04, F05a-01, S7-01).
 *
 *   A lock is found by its key pattern alone and governs every account's writes to a matching key.
 *   Before the rule, any account holder could lock every key on the node with `**`, lock another
 *   organism's records, put an exact lock beside another account's prefix lock and remove both with
 *   one DELETE, and a directly installed cortex replaced another account's lock on activation and
 *   deleted it on deactivation. Three plain owners and the operator (the first account on the node):
 *     - PUT refuses a node-wide pattern and another organism's namespace, and admits the operator;
 *     - PUT refuses a lock beside or under another account's lock;
 *     - DELETE removes one row, (key, apply_to), and leaves the row beside it;
 *     - a cortex whose schema names another account's lock is refused at activation and the lock is
 *       unchanged; a deactivation removes only the row its own account holds;
 *     - GET /v1/schemas shows each lock's pattern and holder and no schema body, without a credential.
 * @version-history
 *   2026-11-06 — PUT and DELETE ask one rule (decision 13a of 2026-11-05, verb parity): the owner's
 *     agent holding memory:write sets and removes its own lock, the owner removes a lock their agent
 *     holds, and an agent without the word and an app are refused both verbs.
 *   2026-10-16 — Initial (QA audit S2-04, F05a-01, S7-01).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';
import { appGrantToken } from './helpers/purpose-kit.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const stamp = Date.now() % 1_000_000;
const SCHEMA = { type: 'object', properties: { title: { type: 'string' } } };
const lock = (token: string, key: string, applyTo: 'exact' | 'prefix', schema: unknown = SCHEMA) =>
    json(`/v1/memory/${encodeURIComponent(key)}/schema`, {
        method: 'PUT', headers: auth(token),
        body: JSON.stringify({ schema, apply_to: applyTo, schema_mode: 'strict' }),
    });
const rowsOf = async (key: string) => {
    const r = await json(`/v1/schemas?prefix=${encodeURIComponent(key)}`);
    return (r.body.data?.schemas ?? []).filter((s: any) => s.key === key) as Array<{ key: string; apply_to: string; locked_by: string }>;
};

let opToken = '', aToken = '', bToken = '', aName = '', bName = '';

console.log('\n=== Schema lock rule E2E (S2-04, F05a-01, S7-01) ===\n');

await test('Setup: the operator, then two plain owners A and B', async () => {
    const op = await registerOwner(BASE, `slrop${stamp}`);
    opToken = op.token;
    const a = await registerOwner(BASE, `slra${stamp}`);
    const b = await registerOwner(BASE, `slrb${stamp}`);
    assert(!a.roles.includes('operator') && !b.roles.includes('operator'), 'A or B came out an operator, so nothing below proves anything');
    aToken = a.token; bToken = b.token; aName = a.name; bName = b.name;
    // The runner empties the database before each suite, so the first account is the operator.
    assert(op.roles.includes('operator'), 'the first account did not come out the operator, so the operator cases prove nothing');
});

console.log('\nWho may lock which pattern');

await test('a plain owner is refused a pattern that starts with a wildcard (the whole node)', async () => {
    for (const key of ['**', `**.slr${stamp}`, '*']) {
        const r = await lock(aToken, key, 'prefix');
        assert(r.status === 403 && r.body.error?.code === 'SCHEMA_PATTERN_NODE_WIDE', `${key}: ${r.status} ${JSON.stringify(r.body.error)}`);
    }
    assert((await rowsOf('**')).length === 0, 'a ** lock was stored');
});

await test('a plain owner is refused a trailing-star pattern that is not a "name:" key family', async () => {
    const r = await lock(aToken, 's*', 'prefix');
    assert(r.status === 403 && r.body.error?.code === 'SCHEMA_PATTERN_NODE_WIDE', `s*: ${r.status} ${JSON.stringify(r.body.error)}`);
    const ok = await lock(aToken, `slrfam${stamp}:*`, 'prefix');
    assert(ok.status === 200, `a key family of its own: ${ok.status} ${JSON.stringify(ok.body.error)}`);
});

await test('the operator may set a node-wide pattern (and removes it again)', async () => {
    const key = `**.slrop${stamp}.a.b.c.d.e.f.g.h`;
    const r = await lock(opToken, key, 'prefix');
    assert(r.status === 200, `operator: ${r.status} ${JSON.stringify(r.body.error)}`);
    const del = await json(`/v1/memory/${encodeURIComponent(key)}/schema?apply_to=prefix`, { method: 'DELETE', headers: auth(opToken) });
    assert(del.status === 200, `operator delete: ${del.status} ${JSON.stringify(del.body.error)}`);
});

let orgId = '';
await test('another organism\'s namespace is refused; its creator may lock it', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(aToken), body: JSON.stringify({ name: `SLR Org ${stamp}`, description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body.error)}`);
    orgId = o.body.data.organism.id;
    const key = `organism.${orgId}.shared.slr`;
    const refused = await lock(bToken, key, 'prefix');
    assert(refused.status === 403 && refused.body.error?.code === 'SCHEMA_PATTERN_NOT_YOURS', `B on A's organism: ${refused.status} ${JSON.stringify(refused.body.error)}`);
    const wild = await lock(bToken, 'organism.*.shared.slr', 'prefix');
    assert(wild.status === 403 && wild.body.error?.code === 'SCHEMA_PATTERN_NODE_WIDE', `B on every organism: ${wild.status} ${JSON.stringify(wild.body.error)}`);
    const ok = await lock(aToken, key, 'prefix');
    assert(ok.status === 200, `A on its own organism: ${ok.status} ${JSON.stringify(ok.body.error)}`);
});

console.log('\nA lock beside or under another account\'s lock');

const FAMILY = `slrnotes${stamp}`;
await test('B holds a prefix lock; A is refused an exact lock beside it and a longer lock under it', async () => {
    const b = await lock(bToken, FAMILY, 'prefix');
    assert(b.status === 200, `B prefix: ${b.status} ${JSON.stringify(b.body.error)}`);
    const beside = await lock(aToken, FAMILY, 'exact', { type: 'string' });
    assert(beside.status === 403 && beside.body.error?.code === 'SCHEMA_LOCKED_BY_OTHER', `beside: ${beside.status} ${JSON.stringify(beside.body.error)}`);
    const under = await lock(aToken, `${FAMILY}.mine`, 'prefix', {});
    assert(under.status === 403 && under.body.error?.code === 'SCHEMA_LOCKED_BY_OTHER', `under: ${under.status} ${JSON.stringify(under.body.error)}`);
    const rows = await rowsOf(FAMILY);
    assert(rows.length === 1 && rows[0].apply_to === 'prefix', `rows: ${JSON.stringify(rows)}`);
});

await test('B may add its own exact lock beside its own prefix lock', async () => {
    const r = await lock(bToken, FAMILY, 'exact', { type: 'object' });
    assert(r.status === 200, `own exact: ${r.status} ${JSON.stringify(r.body.error)}`);
});

console.log('\nDELETE removes one row');

await test('DELETE ?apply_to=exact removes the exact row and leaves the prefix row', async () => {
    const del = await json(`/v1/memory/${encodeURIComponent(FAMILY)}/schema?apply_to=exact`, { method: 'DELETE', headers: auth(bToken) });
    assert(del.status === 200 && del.body.data?.apply_to === 'exact', `delete: ${del.status} ${JSON.stringify(del.body)}`);
    const rows = await rowsOf(FAMILY);
    assert(rows.length === 1 && rows[0].apply_to === 'prefix', `left: ${JSON.stringify(rows)}`);
});

await test('B\'s delete removes only B\'s row; the operator\'s exact lock beside it stays', async () => {
    const op = await lock(opToken, FAMILY, 'exact', { type: 'object' });
    assert(op.status === 200, `operator exact: ${op.status} ${JSON.stringify(op.body.error)}`);
    // Without ?apply_to= the exact row is the one asked for, and it is not B's: refused, nothing removed.
    const refused = await json(`/v1/memory/${encodeURIComponent(FAMILY)}/schema`, { method: 'DELETE', headers: auth(bToken) });
    assert(refused.status === 403 && refused.body.error?.code === 'NOT_SCHEMA_OWNER', `B on the operator's row: ${refused.status} ${JSON.stringify(refused.body.error)}`);
    const own = await json(`/v1/memory/${encodeURIComponent(FAMILY)}/schema?apply_to=prefix`, { method: 'DELETE', headers: auth(bToken) });
    assert(own.status === 200, `B's own prefix row: ${own.status} ${JSON.stringify(own.body.error)}`);
    const rows = await rowsOf(FAMILY);
    assert(rows.length === 1 && rows[0].apply_to === 'exact', `the operator's row was removed with B's: ${JSON.stringify(rows)}`);
    await json(`/v1/memory/${encodeURIComponent(FAMILY)}/schema?apply_to=exact`, { method: 'DELETE', headers: auth(opToken) });
});

await test('a bad apply_to on DELETE is refused', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(FAMILY)}/schema?apply_to=both`, { method: 'DELETE', headers: auth(bToken) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

console.log('\nA cortex activation asks the same rule (S7-01)');

const cortexManifest = (name: string, namespace: string, key: string, applyTo: 'exact' | 'prefix') => [
    'apiVersion: cortex.aimeat.org/v1', 'kind: Extension', 'metadata:', `  name: ${name}`, `  namespace: ${namespace}`,
    'spec:', '  version: "1.0.0"', '  description: "Schema lock rule fixture"', '  components:',
    '    - type: schema', '      name: shape', `      key_pattern: "${key}"`, `      apply_to: ${applyTo}`,
    '      schema:', '        type: object', '        properties:', '          title:', '            type: string',
].join('\n') + '\n';

const A_LOCKED = `slralock${stamp}`;
const cortexB = `slr-b-${stamp}`;
await test('B\'s cortex naming A\'s locked pattern is refused at activation, and A\'s lock is unchanged', async () => {
    const a = await lock(aToken, A_LOCKED, 'prefix');
    assert(a.status === 200, `A lock: ${a.status} ${JSON.stringify(a.body.error)}`);
    const inst = await json('/v1/cortex', { method: 'POST', headers: auth(bToken), body: JSON.stringify({ manifest: cortexManifest(cortexB, bName, A_LOCKED, 'prefix') }) });
    assert(inst.status === 201, `install: ${inst.status} ${JSON.stringify(inst.body.error)}`);
    const act = await json(`/v1/cortex/${encodeURIComponent(cortexB)}/activate`, { method: 'POST', headers: auth(bToken) });
    assert(act.status === 403 && act.body.error?.code === 'SCHEMA_LOCKED_BY_OTHER', `activate: ${act.status} ${JSON.stringify(act.body.error)}`);
    const rows = await rowsOf(A_LOCKED);
    assert(rows.length === 1 && rows[0].locked_by === aName, `A's lock changed: ${JSON.stringify(rows)}`);
    await json(`/v1/cortex/${encodeURIComponent(cortexB)}`, { method: 'DELETE', headers: auth(bToken) });
});

await test('a cortex with a node-wide pattern is refused at activation', async () => {
    const name = `slr-wide-${stamp}`;
    const inst = await json('/v1/cortex', { method: 'POST', headers: auth(bToken), body: JSON.stringify({ manifest: cortexManifest(name, bName, '**', 'prefix') }) });
    assert(inst.status === 201, `install: ${inst.status} ${JSON.stringify(inst.body.error)}`);
    const act = await json(`/v1/cortex/${encodeURIComponent(name)}/activate`, { method: 'POST', headers: auth(bToken) });
    assert(act.status === 403 && act.body.error?.code === 'SCHEMA_PATTERN_NODE_WIDE', `activate: ${act.status} ${JSON.stringify(act.body.error)}`);
    assert((await rowsOf('**')).length === 0, 'a ** lock was stored');
    await json(`/v1/cortex/${encodeURIComponent(name)}`, { method: 'DELETE', headers: auth(bToken) });
});

await test('B\'s own cortex activates; its deactivation removes its row and leaves the operator\'s row beside it', async () => {
    const key = `slrbown${stamp}`;
    const name = `slr-own-${stamp}`;
    const inst = await json('/v1/cortex', { method: 'POST', headers: auth(bToken), body: JSON.stringify({ manifest: cortexManifest(name, bName, key, 'prefix') }) });
    assert(inst.status === 201, `install: ${inst.status} ${JSON.stringify(inst.body.error)}`);
    const act = await json(`/v1/cortex/${encodeURIComponent(name)}/activate`, { method: 'POST', headers: auth(bToken) });
    assert(act.status === 200, `activate: ${act.status} ${JSON.stringify(act.body.error)}`);
    const op = await lock(opToken, key, 'exact', { type: 'object' });
    assert(op.status === 200, `operator exact beside B's cortex lock: ${op.status} ${JSON.stringify(op.body.error)}`);
    const off = await json(`/v1/cortex/${encodeURIComponent(name)}/deactivate`, { method: 'POST', headers: auth(bToken) });
    assert(off.status === 200, `deactivate: ${off.status} ${JSON.stringify(off.body.error)}`);
    const rows = await rowsOf(key);
    assert(!rows.some(r => r.apply_to === 'prefix'), `B's cortex lock survived its deactivation: ${JSON.stringify(rows)}`);
    assert(rows.some(r => r.apply_to === 'exact'), `the operator's exact lock went with B's deactivation: ${JSON.stringify(rows)}`);
    await json(`/v1/memory/${encodeURIComponent(key)}/schema?apply_to=exact`, { method: 'DELETE', headers: auth(opToken) });
    await json(`/v1/cortex/${encodeURIComponent(name)}`, { method: 'DELETE', headers: auth(bToken) });
});

console.log('\nWho may set and remove a lock: one rule on PUT and DELETE (decision 13a of 2026-11-05)');

// PUT admitted the owner role and the operator, DELETE any principal holding memory:write. One rule
// now holds on both verbs: the owner in person, the owner's agent holding memory:write, and the
// operator; an app grant or an ecosystem app only for a lock it holds itself; never a visitor.
const AG_KEY = `slrag${stamp}.rec`;
const OWNED_KEY = `slrown${stamp}.rec`;

await test('the owner\'s agent holding memory:write sets, changes and removes a lock of its own', async () => {
    const agent = await makeAgent(BASE, { name: aName, token: aToken }, ['memory:write'], `slrag${stamp}`);
    const set = await lock(agent.token, AG_KEY, 'exact');
    assert(set.status === 200 && set.body.data.locked_by === agent.gaii, `the agent's lock: ${set.status} ${JSON.stringify(set.body.error ?? set.body.data)}`);
    const again = await lock(agent.token, AG_KEY, 'exact', { type: 'object', properties: { title: { type: 'string' }, n: { type: 'number' } } });
    assert(again.status === 200, `the agent changes its own lock: ${again.status} ${JSON.stringify(again.body.error)}`);
    const del = await json(`/v1/memory/${encodeURIComponent(AG_KEY)}/schema?apply_to=exact`, { method: 'DELETE', headers: auth(agent.token) });
    assert(del.status === 200, `the agent removes its own lock: ${del.status} ${JSON.stringify(del.body.error)}`);
    assert((await rowsOf(AG_KEY)).length === 0, 'the agent\'s lock is still listed');
});

await test('the owner in person changes and removes a lock one of their agents holds; another owner may not', async () => {
    const agent = await makeAgent(BASE, { name: aName, token: aToken }, ['memory:write'], `slrag2${stamp}`);
    const set = await lock(agent.token, AG_KEY, 'exact');
    assert(set.status === 200, `the agent's lock: ${set.status} ${JSON.stringify(set.body.error)}`);
    const stranger = await json(`/v1/memory/${encodeURIComponent(AG_KEY)}/schema?apply_to=exact`, { method: 'DELETE', headers: auth(bToken) });
    assert(stranger.status === 403, `another owner removed A's agent's lock: ${stranger.status}`);
    const changed = await lock(aToken, AG_KEY, 'exact');
    assert(changed.status === 200, `the owner changes their agent's lock: ${changed.status} ${JSON.stringify(changed.body.error)}`);
    const del = await json(`/v1/memory/${encodeURIComponent(AG_KEY)}/schema?apply_to=exact`, { method: 'DELETE', headers: auth(aToken) });
    assert(del.status === 200, `the owner removes the lock: ${del.status} ${JSON.stringify(del.body.error)}`);
});

await test('an agent without memory:write is refused both verbs, and the owner\'s lock stays', async () => {
    const own = await lock(aToken, OWNED_KEY, 'exact');
    assert(own.status === 200, `the owner's lock: ${own.status} ${JSON.stringify(own.body.error)}`);
    const agent = await makeAgent(BASE, { name: aName, token: aToken }, ['memory:read'], `slrro${stamp}`);
    const set = await lock(agent.token, `slrro${stamp}.rec`, 'exact');
    assert(set.status === 403, `an agent without memory:write set a lock: ${set.status}`);
    const del = await json(`/v1/memory/${encodeURIComponent(OWNED_KEY)}/schema?apply_to=exact`, { method: 'DELETE', headers: auth(agent.token) });
    assert(del.status === 403, `an agent without memory:write removed a lock: ${del.status}`);
    assert((await rowsOf(OWNED_KEY)).length === 1, 'the owner\'s lock is gone');
});

await test('an app holding memory:write is refused a lock of its own making and the owner\'s lock', async () => {
    const html = '<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="memory:write"></head><body>slr</body></html>';
    const app = await appGrantToken({ name: aName, token: aToken }, `slr${stamp}.html`, 'memory:write', html, BASE);
    const set = await lock(app, `slrapp${stamp}.rec`, 'exact');
    assert(set.status === 403, `an app set a lock: ${set.status} ${JSON.stringify(set.body.error ?? set.body.data)}`);
    const change = await lock(app, OWNED_KEY, 'exact');
    assert(change.status === 403, `an app changed the owner's lock: ${change.status}`);
    const del = await json(`/v1/memory/${encodeURIComponent(OWNED_KEY)}/schema?apply_to=exact`, { method: 'DELETE', headers: auth(app) });
    assert(del.status === 403, `an app removed the owner's lock: ${del.status}`);
    assert((await rowsOf(OWNED_KEY)).length === 1, 'the owner\'s lock is gone');
    await json(`/v1/memory/${encodeURIComponent(OWNED_KEY)}/schema?apply_to=exact`, { method: 'DELETE', headers: auth(aToken) });
});

console.log('\nWhat the public list shows');

await test('GET /v1/schemas without a credential lists pattern, apply_to, mode and holder, and no schema body', async () => {
    const r = await json(`/v1/schemas?prefix=${encodeURIComponent(A_LOCKED)}`);
    assert(r.status === 200, `list: ${r.status}`);
    const row = (r.body.data.schemas as any[]).find(s => s.key === A_LOCKED);
    assert(!!row, 'A\'s lock is listed');
    assert(JSON.stringify(Object.keys(row).sort()) === JSON.stringify(['apply_to', 'has_semantic', 'key', 'locked_by', 'schema_mode', 'set_at']),
        `fields: ${Object.keys(row).join(', ')}`);
    assert(!('schema' in row), 'the list carries the schema body');
});

console.log('\nCleanup');
await json(`/v1/memory/${encodeURIComponent(A_LOCKED)}/schema?apply_to=prefix`, { method: 'DELETE', headers: auth(aToken) });
await json(`/v1/memory/${encodeURIComponent(`slrfam${stamp}:*`)}/schema?apply_to=prefix`, { method: 'DELETE', headers: auth(aToken) });
if (orgId) await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.shared.slr`)}/schema?apply_to=prefix`, { method: 'DELETE', headers: auth(aToken) });

console.log(`\n${'─'.repeat(48)}`);
console.log(`Schema lock rule: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
