/**
 * @file e2e-publish-gate-packages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the publish gate on the three package kinds (plan doc-mvcn6c7e4e5q, V4): a
 *   package group, a knowledge package (its listing and its entries) and a data package. For each:
 *     - gate off (the code default): an agent without publish:public makes it public at once;
 *     - gate agents-and-apps: the same act answers 202 with a publish request, the target is stored
 *       at the level it had (a new one private or unlisted), and anonymous cannot read it;
 *     - the owner approves: it is public and anonymous reads it;
 *     - a target changed after the request is not published by its approval (409 OUTDATED);
 *     - an agent holding publish:public, and the owner in person, make it public at once;
 *     - every route and MCP tool of the capability asks: POST /v1/packages, POST
 *       /v1/packages/compose, POST /v1/packages/compose-set, PATCH /v1/packages/:groupId,
 *       aimeat_package_compose, POST /v1/knowledge/import, PATCH /v1/knowledge/:id/sharing, PATCH
 *       /v1/knowledge/:id/entries/:entryKey/visibility, POST /v1/datapackages and
 *       aimeat_datapackage_publish;
 *     - the refusals: the asker cannot approve its own request (403 OWN_REQUEST); an agent of another
 *       owner cannot widen A's package (403 FORBIDDEN).
 *     - an approval opens only the version it names: an earlier private version stays closed to the
 *       anonymous caller, another owner and the owner's agent without storage:read, pinned or listed
 *       (secaudit 2026-10 v42).
 * @version-history
 *   v1.1.0 — 2026-10-20 — D5: approving version 2 public opens no earlier private version (secaudit 2026-10 v42).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: packages, knowledge, data packages).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-publish-gate-packages

import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40467';
const stamp = Date.now();
const short = stamp.toString(36).slice(-6);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<{ status: number; body: Body }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
const show = (r: { status: number; body: Body }) => `${r.status} ${JSON.stringify(r.body.error ?? r.body.data ?? r.body).slice(0, 400)}`;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

console.log('\n=== AIMEAT Publish Gate (packages, knowledge, data packages) E2E ===\n');

let op!: Awaited<ReturnType<typeof registerOwner>>;
let A!: Awaited<ReturnType<typeof registerOwner>>;
let B!: Awaited<ReturnType<typeof registerOwner>>;
let asker!: Awaited<ReturnType<typeof makeAgent>>;
let publisher!: Awaited<ReturnType<typeof makeAgent>>;
let outsider!: Awaited<ReturnType<typeof makeAgent>>;
const WORDS = ['packages:write', 'app:write', 'memory:read', 'memory:write', 'storage:write'];
const APP = `pgp-app-${short}.html`;

const setGate = (value: string) => call('/v1/admin/config', { token: op.token, method: 'PUT', body: { changes: [{ path: 'visibility.publish_gate', value }] } });
const decide = (id: string, token: string, decision: 'approve' | 'decline') =>
    call(`/v1/publish-requests/${id}/decision`, { token, method: 'POST', body: { decision } });

// ── fixtures per kind ──────────────────────────────────────────────────────────────────────────
const component = (id: string) => ({ id, type: 'memory', label: id, content: JSON.stringify({ entries: [{ key: `pgp.${id}`, value: { n: 1 } }] }), dependencies: [] });
const createPkg = (token: string, name: string, visibility?: string) => call('/v1/packages', {
    token, method: 'POST', body: { name, description: 'publish gate fixture', category: 'other', components: [component(name)], ...(visibility ? { visibility } : {}) },
});
const anonPkg = (group: string) => call(`/v1/packages/${encodeURIComponent(group)}`);

const importKnowledge = (token: string, name: string, audience: string, entries: Array<{ key: string; visibility: string }>) => call('/v1/knowledge/import', {
    token, method: 'POST',
    body: {
        package: {
            type: 'knowledge-package', name, version: '1.0.0', content_type: 'idea', tags: [`pgk${short}`], language: 'en', maturity: 'draft',
            synthesis: { level: 'original', description: 'test' }, references: [], links: [],
            entries: entries.map(e => ({ ...e, title: e.key })),
            sharing: { catalog_listed: false, allow_clone: false, toll_morsels: 0, audience },
        },
        entry_data: Object.fromEntries(entries.map(e => [e.key, { title: e.key, description: `body of ${e.key}` }])),
    },
});
const anonKnowledge = (id: string) => call(`/v1/knowledge/${id}`);
const anonEntry = (ns: string, id: string, key: string) => call(`/v1/memory/${encodeURIComponent(ns)}/${encodeURIComponent(`packages/${id}/${key}`)}`);

const publishData = (token: string, name: string, rows: Array<Record<string, unknown>>, visibility?: string) => call('/v1/datapackages', {
    token, method: 'POST', body: { name, changes: 'a version', resources: [{ name: 'items', rows }], ...(visibility ? { visibility } : {}) },
});
const anonData = (name: string) => call(`/v1/datapackages/${A.name}/${name}`);
const ROWS = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }];

await test('Setup: an operator, owner A with an asker and a publisher agent and an app, owner B with an agent', async () => {
    op = await registerOwner(BASE, `pgpop${short}`);
    A = await registerOwner(BASE, `pgpa${short}`);
    B = await registerOwner(BASE, `pgpb${short}`);
    asker = await makeAgent(BASE, A, WORDS);
    publisher = await makeAgent(BASE, A, [...WORDS, 'publish:public']);
    outsider = await makeAgent(BASE, B, WORDS);
    const app = await call('/v1/apps', { token: A.token, body: { filename: APP, content: b64(`<!DOCTYPE html><html><head><title>pgp</title></head><body>${APP}</body></html>`), mime_type: 'text/html', description: 'Publish gate fixture' } });
    assert(app.status === 201, `app: ${show(app)}`);
});

console.log('\nGate off (the code default)');

await test('Gate off: an agent without publish:public makes a package, a knowledge package and a data package public at once', async () => {
    const p = await createPkg(asker.token, `pgpoff${short}`, 'public');
    assert(p.status === 201 && p.body.data.visibility === 'public' && !p.body.data.publish_request, `package: ${show(p)}`);
    assert((await anonPkg(p.body.data.packageGroupId)).status === 200, 'anonymous reads the package');
    const k = await importKnowledge(asker.token, 'Off Knowledge', 'public', [{ key: 'open', visibility: 'public' }]);
    assert(k.status === 201 && k.body.data.catalog_listed === true && !k.body.data.publish_request, `knowledge: ${show(k)}`);
    assert((await anonKnowledge(k.body.data.package_id)).status === 200, 'anonymous reads the knowledge package');
    const d = await publishData(asker.token, `pgpoffdata${short}`, ROWS);
    assert(d.status === 201 && !d.body.data.publish_request, `data package: ${show(d)}`);
    assert((await anonData(`pgpoffdata${short}`)).status === 200, 'anonymous reads the data package');
});

await test('Gate agents-and-apps is set', async () => {
    const g = await setGate('agents-and-apps');
    assert(g.status === 200, `gate: ${show(g)}`);
});

// ── Packages ───────────────────────────────────────────────────────────────────────────────────
console.log('\nPackages');

let pkgRequest = '';
let pkgGroup = '';
await test('P1. POST /v1/packages public by the asker: 202 with a request, the group is private, anonymous gets 404', async () => {
    const r = await createPkg(asker.token, `pgpask${short}`, 'public');
    assert(r.status === 202, `create: ${show(r)}`);
    assert(r.body.data.visibility === 'private', `stored as ${r.body.data.visibility}`);
    const pr = r.body.data.publish_request;
    assert(pr?.status === 'awaiting_owner' && pr.kind === 'package' && typeof pr.approve_url === 'string', `request: ${JSON.stringify(pr)}`);
    pkgRequest = pr.request_id;
    pkgGroup = r.body.data.packageGroupId;
    const anon = await anonPkg(pkgGroup);
    assert(anon.status === 404, `anonymous read of the waiting package: ${show(anon)}`);
});

await test('P2. The asker cannot approve its own request (403); the owner approves and the package is public', async () => {
    const own = await call(`/v1/publish-requests/${pkgRequest}/decision`, { token: asker.token, method: 'POST', body: { decision: 'approve' } });
    assert(own.status === 403 && own.body.error?.code === 'OWN_REQUEST', `own: ${show(own)}`);
    const d = await decide(pkgRequest, A.token, 'approve');
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${show(d)}`);
    const anon = await anonPkg(pkgGroup);
    assert(anon.status === 200 && anon.body.data.visibility === 'public', `anonymous after approval: ${show(anon)}`);
});

await test('P3. A package that got a new version after the request is not published by its approval (409 OUTDATED)', async () => {
    const r = await createPkg(asker.token, `pgpchanged${short}`, 'public');
    assert(r.status === 202, `create: ${show(r)}`);
    const group = r.body.data.packageGroupId;
    const v = await call(`/v1/packages/${encodeURIComponent(group)}/versions`, { token: asker.token, method: 'POST', body: { components: [component('changed')], status: 'published' } });
    assert(v.status === 201, `new version: ${show(v)}`);
    const d = await decide(r.body.data.publish_request.request_id, A.token, 'approve');
    assert(d.status === 409 && d.body.error?.code === 'OUTDATED', `approve: ${show(d)}`);
    assert((await anonPkg(group)).status === 404, 'still not public');
});

await test('P4. PATCH /v1/packages/:groupId asks: the description changes, the visibility stays; another owner\'s agent is refused (403)', async () => {
    const r = await createPkg(asker.token, `pgppatch${short}`);
    assert(r.status === 201 && r.body.data.visibility === 'private', `create: ${show(r)}`);
    const group = r.body.data.packageGroupId;
    const p = await call(`/v1/packages/${encodeURIComponent(group)}`, { token: asker.token, method: 'PATCH', body: { visibility: 'public', description: 'patched' } });
    assert(p.status === 202 && p.body.data.visibility === 'private' && p.body.data.description === 'patched' && p.body.data.publish_request?.kind === 'package', `patch: ${show(p)}`);
    const theirs = await call(`/v1/packages/${encodeURIComponent(group)}`, { token: outsider.token, method: 'PATCH', body: { visibility: 'public' } });
    assert(theirs.status === 403 && theirs.body.error?.code === 'FORBIDDEN', `another owner's agent: ${show(theirs)}`);
    const d = await decide(p.body.data.publish_request.request_id, A.token, 'decline');
    assert(d.status === 200 && d.body.data.request.state === 'declined', `decline: ${show(d)}`);
    assert((await anonPkg(group)).status === 404, 'still private after the decline');
});

await test('P5. The publisher (publish:public) and the owner in person create a public package at once', async () => {
    const p = await createPkg(publisher.token, `pgppub${short}`, 'public');
    assert(p.status === 201 && p.body.data.visibility === 'public' && !p.body.data.publish_request, `publisher: ${show(p)}`);
    const o = await createPkg(A.token, `pgpowner${short}`, 'public');
    assert(o.status === 201 && o.body.data.visibility === 'public', `owner: ${show(o)}`);
});

await test('P6. POST /v1/packages/compose asks the same way', async () => {
    const r = await call('/v1/packages/compose', { token: asker.token, method: 'POST', body: { name: `pgpcomp${short}`, apps: [APP], visibility: 'public' } });
    assert(r.status === 202 && r.body.data.visibility === 'private' && r.body.data.publish_request?.kind === 'package', `compose: ${show(r)}`);
    assert((await anonPkg(r.body.data.packageGroupId)).status === 404, 'composed package not public');
});

await test('P6b. aimeat_package_compose asks the same way', async () => {
    const s = await openSession(BASE, asker.token);
    const m = await callTool(s, 'aimeat_package_compose', { name: `pgpmcp${short}`, apps: [APP], visibility: 'public' });
    assert(!m.isError && m.data.visibility === 'private' && m.data.publish_request?.kind === 'package', `aimeat_package_compose: ${m.text.slice(0, 400)}`);
    assert((await anonPkg(m.data.group_id ?? `pgpmcp${short}::${A.name}`)).status === 404, 'MCP-composed package not public');
});

await test('P7. POST /v1/packages/compose-set asks for each group it creates, the set first', async () => {
    const r = await call('/v1/packages/compose-set', { token: asker.token, method: 'POST', body: { name: `pgpset${short}`, apps: [APP], title: 'Gate set', visibility: 'public' } });
    assert(r.status === 202, `compose-set: ${show(r)}`);
    const all = r.body.data.publish_requests as Body[];
    assert(Array.isArray(all) && all.length === 2 && r.body.data.publish_request.request_id === all[0].request_id, `requests: ${JSON.stringify(all)}`);
    assert((await anonPkg(r.body.data.set.group_id)).status === 404, 'the set is not public');
});

// ── Knowledge packages ─────────────────────────────────────────────────────────────────────────
console.log('\nKnowledge packages');

let kId = '';
let kRequest = '';
await test('K1. POST /v1/knowledge/import listed with a public entry by the asker: 202, unlisted, the entry private', async () => {
    const r = await importKnowledge(asker.token, 'Asked Knowledge', 'public', [{ key: 'open', visibility: 'public' }, { key: 'mine', visibility: 'private' }]);
    assert(r.status === 202, `import: ${show(r)}`);
    assert(r.body.data.catalog_listed === false && r.body.data.audience === 'owner', `stored as ${r.body.data.audience}`);
    assert(r.body.data.publish_request?.kind === 'knowledge', `request: ${JSON.stringify(r.body.data.publish_request)}`);
    kId = r.body.data.package_id;
    kRequest = r.body.data.publish_request.request_id;
    assert((await anonKnowledge(kId)).status === 404, 'anonymous reads the waiting package');
    assert((await anonEntry(asker.gaii, kId, 'open')).status !== 200, 'anonymous reads the waiting entry');
});

await test('K2. The owner approves: the package is listed and the entry public; the private entry stays private', async () => {
    const d = await decide(kRequest, A.token, 'approve');
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${show(d)}`);
    const k = await anonKnowledge(kId);
    assert(k.status === 200, `anonymous reads the package: ${show(k)}`);
    assert((await anonEntry(asker.gaii, kId, 'open')).status === 200, 'anonymous reads the approved entry');
    assert((await anonEntry(asker.gaii, kId, 'mine')).status !== 200, 'the private entry stayed private');
});

let k2Id = '';
await test('K3. PATCH /v1/knowledge/:id/sharing to public asks; the owner approves', async () => {
    const r = await importKnowledge(asker.token, 'Sharing Knowledge', 'owner', [{ key: 'note', visibility: 'private' }]);
    assert(r.status === 201 && !r.body.data.publish_request, `import: ${show(r)}`);
    k2Id = r.body.data.package_id;
    const p = await call(`/v1/knowledge/${k2Id}/sharing`, { token: asker.token, method: 'PATCH', body: { catalog_listed: true } });
    assert(p.status === 202 && p.body.data.audience === 'owner' && p.body.data.publish_request?.kind === 'knowledge', `sharing: ${show(p)}`);
    assert((await anonKnowledge(k2Id)).status === 404, 'not listed while waiting');
    const d = await decide(p.body.data.publish_request.request_id, A.token, 'approve');
    assert(d.status === 200, `approve: ${show(d)}`);
    assert((await anonKnowledge(k2Id)).status === 200, 'listed after approval');
});

await test('K4. PATCH of an entry to public asks; an entry changed since is not published (409 OUTDATED)', async () => {
    const p = await call(`/v1/knowledge/${k2Id}/entries/note/visibility`, { token: asker.token, method: 'PATCH', body: { visibility: 'public' } });
    assert(p.status === 202 && p.body.data.visibility === 'private' && p.body.data.publish_request?.kind === 'knowledge', `entry: ${show(p)}`);
    assert((await anonEntry(asker.gaii, k2Id, 'note')).status !== 200, 'the entry is not public while waiting');
    const changed = await call(`/v1/knowledge/${k2Id}/entries/note/visibility`, { token: asker.token, method: 'PATCH', body: { visibility: 'owner' } });
    assert(changed.status === 200, `change: ${show(changed)}`);
    const d = await decide(p.body.data.publish_request.request_id, A.token, 'approve');
    assert(d.status === 409 && d.body.error?.code === 'OUTDATED', `approve: ${show(d)}`);
    assert((await anonEntry(asker.gaii, k2Id, 'note')).status !== 200, 'still not public');
});

await test('K5. The publisher and the owner in person import a listed package at once', async () => {
    const p = await importKnowledge(publisher.token, 'Publisher Knowledge', 'public', [{ key: 'a', visibility: 'public' }]);
    assert(p.status === 201 && p.body.data.catalog_listed === true, `publisher: ${show(p)}`);
    const o = await importKnowledge(A.token, 'Owner Knowledge', 'public', [{ key: 'b', visibility: 'public' }]);
    assert(o.status === 201 && o.body.data.catalog_listed === true, `owner: ${show(o)}`);
    assert((await anonKnowledge(p.body.data.package_id)).status === 200, 'publisher package listed');
});

// ── Data packages ──────────────────────────────────────────────────────────────────────────────
console.log('\nData packages');

const dAsked = `pgpdata${short}`;
await test('D1. POST /v1/datapackages (public by default) by the asker: 202, published private, anonymous gets 404', async () => {
    const r = await publishData(asker.token, dAsked, ROWS);
    assert(r.status === 202 && r.body.data.publish_request?.kind === 'datapackage', `publish: ${show(r)}`);
    assert((await anonData(dAsked)).status === 404, 'anonymous reads the waiting data package');
    const own = await call(`/v1/datapackages/${A.name}/${dAsked}`, { token: A.token });
    assert(own.status === 200, `the owner reads it: ${show(own)}`);
    const path = new URL(r.body.data.descriptor_url).pathname;
    assert((await call(path)).status !== 200, 'the descriptor file is not public');
    const d = await decide(r.body.data.publish_request.request_id, A.token, 'approve');
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${show(d)}`);
    assert((await anonData(dAsked)).status === 200, 'anonymous reads it after approval');
    const file = await call(path);
    assert(file.status === 200, `the descriptor file after approval: ${file.status}`);
});

await test('D2. A data package with a newer version since the request is not published (409 OUTDATED)', async () => {
    const name = `pgpdatachg${short}`;
    const r = await publishData(asker.token, name, ROWS);
    assert(r.status === 202, `publish: ${show(r)}`);
    const again = await publishData(asker.token, name, [{ id: 3, label: 'three' }], 'private');
    assert(again.status === 201 && !again.body.data.publish_request, `second version: ${show(again)}`);
    const d = await decide(r.body.data.publish_request.request_id, A.token, 'approve');
    assert(d.status === 409 && d.body.error?.code === 'OUTDATED', `approve: ${show(d)}`);
    assert((await anonData(name)).status === 404, 'still not public');
});

await test('D3. aimeat_datapackage_publish asks the same way', async () => {
    const s = await openSession(BASE, asker.token);
    const name = `pgpdatamcp${short}`;
    const m = await callTool(s, 'aimeat_datapackage_publish', { name, changes: 'mcp version', resources: [{ name: 'items', rows: ROWS }] });
    assert(!m.isError && m.data.publish_request?.kind === 'datapackage', `aimeat_datapackage_publish: ${m.text.slice(0, 400)}`);
    assert((await anonData(name)).status === 404, 'not public');
});

await test('D4. The publisher and the owner in person publish a public data package at once', async () => {
    const p = await publishData(publisher.token, `pgpdatapub${short}`, ROWS);
    assert(p.status === 201 && !p.body.data.publish_request, `publisher: ${show(p)}`);
    assert((await anonData(`pgpdatapub${short}`)).status === 200, 'publisher data public');
    const o = await publishData(A.token, `pgpdataown${short}`, ROWS);
    assert(o.status === 201, `owner: ${show(o)}`);
    assert((await anonData(`pgpdataown${short}`)).status === 200, 'owner data public');
});

// secaudit 2026-10 v42: the approval names one version, and only that version opens. Before the fix
// the public pointer opened every stored version: an anonymous caller listed the earlier private
// version and read its rows with ?version=, while its files stayed private at /v1/pub.
await test('D5. Approving version 2 public opens no earlier private version: anonymous gets 404 pinned to version 1, and the list leaves it out', async () => {
    const name = `pgpdataver${short}`;
    const v1 = await publishData(asker.token, name, [{ id: 1, label: 'PRIVATE-A1' }, { id: 2, label: 'PRIVATE-A2' }], 'private');
    assert(v1.status === 201 && !v1.body.data.publish_request, `version 1 (private): ${show(v1)}`);
    const h1 = v1.body.data.content_hash as string;
    const v2 = await publishData(asker.token, name, [{ id: 1, label: 'BENIGN-B1' }]);
    assert(v2.status === 202 && v2.body.data.publish_request?.kind === 'datapackage', `version 2: ${show(v2)}`);
    const h2 = v2.body.data.content_hash as string;
    const d = await decide(v2.body.data.publish_request.request_id, A.token, 'approve');
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${show(d)}`);

    const base = `/v1/datapackages/${A.name}/${name}`;
    const pin = `?version=${encodeURIComponent(h1)}`;
    // Version 2, the approved one, is public.
    const cur = await call(`${base}/rows/items`);
    assert(cur.status === 200 && JSON.stringify(cur.body.data.rows).includes('BENIGN-B1'), `anonymous reads version 2: ${show(cur)}`);
    // Version 1 is not: rows, descriptor and the OData feed pinned to it answer 404, with no row.
    for (const path of [`${base}/rows/items${pin}`, `${base}${pin}`, `/v1/odata/${A.name}/${name}/items${pin}`]) {
        const r = await call(path);
        assert(r.status === 404, `anonymous ${path}: ${show(r)}`);
        assert(!JSON.stringify(r.body).includes('PRIVATE-A'), `anonymous ${path}: a private row leaked`);
    }
    const anonList = await call(`${base}/versions`);
    const anonHashes = (anonList.body.data?.versions ?? []).map((v: Body) => v.contentHash);
    assert(anonList.status === 200 && anonHashes.includes(h2) && !anonHashes.includes(h1), `anonymous versions: ${show(anonList)}`);
    assert(!JSON.stringify(anonList.body).includes('PRIVATE'), 'anonymous versions list shows version 1');
    // Another owner's account is refused version 1 too.
    const other = await call(`${base}/rows/items${pin}`, { token: B.token });
    assert(other.status === 404, `owner B pinned to version 1: ${show(other)}`);
    // The owner's agent without storage:read reads the public version, and is told what it lacks for version 1.
    const askerPinned = await call(`${base}/rows/items${pin}`, { token: asker.token });
    assert(askerPinned.status === 403 && askerPinned.body.error?.code === 'SCOPE_DENIED', `asker pinned to version 1: ${show(askerPinned)}`);
    const askerList = await call(`${base}/versions`, { token: asker.token });
    assert(!(askerList.body.data?.versions ?? []).some((v: Body) => v.contentHash === h1), `asker versions: ${show(askerList)}`);

    // The owner in person, and the owner's agent holding storage:read, read every version.
    const reader = await makeAgent(BASE, A, ['storage:read']);
    for (const [who, token] of [['owner', A.token], ['storage:read agent', reader.token]] as const) {
        const own = await call(`${base}/rows/items${pin}`, { token });
        assert(own.status === 200 && JSON.stringify(own.body.data.rows).includes('PRIVATE-A1'), `${who} reads version 1: ${show(own)}`);
        const list = await call(`${base}/versions`, { token });
        const hashes = (list.body.data?.versions ?? []).map((v: Body) => v.contentHash);
        assert(hashes.includes(h1) && hashes.includes(h2), `${who} versions: ${show(list)}`);
    }
});

await test('Cleanup: the gate back to off', async () => {
    const g = await setGate('off');
    assert(g.status === 200, `gate off: ${show(g)}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);
