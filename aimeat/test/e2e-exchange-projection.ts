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
/** An agent session token, signed with the private key its registration returned. */
async function agentToken(gaii: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(priv, gaii + ts) }) });
  assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
  return body.data.token as string;
}
const hasKeys = (v: unknown): boolean => !!v && typeof v === 'object' && Object.keys(v as Record<string, unknown>).length > 0;

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

await test('INVARIANT: switching rails starts a FRESH meter (a EUR balance is not morsels)', async () => {
  // One (consumer, ext, action) triple holds one contract, so accepting a second rail for the same
  // tool re-mints the first. `spentUnits` is denominated in the contract's own unit, and carrying it
  // across turned 0.22 EUR into 220 000 morsels on a live listing beside a "1 morsel" price.
  const mine = forTool(await myOfferings(provider.token), 'brief');
  const morsel = mine.find(o => o.unit === 'morsels');
  const eur = mine.find(o => o.unit === 'money' && o.currency === 'EUR');
  assert(!!morsel && !!eur, `both rails are listed: ${JSON.stringify(mine.map(o => `${o.unit}/${o.currency}`))}`);

  // Spend on the morsel contract the previous test signed, so there is a balance to carry.
  const call = await json(`/v1/apps/${encodeURIComponent(provider.name)}/${encodeURIComponent(APP_ID)}/webmcp/tools/brief`, {
    method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ businessId: '0101263-6' }),
  });
  assert(call.status === 200, `metered call ${call.status}: ${JSON.stringify(call.body?.error)}`);
  const readEnt = async () => {
    const r = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
    return (r.body.data.entitlements as any[]).find(e => e.ext === `apptool:${provider.name}/${APP_ID}` && e.action === 'brief');
  };
  const spent = await readEnt();
  assert(spent.unit === 'morsels' && spent.budget.spent_units === 11 && spent.budget.calls === 1,
    `one call at 11 morsels: ${JSON.stringify(spent.budget)} ${spent.unit}`);

  // Now take the EUR listing for the same tool.
  const acc = await json('/v1/exchange/entitlements', {
    method: 'POST', headers: auth(consumer.token),
    body: JSON.stringify({ offering_id: eur!.offeringId, cap_units: 1_000_000 }),
  });
  assert(acc.status === 201, `EUR accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
  const after = await readEnt();
  assert(after.unit === 'money' && after.currency === 'EUR', `rail switched: ${after.unit}/${after.currency}`);
  assert(after.budget.spent_units === 0 && after.budget.calls === 0,
    `the morsel balance must NOT ride onto the EUR meter, got ${JSON.stringify(after.budget)}`);

  // And back again: the EUR spend must not become morsels either.
  const back = await json('/v1/exchange/entitlements', {
    method: 'POST', headers: auth(consumer.token),
    body: JSON.stringify({ offering_id: morsel!.offeringId, cap_units: 100 }),
  });
  assert(back.status === 201, `morsel re-accept ${back.status}: ${JSON.stringify(back.body?.error)}`);
  const home = await readEnt();
  assert(home.unit === 'morsels' && home.budget.spent_units === 0, `fresh meter on return: ${JSON.stringify(home.budget)}`);
});

await test('Usage stats and lineage are per RAIL, not per coordinate', async () => {
  // The two listings share (provider, ext, action). Matching on the coordinate alone showed each
  // listing the other's contracts and summed morsels and EUR micro-units into one "settled" figure.
  const mine = forTool(await myOfferings(provider.token), 'brief');
  const morsel = mine.find(o => o.unit === 'morsels')!;
  const eur = mine.find(o => o.unit === 'money' && o.currency === 'EUR')!;
  const consumersOf = async (id: string) => {
    const r = await json(`/v1/exchange/offerings/${id}/consumers`, { headers: auth(provider.token) });
    assert(r.status === 200, `consumers ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data.consumers as any[];
  };
  const onMorsel = await consumersOf(morsel.offeringId);
  const onEur = await consumersOf(eur.offeringId);
  assert(onMorsel.every(c => c.unit === 'morsels'), `morsel listing shows only morsel contracts: ${JSON.stringify(onMorsel)}`);
  assert(onEur.every(c => c.unit === 'money'), `EUR listing shows only money contracts: ${JSON.stringify(onEur)}`);
  // The consumer holds exactly one live contract (the morsel one, re-taken above), so the EUR
  // listing must claim nobody rather than borrowing it.
  assert(onEur.length === 0, `the EUR listing has no contract of its own, got ${JSON.stringify(onEur)}`);
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

await test('An EXTENSION ACTION carries its own ODPS descriptor from the manifest to the document', async () => {
  // The extension manifest normaliser whitelists `commercial` fields; before this it dropped the ODPS
  // blocks, so an ext-action listing — the original EXCHANGE surface — could not be described at all.
  const EXT2 = `xodps${Date.now()}`;
  const m = JSON.stringify({
    metadata: { name: EXT2, version: '1.0.0', description: 'ODPS ext source', author: 'e2e' },
    actions: [{
      id: 'search', method: 'POST', path: '/search', script: 'echo',
      input: IN_SCHEMA, output: OUT_SCHEMA,
      commercial: {
        payMorsels: 3, exchange: true, usageTerms: TERMS,
        provenance: { source: 'PRH open register', legalBasis: 'CC BY 4.0 open data' },
        odps: { productType: 'derived data', valueProposition: 'Company identity from the register.',
          dataHolder: { legalName: 'Overscale Solutions Oy' } },
      },
    }],
  });
  const ins = await json('/v1/extensions', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ manifest: m, scripts: { echo: 'export default async function(ctx, input){ return { echo: input }; }' } }),
  });
  assert(ins.status === 201 || ins.status === 200, `install ${ins.status}: ${JSON.stringify(ins.body?.error)}`);
  await json(`/v1/extensions/${EXT2}/activate`, { method: 'POST', headers: auth(provider.token) });
  const listing = (await myOfferings(provider.token)).find((o: any) => o.ext === EXT2 && o.action === 'search');
  assert(listing, 'the flagged action is listed');
  assert(listing.provenance?.legalBasis === 'CC BY 4.0 open data' && listing.provenance?.odpsVersion === '4.1',
    `manifest provenance reached the listing: ${JSON.stringify(listing.provenance)}`);
  assert(listing.odps?.dataHolder?.legalName === 'Overscale Solutions Oy', `manifest odps reached the listing: ${JSON.stringify(listing.odps)}`);
  const doc = await (await fetch(`${BASE}/v1/exchange/offerings/${listing.offeringId}/odps.yaml`)).text();
  assert(doc.includes('Company identity from the register.') && doc.includes('Overscale Solutions Oy'),
    'and the ODPS document carries it');
});

await test('Adopting a hand-authored listing never erases an attestation its source cannot express', async () => {
  // Turning `exchange` on for a capability that already had a hand-authored listing must keep the
  // provenance the provider stated: an emptied legal basis is worse than a stale one.
  // A priced action that is NOT flagged for EXCHANGE: the pre-projection way of listing by hand.
  const EXT3 = `xhand${Date.now()}`;
  const m3 = JSON.stringify({
    metadata: { name: EXT3, version: '1.0.0', description: 'hand-listed source', author: 'e2e' },
    actions: [{ id: 'lookup', method: 'POST', path: '/lookup', script: 'echo', input: IN_SCHEMA, output: OUT_SCHEMA, commercial: { payMorsels: 4 } }],
  });
  const i3 = await json('/v1/extensions', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ manifest: m3, scripts: { echo: 'export default async function(ctx, input){ return { echo: input }; }' } }),
  });
  assert(i3.status === 201 || i3.status === 200, `install ${i3.status}: ${JSON.stringify(i3.body?.error)}`);
  await json(`/v1/extensions/${EXT3}/activate`, { method: 'POST', headers: auth(provider.token) });
  const acted = await json('/v1/exchange/offerings', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({
      ext: EXT3, action: 'lookup', title: 'Hand-authored with provenance', usage_terms: TERMS,
      provenance: { source: 'Stated by hand', legalBasis: 'Legitimate interest' },
    }),
  });
  assert(acted.status === 201, `hand-listed ${acted.status}: ${JSON.stringify(acted.body?.error)}`);
  const id = acted.body.data.offering.offeringId;
  const mig = await json('/v1/exchange/reconcile', {
    method: 'POST', headers: auth(provider.token), body: JSON.stringify({ migrate: true }),
  });
  assert(mig.status === 200, `migrate ${mig.status}`);
  const after = (await myOfferings(provider.token)).find((o: any) => o.offeringId === id);
  assert(after, 'the adopted listing kept its id');
  assert(after.provenance?.legalBasis === 'Legitimate interest',
    `the hand-stated attestation survived adoption: ${JSON.stringify(after.provenance)}`);
});

// -- The task shape: an UNBOUND tool lists as agent-work ---------------------
// The checkout has fulfilled unbound tools as tasks since phase B, while the projection skipped
// them, so the market could not list what the shop could already sell. These prove the listing is
// RUNNABLE and not merely visible: a consumer contracts, starts work, and it names the assignee.

const TASK_APP = `taskproj-${Date.now()}.html`;
const AGENT = `deliverer${Date.now()}`.slice(0, 28);

const writeTaskManifest = (token: string, tools: unknown[]) =>
  json('/v1/memory', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ key: `apps.${TASK_APP}.tools`, visibility: 'public', value: { version: 1, tools } }),
  });
const taskListings = async (token: string, taskType: string) =>
  (await myOfferings(token)).filter(o => o.ext === `agentwork:${provider.name}/${AGENT}` && o.action === taskType);
const unbound = (over: Record<string, unknown> = {}) => ({
  name: 'digest', description: 'A written digest, delivered by an agent',
  inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA, usageTerms: TERMS,
  price: { morsels: 5 }, exchange: true, agent: AGENT, ...over,
});

await test('Setup: the provider has an agent that can receive fulfillment tasks', async () => {
  const reg = await json('/v1/agents', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ name: AGENT, owner: provider.name, capabilities: ['memory'], scopes: ['*'] }),
  });
  assert(reg.status === 201, `register agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
});

await test('An unbound tool with a named agent lists as AGENT-WORK carrying its taskSpec', async () => {
  const w = await writeTaskManifest(provider.token, [unbound()]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}: ${JSON.stringify(w.body?.error)}`);
  const mine = await taskListings(provider.token, 'digest');
  assert(mine.length === 1, `exactly one agent-work listing, got ${mine.length}`);
  const o = mine[0];
  assert(o.kind === 'agent-work' && o.auto === true, `kind/auto: ${JSON.stringify({ kind: o.kind, auto: o.auto })}`);
  assert(o.unit === 'morsels' && o.basePrice === 5, `price from the manifest: ${o.unit}/${o.basePrice}`);
  assert(o.surface?.agentName === AGENT && o.surface?.taskType === 'digest',
    `the surface names the assignee the work path builds its GAII from: ${JSON.stringify(o.surface)}`);
  assert(hasKeys(o.taskSpec?.inputSchema) && hasKeys(o.taskSpec?.outputSchema),
    `the taskSpec carries both schemas: ${JSON.stringify(o.taskSpec)}`);
});

await test('The listing is RUNNABLE: a consumer contracts and starts work on the named assignee', async () => {
  const o = (await taskListings(provider.token, 'digest'))[0];
  const acc = await json('/v1/exchange/entitlements', {
    method: 'POST', headers: auth(consumer.token),
    body: JSON.stringify({ offering_id: o.offeringId, cap_units: 50 }),
  });
  assert(acc.status === 201, `accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
  const started = await json('/v1/exchange/work', {
    method: 'POST', headers: auth(consumer.token),
    body: JSON.stringify({ offering_id: o.offeringId, input: { businessId: '3323553-5' } }),
  });
  assert(started.status === 200 || started.status === 201, `start work ${started.status}: ${JSON.stringify(started.body?.error)}`);
  const w = JSON.stringify(started.body.data);
  assert(w.includes(AGENT), `the work went to the manifest agent: ${w.slice(0, 240)}`);
});

await test('An unbound tool with NO agent is skipped, not listed, because nobody could deliver it', async () => {
  const w = await writeTaskManifest(provider.token, [unbound({ name: 'orphan', agent: undefined })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const mine = (await myOfferings(provider.token)).filter(o => o.action === 'orphan' && o.state === 'listed');
  assert(mine.length === 0, `no listing for an unassigned task tool, got ${mine.length}`);
  const dry = await json('/v1/exchange/reconcile', {
    method: 'POST', headers: auth(provider.token), body: JSON.stringify({ dry_run: true, app_id: TASK_APP }),
  });
  assert(dry.status === 200, `dry-run ${dry.status}`);
  const changes = dry.body.data.report?.changes ?? dry.body.data.changes ?? [];
  const why = changes.find((c: any) => c.reason === 'NO_ASSIGNEE');
  assert(!!why, `the report says why rather than going quiet: ${JSON.stringify(changes).slice(0, 300)}`);
});

await test('An unbound tool naming an agent that does not exist is skipped, a listing must not lie', async () => {
  const w = await writeTaskManifest(provider.token, [unbound({ name: 'ghost', agent: 'nobody-here-at-all' })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const mine = (await myOfferings(provider.token)).filter(o => o.action === 'ghost' && o.state === 'listed');
  assert(mine.length === 0, `no listing for a phantom assignee, got ${mine.length}`);
});

await test('The task-shape listing is retirable BY ITS OWN APP: a scoped reconcile can see it', async () => {
  await writeTaskManifest(provider.token, [unbound()]);
  const live = (await taskListings(provider.token, 'digest')).filter(o => o.state === 'listed');
  assert(live.length === 1, `listed again before the scoped retire, got ${live.length}`);
  const id = live[0].offeringId;
  assert(live[0].surface?.appId === TASK_APP,
    `the surface remembers which app declared it, else a scoped reconcile is blind: ${JSON.stringify(live[0].surface)}`);

  // Empty the manifest. The write triggers a reconcile scoped to THIS app, and that scoped pass is
  // the whole subject of this test. Read the offering BY ID afterwards: the market list endpoint
  // runs an unscoped reconcile of its own before answering, which would sweep the orphan up and
  // hide the defect (it did exactly that in the first version of this test).
  await writeTaskManifest(provider.token, []);
  const one = await json(`/v1/exchange/offerings/${id}`);
  assert(one.status === 200, `read the offering by id ${one.status}`);
  const state = (one.body.data.offering ?? one.body.data).state;
  assert(state === 'delisted',
    `the app retired its own task listing through the scoped pass, state is "${state}"`);
});

await test('Delisting still works from the source: dropping the flag removes the agent-work card', async () => {
  const w = await writeTaskManifest(provider.token, [unbound({ exchange: false })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const live = (await taskListings(provider.token, 'digest')).filter(o => o.state === 'listed');
  assert(live.length === 0, `the card came off the market, still listed: ${live.length}`);
});


await test("A provider's own AGENT browsing the market does not wipe the provider's listings", async () => {
  await writeManifest(provider.token, [tool()]);                 // one bound tool, listed
  const before = forTool(await myOfferings(provider.token), 'brief').filter(o => o.state === 'listed');
  assert(before.length >= 1, `something to lose before the browse, got ${before.length}`);

  // Browse as an AGENT of the same owner. The browse reconciles the caller first, and an agent's
  // identity is a GAII — if that reaches reconcile unnormalised, the manifests are looked for in
  // the agent's own namespace, come back empty, and every projected listing is delisted as unwanted.
  const reg = await json('/v1/agents', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ name: `browser${Date.now()}`.slice(0, 28), owner: provider.name, capabilities: ['memory'], scopes: ['*'] }),
  });
  assert(reg.status === 201, `register browsing agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const agentTok = await agentToken(reg.body.data.agent.gaii, reg.body.data.private_key);
  const browsed = await json('/v1/exchange/offerings', { headers: auth(agentTok) });
  assert(browsed.status === 200, `agent browse ${browsed.status}`);

  const after = forTool(await myOfferings(provider.token), 'brief').filter(o => o.state === 'listed');
  assert(after.length === before.length,
    `the market survived being read by an agent: ${before.length} listed before, ${after.length} after`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
