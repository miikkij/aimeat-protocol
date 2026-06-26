/**
 * @file e2e-organism-archive.ts
 * @description E2E for the organism ARCHIVE feature (record / workspace / organism levels). Covers:
 *   archived content drops out of search + workspace read by default but is findable via archive
 *   search (?archived=only) and ?includeArchived=true; the write guard makes archived content
 *   read-only (409 ARCHIVED); workspace archival cascades to its records; SMART RESTORE leaves an
 *   independently-archived record archived when its container is unarchived; organism archive flips
 *   the org flag; and only the creator/admin may archive (non-member 403).
 * @version-history
 *   v1.0.0 — 2026-06-26 — Initial: record/workspace/organism archive + cascade + smart restore + guard.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-archive

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
    const name = `orgarch${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Org Arch', password: 'OrgArch1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Org Arch', password: 'OrgArch1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Organism Archive E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;
let B: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'ws-arch1';
const root = () => `organism.${orgId}.w.${WS}`;
const writeRec = (token: string, id: string, value: unknown) =>
    json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `${root()}.shared.tasks.${id}.latest`, value, visibility: 'private' }) });

await test('Setup: A creates org + workspace + manifest + two records (t1 pineapple, t2 blueberry)', async () => {
    A = await setupOwner('a'); B = await setupOwner('b');
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Archive Org', description: 'x', type: 'project', join_policy: 'approval_required', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Coordination', kind: 'project', status: 'active', objectTypes: [
        { name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
        // A space whose namespace itself starts with `meta.` — regression guard for the archived=only
        // filter (it must keep the manifest/readme by EXACT key, not a `meta.` prefix, or active records
        // from meta.* spaces would leak into the archived view).
        { name: 'goal', schemaRef: 'schema:goal@1', namespace: 'meta.goals', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
    ] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
    assert((await writeRec(A.token, 't1', { id: 't1', title: 'Buy a pineapple', status: 'open' })).status <= 201, 't1');
    assert((await writeRec(A.token, 't2', { id: 't2', title: 'Get blueberry jam', status: 'open' })).status <= 201, 't2');
    // an ACTIVE goal in the meta.goals space — must NEVER appear in an archived-only view
    const g = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.goals.g1.latest`, value: { id: 'g1', title: 'Active goal' }, visibility: 'private' }) });
    assert(g.status <= 201, 'g1');
});

await test('1. Baseline: search + workspace read see both records', async () => {
    const s = await json(`/v1/organisms/${orgId}/search?q=pineapple`, { headers: auth(A.token) });
    assert(s.status === 200 && (s.body.data.results || []).some((x: any) => x.id === 't1'), 'pineapple finds t1');
    const w = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(A.token) });
    assert(w.status === 200 && (w.body.data.objects.task || []).length === 2, `expected 2 tasks, got ${JSON.stringify(w.body.data.objects)}`);
});

await test('2. Archive a single record (t1) — cascade returns count 1', async () => {
    const r = await json(`/v1/organisms/${orgId}/archive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'record', ws: WS, key: `${root()}.shared.tasks.t1` }) });
    assert(r.status === 200, `archive ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.archived >= 1 && r.body.data.level === 'record', `archived ${JSON.stringify(r.body.data)}`);
});

await test('3. Archived record is hidden from default search + workspace read', async () => {
    const s = await json(`/v1/organisms/${orgId}/search?q=pineapple`, { headers: auth(A.token) });
    assert(s.status === 200 && !(s.body.data.results || []).some((x: any) => x.id === 't1'), 'pineapple no longer finds t1');
    const w = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(A.token) });
    assert((w.body.data.objects.task || []).length === 1, `expected 1 active task, got ${(w.body.data.objects.task || []).length}`);
});

await test('4. Archive search (?archived=only) + ?includeArchived=true surface the archived record', async () => {
    const s = await json(`/v1/organisms/${orgId}/search?q=pineapple&archived=only`, { headers: auth(A.token) });
    assert(s.status === 200 && (s.body.data.results || []).some((x: any) => x.id === 't1'), `archive search should find t1, got ${JSON.stringify(s.body.data.results)}`);
    const w = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}&includeArchived=true`, { headers: auth(A.token) });
    assert((w.body.data.objects.task || []).length === 2, `includeArchived should show 2, got ${(w.body.data.objects.task || []).length}`);
    // archived=only must still surface the (active) manifest so the workspace renders, but show ONLY
    // the archived record (the per-record "Archived view" in the UI depends on this).
    const wo = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}&archived=only`, { headers: auth(A.token) });
    assert(!!wo.body.data.manifest, 'archived=only must still return the manifest');
    const onlyIds = (wo.body.data.objects.task || []).map((x: any) => x.id);
    assert(onlyIds.length === 1 && onlyIds[0] === 't1', `archived=only should show ONLY t1, got ${JSON.stringify(onlyIds)}`);
    // the ACTIVE goal in the meta.goals space must NOT leak into archived=only (its namespace starts
    // with `meta.`, which a prefix-based meta filter would wrongly include).
    assert((wo.body.data.objects.goal || []).length === 0, `archived=only must NOT leak active meta.* records, got ${JSON.stringify(wo.body.data.objects.goal)}`);
});

await test('5. Write guard: writing to the archived record is rejected (409 ARCHIVED)', async () => {
    const r = await writeRec(A.token, 't1', { id: 't1', title: 'edited', status: 'open' });
    assert(r.status === 409 && r.body.error?.code === 'ARCHIVED', `expected 409 ARCHIVED, got ${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('6. Unarchive the record restores it', async () => {
    const r = await json(`/v1/organisms/${orgId}/unarchive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'record', ws: WS, key: `${root()}.shared.tasks.t1` }) });
    assert(r.status === 200 && r.body.data.restored >= 1, `unarchive ${r.status}: ${JSON.stringify(r.body)}`);
    const s = await json(`/v1/organisms/${orgId}/search?q=pineapple`, { headers: auth(A.token) });
    assert((s.body.data.results || []).some((x: any) => x.id === 't1'), 't1 searchable again');
});

await test('6b. Record unarchive is root-independent: restores a record archived by a CONTAINER cascade', async () => {
    // archive the whole record-table SPACE (root = space:...) — flags t1 + t2, but NOT the manifest
    const sa = await json(`/v1/organisms/${orgId}/archive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'space', ws: WS, namespace: 'shared.tasks' }) });
    assert(sa.status === 200 && sa.body.data.archived >= 2, `space archive ${sa.status}: ${JSON.stringify(sa.body)}`);
    // record-level unarchive of t1 — key-based, so it restores t1 even though its archivedRoot is the SPACE
    // (the old root-based unarchive would no-op here: rec:...t1 ≠ space:...).
    const u = await json(`/v1/organisms/${orgId}/unarchive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'record', ws: WS, key: `${root()}.shared.tasks.t1` }) });
    assert(u.status === 200 && u.body.data.restored >= 1, `record unarchive ${u.status}: ${JSON.stringify(u.body)}`);
    const w = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(A.token) });
    const ids = (w.body.data.objects.task || []).map((x: any) => x.id);
    assert(ids.includes('t1') && !ids.includes('t2'), `expected t1 restored, t2 still archived; got ${JSON.stringify(ids)}`);
    // cleanup: restore the space (t2 back; t1 already active)
    await json(`/v1/organisms/${orgId}/unarchive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'space', ws: WS, namespace: 'shared.tasks' }) });
});

await test('7. Smart restore: archive t1, then archive the workspace; unarchive workspace leaves t1 archived', async () => {
    // archive t1 independently (root = rec:...t1)
    await json(`/v1/organisms/${orgId}/archive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'record', ws: WS, key: `${root()}.shared.tasks.t1` }) });
    // archive the whole workspace (cascade; root = ws:.../WS) — t1 already archived is NOT re-stamped
    const wa = await json(`/v1/organisms/${orgId}/archive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'workspace', ws: WS }) });
    assert(wa.status === 200 && wa.body.data.archived >= 1, `ws archive ${wa.status}: ${JSON.stringify(wa.body)}`);
    // default workspace read: archived workspace is hidden (no manifest visible)
    const wHidden = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(A.token) });
    assert(!wHidden.body.data.manifest, 'archived workspace hidden from default read');
    // unarchive workspace → t2 + manifest restored, but t1 (its own root) stays archived
    const wu = await json(`/v1/organisms/${orgId}/unarchive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'workspace', ws: WS }) });
    assert(wu.status === 200, `ws unarchive ${wu.status}`);
    const w = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(A.token) });
    const ids = (w.body.data.objects.task || []).map((x: any) => x.id);
    assert(ids.includes('t2') && !ids.includes('t1'), `smart restore: expected t2 active, t1 still archived; got ${JSON.stringify(ids)}`);
    const arch = await json(`/v1/organisms/${orgId}/search?q=pineapple&archived=only`, { headers: auth(A.token) });
    assert((arch.body.data.results || []).some((x: any) => x.id === 't1'), 't1 still in archive after ws unarchive');
    // clean up: restore t1
    await json(`/v1/organisms/${orgId}/unarchive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'record', ws: WS, key: `${root()}.shared.tasks.t1` }) });
});

await test('8. Organism overview surfaces an archived-workspace count', async () => {
    await json(`/v1/organisms/${orgId}/archive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'workspace', ws: WS }) });
    const ov = await json(`/v1/organisms/${orgId}/overview`, { headers: auth(A.token) });
    assert(ov.status === 200 && ov.body.data.archivedWorkspaces >= 1, `overview archivedWorkspaces, got ${JSON.stringify(ov.body.data)}`);
    const inc = await json(`/v1/organisms/${orgId}/overview?includeArchived=true`, { headers: auth(A.token) });
    assert(inc.body.data.workspaces >= 1, 'includeArchived lists the archived workspace');
    await json(`/v1/organisms/${orgId}/unarchive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'workspace', ws: WS }) });
});

await test('9. Archive the whole organism sets the archived flag; unarchive clears it', async () => {
    const a = await json(`/v1/organisms/${orgId}/archive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'organism' }) });
    assert(a.status === 200, `org archive ${a.status}: ${JSON.stringify(a.body.error)}`);
    const g = await json(`/v1/organisms/${orgId}`, { headers: auth(A.token) });
    assert(g.body.data.organism?.archived === true || g.body.data.archived === true, `org should be archived, got ${JSON.stringify(g.body.data).slice(0, 200)}`);
    const u = await json(`/v1/organisms/${orgId}/unarchive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'organism' }) });
    assert(u.status === 200, `org unarchive ${u.status}`);
});

await test('10. A non-member cannot archive (403)', async () => {
    const r = await json(`/v1/organisms/${orgId}/archive`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ level: 'workspace', ws: WS }) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
