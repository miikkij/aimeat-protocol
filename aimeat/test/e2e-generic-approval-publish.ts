/**
 * @file test/e2e-generic-approval-publish.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the action "publish" on the generic approval route, POST /v1/organisms/:id/approvals.
 *   That route refuses the two member-change actions, because approving one runs the change it
 *   carries, and it refuses action "publish" for the same reason: resolving one
 *   (POST /v1/organisms/:id/approvals/:aid) publishes the draft, and a publish approval filed there
 *   skipped the checks POST /v1/organisms/:id/publish asks first (the write test of the draft's key)
 *   and the approver role of the organism's configured publish gate.
 *   Each section holds the refused case on the publish route, the same publish on the generic route
 *   (refused with 400, the draft not published), and the designed use of the publish route and of
 *   a publish approval filed through it.
 *   Register finding f-2026-11-13-generic-approval-action-publish-runs-a-publish. FAIL FIRST,
 *   2026-11-14, on both backends: before the refusal, both generic-route sections published the draft.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-generic-approval-publish
 * @version-history
 *   v1.1.0 — 2026-11-14 — The generic route refuses action "publish": the two sections assert the
 *     designed answer instead of today's (developer's decision of 2026-11-14, option A).
 *   v1.0.0 — 2026-11-14 — Initial.
 */
import { registerOwner, setupOperator, type RegisteredOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';
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
async function call(method: 'GET' | 'POST' | 'DELETE', path: string, token?: string, body?: unknown): Promise<Answer> {
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
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 300)}`;
const N = (s: string) => `gap${s}${stamp}`;

let alice!: RegisteredOwner, bob!: RegisteredOwner, carol!: RegisteredOwner;
let orgId = '';
const WS = 'wsgap';
const NS = 'shared.notes';
const root = () => `organism.${orgId}.w.${WS}`;
const base = (id: string) => `${root()}.${NS}.${id}`;

async function writeDraft(who: RegisteredOwner, id: string, title: string): Promise<void> {
    const r = await call('POST', '/v1/memory', who.token, { key: `${base(id)}.draft`, value: { id, title }, visibility: 'private' });
    assert(r.status === 201 || r.status === 200, `draft ${id} by ${who.name}: ${show(r)}`);
}
/** True when `who` holds a copy of the record's `suffix` (draft, latest) in their own namespace. */
async function holds(who: RegisteredOwner, id: string, suffix: 'draft' | 'latest'): Promise<boolean> {
    const r = await call('GET', `/v1/memory?prefix=${encodeURIComponent(`${base(id)}.`)}`, who.token);
    assert(r.status === 200, `list ${id} as ${who.name}: ${show(r)}`);
    return ((r.body.data?.items ?? []) as Body[]).some(i => i.key === `${base(id)}.${suffix}`);
}
/** Published by anyone: a `.latest` under any of the three accounts. */
async function published(id: string): Promise<boolean> {
    for (const who of [alice, bob, carol]) if (await holds(who, id, 'latest')) return true;
    return false;
}
/** File action "publish" on the generic route, naming member approvers; it is refused with 400 and names the publish route. */
async function fileOnGenericRoute(who: RegisteredOwner, id: string): Promise<void> {
    const filed = await call('POST', `/v1/organisms/${orgId}/approvals`, who.token, {
        action: 'publish', rule: 'approve', approverRole: 'member',
        arguments: { ws: WS, namespace: NS, instance: id },
    });
    assert(filed.status === 400 && filed.body.error?.code === 'INVALID_INPUT', `file: ${show(filed)}`);
    assert(String(filed.body.error?.message ?? '').includes(`/v1/organisms/${orgId}/publish`), `the refusal names the publish route: ${show(filed)}`);
}

console.log('\n=== Action "publish" on the generic approval route ===\n');

await test('Setup: the operator; alice\'s organism and workspace; carol a contributor, bob a member with no grant', async () => {
    await setupOperator(BASE, ADMIN_PW, N('op'));
    alice = await registerOwner(BASE, N('alice'));
    bob = await registerOwner(BASE, N('bob'));
    carol = await registerOwner(BASE, N('carol'));
    const o = await call('POST', '/v1/organisms', alice.token, { name: `GAP ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' });
    assert(o.status === 201, `organism: ${show(o)}`);
    orgId = o.body.data.organism.id;
    const ws = await call('POST', '/v1/memory', alice.token, { key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Main', createdAt: new Date().toISOString(), createdBy: alice.name }] }, visibility: 'private' });
    assert(ws.status === 201 || ws.status === 200, `workspaces: ${show(ws)}`);
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Main', kind: 'project', status: 'active',
        objectTypes: [{ name: 'note', schemaRef: 'schema:note@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true }],
    };
    const m = await call('POST', '/v1/memory', alice.token, { key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' });
    assert(m.status === 201 || m.status === 200, `manifest: ${show(m)}`);
    for (const who of [bob, carol]) {
        const j = await call('POST', `/v1/organisms/${orgId}/join`, who.token, {});
        assert(j.status === 200 || j.status === 201, `join ${who.name}: ${show(j)}`);
    }
    const g = await call('POST', `/v1/organisms/${orgId}/workspace-access/grant`, alice.token, { ws: WS, grantee: carol.name, role: 'contributor' });
    assert(g.status === 200 || g.status === 201, `grant: ${show(g)}`);
});

// ─── The write test of the draft's key ───
console.log('\nWRITE TEST: a member who may not write the draft does not publish it');

await test('REFUSED: bob, a member with no grant, cannot publish carol\'s draft through POST /publish (403), and the draft stays', async () => {
    await writeDraft(carol, 'c1', 'by carol');
    const r = await call('POST', `/v1/organisms/${orgId}/publish`, bob.token, { ws: WS, namespace: NS, id: 'c1' });
    assert(r.status === 403, `publish route: ${show(r)}`);
    assert(await holds(carol, 'c1', 'draft'), 'carol\'s draft must still be there');
    assert(!(await published('c1')), 'nothing may be published');
});

await test('REFUSED: bob files action "publish" of carol\'s draft on the generic approval route: 400 naming the publish route, and the draft is not published', async () => {
    await fileOnGenericRoute(bob, 'c1');
    assert(!(await published('c1')), 'the draft must not be published');
    assert(await holds(carol, 'c1', 'draft'), 'carol\'s draft must still be there');
});

await test('USE KEPT: carol, the contributor, publishes her own draft through POST /publish', async () => {
    await writeDraft(carol, 'c2', 'second by carol');
    const r = await call('POST', `/v1/organisms/${orgId}/publish`, carol.token, { ws: WS, namespace: NS, id: 'c2' });
    assert(r.status === 200 && r.body.data.published === true, `contributor publish: ${show(r)}`);
    assert(await published('c2'), 'c2 published');
});

// ─── The configured publish gate ───
console.log('\nPUBLISH GATE: a publish the organism\'s gate sends to the owner is not resolved by the publisher');

await test('Setup: alice turns the publish gate on, with the organism\'s owner as the approver', async () => {
    const r = await call('POST', '/v1/memory', alice.token, { key: `organism.${orgId}.meta.config`, value: { gates: { publish: { enabled: true, approverRole: 'owner' } } }, visibility: 'private' });
    assert(r.status === 201 || r.status === 200, `config: ${show(r)}`);
});

let gatedAid = '';
await test('REFUSED: carol\'s publish through POST /publish files an approval for the owner (202), and carol cannot resolve it (403)', async () => {
    await writeDraft(carol, 'g1', 'gated by carol');
    const r = await call('POST', `/v1/organisms/${orgId}/publish`, carol.token, { ws: WS, namespace: NS, id: 'g1' });
    assert(r.status === 202 && r.body.data.gated === true && r.body.data.approval.approverRole === 'owner', `publish route with the gate on: ${show(r)}`);
    gatedAid = r.body.data.approval.id;
    const self = await call('POST', `/v1/organisms/${orgId}/approvals/${gatedAid}`, carol.token, { decision: 'approve' });
    assert(self.status === 403, `carol resolves the gate's approval: ${show(self)}`);
    assert(!(await published('g1')), 'g1 is not published yet');
});

await test('REFUSED: carol files action "publish" with member approvers for the draft the gate sends to the owner: 400 naming the publish route, and the draft is not published', async () => {
    await fileOnGenericRoute(carol, 'g1');
    assert(!(await published('g1')), 'the draft must not be published past the gate');
    assert(await holds(carol, 'g1', 'draft'), 'carol\'s draft must still be there');
});

await test('USE KEPT: alice, the owner, resolves the approval the publish route filed, and the draft is published', async () => {
    await writeDraft(carol, 'g2', 'gated, approved by alice');
    const r = await call('POST', `/v1/organisms/${orgId}/publish`, carol.token, { ws: WS, namespace: NS, id: 'g2' });
    assert(r.status === 202 && r.body.data.gated === true, `publish route with the gate on: ${show(r)}`);
    const ok = await call('POST', `/v1/organisms/${orgId}/approvals/${r.body.data.approval.id}`, alice.token, { decision: 'approve' });
    assert(ok.status === 200 && ok.body.data.approval.status === 'approved', `alice resolves: ${show(ok)}`);
    assert(await published('g2'), 'g2 published');
});

await test('Cleanup: the accounts deleted', async () => {
    const left: string[] = [];
    for (const who of [alice, bob, carol]) {
        const gone = await call('DELETE', `/v1/owners/${who.name}`, who.token);
        if (gone.body?.ok !== true) left.push(`${who.name}: ${gone.status}`);
    }
    assert(left.length === 0, `accounts not deleted: ${left.join(', ')}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
