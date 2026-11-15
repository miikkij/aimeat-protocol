/**
 * @file e2e-workspace-activity.ts
 * @description Tests the workspace activity feed: each .version.N is reported as a publish event and
 *   each .draft as an edit event, with the actor, space (objectType), instance and timestamp; newest
 *   first; member-gated. Also covers direct writes (a `.latest`-only or bare-key write that skips
 *   draft→publish) surfacing as publish events, and that a normally-published instance
 *   (.version.N + .latest) is not double-counted.
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial.
 *   v1.1.0 — 2026-06-23 — Cover direct-write visibility + the no-double-count invariant.
 *   2026-11-15 — Audit M156, L127: another member's private records stay out of the feed; Setup asserts each write.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-activity

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
import { ownerSignIn } from './helpers/owner-login.js';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
/** A private memory write that must land; a refusal fails the calling test with its code. */
async function put(tok: string, key: string, value: unknown) {
    const w = await json('/v1/memory', { method: 'POST', headers: auth(tok), body: JSON.stringify({ key, value, visibility: 'private' }) });
    assert(w.status === 200 || w.status === 201, `write ${key.split('.').slice(-3).join('.')} ${w.status}: ${JSON.stringify(w.body?.error)}`);
}

console.log('\n=== AIMEAT Workspace Activity E2E ===\n');
let token = '', ownerName = '', orgId = '';
const WS = 'ws-act1', root = () => `organism.${orgId}.w.${WS}`;

await test('Setup owner + org + workspace + history (a draft + a published version)', async () => {
    ownerName = `wsact${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Act', password: 'Act12345' }) });
    assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tk = await ownerSignIn(BASE, ownerName, 'Act12345');
    token = tk.body.data.token;
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Act Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `organism create ${o.status}: ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Act', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
    await put(token, `${root()}.meta.manifest`, manifest);
    // a draft (edit) + a published instance (t2: a publish creates BOTH .version.1 AND .latest)
    await put(token, `${root()}.shared.tasks.t1.draft`, { id: 't1', title: 'WIP' });
    await put(token, `${root()}.shared.tasks.t2.version.1`, { id: 't2', title: 'Done' });
    await put(token, `${root()}.shared.tasks.t2.latest`, { id: 't2', title: 'Done' });
    // DIRECT WRITES that skip draft→publish: a `.latest`-only write (t3) and a bare-key write (t4).
    // These have no .version.N, so they must still surface as events (nothing goes unnoticed).
    await put(token, `${root()}.shared.tasks.t3.latest`, { id: 't3', title: 'Direct latest' });
    await put(token, `${root()}.shared.tasks.t4`, { id: 't4', title: 'Direct bare' });
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

await test('2. direct writes (.latest-only and bare key) surface as publish events', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/activity?ws=${WS}`, { headers: auth(token) });
    assert(r.status === 200, `activity ${r.status}`);
    const ev = r.body.data.events || [];
    const t3 = ev.find((e: any) => e.instance === 't3');
    const t4 = ev.find((e: any) => e.instance === 't4');
    assert(!!t3 && t3.action === 'publish' && t3.actor === ownerName && t3.type === 'task', `direct .latest write surfaced: ${JSON.stringify(t3)}`);
    assert(!!t4 && t4.action === 'publish' && t4.actor === ownerName && t4.type === 'task', `direct bare write surfaced: ${JSON.stringify(t4)}`);
});

await test('3. a published instance (.version.N + .latest) is NOT double-counted', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/activity?ws=${WS}`, { headers: auth(token) });
    const ev = (r.body.data.events || []).filter((e: any) => e.instance === 't2');
    assert(ev.length === 1, `t2 should yield exactly one event (the publish), got ${ev.length}: ${JSON.stringify(ev)}`);
    assert(ev[0].action === 'publish', `t2 event is a publish, got ${ev[0]?.action}`);
});

await test('4. non-member is denied', async () => {
    const reg2 = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName + 'x', display_name: 'X', password: 'Act12345' }) });
    const tk2 = await ownerSignIn(BASE, ownerName + 'x', 'Act12345');
    const r = await json(`/v1/organisms/${orgId}/workspace/activity?ws=${WS}`, { headers: auth(tk2.body.data.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    await json(`/v1/owners/${ownerName}x`, { method: 'DELETE', headers: auth(tk2.body.data.token) });
});

await test('5. another member\'s private draft and version stay out of the first owner\'s feed', async () => {
    // The route read-authorizes each record of another owner (workspace-ops.ts). Every record above is
    // the reader's own, so this is the only case where that per-record check decides anything.
    const bName = ownerName + 'b';
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: bName, display_name: 'B', password: 'Act12345' }) });
    assert(reg.status === 201, `register B ${reg.status}`);
    const bTok = (await ownerSignIn(BASE, bName, 'Act12345')).body.data.token;
    try {
        const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(bTok), body: '{}' });
        assert(j.status === 200 || j.status === 201, `join ${j.status}: ${JSON.stringify(j.body?.error)}`);
        // A registered workspace (the grant route needs one) that B may write as a contributor.
        const w = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Shared', manifest: { manifestVersion: '1', name: 'Shared', kind: 'project', objectTypes: [{ name: 'task', namespace: 'shared.tasks', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:task@1' }] } }) });
        assert(w.status === 201 && typeof w.body?.data?.ws === 'string', `workspace ${w.status}: ${JSON.stringify(w.body?.error)}`);
        const ws2 = w.body.data.ws as string, root2 = `organism.${orgId}.w.${ws2}`;
        const g = await json(`/v1/organisms/${orgId}/workspace-access/grant`, { method: 'POST', headers: auth(token), body: JSON.stringify({ ws: ws2, grantee: bName, role: 'contributor' }) });
        assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
        await put(token, `${root2}.shared.tasks.ta.version.1`, { id: 'ta', title: 'A own version' });
        await put(bTok, `${root2}.shared.tasks.tb.draft`, { id: 'tb', title: 'B private draft' });
        await put(bTok, `${root2}.shared.tasks.tb.version.1`, { id: 'tb', title: 'B private version' });
        const a = await json(`/v1/organisms/${orgId}/workspace/activity?ws=${ws2}`, { headers: auth(token) });
        assert(a.status === 200, `A activity ${a.status}`);
        const aEv = a.body.data.events || [];
        assert(aEv.some((e: any) => e.instance === 'ta'), `A's own record is in A's feed: ${JSON.stringify(aEv)}`);
        const leaked = aEv.filter((e: any) => e.instance === 'tb');
        assert(leaked.length === 0, `A reads B's private records in the feed: ${JSON.stringify(leaked)}`);
        const b = await json(`/v1/organisms/${orgId}/workspace/activity?ws=${ws2}`, { headers: auth(bTok) });
        assert(b.status === 200, `B activity ${b.status}`);
        const own = (b.body.data.events || []).filter((e: any) => e.instance === 'tb');
        assert(own.length >= 1 && own.every((e: any) => e.actor === bName), `B sees its own records: ${JSON.stringify(own)}`);
    } finally {
        await json(`/v1/owners/${bName}`, { method: 'DELETE', headers: auth(bTok) });
    }
});

await test('Cleanup', async () => { await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: auth(token) }); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
