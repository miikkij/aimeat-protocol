/**
 * @file test/e2e-datapackage-trusted-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for what a data package read trusts (secaudit2026oct31w2 round 10):
 *     - W2-14 (datapackage:audience-trusts-client-writable-pointer): with the publish gate at
 *       agents-and-apps, an app grant that rewrites a package's `latest.json` or an earlier version's
 *       audience tag through the generic storage routes, or an agent that writes a package of its own
 *       through them, does not make any rows readable to an anonymous caller, and a later public
 *       publish by that app still asks the owner. The packages the owner published keep their
 *       audience, an approved publish request opens its version, and the owner's own delete of the
 *       package files works as before.
 *     - W2-15 (datapackage:reads-skip-classification-reader): with classification on, an agent whose
 *       clearance is below the label of a package's CSV reads no row of it through the REST rows
 *       route, the OData entity set or aimeat_datapackage_export, as GET /v1/pub answers it for the
 *       same bytes. The owner in person and an agent with no clearance read every row as before.
 *     - W2-20 (odata:pinned-feed-public-cache-on-audience-gated-response): a pinned OData answer is
 *       `Cache-Control: public` only for a public package; a members package answers `private` with
 *       `Vary: Authorization`.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-datapackage-trusted-reads
 * @version-history
 *   v1.2.0 -- 2026-11-01 -- A6b: an app that rewrites latest.json to say public while its request waits
 *     does not turn the owner's approval into a success that leaves the version closed.
 *   v1.1.0 -- 2026-11-01 -- A2 reads the package's CSV through GET /v1/pub after the forged pointer: the
 *     package-file read added on main (plan doc-mvwxcas3dom3, D0.4) decided on the pointer's word.
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent } from './helpers/mcp-session.js';
import { appGrantToken } from './helpers/purpose-kit.js';
import { takeOffAudienceCaps } from './helpers/classification-caps.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const short = Date.now().toString(36).slice(-6);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body; headers: Headers }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let parsed: Body;
    try { parsed = JSON.parse(text) as Body; } catch { parsed = { _raw: text }; }
    return { status: res.status, body: parsed, headers: res.headers };
}
const show = (r: { status: number; body: Body }) => `${r.status} ${JSON.stringify(r.body.error ?? r.body.data ?? r.body).slice(0, 300)}`;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const setConfig = (path: string, value: unknown) => call('PUT', '/v1/admin/config', op.token, { changes: [{ path, value }] });
const publish = (token: string, name: string, rows: Array<Record<string, unknown>>, visibility?: string) =>
    call('POST', '/v1/datapackages', token, { name, changes: 'a version', resources: [{ name: 'items', rows }], ...(visibility ? { visibility } : {}) });
/** The storage key of a stored package file, from the /v1/pub/<owner>/<key> URL a publish answered. */
const keyOf = (url: string) => new URL(url).pathname.split('/').slice(4).map(decodeURIComponent).join('/');
const PAGE = '<!DOCTYPE html><html><head><title>dp</title></head><body>dp</body></html>';

console.log('\n=== What a data package read trusts (secaudit2026oct31w2 round 10) ===\n');

let op!: RegisteredOwner, A!: RegisteredOwner, B!: RegisteredOwner;
let app = '';
let writer!: McpAgent;

await test('Setup: an operator, owner A with an app grant (storage:write, not publish:public) and an agent, owner B', async () => {
    op = await registerOwner(BASE, `dptop${short}`);
    A = await registerOwner(BASE, `dpta${short}`);
    B = await registerOwner(BASE, `dptb${short}`);
    app = await appGrantToken(A, `dpt${short}.html`, 'storage:read storage:write memory:read memory:write', PAGE, BASE);
    writer = await makeAgent(BASE, A, ['storage:read', 'storage:write', 'memory:read', 'memory:write']);
    const g = await setConfig('visibility.publish_gate', 'agents-and-apps');
    assert(g.status === 200, `gate: ${show(g)}`);
});

// ── W2-14 ──────────────────────────────────────────────────────────────────────────────────────
console.log('\nW2-14: the audience is what the service wrote');

const P1 = `dptpriv${short}`;
let h1 = '';
let p1csv = '';
await test('A1. Usage: the owner publishes a private package; anonymous gets 404, the owner reads its rows', async () => {
    const r = await publish(A.token, P1, [{ id: 1, label: 'SECRET-ROW' }], 'private');
    assert(r.status === 201, `publish: ${show(r)}`);
    h1 = r.body.data.content_hash;
    p1csv = new URL(r.body.data.resources[0].url).pathname;
    assert((await call('GET', `/v1/datapackages/${A.name}/${P1}/rows/items`)).status === 404, 'anonymous reads the private package');
    const own = await call('GET', `/v1/datapackages/${A.name}/${P1}/rows/items`, A.token);
    assert(own.status === 200 && JSON.stringify(own.body.data.rows).includes('SECRET-ROW'), `owner: ${show(own)}`);
});

await test('A2. Attack: the app rewrites latest.json to say public through POST /v1/storage; anonymous still reads no row', async () => {
    const pointer = { packageId: `pkg:${A.name}/${P1}`, name: P1, contentHash: h1, descriptorUrl: '', updatedAt: new Date().toISOString(), visibility: 'public' };
    const w = await call('POST', '/v1/storage', app, { key: `datapkg/${P1}/latest.json`, data: b64(JSON.stringify(pointer)), mime_type: 'application/json', visibility: 'private' });
    assert(w.status === 201 || w.status === 200, `the generic write: ${show(w)}`);
    for (const path of [`/v1/datapackages/${A.name}/${P1}/rows/items`, `/v1/datapackages/${A.name}/${P1}`, `/v1/odata/${A.name}/${P1}/items`]) {
        const r = await call('GET', path);
        assert(r.status === 404, `anonymous ${path}: ${show(r)}`);
        assert(!JSON.stringify(r.body).includes('SECRET-ROW'), `anonymous ${path}: a private row leaked`);
    }
    // The package's own file through GET /v1/pub asks the package's audience too (file-read.ts).
    const pubPath = p1csv;
    for (const [who, token] of [['anonymous', undefined], ['owner B', B.token]] as const) {
        const r = await call('GET', pubPath, token);        assert(r.status === 403 || r.status === 404, `${who} GET /v1/pub: ${show(r)}`);
        assert(!JSON.stringify(r.body).includes('SECRET-ROW'), `${who} GET /v1/pub: a private row leaked`);
    }
    const own = await call('GET', `/v1/datapackages/${A.name}/${P1}/rows/items`, A.token);
    assert(own.status === 200 && JSON.stringify(own.body.data.rows).includes('SECRET-ROW'), `owner still reads it: ${show(own)}`);
});

await test('A3. Attack: after the forged pointer, a public publish by the app still asks the owner (202) and anonymous gets 404', async () => {
    const r = await publish(app, P1, [{ id: 1, label: 'SECRET-ROW' }, { id: 2, label: 'SECRET-TWO' }], 'public');
    assert(r.status === 202 && r.body.data.publish_request?.kind === 'datapackage', `publish: ${show(r)}`);
    const anon = await call('GET', `/v1/datapackages/${A.name}/${P1}/rows/items`);
    assert(anon.status === 404 && !JSON.stringify(anon.body).includes('SECRET'), `anonymous: ${show(anon)}`);
});

const P2 = `dptver${short}`;
let p2h1 = '';
let p2desc = '';
await test('A4. Attack: the app tags an earlier private version public through PATCH /v1/memory/files/:key; anonymous pinned to it gets 404', async () => {
    const v1 = await publish(A.token, P2, [{ id: 1, label: 'OLD-PRIVATE' }], 'private');
    assert(v1.status === 201, `version 1: ${show(v1)}`);
    p2h1 = v1.body.data.content_hash;
    p2desc = keyOf(v1.body.data.descriptor_url);
    const v2 = await publish(A.token, P2, [{ id: 1, label: 'NOW-PUBLIC' }], 'public');
    assert(v2.status === 201, `version 2: ${show(v2)}`);
    assert((await call('GET', `/v1/datapackages/${A.name}/${P2}/rows/items`)).status === 200, 'anonymous reads the public version');
    const t = await call('PATCH', `/v1/memory/files/${encodeURIComponent(p2desc)}`, app, { tags: ['datapackage-audience:public'] });
    assert(t.status === 200, `tag write: ${show(t)}`);
    const pin = `?version=${encodeURIComponent(p2h1)}`;
    for (const path of [`/v1/datapackages/${A.name}/${P2}/rows/items${pin}`, `/v1/odata/${A.name}/${P2}/items${pin}`]) {
        const r = await call('GET', path);
        assert(r.status === 404 && !JSON.stringify(r.body).includes('OLD-PRIVATE'), `anonymous ${path}: ${show(r)}`);
    }
    const list = await call('GET', `/v1/datapackages/${A.name}/${P2}/versions`);
    assert(list.status === 200 && !(list.body.data.versions as Body[]).some(v => v.contentHash === p2h1), `anonymous versions: ${show(list)}`);
});

await test('A5. Attack: an agent writes a whole package of its own through POST /v1/storage with a public pointer; anonymous reads no row', async () => {
    const name = `dptagent${short}`;
    const hash = 'a'.repeat(64);
    const schema = { fields: [{ name: 'id', type: 'integer' }, { name: 'label', type: 'string' }] };
    const descriptor = {
        name, profile: 'tabular-data-package', created: new Date().toISOString(),
        resources: [{ name: 'items', path: 'data/items.csv', profile: 'tabular-data-resource', format: 'csv', mediatype: 'text/csv', encoding: 'utf-8', schema, rowCount: 1, bytes: 20, hash: 'sha256:x' }],
        aimeat: { packageId: `pkg:x/${name}`, changes: 'forged', producer: { kind: 'agent' }, producedBy: { gaii: writer.gaii, at: '' }, schemaSource: 'declared', contentHash: `sha256:${hash}` },
    };
    const pointer = { packageId: `pkg:x/${name}`, name, contentHash: `sha256:${hash}`, descriptorUrl: '', updatedAt: new Date().toISOString(), visibility: 'public' };
    for (const [key, data, mime] of [
        [`datapkg/${name}/${hash}/data/items.csv`, 'id,label\n1,AGENT-ROW\n', 'text/csv'],
        [`datapkg/${name}/${hash}/datapackage.json`, JSON.stringify(descriptor), 'application/json'],
        [`datapkg/${name}/latest.json`, JSON.stringify(pointer), 'application/json'],
    ] as const) {
        const w = await call('POST', '/v1/storage', writer.token, { key, data: b64(data), mime_type: mime, visibility: 'private' });
        assert(w.status === 201 || w.status === 200, `write ${key}: ${show(w)}`);
    }
    const owner = encodeURIComponent(writer.gaii.split('@')[0]);
    const r = await call('GET', `/v1/datapackages/${owner}/${name}/rows/items`);
    assert(r.status === 404 && !JSON.stringify(r.body).includes('AGENT-ROW'), `anonymous: ${show(r)}`);
});

const P3 = `dptpub${short}`;
await test('A6. Usage: a public package and a members package keep their readers; a declined and an approved request do what they did', async () => {
    const pub = await publish(A.token, P3, [{ id: 1, label: 'OPEN-ROW' }], 'public');
    assert(pub.status === 201, `public: ${show(pub)}`);
    const anon = await call('GET', `/v1/datapackages/${A.name}/${P3}/rows/items`);
    assert(anon.status === 200 && JSON.stringify(anon.body.data.rows).includes('OPEN-ROW'), `anonymous: ${show(anon)}`);
    assert((await call('GET', `/v1/odata/${A.name}/${P3}/items`)).status === 200, 'anonymous OData');
    const mem = await publish(A.token, `dptmem${short}`, [{ id: 1, label: 'MEMBER-ROW' }], 'members');
    assert(mem.status === 201, `members: ${show(mem)}`);
    assert((await call('GET', `/v1/datapackages/${A.name}/dptmem${short}/rows/items`, B.token)).status === 200, 'owner B reads the members package');
    assert((await call('GET', `/v1/datapackages/${A.name}/dptmem${short}/rows/items`)).status === 404, 'anonymous reads the members package');
    const asked = await publish(app, `dptask${short}`, [{ id: 1, label: 'ASKED-ROW' }]);
    assert(asked.status === 202, `asked: ${show(asked)}`);
    assert((await call('GET', `/v1/datapackages/${A.name}/dptask${short}/rows/items`)).status === 404, 'not public while waiting');
    const d = await call('POST', `/v1/publish-requests/${asked.body.data.publish_request.request_id}/decision`, A.token, { decision: 'approve' });
    assert(d.status === 200, `approve: ${show(d)}`);
    const after = await call('GET', `/v1/datapackages/${A.name}/dptask${short}/rows/items`);
    assert(after.status === 200 && JSON.stringify(after.body.data.rows).includes('ASKED-ROW'), `anonymous after approval: ${show(after)}`);
    const list = await call('GET', '/v1/datapackages', A.token);
    const listed = (list.body.data.packages as Body[]).find(p => p.name === P3);
    assert(listed?.visibility === 'public', `the owner's list: ${JSON.stringify(listed)}`);
});

await test('A6b. Attack: the app rewrites latest.json to say public while its request waits; the owner\'s approval still opens the version', async () => {
    const name = `dptwait${short}`;
    const asked = await publish(app, name, [{ id: 1, label: 'WAITED-ROW' }]);
    assert(asked.status === 202, `asked: ${show(asked)}`);
    const hash = asked.body.data.publish_request.version ?? asked.body.data.content_hash;
    assert(typeof hash === 'string' && hash.length > 0, `the asked version: ${show(asked)}`);
    const pointer = { packageId: `pkg:${A.name}/${name}`, name, contentHash: hash, descriptorUrl: 'https://elsewhere.invalid/x', updatedAt: new Date().toISOString(), visibility: 'public' };
    const w = await call('POST', '/v1/storage', app, { key: `datapkg/${name}/latest.json`, data: b64(JSON.stringify(pointer)), mime_type: 'application/json', visibility: 'private' });
    assert(w.status === 201 || w.status === 200, `the generic write: ${show(w)}`);
    const d = await call('POST', `/v1/publish-requests/${asked.body.data.publish_request.request_id}/decision`, A.token, { decision: 'approve' });
    assert(d.status === 200, `approve: ${show(d)}`);
    assert(!JSON.stringify(d.body).includes('elsewhere.invalid'), `the approval answered the pointer's address: ${show(d)}`);
    const after = await call('GET', `/v1/datapackages/${A.name}/${name}/rows/items`);
    assert(after.status === 200 && JSON.stringify(after.body.data.rows).includes('WAITED-ROW'), `anonymous after approval: ${show(after)}`);
});

await test('A7. Usage: the owner deletes the files of a package with the generic storage route, and the package is gone', async () => {
    const files = await call('GET', '/v1/storage', A.token);
    const keys = ((files.body.data?.files ?? []) as Body[]).map(f => f.key as string).filter(k => k.startsWith(`datapkg/${P3}/`));
    assert(keys.length >= 3, `the package files: ${JSON.stringify(keys)}`);
    for (const k of keys) {
        const del = await call('DELETE', `/v1/storage/${k.split('/').map(encodeURIComponent).join('/')}`, A.token);
        assert(del.status === 200 || del.status === 204, `delete ${k}: ${show(del)}`);
    }
    assert((await call('GET', `/v1/datapackages/${A.name}/${P3}/rows/items`)).status === 404, 'the deleted package still answers');
});

// ── W2-20 ──────────────────────────────────────────────────────────────────────────────────────
console.log('\nW2-20: a shared cache stores a pinned feed only for a public package');

await test('O1. A pinned OData answer of a members package is private with Vary: Authorization; of a public package, public', async () => {
    const mem = await publish(A.token, `dptcache${short}`, [{ id: 1, label: 'CACHE-ROW' }], 'members');
    assert(mem.status === 201, `members: ${show(mem)}`);
    const pin = `?version=${encodeURIComponent(mem.body.data.content_hash)}`;
    for (const path of [`/v1/odata/${A.name}/dptcache${short}${pin}`, `/v1/odata/${A.name}/dptcache${short}/$metadata${pin}`, `/v1/odata/${A.name}/dptcache${short}/items${pin}`]) {
        const r = await call('GET', path, B.token);
        assert(r.status === 200, `owner B ${path}: ${show(r)}`);
        const cc = r.headers.get('cache-control') ?? '';
        assert(cc === 'private, max-age=300', `members ${path}: Cache-Control ${cc}`);
        assert(/authorization/i.test(r.headers.get('vary') ?? ''), `members ${path}: Vary ${r.headers.get('vary')}`);
    }
    const pub = await publish(A.token, `dptcachepub${short}`, [{ id: 1, label: 'OPEN' }], 'public');
    assert(pub.status === 201, `public: ${show(pub)}`);
    const r = await call('GET', `/v1/odata/${A.name}/dptcachepub${short}/items?version=${encodeURIComponent(pub.body.data.content_hash)}`);
    assert(r.status === 200 && r.headers.get('cache-control') === 'public, max-age=300', `public pinned: ${r.headers.get('cache-control')}`);
    const unpinned = await call('GET', `/v1/odata/${A.name}/dptcachepub${short}/items`);
    assert(unpinned.headers.get('cache-control') === 'no-cache', `public unpinned: ${unpinned.headers.get('cache-control')}`);
});

// ── W2-15 ──────────────────────────────────────────────────────────────────────────────────────
console.log('\nW2-15: package rows pass the classification reader');

let reader!: McpAgent, plain!: McpAgent;
const PC = `dptlabel${short}`;
let csvKey = '';
await test('C1. Setup: classification on, a private package whose CSV is Confidential, an agent with clearance Internal and one with none', async () => {
    const on = await setConfig('classification.mode', 'all');
    assert(on.status === 200, `classification on: ${show(on)}`);
    await takeOffAudienceCaps(BASE, op.token);
    reader = await makeAgent(BASE, A, ['storage:read', 'memory:read']);
    plain = await makeAgent(BASE, A, ['storage:read', 'memory:read']);
    const r = await publish(A.token, PC, [{ id: 1, label: 'LABELLED-ROW' }], 'private');
    assert(r.status === 201, `publish: ${show(r)}`);
    csvKey = keyOf(r.body.data.resources[0].url);
    const l = await call('PUT', '/v1/classification/label', A.token, { kind: 'file', key: csvKey, owner: A.ghii, label: 'luottamuksellinen' });
    assert(l.status === 200 && l.body.data.applied === true, `label: ${show(l)}`);
    const c = await call('PATCH', `/v1/agents/${reader.name}/clearance`, A.token, { clearance: 'sisainen' });
    assert(c.status === 200, `clearance: ${show(c)}`);
    const pub = await call('GET', `/v1/pub/${A.name}/${csvKey.split('/').map(encodeURIComponent).join('/')}`, reader.token);
    assert(pub.status === 404, `GET /v1/pub answers the agent: ${show(pub)}`);
});

await test('C2. The agent with clearance Internal reads no row through REST rows, the OData entity set or aimeat_datapackage_export', async () => {
    for (const path of [`/v1/datapackages/${A.name}/${PC}/rows/items`, `/v1/odata/${A.name}/${PC}/items`]) {
        const r = await call('GET', path, reader.token);
        assert(r.status === 404 && !JSON.stringify(r.body).includes('LABELLED-ROW'), `${path}: ${show(r)}`);
    }
    const s = await openSession(BASE, reader.token, 'dpt reader');
    for (const format of ['json', 'csv']) {
        const m = await callTool(s, 'aimeat_datapackage_export', { ref: `pkg:${A.name}/${PC}`, resource: 'items', format });
        assert(m.isError && !m.text.includes('LABELLED-ROW'), `aimeat_datapackage_export ${format}: ${m.text.slice(0, 300)}`);
    }
});

await test('C3. Usage: the owner in person and an agent with no clearance read every row, over REST, OData and MCP', async () => {
    for (const token of [A.token, plain.token]) {
        const r = await call('GET', `/v1/datapackages/${A.name}/${PC}/rows/items`, token);
        assert(r.status === 200 && JSON.stringify(r.body.data.rows).includes('LABELLED-ROW'), `rows: ${show(r)}`);
        const o = await call('GET', `/v1/odata/${A.name}/${PC}/items`, token);
        assert(o.status === 200 && JSON.stringify(o.body).includes('LABELLED-ROW'), `odata: ${show(o)}`);
    }
    const s = await openSession(BASE, plain.token, 'dpt plain');
    const m = await callTool(s, 'aimeat_datapackage_export', { ref: `pkg:${A.name}/${PC}`, resource: 'items', format: 'json' });
    assert(!m.isError && m.text.includes('LABELLED-ROW'), `aimeat_datapackage_export: ${m.text.slice(0, 300)}`);
    const u = await callTool(await openSession(BASE, reader.token, 'dpt reader url'), 'aimeat_datapackage_export', { ref: `pkg:${A.name}/${PC}`, resource: 'items', format: 'url' });
    assert(!u.isError && u.text.includes('read_csv'), `format url: ${u.text.slice(0, 300)}`);
});

await test('Cleanup: classification off, the gate off', async () => {
    assert((await setConfig('classification.mode', 'off')).status === 200, 'classification off');
    assert((await setConfig('visibility.publish_gate', 'off')).status === 200, 'gate off');
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);
