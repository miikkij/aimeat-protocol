/**
 * @file test/e2e-datapackage-pointer-forgery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the reads that took a data package's audience, version, withdrawal or sale terms
 *   off its `latest.json` pointer (WP9e; Lifecycle Central incidents
 *   incident-datapackage-withdraw-ts-decides-on-latest-json-s-visibility--mvxmm7ex and
 *   incident-data-products-party-shares-and-exchange-sale-read-latest-jso-mvxozs2r). In every test an
 *   app of the owner with storage:write rewrites `datapkg/<name>/latest.json` through POST /v1/storage
 *   (an app grant writes the owner's own files; an agent's storage:write writes the agent's namespace),
 *   and the answer stays as the service's record says:
 *     W1  a withdrawn private package whose pointer is made to say public: a stranger gets 404, not 410.
 *     W2  a withdrawal after the pointer was made to say public writes the pointer file at the private tier.
 *     W3  a withdrawn public package whose pointer has the withdrawal cleared: still 410, to anyone.
 *     S1  share creation for a withdrawn package whose pointer has the withdrawal cleared: 409.
 *     S2  a share's connection file lists the resources of the recorded version, not of the pointer's.
 *     P1  a data product source whose pointer says public: a public product from it is refused (409).
 *     X1  the EXCHANGE listing keeps the recorded price, usage terms and version after the pointer is
 *         rewritten and the owner reconciles; X1b the app (no exchange:write) and another owner are
 *         refused the terms write, and another owner the withdrawal; X2 the terms write keeps the
 *         pointer file private.
 *     D1  a Dataspace participant's catalogue offers the recorded usage terms, not the pointer's.
 *     G1  a confirmation of a public package from personal data written onto the pointer skips no
 *         question: the app's public publish without the confirmation is refused 409
 *         PERSONAL_DATA_PUBLIC (plan D1.7); G2 the confirmed publish and the next version still work.
 *   Each test fails on the code before WP9e.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-datapackage-pointer-forgery
 * @version-history
 *   v1.1.0 — 2026-11-01 — G1, G2: the personal-data guard's confirmation (WP9e, plan D1.7).
 *   v1.0.0 — 2026-11-01 — Initial (WP9e, cc-jouni-dataulos).
 */
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
const codeOf = (r: Answer) => r.body?.error?.code ?? r.body?.error;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const PAGE = '<!DOCTYPE html><html><head><title>pf</title></head><body>pf</body></html>';

let OP!: RegisteredOwner, A!: RegisteredOwner, B!: RegisteredOwner;
let app = '';

const publish = (name: string, visibility: string, resources: Body[], extra: Body = {}) =>
    call('POST', '/v1/datapackages', A.token, { name, changes: 'a version', visibility, resources, ...extra });
const rows = (label: string) => [{ name: 'items', rows: [{ id: 1, label }, { id: 2, label: `${label}-2` }] }];
/** The forged pointer: what a principal with storage:write writes through the generic storage route. */
async function forgePointer(writer: string, name: string, pointer: Body): Promise<void> {
    const full = { packageId: `pkg:${A.name}/${name}`, name, descriptorUrl: '', updatedAt: new Date().toISOString(), ...pointer };
    const w = await call('POST', '/v1/storage', writer, { key: `datapkg/${name}/latest.json`, data: b64(JSON.stringify(full)), mime_type: 'application/json', visibility: 'private' });
    assert(w.status === 201, `the generic pointer write: ${show(w)}`);
}
const pointerFile = async (name: string): Promise<Body | undefined> =>
    ((await call('GET', '/v1/storage', A.token)).body.data?.files as Body[] | undefined)?.find(f => f.key === `datapkg/${name}/latest.json`);
const withdraw = (name: string) => call('DELETE', `/v1/datapackages/${A.name}/${name}`, A.token);

console.log('\n=== A data package decides on the service\'s record, not latest.json (WP9e) ===\n');

await test('Setup: an operator, owner A with an app grant (storage:write, no exchange:write), owner B', async () => {
    OP = await setupOperator(BASE, ADMIN_PW, `pfop${stamp}`);
    A = await registerOwner(BASE, `pfa${stamp}`);
    B = await registerOwner(BASE, `pfb${stamp}`);
    app = await appGrantToken(A, `pf${stamp}.html`, 'storage:read storage:write memory:read memory:write', PAGE, BASE);
});

// ── Incident ...-mvxmm7ex: withdraw.ts ────────────────────────────────────────────────────────────
console.log('\nThe withdrawal (withdraw.ts)');

await test('W1. A withdrawn private package whose pointer an app makes say public: a stranger gets 404, the owner 410', async () => {
    const name = `pfw1${stamp}`;
    const p = await publish(name, 'private', rows('W1-SECRET'));
    assert(p.status === 201, `publish: ${show(p)}`);
    const w = await withdraw(name);
    assert(w.status === 200, `withdraw: ${show(w)}`);
    assert((await call('GET', `/v1/datapackages/${A.name}/${name}`)).status === 404, 'a stranger before the forgery');
    await forgePointer(app, name, { contentHash: p.body.data.content_hash, visibility: 'public', status: 'withdrawn', withdrawnAt: w.body.data.withdrawn_at ?? w.body.data.withdrawnAt ?? new Date().toISOString() });
    const anon = await call('GET', `/v1/datapackages/${A.name}/${name}`);
    assert(anon.status === 404, `a stranger learns the private package existed: ${show(anon)}`);
    const own = await call('GET', `/v1/datapackages/${A.name}/${name}`, A.token);
    assert(own.status === 410, `the owner is told it is withdrawn: ${show(own)}`);
});

await test('W2. A withdrawal after an app made the pointer say public writes the pointer file at the private tier', async () => {
    const name = `pfw2${stamp}`;
    const p = await publish(name, 'private', rows('W2'));
    assert(p.status === 201, `publish: ${show(p)}`);
    await forgePointer(app, name, { contentHash: p.body.data.content_hash, visibility: 'public' });
    const w = await withdraw(name);
    assert(w.status === 200, `withdraw: ${show(w)}`);
    const f = await pointerFile(name);
    assert(f && f.visibility === 'private', `the withdrawn pointer file: ${JSON.stringify(f)}`);
});

await test('W3. A withdrawn public package whose pointer an app clears of the withdrawal: still 410, its rows to nobody', async () => {
    const name = `pfw3${stamp}`;
    const p = await publish(name, 'public', rows('W3-ROW'));
    assert(p.status === 201, `publish: ${show(p)}`);
    assert((await call('GET', `/v1/datapackages/${A.name}/${name}/rows/items`)).status === 200, 'anonymous reads the public package');
    assert((await withdraw(name)).status === 200, 'withdraw');
    await forgePointer(app, name, { contentHash: p.body.data.content_hash, visibility: 'public' });
    for (const [who, token] of [['anonymous', undefined], ['the owner', A.token]] as const) {
        const r = await call('GET', `/v1/datapackages/${A.name}/${name}/rows/items`, token);
        assert(r.status === 410 && !r.text.includes('W3-ROW'), `${who} after the cleared mark: ${show(r)}`);
    }
    const again = await withdraw(name);
    assert(again.status === 200 && again.body.data.already_withdrawn === true, `a second withdrawal is the same withdrawal: ${show(again)}`);
});

// ── Incident ...-mvxozs2r: shares, data products, the sale, the Dataspace catalogue ──────────────
console.log('\nNamed shares (parties/shares.ts)');

await test('S1. A share of a withdrawn package whose pointer an app clears of the withdrawal: 409 PACKAGE_WITHDRAWN', async () => {
    const name = `pfs1${stamp}`;
    const p = await publish(name, 'private', rows('S1'));
    assert(p.status === 201, `publish: ${show(p)}`);
    assert((await withdraw(name)).status === 200, 'withdraw');
    await forgePointer(app, name, { contentHash: p.body.data.content_hash, visibility: 'private' });
    const r = await call('POST', '/v1/parties/share', A.token, { name: `pfs1p${stamp}`.slice(0, 30), kind: 'program', package: name, purpose: 'A forged share', days: 5 });
    assert(r.status === 409 && codeOf(r) === 'PACKAGE_WITHDRAWN', `share: ${show(r)}`);
});

await test('S2. A share\'s connection file names the resources of the recorded version, not the version the pointer names', async () => {
    const name = `pfs2${stamp}`;
    const v1 = await publish(name, 'private', [{ name: 'oldtable', rows: [{ id: 1, label: 'old' }] }]);
    assert(v1.status === 201, `v1: ${show(v1)}`);
    const v2 = await publish(name, 'private', rows('new'));
    assert(v2.status === 201, `v2: ${show(v2)}`);
    await forgePointer(app, name, { contentHash: v1.body.data.content_hash, visibility: 'private' });
    const r = await call('POST', '/v1/parties/share', A.token, { name: `pfs2p${stamp}`.slice(0, 30), kind: 'program', package: name, purpose: 'Connection file', days: 5 });
    assert(r.status === 201, `share: ${show(r)}`);
    const names = (r.body.data.connection.resources as Body[]).map(x => x.name);
    assert(names.length === 1 && names[0] === 'items', `the connection file's tables: ${JSON.stringify(names)}`);
});

console.log('\nData product sources (dataproduct/sources-io.ts)');

await test('P1. A private source whose pointer an app makes say public: a public data product from it is refused', async () => {
    const src = `pfp1${stamp}`;
    const p = await publish(src, 'private', rows('P1-PRIVATE'));
    assert(p.status === 201, `publish: ${show(p)}`);
    await forgePointer(app, src, { contentHash: p.body.data.content_hash, visibility: 'public' });
    const d = await call('PUT', `/v1/dataproducts/pfp1prod${stamp}`, A.token, { visibility: 'public', sources: [{ kind: 'datapackage', name: src }] });
    assert(d.status === 409 && codeOf(d) === 'AUDIENCE_WIDER_THAN_SOURCE', `define: ${show(d)}`);
    const ok = await call('PUT', `/v1/dataproducts/pfp1own${stamp}`, A.token, { visibility: 'private', sources: [{ kind: 'datapackage', name: src }] });
    assert(ok.status === 201, `a private product from it still works: ${show(ok)}`);
});

console.log('\nThe personal-data guard (datapackage/personal-guard.ts, plan D1.7)');

const APP = `pf${stamp}.html`;
const personalRow = {
    what: 'customers.*', holds: 'the customers', kind: 'register', usedFor: 'shown-as-a-list', where: 'owner-memory-private', owner: 'person',
    readers: 'owner-only', writers: ['the-app-for-the-person'], shape: 'one-per-thing', keptFor: 'until-deleted', lossRisk: 'only-copy',
    personalData: 'yes', domains: ['health'], why: 'test',
};
const appPublish = (name: string, visibility: string, extra: Body = {}) =>
    call('POST', '/v1/datapackages', app, { name, changes: 'a version', visibility, resources: rows(`G-${visibility}`), ...extra });

await test('G1. A confirmation an app writes onto the pointer skips no question: a public publish without the confirmation is refused 409', async () => {
    const m = await call('PUT', `/v1/datamap/apps/${A.name}/${APP}`, A.token, {
        spec: 'aimeat.datamap/2', what: 'A forgery test app.', usedFor: 'Testing.', form: 'one-person', arrangement: 'Memory.',
        machinery: [], leaves: [], elsewhere: [], held: [personalRow],
    });
    assert(m.status === 200, `the app's data map: ${show(m)}`);
    const name = `pfg1${stamp}`;
    const mem = await appPublish(name, 'members');
    assert(mem.status === 201, `members is not asked: ${show(mem)}`);
    await forgePointer(app, name, {
        contentHash: mem.body.data.content_hash, visibility: 'members',
        personalPublicConfirmed: { at: new Date().toISOString(), by: `${A.name}@forged` },
    });
    const pub = await appPublish(name, 'public');
    assert(pub.status === 409 && codeOf(pub) === 'PERSONAL_DATA_PUBLIC', `public without the confirmation: ${show(pub)}`);
    assert((await call('GET', `/v1/datapackages/${A.name}/${name}/rows/items`)).status === 404, 'anonymous reads the package');
});

await test('G2. Usage: with the confirmation the app\'s publish goes public, and its next public version is not asked again', async () => {
    const name = `pfg1${stamp}`;
    const ok = await appPublish(name, 'public', { confirm_personal_public: true });
    assert(ok.status === 201, `confirmed: ${show(ok)}`);
    const next = await call('POST', '/v1/datapackages', app, { name, changes: 'second', visibility: 'public', resources: rows('G-next') });
    assert(next.status === 201, `the next public version was asked again: ${show(next)}`);
    assert((await call('GET', `/v1/datapackages/${A.name}/${name}/rows/items`)).status === 200, 'anonymous reads the confirmed public package');
});

console.log('\nThe sale on EXCHANGE (exchange-datapackage.ts)');

const SALE = `pfx${stamp}`;
const listingOf = async (): Promise<Body | undefined> =>
    ((await call('GET', `/v1/exchange/offerings?ext=${encodeURIComponent(`datapkg:${A.name}/${SALE}`)}`)).body.data?.offerings ?? [])[0];

await test('X1. The listing keeps the recorded price, usage terms and version after an app rewrites the pointer and the owner reconciles', async () => {
    const v1 = await publish(SALE, 'private', rows('x-old'), { title: `OLD-TITLE ${stamp}` });
    assert(v1.status === 201, `v1: ${show(v1)}`);
    const v2 = await publish(SALE, 'private', rows('x-new'), { title: `NEW-TITLE ${stamp}` });
    assert(v2.status === 201, `v2: ${show(v2)}`);
    const s = await call('PUT', `/v1/datapackages/${A.name}/${SALE}/exchange`, A.token, {
        model: 'per_read', prices_money: [{ amount: 10_000, currency: 'EUR' }], usage_terms: { derivatives: false, resale: false, attribution: true },
    });
    assert(s.status === 200, `sell: ${show(s)}`);
    const before = await listingOf();
    assert(before?.basePrice === 10_000 && String(before.title).startsWith('NEW-TITLE'), `the listing: ${JSON.stringify(before)}`);
    await forgePointer(app, SALE, {
        contentHash: v1.body.data.content_hash, visibility: 'public',
        exchange: { exchange: true, model: 'per_read', pricesMoney: [{ amount: 1, currency: 'EUR' }], usageTerms: { derivatives: true, resale: true, attribution: false } },
    });
    const rec = await call('POST', '/v1/exchange/reconcile', A.token, {});
    assert(rec.status === 200, `reconcile: ${show(rec)}`);
    const after = await listingOf();
    assert(after?.basePrice === 10_000, `the price a buyer pays: ${JSON.stringify(after)}`);
    assert(String(after.title).startsWith('NEW-TITLE'), `the version sold: ${after.title}`);
    assert(after.usageTerms?.resale === false && after.usageTerms?.derivatives === false, `the usage terms: ${JSON.stringify(after.usageTerms)}`);
});

await test('X1b. Refusals: the app (no exchange:write) and another owner set no sale terms; another owner withdraws nothing', async () => {
    const body = { model: 'per_read', prices_money: [{ amount: 1, currency: 'EUR' }], usage_terms: { resale: true } };
    const byApp = await call('PUT', `/v1/datapackages/${A.name}/${SALE}/exchange`, app, body);
    assert(byApp.status === 403, `the app without exchange:write: ${show(byApp)}`);
    const byB = await call('PUT', `/v1/datapackages/${A.name}/${SALE}/exchange`, B.token, body);
    assert(byB.status === 403, `another owner: ${show(byB)}`);
    const wB = await call('DELETE', `/v1/datapackages/${A.name}/${SALE}`, B.token);
    assert(wB.status === 403, `another owner's withdrawal: ${show(wB)}`);
    assert((await listingOf())?.basePrice === 10_000, 'the listing is unchanged');
});

await test('X2. A sale terms write after an app made the pointer say public keeps the pointer file private', async () => {
    const r = await call('PUT', `/v1/datapackages/${A.name}/${SALE}/exchange`, A.token, {
        model: 'per_read', prices_money: [{ amount: 12_000, currency: 'EUR' }], usage_terms: { derivatives: false, resale: false, attribution: true },
    });
    assert(r.status === 200, `reprice: ${show(r)}`);
    const f = await pointerFile(SALE);
    assert(f && f.visibility === 'private', `the pointer file: ${JSON.stringify(f)}`);
    assert((await listingOf())?.basePrice === 12_000, 'the owner\'s reprice lands');
});

console.log('\nThe Dataspace catalogue (dataspace/catalog.ts)');

const CTX = ['https://w3id.org/dspace/2025/1/context.jsonld'];
const X = { id: 'did:web:consumer-pf.example', token: `tok-pf-${stamp}` };
const setConfig = (changes: Array<{ path: string; value: unknown }>) => call('PUT', '/v1/admin/config', OP.token, { changes });

await test('D1. A participant\'s catalogue offers the recorded usage terms after an app rewrites the pointer\'s', async () => {
    const name = `pfd1${stamp}`;
    const p = await publish(name, 'public', rows('D1'));
    assert(p.status === 201, `publish: ${show(p)}`);
    const s = await call('PUT', `/v1/datapackages/${A.name}/${name}/exchange`, A.token, {
        model: 'per_read', toll_morsels: 1, usage_terms: { derivatives: false, resale: false, attribution: true },
    });
    assert(s.status === 200, `sell: ${show(s)}`);
    const on = await setConfig([
        { path: 'dataspace.enabled', value: true },
        { path: 'dataspace.auth', value: 'dcp,static' },
        { path: 'dataspace.static_tokens', value: `${X.id}=${X.token}` },
    ]);
    assert(on.status === 200 && !(on.body.data?.errors ?? []).length, `dataspace on: ${show(on)}`);
    await forgePointer(app, name, {
        contentHash: p.body.data.content_hash, visibility: 'public',
        exchange: { exchange: true, model: 'per_read', pricesMoney: [], tollMorsels: 1, usageTerms: { derivatives: true, resale: true, attribution: false } },
    });
    const cat = await call('POST', '/dsp/2025-1/catalog/request', X.token, { '@context': CTX, '@type': 'CatalogRequestMessage', filter: [] });
    assert(cat.status === 200, `catalog: ${show(cat)}`);
    const ds = (cat.body.dataset as Body[] | undefined)?.find(d => d['@id'] === `urn:aimeat:dataset:${A.name}:${name}`);
    assert(ds?.['@type'] === 'Dataset', `the public package is a dataset: ${show(cat)}`);
    const open = (ds.hasPolicy as Body[]).find(o => String(o['@id']).endsWith(':open'));
    const prohibited = ((open?.prohibition ?? []) as Body[]).map(r => r.action);
    assert(prohibited.includes('odrl:distribute') && prohibited.includes('odrl:derive'), `the open offer's prohibitions: ${JSON.stringify(open)}`);
});

await test('Cleanup: the Dataspace Protocol off', async () => {
    assert((await setConfig([{ path: 'dataspace.enabled', value: false }])).status === 200, 'dataspace off');
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);
