/**
 * @file e2e-exchange-datapackage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for a data package sold on EXCHANGE (plan doc-mvwxcas3dom3, D5):
 *   D5.1 the listing is a projection of the package's sale terms: on, reprice (same offering id), off,
 *     on again (the same id); a new version with changed schemas mints the next interface and the
 *     earlier contract stays on the versions of its own; the refusals (no usage terms, another
 *     account, no package); aimeat_datapackage_sell over MCP with and without exchange:write.
 *   D5.2, D5.3 an account's contract: a row window, the CSV and an OData entity set are metered and
 *     charged, the descriptor and $metadata are not, a failed read is not charged, a budget cap answers
 *     402; a reader without a contract and a contract for another package do not read.
 *   D5.4 a buyer with no account buys (test money): a party with a key, a contract and a share; reads
 *     with HTTP Basic; a block of reads ends with 402 PREPAID_ENDED and buying again with the key tops
 *     it up; the read log has the reads; finding (b) counts the party buyer. This is wish
 *     wish-exchange-lisatestaus-ulkopuolinen-ostaja point 5: a client outside AIMEAT uses an offer.
 *   D5.5 deliversData: true for a package, proposed from an extension action's output schema (records
 *     true, a scalar false), stated in ODPS x-aimeat.
 *   ODPS: the offering's pricingPlans (a month) and paymentGateways (the outside buyer), and the
 *     package's own sheet carries the listing's plans.
 *   D7.1 the data intermediation gate on the new kind, per mode: report and node list, none refuses a
 *     new listing and keeps the existing one, owners refuses until the owner declared itself a provider.
 *   D6 the listing's freshness: a hand-published package lists unscheduled; a daily product lists fresh
 *     with due_at and stale_at, on the browse and the detail, and the freshness check makes it late once
 *     its promised run has passed (the pointer's time set back).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=exchange-datapackage
 * @version-history
 *   v1.1.0 — 2026-11-01 — D6: the listing carries the package's freshness.
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5).
 */
import { registerOwner, setupOperator } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(path: string, opts: { token?: string; basic?: string; body?: unknown; method?: string } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const authorization = opts.basic ? `Basic ${Buffer.from(opts.basic, 'utf8').toString('base64')}` : opts.token ? `Bearer ${opts.token}` : undefined;
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text };
}
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 500)}`;
const codeOf = (r: Answer) => r.body?.error?.code ?? r.body?.error;
const stamp = Date.now() % 10_000_000;

console.log('\n=== AIMEAT EXCHANGE data package E2E ===\n');
let OP = { name: '', token: '' }, A = { name: '', token: '' }, B = { name: '', token: '' }, C = { name: '', token: '' };
const PKG = `xdp${stamp}`, OTHER = `xdo${stamp}`, MONTH = `xdm${stamp}`, READS = `xdr${stamp}`, NEW1 = `xdn${stamp}`, NEW2 = `xdq${stamp}`, DAILY = `xdd${stamp}`;
const terms = { derivatives: true, resale: false, attribution: true };
let offering = '', monthOffering = '', readsOffering = '';
let v1 = '';

const publish = (name: string, rows: Body[], label = 'v') => call('/v1/datapackages', {
    token: A.token, body: { name, changes: label, visibility: 'private', resources: [{ name: 'items', rows }] },
});
const sell = (name: string, body: Body, token = A.token, owner = A.name) => call(`/v1/datapackages/${owner}/${name}/exchange`, { token, method: 'PUT', body });
const setMode = (value: string) => call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes: [{ path: 'consent.data_intermediation', value }] } });
const listingOf = async (name: string): Promise<Body | undefined> => {
    const r = await call(`/v1/exchange/offerings?ext=${encodeURIComponent(`datapkg:${A.name}/${name}`)}`);
    return (r.body.data?.offerings ?? [])[0];
};
const contractOf = async (token: string, name: string): Promise<Body | undefined> => {
    const r = await call('/v1/exchange/entitlements', { token });
    return (r.body.data?.entitlements ?? []).find((e: Body) => e.ext === `datapkg:${A.name}/${name}`);
};

await test('Setup: an operator, provider A with private packages, buyer B, and C', async () => {
    const op = await setupOperator(BASE, ADMIN_PW, `xdop${stamp}`); OP = { name: op.name, token: op.token };
    const a = await registerOwner(BASE, `xda${stamp}`); A = { name: a.name, token: a.token };
    const b = await registerOwner(BASE, `xdb${stamp}`); B = { name: b.name, token: b.token };
    const c = await registerOwner(BASE, `xdc${stamp}`); C = { name: c.name, token: c.token };
    const p = await publish(PKG, [{ id: 1, label: 'one' }, { id: 2, label: 'two' }], 'first');
    assert(p.status === 201, `publish: ${show(p)}`);
    v1 = p.body.data.content_hash;
    for (const n of [OTHER, MONTH, READS, NEW1, NEW2]) assert((await publish(n, [{ id: 1, label: n }])).status === 201, `publish ${n}`);
    assert((await setMode('report')).status === 200, 'mode report');
});

console.log('\nD5.1 the listing is a projection');

await test('D5.1 refusals: no usage terms, another account\'s package, no such package', async () => {
    const noTerms = await sell(PKG, { model: 'per_read', prices_money: [{ amount: 10_000, currency: 'EUR' }] });
    assert(noTerms.status === 400 && codeOf(noTerms) === 'USAGE_TERMS_REQUIRED', `no terms: ${show(noTerms)}`);
    const other = await sell(PKG, { model: 'per_read', prices_money: [{ amount: 10_000, currency: 'EUR' }], usage_terms: terms }, C.token);
    assert(other.status === 403, `another account: ${show(other)}`);
    const none = await sell(`nosuch${stamp}`, { model: 'per_read', prices_money: [{ amount: 10_000, currency: 'EUR' }], usage_terms: terms });
    assert(none.status === 404, `no package: ${show(none)}`);
    assert(!(await listingOf(PKG)), 'nothing listed');
});

await test('D5.1 flag on lists a datapackage offering; a reprice keeps the offering id', async () => {
    const r = await sell(PKG, { model: 'per_read', prices_money: [{ amount: 10_000, currency: 'EUR' }], usage_terms: terms });
    assert(r.status === 200 && r.body.data.listing.listed?.[0]?.change === 'created', `sell: ${show(r)}`);
    offering = r.body.data.listing.listed[0].offeringId;
    const o = await listingOf(PKG);
    assert(o?.offeringId === offering && o.kind === 'datapackage' && o.surface?.ifaceVersion === 1 && o.surface?.model === 'per_read', `listing: ${JSON.stringify(o)}`);
    const again = await sell(PKG, { model: 'per_read', prices_money: [{ amount: 20_000, currency: 'EUR' }], usage_terms: terms });
    assert(again.status === 200 && again.body.data.listing.listed[0].offeringId === offering && again.body.data.listing.listed[0].change === 'updated', `reprice: ${show(again)}`);
    assert((await listingOf(PKG))?.basePrice === 20_000, 'the new price');
});

console.log('\nD5.3 an account buyer');

await test('D5.3 without a contract B reads nothing; with one a row window, the CSV and an OData set are charged, the descriptor and $metadata are not', async () => {
    const before = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items`, { token: B.token });
    assert(before.status === 404, `no contract: ${show(before)}`);
    const acc = await call('/v1/exchange/entitlements', { token: B.token, body: { offering_id: offering } });
    assert(acc.status === 201 && acc.body.data.entitlement.surface?.kind === 'datapackage', `accept: ${show(acc)}`);
    const d = await call(`/v1/datapackages/${A.name}/${PKG}`, { token: B.token });
    assert(d.status === 200, `descriptor: ${show(d)}`);
    const md = await call(`/v1/odata/${A.name}/${PKG}/$metadata`, { token: B.token });
    assert(md.status === 200, `metadata: ${show(md)}`);
    assert((await contractOf(B.token, PKG))?.budget.calls === 0, 'the descriptor and the metadata are not charged');
    const rows = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items`, { token: B.token });
    assert(rows.status === 200 && rows.body.data.rows.length === 2, `rows: ${show(rows)}`);
    const csv = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items?format=csv`, { token: B.token });
    assert(csv.status === 200 && csv.text.includes('one'), `csv: ${show(csv)}`);
    const es = await call(`/v1/odata/${A.name}/${PKG}/items`, { token: B.token });
    assert(es.status === 200 && es.body.value?.length === 2, `entity set: ${show(es)}`);
    const c = await contractOf(B.token, PKG);
    assert(c?.budget.calls === 3 && c.budget.spent_units === 60_000, `three reads charged at 20000: ${JSON.stringify(c?.budget)}`);
});

await test('D5.3 a failed read is not charged; the contract for one package does not open another', async () => {
    const missing = await call(`/v1/datapackages/${A.name}/${PKG}/rows/nosuch`, { token: B.token });
    assert(missing.status === 404, `missing resource: ${show(missing)}`);
    assert((await contractOf(B.token, PKG))?.budget.calls === 3, 'the failed read was charged');
    const other = await call(`/v1/datapackages/${A.name}/${OTHER}/rows/items`, { token: B.token });
    assert(other.status === 404, `another package: ${show(other)}`);
    const cRead = await call(`/v1/odata/${A.name}/${PKG}/items`, { token: C.token });
    assert(cRead.status === 404, `C with no contract: ${show(cRead)}`);
});

await test('D5.1 a schema change mints interface 2 on the same listing; B stays on version 1, a new buyer reads version 2', async () => {
    const p = await publish(PKG, [{ id: 1, label: 'one', extra: 'x' }, { id: 2, label: 'two', extra: 'y' }, { id: 3, label: 'three', extra: 'z' }], 'a new column');
    assert(p.status === 201, `v2: ${show(p)}`);
    const v2 = p.body.data.content_hash;
    const o = await listingOf(PKG);
    assert(o?.offeringId === offering && o.surface?.ifaceVersion === 2, `listing after the schema change: ${JSON.stringify(o)}`);
    const old = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items`, { token: B.token });
    assert(old.status === 200 && old.body.data.rows.length === 2 && !('extra' in old.body.data.rows[0]), `B reads v1: ${show(old)}`);
    const pinned = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items?version=${encodeURIComponent(v2)}`, { token: B.token });
    assert(pinned.status === 403 && codeOf(pinned) === 'VERSION_NOT_IN_CONTRACT', `B asks for v2: ${show(pinned)}`);
    assert((await call('/v1/exchange/entitlements', { token: C.token, body: { offering_id: offering } })).status === 201, 'C accepts');
    const fresh = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items`, { token: C.token });
    assert(fresh.status === 200 && fresh.body.data.rows.length === 3 && fresh.body.data.rows[0].extra === 'x', `C reads v2: ${show(fresh)}`);
    const d = await call(`/v1/datapackages/${A.name}/${PKG}?version=${encodeURIComponent(v1)}`, { token: C.token });
    assert(d.status === 403 && codeOf(d) === 'VERSION_NOT_IN_CONTRACT', `C asks for v1: ${show(d)}`);
});

await test('D5.3 a budget cap answers 402 BUDGET_EXHAUSTED, uncharged', async () => {
    const spent = (await contractOf(B.token, PKG))!.budget.spent_units as number;
    // Room for one read of 20000 and not for a second: the cap is not reached, the next charge would pass it.
    const capped = await call('/v1/exchange/entitlements', { token: B.token, body: { offering_id: offering, cap_units: spent + 30_000 } });
    assert(capped.status === 201, `cap: ${show(capped)}`);
    assert((await call(`/v1/odata/${A.name}/${PKG}/items`, { token: B.token })).status === 200, 'one more read fits');
    const over = await call(`/v1/odata/${A.name}/${PKG}/items`, { token: B.token });
    assert(over.status === 402 && JSON.stringify(over.body).includes('BUDGET_EXHAUSTED'), `over the cap: ${show(over)}`);
    assert((await contractOf(B.token, PKG))!.budget.spent_units === spent + 20_000, 'the refused read was charged');
});

await test('D5.1 flag off delists, the contract still reads; flag on revives the same offering id', async () => {
    const off = await sell(PKG, { exchange: false });
    assert(off.status === 200 && off.body.data.listing.delisted?.some((d: Body) => d.offeringId === offering), `off: ${show(off)}`);
    assert(!(await listingOf(PKG)), 'still listed');
    const read = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items`, { token: C.token });
    assert(read.status === 200, `the contract keeps working: ${show(read)}`);
    const on = await sell(PKG, { model: 'per_read', prices_money: [{ amount: 20_000, currency: 'EUR' }], usage_terms: terms });
    assert(on.status === 200 && on.body.data.listing.listed[0].offeringId === offering, `on again: ${show(on)}`);
});

console.log('\nD5.4 a buyer with no account');

const parties: Record<string, { user: string; key: string }> = {};

await test('D5.4 a person with no account buys a month: party, key, contract, share; reads with HTTP Basic', async () => {
    const s = await sell(MONTH, { model: 'per_month', prices_money: [{ amount: 5_000_000, currency: 'EUR' }], usage_terms: terms });
    assert(s.status === 200, `sell: ${show(s)}`);
    monthOffering = s.body.data.listing.listed[0].offeringId;
    const signedIn = await call(`/v1/exchange/offerings/${monthOffering}/buy`, { token: B.token, body: { party: { display_name: 'B' } } });
    assert(signedIn.status === 409 && codeOf(signedIn) === 'USE_YOUR_ACCOUNT', `an account is told to accept: ${show(signedIn)}`);
    const noMail = await call(`/v1/exchange/offerings/${monthOffering}/buy`, { body: { party: { display_name: 'Matti Virtanen', kind: 'person' }, handler: 'test.money' } });
    assert(noMail.status === 400, `a person without an e-mail: ${show(noMail)}`);
    const open = await call(`/v1/exchange/offerings/${monthOffering}/buy`, { body: { party: { display_name: 'Matti Virtanen', kind: 'person', contact: 'matti@example.org' }, months: 1, handler: 'test.money' } });
    assert(open.status === 201 && open.body.data.purchase.amount === 5_000_000 && open.body.data.pay.complete_url, `open: ${show(open)}`);
    const id = open.body.data.purchase.id as string;
    const done = await call(`/v1/exchange/purchases/${id}/complete`, { body: { handler: 'test.money', instrument: 'card' } });
    assert(done.status === 200 && done.body.data.connection?.key && done.body.data.contract?.pricing?.model === 'subscription', `complete: ${show(done)}`);
    const conn = done.body.data.connection as Body;
    parties.month = { user: conn.authentication.basic.user, key: conn.key };
    assert(conn.partyId.startsWith(`party:${A.name}/`) && conn.endpoint.includes(`/v1/odata/${A.name}/${MONTH}`), `connection file: ${JSON.stringify(conn)}`);
    const twice = await call(`/v1/exchange/purchases/${id}/complete`, { body: { handler: 'test.money', instrument: 'card' } });
    assert(twice.status === 409 && codeOf(twice) === 'ALREADY_COMPLETED', `twice: ${show(twice)}`);
    const basic = `${parties.month.user}:${parties.month.key}`;
    const rows = await call(`/v1/datapackages/${A.name}/${MONTH}/rows/items`, { basic });
    assert(rows.status === 200 && rows.body.data.rows.length === 1, `party rows: ${show(rows)}`);
    const es = await call(`/v1/odata/${A.name}/${MONTH}/items`, { basic });
    assert(es.status === 200 && es.body.value?.length === 1, `party OData: ${show(es)}`);
    const another = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items`, { basic });
    assert(another.status === 403 && codeOf(another) === 'NOT_SHARED', `the purchase opens no other package: ${show(another)}`);
    const list = await call('/v1/parties', { token: A.token });
    const mine = (list.body.data.parties as Body[]).find(p => p.name === parties.month.user.split('/')[1]);
    assert(mine?.kind === 'person' && mine.shares?.[0]?.contract?.offering_id === monthOffering, `A sees the party and its share: ${JSON.stringify(mine)}`);
    const reads = await call(`/v1/parties/${mine.name}/reads`, { token: A.token });
    assert(reads.status === 200 && (reads.body.data.reads as Body[]).filter(r => r.verdict === 'served').length >= 2, `the read log: ${show(reads)}`);
});

await test('D5.4 a block of reads ends with 402 PREPAID_ENDED, uncharged; buying again with the key tops it up', async () => {
    const s = await sell(READS, { model: 'per_read', prices_money: [{ amount: 100_000, currency: 'EUR' }], usage_terms: terms });
    assert(s.status === 200, `sell: ${show(s)}`);
    readsOffering = s.body.data.listing.listed[0].offeringId;
    const open = await call(`/v1/exchange/offerings/${readsOffering}/buy`, { body: { party: { display_name: 'ETL job', kind: 'program' }, reads: 2, handler: 'test.money' } });
    assert(open.status === 201 && open.body.data.purchase.amount === 200_000, `open: ${show(open)}`);
    const done = await call(`/v1/exchange/purchases/${open.body.data.purchase.id}/complete`, { body: { handler: 'test.money', instrument: 'x' } });
    assert(done.status === 200, `complete: ${show(done)}`);
    const conn = done.body.data.connection as Body;
    const basic = `${conn.authentication.basic.user}:${conn.key}`;
    for (let i = 0; i < 2; i++) assert((await call(`/v1/datapackages/${A.name}/${READS}/rows/items?format=csv`, { basic })).status === 200, `read ${i + 1}`);
    const meta = await call(`/v1/datapackages/${A.name}/${READS}`, { basic });
    assert(meta.status === 200, `the descriptor is not a data read: ${show(meta)}`);
    const third = await call(`/v1/datapackages/${A.name}/${READS}/rows/items`, { basic });
    assert(third.status === 402 && codeOf(third) === 'PREPAID_ENDED', `the third read: ${show(third)}`);
    const renew = await call(`/v1/exchange/offerings/${readsOffering}/buy`, { basic, body: { reads: 1, handler: 'test.money' } });
    assert(renew.status === 201 && renew.body.data.purchase.renewal === true, `renew: ${show(renew)}`);
    const again = await call(`/v1/exchange/purchases/${renew.body.data.purchase.id}/complete`, { body: { handler: 'test.money', instrument: 'x' } });
    assert(again.status === 200 && !again.body.data.connection.key, `renewed, no new key: ${show(again)}`);
    assert((await call(`/v1/datapackages/${A.name}/${READS}/rows/items`, { basic })).status === 200, 'the same key reads again');
    const wrongProvider = await call(`/v1/exchange/offerings/${offering}/buy`, { basic: `${conn.authentication.basic.user}:wrong`, body: { reads: 1 } });
    assert(wrongProvider.status === 401, `a wrong key: ${show(wrongProvider)}`);
});

await test('D5.4 a party cannot buy an offering of another kind, nor one with no money price', async () => {
    const free = await sell(OTHER, { model: 'per_read', toll_morsels: 2, usage_terms: terms });
    assert(free.status === 200, `free listing: ${show(free)}`);
    const freeId = free.body.data.listing.listed[0].offeringId;
    const r = await call(`/v1/exchange/offerings/${freeId}/buy`, { body: { party: { display_name: 'P', kind: 'program' }, handler: 'test.money' } });
    assert(r.status === 409 && codeOf(r) === 'NOT_SOLD_TO_PARTIES', `free: ${show(r)}`);
    const none = await call(`/v1/exchange/offerings/off-nosuch/buy`, { body: { party: { display_name: 'P', kind: 'program' } } });
    assert(none.status === 404, `no offering: ${show(none)}`);
});

console.log('\nD5.5 deliversData, ODPS');

await test('D5.5 deliversData: true for a package, proposed from an extension action\'s output (records true, a scalar false)', async () => {
    assert((await listingOf(PKG))?.deliversData === true, 'a package delivers data');
    const ext = `xdx${stamp}`;
    const act = (id: string, output: Body) => ({ id, method: 'POST', path: `/${id}`, script: 'echo', input: { type: 'object', properties: { q: { type: 'string' } } }, output, tollMorsels: 2 });
    const manifest = JSON.stringify({
        metadata: { name: ext, version: '1.0.0', description: 'delivers data e2e', author: 'e2e' },
        actions: [act('rows', { type: 'object', properties: { rows: { type: 'array', items: { type: 'object' } } } }), act('scalar', { type: 'object', properties: { valid: { type: 'boolean' } } })],
        config: { public_access: { default: true } }, limits: { timeout_ms: 5000, max_api_calls: 1 },
    });
    const inst = await call('/v1/extensions', { token: A.token, body: { manifest, scripts: { echo: 'export default async function(){ return {}; }' } } });
    assert(inst.status === 201 || inst.status === 200, `install: ${show(inst)}`);
    assert((await call(`/v1/extensions/${ext}/activate`, { token: A.token, body: {} })).status === 200, 'activate');
    const rows = await call('/v1/exchange/offerings', { token: A.token, body: { ext, action: 'rows', usage_terms: terms } });
    const scalar = await call('/v1/exchange/offerings', { token: A.token, body: { ext, action: 'scalar', usage_terms: terms } });
    assert(rows.status === 201 && rows.body.data.offering.deliversData === true, `records: ${show(rows)}`);
    assert(scalar.status === 201 && scalar.body.data.offering.deliversData === false, `scalar: ${show(scalar)}`);
    const odps = await call(`/v1/exchange/offerings/${scalar.body.data.offering.offeringId}/odps`);
    assert(odps.body.data.odps.product['x-aimeat'].delivers_data === false, 'ODPS x-aimeat states it');
});

await test('ODPS: the offering states the month plan and the outside buyer\'s gateway; the package sheet carries the listing\'s plans', async () => {
    const r = await call(`/v1/exchange/offerings/${monthOffering}/odps`);
    assert(r.status === 200, `odps: ${show(r)}`);
    const product = r.body.data.odps.product as Body;
    const plans = product.pricingPlans.declarative.en as Body[];
    assert(plans.length === 1 && plans[0].name === 'per_month' && plans[0].unit === 'Recurring' && plans[0].price === '5.00' && plans[0].priceCurrency === 'EUR', `plans: ${JSON.stringify(plans)}`);
    assert(product.paymentGateways.outsideBuyer?.reference?.endsWith(`/v1/exchange/offerings/${monthOffering}/buy`), `gateways: ${JSON.stringify(product.paymentGateways)}`);
    assert(product['x-aimeat'].package?.odps_url?.includes(`/v1/datapackages/${A.name}/${MONTH}/odps`) && product['x-aimeat'].delivers_data === true, `x-aimeat: ${JSON.stringify(product['x-aimeat'])}`);
    assert(product.details.en.type === 'dataset' && product.dataAccess.default.accessURL.includes('/v1/odata/'), 'a dataset read over OData');
    const sheet = await call(`/v1/datapackages/${A.name}/${MONTH}/odps?format=json`, { token: A.token });
    const own = sheet.body.data?.odps?.product?.pricingPlans?.declarative?.en as Body[] | undefined;
    assert(sheet.status === 200 && own?.some(p => p.name === 'per_month' && String(p.notes).includes(monthOffering)), `the package sheet: ${show(sheet)}`);
});

await test('D7.3 finding (b) counts the outside party buyer and the account buyer', async () => {
    const r = await call('/v1/admin/compliance/report', { token: OP.token });
    const b = (r.body.data.data_intermediation.findings as Body[]).find(f => f.id === 'contract_outside_buyer');
    assert(b?.items.some((i: Body) => i.buyer_kind === 'party' && i.provider === A.name) && b.items.some((i: Body) => i.buyer === B.name), `(b): ${JSON.stringify(b)}`);
});

await test('D5.1 aimeat_datapackage_sell: an agent with exchange:write sells; without it SCOPE_DENIED; another owner\'s package refused', async () => {
    const ag = await makeAgent(BASE, A, ['exchange:write']);
    const s = await openSession(BASE, ag.token, 'xdp-mcp');
    const out = await callTool(s, 'aimeat_datapackage_sell', { ref: `pkg:${A.name}/${OTHER}`, model: 'per_read', prices_money: [{ amount: 15_000, currency: 'EUR' }], usage_terms: terms });
    assert(!out.isError && out.text.includes('"listed"'), `sell over MCP: ${out.text.slice(0, 400)}`);
    assert((await listingOf(OTHER))?.basePrice === 15_000, 'the MCP sale is the listing');
    const foreign = await callTool(s, 'aimeat_datapackage_sell', { ref: `pkg:${B.name}/${OTHER}`, model: 'per_read', prices_money: [{ amount: 1, currency: 'EUR' }], usage_terms: terms });
    assert(foreign.isError && foreign.text.includes('FORBIDDEN'), `another owner: ${foreign.text.slice(0, 300)}`);
    const reader = await makeAgent(BASE, A, ['storage:read']);
    const s2 = await openSession(BASE, reader.token, 'xdp-mcp-noscope');
    const refused = await callTool(s2, 'aimeat_datapackage_sell', { ref: `pkg:${A.name}/${OTHER}`, exchange: false });
    assert(refused.isError && /SCOPE_DENIED|not offered/i.test(refused.text), `no exchange:write: ${refused.text.slice(0, 300)}`);
    assert(await listingOf(OTHER), 'the refused call delisted');
});

console.log('\nD6 freshness on the listing');

await test('D6 a hand-published package lists as unscheduled, never fresh', async () => {
    const o = await listingOf(PKG);
    assert(o?.freshness?.state === 'unscheduled' && o.freshness.due_at === null && o.freshness.reason_code === 'no-promise', `listing freshness: ${JSON.stringify(o?.freshness)}`);
});

await test('D6 a daily product lists fresh with both deadlines; after its promised run passes the freshness check makes the listing late', async () => {
    const mem = await call('/v1/memory', { token: A.token, body: { key: 'xdp.rows', value: { items: [{ k: 1, v: 'one' }, { k: 2, v: 'two' }] } } });
    assert(mem.status === 201 || mem.status === 200, `memory: ${show(mem)}`);
    const def = await call(`/v1/dataproducts/${DAILY}`, { token: A.token, method: 'PUT', body: { sources: [{ kind: 'memory', key: 'xdp.rows', rows_at: 'items' }], schedule: { cron: '0 6 * * *', timezone: 'UTC' } } });
    assert(def.status === 201, `define: ${show(def)}`);
    const run = await call(`/v1/dataproducts/${DAILY}/run`, { token: A.token, body: {} });
    assert(run.status === 201, `run: ${show(run)}`);
    const s = await sell(DAILY, { model: 'per_read', prices_money: [{ amount: 5_000, currency: 'EUR' }], usage_terms: terms });
    assert(s.status === 200 && s.body.data.listing.listed?.[0]?.change === 'created', `sell: ${show(s)}`);
    const o = await listingOf(DAILY);
    assert(o?.freshness?.state === 'fresh' && typeof o.freshness.due_at === 'string' && typeof o.freshness.stale_at === 'string', `fresh: ${JSON.stringify(o?.freshness)}`);
    const detail = await call(`/v1/exchange/offerings/${o.offeringId}`);
    assert(detail.status === 200 && detail.body.data.offering.freshness?.state === 'fresh', `detail: ${show(detail)}`);
    // The pointer's last success set back a day and a half, as e2e-data-lifecycle does. A storage write
    // reconciles nothing, so the listing still says fresh until the freshness check runs.
    const d = await call(`/v1/datapackages/${A.name}/${DAILY}`, { token: A.token });
    assert(d.status === 200 && d.body.data.latest?.contentHash, `pointer: ${show(d)}`);
    const pointer = { ...d.body.data.latest, updatedAt: new Date(Date.now() - 36 * 3_600_000).toISOString() };
    const w = await call('/v1/storage', { token: A.token, body: { key: `datapkg/${DAILY}/latest.json`, data: Buffer.from(JSON.stringify(pointer), 'utf8').toString('base64'), mime_type: 'application/json', visibility: 'private' } });
    assert(w.status === 201, `write pointer: ${show(w)}`);
    assert((await listingOf(DAILY))?.freshness?.state === 'fresh', 'the listing changed before the check');
    const sw = await call('/v1/admin/scheduler/jobs/core:datapackage-freshness/trigger', { token: OP.token, method: 'POST' });
    assert(sw.status === 200, `sweep: ${show(sw)}`);
    const late = await listingOf(DAILY);
    assert(late?.offeringId === o.offeringId && late.freshness?.state === 'late' && late.freshness.reason_code === 'missed-one', `late: ${JSON.stringify(late?.freshness)}`);
    const lateDetail = await call(`/v1/exchange/offerings/${o.offeringId}`);
    assert(lateDetail.body.data?.offering?.freshness?.state === 'late', `late detail: ${show(lateDetail)}`);
});

console.log('\nD7.1 the data intermediation gate on the new kind');

await test('D7.1 none refuses a new package listing before any write and keeps the existing one; node lists it', async () => {
    assert((await setMode('none')).status === 200, 'mode none');
    const r = await sell(NEW1, { model: 'per_read', prices_money: [{ amount: 10_000, currency: 'EUR' }], usage_terms: terms });
    assert(r.status === 403 && codeOf(r) === 'DATA_INTERMEDIATION_NOT_OFFERED', `refused: ${show(r)}`);
    assert(!(await listingOf(NEW1)), 'nothing listed');
    const d = await call(`/v1/datapackages/${A.name}/${NEW1}`, { token: A.token });
    assert(!d.body.data.latest?.exchange, `the terms were written: ${JSON.stringify(d.body.data.latest)}`);
    const keep = await sell(PKG, { model: 'per_read', prices_money: [{ amount: 30_000, currency: 'EUR' }], usage_terms: terms });
    assert(keep.status === 200 && keep.body.data.listing.listed[0].offeringId === offering, `the existing listing reprices: ${show(keep)}`);
    assert((await setMode('node')).status === 200, 'mode node');
    const n = await sell(NEW1, { model: 'per_read', prices_money: [{ amount: 10_000, currency: 'EUR' }], usage_terms: terms });
    assert(n.status === 200 && n.body.data.listing.listed?.[0]?.change === 'created', `node lists: ${show(n)}`);
});

await test('D7.1 owners refuses until an organism A manages keeps a notification record', async () => {
    assert((await setMode('owners')).status === 200, 'mode owners');
    const before = await sell(NEW2, { model: 'per_read', prices_money: [{ amount: 10_000, currency: 'EUR' }], usage_terms: terms });
    assert(before.status === 403 && codeOf(before) === 'DATA_INTERMEDIATION_NOT_OFFERED', `refused before: ${show(before)}`);
    const org = await call('/v1/organisms', { token: A.token, body: { name: `Xd Market ${stamp}`, type: 'cooperative', join_policy: 'approval_required', visibility: 'public' } });
    assert(org.status === 201, `organism: ${show(org)}`);
    const doc = { items: [{ id: 'notification', type: 'notification', legalName: 'A Data Oy', businessId: '7654321-0', scope: 'Data packages of A' }] };
    const w = await call(`/v1/compliance/docs/intermediation?scope=organism&organism_id=${org.body.data.organism.id}`, { token: A.token, method: 'PUT', body: doc });
    assert(w.status === 200, `record: ${show(w)}`);
    const after = await sell(NEW2, { model: 'per_read', prices_money: [{ amount: 10_000, currency: 'EUR' }], usage_terms: terms });
    assert(after.status === 200 && after.body.data.listing.listed?.[0]?.change === 'created', `a declared provider lists: ${show(after)}`);
    assert((await setMode('report')).status === 200, 'mode report again');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
