/**
 * @file test/e2e-own-reach-oct26.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the round-8 fixes of group memory-b (secaudit2026oct26). Each section holds the
 *   attack, which a fix refuses or answers as the main route does, beside the legitimate use of the
 *   same path, which answers the same before and after:
 *     - ROWS: a row's classification label hides the row on the page read and in its kept revisions,
 *       as it does on the single read; a reader the label admits sees all three.
 *     - MEMBERS: a private organism's roster answers 404 to a caller who is not its member, as its
 *       detail does; members, the operator and a public organism's outsiders read as before.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-own-reach-oct26
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26, round 8, group memory-b).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { takeOffAudienceCaps } from './helpers/classification-caps.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now() % 1_000_000;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let parsed: Body;
    try { parsed = JSON.parse(text) as Body; } catch { parsed = { _raw: text }; }
    return { status: res.status, body: parsed };
}

let op!: RegisteredOwner, alice!: RegisteredOwner, bob!: RegisteredOwner, carol!: RegisteredOwner;
let orgId = '', ws = '';

console.log('\n=== Round 8, group memory-b: the side routes answer what the main route answers ===\n');

await test('Setup: the operator turns classification on; alice keeps a private organism with a row space; bob is its contributor', async () => {
    op = await registerOwner(BASE, `orop${stamp}`);
    alice = await registerOwner(BASE, `oralice${stamp}`);
    bob = await registerOwner(BASE, `orbob${stamp}`);
    carol = await registerOwner(BASE, `orcarol${stamp}`);
    const on = await call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: 'all' }] });
    assert(on.status === 200, `classification on: ${on.status} ${JSON.stringify(on.body?.error)}`);
    await takeOffAudienceCaps(BASE, op.token);
    const o = await call('POST', '/v1/organisms', alice.token, { name: `Own reach ${stamp}`, type: 'project', join_policy: 'invite_only', visibility: 'private' });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, alice.token, { name: 'Log', manifest: { objectTypes: [
        { name: 'log', schemaRef: 'schema:log@1', namespace: 'ops.log', backing: 'rows', writeRole: 'member', mode: 'records', indexOn: ['stream'] },
    ] } });
    assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body?.error)}`);
    ws = w.body.data.ws;
    const add = await call('POST', `/v1/organisms/${orgId}/members`, alice.token, { ghii: bob.name });
    assert(add.status === 201, `add bob: ${add.status} ${JSON.stringify(add.body?.error)}`);
    const g = await call('POST', `/v1/organisms/${orgId}/workspace-access/grant`, alice.token, { ws, grantee: bob.name, role: 'contributor' });
    assert(g.status === 200, `contributor grant: ${g.status} ${JSON.stringify(g.body?.error)}`);
});

// ─── ROWS (row-service.ts:revision-label-address-surrogate-id) ───
console.log('\nROWS: a row\'s own label hides it on every read of the row');

const rows = (suffix = '') => `/v1/organisms/${orgId}/workspace/rows/log${suffix}?ws=${ws}`;
const rowIds = async (token: string): Promise<string[]> => {
    const r = await call('GET', rows(), token);
    assert(r.status === 200, `page read: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.rows as Body[]).map(x => x.rowId as string);
};
const revisionBodies = async (token: string, rowId: string): Promise<string[]> => {
    const r = await call('GET', rows(`/${rowId}/revisions`), token);
    assert(r.status === 200, `revisions: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.revisions as Body[]).map(v => String(v.body?.msg));
};

await test('Setup: alice writes row r1 and labels it for herself only; bob writes over it, so alice\'s content is a kept revision', async () => {
    const policy = await call('PUT', '/v1/classification/policy', alice.token, { level: 'organism', organism_id: orgId, policy: {
        enabled: true,
        labels: [{ id: 'johto', rank: 25, name: { en: 'Board only', fi: 'Hallitus', es: 'Junta' }, aiVisibility: 'hidden', audience: { people: [alice.name] } }],
    } });
    assert(policy.status === 200 && policy.body.data.applied === true, `organism policy: ${policy.status} ${JSON.stringify(policy.body?.error ?? policy.body?.data)}`);
    const a = await call('POST', rows(), alice.token, { row_id: 'r1', body: { stream: 's', msg: 'alice original' } });
    assert(a.status === 200, `alice appends: ${a.status} ${JSON.stringify(a.body?.error)}`);
    const b2 = await call('POST', rows(), alice.token, { row_id: 'r2', body: { stream: 's', msg: 'unlabelled' } });
    assert(b2.status === 200, `alice appends r2: ${b2.status}`);
    // POSITIVE CONTROL: before the label bob reads both rows.
    const before = await rowIds(bob.token);
    assert(before.includes('r1') && before.includes('r2'), `bob reads before the label: ${JSON.stringify(before)}`);
    const set = await call('PUT', '/v1/classification/label', alice.token, { kind: 'row', organism_id: orgId, ws, space: 'log', row_id: 'r1', label: 'johto' });
    assert(set.status === 200 && set.body.data.applied === true, `row label: ${set.status} ${JSON.stringify(set.body?.error ?? set.body?.data)}`);
    const over = await call('POST', rows(), bob.token, { row_id: 'r1', body: { stream: 's', msg: 'bob replaced' } });
    assert(over.status === 200, `bob writes over r1: ${over.status} ${JSON.stringify(over.body?.error)}`);
});

await test('the single read hides the labelled row from bob (the control the other reads must match)', async () => {
    const r = await call('GET', rows('/r1'), bob.token);
    assert(r.status === 404, `bob read the labelled row: ${r.status}`);
});

await test('ATTACK: the page read leaves the labelled row out for bob', async () => {
    const ids = await rowIds(bob.token);
    assert(!ids.includes('r1'), `bob's page read listed the labelled row: ${JSON.stringify(ids)}`);
    assert(ids.includes('r2'), `bob lost the unlabelled row: ${JSON.stringify(ids)}`);
});

await test('ATTACK: the kept revisions of the labelled row are not shown to bob', async () => {
    const bodies = await revisionBodies(bob.token, 'r1');
    assert(!bodies.includes('alice original'), `bob read alice's earlier content through the revisions: ${JSON.stringify(bodies)}`);
});

await test('USE: alice, whom the label admits, reads the row on the single read, the page read and its revisions', async () => {
    const one = await call('GET', rows('/r1'), alice.token);
    assert(one.status === 200 && one.body.data.row.body.msg === 'bob replaced', `alice single read: ${one.status} ${JSON.stringify(one.body?.data?.row?.body)}`);
    const ids = await rowIds(alice.token);
    assert(ids.includes('r1') && ids.includes('r2'), `alice page read: ${JSON.stringify(ids)}`);
    const bodies = await revisionBodies(alice.token, 'r1');
    assert(bodies.includes('alice original'), `alice revisions: ${JSON.stringify(bodies)}`);
});

// ─── MEMBERS (organisms/membership.ts:GET-members:private-organism-without-visibility-gate) ───
console.log('\nMEMBERS: a private organism\'s roster answers as its detail does');

await test('the detail of the private organism is 404 to carol and to a caller with no token (the control)', async () => {
    assert((await call('GET', `/v1/organisms/${orgId}`, carol.token)).status === 404, 'carol read the detail');
    assert((await call('GET', `/v1/organisms/${orgId}`)).status === 404, 'no token read the detail');
});

await test('ATTACK: the roster of the private organism is 404 to carol and to a caller with no token', async () => {
    const c = await call('GET', `/v1/organisms/${orgId}/members`, carol.token);
    assert(c.status === 404, `carol read the roster: ${c.status} ${JSON.stringify(c.body?.data?.members?.map?.((m: Body) => m.ghii))}`);
    const n = await call('GET', `/v1/organisms/${orgId}/members`);
    assert(n.status === 404, `no token read the roster: ${n.status} ${JSON.stringify(n.body?.data?.members?.map?.((m: Body) => m.ghii))}`);
});

await test('USE: alice, bob and the operator read the roster as before', async () => {
    for (const [who, token] of [['alice', alice.token], ['bob', bob.token], ['the operator', op.token]] as const) {
        const r = await call('GET', `/v1/organisms/${orgId}/members`, token);
        const names = (r.body?.data?.members as Body[] | undefined)?.map(m => m.ghii) ?? [];
        assert(r.status === 200 && names.includes(alice.name) && names.includes(bob.name), `${who}: ${r.status} ${JSON.stringify(names)}`);
    }
});

await test('USE: a public organism shows its creator and admins to an outsider with no token, as before', async () => {
    const o = await call('POST', '/v1/organisms', alice.token, { name: `Own reach public ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' });
    assert(o.status === 201, `public organism: ${o.status}`);
    const r = await call('GET', `/v1/organisms/${o.body.data.organism.id}/members`);
    const names = (r.body?.data?.members as Body[] | undefined)?.map(m => m.ghii) ?? [];
    assert(r.status === 200 && names.includes(alice.name), `outsider on a public organism: ${r.status} ${JSON.stringify(names)}`);
});

await test('Cleanup: the operator turns classification off', async () => {
    const r = await call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: 'off' }] });
    assert(r.status === 200, `classification off: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
