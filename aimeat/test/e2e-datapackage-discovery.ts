/**
 * @file e2e-datapackage-discovery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for data package findability (plan doc-mvwxcas3dom3, D1). Owner A makes an organism,
 *   B joins it, C does not. A publishes a package at each audience, two public ones, and withdraws one.
 *
 *   D1.1 GET /v1/discover and aimeat_discover list a data package as type `dataset` with its audience,
 *     row count, freshness and addresses: own lists the caller's packages it may read, shared the
 *     members and organism packages of other accounts it may read, public the public ones; a withdrawn
 *     package is never listed, a private one never reaches another account or an agent without
 *     storage:read, and `type=knowledge` no longer returns a data package. GET /v1/catalogue/knowledge
 *     names the descriptor, OData, ODPS and CSV addresses of a dataset.
 *   D1.2 The ODPS sheet names the owner's one company as dataHolder; an owner with none has no block.
 *   D1.3 GET /v1/catalogue/dcat answers the public, non-withdrawn packages as DCAT-AP JSON-LD and as
 *     Turtle, paged with hydra:PartialCollectionView; a non-public package is never in it.
 *   D1.4 /sitemap-datasets.xml lists the public packages at their public page and the sitemap index
 *     names it; the IndexNow whole-site plan carries them; ?format=schemaorg answers a schema.org Dataset.
 *   D1.5 The ARD manifest, the API catalog and the bootstrap name the data catalogue.
 *   D1.6 aimeat://datapackage/{owner}/{name} reads the descriptor and the first rows as the session.
 *   D1.7 An app whose data map marks its data personal is refused a public publish (409
 *     PERSONAL_DATA_PUBLIC, nothing written) until the request confirms; the confirmation stays on the
 *     package; a map row naming the package's own family decides alone.
 * @version-history
 *   v1.1.0 — 2026-11-01 — The public page is /v1/dataset/{owner}/{name} in every listing, the feed, the
 *     sitemap and schema.org; D1.4d its head carries the Dataset JSON-LD for a public package only (WP9b;
 *     the address was the knowledge viewer, so these assertions fail on the previous code).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D1.1 to D1.7).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=datapackage-discovery

import { createHash, randomBytes } from 'node:crypto';
import { ownerSignIn, setupOperator } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, mcpRpc, type McpAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: Body; text: string; type: string }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    const type = res.headers.get('content-type') ?? '';
    let body: Body = { _raw: text };
    if (type.includes('json')) { try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ } }
    return { status: res.status, body, text, type };
}
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 400)}`;
const pathOf = (url: string) => { const u = new URL(url); return u.pathname + u.search; };
const stamp = Date.now() % 10_000_000;

async function mkOwner(label: string) {
    const name = `dsc${label}${stamp}`;
    let reg = await call('/v1/ghii', { body: { username: name, display_name: name, password: 'Dsc12345!' } });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await call('/v1/ghii', { body: { username: name, display_name: name, password: 'Dsc12345!' } }); }
    assert(reg.status === 201, `ghii ${name}: ${show(reg)}`);
    const tk = await ownerSignIn(BASE, name, 'Dsc12345!');
    return { name, token: tk.body.data.token as string };
}
const rows = (label: string) => [{ id: 1, label }, { id: 2, label: 'two' }];
const publish = (token: string, name: string, visibility: string, extra: Record<string, unknown> = {}) => call('/v1/datapackages', {
    token, body: { name, changes: `first ${name}`, visibility, resources: [{ name: 'items', rows: rows(name) }], ...extra },
});

/** The token an app on the app origin holds for `user`: role 'app', bound to `app`, with `scope`. */
async function appTokenFor(user: { token: string }, app: string, scope: string): Promise<string> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirect = 'http://localhost:9911/callback';
    const q = new URLSearchParams({ app, response_type: 'code', scope, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')?.[1] ?? '');
    const con = await call('/v1/app-grants/authorize-consent', { token: user.token, body: { request_id: rid } });
    assert(!!con.body?.data?.redirect_url, `consent: ${show(con)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await call('/v1/app-grants/token', { body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect } });
    assert(!!tok.body?.data?.access_token, `app token: ${show(tok)}`);
    return tok.body.data.access_token as string;
}

console.log('\n=== AIMEAT data package discovery E2E ===\n');
let OP = { name: '', token: '' };
let A = { name: '', token: '' }, B = { name: '', token: '' }, C = { name: '', token: '' };
let orgId = '';
let reader!: McpAgent, mute!: McpAgent, readerB!: McpAgent;
const P = { pub: `dscpub${stamp}`, pub2: `dscpubb${stamp}`, mem: `dscmem${stamp}`, org: `dscorg${stamp}`, priv: `dscpriv${stamp}`, gone: `dscgone${stamp}` };
const pkgOf = (name: string) => `pkg:${A.name}/${name}`;

await test('Setup: an operator; A makes an organism, B joins, C stays out; A publishes at every audience and withdraws one', async () => {
    OP = await setupOperator(BASE, ADMIN_PW, `dscop${stamp}`);
    A = await mkOwner('a'); B = await mkOwner('b'); C = await mkOwner('c');
    const org = await call('/v1/organisms', { token: A.token, body: { name: `Dsc Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' } });
    assert(org.status === 201, `organism: ${show(org)}`);
    orgId = org.body.data.organism.id;
    const j = await call(`/v1/organisms/${orgId}/join`, { token: B.token, body: {} });
    assert(j.status === 200 || j.status === 201, `join: ${show(j)}`);
    for (const [name, visibility, extra] of [
        [P.pub, 'public', { title: 'Shortage list', description: 'Medicine shortages reported this week.', provenance: { license: 'CC-BY-4.0' } }],
        [P.pub2, 'public', {}], [P.mem, 'members', {}], [P.org, `organism:${orgId}`, {}], [P.priv, 'private', {}], [P.gone, 'public', {}],
    ] as const) {
        const r = await publish(A.token, name, visibility, extra as Record<string, unknown>);
        assert(r.status === 201, `publish ${name}: ${show(r)}`);
    }
    const w = await call(`/v1/datapackages/${A.name}/${P.gone}`, { token: A.token, method: 'DELETE' });
    assert(w.status === 200, `withdraw: ${show(w)}`);
    reader = await makeAgent(BASE, A, ['storage:read', 'memory:read']);
    mute = await makeAgent(BASE, A, ['memory:read']);
    readerB = await makeAgent(BASE, B, ['storage:read', 'organism:read']);
});

// ── D1.1 Discovery ────────────────────────────────────────────────────────────────────────────────
console.log('\nD1.1 Discovery');

async function datasets(scope: string, token?: string, extra = ''): Promise<Body[]> {
    const r = await call(`/v1/discover?scope=${scope}&type=dataset&per_page=100${extra}`, { token });
    assert(r.status === 200, `discover ${scope}: ${show(r)}`);
    return r.body.data.entries as Body[];
}
const ids = (entries: Body[]) => entries.map(e => e.id as string);

await test('D1.1a A\'s own scope lists A\'s packages as type dataset, with audience, rows, freshness and addresses; the withdrawn one is absent', async () => {
    const own = await datasets('own', A.token);
    for (const n of [P.pub, P.pub2, P.mem, P.org, P.priv]) assert(ids(own).includes(pkgOf(n)), `own lacks ${n}: ${ids(own).join(',')}`);
    assert(!ids(own).includes(pkgOf(P.gone)), 'the withdrawn package is listed');
    const pub = own.find(e => e.id === pkgOf(P.pub))!;
    assert(pub.type === 'dataset' && pub.title === 'Shortage list' && pub.segment === 'public', `entry ${JSON.stringify(pub)}`);
    assert(pub.description === 'Medicine shortages reported this week.', `description ${pub.description}`);
    const d = pub.dataset;
    assert(d.audience === 'public' && d.rowCount === 2 && d.resources[0].name === 'items' && d.resources[0].fields === 2, `dataset ${JSON.stringify(d)}`);
    assert(typeof d.lastPublishedAt === 'string' && !d.lastError, `freshness ${JSON.stringify(d)}`);
    assert(d.links.descriptor.includes('/datapackage.json') && d.links.odata.endsWith(`/v1/odata/${A.name}/${P.pub}`)
        && d.links.odps.endsWith(`/${P.pub}/odps`) && d.links.landing.endsWith(`/v1/dataset/${A.name}/${P.pub}`), `links ${JSON.stringify(d.links)}`);
    const priv = own.find(e => e.id === pkgOf(P.priv))!;
    assert(priv.dataset.audience === 'private' && priv.visibility === 'owner' && !priv.dataset.links.landing, `private entry ${JSON.stringify(priv)}`);
    const orgE = own.find(e => e.id === pkgOf(P.org))!;
    assert(orgE.dataset.audience === `organism:${orgId}` && orgE.segment === 'organism', `organism entry ${JSON.stringify(orgE)}`);
});

await test('D1.1b A\'s descriptor link opens, and a data package is no longer a knowledge entry', async () => {
    const own = await datasets('own', A.token);
    const d = own.find(e => e.id === pkgOf(P.pub))!.dataset;
    const r = await call(pathOf(d.links.api), { token: A.token });
    assert(r.status === 200 && r.body.data.descriptor.name === P.pub, `api link: ${show(r)}`);
    const k = await call('/v1/discover?scope=own&type=knowledge&per_page=100', { token: A.token });
    assert(k.status === 200, show(k));
    const leaked = (k.body.data.entries as Body[]).filter(e => String(e.id).startsWith('packages/'));
    assert(leaked.length === 0, `data package records under knowledge: ${leaked.map(e => e.id).join(',')}`);
});

await test('D1.1c Shared: B (a member) gets A\'s members and organism packages; C gets the members one only; neither gets private, public or withdrawn', async () => {
    const b = ids(await datasets('shared', B.token));
    assert(b.includes(pkgOf(P.mem)) && b.includes(pkgOf(P.org)), `B shared: ${b.join(',')}`);
    const c = ids(await datasets('shared', C.token));
    assert(c.includes(pkgOf(P.mem)) && !c.includes(pkgOf(P.org)), `C shared: ${c.join(',')}`);
    for (const list of [b, c]) {
        for (const n of [P.priv, P.pub, P.gone]) assert(!list.includes(pkgOf(n)), `shared lists ${n}`);
    }
});

await test('D1.1d Public: anyone gets the public packages only; B\'s own scope has none of A\'s packages', async () => {
    const anon = ids(await datasets('public'));
    assert(anon.includes(pkgOf(P.pub)) && anon.includes(pkgOf(P.pub2)), `public: ${anon.join(',')}`);
    for (const n of [P.mem, P.org, P.priv, P.gone]) assert(!anon.includes(pkgOf(n)), `public lists ${n}`);
    const bOwn = ids(await datasets('own', B.token));
    assert(!bOwn.some(id => id.startsWith(`pkg:${A.name}/`)), `B own lists A's: ${bOwn.join(',')}`);
    const q = ids(await datasets('public', undefined, `&q=${encodeURIComponent('shortages')}`));
    assert(q.includes(pkgOf(P.pub)) && !q.includes(pkgOf(P.pub2)), `q filter: ${q.join(',')}`);
});

await test('D1.1e An agent of A reads A\'s private package in discovery only with storage:read', async () => {
    const withRead = ids(await datasets('own', reader.token));
    assert(withRead.includes(pkgOf(P.priv)) && withRead.includes(pkgOf(P.pub)), `storage:read agent: ${withRead.join(',')}`);
    const without = ids(await datasets('own', mute.token));
    assert(!without.includes(pkgOf(P.priv)), `an agent without storage:read sees the private package: ${without.join(',')}`);
    assert(without.includes(pkgOf(P.pub)), `an agent without storage:read lost the public one: ${without.join(',')}`);
});

await test('D1.1f aimeat_discover over MCP answers the same: type dataset with the dataset block', async () => {
    const s = await openSession(BASE, reader.token, 'dsc-discover');
    const r = await callTool(s, 'aimeat_discover', { type: 'dataset', scope: 'own', limit: 50 });
    assert(!r.isError, `discover: ${r.text.slice(0, 300)}`);
    const got = (r.data.entries as Body[]).map(e => e.id);
    assert(got.includes(pkgOf(P.priv)) && !got.includes(pkgOf(P.gone)), `MCP: ${got.join(',')}`);
    const e = (r.data.entries as Body[]).find(x => x.id === pkgOf(P.pub))!;
    assert(e.type === 'dataset' && e.dataset?.links?.odata, `MCP entry ${JSON.stringify(e)}`);
});

await test('D1.1g GET /v1/catalogue/knowledge names a dataset\'s descriptor, OData, ODPS and CSV addresses; non-public and withdrawn are absent', async () => {
    const r = await call('/v1/catalogue/knowledge?content_type=dataset&limit=50');
    assert(r.status === 200, show(r));
    const items = r.body.data.packages as Body[];
    const item = items.find(i => i.datapackage?.package_id === pkgOf(P.pub));
    assert(item, `no item for ${P.pub}: ${JSON.stringify(items.map(i => i.datapackage?.package_id))}`);
    const dp = item.datapackage;
    assert(dp.descriptor_url.endsWith('/datapackage.json') && dp.odata_url.includes('/v1/odata/') && dp.odps_url.includes('/odps')
        && dp.landing_url.endsWith(`/v1/dataset/${A.name}/${P.pub}`) && dp.resources[0].csv_url.endsWith('/data/items.csv'), `datapackage ${JSON.stringify(dp)}`);
    const csv = await call(pathOf(dp.resources[0].csv_url));
    assert(csv.status === 200 && csv.text.includes('id'), `csv: ${show(csv)}`);
    const listed = items.map(i => i.datapackage?.package_id);
    for (const n of [P.mem, P.org, P.priv, P.gone]) assert(!listed.includes(pkgOf(n)), `catalogue lists ${n}`);
});

await test('D1.1h Cross-owner: B is refused A\'s private package on every read the listings point at, and cannot withdraw A\'s', async () => {
    for (const path of [`/v1/datapackages/${A.name}/${P.priv}`, `/v1/datapackages/${A.name}/${P.priv}?format=schemaorg`, `/v1/datapackages/${A.name}/${P.priv}/odps`]) {
        const r = await call(path, { token: B.token });
        assert(r.status === 404, `${path} as B: ${r.status}`);
    }
    const w = await call(`/v1/datapackages/${A.name}/${P.pub}`, { token: B.token, method: 'DELETE' });
    assert(w.status === 403, `B withdrew A's package: ${show(w)}`);
    const s = await openSession(BASE, readerB.token, 'dsc-cross');
    const x = await callTool(s, 'aimeat_datapackage_export', { ref: pkgOf(P.priv), resource: 'items', format: 'json' });
    assert(x.isError, `B's agent exported A's private package: ${x.text.slice(0, 200)}`);
});

// ── D1.2 dataHolder ──────────────────────────────────────────────────────────────────────────────
console.log('\nD1.2 The ODPS sheet\'s dataHolder');

await test('D1.2 Without a company the sheet has no dataHolder; with A\'s one company it names it', async () => {
    const before = await call(`/v1/datapackages/${A.name}/${P.pub}/odps?format=json`);
    assert(before.status === 200, show(before));
    assert(!before.body.data.odps.product.dataHolder, `dataHolder invented: ${JSON.stringify(before.body.data.odps.product.dataHolder)}`);
    const co = await call('/v1/companies', { token: A.token, body: { name: `Dsc Oy ${stamp}`, business_id: '1234567-8', city: 'Oulu', country: 'FI', phone: '+358401234567' } });
    assert(co.status === 201, `company: ${show(co)}`);
    const after = await call(`/v1/datapackages/${A.name}/${P.pub}/odps?format=json`);
    const holder = after.body.data.odps.product.dataHolder;
    assert(holder?.legalName === `Dsc Oy ${stamp}` && holder.businessID === '1234567-8' && holder.addressLocality === 'Oulu' && holder.addressCountry === 'FI', `holder ${JSON.stringify(holder)}`);
    assert(!holder.telephone && !('phone' in holder), `the phone reached the sheet: ${JSON.stringify(holder)}`);
});

// ── D1.3 DCAT ────────────────────────────────────────────────────────────────────────────────────
console.log('\nD1.3 The DCAT-AP feed');

await test('D1.3a JSON-LD: a dcat:Catalog with the public datasets, their distributions and landing pages; no non-public one', async () => {
    const r = await call('/v1/catalogue/dcat');
    assert(r.status === 200 && r.type.includes('application/ld+json'), `dcat: ${r.status} ${r.type}`);
    const doc = JSON.parse(r.text);
    assert(doc['@context']?.dcat === 'http://www.w3.org/ns/dcat#' && Array.isArray(doc['@graph']), 'no @context or @graph');
    const [catalog, ...sets] = doc['@graph'];
    assert([].concat(catalog['@type']).includes('dcat:Catalog' as never), `catalog type ${catalog['@type']}`);
    assert(catalog['dct:title'] && catalog['dct:publisher']?.['foaf:name'] && catalog['foaf:homepage']?.['@id'], `catalog ${JSON.stringify(catalog).slice(0, 400)}`);
    const idents = sets.map((s: Body) => s['dct:identifier']);
    assert(idents.includes(pkgOf(P.pub)) && idents.includes(pkgOf(P.pub2)), `datasets ${idents.join(',')}`);
    for (const n of [P.mem, P.org, P.priv, P.gone]) assert(!idents.includes(pkgOf(n)) && !r.text.includes(`/${n}/`), `the feed names ${n}`);
    const ds = sets.find((s: Body) => s['dct:identifier'] === pkgOf(P.pub));
    assert(ds['@type'] === 'dcat:Dataset' && ds['dct:title'] === 'Shortage list' && ds['dct:description'], `dataset ${JSON.stringify(ds).slice(0, 400)}`);
    assert(ds['dct:publisher']['foaf:name'] === A.name && ds['dct:license']?.['rdfs:label'] === 'CC-BY-4.0', `publisher/license ${JSON.stringify([ds['dct:publisher'], ds['dct:license']])}`);
    assert(ds['dct:issued']['@type'] === 'xsd:dateTime' && ds['dcat:landingPage']['@id'].endsWith(`/v1/dataset/${A.name}/${P.pub}`), 'issued/landingPage');
    const dists = [].concat(ds['dcat:distribution']) as Body[];
    const csv = dists.find(d => d['dcat:mediaType']?.['@id']?.endsWith('text/csv'));
    assert(csv && csv['dcat:downloadURL']['@id'].endsWith('/data/items.csv') && csv['dcat:accessURL'] && Number(csv['dcat:byteSize']['@value']) > 0, `csv dist ${JSON.stringify(csv)}`);
    assert(dists.some(d => String(d['dct:conformsTo']?.['@id']).includes('odata')), 'no OData distribution');
    assert(dists.some(d => String(d['dct:conformsTo']?.['@id']).includes('frictionlessdata')), 'no descriptor distribution');
    assert(Number(catalog['hydra:totalItems']['@value']) === sets.length, 'totalItems');
});

await test('D1.3b Turtle by ?format=ttl and by Accept: text/turtle, with the same datasets, in well-formed blocks', async () => {
    const a = await call('/v1/catalogue/dcat?format=ttl');
    const b = await call('/v1/catalogue/dcat', { headers: { Accept: 'text/turtle' } });
    for (const r of [a, b]) {
        assert(r.status === 200 && r.type.includes('text/turtle'), `turtle: ${r.status} ${r.type}`);
        assert(r.text.startsWith('@prefix dcat: <http://www.w3.org/ns/dcat#> .'), 'prefixes');
        assert(/ a dcat:Catalog, hydra:Collection/.test(r.text) && r.text.includes(`dct:identifier "${pkgOf(P.pub)}"`), 'catalog or dataset missing');
        assert(!r.text.includes(pkgOf(P.priv)) && !r.text.includes(pkgOf(P.mem)), 'a non-public package in Turtle');
        // Structure: every subject block ends with " .", brackets balance, every IRI is closed.
        const blocks = r.text.split('\n\n').slice(1);
        assert(blocks.length > 2 && blocks.every(x => x.trimEnd().endsWith(' .')), 'a block does not end with " ."');
        const opens = (r.text.match(/\[/g) ?? []).length, closes = (r.text.match(/\]/g) ?? []).length;
        assert(opens === closes, `brackets ${opens}/${closes}`);
        assert(!/<[^>\s]*\s/.test(r.text.replace(/"(?:[^"\\]|\\.)*"/g, '""')), 'an IRI with a space');
        assert(r.text.includes('^^xsd:nonNegativeInteger') && r.text.includes('dcat:downloadURL <'), 'byteSize or downloadURL');
    }
});

await test('D1.3c Paging: page_size=1 answers one dataset per page with hydra next and previous', async () => {
    const p1 = JSON.parse((await call('/v1/catalogue/dcat?page_size=1')).text);
    const [c1, ...s1] = p1['@graph'];
    assert(s1.length === 1, `page 1 has ${s1.length}`);
    const view = c1['hydra:view'];
    assert(view['@type'] === 'hydra:PartialCollectionView' && view['hydra:next']?.['@id'].includes('page=2') && !view['hydra:previous'], `view ${JSON.stringify(view)}`);
    const p2 = JSON.parse((await call(pathOf(view['hydra:next']['@id']))).text);
    const [c2, ...s2] = p2['@graph'];
    assert(s2.length === 1 && s2[0]['@id'] !== s1[0]['@id'], 'page 2 repeats page 1');
    assert(c2['hydra:view']['hydra:previous']?.['@id'].includes('page=1'), 'no previous on page 2');
    const bad = await call('/v1/catalogue/dcat?format=xml');
    assert(bad.status === 400, `format=xml: ${bad.status}`);
});

// ── D1.4 Search engines ──────────────────────────────────────────────────────────────────────────
console.log('\nD1.4 Search engines');

await test('D1.4a /sitemap-datasets.xml lists the public packages at their public page, and the sitemap index names it', async () => {
    const own = await datasets('own', A.token);
    const landing = own.find(e => e.id === pkgOf(P.pub))!.dataset.links.landing as string;
    const s = await call('/sitemap-datasets.xml');
    assert(s.status === 200 && s.type.includes('xml'), show(s));
    assert(s.text.includes(`<loc>${landing}</loc>`), `the sitemap lacks ${landing}: ${s.text.slice(0, 400)}`);
    const memId = own.find(e => e.id === pkgOf(P.mem))!;
    assert(!s.text.includes(P.mem) && memId, 'the sitemap names the members package');
    const idx = await call('/sitemap-index.xml');
    assert(idx.text.includes('/sitemap-datasets.xml'), 'the index does not name the dataset sitemap');
});

await test('D1.4b The operator\'s IndexNow whole-site plan carries the public dataset pages and no other', async () => {
    const r = await call('/v1/admin/seo/indexnow/plan?scope=all', { token: OP.token });
    assert(r.status === 200, show(r));
    const urls = JSON.stringify(r.body.data);
    const own = await datasets('own', A.token);
    const landing = own.find(e => e.id === pkgOf(P.pub))!.dataset.links.landing as string;
    assert(urls.includes(landing), `the plan lacks ${landing}`);
    const privId = own.find(e => e.id === pkgOf(P.priv))!;
    assert(privId && !urls.includes(P.priv), 'the plan names the private package');
});

await test('D1.4c ?format=schemaorg answers a schema.org Dataset; the public one has its page, the members one none', async () => {
    const r = await call(`/v1/datapackages/${A.name}/${P.pub}?format=schemaorg`);
    assert(r.status === 200 && r.type.includes('application/ld+json'), show(r));
    const doc = JSON.parse(r.text);
    assert(doc['@context'] === 'https://schema.org' && doc['@type'] === 'Dataset' && doc.name === 'Shortage list', `doc ${r.text.slice(0, 300)}`);
    assert(doc.license === 'CC-BY-4.0' && doc.url.endsWith(`/v1/dataset/${A.name}/${P.pub}`) && doc.isAccessibleForFree === true, `license/url ${JSON.stringify([doc.license, doc.url])}`);
    assert(doc.distribution[0]['@type'] === 'DataDownload' && doc.distribution[0].contentUrl.endsWith('/data/items.csv'), 'distribution');
    assert(doc.variableMeasured.map((v: Body) => v.name).join(',') === 'id,label', `variables ${JSON.stringify(doc.variableMeasured)}`);
    const d = await call(`/v1/datapackages/${A.name}/${P.pub}`);
    assert(String(d.body.data.schema_org_url).endsWith('?format=schemaorg'), 'no schema_org_url on the descriptor read');
    const mem = await call(`/v1/datapackages/${A.name}/${P.mem}?format=schemaorg`, { token: C.token });
    assert(mem.status === 200 && !JSON.parse(mem.text).url, `members: ${show(mem)}`);
    const anon = await call(`/v1/datapackages/${A.name}/${P.priv}?format=schemaorg`);
    assert(anon.status === 404, `private to anyone: ${anon.status}`);
});

await test('D1.4d The public dataset page carries its title and the schema.org Dataset in the head; a private one none, and noindex', async () => {
    const page = await fetch(`${BASE}/v1/dataset/${A.name}/${P.pub}`, { signal: AbortSignal.timeout(60_000) });
    const text = await page.text();
    assert(page.status === 200 && (page.headers.get('content-type') ?? '').includes('text/html'), `page ${page.status}`);
    assert(text.includes('<title>Shortage list') && text.includes('"@type":"Dataset"') && text.includes(`/v1/dataset/${A.name}/${P.pub}"`), `head: ${text.slice(0, 600)}`);
    assert(!(page.headers.get('x-robots-tag') ?? '').includes('noindex'), `a public dataset page is indexable: ${page.headers.get('x-robots-tag')}`);
    for (const n of [P.priv, P.mem, P.gone]) {
        const other = await fetch(`${BASE}/v1/dataset/${A.name}/${n}`, { signal: AbortSignal.timeout(60_000) });
        const body = await other.text();
        assert(other.status === 200 && !body.includes('"@type":"Dataset"') && !body.includes(n) && (other.headers.get('x-robots-tag') ?? '').includes('noindex'),
            `${n}: no head of its own and noindex (${other.headers.get('x-robots-tag')})`);
    }
});

// ── D1.5 Discovery documents ─────────────────────────────────────────────────────────────────────
console.log('\nD1.5 Discovery documents');

await test('D1.5 The ARD manifest, the API catalog and the bootstrap name the DCAT data catalogue', async () => {
    const ard = await call('/.well-known/ard.json');
    const entry = (ard.body.entries as Body[]).find(e => String(e.url).endsWith('/v1/catalogue/dcat'));
    assert(entry && entry.type === 'application/ld+json' && entry.representativeQueries.length >= 2, `ard: ${JSON.stringify(entry)}`);
    const linkset = JSON.parse((await call('/.well-known/api-catalog')).text);
    const hrefs = JSON.stringify(linkset);
    assert(hrefs.includes('/v1/catalogue/dcat') && hrefs.includes('/v1/datapackages'), 'the API catalog does not name the data catalogue');
    const boot = await call('/?format=json');
    const ep = boot.body?.data?.knowledge_and_ai?.endpoints ?? {};
    assert(ep.data_catalogue?.url === '/v1/catalogue/dcat' && ep.data_packages?.url === '/v1/datapackages' && ep.data_odata?.url === '/v1/odata', `bootstrap: ${JSON.stringify(ep).slice(0, 300)}`);
});

// ── D1.6 MCP resource ────────────────────────────────────────────────────────────────────────────
console.log('\nD1.6 The MCP resource');

await test('D1.6 aimeat://datapackage/{owner}/{name} answers the descriptor and the first rows as the session may read', async () => {
    const s = await openSession(BASE, reader.token, 'dsc-res');
    const tpl = await mcpRpc(s, 'resources/templates/list');
    const uris = JSON.stringify(tpl?.result?.resourceTemplates ?? []);
    assert(uris.includes('aimeat://datapackage/{owner}/{name}'), `templates: ${uris.slice(0, 300)}`);
    const list = await mcpRpc(s, 'resources/list');
    const listed = JSON.stringify(list?.result?.resources ?? []);
    assert(listed.includes(`aimeat://datapackage/${A.name}/${P.priv}`) && !listed.includes(P.gone), 'the list misses A\'s private package or names the withdrawn one');
    const read = await mcpRpc(s, 'resources/read', { uri: `aimeat://datapackage/${A.name}/${P.priv}` });
    const body = JSON.parse(read?.result?.contents?.[0]?.text ?? '{}');
    assert(body.descriptor?.name === P.priv && body.rows?.items?.rows?.length === 2 && body.rows.items.total === 2, `read: ${JSON.stringify(read).slice(0, 300)}`);
    const sb = await openSession(BASE, readerB.token, 'dsc-res-b');
    const other = await mcpRpc(sb, 'resources/read', { uri: `aimeat://datapackage/${A.name}/${P.priv}` });
    assert(other?.result?.contents?.[0]?.text === 'Not found', `B's agent read A's private package: ${JSON.stringify(other).slice(0, 300)}`);
    const orgRead = await mcpRpc(sb, 'resources/read', { uri: `aimeat://datapackage/${A.name}/${P.org}` });
    assert(JSON.parse(orgRead?.result?.contents?.[0]?.text ?? '{}').descriptor?.name === P.org, 'B\'s agent cannot read the organism package');
    const bList = JSON.stringify((await mcpRpc(sb, 'resources/list'))?.result?.resources ?? []);
    assert(!bList.includes(P.priv) && bList.includes(P.org), 'B\'s list is wrong');
});

// ── D1.7 Personal data guard ─────────────────────────────────────────────────────────────────────
console.log('\nD1.7 Personal data on public');

const APP = `dscguard${stamp}.html`;
const mapRow = (what: string, personalData: string, extra: Record<string, unknown> = {}) => ({
    what, holds: `the ${what}`, kind: 'register', usedFor: 'shown-as-a-list', where: 'owner-memory-private', owner: 'person',
    readers: 'owner-only', writers: ['the-app-for-the-person'], shape: 'one-per-thing', keptFor: 'until-deleted', lossRisk: 'only-copy',
    personalData, why: 'test', ...extra,
});
const putMap = (held: unknown[]) => call(`/v1/datamap/apps/${A.name}/${APP}`, {
    token: A.token, method: 'PUT',
    body: { spec: 'aimeat.datamap/2', what: 'A guard test app.', usedFor: 'Testing.', form: 'one-person', arrangement: 'Memory.', machinery: [], leaves: [], elsewhere: [], held },
});
let appToken = '';
const G = { one: `dscgone1${stamp}`, two: `dscgtwo${stamp}` };

await test('D1.7 setup: A publishes an app whose data map marks its customers personal, and grants it storage:write', async () => {
    const pub = await call('/v1/apps', { token: A.token, body: { filename: APP, name: 'Guard', description: 'guard e2e', content: Buffer.from('<!doctype html><title>g</title><p>g', 'utf8').toString('base64') } });
    assert(pub.status === 200 || pub.status === 201, `app: ${show(pub)}`);
    const m = await putMap([mapRow('customers.*', 'yes', { domains: ['health'] })]);
    assert(m.status === 200, `map: ${show(m)}`);
    appToken = await appTokenFor(A, `${A.name}/${APP}`, 'storage:write memory:write storage:read');
});

await test('D1.7a The app\'s public publish is refused 409 PERSONAL_DATA_PUBLIC and nothing is written', async () => {
    const r = await publish(appToken, G.one, 'public');
    assert(r.status === 409 && r.body.error?.code === 'PERSONAL_DATA_PUBLIC', `public: ${show(r)}`);
    assert(String(r.body.error.message).includes('confirm_personal_public'), 'the refusal does not name the confirmation');
    const d = await call(`/v1/datapackages/${A.name}/${G.one}`, { token: A.token });
    assert(d.status === 404, `something was written: ${d.status}`);
});

await test('D1.7b Below public it is not asked; with the confirmation it goes public, and the next public version is not asked again', async () => {
    const mem = await publish(appToken, G.two, 'members');
    assert(mem.status === 201, `members: ${show(mem)}`);
    const ok = await publish(appToken, G.one, 'public', { confirm_personal_public: true });
    assert(ok.status === 201, `confirmed: ${show(ok)}`);
    const list = await call('/v1/datapackages', { token: A.token });
    const ptr = (list.body.data.packages as Body[]).find(p => p.name === G.one);
    assert(ptr?.personalPublicConfirmed?.at && ptr.visibility === 'public', `pointer ${JSON.stringify(ptr)}`);
    const next = await call('/v1/datapackages', { token: appToken, body: { name: G.one, changes: 'second', visibility: 'public', resources: [{ name: 'items', rows: rows('again') }] } });
    assert(next.status === 201, `the next version was asked again: ${show(next)}`);
    const list2 = await call('/v1/datapackages', { token: A.token });
    assert((list2.body.data.packages as Body[]).find(p => p.name === G.one)?.personalPublicConfirmed, 'the confirmation was lost on the next version');
});

await test('D1.7c A map row naming the package\'s own datapkg/ family decides alone: personal "no" there lets it go public', async () => {
    const m = await putMap([mapRow('customers.*', 'yes'), mapRow(`datapkg/${G.two}/*`, 'no', { where: 'file-storage' })]);
    assert(m.status === 200, `map: ${show(m)}`);
    const r = await publish(appToken, G.two, 'public');
    assert(r.status === 200 || r.status === 201, `public with an own "no" row: ${show(r)}`);
    const owner = await publish(A.token, `dscgown${stamp}`, 'public');
    assert(owner.status === 201, `the owner in person was asked: ${show(owner)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
