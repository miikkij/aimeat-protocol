/**
 * @file e2e-workspace-dotted-id.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One record whose id holds a dot made a shared workspace's index unreadable for every
 *   member: the index split the key on its first dot, so `v1.2.draft` became record `v1` with the role
 *   `2.draft`, a slot with neither a published nor a draft record, and reading it answered 500
 *   (secaudit2026oct31w2 round 10, f-2026-10-23-dotted-id-breaks-index).
 *
 *   The index now reads a record's role from the end of its key, as the write guard and the export
 *   do, and a slot with nothing in it is left out. A record with a dot in its id lists under its whole
 *   id and is read by it, so records written before the fix stay readable without a migration.
 *
 *   FIRST FAIL. On the tree before the fix the "Refused:" test fails (the index answers 500 for the
 *   owner and for a member). The "Usage:" tests pass on both trees, apart from the index read, which
 *   the dotted record breaks on the old tree.
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (secaudit2026oct31w2 round 10).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-dotted-id
import { registerOwner } from './helpers/owner-login.js';

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const post = (path: string, token: string, body: unknown) => json(path, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });

const stamp = Date.now().toString(36);
const WS = `wsdot${stamp}`;
const NS = 'notes';
let owner = { name: '', token: '' };
let member = { name: '', token: '' };
let orgId = '';
const root = () => `organism.${orgId}.w.${WS}`;

console.log('\n=== Workspace index with a dotted record id ===\n');

await test('Setup: an owner, a member, an organism and a workspace with a records space', async () => {
    owner = await registerOwner(BASE, `wsdo${stamp}`);
    member = await registerOwner(BASE, `wsdm${stamp}`);
    const o = await post('/v1/organisms', owner.token, { name: 'Dotted', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const join = await post(`/v1/organisms/${orgId}/join`, member.token, {});
    assert(join.status === 200 || join.status === 201, `join ${join.status}: ${JSON.stringify(join.body?.error)}`);
    const reg = await post('/v1/memory', owner.token, { key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Dotted', createdAt: new Date().toISOString(), createdBy: owner.name }] }, visibility: 'private' });
    assert(reg.status === 201, `registry ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Dotted', kind: 'project', status: 'active',
        objectTypes: [{ name: 'note', schemaRef: 'schema:note@1', namespace: NS, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true }],
    };
    const m = await post('/v1/memory', owner.token, { key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' });
    assert(m.status === 201, `manifest ${m.status}: ${JSON.stringify(m.body?.error)}`);
    const g = await post(`/v1/organisms/${orgId}/workspace-access/grant`, owner.token, { ws: WS, grantee: member.name, role: 'contributor' });
    assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
});

await test('Usage: plain records are written, one published, and the index lists both', async () => {
    for (const id of ['plain', 'pub']) {
        const w = await post(`/v1/organisms/${orgId}/workspace/drafts`, owner.token, { ws: WS, space: 'note', id, value: { title: `Note ${id}` } });
        assert(w.status === 200, `draft ${id} ${w.status}: ${JSON.stringify(w.body?.error)}`);
    }
    const p = await post(`/v1/organisms/${orgId}/publish`, owner.token, { ws: WS, namespace: NS, id: 'pub' });
    assert(p.status === 200, `publish ${p.status}: ${JSON.stringify(p.body?.error)}`);
    const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(owner.token) });
    assert(r.status === 200, `index ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const notes = r.body.data.index.note as any[];
    const byId = Object.fromEntries(notes.map(n => [n.id, n]));
    assert(byId.plain && byId.plain.published === false && byId.plain.has_draft === true, `plain: ${JSON.stringify(byId.plain)}`);
    assert(byId.pub && byId.pub.published === true && byId.pub.title === 'Note pub', `pub: ${JSON.stringify(byId.pub)}`);
    assert(r.body.data.counts.note === 2, `count ${r.body.data.counts.note}`);
});

await test('Refused: a record id with a dot no longer makes the index unreadable, for the owner or a member', async () => {
    const w = await post(`/v1/organisms/${orgId}/workspace/drafts`, owner.token, { ws: WS, space: 'note', id: 'v1.2', value: { title: 'Dotted' } });
    assert(w.status === 200, `the dotted draft is written as before: ${w.status} ${JSON.stringify(w.body?.error)}`);
    for (const [who, token] of [['owner', owner.token], ['member', member.token]] as const) {
        const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(token) });
        assert(r.status === 200, `${who} index ${r.status}: ${JSON.stringify(r.body?.error)}`);
    }
});

await test('Usage: the dotted record lists under its whole id beside the others, and is read by it', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(owner.token) });
    const ids = (r.body.data.index.note as any[]).map(n => n.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['plain', 'pub', 'v1.2']), `ids ${JSON.stringify(ids)}`);
    const one = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}&ids=v1.2&space=note`, { headers: auth(owner.token) });
    assert(one.status === 200, `read by id ${one.status}: ${JSON.stringify(one.body?.error)}`);
    const item = (one.body.data.items as any[])[0];
    assert(item && item.id === 'v1.2' && item.value?.title === 'Dotted', `item ${JSON.stringify(one.body.data)}`);
});

await test('Usage: a history row with nothing current makes no empty entry', async () => {
    // A `.version.N` row alone, as an old publish can leave behind, is history, not a record.
    const v = await post('/v1/memory', owner.token, { key: `${root()}.${NS}.oldonly.version.1`, value: { title: 'history' }, visibility: 'private' });
    assert(v.status === 201 || v.status === 422 || v.status === 403, `version row ${v.status}`);
    const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth(owner.token) });
    assert(r.status === 200, `index ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ids = (r.body.data.index.note as any[]).map(n => n.id);
    assert(!ids.includes('oldonly'), `a history row alone is not listed: ${JSON.stringify(ids)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
