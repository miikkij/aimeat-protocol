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
 *
 *   The owner's own principals on a private data package (secaudit 2026-10 v41, standing ruling 5):
 *   an agent with memory:write only and an app grant without storage:read get 403 on the descriptor,
 *   the versions, the rows and the OData feed; an agent and an app grant with storage:read, the owner
 *   in person, the MCP export and an extension of the owner read it; a public package stays open.
 *
 *   What worked before keeps working (capability-loss review 2026-10-21): the owner's agent without
 *   storage:read reads the owner's members and organism packages; the MCP export refuses as REST does;
 *   an earlier version answers on its own audience, so an organism member and a node account keep the
 *   earlier organism and members versions after the newest goes public, and a private one stays closed.
 * @version-history
 *   v1.2.0 — 2026-10-21 — D12 to D15: the uses that worked before (capability-loss review of v41 and v42).
 *   v1.1.0 — 2026-10-20 — D5 to D11: the owner's own principals on a private data package (secaudit 2026-10 v41).
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.6 to V3.8).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=audience-packages

import { createHash, randomBytes } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

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

// ── A data package's own owner: the owner in person and the owner's principals (secaudit 2026-10 v41) ──
// Standing ruling 5 (2026-10-20): the owner in person always reads their own packages; the owner's
// agent, app grant or ecosystem app reads a non-public one only with storage:read, the word GET
// /v1/datapackages and /v1/pub ask for the same bytes. Before the fix any token carrying the owner's
// name read every row of a private package through the read routes and the OData feed.
console.log('\nData packages: the owner\'s own principals (v41)');

const dPriv = `audprivdata${stamp}`, dPub = `audpubdata${stamp}`;
const ODATA_FORBIDDEN = 'Forbidden';
let narrowAgent: Awaited<ReturnType<typeof makeAgent>>;
let readerAgent: Awaited<ReturnType<typeof makeAgent>>;
const APP_FILE = `audgrant${stamp}.html`;
const REDIRECT = 'http://localhost:9911/callback';
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
/** The authorize, consent and token steps of an app grant on A's app, holding exactly `scope`. */
async function grantAppToken(scope: string): Promise<string> {
    const q = new URLSearchParams({
        app: `${A.name}/${APP_FILE}`, response_type: 'code', scope,
        redirect_uri: REDIRECT, code_challenge: codeChallenge, code_challenge_method: 'S256',
    });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')?.[1] ?? '');
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ request_id: rid }) });
    assert(con.status === 200, `consent (${scope}): ${show(con)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }) });
    assert(tok.status === 200 && typeof tok.body.data?.access_token === 'string', `token (${scope}): ${show(tok)}`);
    return tok.body.data.access_token as string;
}
/** Every read surface of one package for one bearer: descriptor, versions, rows and the three OData routes. */
async function readAll(token: string, name: string) {
    const h = { headers: auth(token) };
    return {
        descriptor: await json(`/v1/datapackages/${A.name}/${name}`, h),
        versions: await json(`/v1/datapackages/${A.name}/${name}/versions`, h),
        rows: await json(`/v1/datapackages/${A.name}/${name}/rows/items`, h),
        service: await json(`/v1/odata/${A.name}/${name}`, h),
        metadata: await json(`/v1/odata/${A.name}/${name}/$metadata`, h),
        entitySet: await json(`/v1/odata/${A.name}/${name}/items`, h),
    };
}

await test('D5. Setup: A publishes a private and a public data package; an agent with memory:write only and one with storage:read', async () => {
    const p = await publishData(A.token, dPriv, 'private');
    assert(p.status === 201, `private publish: ${show(p)}`);
    const q = await publishData(A.token, dPub, 'public');
    assert(q.status === 201, `public publish: ${show(q)}`);
    narrowAgent = await makeAgent(BASE, A, ['memory:write']);
    readerAgent = await makeAgent(BASE, A, ['storage:read']);
});

await test('D6. The agent with memory:write only is refused every read route and the OData feed of the private package (403, no row)', async () => {
    const r = await readAll(narrowAgent.token, dPriv);
    for (const [route, ans] of Object.entries(r)) {
        assert(ans.status === 403, `${route}: expected 403, got ${show(ans)}`);
        assert(!JSON.stringify(ans.body).includes('"label":"one"'), `${route}: a private row leaked in the refusal`);
    }
    for (const route of ['descriptor', 'versions', 'rows'] as const) {
        assert(r[route].body.error?.code === 'SCOPE_DENIED', `${route}: ${show(r[route])}`);
    }
    for (const route of ['service', 'entitySet'] as const) {
        assert(r[route].body.error?.code === ODATA_FORBIDDEN, `${route}: ${show(r[route])}`);
    }
    // A package that does not exist stays 404 for the same agent: the 403 says only what is missing.
    const none = await json(`/v1/datapackages/${A.name}/nosuch${stamp}/rows/items`, { headers: auth(narrowAgent.token) });
    assert(none.status === 404, `a missing package: ${show(none)}`);
});

await test('D7. The same agent still reads the public package on every route (the control)', async () => {
    const r = await readAll(narrowAgent.token, dPub);
    for (const [route, ans] of Object.entries(r)) assert(ans.status === 200, `${route}: ${show(ans)}`);
    assert(r.rows.body.data.total === 2, `rows: ${show(r.rows)}`);
});

await test('D8. The agent with storage:read and the owner in person read the private package on every route', async () => {
    for (const [who, token] of [['storage:read agent', readerAgent.token], ['owner', A.token]] as const) {
        const r = await readAll(token, dPriv);
        for (const [route, ans] of Object.entries(r)) assert(ans.status === 200, `${who} ${route}: ${show(ans)}`);
        assert(r.rows.body.data.total === 2, `${who} rows: ${show(r.rows)}`);
        assert(Array.isArray(r.entitySet.body.value) && r.entitySet.body.value.length === 2, `${who} OData rows: ${show(r.entitySet)}`);
    }
});

await test('D9. aimeat_datapackage_export by the storage:read agent returns the private rows', async () => {
    const s = await openSession(BASE, readerAgent.token);
    const m = await callTool(s, 'aimeat_datapackage_export', { ref: `pkg:${A.name}/${dPriv}`, resource: 'items', format: 'json' });
    assert(!m.isError && m.data?.total === 2, `export: ${m.text.slice(0, 300)}`);
});

await test('D10. An app grant without storage:read is refused the private rows (403); one with storage:read reads them', async () => {
    const app = await json('/v1/apps', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ filename: APP_FILE, content: Buffer.from('<!DOCTYPE html><html><body>grant</body></html>').toString('base64'), name: 'Aud Grant', description: 'grant fixture', category: 'utility' }) });
    assert(app.status === 201, `app: ${show(app)}`);
    const narrow = await grantAppToken('memory:read');
    const n = await json(`/v1/datapackages/${A.name}/${dPriv}/rows/items`, { headers: auth(narrow) });
    assert(n.status === 403 && n.body.error?.code === 'SCOPE_DENIED', `memory:read grant: ${show(n)}`);
    const f = await json(`/v1/odata/${A.name}/${dPriv}/items`, { headers: auth(narrow) });
    assert(f.status === 403, `memory:read grant on the feed: ${show(f)}`);
    const wide = await grantAppToken('storage:read');
    const w = await json(`/v1/datapackages/${A.name}/${dPriv}/rows/items`, { headers: auth(wide) });
    assert(w.status === 200 && w.body.data.total === 2, `storage:read grant: ${show(w)}`);
});

await test('D11. An extension of A reads A\'s private package as A, as before (ctx.datapackage.open and rows)', async () => {
    const ext = `audreadext${stamp}`;
    const manifest = JSON.stringify({
        metadata: { name: ext, version: '1.0.0', description: 'reads a private data package', author: 'e2e' },
        actions: [{ id: 'read', method: 'POST', path: '/read', script: 'read' }],
        limits: { timeout_ms: 10000, max_api_calls: 8 },
    });
    const scripts = { read: `export default async function(ctx, input){
        var d = await ctx.datapackage.open(input.ref);
        var r = await ctx.datapackage.rows(input.ref, 'items');
        return { opened: !!d, total: r ? r.total : -1 };
    }` };
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ manifest, scripts }) });
    assert(inst.status === 201, `install: ${show(inst)}`);
    const act = await json(`/v1/extensions/${ext}/activate`, { method: 'POST', headers: auth(A.token) });
    assert(act.status === 200, `activate: ${show(act)}`);
    const r = await json(`/v1/ext/${ext}/read`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ref: `pkg:${A.name}/${dPriv}` }) });
    assert(r.status === 200 && r.body.data?.opened === true && r.body.data?.total === 2, `extension read: ${show(r)}`);
    await json(`/v1/extensions/${ext}`, { method: 'DELETE', headers: auth(A.token) });
});

// ── Capability-loss review 2026-10-21: what worked before keeps working ───────────────────────
console.log('\nData packages: the uses that worked before (capability-loss review)');

await test('D12. The agent with memory:write only still reads its owner\'s members and organism packages (rows and feed); the private one stays 403', async () => {
    for (const name of [dMembers, dOrg]) {
        const rows = await json(`/v1/datapackages/${A.name}/${name}/rows/items`, { headers: auth(narrowAgent.token) });
        assert(rows.status === 200 && rows.body.data.total === 2, `${name} rows: ${show(rows)}`);
        const feed = await json(`/v1/odata/${A.name}/${name}/items`, { headers: auth(narrowAgent.token) });
        assert(feed.status === 200 && feed.body.value?.length === 2, `${name} feed: ${show(feed)}`);
    }
    const priv = await json(`/v1/datapackages/${A.name}/${dPriv}/rows/items`, { headers: auth(narrowAgent.token) });
    assert(priv.status === 403 && priv.body.error?.code === 'SCOPE_DENIED', `private: ${show(priv)}`);
});

await test('D13. aimeat_datapackage_export by the memory:write agent on the private package answers SCOPE_DENIED naming storage:read, as REST does', async () => {
    const s = await openSession(BASE, narrowAgent.token);
    const m = await callTool(s, 'aimeat_datapackage_export', { ref: `pkg:${A.name}/${dPriv}`, resource: 'items', format: 'json' });
    assert(m.isError && m.text.startsWith('SCOPE_DENIED') && m.text.includes('storage:read'), `export: ${m.text.slice(0, 300)}`);
    assert(!m.text.includes('"label"'), 'a private row leaked in the refusal');
});

/** Publish rows as `name` at `visibility` as the owner in person, and answer the content hash. `status`
 *  is 201 for new bytes and 200 for bytes already stored (a re-publish under another audience). */
async function version(name: string, rows: Array<Record<string, unknown>>, visibility: string, status = 201): Promise<string> {
    const r = await json('/v1/datapackages', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name, changes: 'a version', visibility, resources: [{ name: 'items', rows }] }) });
    assert(r.status === status, `publish ${name} ${visibility}: ${show(r)}`);
    return r.body.data.content_hash as string;
}
const pinnedRows = (token: string | undefined, name: string, hash: string) =>
    json(`/v1/datapackages/${A.name}/${name}/rows/items?version=${encodeURIComponent(hash)}`, token ? { headers: auth(token) } : {});
const listed = async (token: string | undefined, name: string) =>
    ((await json(`/v1/datapackages/${A.name}/${name}/versions`, token ? { headers: auth(token) } : {})).body.data?.versions ?? []).map((v: any) => v.contentHash);

await test('D14. An earlier organism version stays open to an organism member after the newest goes public; outsiders and anonymous get 404', async () => {
    const name = `audverorg${stamp}`;
    const h1 = await version(name, [{ id: 1, label: 'ORG-ONLY' }], `organism:${orgId}`);
    const h2 = await version(name, [{ id: 1, label: 'OPEN' }], 'public');
    const b = await pinnedRows(B.token, name, h1);
    assert(b.status === 200 && JSON.stringify(b.body.data.rows).includes('ORG-ONLY'), `B (member) on version 1: ${show(b)}`);
    assert((await listed(B.token, name)).includes(h1), 'B lists version 1');
    for (const [who, token] of [['C (outside)', C.token], ['anonymous', undefined]] as const) {
        const r = await pinnedRows(token, name, h1);
        assert(r.status === 404, `${who} on version 1: ${show(r)}`);
        const hashes = await listed(token, name);
        assert(hashes.includes(h2) && !hashes.includes(h1), `${who} versions: ${JSON.stringify(hashes)}`);
    }
});

await test('D15. A version re-published at members (same bytes) answers on members once the newest goes public: C reads it, anonymous does not; a private one stays closed', async () => {
    const name = `audvermem${stamp}`;
    const rows = [{ id: 1, label: 'MEMBERS-ONLY' }];
    const h1 = await version(name, rows, 'private');
    const again = await version(name, rows, 'members', 200);
    assert(again === h1, 'the same bytes are the same version');
    await version(name, [{ id: 1, label: 'OPEN' }], 'public');
    const c = await pinnedRows(C.token, name, h1);
    assert(c.status === 200 && JSON.stringify(c.body.data.rows).includes('MEMBERS-ONLY'), `C on version 1: ${show(c)}`);
    assert((await pinnedRows(undefined, name, h1)).status === 404, 'anonymous on version 1');

    const priv = `audverpriv${stamp}`;
    const p1 = await version(priv, [{ id: 1, label: 'SECRET' }], 'private');
    await version(priv, [{ id: 1, label: 'OPEN' }], 'public');
    // Another account and anonymous: 404, as a missing version. The owner's agent without storage:read: 403 naming the word.
    for (const [who, token, status] of [['C', C.token, 404], ['anonymous', undefined, 404], ['A\'s memory:write agent', narrowAgent.token, 403]] as const) {
        const r = await pinnedRows(token, priv, p1);
        assert(r.status === status, `${who} on the private version 1: ${show(r)}`);
        assert(!JSON.stringify(r.body).includes('SECRET'), `${who}: the private row leaked`);
    }
    const own = await pinnedRows(A.token, priv, p1);
    assert(own.status === 200 && JSON.stringify(own.body.data.rows).includes('SECRET'), `the owner on the private version 1: ${show(own)}`);
});

await test('Cleanup', async () => {
    for (const g of [pMembers, pOrg]) if (g) await json(`/v1/packages/${encodeURIComponent(g)}`, { method: 'DELETE', headers: auth(A.token) });
    if (otherOrgId) await json(`/v1/organisms/${otherOrgId}`, { method: 'DELETE', headers: auth(C.token) });
    if (orgId) await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: auth(A.token) });
    for (const o of [B, C, A]) if (o.name) await json(`/v1/owners/${o.name}`, { method: 'DELETE', headers: auth(o.token) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
