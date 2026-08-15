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

// Test 3 asserts only the status, and its own comment concedes archiver may normalise the name away.
// When it does the 422 comes from the FORMAT allowlist, which is test 2's guard, so test 3 passes on
// somebody else's refusal and cannot tell the two apart. This asks the question properly, with a name
// archiver cannot launder and the incident read back to see which guard answered.
//
// archiver sanitises as it writes — resolves `..`, strips leading slashes, turns backslashes into
// forward slashes — so no hostile name survives it. A real attacker writes the ZIP themselves; the
// equivalent here is to let archiver produce a legal name and then patch the bytes, since the name
// sits in the local file header and the central directory and a SAME-LENGTH swap leaves every offset
// intact.
//
// WHAT THIS MEASURED, and why it does not assert PATH_TRAVERSAL. The audit's proposed fix was to
// assert `code === 'PATH_TRAVERSAL'`, and that code cannot be produced through this door. yauzl
// validates entry names before safeUnzip's `entry` handler runs, so isUnsafeName never sees a hostile
// one. Measured 2026-08-15 against safeUnzip directly, all four arms of that guard, each byte-patched
// into a real archive:
//     aa\bb.json  -> yauzl rewrites the backslash, arrives as aa/bb.json -> BAD_FORMAT
//     ../bb.json  -> yauzl refuses the name          -> READ_ERROR
//     /ab/bb.json -> yauzl refuses the name          -> NOT_A_ZIP
//     C:/bb.json  -> yauzl refuses the name          -> READ_ERROR
// isUnsafeName is therefore a belt behind yauzl's braces in all three consumers that call it
// (safe-zip, package-zip, upload-zip — all yauzl with default options). Deleting it, which the audit
// predicted would go unnoticed, changes nothing observable: the archive is still refused. So the
// assertion here is the one that IS true and IS the point — a hostile name is refused for BEING a
// hostile name, not because the workspace format happened to reject it — and it stays true whichever
// layer does the refusing.
function withEntryNameRenamed(zip: Buffer, from: string, to: string): Buffer {
    assert(from.length === to.length, 'the replacement name must be the same length or the offsets move');
    const out = Buffer.from(zip);
    const needle = Buffer.from(from, 'ascii');
    const patch = Buffer.from(to, 'ascii');
    let at = 0, hits = 0;
    while ((at = out.indexOf(needle, at)) !== -1) { patch.copy(out, at); at += patch.length; hits++; }
    assert(hits === 2, `expected the name in the local header and the central directory, found ${hits}`);
    return out;
}

// Both the same length as the legal name they replace, so the byte patch keeps every offset valid.
for (const hostile of ['../bb.json', '/b/bb.json']) {
    await test(`3b. an entry named ${hostile} is refused for its NAME, not by the format allowlist`, async () => {
        const before = await json('/v1/admin/security/incidents', { headers: auth(token) });
        const seen = new Set<string>((before.body.data.incidents ?? []).map((i: any) => i.id as string));

        // A legal name of the same length, then the bytes swapped — archiver would launder anything
        // hostile it was asked to write.
        const clean = await makeZip([{ name: 'aa/bb.json', data: '{"harmless":true}' }]);
        const zip = withEntryNameRenamed(clean, 'aa/bb.json', hostile);
        const r = await importZip(token, orgId, zip);
        assert(r.status === 422, `expected 422, got ${r.status}: ${JSON.stringify(r.body)}`);

        const after = await json('/v1/admin/security/incidents', { headers: auth(token) });
        const fresh = (after.body.data.incidents ?? []).filter((i: any) => !seen.has(i.id));
        assert(fresh.length >= 1, 'the refusal was quarantined as an incident');
        const codes = fresh.map((i: any) => i.code);
        assert(!codes.includes('BAD_FORMAT'),
            `refused by the format allowlist, which says nothing about the name: ${JSON.stringify(codes)}`);
    });
}

await test('4. operator can list the quarantined incidents', async () => {
    const r = await json('/v1/admin/security/incidents', { headers: auth(token) });
    assert(r.status === 200, `incidents ${r.status} (owner must be operator — first registered owner is)`);
    const incs = r.body.data.incidents || [];
    assert(incs.length >= 2, `expected >=2 incidents, got ${incs.length}`);
    assert(incs.every((i: any) => i.type === 'zip_import' && i.code && i.actor), 'incidents carry type + code + actor');
    assert(r.body.data.open >= 2, 'open count reported');
});

// Everything above is one owner refusing one archive, and a 422 says what was refused, never WHO may
// see it afterwards. The incident list carries the actor and the offending entry name of every
// rejected upload on the node, which is a report about other people's failed imports, so the door it
// sits behind is the point of the feature and no test had ever knocked on it as anyone else.
await test('4b. a plain owner cannot read, resolve or delete the incident list', async () => {
    const other = `zipsec2${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: other, display_name: 'ZipSec2', password: 'ZipSec1234' }) });
    assert(reg.status === 201, `second owner ${reg.status}`);
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: other, timestamp: ts, signature: await sign(reg.body.data.private_key, other + NODE_ID + ts) }) });
    const otherToken = tk.body.data.token as string;

    const list = await json('/v1/admin/security/incidents', { headers: auth(otherToken) });
    assert(list.status === 403, `a plain owner read the node's security incidents: ${list.status}`);

    // And not through the write doors either — an id is easy to guess at and the read refusal would
    // mean little if resolving one did not need the same standing.
    const mine = await json('/v1/admin/security/incidents', { headers: auth(token) });
    const id = mine.body.data.incidents[0].id as string;
    const resolve = await json(`/v1/admin/security/incidents/${id}/resolve`, { method: 'POST', headers: auth(otherToken) });
    assert(resolve.status === 403, `a plain owner resolved an incident: ${resolve.status}`);
    const del = await json(`/v1/admin/security/incidents/${id}`, { method: 'DELETE', headers: auth(otherToken) });
    assert(del.status === 403, `a plain owner deleted an incident: ${del.status}`);

    // Unauthenticated is the same answer or better.
    const anon = await json('/v1/admin/security/incidents');
    assert(anon.status === 401 || anon.status === 403, `unauthenticated read: ${anon.status}`);

    await json(`/v1/owners/${other}`, { method: 'DELETE', headers: auth(otherToken) });
});

await test('5. resolve + delete an incident', async () => {
    const list = await json('/v1/admin/security/incidents', { headers: auth(token) });
    const id = list.body.data.incidents[0].id;
    const rv = await json(`/v1/admin/security/incidents/${id}/resolve`, { method: 'POST', headers: auth(token) });
    assert(rv.status === 200 && rv.body.data.resolved === true, `resolve ${rv.status}`);
    const del = await json(`/v1/admin/security/incidents/${id}`, { method: 'DELETE', headers: auth(token) });
    assert(del.status === 200 && del.body.data.deleted === true, `delete ${del.status}`);
});

// THE POSITIVE CONTROL, which this file had none of. Every other test here asserts a REJECTION, so
// making importWorkspace throw ZipSecurityError for every input keeps all of them green: 1, 2 and 3
// still get their 422 with a quarantine message, 4 and 5 still have incidents to list and resolve,
// and workspace import is completely dead while the suite reports success. A hardening suite that
// cannot tell "refuses the dangerous thing" from "refuses everything" is measuring the wrong half.
await test('6. a LEGITIMATE workspace ZIP still imports (the guards are not a ban)', async () => {
    const ts = new Date().toISOString();
    const ws = 'ws-zipsec';
    await json('/v1/memory', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({
            key: `organism.${orgId}.meta.workspaces`,
            value: { workspaces: [{ id: ws, name: 'Zip Sec Control', createdAt: ts, createdBy: ownerName }] },
            visibility: 'private',
        }),
    });
    await json('/v1/memory', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({
            key: `organism.${orgId}.w.${ws}.meta.manifest`,
            value: {
                manifestVersion: '1.0', id: orgId, name: 'Zip Sec Control', kind: 'project', status: 'active',
                objectTypes: [{
                    name: 'item', schemaRef: 'schema:item@1', namespace: 'shared.items', backing: 'memory',
                    writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records',
                }],
            },
            visibility: 'private',
        }),
    });
    await json('/v1/memory', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({
            key: `organism.${orgId}.w.${ws}.shared.items.i1.latest`,
            value: { id: 'i1', title: 'Survives a round trip' }, visibility: 'private',
        }),
    });

    const exp = await json(`/v1/organisms/${orgId}/workspace/export?ws=${ws}&format=base64`, { headers: auth(token) });
    assert(exp.status === 200, `export ${exp.status}: ${JSON.stringify(exp.body.error)}`);
    const b64 = exp.body.data.zip_base64 as string;
    assert(typeof b64 === 'string' && b64.length > 100, `export produced bytes (${b64?.length})`);

    const imp = await json(`/v1/organisms/${orgId}/workspace/import`, {
        method: 'POST', headers: auth(token), body: JSON.stringify({ zip_base64: b64 }),
    });
    assert(imp.status === 201, `a clean workspace ZIP must import, got ${imp.status}: ${JSON.stringify(imp.body.error)}`);
    const newWs = imp.body.data.ws as string;
    assert(typeof newWs === 'string' && newWs !== ws, `import made a new workspace, got ${newWs}`);

    // And the bytes came back, not just a 201: the record has to be readable in the restored copy.
    const back = await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${newWs}.shared.items.i1.latest`)}`, { headers: auth(token) });
    assert(back.status === 200, `the restored record reads back, got ${back.status}`);
    assert(back.body.data?.value?.title === 'Survives a round trip',
        `restored value: ${JSON.stringify(back.body.data?.value)}`);
});

await test('Cleanup', async () => { await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: auth(token) }); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
