/**
 * @file e2e-audience-packages.ts
 * @description E2E for the two audiences between private and public on the three package kinds (plan
 *   doc-mvcn6c7e4e5q, V3.6 to V3.8): a knowledge package (sharing.audience, an entry's visibility), a
 *   package (visibility) and a data package (visibility). For each kind: a 'members' one is read by
 *   another account of this node and refused to the anonymous caller; an 'organism:<id>' one is read
 *   by a member of that organism and refused to an account outside it; neither reaches the public
 *   catalogue or listing; and naming an organism the writer is not in is 400 NOT_ORGANISM_MEMBER with
 *   nothing written. Owner A makes an organism, B joins it, C does not; C has an organism of its own,
 *   which A is not in.
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.6 to V3.8).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=audience-packages

import { ownerSignIn } from './helpers/owner-login.js';

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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const show = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
const stamp = Date.now() % 10_000_000;

async function mkOwner(label: string) {
    const name = `aud${label}${stamp}`;
    const body = JSON.stringify({ username: name, display_name: name, password: 'Aud12345!' });
    let reg = await json('/v1/ghii', { method: 'POST', body });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body }); }
    assert(reg.status === 201, `ghii ${name}: ${show(reg)}`);
    const tk = await ownerSignIn(BASE, name, 'Aud12345!');
    return { name, token: tk.body.data.token as string };
}

console.log('\n=== AIMEAT audiences on packages E2E ===\n');
let A = { name: '', token: '' }, B = { name: '', token: '' }, C = { name: '', token: '' };
let orgId = '', otherOrgId = '';

await test('Setup: A makes an organism and B joins it; C is outside it and has one of its own', async () => {
    A = await mkOwner('a'); B = await mkOwner('b'); C = await mkOwner('c');
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: `Aud Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(org.status === 201, `organism: ${show(org)}`);
    orgId = org.body.data.organism.id;
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({}) });
    assert(j.status === 201 && j.body.data?.status === 'joined', `join: ${show(j)}`);
    const other = await json('/v1/organisms', { method: 'POST', headers: auth(C.token), body: JSON.stringify({ name: `Aud Other ${stamp}`, type: 'project', visibility: 'public' }) });
    assert(other.status === 201, `C's organism: ${show(other)}`);
    otherOrgId = other.body.data.organism.id;
});

// ── Knowledge packages (V3.6) ──────────────────────────────────────────────────────────────────
console.log('\nKnowledge packages');

const TAG = `audtag${stamp}`;
const importPackage = (token: string, name: string, audience: string | undefined, entries: Array<{ key: string; visibility: string }>) => json('/v1/knowledge/import', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({
        package: {
            type: 'knowledge-package', name, version: '1.0.0', content_type: 'idea', tags: [TAG], language: 'en', maturity: 'draft',
            synthesis: { level: 'original', description: 'test' }, references: [], links: [],
            entries: entries.map(e => ({ ...e, title: e.key })),
            sharing: { catalog_listed: false, allow_clone: false, toll_morsels: 0, ...(audience ? { audience } : {}) },
        },
        entry_data: Object.fromEntries(entries.map(e => [e.key, { title: e.key, description: `body of ${e.key}` }])),
    }),
});
let kMembers = '', kOrg = '';

await test('K1. A members package: C (an account) reads it, its links and its export; the anonymous caller gets 404', async () => {
    const imp = await importPackage(A.token, 'Members Knowledge', 'members', [{ key: 'pub', visibility: 'public' }, { key: 'mem', visibility: 'members' }]);
    assert(imp.status === 201, `import: ${show(imp)}`);
    kMembers = imp.body.data.package_id;
    assert(imp.body.data.audience === 'members', `audience answered: ${show(imp)}`);
    const c = await json(`/v1/knowledge/${kMembers}`, { headers: auth(C.token) });
    assert(c.status === 200, `C reads: ${show(c)}`);
    const anon = await json(`/v1/knowledge/${kMembers}`);
    assert(anon.status === 404 && anon.body.error?.code === 'NOT_FOUND', `anon: ${show(anon)}`);
    const cl = await json(`/v1/knowledge/${kMembers}/links`, { headers: auth(C.token) });
    assert(cl.status === 200, `C links: ${show(cl)}`);
    const al = await json(`/v1/knowledge/${kMembers}/links`);
    assert(al.status === 404 && al.body.error?.code === 'NOT_FOUND', `anon links: ${show(al)}`);
    const ce = await json(`/v1/knowledge/${kMembers}/export`, { headers: auth(C.token) });
    assert(ce.status === 200 && ce.body.entry_data?.mem?.description === 'body of mem' && ce.body.entry_data?.pub, `C export carries the members entry: ${show(ce)}`);
    const ae = await json(`/v1/knowledge/${kMembers}/export`);
    assert(ae.status === 404 && ae.body.error?.code === 'NOT_FOUND', `anon export: ${show(ae)}`);
});

await test('K2. An organism package: B (a member) reads and exports it; C (outside) gets 404', async () => {
    const imp = await importPackage(A.token, 'Org Knowledge', undefined, [{ key: 'note', visibility: 'public' }]);
    assert(imp.status === 201, `import: ${show(imp)}`);
    kOrg = imp.body.data.package_id;
    const set = await json(`/v1/knowledge/${kOrg}/sharing`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ audience: `organism:${orgId}` }) });
    assert(set.status === 200 && set.body.data.audience === `organism:${orgId}`, `sharing: ${show(set)}`);
    const ent = await json(`/v1/knowledge/${kOrg}/entries/note/visibility`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: `organism:${orgId}` }) });
    assert(ent.status === 200, `entry visibility: ${show(ent)}`);
    const b = await json(`/v1/knowledge/${kOrg}`, { headers: auth(B.token) });
    assert(b.status === 200, `B reads: ${show(b)}`);
    const be = await json(`/v1/knowledge/${kOrg}/export`, { headers: auth(B.token) });
    assert(be.status === 200 && be.body.entry_data?.note, `B export carries the organism entry: ${show(be)}`);
    const c = await json(`/v1/knowledge/${kOrg}`, { headers: auth(C.token) });
    assert(c.status === 404 && c.body.error?.code === 'NOT_FOUND', `C: ${show(c)}`);
    const ce = await json(`/v1/knowledge/${kOrg}/export`, { headers: auth(C.token) });
    assert(ce.status === 404 && ce.body.error?.code === 'NOT_FOUND', `C export: ${show(ce)}`);
});

await test('K3. Neither is in the public catalogue; a public package with the same tag is (the control)', async () => {
    const pub = await importPackage(A.token, 'Public Knowledge', 'public', [{ key: 'open', visibility: 'public' }]);
    assert(pub.status === 201, `public import: ${show(pub)}`);
    const pubId = pub.body.data.package_id;
    const cat = await json(`/v1/catalogue/knowledge?tags=${TAG}&limit=50`, { headers: auth(C.token) });
    assert(cat.status === 200, `catalogue: ${show(cat)}`);
    const ids = (cat.body.data.items ?? cat.body.data.packages ?? []).map((p: any) => p.package_id);
    assert(ids.includes(pubId), `the public package is listed: ${JSON.stringify(ids)}`);
    assert(!ids.includes(kMembers) && !ids.includes(kOrg), `a non-public package is listed: ${JSON.stringify(ids)}`);
});

await test('K4. Naming an organism A is not in is 400 NOT_ORGANISM_MEMBER, and nothing is written', async () => {
    const set = await json(`/v1/knowledge/${kMembers}/sharing`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ audience: `organism:${otherOrgId}` }) });
    assert(set.status === 400 && set.body.error?.code === 'NOT_ORGANISM_MEMBER', `sharing: ${show(set)}`);
    const still = await json(`/v1/knowledge/${kMembers}`, { headers: auth(A.token) });
    assert(still.body.data?.manifest?.sharing?.audience === 'members', `the audience moved: ${show(still)}`);
    const ent = await json(`/v1/knowledge/${kMembers}/entries/pub/visibility`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: `organism:${otherOrgId}` }) });
    assert(ent.status === 400 && ent.body.error?.code === 'NOT_ORGANISM_MEMBER', `entry: ${show(ent)}`);
    const before = await json(`/v1/memory?prefix=packages/&tags=knowledge-package&owner_scope=true&limit=200`, { headers: auth(A.token) });
    const imp = await importPackage(A.token, 'Refused Knowledge', `organism:${otherOrgId}`, [{ key: 'x', visibility: 'public' }]);
    assert(imp.status === 400 && imp.body.error?.code === 'NOT_ORGANISM_MEMBER', `import: ${show(imp)}`);
    const after = await json(`/v1/memory?prefix=packages/&tags=knowledge-package&owner_scope=true&limit=200`, { headers: auth(A.token) });
    const count = (r: any) => JSON.stringify(r.body).split('Refused Knowledge').length - 1;
    assert(count(after) === 0 && count(before) === 0, `a refused package was stored: ${show(after)}`);
});

// ── Packages (V3.7) ────────────────────────────────────────────────────────────────────────────
console.log('\nPackages');

const memoryComponent = (id: string) => ({ id, type: 'memory', label: id, content: JSON.stringify({ entries: [{ key: `aud.${id}.${stamp}`, value: { n: 1 } }] }), dependencies: [] });
const publishPkg = (token: string, name: string, visibility: string) => json('/v1/packages', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ name, description: 'audience fixture', category: 'other', visibility, components: [memoryComponent(name)] }),
});
let pMembers = '', pOrg = '';

await test('P1. A members package: C reads it and may install it; the anonymous caller gets 404', async () => {
    const r = await publishPkg(A.token, `audmem${stamp}`, 'members');
    assert(r.status === 201 && r.body.data.visibility === 'members', `publish: ${show(r)}`);
    pMembers = r.body.data.packageGroupId;
    const c = await json(`/v1/packages/${encodeURIComponent(pMembers)}`, { headers: auth(C.token) });
    assert(c.status === 200, `C reads: ${show(c)}`);
    const anon = await json(`/v1/packages/${encodeURIComponent(pMembers)}`);
    assert(anon.status === 404 && anon.body.error?.code === 'NOT_FOUND', `anon: ${show(anon)}`);
    const dry = await json(`/v1/packages/${encodeURIComponent(pMembers)}/install`, { method: 'POST', headers: auth(C.token), body: JSON.stringify({ dry_run: true }) });
    assert(dry.status === 200, `C dry-run install: ${show(dry)}`);
    // Reading a package is not owning it: C may not widen it to the public.
    const widen = await json(`/v1/packages/${encodeURIComponent(pMembers)}`, { method: 'PATCH', headers: auth(C.token), body: JSON.stringify({ visibility: 'public' }) });
    assert(widen.status === 403 && widen.body.error?.code === 'FORBIDDEN', `C changed A's package: ${show(widen)}`);
    const anonList = await json(`/v1/packages/${encodeURIComponent(pMembers)}`);
    assert(anonList.status === 404, `the members package became public: ${show(anonList)}`);
});

await test('P2. An organism package: B reads it; C gets 404 on the read and on the install', async () => {
    const r = await publishPkg(A.token, `audorg${stamp}`, `organism:${orgId}`);
    assert(r.status === 201, `publish: ${show(r)}`);
    pOrg = r.body.data.packageGroupId;
    const b = await json(`/v1/packages/${encodeURIComponent(pOrg)}`, { headers: auth(B.token) });
    assert(b.status === 200, `B reads: ${show(b)}`);
    const c = await json(`/v1/packages/${encodeURIComponent(pOrg)}`, { headers: auth(C.token) });
    assert(c.status === 404 && c.body.error?.code === 'NOT_FOUND', `C: ${show(c)}`);
    const ci = await json(`/v1/packages/${encodeURIComponent(pOrg)}/install`, { method: 'POST', headers: auth(C.token), body: JSON.stringify({ dry_run: true }) });
    assert(ci.status === 404 && ci.body.error?.code === 'NOT_FOUND', `C install: ${show(ci)}`);
});

await test('P3. Neither is in the public listing nor served by the federation attestation', async () => {
    for (const headers of [{}, auth(C.token)]) {
        const list = await json(`/v1/packages?search=aud&limit=200`, { headers });
        assert(list.status === 200, `list: ${show(list)}`);
        const ids = (list.body.data.packages ?? []).map((p: any) => p.packageGroupId);
        assert(!ids.includes(pMembers) && !ids.includes(pOrg), `a non-public package is listed: ${JSON.stringify(ids)}`);
    }
    const att = await json(`/v1/federation/packages/${encodeURIComponent(pMembers)}/attestation`, { headers: auth(C.token) });
    assert(att.status === 404, `attestation of a members package: ${show(att)}`);
});

await test('P4. Naming an organism A is not in is 400 NOT_ORGANISM_MEMBER, and nothing is written', async () => {
    const name = `audrefused${stamp}`;
    const r = await publishPkg(A.token, name, `organism:${otherOrgId}`);
    assert(r.status === 400 && r.body.error?.code === 'NOT_ORGANISM_MEMBER', `publish: ${show(r)}`);
    const none = await json(`/v1/packages/${encodeURIComponent(`${name}::${A.name}`)}/versions`, { headers: auth(A.token) });
    assert((none.body.data?.versions ?? []).length === 0 && (none.body.data?.total ?? 0) === 0, `a refused package was stored: ${show(none)}`);
    const patch = await json(`/v1/packages/${encodeURIComponent(pMembers)}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: `organism:${otherOrgId}` }) });
    assert(patch.status === 400 && patch.body.error?.code === 'NOT_ORGANISM_MEMBER', `patch: ${show(patch)}`);
    const still = await json(`/v1/packages/${encodeURIComponent(pMembers)}`, { headers: auth(A.token) });
    assert(still.body.data?.visibility === 'members', `the visibility moved: ${show(still)}`);
});

// ── Data packages (V3.8) ───────────────────────────────────────────────────────────────────────
console.log('\nData packages');

const publishData = (token: string, name: string, visibility?: string) => json('/v1/datapackages', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ name, changes: 'first', resources: [{ name: 'items', rows: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }] }], ...(visibility ? { visibility } : {}) }),
});
const dMembers = `audmemdata${stamp}`, dOrg = `audorgdata${stamp}`;

await test('D1. A members data package: C reads the descriptor and rows; the anonymous caller gets 404 there and on the feed', async () => {
    const r = await publishData(A.token, dMembers, 'members');
    assert(r.status === 201, `publish: ${show(r)}`);
    const c = await json(`/v1/datapackages/${A.name}/${dMembers}`, { headers: auth(C.token) });
    assert(c.status === 200, `C descriptor: ${show(c)}`);
    const cr = await json(`/v1/datapackages/${A.name}/${dMembers}/rows/items`, { headers: auth(C.token) });
    assert(cr.status === 200 && cr.body.data.total === 2, `C rows: ${show(cr)}`);
    const anon = await json(`/v1/datapackages/${A.name}/${dMembers}`);
    assert(anon.status === 404 && anon.body.error?.code === 'NOT_FOUND', `anon descriptor: ${show(anon)}`);
    const ar = await json(`/v1/datapackages/${A.name}/${dMembers}/rows/items`);
    assert(ar.status === 404 && ar.body.error?.code === 'NOT_FOUND', `anon rows: ${show(ar)}`);
    const feed = await json(`/v1/odata/${A.name}/${dMembers}`);
    assert(feed.status === 404, `anon feed: ${show(feed)}`);
});

await test('D2. An organism data package: B reads it; C gets 404; the owner reads it always', async () => {
    const r = await publishData(A.token, dOrg, `organism:${orgId}`);
    assert(r.status === 201, `publish: ${show(r)}`);
    const b = await json(`/v1/datapackages/${A.name}/${dOrg}/rows/items`, { headers: auth(B.token) });
    assert(b.status === 200 && b.body.data.total === 2, `B rows: ${show(b)}`);
    const c = await json(`/v1/datapackages/${A.name}/${dOrg}`, { headers: auth(C.token) });
    assert(c.status === 404 && c.body.error?.code === 'NOT_FOUND', `C: ${show(c)}`);
    const own = await json(`/v1/datapackages/${A.name}/${dOrg}/versions`, { headers: auth(A.token) });
    assert(own.status === 200 && own.body.data.total === 1, `owner versions: ${show(own)}`);
});

await test('D3. Neither data package is in the public knowledge catalogue', async () => {
    for (const name of [dMembers, dOrg]) {
        const cat = await json(`/v1/catalogue/knowledge?tags=${name}&limit=50`);
        assert(cat.status === 200, `catalogue: ${show(cat)}`);
        const items = cat.body.data.items ?? cat.body.data.packages ?? [];
        assert(items.length === 0, `${name} is in the public catalogue: ${JSON.stringify(items)}`);
    }
});

await test('D4. Naming an organism A is not in is 400 NOT_ORGANISM_MEMBER, and nothing is written', async () => {
    const name = `audrefuseddata${stamp}`;
    const r = await publishData(A.token, name, `organism:${otherOrgId}`);
    assert(r.status === 400 && r.body.error?.code === 'NOT_ORGANISM_MEMBER', `publish: ${show(r)}`);
    const mine = await json('/v1/datapackages', { headers: auth(A.token) });
    assert(!(mine.body.data?.packages ?? []).some((p: any) => p.name === name), `a refused package was stored: ${show(mine)}`);
    const read = await json(`/v1/datapackages/${A.name}/${name}`, { headers: auth(A.token) });
    assert(read.status === 404, `the refused package reads: ${show(read)}`);
});

await test('Cleanup', async () => {
    for (const g of [pMembers, pOrg]) if (g) await json(`/v1/packages/${encodeURIComponent(g)}`, { method: 'DELETE', headers: auth(A.token) });
    if (otherOrgId) await json(`/v1/organisms/${otherOrgId}`, { method: 'DELETE', headers: auth(C.token) });
    if (orgId) await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: auth(A.token) });
    for (const o of [B, C, A]) if (o.name) await json(`/v1/owners/${o.name}`, { method: 'DELETE', headers: auth(o.token) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
