/**
 * @file e2e-csm-ownership.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for who controls a CSM and who reads what it leaves in the schema-lock table
 *   (secaudit2026nov08 round 14). Owners A, B and C, an operator, and callers with no sign-in.
 *   1 Ruling 2 of 2026-11-08: A deletes a public CSM only B's receiver uses; B's receiver keeps
 *     checking messages against its copy, and B gets a csm_removed notice. A's own receiver still
 *     blocks the delete (409 IN_USE), for A and for the operator, and the refusal names no other
 *     account's receiver. The operator deletes a CSM only another account uses.
 *   2 A package's CSM component takes the installer's prefix and the node's csm.default_visibility.
 *   3 After C is erased and the name C is registered again, the new account neither reads C's private
 *     CSM nor changes, re-scopes or deletes C's public one; everyone else keeps using it.
 *   4 The schema-lock row a private CSM owns is not listed on GET /v1/schemas, not answered on
 *     GET /v1/memory/{key}/schema, and the CSM is not in the federation cross-catalogue, for a caller
 *     the CSM refuses; its owner, a public CSM and a plain lock answer as before.
 *   5 A memory write under a private CSM's key by an account the CSM refuses answers as under a CSM
 *     that does not exist: no lock named, no field listed, and the lock-route refusal gives the same
 *     reason. The owner, any account under a public CSM and an organism member under its CSM still get
 *     the full refusal (round 15).
 *   6 The next account of an erased installer's name is refused a lock on the installer's package CSM,
 *     which has no lock row; an account never erased sets, changes and removes its own CSM's lock, and a
 *     package with a CSM and a cortex schema part on its key installs (round 15).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=csm-ownership
 * @version-history
 *   2026-11-08 — Sections 5 and 6 (secaudit2026nov08b round 15: memory-write-violations-describe-unreadable-csm-lock,
 *     csm-family-decided-by-name-not-registering-account).
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14: in-use-counts-other-accounts-receivers,
 *     csm-component-name-skips-owner-prefix, registeredBy-bare-name-survives-account-erasure,
 *     schema-lock-table-public-read).
 */
import { registerOwner, setupOperator, ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: {
            ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 400)}`;
const codeOf = (r: Answer) => r.body?.error?.code;
const stamp = Date.now() % 10_000_000;
const enc = encodeURIComponent;

const YAML = (name: string) => `csm: "1.0"
service:
  name: ${name}
  type: data
  description: Sensor rows sent by a program
data_schema:
  required:
    temperature: { type: number }
`;

console.log('\n=== AIMEAT CSM ownership E2E ===\n');
let A = { name: '', token: '' }, B = { name: '', token: '' }, OP = { name: '', token: '' };

/** Register a CSM as `token`; asserts 201 and answers the final name. */
async function csm(token: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
    const r = await call('/v1/csm', { token, body: { yaml: YAML(name), ...extra } });
    assert(r.status === 201, `CSM ${name}: ${show(r)}`);
    return r.body.data.csm.name as string;
}
/** Make a receiver on a CSM as `token`; asserts 201 and answers its key. */
async function receiver(token: string, name: string, csmName: string): Promise<string> {
    const r = await call('/v1/receivers', { token, body: { name, target: { key: `rcv.${name}` }, csm: csmName } });
    assert(r.status === 201, `receiver ${name}: ${show(r)}`);
    return r.body.data.key as string;
}
async function notices(token: string): Promise<string> {
    const r = await call('/v1/notifications?limit=200', { token });
    assert(r.status === 200, `notifications: ${show(r)}`);
    return JSON.stringify(r.body.data);
}

await test('Setup: owners A and B, an operator', async () => {
    const a = await registerOwner(BASE, `cowa${stamp}`);
    const b = await registerOwner(BASE, `cowb${stamp}`);
    const op = await setupOperator(BASE, ADMIN_PW, `cowop${stamp}`);
    A = { name: a.name, token: a.token }; B = { name: b.name, token: b.token }; OP = { name: op.name, token: op.token };
});

// ── 1 Ruling 2: whose use blocks a delete ─────────────────────────────────────

await test('1a A deletes a CSM only B\'s receiver uses; the answer names nobody, B is told, B\'s receiver goes on', async () => {
    const name = await csm(A.token, 'shared');
    const key = await receiver(B.token, `sh${stamp}`, name);
    const del = await call(`/v1/csm/${enc(name)}`, { token: A.token, method: 'DELETE' });
    assert(del.status === 200, `A's delete: ${show(del)}`);
    assert(!del.text.includes(B.name), `the answer names B: ${show(del)}`);
    assert(del.body.data.other_accounts_told === 1, `one other account told: ${show(del)}`);
    assert((await call(`/v1/csm/${enc(name)}`, { token: A.token })).status === 404, 'the CSM is gone');
    const ok = await call(`/v1/receive/${B.name}/sh${stamp}`, { token: key, body: { temperature: 21.5 } });
    assert(ok.status === 201 || ok.status === 200, `B's receiver takes a valid message: ${show(ok)}`);
    const bad = await call(`/v1/receive/${B.name}/sh${stamp}`, { token: key, body: { temperature: 'warm' } });
    assert(bad.status === 422, `B's receiver still checks the shape: ${show(bad)}`);
    const told = await notices(B.token);
    assert(told.includes('csm_removed') && told.includes(name), `B was told: ${told.slice(0, 400)}`);
});

await test('1b A\'s own receiver still blocks A and the operator; the refusal names only A\'s receiver', async () => {
    const name = await csm(A.token, 'both');
    await receiver(A.token, `own${stamp}`, name);
    await receiver(B.token, `oth${stamp}`, name);
    const refused = await call(`/v1/csm/${enc(name)}`, { token: A.token, method: 'DELETE' });
    assert(refused.status === 409 && codeOf(refused) === 'IN_USE', `A's delete: ${show(refused)}`);
    assert(refused.text.includes(`${A.name}/own${stamp}`), `the refusal names A's receiver: ${show(refused)}`);
    assert(!refused.text.includes(B.name), `the refusal names B's receiver: ${show(refused)}`);
    const op = await call(`/v1/admin/csm/${enc(name)}`, { token: OP.token, method: 'DELETE' });
    assert(op.status === 409 && codeOf(op) === 'IN_USE', `the operator's delete: ${show(op)}`);
    assert(!op.text.includes(B.name), `the operator's refusal names B's receiver: ${show(op)}`);
    assert((await call(`/v1/csm/${enc(name)}`, { token: A.token })).status === 200, 'the CSM is still there');
});

await test('1c The operator deletes a CSM only another account uses', async () => {
    const name = await csm(A.token, 'opdel');
    await receiver(B.token, `op${stamp}`, name);
    const op = await call(`/v1/admin/csm/${enc(name)}`, { token: OP.token, method: 'DELETE' });
    assert(op.status === 200, `the operator's delete: ${show(op)}`);
    assert((await call(`/v1/csm/${enc(name)}`, { token: A.token })).status === 404, 'the CSM is gone');
});

// ── 2 A package's CSM component ───────────────────────────────────────────────

await test('2 A package named with A\'s prefix installs its CSM under B\'s prefix, with the node default visibility', async () => {
    const set = (value: string) => call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes: [{ path: 'csm.default_visibility', value }] } });
    const before = await call('/v1/admin/config', { token: OP.token });
    const was = before.body.data?.config?.csm?.default_visibility ?? 'public';
    const s = await set('members');
    assert(s.status === 200 && !(s.body.data?.errors ?? []).length, `csm.default_visibility members: ${show(s)}`);
    try {
        const pkgName = `${A.name}.weather${stamp}`;
        const made = await call('/v1/packages', { token: B.token, body: { name: pkgName, components: [{ id: 'csm-main', type: 'csm', label: 'Main', content: YAML('weather') }] } });
        assert(made.status === 201, `package: ${show(made)}`);
        const inst = await call(`/v1/packages/${enc(`${pkgName}::${B.name}`)}/install`, { token: B.token, body: {} });
        assert(inst.status === 201, `install: ${show(inst)}`);
        const comp = (inst.body.data.installedComponents as Array<{ componentId: string; registeredAs: string }>).find(c => c.componentId === 'csm-main');
        assert(comp, `the CSM component: ${show(inst)}`);
        assert(comp.registeredAs.startsWith(`${B.name}.`), `the name starts with the installer's prefix: ${comp.registeredAs}`);
        const own = await call(`/v1/csm/${enc(comp.registeredAs)}`, { token: B.token });
        assert(own.status === 200 && own.body.data.csm.registered_by === B.name, `the installer reads it: ${show(own)}`);
        assert(own.body.data.csm.visibility === 'members', `the node default applies: ${show(own)}`);
        assert((await call(`/v1/csm/${enc(comp.registeredAs)}`)).status === 404, 'a caller with no sign-in does not read a members CSM');
        assert((await call(`/v1/csm/${enc(comp.registeredAs)}`, { token: A.token })).status === 200, 'another account reads a members CSM');
    } finally {
        await set(was);
    }
});

// ── 3 The next account of an erased name ──────────────────────────────────────

await test('3 After C is erased and the name taken again, the new account has none of C\'s CSM rights; others keep the CSM', async () => {
    const cName = `cowc${stamp}`;
    const c = await registerOwner(BASE, cName);
    const probe = await csm(c.token, 'probe', { visibility: 'private' });
    const shared = await csm(c.token, 'shared');
    const key = await receiver(B.token, `cs${stamp}`, shared);
    const erased = await call(`/v1/owners/${cName}`, { token: c.token, method: 'DELETE' });
    assert(erased.status === 200, `erase C: ${show(erased)}`);
    assert((await call(`/v1/csm/${enc(shared)}`)).status === 200, 'C\'s public CSM outlives the account');

    await registerOwner(BASE, cName);
    const tok = await ownerSignIn(BASE, cName);
    assert(tok.body.ok === true, `the new account signs in: ${JSON.stringify(tok.body?.error)}`);
    const t2 = tok.body.data.token as string;
    try {
        const read = await call(`/v1/csm/${enc(probe)}`, { token: t2 });
        assert(read.status === 404, `the new account reads C's private CSM: ${show(read)}`);
        const put = await call(`/v1/csm/${enc(shared)}`, { token: t2, method: 'PUT', body: { yaml: YAML(shared), expected_version: 1 } });
        assert(put.status === 403, `the new account replaces C's CSM: ${show(put)}`);
        const vis = await call(`/v1/csm/${enc(shared)}`, { token: t2, method: 'PATCH', body: { visibility: 'private' } });
        assert(vis.status === 403, `the new account changes who reads C's CSM: ${show(vis)}`);
        const del = await call(`/v1/csm/${enc(shared)}`, { token: t2, method: 'DELETE' });
        assert(del.status === 403, `the new account deletes C's CSM: ${show(del)}`);
        // Everyone else keeps it.
        assert((await call(`/v1/csm/${enc(shared)}`)).status === 200, 'a caller with no sign-in still reads it');
        const ok = await call(`/v1/receive/${B.name}/cs${stamp}`, { token: key, body: { temperature: 3 } });
        assert(ok.status === 201 || ok.status === 200, `B's receiver on it still works: ${show(ok)}`);
        const op = await call(`/v1/admin/csm/${enc(shared)}`, { token: OP.token, method: 'DELETE' });
        assert(op.status === 200, `the operator still removes it: ${show(op)}`);
    } finally {
        await call(`/v1/owners/${cName}`, { token: t2, method: 'DELETE' });
    }
});

// ── 4 The schema-lock rows a CSM owns ─────────────────────────────────────────

await test('4 A private CSM\'s lock row is hidden from a caller the CSM refuses; the owner, a public CSM and a plain lock answer as before', async () => {
    const secret = await csm(A.token, 'secret', { visibility: 'private', federate: true });
    const open = await csm(A.token, 'open', { federate: true });
    const rows = async (token?: string) => {
        const r = await call(`/v1/schemas?prefix=${enc(`csm.${A.name}.`)}`, token ? { token } : {});
        assert(r.status === 200, `schemas: ${show(r)}`);
        return (r.body.data.schemas as Array<{ key: string }>).map(s => s.key);
    };
    const one = async (key: string, token?: string) => {
        const r = await call(`/v1/memory/${enc(key)}/schema`, token ? { token } : {});
        assert(r.status === 200, `schema of ${key}: ${show(r)}`);
        return r.body.data.has_schema === true;
    };
    for (const [who, token] of [['no sign-in', undefined], ['B', B.token]] as const) {
        const listed = await rows(token);
        assert(!listed.includes(`csm.${secret}`), `${who} sees the private CSM's lock row: ${listed.join(', ')}`);
        assert(listed.includes(`csm.${open}`), `${who} sees the public CSM's lock row: ${listed.join(', ')}`);
        assert(!(await one(`csm.${secret}.x`, token)), `${who} reads the private CSM's schema`);
        assert(await one(`csm.${open}.x`, token), `${who} reads the public CSM's schema`);
    }
    assert((await rows(A.token)).includes(`csm.${secret}`), 'A sees the lock row of its own private CSM');
    assert(await one(`csm.${secret}.x`, A.token), 'A reads the schema of its own private CSM');

    const plain = `cowplain${stamp}.reading`;
    const lock = await call(`/v1/memory/${enc(plain)}/schema`, { token: A.token, method: 'PUT', body: { schema: { type: 'object' }, apply_to: 'exact', schema_mode: 'open' } });
    assert(lock.status === 200, `a plain lock: ${show(lock)}`);
    assert(await one(plain), 'a plain lock is public metadata, as before');

    const cat = await call('/v1/federation/cross-catalogue?source=local');
    assert(cat.status === 200, `cross-catalogue: ${show(cat)}`);
    const names = JSON.stringify(cat.body.data);
    assert(!names.includes(secret), 'the private CSM is in the cross-catalogue');
    assert(names.includes(open), 'the public federable CSM is in the cross-catalogue');
    await call(`/v1/memory/${enc(plain)}/schema`, { token: A.token, method: 'DELETE' });
});

// ── 5 A memory write under a CSM the writer may not read (round 15) ───────────

const SHAPE = (name: string) => `csm: "1.0"
service:
  name: ${name}
  type: data
  description: Readings a program sends
data_schema:
  required:
    temperature: { type: number }
    unit: { type: string, enum: [celsius, fahrenheit] }
`;
async function shaped(token: string, name: string, visibility: string): Promise<string> {
    const r = await call('/v1/csm', { token, body: { yaml: SHAPE(name), visibility } });
    assert(r.status === 201, `CSM ${name}: ${show(r)}`);
    return r.body.data.csm.name as string;
}
const write = (token: string, key: string, value: unknown) => call('/v1/memory', { token, body: { key, value, visibility: 'private' } });
/** A 422 that names the lock at csm.<name> and lists both required fields and the enum's values. */
function fullRefusal(r: Answer, name: string, who: string) {
    assert(r.status === 422 && codeOf(r) === 'SCHEMA_VALIDATION_FAILED', `${who}: ${show(r)}`);
    assert(String(r.body.error?.details?.schema_url ?? '').includes(enc(`csm.${name}`)), `${who}: the schema_url names the lock: ${show(r)}`);
    const v = JSON.stringify(r.body.error?.details?.violations ?? []);
    assert(v.includes('temperature') && v.includes('unit'), `${who}: every missing field is listed: ${v}`);
}

let orgId = '';
await test('5a attack: B\'s write under A\'s private CSM answers as under a CSM that does not exist, and names neither its lock nor its fields', async () => {
    const hidden = await shaped(A.token, `hidden${stamp}`, 'private');
    const missing = `${A.name}.nothing${stamp}`;
    const h = await write(B.token, `csm.${hidden}.probe`, {});
    const m = await write(B.token, `csm.${missing}.probe`, {});
    assert(m.status === 201, `the write under no CSM: ${show(m)}`);
    assert(h.status === m.status, `the write under A's private CSM answers ${h.status}, under none ${m.status}: ${show(h)}`);
    assert(!h.text.includes('temperature') && !h.text.includes('fahrenheit') && !h.text.includes('schema_url'), `the answer describes A's CSM: ${show(h)}`);
    const typed = await write(B.token, `csm.${hidden}.typed`, { temperature: 'warm', unit: 'kelvin' });
    assert(typed.status === 201, `a wrongly typed value under A's private CSM: ${show(typed)}`);
    // A row A set under its own private CSM's keys answers the same way.
    const sub = await call(`/v1/memory/${enc(`csm.${hidden}.exact`)}/schema`, { token: A.token, method: 'PUT', body: { schema: { type: 'object', required: ['secretfield'] }, apply_to: 'exact', schema_mode: 'open' } });
    assert(sub.status === 200, `A locks a key under its own private CSM: ${show(sub)}`);
    const se = await write(B.token, `csm.${hidden}.exact`, {});
    assert(se.status === 201 && !se.text.includes('secretfield') && !se.text.includes('schema_url'), `B's write under A's exact row: ${show(se)}`);
    const own = await write(A.token, `csm.${hidden}.exact`, {});
    assert(own.status === 422 && own.text.includes('secretfield'), `A's own write under its exact row: ${show(own)}`);
    const patched = await call(`/v1/memory/${enc(`csm.${hidden}.probe`)}`, { token: B.token, method: 'PATCH', body: { patch: { note: 'x' } } });
    assert(patched.status === 200, `B patches its own record under A's private CSM: ${show(patched)}`);
    const schemaPut = (pattern: string) => call(`/v1/memory/${enc(pattern)}/schema`, { token: B.token, method: 'PUT', body: { schema: { type: 'object' }, apply_to: 'prefix', schema_mode: 'open' } });
    const ph = await schemaPut(`csm.${hidden}`);
    const pm = await schemaPut(`csm.${missing}`);
    assert(ph.status === 403 && pm.status === 403, `B locks under A's name: ${show(ph)} / ${show(pm)}`);
    assert(ph.body.error?.details?.reason === pm.body.error?.details?.reason, `the reasons differ: ${show(ph)} / ${show(pm)}`);
});

await test('5b use: the owner, any account under a public CSM and an organism member under its CSM get the full refusal; a non-member does not', async () => {
    const hidden = await shaped(A.token, `own${stamp}`, 'private');
    fullRefusal(await write(A.token, `csm.${hidden}.probe`, {}), hidden, 'A under its own private CSM');
    const open = await shaped(A.token, `open${stamp}`, 'public');
    fullRefusal(await write(B.token, `csm.${open}.probe`, {}), open, 'B under A\'s public CSM');
    const ok = await write(B.token, `csm.${open}.good`, { temperature: 3, unit: 'celsius' });
    assert(ok.status === 201, `a valid value under A's public CSM: ${show(ok)}`);
    const o = await call('/v1/organisms', { token: A.token, body: { name: `CSM Org ${stamp}`, description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' } });
    assert(o.status === 201, `organism: ${show(o)}`);
    orgId = o.body.data.organism.id as string;
    const add = await call(`/v1/organisms/${orgId}/members`, { token: A.token, body: { ghii: B.name } });
    assert(add.status === 201, `add B: ${show(add)}`);
    const team = await shaped(A.token, `team${stamp}`, `organism:${orgId}`);
    fullRefusal(await write(B.token, `csm.${team}.probe`, {}), team, 'B, a member, under the organism CSM');
    const d = await registerOwner(BASE, `cowd${stamp}`);
    const outsider = await write(d.token, `csm.${team}.probe`, {});
    assert(outsider.status === 201, `a non-member under the organism CSM answers as under none: ${show(outsider)}`);
    await call(`/v1/owners/${d.name}`, { token: d.token, method: 'DELETE' });
});

// ── 6 A package's CSM after its author is erased (round 15) ───────────────────

await test('6a attack: the next account of an erased installer\'s name is refused a lock on that installer\'s package CSM', async () => {
    const eName = `cowe${stamp}`;
    const e = await registerOwner(BASE, eName);
    const pkgName = `${eName}.pkg${stamp}`;
    const made = await call('/v1/packages', { token: e.token, body: { name: pkgName, components: [{ id: 'csm-main', type: 'csm', label: 'Main', content: YAML(`gauge${stamp}`) }] } });
    assert(made.status === 201, `package: ${show(made)}`);
    const inst = await call(`/v1/packages/${enc(`${pkgName}::${eName}`)}/install`, { token: e.token, body: {} });
    assert(inst.status === 201, `install: ${show(inst)}`);
    const comp = (inst.body.data.installedComponents as Array<{ componentId: string; registeredAs: string }>).find(c => c.componentId === 'csm-main');
    assert(comp, `the CSM component: ${show(inst)}`);
    const name = comp.registeredAs;
    const before = await call(`/v1/csm/${enc(name)}`, { token: B.token });
    assert(before.status === 200, `B reads the package CSM: ${show(before)}`);
    const erased = await call(`/v1/owners/${eName}`, { token: e.token, method: 'DELETE' });
    assert(erased.status === 200, `erase E: ${show(erased)}`);
    await registerOwner(BASE, eName);
    const tok = await ownerSignIn(BASE, eName);
    assert(tok.body.ok === true, `the new account signs in: ${JSON.stringify(tok.body?.error)}`);
    const t2 = tok.body.data.token as string;
    try {
        const put = (pattern: string, applyTo: string) => call(`/v1/memory/${enc(pattern)}/schema`, {
            token: t2, method: 'PUT', body: { schema: { type: 'object', properties: { other: { type: 'string' } }, required: ['other'] }, apply_to: applyTo, schema_mode: 'strict' },
        });
        const prefix = await put(`csm.${name}`, 'prefix');
        assert(prefix.status === 403 && codeOf(prefix) === 'SCHEMA_PATTERN_NOT_YOURS', `the new account locks the erased installer's CSM: ${show(prefix)}`);
        const exact = await put(`csm.${name}.reading`, 'exact');
        assert(exact.status === 403 && codeOf(exact) === 'SCHEMA_PATTERN_NOT_YOURS', `the new account locks a key under it: ${show(exact)}`);
        const after = await call(`/v1/csm/${enc(name)}`, { token: B.token });
        assert(after.status === 200 && JSON.stringify(after.body.data.csm.json_schema) === JSON.stringify(before.body.data.csm.json_schema),
            `the CSM's published schema changed: ${show(after)}`);
    } finally {
        await call(`/v1/owners/${eName}`, { token: t2, method: 'DELETE' });
    }
});

await test('6b use: an account never erased sets, changes and removes the lock of its own CSM; a package CSM with a cortex schema part on it installs', async () => {
    const own = await csm(A.token, `lockable${stamp}`);
    const put = (title: string) => call(`/v1/memory/${enc(`csm.${own}`)}/schema`, {
        token: A.token, method: 'PUT', body: { schema: { type: 'object', properties: { [title]: { type: 'string' } } }, apply_to: 'prefix', schema_mode: 'open' },
    });
    const first = await put('first');
    assert(first.status === 200, `A sets the lock of its own CSM: ${show(first)}`);
    const second = await put('second');
    assert(second.status === 200, `A changes it: ${show(second)}`);
    const removed = await call(`/v1/memory/${enc(`csm.${own}`)}/schema?apply_to=prefix`, { token: A.token, method: 'DELETE' });
    assert(removed.status === 200, `A removes it: ${show(removed)}`);

    const pkgName = `${B.name}.withcx${stamp}`;
    const pattern = `csm.${B.name}.dial${stamp}`;
    const cortex = {
        id: 'cortex-dial', type: 'cortex', label: 'dial', dependencies: [],
        content: JSON.stringify({
            manifest: `apiVersion: cortex.aimeat.org/v1\nkind: Extension\nmetadata:\n  name: cowdial${stamp}\nspec:\n  version: "1.0.0"\n  components:\n    - type: schema\n      name: shape\n      key_pattern: "${pattern}"\n      apply_to: prefix\n      schema:\n        type: object\n        properties:\n          title: { type: string }\n`,
            libs: {},
        }),
    };
    const made = await call('/v1/packages', { token: B.token, body: { name: pkgName, components: [{ id: 'csm-main', type: 'csm', label: 'Main', content: YAML(`dial${stamp}`) }, cortex] } });
    assert(made.status === 201, `package: ${show(made)}`);
    const inst = await call(`/v1/packages/${enc(`${pkgName}::${B.name}`)}/install`, { token: B.token, body: {} });
    assert(inst.status === 201, `B installs a CSM and a cortex schema part on its key: ${show(inst)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
