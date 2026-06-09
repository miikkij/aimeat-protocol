/**
 * @file e2e-workspace-update.ts
 * @description Tests PUT /v1/organisms/:id/workspace — in-place name + readme update: the name syncs
 *   to BOTH the manifest and the registry, the readme is replaced, and the id / objectTypes / content
 *   are untouched. Creator-only (a plain member gets 403); empty update is rejected.
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-update

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
async function mkOwner(name: string) {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'WsUpd1234' }) });
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return tk.body.data.token as string;
}

console.log('\n=== AIMEAT Workspace Update E2E ===\n');
let creator = '', creatorTok = '', memberName = '', memberTok = '', orgId = '';
const WS = 'ws-upd1', root = () => `organism.${orgId}.w.${WS}`;

await test('Setup creator + org + workspace (manifest + readme + registry)', async () => {
    creator = `wsupd${Date.now()}`;
    creatorTok = await mkOwner(creator);
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(creatorTok), body: JSON.stringify({ name: 'Upd Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    orgId = o.body.data.organism.id;
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Old Name', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', mode: 'records', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true }] };
    const m = await json('/v1/memory', { method: 'POST', headers: auth(creatorTok), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(m.status === 200 || m.status === 201, `manifest write ${m.status}: ${JSON.stringify(m.body)}`);
    await json('/v1/memory', { method: 'POST', headers: auth(creatorTok), body: JSON.stringify({ key: `${root()}.meta.readme`, value: '# Old Name\n\nold intro', visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth(creatorTok), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Old Name', createdBy: creator, createdAt: new Date().toISOString() }] }, visibility: 'private' }) });
});

await test('1. creator renames + rewrites readme — synced to manifest + registry, content untouched', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { method: 'PUT', headers: auth(creatorTok), body: JSON.stringify({ name: 'New Name', readme: '# New Name\n\nfresh intro' }) });
    assert(r.status === 200, `update ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.updated.includes('manifest') && r.body.data.updated.includes('registry') && r.body.data.updated.includes('readme'), `updated set: ${JSON.stringify(r.body.data.updated)}`);
    // manifest: name changed, objectTypes + id preserved
    const man = (await json(`/v1/memory/${encodeURIComponent(`${root()}.meta.manifest`)}`, { headers: auth(creatorTok) })).body.data.value;
    assert(man.name === 'New Name', `manifest name ${man.name}`);
    assert(Array.isArray(man.objectTypes) && man.objectTypes[0].name === 'task', 'objectTypes preserved');
    // registry: name changed, id preserved
    const reg = (await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.meta.workspaces`)}`, { headers: auth(creatorTok) })).body.data.value;
    const entry = reg.workspaces.find((w: any) => w.id === WS);
    assert(entry && entry.name === 'New Name' && entry.id === WS && entry.createdBy === creator, `registry entry ${JSON.stringify(entry)}`);
    // readme replaced
    const readme = (await json(`/v1/memory/${encodeURIComponent(`${root()}.meta.readme`)}`, { headers: auth(creatorTok) })).body.data.value;
    assert(/fresh intro/.test(readme), `readme ${readme}`);
});

await test('2. readme-only update leaves the name alone', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { method: 'PUT', headers: auth(creatorTok), body: JSON.stringify({ readme: '# New Name\n\nonly readme changed' }) });
    assert(r.status === 200 && r.body.data.updated.includes('readme') && !r.body.data.updated.includes('manifest'), `updated ${JSON.stringify(r.body.data.updated)}`);
    const man = (await json(`/v1/memory/${encodeURIComponent(`${root()}.meta.manifest`)}`, { headers: auth(creatorTok) })).body.data.value;
    assert(man.name === 'New Name', 'name unchanged after readme-only update');
});

await test('2b. manifest update ADDS a space (objectType) in place, id preserved', async () => {
    const man = (await json(`/v1/memory/${encodeURIComponent(`${root()}.meta.manifest`)}`, { headers: auth(creatorTok) })).body.data.value;
    const before = man.objectTypes.length;
    const newManifest = { ...man, objectTypes: [...man.objectTypes, { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', mode: 'document', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true }] };
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { method: 'PUT', headers: auth(creatorTok), body: JSON.stringify({ manifest: newManifest }) });
    assert(r.status === 200 && r.body.data.updated.includes('manifest'), `update ${r.status}: ${JSON.stringify(r.body)}`);
    const man2 = (await json(`/v1/memory/${encodeURIComponent(`${root()}.meta.manifest`)}`, { headers: auth(creatorTok) })).body.data.value;
    assert(man2.objectTypes.length === before + 1 && man2.objectTypes.some((o: any) => o.name === 'note'), `space added: ${man2.objectTypes.map((o: any) => o.name).join(',')}`);
    assert(man2.id === orgId && man2.name === 'New Name', 'id + name preserved');
});

await test('3. empty update (no name/readme) is rejected', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { method: 'PUT', headers: auth(creatorTok), body: JSON.stringify({}) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('4. a plain member (not the creator) is denied', async () => {
    memberName = creator + 'm';
    memberTok = await mkOwner(memberName);
    await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(memberTok), body: JSON.stringify({}) });
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { method: 'PUT', headers: auth(memberTok), body: JSON.stringify({ name: 'Hijack' }) });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('Cleanup', async () => {
    await json(`/v1/owners/${memberName}`, { method: 'DELETE', headers: auth(memberTok) });
    await json(`/v1/owners/${creator}`, { method: 'DELETE', headers: auth(creatorTok) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
