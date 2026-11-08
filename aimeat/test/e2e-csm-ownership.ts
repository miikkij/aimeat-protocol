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
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=csm-ownership
 * @version-history
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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
