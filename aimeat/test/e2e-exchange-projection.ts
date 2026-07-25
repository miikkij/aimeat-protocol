/**
 * @file test/e2e-exchange-projection.ts
 * @description E2E for TARGET-050 — the EXCHANGE listing as a PROJECTION of its source. Proves the whole
 *   promise against a real server: flagging a tool `exchange: true` in the app-tool manifest puts it on the
 *   market with NO separate listing call; repricing it in the manifest updates the SAME listing (no rival
 *   card); pricing it in EUR *and* USD yields one listing per currency for the same tool; turning the flag
 *   off delists it; and — the invariant that must never break — a contract signed before a reprice keeps
 *   its agreed price and its pinned interface version. Also covers adoption of a hand-authored listing
 *   (the migration keeps its offeringId, so `contractRef: offering:{id}` keeps resolving) and the
 *   projection-aware delist guard.
 * @usage cd aimeat && AIMEAT_EXTENSIONS_ENABLED=true pnpm exec tsx test/e2e-exchange-projection.ts
 * @version-history
 *   v1.1.0 — 2026-07-25 — ODPS: app-level defaults on the manifest root inherit into every tool, a tool
 *     overrides field by field, and both reach the listing's ODPS v4.1 document.
 *   v1.0.0 — 2026-07-25 — Initial projection proof (TARGET-050 slices 1 + 3).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body };
}
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
  const name = `xp${label}${Date.now()}`;
  let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Projection', password: 'Exchange1234' }) });
  for (let i = 0; reg.status === 429 && i < 8; i++) {
    await new Promise(r => setTimeout(r, 1500));
    reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Projection', password: 'Exchange1234' }) });
  }
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
  return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT EXCHANGE PROJECTION E2E (TARGET-050 — the source owns the listing) ===\n');

const operator = await setupOwner('op');
const provider = operator;                       // the first owner on a fresh DB is operator (capability aggregation)
const consumer = await setupOwner('cn');

const EXT = `xproj${Date.now()}`;
const APP_ID = `proj-${Date.now()}.html`;
const capId = `ext:${EXT}:free`;
const IN_SCHEMA = { type: 'object', properties: { businessId: { type: 'string' } } };
const OUT_SCHEMA = { type: 'object', properties: { echo: {}, caller: { type: 'string' } } };
const TERMS = { derivatives: true, resale: false, attribution: true, note: 'e2e' };

const writeManifest = (token: string, tools: unknown[], docExtras: Record<string, unknown> = {}) =>
  json('/v1/memory', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ key: `apps.${APP_ID}.tools`, visibility: 'public', value: { version: 1, tools, ...docExtras } }),
  });
const myOfferings = async (token: string) => {
  const r = await json('/v1/exchange/offerings', { headers: auth(token) });
  assert(r.status === 200, `offerings ${r.status}`);
  return (r.body.data.offerings as any[]).filter(o => o.providerOwner === provider.name);
};
const forTool = (list: any[], tool: string) => list.filter(o => o.action === tool && o.ext === `apptool:${provider.name}/${APP_ID}`);

const tool = (over: Record<string, unknown> = {}) => ({
  name: 'brief', description: 'Company brief', action_id: capId,
  inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA, usageTerms: TERMS,
  price: { morsels: 8 }, exchange: true, ...over,
});

await test('Setup: aggregate the backing capability + install the provider extension', async () => {
  const install = await json('/v1/extensions', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({
      manifest: JSON.stringify({
        metadata: { name: EXT, version: '1.0.0', description: 'projection e2e provider', author: 'e2e' },
        actions: [{ id: 'free', method: 'POST', path: `/${EXT}/free`, script: 'free.js', input: IN_SCHEMA, output: OUT_SCHEMA }],
      }),
      scripts: { 'free.js': 'export default async function(ctx, input){ return { echo: input, caller: ctx.caller.owner }; }' },
    }),
  });
  assert(install.status === 201, `install ${install.status}: ${JSON.stringify(install.body?.error)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(provider.token) });
  assert(act.status === 200, `activate ${act.status}`);
  const agg = await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: auth(operator.token) });
  assert(agg.status === 200, `aggregate ${agg.status}: ${JSON.stringify(agg.body?.error)} — first owner must be operator`);
});

// ── The core promise: pricing in the app-catalog IS listing on the market ────
let offeringId = '';

await test('Flagging a tool `exchange: true` in the manifest lists it — with NO listing call', async () => {
  const w = await writeManifest(provider.token, [tool()]);
  assert(w.status === 200 || w.status === 201, `write manifest ${w.status}: ${JSON.stringify(w.body?.error)}`);
  const mine = forTool(await myOfferings(provider.token), 'brief');
  assert(mine.length === 1, `exactly one listing appeared, got ${mine.length}`);
  const o = mine[0];
  assert(o.kind === 'app-tool' && o.auto === true, `projected listing: ${JSON.stringify({ kind: o.kind, auto: o.auto })}`);
  assert(o.unit === 'morsels' && o.basePrice === 8, `price from the manifest: ${o.unit}/${o.basePrice}`);
  assert(o.surface?.ifaceVersion === 1, `pinned interface v1: ${JSON.stringify(o.surface)}`);
  offeringId = o.offeringId;
});

await test('Repricing in the manifest updates the SAME listing — no rival card', async () => {
  const w = await writeManifest(provider.token, [tool({ price: { morsels: 11 } })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const mine = forTool(await myOfferings(provider.token), 'brief');
  assert(mine.length === 1, `still exactly one listing, got ${mine.length}`);
  assert(mine[0].offeringId === offeringId, `same offeringId (${offeringId}), got ${mine[0].offeringId}`);
  assert(mine[0].basePrice === 11, `new price shown, got ${mine[0].basePrice}`);
});

await test('Editing the description/title flows to the listing (labels never go stale)', async () => {
  const w = await writeManifest(provider.token, [tool({ price: { morsels: 11 }, description: 'Full Finnish company brief' })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const mine = forTool(await myOfferings(provider.token), 'brief');
  assert(mine[0].description === 'Full Finnish company brief', `description followed: ${mine[0].description}`);
});

await test('EUR + USD on one tool → one listing per currency, all sharing the tool coordinate', async () => {
  const w = await writeManifest(provider.token, [tool({
    price: { morsels: 11 },
    priceMoney: { amount: 20_000, currency: 'EUR' },
    pricesMoney: [{ amount: 20_000, currency: 'EUR' }, { amount: 25_000, currency: 'USD' }],
  })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const mine = forTool(await myOfferings(provider.token), 'brief');
  assert(mine.length === 3, `morsels + EUR + USD = 3 listings, got ${mine.length}: ${JSON.stringify(mine.map(o => `${o.unit}/${o.currency}`))}`);
  const eur = mine.find(o => o.currency === 'EUR'), usd = mine.find(o => o.currency === 'USD');
  assert(!!eur && eur.basePrice === 20_000, `EUR listing at 0.02: ${JSON.stringify(eur)}`);
  assert(!!usd && usd.basePrice === 25_000, `USD listing at 0.025: ${JSON.stringify(usd)}`);
  assert(mine.every(o => o.auto === true), 'every currency row is a projection');
});

// ── The invariant: a contract is not a projection ────────────────────────────
let contractedPrice = 0;

await test('Consumer contracts the morsel listing at the CURRENT price', async () => {
  const mine = forTool(await myOfferings(provider.token), 'brief');
  const morselOffering = mine.find(o => o.unit === 'morsels');
  assert(!!morselOffering, 'a morsel listing exists to contract');
  const acc = await json('/v1/exchange/entitlements', {
    method: 'POST', headers: auth(consumer.token),
    body: JSON.stringify({ offering_id: morselOffering!.offeringId, cap_units: 100 }),
  });
  assert(acc.status === 201, `contract ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
  contractedPrice = acc.body.data.entitlement.price_per_call;
  assert(contractedPrice === 11, `contracted at the listed 11, got ${contractedPrice}`);
  assert(acc.body.data.entitlement.surface?.ifaceVersion === 1, 'contract pinned to interface v1');
});

await test('INVARIANT: repricing the source does NOT change an existing contract', async () => {
  const w = await writeManifest(provider.token, [tool({ price: { morsels: 99 } })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const listed = forTool(await myOfferings(provider.token), 'brief').find(o => o.unit === 'morsels');
  assert(listed!.basePrice === 99, `the market shows the new price, got ${listed!.basePrice}`);
  const mine = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
  assert(mine.status === 200, `entitlements ${mine.status}`);
  const ent = (mine.body.data.entitlements as any[]).find(e => e.ext === `apptool:${provider.name}/${APP_ID}` && e.action === 'brief');
  assert(!!ent, 'the consumer still holds the contract');
  assert(ent.price_per_call === 11, `contract keeps its agreed 11, got ${ent.price_per_call}`);
  assert(ent.surface?.ifaceVersion === 1, `contract keeps its pinned interface v1, got ${JSON.stringify(ent.surface)}`);
});

await test('INVARIANT: a schema change mints a new interface version but keeps the SAME listing', async () => {
  const w = await writeManifest(provider.token, [tool({
    price: { morsels: 99 },
    outputSchema: { type: 'object', properties: { echo: {}, caller: { type: 'string' }, extra: { type: 'string' } } },
  })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const listed = forTool(await myOfferings(provider.token), 'brief').filter(o => o.unit === 'morsels');
  assert(listed.length === 1, `still one morsel listing after a schema change, got ${listed.length}`);
  assert(listed[0].offeringId === offeringId, 'the listing is re-pointed, not replaced');
  assert(listed[0].surface.ifaceVersion === 2, `listing now offers v2, got ${listed[0].surface.ifaceVersion}`);
  const mine = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
  const ent = (mine.body.data.entitlements as any[]).find(e => e.action === 'brief');
  assert(ent.surface?.ifaceVersion === 1, `the existing contract stays on v1, got ${ent.surface?.ifaceVersion}`);
});

// ── Turning it off, and the guard against hand-delisting a projection ────────
await test('A projected listing cannot be hand-delisted → 409 SOURCE_MANAGED (turn the flag off instead)', async () => {
  const r = await json(`/v1/exchange/offerings/${offeringId}`, { method: 'DELETE', headers: auth(provider.token) });
  assert(r.status === 409 && r.body?.error?.code === 'SOURCE_MANAGED', `expected SOURCE_MANAGED, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('Turning `exchange` off in the manifest removes every listing for that tool', async () => {
  const w = await writeManifest(provider.token, [tool({ price: { morsels: 99 }, exchange: false })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const mine = forTool(await myOfferings(provider.token), 'brief');
  assert(mine.length === 0, `no listings remain, got ${mine.length}`);
});

await test('…and the consumer\'s contract SURVIVES the delisting (a listing is not a contract)', async () => {
  const mine = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
  const ent = (mine.body.data.entitlements as any[]).find(e => e.action === 'brief');
  assert(!!ent && ent.state === 'active', `contract still active after delisting: ${JSON.stringify(ent?.state)}`);
  assert(ent.price_per_call === 11, 'and still at its agreed price');
});

await test('Re-flagging revives the SAME listing id rather than minting a duplicate', async () => {
  const w = await writeManifest(provider.token, [tool({ price: { morsels: 99 } })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const mine = forTool(await myOfferings(provider.token), 'brief').filter(o => o.unit === 'morsels');
  assert(mine.length === 1 && mine[0].offeringId === offeringId, `revived ${offeringId}, got ${JSON.stringify(mine.map(o => o.offeringId))}`);
});

// ── Migration: a hand-authored listing is adopted, keeping its id ────────────
await test('Migration: a hand-authored listing is adopted (flag set at the source, offeringId kept)', async () => {
  // A second tool, priced but NOT flagged, listed the old way.
  const w = await writeManifest(provider.token, [
    tool({ price: { morsels: 99 } }),
    { name: 'legacy', description: 'listed by hand', action_id: capId, inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA, price: { morsels: 5 } },
  ]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const listed = await json('/v1/exchange/offerings', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ kind: 'app-tool', app_id: APP_ID, tool: 'legacy', usage_terms: TERMS }),
  });
  assert(listed.status === 201, `manual listing ${listed.status}: ${JSON.stringify(listed.body?.error)}`);
  const legacyId = listed.body.data.offering.offeringId;
  assert(listed.body.data.offering.auto !== true, 'a hand-authored listing is not a projection yet');

  const dry = await json('/v1/exchange/reconcile', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ migrate: true, dry_run: true }) });
  assert(dry.status === 200 && dry.body.data.dryRun === true, `dry run ${dry.status}: ${JSON.stringify(dry.body?.error)}`);
  assert((dry.body.data.flagged as string[]).some(f => f.endsWith('/legacy')), `dry run names the legacy tool: ${JSON.stringify(dry.body.data.flagged)}`);
  const afterDry = forTool(await myOfferings(provider.token), 'legacy');
  assert(afterDry.length === 1 && afterDry[0].auto !== true, 'a dry run changes nothing');

  const run = await json('/v1/exchange/reconcile', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ migrate: true }) });
  assert(run.status === 200, `migrate ${run.status}: ${JSON.stringify(run.body?.error)}`);
  const adopted = forTool(await myOfferings(provider.token), 'legacy');
  assert(adopted.length === 1, `still exactly one listing for the legacy tool, got ${adopted.length}`);
  assert(adopted[0].offeringId === legacyId, `offeringId preserved (${legacyId}), got ${adopted[0].offeringId}`);
  assert(adopted[0].auto === true, 'the legacy listing is now a projection');
});

await test('Reconcile is idempotent: a second run reports no creations or delistings', async () => {
  const r = await json('/v1/exchange/reconcile', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({}) });
  assert(r.status === 200, `reconcile ${r.status}`);
  assert(r.body.data.created === 0 && r.body.data.delisted === 0, `no churn: ${JSON.stringify(r.body.data)}`);
});

await test('A tool flagged but missing its schemas is skipped with a reason, never half-listed', async () => {
  const w = await writeManifest(provider.token, [
    tool({ price: { morsels: 99 } }),
    { name: 'noschema', action_id: capId, price: { morsels: 4 }, exchange: true },
  ]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const r = await json('/v1/exchange/reconcile', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ dry_run: true }) });
  const skipped = (r.body.data.changes as any[]).filter(c => c.action === 'skipped' && c.label.endsWith('/noschema'));
  assert(skipped.length === 1 && skipped[0].reason === 'SCHEMA_REQUIRED', `skipped with a reason: ${JSON.stringify(r.body.data.changes)}`);
  assert(forTool(await myOfferings(provider.token), 'noschema').length === 0, 'and nothing was listed for it');
});

// ── ODPS: the app owns its descriptor. App-level defaults on the manifest root are inherited by every
// tool; the tool overrides field by field; and the whole thing surfaces as the listing's ODPS document.
await test('App-level ODPS defaults are inherited by every tool of that app', async () => {
  const w = await writeManifest(provider.token, [tool({ name: 'brief' })], {
    odps: {
      dataHolder: { legalName: 'Overscale Solutions Oy', businessID: '3312345-6' },
      governanceProfile: 'audit_ready', brandSlogan: 'Know your counterparty',
    },
    provenance: { source: 'PRH open register', legalBasis: 'Public register' },
  });
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const listing = forTool(await myOfferings(provider.token), 'brief')[0];
  assert(listing, 'the tool is listed');
  assert(listing.odps?.dataHolder?.legalName === 'Overscale Solutions Oy', `app defaults inherited: ${JSON.stringify(listing.odps)}`);
  assert(listing.provenance?.legalBasis === 'Public register' && listing.provenance?.odpsVersion === '4.1',
    `provenance inherited + stamped: ${JSON.stringify(listing.provenance)}`);
  const res = await fetch(`${BASE}/v1/exchange/offerings/${listing.offeringId}/odps.yaml`);
  const doc = await res.text();
  assert(res.status === 200 && doc.includes('Overscale Solutions Oy'), 'the ODPS document carries the app-level data holder');
  assert(doc.includes('governanceProfile: audit_ready'), `governance profile projected: ${doc.slice(0, 200)}`);
});

await test('A tool overrides the app default field by field, keeping the rest', async () => {
  const w = await writeManifest(provider.token, [tool({
    name: 'brief',
    odps: { valueProposition: 'Verified company identity in one call.', productType: 'derived data' },
    provenance: { transformations: 'Normalised names.' },
  })], {
    odps: { dataHolder: { legalName: 'Overscale Solutions Oy' }, brandSlogan: 'Know your counterparty' },
    provenance: { source: 'PRH open register', legalBasis: 'Public register' },
  });
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const listing = forTool(await myOfferings(provider.token), 'brief')[0];
  assert(listing.odps?.valueProposition?.startsWith('Verified'), `tool field applied: ${JSON.stringify(listing.odps)}`);
  assert(listing.odps?.dataHolder?.legalName === 'Overscale Solutions Oy', 'app default still inherited');
  assert(listing.provenance?.source === 'PRH open register' && listing.provenance?.transformations === 'Normalised names.',
    `provenance merged both ways: ${JSON.stringify(listing.provenance)}`);
  const doc = await (await fetch(`${BASE}/v1/exchange/offerings/${listing.offeringId}/odps.yaml`)).text();
  assert(doc.includes('Verified company identity') && doc.includes('type: derived data'), 'tool-level ODPS reached the document');
});

await test('Editing the ODPS descriptor changes the listing without touching the price', async () => {
  const before = forTool(await myOfferings(provider.token), 'brief')[0];
  const w = await writeManifest(provider.token, [tool({
    name: 'brief',
    odps: { valueProposition: 'Company identity, verified against the register.', productType: 'derived data' },
  })], { odps: { dataHolder: { legalName: 'Overscale Solutions Oy' } } });
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const after = forTool(await myOfferings(provider.token), 'brief')[0];
  assert(after.offeringId === before.offeringId, 'the same listing is updated, not a rival one');
  assert(after.basePrice === before.basePrice, 'the price is untouched by a description edit');
  assert(after.odps.valueProposition.startsWith('Company identity'), 'the new description is live');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
