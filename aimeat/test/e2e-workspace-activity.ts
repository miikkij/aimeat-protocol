/**
 * @file e2e-workspace-activity.ts
 * @description Tests the workspace activity feed: each .version.N is reported as a publish event and
 *   each .draft as an edit event, with the actor, space (objectType), instance and timestamp; newest
 *   first; member-gated.
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-activity

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
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
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) => new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());
async function sign(p: string, m: string) { return Buffer.from(await ed.signAsync(new TextEncoder().encode(m), Buffer.from(p, 'base64'))).toString('base64'); }
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Workspace Activity E2E ===\n');
let token = '', ownerName = '', orgId = '';
const WS = 'ws-act1', root = () => `organism.${orgId}.w.${WS}`;

await test('Setup owner + org + workspace + history (a draft + a published version)', async () => {
    ownerName = `wsact${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Act', password: 'Act12345' }) });
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await sign(reg.body.data.private_key, ownerName + NODE_ID + ts) }) });
    token = tk.body.data.token;
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Act Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    orgId = o.body.data.organism.id;
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Act', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    // a draft (edit) + a published version (publish)
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${root()}.shared.tasks.t1.draft`, value: { id: 't1', title: 'WIP' }, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${root()}.shared.tasks.t2.version.1`, value: { id: 't2', title: 'Done' }, visibility: 'private' }) });
});

await test('1. activity reports a publish + a draft event with actor/space/instance', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/activity?ws=${WS}`, { headers: auth(token) });
    assert(r.status === 200, `activity ${r.status}`);
    const ev = r.body.data.events || [];
    const pub = ev.find((e: any) => e.action === 'publish' && e.instance === 't2');
    const drf = ev.find((e: any) => e.action === 'draft' && e.instance === 't1');
    assert(!!pub && pub.actor === ownerName && pub.type === 'task', `publish event present: ${JSON.stringify(pub)}`);
    assert(!!drf && drf.actor === ownerName && drf.type === 'task', `draft event present: ${JSON.stringify(drf)}`);
    assert(typeof pub.at === 'string' && pub.at.length > 0, 'events carry a timestamp');
});

await test('2. non-member is denied', async () => {
    const reg2 = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName + 'x', display_name: 'X', password: 'Act12345' }) });
    const ts = new Date().toISOString();
    const tk2 = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName + 'x', timestamp: ts, signature: await sign(reg2.body.data.private_key, ownerName + 'x' + NODE_ID + ts) }) });
    const r = await json(`/v1/organisms/${orgId}/workspace/activity?ws=${WS}`, { headers: auth(tk2.body.data.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    await json(`/v1/owners/${ownerName}x`, { method: 'DELETE', headers: auth(tk2.body.data.token) });
});

await test('Cleanup', async () => { await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: auth(token) }); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
