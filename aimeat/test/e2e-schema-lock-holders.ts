/**
 * @file e2e-schema-lock-holders.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who holds a schema lock, beyond the pattern rules of e2e-schema-lock-rule.ts
 *   (secaudit2026nov08 round 14). Four paths set or kept a lock for the wrong account:
 *     - a CSM's lock (`csm.<name>`) could be set by another account before the CSM was registered, and
 *       the registration then kept that account as the holder of the CSM's published schema;
 *     - a wildcard lock (`family.*.*`) passed rule 4 although it outranks another account's deeper
 *       plain prefix lock on every key that lock governs;
 *     - a package's cortex schema part was installed without the lock rule the schema route and the
 *       cortex activation ask (a node-wide pattern, another organism's records, a key another
 *       account's lock governs);
 *     - a lock an erased account or its agent held passed to the next account that registered the
 *       released name.
 *   Each section proves the refusal and, beside it, the use of the same path that keeps working.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=schema-lock-holders
 * @version-history
 *   2026-11-08 — Initial (secaudit2026nov08 round 14: lockSchema-keeps-foreign-lock-holder,
 *     rule4-literal-key-vs-wildcard-ranking, package-cortex-schema-lock-skips-schema-lock-rule,
 *     agent-gaii-lock-survives-account-erasure, older item O1).
 */
import { registerOwner, ownerToken } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const enc = encodeURIComponent;
const show = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data ?? r.body).slice(0, 300)}`;

const stamp = Date.now() % 1_000_000;
const SCHEMA = { type: 'object', properties: { title: { type: 'string' } } };
const lock = (token: string, key: string, applyTo: 'exact' | 'prefix', schema: unknown = SCHEMA) =>
    json(`/v1/memory/${enc(key)}/schema`, {
        method: 'PUT', headers: auth(token),
        body: JSON.stringify({ schema, apply_to: applyTo, schema_mode: 'strict' }),
    });
const unlock = (token: string, key: string, applyTo: 'exact' | 'prefix') =>
    json(`/v1/memory/${enc(key)}/schema?apply_to=${applyTo}`, { method: 'DELETE', headers: auth(token) });
const rowsOf = async (key: string) => {
    const r = await json(`/v1/schemas?prefix=${enc(key)}`);
    return (r.body.data?.schemas ?? []).filter((s: any) => s.key === key) as Array<{ key: string; apply_to: string; locked_by: string }>;
};
const writeMemory = (token: string, key: string, value: unknown) =>
    json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key, value, visibility: 'private' }) });

const CSM_YAML = (name: string, field = 'temperature') => `csm: "1.0"
service:
  name: ${name}
  type: data
  description: Rows a program sends
data_schema:
  required:
    ${field}: { type: number }
`;
const createCsm = (token: string, name: string, field?: string) =>
    fetch(`${BASE}/v1/csm`, { method: 'POST', headers: { 'Content-Type': 'text/yaml', ...auth(token) }, body: CSM_YAML(name, field) })
        .then(async r => ({ status: r.status, body: await r.json() as any }));

let op = { name: '', token: '' }, A = { name: '', token: '' }, B = { name: '', token: '' };

console.log('\n=== Schema lock holders E2E (secaudit2026nov08 round 14) ===\n');

await test('Setup: the operator (the first account), then two plain owners A and B', async () => {
    const o = await registerOwner(BASE, `slhop${stamp}`);
    const a = await registerOwner(BASE, `slha${stamp}`);
    const b = await registerOwner(BASE, `slhb${stamp}`);
    assert(o.roles.includes('operator'), 'the first account did not come out the operator, so the operator cases prove nothing');
    assert(!a.roles.includes('operator') && !b.roles.includes('operator'), 'A or B came out an operator');
    op = { name: o.name, token: o.token }; A = { name: a.name, token: a.token }; B = { name: b.name, token: b.token };
});

// ── A CSM's lock belongs to the account that registers the CSM ───────────────

console.log('\nA CSM\'s lock (csm.<name>) belongs to its registering account');

await test('attack: B is refused a lock on csm.<A>.<name> before A registers that CSM', async () => {
    const key = `csm.${A.name}.probe${stamp}`;
    const r = await lock(B.token, key, 'prefix');
    if (r.status === 200) await unlock(B.token, key, 'prefix');
    assert(r.status === 403 && r.body.error?.code === 'SCHEMA_PATTERN_NOT_YOURS', `B locks A's CSM key: ${show(r)}`);
    assert((await rowsOf(key)).length === 0, 'B\'s lock on A\'s CSM key was stored');
});

await test('attack: B is refused a lock over every CSM, or every CSM of A', async () => {
    for (const key of ['csm', 'csm.**', 'csm.*', `csm.${A.name}.**`, `csm.${A.name}`]) {
        const r = await lock(B.token, key, 'prefix');
        if (r.status === 200) await unlock(B.token, key, 'prefix');
        assert(r.status === 403, `${key}: ${show(r)}`);
    }
});

await test('attack: a lock another account set on csm.<A>.<name> before the CSM existed passes to A at registration', async () => {
    // The operator stands in for a lock set before this fix: nobody else may set one any more.
    const name = `held${stamp}`;
    const key = `csm.${A.name}.${name}`;
    const pre = await lock(op.token, key, 'prefix', { type: 'object' });
    assert(pre.status === 200, `the operator's lock: ${show(pre)}`);
    const made = await createCsm(A.token, name, 'humidity');
    assert(made.status === 201, `A registers the CSM: ${show(made)}`);
    const rows = await rowsOf(key);
    assert(rows.length === 1 && rows[0].locked_by === A.name, `the CSM's lock is held by ${JSON.stringify(rows)}, not ${A.name}`);
    const read = await json(`/v1/csm/${enc(`${A.name}.${name}`)}`, { headers: auth(A.token) });
    assert(read.status === 200 && read.body.data.csm.json_schema?.required?.includes('humidity'), `the CSM answers A's schema: ${show(read)}`);
    const own = await lock(A.token, key, 'prefix', read.body.data.csm.json_schema);
    assert(own.status === 200, `A changes the lock of A's own CSM: ${show(own)}`);
    await json(`/v1/csm/${enc(`${A.name}.${name}`)}`, { method: 'DELETE', headers: auth(A.token) });
});

await test('use: A registers and changes a CSM; A in person and A\'s agent lock keys of A\'s own CSMs', async () => {
    const made = await createCsm(A.token, `own${stamp}`);
    assert(made.status === 201, `create: ${show(made)}`);
    const name = made.body.data.csm.name as string;
    let rows = await rowsOf(`csm.${name}`);
    assert(rows.length === 1 && rows[0].locked_by === A.name, `lock: ${JSON.stringify(rows)}`);
    const put = await json(`/v1/csm/${enc(name)}`, { method: 'PUT', headers: { ...auth(A.token), 'Content-Type': 'application/json' }, body: JSON.stringify({ yaml: CSM_YAML(name, 'pressure'), expected_version: 1 }) });
    assert(put.status === 200 && put.body.data.csm.json_schema?.required?.includes('pressure'), `PUT: ${show(put)}`);
    rows = await rowsOf(`csm.${name}`);
    assert(rows.length === 1 && rows[0].locked_by === A.name, `lock after PUT: ${JSON.stringify(rows)}`);
    const sub = await lock(A.token, `csm.${name}.detail`, 'exact');
    assert(sub.status === 200, `A locks a key under A's own CSM: ${show(sub)}`);
    await unlock(A.token, `csm.${name}.detail`, 'exact');
    const agent = await makeAgent(BASE, A, ['memory:write'], `slhcsm${stamp}`);
    const future = await lock(agent.token, `csm.${A.name}.later${stamp}`, 'prefix');
    assert(future.status === 200, `A's agent locks a CSM name under A's prefix: ${show(future)}`);
    await unlock(agent.token, `csm.${A.name}.later${stamp}`, 'prefix');
    const del = await json(`/v1/csm/${enc(name)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(del.status === 200, `delete: ${show(del)}`);
});

// ── A wildcard lock does not outrank another account's deeper lock ──────────

console.log('\nRule 4: a wildcard pattern over another account\'s deeper lock');

const DEEP = `slhdeep${stamp}`;
await test('attack: B is refused a wildcard lock that outranks A\'s two-segment plain lock, and A\'s writes keep A\'s shape', async () => {
    const a = await lock(A.token, `${DEEP}.italian`, 'prefix', { type: 'object', properties: { dish: { type: 'string' } } });
    assert(a.status === 200, `A's lock: ${show(a)}`);
    for (const key of [`${DEEP}.*.*`, `${DEEP}.**`, `${DEEP}.*.x`]) {
        const r = await lock(B.token, key, 'prefix', { type: 'object', required: ['other'], properties: { other: { type: 'string' } } });
        if (r.status === 200) await unlock(B.token, key, 'prefix');
        assert(r.status === 403 && r.body.error?.code === 'SCHEMA_LOCKED_BY_OTHER', `${key}: ${show(r)}`);
    }
    const governing = await json(`/v1/memory/${enc(`${DEEP}.italian.x`)}/schema`);
    assert(governing.body.data?.locked_by === A.name, `the key is governed by ${governing.body.data?.locked_by}`);
    const w = await writeMemory(A.token, `${DEEP}.italian.x`, { dish: 'pasta' });
    assert(w.status === 200 || w.status === 201, `A's write under A's lock: ${show(w)}`);
});

await test('use: B locks its own family with a wildcard; A locks under A\'s own lock; the operator may override', async () => {
    const own = await lock(B.token, `slhbob${stamp}.*.*`, 'prefix');
    assert(own.status === 200, `B's own wildcard: ${show(own)}`);
    await unlock(B.token, `slhbob${stamp}.*.*`, 'prefix');
    const under = await lock(A.token, `${DEEP}.italian.*`, 'prefix');
    assert(under.status === 200, `A under A's lock: ${show(under)}`);
    await unlock(A.token, `${DEEP}.italian.*`, 'prefix');
    const opr = await lock(op.token, `${DEEP}.*.*`, 'prefix');
    assert(opr.status === 200, `the operator: ${show(opr)}`);
    await unlock(op.token, `${DEEP}.*.*`, 'prefix');
    await unlock(A.token, `${DEEP}.italian`, 'prefix');
});

// ── A package's cortex asks the lock rule ───────────────────────────────────

console.log('\nA package\'s cortex schema part asks the lock rule');

async function publish(token: string, name: string, components: unknown[], visibility = 'private'): Promise<string> {
    const r = await json('/v1/packages', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ name, description: `${name}, a lock holders fixture`, category: 'utility', visibility, components }),
    });
    assert(r.status === 201, `publish ${name}: ${show(r)}`);
    return r.body.data.packageGroupId as string;
}
const install = (token: string, groupId: string, extra: Record<string, unknown> = {}) => json(`/v1/packages/${enc(groupId)}/install`, {
    method: 'POST', headers: auth(token), body: JSON.stringify({ label: 'holders', ...extra }),
});
const uninstall = (token: string, id: string) =>
    json(`/v1/instances/${id}`, { method: 'DELETE', headers: auth(token), body: JSON.stringify({ removeComponents: true }) });
const cortexWithSchema = (name: string, keyPattern: string) => ({
    id: `cortex-${name}`, type: 'cortex', label: name, dependencies: [],
    content: JSON.stringify({
        manifest: `apiVersion: cortex.aimeat.org/v1\nkind: Extension\nmetadata:\n  name: ${name}\nspec:\n  version: "1.0.0"\n  components:\n    - type: schema\n      name: shape\n      key_pattern: "${keyPattern}"\n      apply_to: prefix\n      schema:\n        type: object\n        properties:\n          title: { type: string }\n`,
        libs: {},
    }),
});

let orgId = '';
await test('attack: B\'s package is refused a node-wide pattern, A\'s organism and a key A\'s lock governs; nothing is installed', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: `SLH Org ${stamp}`, description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `organism: ${show(o)}`);
    orgId = o.body.data.organism.id;
    const family = `slhfam${stamp}`;
    const a = await lock(A.token, family, 'prefix');
    assert(a.status === 200, `A's family lock: ${show(a)}`);
    const cases: Array<[string, string]> = [
        [`slhwide${stamp}*`, 'SCHEMA_PATTERN_NODE_WIDE'],
        [`organism.${orgId}.shared.slh`, 'SCHEMA_PATTERN_NOT_YOURS'],
        [`${family}.sub`, 'SCHEMA_LOCKED_BY_OTHER'],
    ];
    for (const [i, [pattern, code]] of cases.entries()) {
        const group = await publish(B.token, `slhpkg${i}x${stamp}`, [cortexWithSchema(`slhcx${i}x${stamp}`, pattern)]);
        const dry = await install(B.token, group, { dry_run: true });
        const real = await install(B.token, group);
        if (real.status === 201) await uninstall(B.token, real.body.data.id);
        assert(real.status === 403 && real.body.error?.code === code, `${pattern}: ${show(real)}`);
        assert(dry.status === 403 && dry.body.error?.code === code, `${pattern} dry run: ${show(dry)}`);
        assert((await rowsOf(pattern)).length === 0, `${pattern}: a lock was stored`);
    }
    await unlock(A.token, family, 'prefix');
});

await test('use: B\'s package locking B\'s own family installs; the operator\'s package with a node-wide pattern installs', async () => {
    const group = await publish(B.token, `slhpkgown${stamp}`, [cortexWithSchema(`slhcxown${stamp}`, `slhbown${stamp}:*`)]);
    const r = await install(B.token, group);
    assert(r.status === 201, `B's own: ${show(r)}`);
    assert((await rowsOf(`slhbown${stamp}:*`)).length === 1, 'B\'s package set its lock');
    await uninstall(B.token, r.body.data.id);
    const og = await publish(op.token, `slhpkgop${stamp}`, [cortexWithSchema(`slhcxop${stamp}`, `slhopwide${stamp}*`)]);
    const or = await install(op.token, og);
    assert(or.status === 201, `the operator's: ${show(or)}`);
    await uninstall(op.token, or.body.data.id);
});

// ── A lock does not pass to the next holder of an erased account's name ─────

console.log('\nAn erased account\'s locks do not pass to the next holder of the name');

const C_NAME = `slhc${stamp}`;
const C_OWN = `slhcown${stamp}`;
const C_AGENT_KEY = `slhcag${stamp}`;
const C_AGENT = `slhcbot${stamp}`;
await test('attack: C and C\'s agent hold locks; C is erased; the next account named C and its same-named agent hold neither', async () => {
    const c = await registerOwner(BASE, C_NAME);
    const mine = await lock(c.token, C_OWN, 'prefix');
    assert(mine.status === 200, `C's lock: ${show(mine)}`);
    const bot = await makeAgent(BASE, { name: c.name, token: c.token }, ['memory:write'], C_AGENT);
    const botLock = await lock(bot.token, C_AGENT_KEY, 'prefix');
    assert(botLock.status === 200, `C's agent's lock: ${show(botLock)}`);
    const del = await json(`/v1/owners/${c.name}`, { method: 'DELETE', headers: auth(c.token) });
    assert(del.status === 200, `erase C: ${show(del)}`);

    const again = await registerOwner(BASE, C_NAME);
    const bot2 = await makeAgent(BASE, { name: again.name, token: again.token }, ['memory:write'], C_AGENT);
    assert(bot2.gaii === bot.gaii, `the new agent has another GAII (${bot2.gaii} vs ${bot.gaii}), so the case proves nothing`);
    const results = [
        ['new C removes C\'s lock', await unlock(again.token, C_OWN, 'prefix')],
        ['new C removes C\'s agent\'s lock', await unlock(again.token, C_AGENT_KEY, 'prefix')],
        ['new C changes C\'s lock', await lock(again.token, C_OWN, 'prefix', {})],
        ['the same-named new agent changes the old agent\'s lock', await lock(bot2.token, C_AGENT_KEY, 'prefix', {})],
        ['the same-named new agent removes it', await unlock(bot2.token, C_AGENT_KEY, 'prefix')],
    ] as const;
    for (const [what, r] of results) assert(r.status === 403, `${what}: ${show(r)}`);
    for (const key of [C_OWN, C_AGENT_KEY]) {
        const rows = await rowsOf(key);
        assert(rows.length === 1, `${key} is gone: ${JSON.stringify(rows)}`);
        assert(!rows[0].locked_by.includes(C_NAME), `${key} still names ${C_NAME}: ${rows[0].locked_by}`);
    }
    await json(`/v1/owners/${again.name}`, { method: 'DELETE', headers: auth(again.token) });
});

await test('use: the erased account\'s locks still govern, and the operator still removes them', async () => {
    const before = await json(`/v1/memory/${enc(`${C_OWN}.x`)}/schema`);
    assert(before.body.data?.has_schema === true, `the lock no longer governs: ${show(before)}`);
    for (const key of [C_OWN, C_AGENT_KEY]) {
        const r = await unlock(op.token, key, 'prefix');
        assert(r.status === 200, `the operator removes ${key}: ${show(r)}`);
    }
});

await test('use: a live owner and the owner\'s agent keep their own locks through another account\'s erasure', async () => {
    const d = await registerOwner(BASE, `slhd${stamp}`);
    const own = await lock(A.token, `slhalive${stamp}`, 'prefix');
    assert(own.status === 200, `A's lock: ${show(own)}`);
    await json(`/v1/owners/${d.name}`, { method: 'DELETE', headers: auth(d.token) });
    const fresh = await ownerToken(BASE, A.name);
    const r = await lock(fresh, `slhalive${stamp}`, 'prefix', {});
    assert(r.status === 200, `A changes A's lock: ${show(r)}`);
    const del = await unlock(fresh, `slhalive${stamp}`, 'prefix');
    assert(del.status === 200, `A removes A's lock: ${show(del)}`);
});

console.log('\nCleanup');
if (orgId) await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: auth(A.token) });

console.log(`\n${'─'.repeat(48)}`);
console.log(`Schema lock holders: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
