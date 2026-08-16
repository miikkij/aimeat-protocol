/**
 * @file e2e-organism-batch.ts
 * @description Tests the organism batch endpoints that replace the per-workspace / per-org fetch
 *   fan-out: workspaces?include=enrichment (recs/docs/lastEvent/participants — asserted EQUAL to the
 *   per-ws getWorkspace/activity/participants endpoints), organisms?include=counts, comments/batch,
 *   /organisms/waiting, /agents/activity, and workspace-access?all=1. Security: a non-member is
 *   denied the enriched list and gets no comments from the batch.
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial: parity + security for the N+1 fan-out batch endpoints.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-batch

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
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(p: string, m: string) { return Buffer.from(await ed.signAsync(new TextEncoder().encode(m), Buffer.from(p, 'base64'))).toString('base64'); }
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function newOwner(name: string) {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'Batch12345' }) });
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return tk.body.data.token as string;
}

console.log('\n=== AIMEAT Organism Batch E2E ===\n');
let token = '', ownerName = '', orgId = '';
const WSA = 'ws-a', WSB = 'ws-b';
const rootA = () => `organism.${orgId}.w.${WSA}`;
const SEP = '\u0000';   // matches the backend NUL-joined comments/batch key

await test('Setup: owner + org + two workspaces (ws-a has records + a doc + history; ws-b empty)', async () => {
    ownerName = `batch${Date.now()}`;
    token = await newOwner(ownerName);
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Batch Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    orgId = o.body.data.organism.id;
    // Registry (so the workspaces list enumerates them).
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WSA, name: 'WS A', createdBy: ownerName }, { id: WSB, name: 'WS B', createdBy: ownerName }] }, visibility: 'private' }) });
    const manifest = (id: string) => ({ manifestVersion: '1.0', id, name: id, kind: 'project', status: 'active', objectTypes: [
        { name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
        { name: 'page', schemaRef: 'schema:page@1', namespace: 'shared.pages', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'document' },
    ] });
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${rootA()}.meta.manifest`, value: manifest(WSA), visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${WSB}.meta.manifest`, value: manifest(WSB), visibility: 'private' }) });
    // ws-a content: t1 draft (rec) + t2 published (latest + version.1) (rec + publish event) + d1 doc.
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${rootA()}.shared.tasks.t1.draft`, value: { id: 't1', title: 'WIP' }, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${rootA()}.shared.tasks.t2.latest`, value: { id: 't2', title: 'Done' }, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${rootA()}.shared.pages.d1.latest`, value: { id: 'd1', title: 'Doc' }, visibility: 'private' }) });
    // Write the publish version LAST so it is the newest event → deterministic lastEvent.
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${rootA()}.shared.tasks.t2.version.1`, value: { id: 't2', title: 'Done' }, visibility: 'private' }) });
});

await test('1. enrichment recs/docs EQUAL what GET /workspace returns (parity)', async () => {
    const enr = await json(`/v1/organisms/${orgId}/workspaces?include=enrichment`, { headers: auth(token) });
    assert(enr.status === 200, `enrichment ${enr.status}`);
    const wsA = (enr.body.data.workspaces || []).find((w: any) => w.id === WSA);
    assert(!!wsA && !!wsA.enrichment, 'ws-a carries enrichment');
    // Recompute from GET /workspace exactly as the old frontend did.
    const w = await json(`/v1/organisms/${orgId}/workspace?ws=${WSA}`, { headers: auth(token) });
    const isMem = (ot: any) => !ot?.backing || ot.backing === 'memory';
    const isDoc = (ot: any) => ot?.mode === 'document' || (!ot?.mode && ot?.kind === 'document');
    let recs = 0, docs = 0;
    for (const ot of (w.body.data.manifest?.objectTypes || []).filter(isMem)) {
        const n = new Set([...(w.body.data.drafts?.[ot.name] || []), ...(w.body.data.objects?.[ot.name] || [])].map((d: any) => d.id)).size;
        if (isDoc(ot)) docs += n; else recs += n;
    }
    assert(wsA.enrichment.recs === recs, `recs parity: enrichment ${wsA.enrichment.recs} vs getWorkspace ${recs}`);
    assert(wsA.enrichment.docs === docs, `docs parity: enrichment ${wsA.enrichment.docs} vs getWorkspace ${docs}`);
    assert(wsA.enrichment.hasManifest === true, 'hasManifest true');
    assert(wsA.enrichment.recs === 2 && wsA.enrichment.docs === 1, `expected recs 2 / docs 1, got ${wsA.enrichment.recs}/${wsA.enrichment.docs}`);
});

await test('2. enrichment.lastEvent EQUALS the newest GET /workspace/activity event', async () => {
    const enr = await json(`/v1/organisms/${orgId}/workspaces?include=enrichment`, { headers: auth(token) });
    const wsA = (enr.body.data.workspaces || []).find((w: any) => w.id === WSA);
    const act = await json(`/v1/organisms/${orgId}/workspace/activity?ws=${WSA}`, { headers: auth(token) });
    const newest = (act.body.data.events || [])[0];   // activity is newest-first
    assert(!!wsA.enrichment.lastEvent && !!newest, 'both have a last event');
    assert(wsA.enrichment.lastEvent.instance === newest.instance && wsA.enrichment.lastEvent.action === newest.action,
        `lastEvent parity: ${JSON.stringify(wsA.enrichment.lastEvent)} vs ${JSON.stringify({ instance: newest.instance, action: newest.action })}`);
    assert(wsA.enrichment.lastEvent.action === 'publish' && wsA.enrichment.lastEvent.instance === 't2', 'newest event is the t2 publish');
});

await test('3. enrichment.participants includes the creator (matches GET /workspace/participants)', async () => {
    const enr = await json(`/v1/organisms/${orgId}/workspaces?include=enrichment`, { headers: auth(token) });
    const wsA = (enr.body.data.workspaces || []).find((w: any) => w.id === WSA);
    const me = (wsA.enrichment.participants || []).find((p: any) => p.owner === ownerName);
    assert(!!me && me.isSelf === true && me.isCreator === true, `participant self/creator: ${JSON.stringify(me)}`);
    assert(me.agentsCount === 0, 'no agents wrote → agentsCount 0');
});

await test('4. organisms?include=counts returns workspace_count = 2', async () => {
    const r = await json(`/v1/organisms?member=${ownerName}&include=counts`, { headers: auth(token) });
    const org = (r.body.data.organisms || []).find((o: any) => o.id === orgId);
    assert(!!org && org.workspace_count === 2, `workspace_count: ${org?.workspace_count}`);
});

await test('5. comments/batch returns each requested thread + empty for a missing target', async () => {
    await json(`/v1/organisms/${orgId}/comments`, { method: 'POST', headers: auth(token), body: JSON.stringify({ ws: WSA, space: 'task', instance_id: 't1', body: 'hi t1' }) });
    await json(`/v1/organisms/${orgId}/comments`, { method: 'POST', headers: auth(token), body: JSON.stringify({ ws: WSA, space: 'task', instance_id: 't2', body: 'hi t2' }) });
    const r = await json(`/v1/organisms/${orgId}/comments/batch`, { method: 'POST', headers: auth(token), body: JSON.stringify({ instances: [
        { ws: WSA, space: 'task', instance_id: 't1' }, { ws: WSA, space: 'task', instance_id: 't2' }, { ws: WSA, space: 'task', instance_id: 'nope' },
    ] }) });
    assert(r.status === 200, `batch ${r.status}`);
    const c = r.body.data.comments;
    assert((c[`${WSA}${SEP}task${SEP}t1`]?.comments || []).length === 1, 't1 has 1 comment');
    assert((c[`${WSA}${SEP}task${SEP}t2`]?.comments || []).length === 1, 't2 has 1 comment');
    assert((c[`${WSA}${SEP}task${SEP}nope`]?.total ?? -1) === 0, 'missing target → 0');
});

await test('6. /organisms/waiting returns a flat items array', async () => {
    const r = await json('/v1/organisms/waiting', { headers: auth(token) });
    assert(r.status === 200 && Array.isArray(r.body.data.items), `waiting ${r.status} / ${typeof r.body.data.items}`);
});

await test('7. /agents/activity returns an agents map (empty — only human writes)', async () => {
    const r = await json(`/v1/organisms/${orgId}/agents/activity`, { headers: auth(token) });
    assert(r.status === 200 && r.body.data.agents && typeof r.body.data.agents === 'object', `agents/activity ${r.status}`);
    assert(Object.keys(r.body.data.agents).length === 0, 'no agent writes → empty');
});

await test('8. workspace-access?all=1 returns the owned workspaces rosters', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace-access?all=1`, { headers: auth(token) });
    assert(r.status === 200 && Array.isArray(r.body.data.workspaces), `access all ${r.status}`);
    assert(r.body.data.workspaces.some((w: any) => w.ws === WSA), 'includes ws-a');
});

await test('SECURITY 9. a non-member is denied the enriched list AND gets no comments from the batch', async () => {
    const outsider = await newOwner(`out${Date.now()}`);
    const enr = await json(`/v1/organisms/${orgId}/workspaces?include=enrichment`, { headers: auth(outsider) });
    assert(enr.status === 403, `non-member enriched list expected 403, got ${enr.status}`);
    const c = await json(`/v1/organisms/${orgId}/comments/batch`, { method: 'POST', headers: auth(outsider), body: JSON.stringify({ instances: [{ ws: WSA, space: 'task', instance_id: 't1' }] }) });
    assert(c.status === 200 && Object.keys(c.body.data.comments || {}).length === 0, 'non-member batch returns no comments (ws omitted)');
});

await test('SECURITY 9b. a MEMBER without a workspace grant gets the row but no enrichment', async () => {
    // The only negative principal above is a complete outsider, and the organism membership gate
    // refuses them before the enrichment branch is ever reached. Delete
    // `if (w.access === 'none') { enriched.push({ ...w }); continue; }` from
    // GET /v1/organisms/:id/workspaces?include=enrichment and — this organism is join_policy 'open' —
    // anyone who joins gets recs/docs counts, lastEvent (which carries record titles) and participants
    // for workspaces they were never granted.
    const joiner = await newOwner(`join${Date.now()}`);
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(joiner), body: '{}' });
    assert(j.status === 200 || j.status === 201, `join ${j.status}: ${JSON.stringify(j.body?.error)}`);

    const enr = await json(`/v1/organisms/${orgId}/workspaces?include=enrichment`, { headers: auth(joiner) });
    assert(enr.status === 200, `a member may list the workspaces: ${enr.status}`);
    const row = ((enr.body.data?.workspaces ?? []) as any[]).find(w => w.id === WSA);
    assert(!!row, `ws-a is listed to the member: ${JSON.stringify((enr.body.data?.workspaces ?? []).map((w) => w.id))}`);
    assert(row.access === 'none', `the member has no grant on ws-a: ${row.access}`);
    assert(row.enrichment === undefined && row.lastEvent === undefined && row.participants === undefined,
        `an ungranted workspace was enriched anyway: ${JSON.stringify(row)}`);

    // And the batch keeps its side of it: no comments for a workspace they cannot read.
    const c = await json(`/v1/organisms/${orgId}/comments/batch`, {
        method: 'POST', headers: auth(joiner),
        body: JSON.stringify({ instances: [{ ws: WSA, space: 'task', instance_id: 't1' }] }),
    });
    assert(c.status === 200 && Object.keys(c.body.data.comments || {}).length === 0,
        `the member got comments for an ungranted workspace: ${JSON.stringify(c.body.data.comments)}`);
});

await test('Cleanup', async () => { await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: auth(token) }); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
