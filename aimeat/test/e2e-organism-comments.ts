/**
 * @file e2e-organism-comments.ts
 * @description E2E for comments/threads on workspace objects (records + documents). Covers: adding
 *   a general comment, an anchored comment (anchor.quote/section), a threaded reply (parent_id),
 *   listing a target's thread (sorted, with anchor + parent), the membership gate (non-member 403),
 *   and author-only / admin delete.
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: workspace comments + threads + anchoring.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-comments

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `orgcom${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Org Comments', password: 'OrgCom1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Org Comments', password: 'OrgCom1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Organism Comments E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;
let B: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'ws-com1';
const root = () => `organism.${orgId}.w.${WS}`;
let firstCommentId = '';

await test('Setup A (creator) + B (non-member); A creates org + workspace + a record', async () => {
    A = await setupOwner('a'); B = await setupOwner('b');
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Comments Org', description: 'x', type: 'project', join_policy: 'approval_required', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Coordination', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);
    const r1 = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.shared.tasks.t1.latest`, value: { id: 't1', title: 'Design the API', markdown: 'We should version the endpoints.' }, visibility: 'private' }) });
    assert(r1.status === 201 || r1.status === 200, `record ${r1.status}`);
});

await test('1. Add a general comment on the record', async () => {
    const r = await json(`/v1/organisms/${orgId}/comments`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, space: 'task', instance_id: 't1', body: 'Looks good overall.' }) });
    assert(r.status === 201, `comment ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.comment.anchor === null, 'general comment has null anchor');
    firstCommentId = r.body.data.comment.id;
});

await test('2. Add an anchored comment (quote)', async () => {
    const r = await json(`/v1/organisms/${orgId}/comments`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, space: 'task', instance_id: 't1', body: 'Agree — semver please.', anchor: { quote: 'version the endpoints' } }) });
    assert(r.status === 201, `anchored ${r.status}`);
    assert(r.body.data.comment.anchor && r.body.data.comment.anchor.quote === 'version the endpoints', 'anchor.quote persisted');
});

await test('3. Reply to the first comment (thread via parent_id)', async () => {
    const r = await json(`/v1/organisms/${orgId}/comments`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, space: 'task', instance_id: 't1', body: 'Thanks!', parent_id: firstCommentId }) });
    assert(r.status === 201 && r.body.data.comment.parentId === firstCommentId, `reply ${r.status}`);
});

await test('4. List the thread → 3 comments, sorted, with anchor + parent', async () => {
    const r = await json(`/v1/organisms/${orgId}/comments?ws=${WS}&space=task&instance_id=t1`, { headers: auth(A.token) });
    assert(r.status === 200, `list ${r.status}`);
    const c = r.body.data.comments || [];
    assert(c.length === 3, `expected 3 comments, got ${c.length}`);
    assert(c[0].createdAt <= c[1].createdAt && c[1].createdAt <= c[2].createdAt, 'sorted by createdAt');
    assert(c.some((x: any) => x.anchor && x.anchor.quote), 'an anchored comment is present');
    assert(c.some((x: any) => x.parentId === firstCommentId), 'a threaded reply is present');
});

await test('5. Missing body / target params are rejected (400)', async () => {
    const r = await json(`/v1/organisms/${orgId}/comments`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, space: 'task', instance_id: 't1', body: '   ' }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    const g = await json(`/v1/organisms/${orgId}/comments?ws=${WS}&space=task`, { headers: auth(A.token) });
    assert(g.status === 400, `expected 400 for missing instance_id, got ${g.status}`);
});

await test('6. A non-member cannot comment or read comments (403)', async () => {
    const p = await json(`/v1/organisms/${orgId}/comments`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ ws: WS, space: 'task', instance_id: 't1', body: 'sneaky' }) });
    assert(p.status === 403, `post expected 403, got ${p.status}`);
    const g = await json(`/v1/organisms/${orgId}/comments?ws=${WS}&space=task&instance_id=t1`, { headers: auth(B.token) });
    assert(g.status === 403, `get expected 403, got ${g.status}`);
});

await test('7. Author deletes their comment → thread shrinks to 2', async () => {
    const r = await json(`/v1/organisms/${orgId}/comments/${firstCommentId}?ws=${WS}&space=task&instance_id=t1`, { method: 'DELETE', headers: auth(A.token) });
    assert(r.status === 200 && r.body.data.deleted === firstCommentId, `delete ${r.status}: ${JSON.stringify(r.body.error)}`);
    const g = await json(`/v1/organisms/${orgId}/comments?ws=${WS}&space=task&instance_id=t1`, { headers: auth(A.token) });
    assert((g.body.data.comments || []).length === 2, `expected 2 after delete, got ${(g.body.data.comments || []).length}`);
});

await test('8. Deleting a missing comment returns 404', async () => {
    const r = await json(`/v1/organisms/${orgId}/comments/nope-id?ws=${WS}&space=task&instance_id=t1`, { method: 'DELETE', headers: auth(A.token) });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
