/**
 * @file test/e2e-datapackage-catalogue-forgery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the public data package catalogues against a memory record shaped like a catalogue
 *   manifest (secaudit2026nov02d round 13, datapackage:catalogue-facts:trusts-writable-manifest-owner-and-audience).
 *   The catalogues (the DCAT feed, the dataset sitemap, public discovery, the Dataspace catalog) list a
 *   package from the service's own records: the manifest the service wrote in the package owner's own
 *   namespace at its deterministic key, and the audience the service recorded (datapkg-audience.<name>).
 *     F1  owner B writes `packages/<x>/manifest` through POST /v1/memory naming owner A's private package
 *         as public: no catalogue lists A's package, and B's own discovery does not list it as B's.
 *     F2  an app of owner A (memory:write) rewrites the manifest of A's private package to say public:
 *         no public catalogue lists it.
 *     F3  with the Dataspace Protocol on, the forged manifest of F1 gives A's private package no open
 *         offer in a participant's catalog.
 *     U1  usage: A's package published public through POST /v1/datapackages is listed in the DCAT feed
 *         with A as publisher, in the dataset sitemap, in public discovery and as an open DSP offer;
 *         A's private package stays in A's own discovery as private.
 *   F1, F2 and F3 fail on the code before round 13; U1 passes before and after.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-datapackage-catalogue-forgery
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13).
 */
import { createHash } from 'node:crypto';
import { registerOwner, setupOperator, type RegisteredOwner } from './helpers/owner-login.js';
import { appGrantToken } from './helpers/purpose-kit.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
const stamp = Date.now().toString(36).slice(-6);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, token?: string, body?: unknown): Promise<Answer> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let parsed: Body = { _raw: text };
    try { parsed = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body: parsed, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 400)}`;
const PAGE = '<!DOCTYPE html><html><head><title>cf</title></head><body>cf</body></html>';

let OP!: RegisteredOwner, A!: RegisteredOwner, B!: RegisteredOwner;
let app = '';
const N = { pub: `cfpub${stamp}`, priv: `cfpriv${stamp}`, own: `cfown${stamp}` };
const hashOf: Record<string, string> = {};
const pkgOf = (name: string) => `pkg:${A.name}/${name}`;
/** The catalogue key root the service derives from a package id (services/datapackage/catalogue-facts.ts catalogueKeyRoot). */
const rootOf = (packageId: string) => `packages/${createHash('sha256').update(packageId, 'utf8').digest('hex').slice(0, 32)}`;
const rows = (label: string) => [{ name: 'items', rows: [{ id: 1, label }, { id: 2, label: `${label}-2` }] }];

/** A manifest value as the service writes it, saying public. */
function forgedManifest(name: string, contentHash: string): Body {
    const packageId = pkgOf(name);
    return {
        type: 'knowledge-package', name: `Forged ${name}`, content_type: 'dataset', tags: ['data-package'],
        created: new Date().toISOString(), updated: new Date().toISOString(),
        sharing: { catalog_listed: true, allow_clone: false, toll_morsels: 0, audience: 'public' },
        x_aimeat_datapackage: {
            packageId, contentHash, name, title: `Forged ${name}`,
            descriptorUrl: `http://127.0.0.1:9/forged/${name}/datapackage.json`,
            resources: [{ name: 'items', rowCount: 2, fields: 2 }],
        },
    };
}
async function writeManifest(token: string, key: string, value: Body): Promise<void> {
    const w = await call('POST', '/v1/memory', token, { key, value, visibility: 'public', tags: ['knowledge-package', 'dataset', 'data-package'] });
    assert(w.status === 200 || w.status === 201, `the memory write: ${show(w)}`);
}
async function discoverIds(scope: string, token?: string): Promise<string[]> {
    const r = await call('GET', `/v1/discover?scope=${scope}&type=dataset&per_page=100`, token);
    assert(r.status === 200, `discover ${scope}: ${show(r)}`);
    return (r.body.data.entries as Body[]).map(e => String(e.id));
}
const dcat = async () => { const r = await call('GET', '/v1/catalogue/dcat'); assert(r.status === 200, `dcat: ${show(r)}`); return r.text; };
const sitemap = async () => { const r = await call('GET', '/sitemap-datasets.xml'); assert(r.status === 200, `sitemap: ${show(r)}`); return r.text; };
const landing = (name: string) => `/v1/dataset/${A.name}/${name}</loc>`;

const CTX = ['https://w3id.org/dspace/2025/1/context.jsonld'];
const X = { id: 'did:web:consumer-cf.example', token: `tok-cf-${stamp}` };
const setConfig = (changes: Array<{ path: string; value: unknown }>) => call('PUT', '/v1/admin/config', OP.token, { changes });
async function dspDataset(name: string): Promise<Body | undefined> {
    const cat = await call('POST', '/dsp/2025-1/catalog/request', X.token, { '@context': CTX, '@type': 'CatalogRequestMessage', filter: [] });
    assert(cat.status === 200, `catalog: ${show(cat)}`);
    return (cat.body.dataset as Body[] | undefined)?.find(d => d['@id'] === `urn:aimeat:dataset:${A.name}:${name}`);
}

console.log('\n=== The public data package catalogues list from the service\'s records (secaudit2026nov02d round 13) ===\n');

await test('Setup: an operator; owner A publishes a public and a private package; owner B; an app of A with memory:write', async () => {
    OP = await setupOperator(BASE, ADMIN_PW, `cfop${stamp}`);
    A = await registerOwner(BASE, `cfa${stamp}`);
    B = await registerOwner(BASE, `cfb${stamp}`);
    for (const [name, visibility] of [[N.pub, 'public'], [N.priv, 'private'], [N.own, 'private']] as const) {
        const p = await call('POST', '/v1/datapackages', A.token, { name, changes: 'a version', visibility, resources: rows(name) });
        assert(p.status === 201, `publish ${name}: ${show(p)}`);
        hashOf[name] = p.body.data.content_hash;
    }
    app = await appGrantToken(A, `cf${stamp}.html`, 'memory:read memory:write storage:read', PAGE, BASE);
});

await test('F1. Owner B\'s memory record naming A\'s private package as public: no catalogue lists A\'s package', async () => {
    await writeManifest(B.token, `packages/forged${stamp}/manifest`, forgedManifest(N.priv, hashOf[N.priv]));
    const feed = await dcat();
    assert(!feed.includes(pkgOf(N.priv)), `the DCAT feed lists A's private package: ${feed.slice(0, 300)}`);
    assert(!(await sitemap()).includes(landing(N.priv)), 'the dataset sitemap lists A\'s private package');
    assert(!(await discoverIds('public')).includes(pkgOf(N.priv)), 'public discovery lists A\'s private package');
    assert(!(await discoverIds('own', B.token)).includes(pkgOf(N.priv)), 'B\'s own discovery lists A\'s package as B\'s');
});

await test('F2. An app of A rewrites the manifest of A\'s private package to say public: no public catalogue lists it', async () => {
    await writeManifest(app, `${rootOf(pkgOf(N.own))}/manifest`, forgedManifest(N.own, hashOf[N.own]));
    assert(!(await dcat()).includes(pkgOf(N.own)), 'the DCAT feed lists the private package');
    assert(!(await sitemap()).includes(landing(N.own)), 'the dataset sitemap lists the private package');
    assert(!(await discoverIds('public')).includes(pkgOf(N.own)), 'public discovery lists the private package');
});

await test('U1. Usage: A\'s public package is in the DCAT feed with A as publisher, the sitemap and public discovery; A\'s private one in A\'s own discovery', async () => {
    const feed = await dcat();
    assert(feed.includes(pkgOf(N.pub)), 'the DCAT feed lacks A\'s public package');
    const doc = JSON.parse(feed) as Body;
    const ds = (doc['@graph'] as Body[]).find(n => n['dct:identifier'] === pkgOf(N.pub));
    assert(ds && JSON.stringify(ds['dct:publisher'] ?? '').includes(A.name), `the publisher: ${JSON.stringify(ds?.['dct:publisher'])}`);
    assert((await sitemap()).includes(landing(N.pub)), 'the dataset sitemap lacks A\'s public package');
    assert((await discoverIds('public')).includes(pkgOf(N.pub)), 'public discovery lacks A\'s public package');
    const own = await call('GET', '/v1/discover?scope=own&type=dataset&per_page=100', A.token);
    const priv = (own.body.data.entries as Body[]).find(e => e.id === pkgOf(N.priv));
    assert(priv?.dataset?.audience === 'private', `A's own private package: ${JSON.stringify(priv)}`);
});

await test('F3. With the Dataspace Protocol on, the forged manifest gives A\'s private package no open offer; U1b A\'s public package keeps its open offer', async () => {
    const on = await setConfig([
        { path: 'dataspace.enabled', value: true },
        { path: 'dataspace.auth', value: 'dcp,static' },
        { path: 'dataspace.static_tokens', value: `${X.id}=${X.token}` },
    ]);
    assert(on.status === 200 && !(on.body.data?.errors ?? []).length, `dataspace on: ${show(on)}`);
    const priv = await dspDataset(N.priv);
    assert(!priv, `A's private package is offered: ${JSON.stringify(priv)}`);
    const one = await call('GET', `/dsp/2025-1/catalog/datasets/${encodeURIComponent(`urn:aimeat:dataset:${A.name}:${N.priv}`)}`, X.token);
    assert(one.status === 404, `the private dataset by id: ${show(one)}`);
    const pub = await dspDataset(N.pub);
    assert(pub && (pub.hasPolicy as Body[]).some(o => String(o['@id']).endsWith(':open')), `A's public package lost its open offer: ${JSON.stringify(pub)}`);
});

await test('Cleanup: the Dataspace Protocol off', async () => {
    assert((await setConfig([{ path: 'dataspace.enabled', value: false }])).status === 200, 'dataspace off');
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);
