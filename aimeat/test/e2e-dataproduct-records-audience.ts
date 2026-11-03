/**
 * @file test/e2e-dataproduct-records-audience.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the audience a data product's records source allows (secaudit2026nov02d round 13,
 *   dataproduct:records-source:audience-capped-at-organism-not-workspace). Owner A makes an organism and a
 *   workspace with a records space; B and C join the organism; A gives B the viewer role on the
 *   workspace and C none, so C does not read the workspace.
 *     R1  B (a viewer) defines a product over the workspace at the organism's audience: 409
 *         AUDIENCE_WIDER_THAN_SOURCE naming "private", and C reads no row of it. Fails on the code
 *         before round 13, where the product published and C read the rows. C's own product over the
 *         workspace is refused.
 *     U1  B's product over the workspace at private builds, and B reads its rows.
 *     U2  A (the workspace's creator and the organism's creator) builds a product over it at the
 *         organism's audience, and C reads its rows: the person who decides the workspace's access
 *         decides the product's.
 *     U3  When A opens the workspace to every member of the organism, B's product at the organism's
 *         audience builds, and C reads its rows.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-dataproduct-records-audience
 * @version-history
 *   v1.0.1 — 2026-11-03 — R1: the refusal says who can widen the workspace (secaudit2026nov02d round 13b).
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36).slice(-6);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(method: 'GET' | 'POST' | 'PUT', path: string, token?: string, body?: unknown): Promise<Answer> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let parsed: Body = { _raw: text };
    try { parsed = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body: parsed, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 400)}`;

let A!: RegisteredOwner, B!: RegisteredOwner, C!: RegisteredOwner;
let orgId = '', ws = '';
const SECRET = `RESTRICTED-${stamp}`;
const N = (s: string) => `dra${s}${stamp}`;
const source = () => ({ kind: 'records', organism_id: orgId, ws, space: 'signal' });
const define = (token: string, name: string, visibility: string) =>
    call('PUT', `/v1/dataproducts/${name}`, token, { visibility, sources: [source()] });
const run = (token: string, name: string) => call('POST', `/v1/dataproducts/${name}/run`, token, {});
const rowsOf = async (token: string, owner: string, name: string): Promise<Answer> =>
    call('GET', `/v1/datapackages/${owner}/${name}/rows/rows?limit=100`, token);

console.log('\n=== A records source allows the audience its workspace admits (secaudit2026nov02d round 13) ===\n');

await test('Setup: A\'s organism and workspace with one published record; B a viewer of it; C a member without a role', async () => {
    A = await registerOwner(BASE, `draa${stamp}`);
    B = await registerOwner(BASE, `drab${stamp}`);
    C = await registerOwner(BASE, `drac${stamp}`);
    const org = await call('POST', '/v1/organisms', A.token, { name: `Dra Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' });
    assert(org.status === 201, `organism: ${show(org)}`);
    orgId = org.body.data.organism.id;
    for (const who of [B, C]) {
        const j = await call('POST', `/v1/organisms/${orgId}/join`, who.token, {});
        assert(j.status === 200 || j.status === 201, `join ${who.name}: ${show(j)}`);
    }
    const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, A.token, { name: 'Restricted', manifest: {
        manifestVersion: '1', name: 'Restricted', kind: 'project',
        objectTypes: [{ name: 'signal', namespace: 'shared.signals', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:signal@1' }],
    }, schemas: { 'shared.signals': { type: 'object', additionalProperties: true, properties: { id: { type: 'string' }, note: { type: 'string' } } } } });
    assert(w.status === 201 || w.status === 200, `workspace: ${show(w)}`);
    ws = w.body.data.ws;
    const d = await call('POST', `/v1/organisms/${orgId}/workspace/drafts`, A.token, { ws, space: 'signal', id: 's1', value: { note: SECRET } });
    assert(d.status === 200, `draft: ${show(d)}`);
    const p = await call('POST', `/v1/organisms/${orgId}/publish`, A.token, { ws, namespace: 'shared.signals', id: 's1' });
    assert(p.status === 200, `publish: ${show(p)}`);
    const g = await call('POST', `/v1/organisms/${orgId}/workspace-access/grant`, A.token, { ws, grantee: B.name, role: 'viewer' });
    assert(g.status === 200, `viewer role: ${show(g)}`);
    const readC = await call('GET', `/v1/organisms/${orgId}/workspace?ws=${ws}`, C.token);
    // The route answers a member without read access with an empty workspace.
    assert(!readC.text.includes(SECRET) && !readC.body.data?.manifest, `C reads the restricted workspace: ${show(readC)}`);
    const readB = await call('GET', `/v1/organisms/${orgId}/workspace?ws=${ws}`, B.token);
    assert(readB.status === 200 && readB.body.data?.manifest, `B reads the workspace as a viewer: ${show(readB)}`);
});

await test('R1. B (a viewer) defines a product over the restricted workspace at the organism: 409 naming private; C reads no row', async () => {
    const d = await define(B.token, N('wide'), `organism:${orgId}`);
    if (d.status === 201) {
        const r = await run(B.token, N('wide'));
        const c = await rowsOf(C.token, B.name, N('wide'));
        throw new Error(`the product was defined (${d.status}), run (${r.status}), and C reads it: ${show(c)}`);
    }
    assert(d.status === 409 && d.body.error?.code === 'AUDIENCE_WIDER_THAN_SOURCE', `define: ${show(d)}`);
    assert(d.text.includes('"private"'), `the refusal names the audience allowed: ${show(d)}`);
    assert(d.text.includes('creator or an organism admin'), `the refusal says who can widen the workspace: ${show(d)}`);
    const c = await rowsOf(C.token, B.name, N('wide'));
    assert(!c.text.includes(SECRET), `C reads the restricted record: ${show(c)}`);
    // C, who does not read the workspace, builds no product from it at any audience.
    const byC = await define(C.token, N('c'), 'private');
    assert(byC.status === 403 || byC.status === 404, `C's product over the restricted workspace: ${show(byC)}`);
});

await test('U1. B\'s product over the workspace at private builds, and B reads its rows', async () => {
    const d = await define(B.token, N('own'), 'private');
    assert(d.status === 201, `define: ${show(d)}`);
    const r = await run(B.token, N('own'));
    assert(r.status === 201 && r.body.data.rows === 1, `run: ${show(r)}`);
    const rows = await rowsOf(B.token, B.name, N('own'));
    assert(rows.status === 200 && rows.text.includes(SECRET), `B's rows: ${show(rows)}`);
});

await test('U2. A, the workspace\'s creator, builds a product over it at the organism, and C reads its rows', async () => {
    const d = await define(A.token, N('org'), `organism:${orgId}`);
    assert(d.status === 201, `define: ${show(d)}`);
    const r = await run(A.token, N('org'));
    assert(r.status === 201 && r.body.data.rows === 1, `run: ${show(r)}`);
    const rows = await rowsOf(C.token, A.name, N('org'));
    assert(rows.status === 200 && rows.text.includes(SECRET), `C's read: ${show(rows)}`);
});

await test('U3. A opens the workspace to every member: B\'s product at the organism builds, and C reads its rows', async () => {
    const key = `organism.${orgId}.w.${ws}.meta.manifest`;
    const man = await call('GET', `/v1/memory/${encodeURIComponent(key)}`, A.token);
    assert(man.status === 200, `the manifest: ${show(man)}`);
    const value = man.body.data?.value ?? man.body.data?.record?.value;
    assert(value && typeof value === 'object', `the manifest value: ${show(man)}`);
    const open = await call('POST', '/v1/memory', A.token, { key, value, visibility: `organism:${orgId}` });
    assert(open.status === 200 || open.status === 201, `open the workspace: ${show(open)}`);
    const readC = await call('GET', `/v1/organisms/${orgId}/workspace?ws=${ws}`, C.token);
    assert(readC.status === 200 && readC.body.data?.manifest, `C reads the opened workspace: ${show(readC)}`);
    const d = await define(B.token, N('open'), `organism:${orgId}`);
    assert(d.status === 201, `define: ${show(d)}`);
    const r = await run(B.token, N('open'));
    assert(r.status === 201 && r.body.data.rows === 1, `run: ${show(r)}`);
    const rows = await rowsOf(C.token, B.name, N('open'));
    assert(rows.status === 200 && rows.text.includes(SECRET), `C's read: ${show(rows)}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);
