/**
 * @file e2e-workspace-export-import.ts
 * @description Round-trip test for workspace ZIP export/import: build a workspace (manifest + locked
 *   schema + a record + a document embedding an image), export it as a ZIP, import it as a new
 *   workspace, and verify the manifest, records, document (with its image URL rewritten to the new
 *   key) and the re-created image all come back, and the re-locked schema still validates writes.
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: export → import round-trip.
 *   v1.1.0 — 2026-07-10 — Tests 9-10: organism export by an active NON-creator member (aggregated
 *     registry + member-read bounding, proven by an import round-trip) and non-member → 403.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-export-import

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
async function sign(privB64: string, msg: string) { return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64'); }
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// 1x1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

console.log('\n=== AIMEAT Workspace Export/Import E2E ===\n');

let token = '', ownerName = '';
let orgId = '';
const WS = 'ws-exp1';
const imgKey = () => `organism.${orgId}.w.${WS}.img.pic1`;

await test('Setup owner + org + workspace (manifest, schema, record, document w/ image)', async () => {
    ownerName = `wsexp${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'WS Exp', password: 'WsExp1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await sign(reg.body.data.private_key, ownerName + NODE_ID + ts) }) });
    token = tk.body.data.token;
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Exp Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    orgId = o.body.data.organism.id;
    // registry + manifest + schema
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Backup Me', createdAt: ts, createdBy: ownerName }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Backup Me', kind: 'project', status: 'active', objectTypes: [
        { name: 'item', schemaRef: 'schema:item@1', namespace: 'shared.items', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
        { name: 'doc', schemaRef: 'schema:doc@1', namespace: 'shared.docs', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'document' },
    ] };
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.readme`, value: '# Backup Me\nimportant', visibility: 'private' }) });
    const sr = await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${WS}.shared.items`)}/schema`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ schema: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } }, apply_to: 'prefix', schema_mode: 'strict' }) });
    assert(sr.status === 200 || sr.status === 201, `schema ${sr.status}`);
    // image
    const up = await json('/v1/storage', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: imgKey(), data: PNG_B64, content_type: 'image/png', visibility: 'private' }) });
    assert(up.status === 200 || up.status === 201, `upload ${up.status}: ${JSON.stringify(up.body.error)}`);
    // a published record + a published document embedding the image
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.shared.items.i1.latest`, value: { id: 'i1', title: 'First item' }, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.shared.docs.doc1.latest`, value: { id: 'doc1', title: 'Spec', markdown: `# Spec\n![pic](/v1/storage/${encodeURIComponent(imgKey())})` }, visibility: 'private' }) });
});

let zipBuf: Buffer;
await test('1. export returns a ZIP', async () => {
    const res = await fetch(`${BASE}/v1/organisms/${orgId}/workspace/export?ws=${WS}`, { headers: auth(token) });
    assert(res.status === 200, `export ${res.status}`);
    assert((res.headers.get('content-type') || '').includes('zip'), 'content-type is zip');
    zipBuf = Buffer.from(await res.arrayBuffer());
    assert(zipBuf.length > 100, `zip has bytes (${zipBuf.length})`);
    // ZIP magic "PK"
    assert(zipBuf[0] === 0x50 && zipBuf[1] === 0x4b, 'starts with PK (zip)');
});

let newWs = '';
await test('2. import the ZIP → a new workspace', async () => {
    const res = await fetch(`${BASE}/v1/organisms/${orgId}/workspace/import`, { method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/zip' }, body: zipBuf });
    const body = await res.json() as any;
    assert(res.status === 201, `import ${res.status}: ${JSON.stringify(body.error)}`);
    newWs = body.data.ws;
    assert(typeof newWs === 'string' && newWs !== WS, 'new ws id differs from the original');
    assert(body.data.images === 1, `1 image re-created, got ${body.data.images}`);
    assert(body.data.schemas === 1, `1 schema re-locked, got ${body.data.schemas}`);
});

await test('3. imported workspace has the manifest, record + document', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${newWs}`, { headers: auth(token) });
    assert(r.status === 200, `read ${r.status}`);
    assert(r.body.data.manifest?.name === 'Backup Me', 'manifest restored');
    assert((r.body.data.objects?.item || []).some((o: any) => o.id === 'i1' && o.title === 'First item'), 'record restored');
    const doc = (r.body.data.objects?.doc || []).find((d: any) => d.id === 'doc1');
    assert(!!doc, 'document restored');
    // image URL rewritten to a key under the NEW workspace
    assert(typeof doc.markdown === 'string' && doc.markdown.includes(`organism.${orgId}.w.${newWs}.img.pic1`), `image URL rewritten to new key: ${doc.markdown}`);
    assert(!doc.markdown.includes(`.w.${WS}.img.`), 'old image key no longer referenced');
});

await test('4. the re-created image is readable under the new key', async () => {
    const newImgKey = `organism.${orgId}.w.${newWs}.img.pic1`;
    const res = await fetch(`${BASE}/v1/storage/${encodeURIComponent(newImgKey)}`, { headers: auth(token) });
    assert(res.status === 200, `image fetch ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert(bytes.length === Buffer.from(PNG_B64, 'base64').length, `image bytes match (${bytes.length})`);
});

await test('5. the re-locked schema still validates writes in the new ws', async () => {
    const ok = await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${newWs}.shared.items.i2.draft`, value: { id: 'i2', title: 'Valid' }, visibility: 'private' }) });
    assert(ok.status === 201 || ok.status === 200, `valid write ${ok.status}`);
    const bad = await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${newWs}.shared.items.bad.draft`, value: { nope: 1 }, visibility: 'private' }) });
    assert(bad.status === 422 || bad.status === 400, `invalid write rejected (got ${bad.status})`);
});

await test('6. base64 export + JSON import round-trip (the MCP/connector path)', async () => {
    const exp = await json(`/v1/organisms/${orgId}/workspace/export?ws=${WS}&format=base64`, { headers: auth(token) });
    assert(exp.status === 200 && typeof exp.body.data.zip_base64 === 'string', `base64 export ${exp.status}`);
    assert(exp.body.data.size_bytes > 0, 'reports size');
    const imp = await json(`/v1/organisms/${orgId}/workspace/import`, { method: 'POST', headers: auth(token), body: JSON.stringify({ zip_base64: exp.body.data.zip_base64 }) });
    assert(imp.status === 201 && typeof imp.body.data.ws === 'string', `json import ${imp.status}: ${JSON.stringify(imp.body.error)}`);
});

// ── Organism-level bundle export/import (Phase 2) ──
let orgZip: Buffer;
await test('7. organism export → ZIP bundling its workspace(s)', async () => {
    const res = await fetch(`${BASE}/v1/organisms/${orgId}/export`, { headers: auth(token) });
    assert(res.status === 200 && (res.headers.get('content-type') || '').includes('zip'), `org export ${res.status}`);
    orgZip = Buffer.from(await res.arrayBuffer());
    assert(orgZip[0] === 0x50 && orgZip[1] === 0x4b, 'PK zip');
});

let newOrgId = '';
await test('8. organism import → a NEW organism with the workspace restored', async () => {
    const res = await fetch(`${BASE}/v1/organisms/import`, { method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/zip' }, body: orgZip });
    const body = await res.json() as any;
    assert(res.status === 201, `org import ${res.status}: ${JSON.stringify(body.error)}`);
    newOrgId = body.data.organism_id;
    assert(typeof newOrgId === 'string' && newOrgId !== orgId, 'new org id differs');
    assert((body.data.workspaces || []).length >= 1, `restored >=1 workspace (${body.data.workspaces?.length})`);
    const wsId = body.data.workspaces[0].ws;
    const r = await json(`/v1/organisms/${newOrgId}/workspace?ws=${wsId}`, { headers: auth(token) });
    assert(r.body.data.manifest?.name === 'Backup Me', 'workspace restored inside the new organism');
    assert((r.body.data.objects?.item || []).some((o: any) => o.id === 'i1'), 'record restored in the new org');
});

// ── Member (non-creator) organism export: the gate is any ACTIVE member, the per-creator registry
// is aggregated, and the bundle carries the creator's records (which the member reads live) ──
let memberToken = '', memberName = '';
await test('9. an active MEMBER (not the creator) exports the organism — bundle contains the creator\'s workspace + records', async () => {
    memberName = `wsexpm${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: memberName, display_name: 'WS Member', password: 'WsExp1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: memberName, display_name: 'WS Member', password: 'WsExp1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: memberName, timestamp: ts, signature: await sign(reg.body.data.private_key, memberName + NODE_ID + ts) }) });
    memberToken = tk.body.data.token;
    const jr = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(memberToken), body: '{}' });
    assert(jr.status < 300, `join ${jr.status}: ${JSON.stringify(jr.body.error)}`);

    const res = await fetch(`${BASE}/v1/organisms/${orgId}/export`, { headers: auth(memberToken) });
    assert(res.status === 200, `member export ${res.status}`);
    const memberZip = Buffer.from(await res.arrayBuffer());
    // ZIP entry names are stored uncompressed — the creator-made workspace must be in the bundle
    // (the per-creator registry is aggregated; reading only the member's own registry gave []).
    assert(memberZip.includes(`workspaces/${WS}/workspace.json`), 'member bundle contains the creator-made workspace');

    // Round-trip: importing the member's bundle restores the creator's records — proof the export
    // carries content the member can read live but does not own.
    const imp = await fetch(`${BASE}/v1/organisms/import`, { method: 'POST', headers: { ...auth(memberToken), 'Content-Type': 'application/zip' }, body: memberZip });
    const impBody = await imp.json() as any;
    assert(imp.status === 201, `member import ${imp.status}: ${JSON.stringify(impBody.error)}`);
    const wsId = impBody.data.workspaces?.[0]?.ws;
    const r = await json(`/v1/organisms/${impBody.data.organism_id}/workspace?ws=${wsId}`, { headers: auth(memberToken) });
    assert((r.body.data.objects?.item || []).some((o: any) => o.id === 'i1'), 'creator record present in the member round-trip');
});

await test('10. a NON-member cannot export the organism (403)', async () => {
    const lv = await json(`/v1/organisms/${orgId}/leave`, { method: 'POST', headers: auth(memberToken), body: '{}' });
    assert(lv.status === 200, `leave ${lv.status}: ${JSON.stringify(lv.body.error)}`);
    const res = await fetch(`${BASE}/v1/organisms/${orgId}/export`, { headers: auth(memberToken) });
    assert(res.status === 403, `expected 403, got ${res.status}`);
});

await test('Cleanup', async () => {
    await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: auth(token) });
    if (memberName) await json(`/v1/owners/${memberName}`, { method: 'DELETE', headers: auth(memberToken) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
