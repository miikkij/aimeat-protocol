/**
 * @file e2e-zip-security.ts
 * @description Security tests for ZIP import hardening: a non-ZIP, a path-traversal entry, and an
 *   out-of-format entry are all REJECTED (422 ZIP_REJECTED) — never processed — and each rejection
 *   records a quarantined security incident the operator can list on the admin Security endpoint.
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: bomb/traversal/format rejection + incident logging.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=zip-security

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
import { ZipArchive } from 'archiver';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string) { return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64'); }
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

function makeZip(entries: { name: string; data: Buffer | string }[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const a = new ZipArchive({ zlib: { level: 9 } });
        const chunks: Buffer[] = [];
        a.on('data', (c: Buffer) => chunks.push(c)); a.on('end', () => resolve(Buffer.concat(chunks))); a.on('error', reject);
        for (const e of entries) a.append(e.data, { name: e.name });
        a.finalize();
    });
}
async function importZip(token: string, orgId: string, zip: Buffer) {
    const res = await fetch(`${BASE}/v1/organisms/${orgId}/workspace/import`, { method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/zip' }, body: zip });
    return { status: res.status, body: await res.json() as any };
}

console.log('\n=== AIMEAT ZIP Security E2E ===\n');

let token = '', ownerName = '', orgId = '';

await test('Setup owner (operator) + org', async () => {
    ownerName = `zipsec${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'ZipSec', password: 'ZipSec1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await sign(reg.body.data.private_key, ownerName + NODE_ID + ts) }) });
    token = tk.body.data.token;
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'ZipSec Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    orgId = o.body.data.organism.id;
});

await test('1. a non-ZIP body is rejected (not processed)', async () => {
    const r = await importZip(token, orgId, Buffer.from('this is definitely not a zip archive'));
    assert(r.status === 422, `expected 422, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'ZIP_REJECTED', `code ${r.body.error?.code}`);
});

await test('2. an out-of-format entry is rejected (format allowlist)', async () => {
    const zip = await makeZip([{ name: 'workspace.json', data: '{}' }, { name: 'totally-unexpected.exe', data: Buffer.from([0x4d, 0x5a]) }]);
    const r = await importZip(token, orgId, zip);
    assert(r.status === 422, `expected 422, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(/quarantined/i.test(r.body.error?.message || ''), 'message mentions quarantine');
});

await test('3. a path-traversal / absolute entry is rejected', async () => {
    // archiver may normalise the name; either way it must NOT be an allowed entry → rejected.
    const zip = await makeZip([{ name: '../../etc/passwd', data: 'root:x:0:0' }]);
    const r = await importZip(token, orgId, zip);
    assert(r.status === 422, `expected 422, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('4. operator can list the quarantined incidents', async () => {
    const r = await json('/v1/admin/security/incidents', { headers: auth(token) });
    assert(r.status === 200, `incidents ${r.status} (owner must be operator — first registered owner is)`);
    const incs = r.body.data.incidents || [];
    assert(incs.length >= 2, `expected >=2 incidents, got ${incs.length}`);
    assert(incs.every((i: any) => i.type === 'zip_import' && i.code && i.actor), 'incidents carry type + code + actor');
    assert(r.body.data.open >= 2, 'open count reported');
});

await test('5. resolve + delete an incident', async () => {
    const list = await json('/v1/admin/security/incidents', { headers: auth(token) });
    const id = list.body.data.incidents[0].id;
    const rv = await json(`/v1/admin/security/incidents/${id}/resolve`, { method: 'POST', headers: auth(token) });
    assert(rv.status === 200 && rv.body.data.resolved === true, `resolve ${rv.status}`);
    const del = await json(`/v1/admin/security/incidents/${id}`, { method: 'DELETE', headers: auth(token) });
    assert(del.status === 200 && del.body.data.deleted === true, `delete ${del.status}`);
});

await test('Cleanup', async () => { await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: auth(token) }); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
