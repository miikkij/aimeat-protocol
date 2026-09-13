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
 *   v1.3.0 — 2026-09-13 — The developer's two decisions. LIST ONCE: a tool and the flagged extension
 *     action it calls list once (the action is skipped DUPLICATE_OF and its listing withdrawn, a contract
 *     on it keeps settling at 3), a lockedInput tool brings the action back under the same id with
 *     ALSO_LISTED_AS on both sides, and another owner's tool takes nothing off this owner's market.
 *     ODPS_FIELD_TOO_LONG at the write: refused 422 with field, length, cap and room on MCP
 *     app_tools_publish, POST, PUT and PATCH /v1/memory, PUT offers (another owner hears 403 first)
 *     and the extension install, with nothing written; text a stored record already carries still
 *     publishes with the warning until one character of it changes.
 *   v1.2.0 — 2026-09-13 — What a publish says back: aimeat_app_tools_publish over MCP and PUT
 *     /v1/agents/:name/offers name what listed, what was skipped and why, and the warnings
 *     (ALSO_LISTED_AS for a tool that duplicates a flagged extension action, ODPS_FIELD_TOO_LONG for a
 *     restriction past 255 characters, published whole). Both listings of a duplicate stay listed.
 *     Another owner's PUT onto the agent's offers is refused 403 and delists nothing.
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

/** One agent MCP session over /v1/mcp (OAuth code grant signed with the agent key), with a tools/call helper. */
async function mcpSession(gaii: string, priv: string) {
  const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'Projection E2E', redirect_uris: [] }) });
  assert(reg.status === 201, `oauth register ${reg.status}`);
  const ts = new Date().toISOString();
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.body.client_id, gaii, signature: await sign(priv, gaii + NODE_ID + ts), timestamp: ts });
  const code = (await json(`/v1/mcp/authorize?${q}`)).body.code;
  assert(typeof code === 'string', 'authorize returned no code');
  const tok = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: reg.body.client_id, client_secret: reg.body.client_secret }) });
  assert(tok.status === 200, `token ${tok.status}`);
  let sessionId = ''; let id = 0;
  const rpc = async (method: string, params: Record<string, unknown> = {}, notify = false) => {
    const res = await fetch(`${BASE}/v1/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tok.body.access_token}`,
        ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
      },
      body: JSON.stringify(notify ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', id: ++id, method, params }),
    });
    sessionId = res.headers.get('mcp-session-id') ?? sessionId;
    const text = await res.text();
    const frames = (res.headers.get('content-type') ?? '').includes('event-stream')
      ? text.split('\n').filter(l => l.startsWith('data: ')).map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean)
      : (text ? [JSON.parse(text)] : []);
    return frames.find((f: any) => f.id === id) ?? frames[0] ?? {};
  };
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Projection E2E', version: '1.0.0' } });
  assert(init.result !== undefined, `initialize: ${JSON.stringify(init).slice(0, 200)}`);
  await rpc('notifications/initialized', {}, true);
  return {
    call: async (name: string, args: Record<string, unknown>) => {
      const body = await rpc('tools/call', { name, arguments: args });
      const text = body.result?.content?.[0]?.text ?? '';
      let data: any = null;
      try { data = JSON.parse(text); } catch { /* a refusal is plain text */ }
      return { isError: !!body.result?.isError, text, data };
    },
  };
}

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

// The combined price lives on its own tool, so the morsel-only `brief` above keeps testing the
// plain case. `paid` is what a real priced tool looks like: money AND a morsel figure, together.
const paidTool = (over: Record<string, unknown> = {}) => tool({
  name: 'paid', description: 'Paid brief',
  price: { morsels: 11 }, priceMoney: { amount: 20_000, currency: 'EUR' }, ...over,
});

await test('COMBINED PRICE: money + morsels declared together = ONE listing, morsels as its pacing toll', async () => {
  // The authoring UI shows one price, "11 morsels · 0.02 EUR", and the marketplace card shows one
  // product. This used to project TWO purchasable listings, so a buyer could take the morsel side
  // and pay the provider nothing at all — for a second product nobody ever declared.
  const w = await writeManifest(provider.token, [tool({ price: { morsels: 11 } }), paidTool()]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}: ${JSON.stringify(w.body?.error)}`);
  const mine = forTool(await myOfferings(provider.token), 'paid');
  assert(mine.length === 1, `one listing, not one per unit, got ${mine.length}: ${JSON.stringify(mine.map(o => `${o.unit}/${o.currency}`))}`);
  assert(mine[0].unit === 'money' && mine[0].currency === 'EUR' && mine[0].basePrice === 20_000,
    `priced in the money it declared: ${JSON.stringify({ unit: mine[0].unit, cur: mine[0].currency, p: mine[0].basePrice })}`);
  assert(mine[0].tollMorsels === 11, `the morsel figure became the pacing toll, got ${mine[0].tollMorsels}`);
  // And the morsel-only tool beside it is untouched: no money declared means morsels ARE the price.
  const plain = forTool(await myOfferings(provider.token), 'brief');
  assert(plain.length === 1 && plain[0].unit === 'morsels',
    `a morsels-only tool still lists in morsels: ${JSON.stringify(plain.map(o => `${o.unit}/${o.currency}`))}`);
});

await test('An explicit tollMorsels still wins over the combined-price figure', async () => {
  const w = await writeManifest(provider.token, [tool({ price: { morsels: 11 } }), paidTool({ tollMorsels: 3 })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const mine = forTool(await myOfferings(provider.token), 'paid');
  assert(mine.length === 1 && mine[0].tollMorsels === 3, `declared toll kept, got ${JSON.stringify(mine.map(o => o.tollMorsels))}`);
});

await test('EUR + USD on one tool → one listing per currency, all sharing the tool coordinate', async () => {
  const w = await writeManifest(provider.token, [tool({ price: { morsels: 11 } }), paidTool({
    pricesMoney: [{ amount: 20_000, currency: 'EUR' }, { amount: 25_000, currency: 'USD' }],
  })]);
  assert(w.status === 200 || w.status === 201, `write ${w.status}`);
  const mine = forTool(await myOfferings(provider.token), 'paid');
  assert(mine.length === 2, `EUR + USD = 2 listings and NO morsel rival, got ${mine.length}: ${JSON.stringify(mine.map(o => `${o.unit}/${o.currency}`))}`);
  const eur = mine.find(o => o.currency === 'EUR'), usd = mine.find(o => o.currency === 'USD');
  assert(!!eur && eur.basePrice === 20_000, `EUR listing at 0.02: ${JSON.stringify(eur)}`);
  assert(!!usd && usd.basePrice === 25_000, `USD listing at 0.025: ${JSON.stringify(usd)}`);
  assert(mine.every(o => o.auto === true && o.unit === 'money'), 'every currency row is a projection, and money');
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

await test('?ext= alone NARROWS the market — a filter the server drops is worse than one it rejects', async () => {
  // Requiring ext AND action together meant `?ext=` fell through to "list everything": an app
  // showing its own tools listed a moon-phase service and a Rick & Morty lookup beside them.
  const mineExt = `apptool:${provider.name}/${APP_ID}`;
  const all = await json('/v1/exchange/offerings', { headers: auth(consumer.token) });
  assert(all.status === 200, `list ${all.status}`);
  const filtered = await json(`/v1/exchange/offerings?ext=${encodeURIComponent(mineExt)}`, { headers: auth(consumer.token) });
  assert(filtered.status === 200, `filtered ${filtered.status}`);
  const rows = filtered.body.data.offerings as any[];
  assert(rows.length > 0, "the filter finds this app's own listings");
  assert(rows.every(o => o.ext === mineExt), `every row belongs to the asked-for ext: ${JSON.stringify(rows.map(o => o.ext))}`);
  // Not "fewer rows than the market" — in this fixture the provider IS the market, so that
  // would pass or fail on who else happens to be listed. A filter that narrows returns nothing
  // for a coordinate nobody offers; one that is silently dropped returns everything.
  const bogus = await json('/v1/exchange/offerings?ext=apptool:nobody/none.html', { headers: auth(consumer.token) });
  assert((bogus.body.data.offerings as any[]).length === 0,
    `an ext nobody offers returns nothing, got ${(bogus.body.data.offerings as any[]).length} of ${(all.body.data.offerings as any[]).length}`);
  // action alone narrows too, without an ext beside it.
  const byAction = await json('/v1/exchange/offerings?action=brief', { headers: auth(consumer.token) });
  assert((byAction.body.data.offerings as any[]).every(o => o.action === 'brief'), 'action alone narrows as well');
});

await test('INVARIANT: switching rails starts a FRESH meter (a USD balance is not EUR)', async () => {
  // One (consumer, ext, action) triple holds one contract, so accepting a second rail for the same
  // tool re-mints the first. `spentUnits` is denominated in the contract's own unit, and carrying it
  // across turned 0.22 EUR into 220 000 morsels on a live listing beside a "1 morsel" price.
  // The rails here are EUR and USD: a combined price no longer projects a morsel rival to switch
  // to, so a currency change is the switch that remains reachable — and the same carry would ruin
  // it, 0.02 EUR is not 0.02 USD.
  const mine = forTool(await myOfferings(provider.token), 'paid');
  const eur = mine.find(o => o.currency === 'EUR');
  const usd = mine.find(o => o.currency === 'USD');
  assert(!!eur && !!usd, `both currency rails are listed: ${JSON.stringify(mine.map(o => `${o.unit}/${o.currency}`))}`);

  const take = (id: string, cap: number) => json('/v1/exchange/entitlements', {
    method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ offering_id: id, cap_units: cap }),
  });
  const first = await take(eur!.offeringId, 1_000_000);
  assert(first.status === 201, `EUR contract ${first.status}: ${JSON.stringify(first.body?.error)}`);

  // Spend on it, so there is a balance that could wrongly carry.
  const call = await json(`/v1/apps/${encodeURIComponent(provider.name)}/${encodeURIComponent(APP_ID)}/webmcp/tools/paid`, {
    method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ businessId: '0101263-6' }),
  });
  assert(call.status === 200, `metered call ${call.status}: ${JSON.stringify(call.body?.error)}`);
  const readEnt = async () => {
    const r = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
    return (r.body.data.entitlements as any[]).find(e => e.ext === `apptool:${provider.name}/${APP_ID}` && e.action === 'paid');
  };
  const spent = await readEnt();
  assert(spent.unit === 'money' && spent.currency === 'EUR' && spent.budget.spent_units === 20_000 && spent.budget.calls === 1,
    `one call at 0.02 EUR: ${JSON.stringify(spent.budget)} ${spent.unit}/${spent.currency}`);

  const acc = await take(usd!.offeringId, 1_000_000);
  assert(acc.status === 201, `USD accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
  const after = await readEnt();
  assert(after.unit === 'money' && after.currency === 'USD', `rail switched: ${after.unit}/${after.currency}`);
  assert(after.budget.spent_units === 0 && after.budget.calls === 0,
    `the EUR balance must NOT ride onto the USD meter, got ${JSON.stringify(after.budget)}`);

  // And back again: the USD spend must not become EUR either.
  const back = await take(eur!.offeringId, 1_000_000);
  assert(back.status === 201, `EUR re-accept ${back.status}: ${JSON.stringify(back.body?.error)}`);
  const home = await readEnt();
  assert(home.currency === 'EUR' && home.budget.spent_units === 0, `fresh meter on return: ${JSON.stringify(home.budget)}`);
});

await test('Usage stats and lineage are per RAIL, not per coordinate', async () => {
  // The two listings share (provider, ext, action). Matching on the coordinate alone showed each
  // listing the other's contracts and summed the two currencies into one "settled" figure.
  const mine = forTool(await myOfferings(provider.token), 'paid');
  const eur = mine.find(o => o.currency === 'EUR')!;
  const usd = mine.find(o => o.currency === 'USD')!;
  const consumersOf = async (id: string) => {
    const r = await json(`/v1/exchange/offerings/${id}/consumers`, { headers: auth(provider.token) });
    assert(r.status === 200, `consumers ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data.consumers as any[];
  };
  const onEur = await consumersOf(eur.offeringId);
  const onUsd = await consumersOf(usd.offeringId);
  assert(onEur.every(c => c.unit === 'money'), `EUR listing shows only money contracts: ${JSON.stringify(onEur)}`);
  // A combined price charges money AND burns morsels, and the burn lands on the wallet rather than
  // on the entitlement meter — so a provider reading `settledUnits` alone sees half their own price.
  // The row carries the frozen toll and the burn it produced, per contract, so nothing is inferred
  // from a listing's toll TODAY (a contract older than the toll has calls and no burn at all).
  assert(onEur.every(c => c.tollMorsels === 11), `the contract's frozen toll rides on the row: ${JSON.stringify(onEur.map(c => c.tollMorsels))}`);
  assert(onEur.every(c => c.burnedMorsels === c.calls * c.tollMorsels),
    `burned morsels are calls x toll: ${JSON.stringify(onEur.map(c => [c.calls, c.tollMorsels, c.burnedMorsels]))}`);
  // The consumer holds exactly one live contract (the EUR one, re-taken above), so the USD
  // listing must claim nobody rather than borrowing it.
  assert(onUsd.length === 0, `the USD listing has no contract of its own, got ${JSON.stringify(onUsd)}`);
});

// ── No bypass: the raw door onto a priced product is the same product ────────
await test('BYPASS: calling the backing extension action directly is NOT free once a tool sells it', async () => {
  // The hole this closes, measured on production 2026-07-27: nuotta.html/search sold
  // ext:kaiku-signals:search for 0.01 EUR while any signed-in principal could POST
  // /v1/ext/kaiku-signals/search and get the identical answer for nothing. Every priced app on the
  // node had that bypass beside its own front door — it is not a property of one extension.
  const stranger = await setupOwner('by');
  const direct = await json(`/v1/ext/${EXT}/free`, {
    method: 'POST', headers: auth(stranger.token), body: JSON.stringify({ businessId: '0101263-6' }),
  });
  assert(direct.status === 402, `a stranger must be charged, got ${direct.status}: ${JSON.stringify(direct.body).slice(0, 200)}`);
  assert(direct.body?.error?.code === 'PAYMENT_REQUIRED', `402 says why: ${JSON.stringify(direct.body?.error)}`);
  // The refusal must NAME the product, or the caller has no way to become a customer.
  // Both `brief` and `paid` bind this one capability, which is exactly the ambiguity a first-match
  // lookup would resolve by accident — the refusal names every product it is sold as.
  const named = (direct.body?.app_tools ?? []).map((a: any) => a.tool).sort();
  assert(JSON.stringify(named) === JSON.stringify(['brief', 'paid']),
    `the 402 names every listing that sells it: ${JSON.stringify(direct.body?.app_tools)}`);
});

await test('BYPASS: the provider still calls their own extension free', async () => {
  const own = await json(`/v1/ext/${EXT}/free`, {
    method: 'POST', headers: auth(provider.token), body: JSON.stringify({ businessId: '0101263-6' }),
  });
  assert(own.status === 200, `owner-free survives, got ${own.status}: ${JSON.stringify(own.body?.error)}`);
});

const entOf = async (action: string) => {
  const r = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
  return (r.body.data.entitlements as any[]).find(e => e.ext === `apptool:${provider.name}/${APP_ID}` && e.action === action);
};

await test('BYPASS: holding two products on one capability, the raw route settles the CHEAPER of them', async () => {
  // Same capability, different door — but `brief` (11 morsels) and `paid` (0.02 EUR) are different
  // PRODUCTS, and a raw request carries nothing saying which was meant. It used to resolve that by
  // spelling, which billed whichever tool sorted first. Ambiguity now costs the least it could have
  // meant: a morsel right settles before a money one, and the other contract is not touched.
  const beforeBrief = await entOf('brief'), beforePaid = await entOf('paid');
  const raw = await json(`/v1/ext/${EXT}/free`, {
    method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ businessId: '0101263-6' }),
  });
  assert(raw.status === 200, `the contract holder gets through, got ${raw.status}: ${JSON.stringify(raw.body?.error)}`);
  const afterBrief = await entOf('brief'), afterPaid = await entOf('paid');
  assert(afterBrief.budget.calls === beforeBrief.budget.calls + 1,
    `exactly one call on the cheaper contract, ${beforeBrief.budget.calls} → ${afterBrief.budget.calls}`);
  assert(afterBrief.budget.spent_units === beforeBrief.budget.spent_units + afterBrief.price_per_call,
    `charged its own agreed price once: ${beforeBrief.budget.spent_units} → ${afterBrief.budget.spent_units} at ${afterBrief.price_per_call}`);
  assert(afterPaid.budget.calls === beforePaid.budget.calls,
    `the money contract is untouched — one call is one charge: ${JSON.stringify(afterPaid.budget)}`);
});

await test('BYPASS: naming the product overrides the default, and only among products they hold', async () => {
  // A caller who means the money product says so. The name is a request, not an instruction: it must
  // be a tool that really sells this action, and one they really contracted.
  const beforeBrief = await entOf('brief'), beforePaid = await entOf('paid');
  const named = await json(`/v1/ext/${EXT}/free`, {
    method: 'POST', headers: { ...auth(consumer.token), 'x-aimeat-app-tool': `${APP_ID}/paid` },
    body: JSON.stringify({ businessId: '0101263-6' }),
  });
  assert(named.status === 200, `the named product serves its holder, got ${named.status}: ${JSON.stringify(named.body?.error)}`);
  const afterBrief = await entOf('brief'), afterPaid = await entOf('paid');
  assert(afterPaid.budget.calls === beforePaid.budget.calls + 1,
    `the NAMED contract is the one that moved: ${beforePaid.budget.calls} → ${afterPaid.budget.calls}`);
  assert(afterBrief.budget.calls === beforeBrief.budget.calls,
    `and the cheaper default stayed put: ${JSON.stringify(afterBrief.budget)}`);
  // A tool that does not sell this action is a bad request, never a fallback to guessing.
  const bogus = await json(`/v1/ext/${EXT}/free`, {
    method: 'POST', headers: { ...auth(consumer.token), 'x-aimeat-app-tool': `${APP_ID}/not-a-tool` },
    body: JSON.stringify({ businessId: '0101263-6' }),
  });
  assert(bogus.status === 400, `naming a product that does not sell it is refused, got ${bogus.status}`);
  const settled = await entOf('brief');
  assert(settled.budget.calls === afterBrief.budget.calls, 'and a refused name charges nothing');
});

await test('NO DOUBLE CHARGE: the app-tool endpoint charges once, not once per door it passes through', async () => {
  // The metered app-tool path invokes an extension over this node's own HTTP surface, so the call
  // meets the raw paywall on the way. Settling in both places would charge one call twice.
  const readEnt = async () => {
    const r = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
    return (r.body.data.entitlements as any[]).find(e => e.ext === `apptool:${provider.name}/${APP_ID}` && e.action === 'paid');
  };
  const before = await readEnt();
  const call = await json(`/v1/apps/${encodeURIComponent(provider.name)}/${encodeURIComponent(APP_ID)}/webmcp/tools/paid`, {
    method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ businessId: '0101263-6' }),
  });
  assert(call.status === 200, `metered call ${call.status}: ${JSON.stringify(call.body?.error)}`);
  const after = await readEnt();
  assert(after.budget.calls === before.budget.calls + 1,
    `ONE call, not two: ${before.budget.calls} → ${after.budget.calls}`);
  assert(after.budget.spent_units === before.budget.spent_units + 20_000,
    `ONE charge of 0.02 EUR, not two: ${before.budget.spent_units} → ${after.budget.spent_units}`);
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

// ── What a publish says back (2026-09-13). The shared write reconciled the listings and dropped the
// report, so a tool flagged and priced but skipped answered `priced: true` like one that listed; a tool
// bound to an extension action that was itself flagged made two listings and said nothing; and a long
// usage note produced an ODPS document outside the schema without a word. The developer then decided
// both open questions the same day: a tool and the extension action it calls LIST ONCE (unless the tool
// fixes part of its input), and a write that makes an ODPS field too long is REFUSED unless that text
// was already stored.
const XDUP = `xdup${Date.now()}`;
const DUP_APP = `dup-${Date.now()}.html`;
const DUP_TOOLS = (over: Record<string, unknown> = {}) => [
  { name: 'find', action_id: `ext:${XDUP}:search`, inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA, price: { morsels: 5 }, exchange: true,
    usageTerms: TERMS, ...over },
  { name: 'noout', action_id: `ext:${XDUP}:search`, inputSchema: IN_SCHEMA, price: { morsels: 5 }, exchange: true },
];
let sellerMcp: Awaited<ReturnType<typeof mcpSession>>;
let dupActionId = '';

await test('MCP app_tools_publish lists a tool and the extension action it calls ONCE, and says what it skipped and why', async () => {
  const ins = await json('/v1/extensions', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({
      manifest: JSON.stringify({
        metadata: { name: XDUP, version: '1.0.0', description: 'flagged twice', author: 'e2e' },
        actions: [{ id: 'search', method: 'POST', path: '/search', script: 'echo', input: IN_SCHEMA, output: OUT_SCHEMA,
          commercial: { payMorsels: 3, exchange: true, usageTerms: TERMS } }],
      }),
      scripts: { echo: 'export default async function(ctx, input){ return { echo: input }; }' },
    }),
  });
  assert(ins.status === 201, `a new extension installs with 201, got ${ins.status}: ${JSON.stringify(ins.body?.error)}`);
  await json(`/v1/extensions/${XDUP}/activate`, { method: 'POST', headers: auth(provider.token) });
  const before = (await myOfferings(provider.token)).find(o => o.ext === XDUP && o.action === 'search' && o.state === 'listed');
  assert(!!before, 'the flagged extension action is listed before the tool is published');
  dupActionId = before.offeringId;

  // A buyer contracts the action's own listing while it is the only one.
  const acc = await json('/v1/exchange/entitlements', {
    method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ offering_id: dupActionId, cap_units: 100 }),
  });
  assert(acc.status === 201 && acc.body.data.entitlement.price_per_call === 3, `contract on the action at 3: ${acc.status} ${JSON.stringify(acc.body?.error ?? acc.body.data.entitlement)}`);

  const reg = await json('/v1/agents', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ name: `seller${Date.now()}`.slice(0, 28), owner: provider.name, capabilities: ['commerce'], scopes: ['commerce:sell', 'memory:read', 'memory:write'] }),
  });
  assert(reg.status === 201, `register seller agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  sellerMcp = await mcpSession(reg.body.data.agent.gaii, reg.body.data.private_key);
  const r = await sellerMcp.call('aimeat_app_tools_publish', { app_id: DUP_APP, tools: DUP_TOOLS() });
  assert(!r.isError, `publish: ${r.text.slice(0, 300)}`);
  const ex = r.data?.exchange;
  assert(ex?.known === true, `the answer carries the projection's outcome: ${JSON.stringify(ex).slice(0, 300)}`);
  const listed = (ex.listed as any[]).find(l => l.label === `${DUP_APP}/find`);
  assert(!!listed && typeof listed.offeringId === 'string', `the listed tool is named with its offering: ${JSON.stringify(ex.listed)}`);
  assert(!(ex.listed as any[]).some(l => l.label === `${XDUP}/search`), `the extension action is not listed beside it: ${JSON.stringify(ex.listed)}`);
  const skipped = ex.skipped as any[];
  assert(skipped.some(s => s.label === `${DUP_APP}/noout` && s.reason === 'SCHEMA_REQUIRED'), `the skipped tool is named with its reason: ${JSON.stringify(skipped)}`);
  const dup = skipped.find(s => s.label === `${XDUP}/search`);
  assert(dup?.reason === `DUPLICATE_OF ${DUP_APP}/find` && String(dup.message).includes('agreed price'),
    `the action is skipped as the tool's duplicate, with a sentence: ${JSON.stringify(skipped)}`);
  assert((ex.delisted as any[]).some(d => d.offeringId === dupActionId), `the action's listing is withdrawn, and said: ${JSON.stringify(ex.delisted)}`);
  assert(!(ex.warnings as any[]).some(w => String(w.reason).startsWith('ALSO_LISTED_AS')), `nothing is listed twice: ${JSON.stringify(ex.warnings)}`);

  // Read by id: the market list reconciles first and could hide what the publish itself did.
  const byId = await json(`/v1/exchange/offerings/${dupActionId}`);
  assert(byId.status === 200 && byId.body.data.offering.state === 'delisted', `the same offering id, delisted: ${JSON.stringify(byId.body.data?.offering?.state)}`);
  const dry = await json('/v1/exchange/reconcile', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ dry_run: true }) });
  assert(dry.status === 200, `dry run ${dry.status}`);
  const changes = dry.body.data.changes as any[];
  assert(changes.some(c => c.action === 'skipped' && c.label === `${XDUP}/search` && c.reason === `DUPLICATE_OF ${DUP_APP}/find`)
    && !changes.some(c => String(c.reason).startsWith('ALSO_LISTED_AS') && (c.label === `${XDUP}/search` || c.label === `${DUP_APP}/find`)),
    `a full reconcile agrees: ${JSON.stringify(changes.filter(c => c.label === `${XDUP}/search`))}`);
});

await test('…and the contract signed on the withdrawn action keeps settling at its agreed price', async () => {
  const ent = async () => ((await json('/v1/exchange/entitlements', { headers: auth(consumer.token) })).body.data.entitlements as any[])
    .find(e => e.ext === XDUP && e.action === 'search');
  const was = await ent();
  assert(was?.state === 'active' && was.price_per_call === 3 && was.contract_ref === `offering:${dupActionId}`, `the contract is intact: ${JSON.stringify(was)}`);
  const call = await json(`/v1/ext/${XDUP}/search`, { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ q: 'x' }) });
  assert(call.status === 200, `the holder still gets through on the raw route, got ${call.status}: ${JSON.stringify(call.body?.error)}`);
  const now = await ent();
  assert(now.budget.calls === was.budget.calls + 1 && now.budget.spent_units === was.budget.spent_units + 3,
    `one call, charged the 3 signed: ${JSON.stringify(was.budget)} → ${JSON.stringify(now.budget)}`);
});

await test('A tool that fixes part of the input is a different product: the action comes back, and both carry ALSO_LISTED_AS', async () => {
  const r = await sellerMcp.call('aimeat_app_tools_publish', { app_id: DUP_APP, tools: DUP_TOOLS({ lockedInput: { businessId: 'budget' } }) });
  assert(!r.isError, `publish: ${r.text.slice(0, 300)}`);
  const ex = r.data.exchange;
  assert((ex.listed as any[]).some(l => l.label === `${XDUP}/search` && l.offeringId === dupActionId),
    `the action lists again under the SAME offering id: ${JSON.stringify(ex.listed)}`);
  const w = (ex.warnings as any[]).find(x => x.label === `${DUP_APP}/find` && x.reason === `ALSO_LISTED_AS ${XDUP}/search`);
  assert(!!w && String(w.message).includes('lockedInput') && w.otherListing?.offeringId === dupActionId, `the pair is named: ${JSON.stringify(ex.warnings)}`);
  const dry = await json('/v1/exchange/reconcile', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ dry_run: true }) });
  const rows = (dry.body.data.changes as any[]).filter(c => c.action === 'warning' && String(c.reason).startsWith('ALSO_LISTED_AS'));
  assert(rows.some(c => c.label === `${XDUP}/search` && c.reason === `ALSO_LISTED_AS ${DUP_APP}/find`)
    && rows.some(c => c.label === `${DUP_APP}/find` && c.reason === `ALSO_LISTED_AS ${XDUP}/search`), `both sides are warned: ${JSON.stringify(rows)}`);
});

await test("Another owner's tool naming this owner's extension action takes nothing off this owner's market", async () => {
  const other = await setupOwner('lo');
  const w = await json('/v1/memory', {
    method: 'POST', headers: auth(other.token),
    body: JSON.stringify({ key: `apps.theirs-${Date.now()}.html.tools`, visibility: 'public', value: { version: 1, tools: [
      { name: 'grab', action_id: `ext:${XDUP}:search`, inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA, price: { morsels: 1 }, exchange: true, usageTerms: TERMS },
    ] } }),
  });
  assert(w.status === 201, `their manifest ${w.status}: ${JSON.stringify(w.body?.error)}`);
  const byId = await json(`/v1/exchange/offerings/${dupActionId}`);
  assert(byId.body.data.offering.state === 'listed', `still listed after a stranger's publish: ${byId.body.data.offering.state}`);
  // Nor does this owner's own full reconcile count a stranger's tool as the seller of their action.
  const dry = await json('/v1/exchange/reconcile', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ dry_run: true }) });
  assert(!(dry.body.data.changes as any[]).some(c => c.label === `${XDUP}/search` && c.action === 'skipped'),
    `the action is not skipped for a tool of another owner: ${JSON.stringify((dry.body.data.changes as any[]).filter(c => c.label === `${XDUP}/search`))}`);
});

await test('ODPS_FIELD_TOO_LONG: a changed text past the cap is refused on every door, before anything is written', async () => {
  const note = 'n'.repeat(200);                     // 98 characters of node sentences + a space + 200 = 299 > 255
  const long = { usageTerms: { ...TERMS, note } };
  const room156 = (fields: any[]) => fields?.some(f => f.source_field.endsWith('usageTerms.note') && f.odps_field === 'product.license.scope.restrictions'
    && f.length === 299 && f.max_length === 255 && f.room === 156);

  // MCP: the manifest keeps its stored version.
  const stored = (await sellerMcp.call('aimeat_app_tools_get', { app_id: DUP_APP })).data.manifest;
  const m = await sellerMcp.call('aimeat_app_tools_publish', { app_id: DUP_APP, tools: DUP_TOOLS(long) });
  assert(m.isError && m.text.startsWith('ODPS_FIELD_TOO_LONG') && m.text.includes('tools[find].usageTerms.note') && m.text.includes('"room":156'),
    `the MCP door refuses and names the field and the room: ${m.text.slice(0, 400)}`);
  const after = (await sellerMcp.call('aimeat_app_tools_get', { app_id: DUP_APP })).data.manifest;
  assert(after.version === stored.version && !JSON.stringify(after).includes(note), 'nothing was written');

  // POST /v1/memory (the door the connector and the CLI publish through): a new key is not created.
  const NEW_APP = `long-${Date.now()}.html`;
  const post = await json('/v1/memory', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ key: `apps.${NEW_APP}.tools`, visibility: 'public', value: { version: 1, tools: DUP_TOOLS(long) } }),
  });
  assert(post.status === 422 && post.body.error?.code === 'ODPS_FIELD_TOO_LONG' && room156(post.body.error?.details?.fields),
    `POST /v1/memory refuses with the numbers: ${post.status} ${JSON.stringify(post.body?.error)}`);
  assert((await json(`/v1/memory/${encodeURIComponent(`apps.${NEW_APP}.tools`)}`, { headers: auth(provider.token) })).status === 404, 'and creates nothing');

  // PUT and PATCH /v1/memory/:key on the stored manifest.
  const key = encodeURIComponent(`apps.${DUP_APP}.tools`);
  const rec = await json(`/v1/memory/${key}`, { headers: auth(provider.token) });
  const put = await json(`/v1/memory/${key}`, { method: 'PUT', headers: auth(provider.token), body: JSON.stringify({ value: { ...rec.body.data.value, tools: DUP_TOOLS(long) }, version: rec.body.data.version }) });
  assert(put.status === 422 && put.body.error?.code === 'ODPS_FIELD_TOO_LONG' && room156(put.body.error?.details?.fields), `PUT refuses: ${put.status} ${JSON.stringify(put.body?.error)}`);
  const patch = await json(`/v1/memory/${key}`, { method: 'PATCH', headers: auth(provider.token), body: JSON.stringify({ patch: { tools: DUP_TOOLS(long) } }) });
  assert(patch.status === 422 && patch.body.error?.code === 'ODPS_FIELD_TOO_LONG', `PATCH refuses: ${patch.status} ${JSON.stringify(patch.body?.error)}`);
  const unchanged = await json(`/v1/memory/${key}`, { headers: auth(provider.token) });
  assert(unchanged.body.data.version === rec.body.data.version, `the record is where it was: v${rec.body.data.version} → v${unchanged.body.data.version}`);

  // An extension install whose flagged action carries the note.
  const XLONG = `xlong${Date.now()}`;
  const ext = await json('/v1/extensions', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({
      manifest: JSON.stringify({
        metadata: { name: XLONG, version: '1.0.0', description: 'long note', author: 'e2e' },
        actions: [{ id: 'search', method: 'POST', path: '/search', script: 'echo', input: IN_SCHEMA, output: OUT_SCHEMA,
          commercial: { payMorsels: 3, exchange: true, usageTerms: { ...TERMS, note } } }],
      }),
      scripts: { echo: 'export default async function(ctx, input){ return { echo: input }; }' },
    }),
  });
  assert(ext.status === 422 && ext.body.error?.code === 'ODPS_FIELD_TOO_LONG' && room156(ext.body.error?.details?.fields),
    `the extension install refuses: ${ext.status} ${JSON.stringify(ext.body?.error)}`);
  assert((await json(`/v1/extensions/${XLONG}`, { headers: auth(provider.token) })).status === 404, 'and installs nothing');
});

await test('ODPS_FIELD_TOO_LONG: text a stored record already carries keeps publishing, with the warning, until it changes', async () => {
  // Stored while the tool was not for sale, which no rule refuses, then flagged without touching the text.
  const note = 'n'.repeat(200);
  const APPX = `kept-${Date.now()}.html`;
  const write = (over: Record<string, unknown>) => json('/v1/memory', {
    method: 'POST', headers: auth(provider.token),
    // Bound to the unpriced `free` action, so this listing takes no extension action off the market.
    body: JSON.stringify({ key: `apps.${APPX}.tools`, visibility: 'public', value: { version: 1, tools: DUP_TOOLS({ action_id: capId, usageTerms: { ...TERMS, note }, ...over }).slice(0, 1) } }),
  });
  const off = await write({ exchange: false });
  assert(off.status === 201, `an unflagged tool with a long note is stored: ${off.status} ${JSON.stringify(off.body?.error)}`);
  const on = await write({});
  assert(on.status === 200, `flagging it leaves the stored text as it was, so it is not refused: ${on.status} ${JSON.stringify(on.body?.error)}`);
  const warn = (on.body.data.exchange?.warnings as any[] ?? []).find(w => w.reason === 'ODPS_FIELD_TOO_LONG product.license.scope.restrictions');
  assert(!!warn && warn.odpsField?.length === 299, `it lists with the warning: ${JSON.stringify(on.body.data.exchange)}`);
  const repriced = await write({ price: { morsels: 6 } });
  assert(repriced.status === 200, `republishing for a price change still passes: ${repriced.status} ${JSON.stringify(repriced.body?.error)}`);
  const doc = await json(`/v1/exchange/offerings/${(on.body.data.exchange.listed as any[])[0].offeringId}/odps`);
  assert(String(doc.body.data?.odps?.product?.license?.scope?.restrictions ?? '').endsWith(note), 'and the text is published whole, never cut');
  const edited = await write({ usageTerms: { ...TERMS, note: `${note}!` } });
  assert(edited.status === 422 && edited.body.error?.details?.fields?.[0]?.length === 300, `changing the text by one character is refused: ${edited.status} ${JSON.stringify(edited.body?.error)}`);
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

await test('PUT offers answers which offers listed, and names the skipped ones with their reason', async () => {
  const offer = (id: string, over: Record<string, unknown> = {}) => ({
    id, title: `Offer ${id}`, ask: 'Send a business id; I write the brief.', deliverable: { format: 'document', sample: 'untested' },
    inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA, price: { morsels: 4 }, exchange: true, visibility: 'public', ...over,
  });
  const r = await json(`/v1/agents/${encodeURIComponent(AGENT)}/offers`, {
    method: 'PUT', headers: auth(provider.token),
    body: JSON.stringify({ offers: [offer('sold'), offer('hidden', { visibility: 'private' }), offer('noout', { outputSchema: undefined })] }),
  });
  assert(r.status === 200, `publish offers ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const ex = r.body.data.exchange;
  assert(ex?.known === true, `the answer carries the projection's outcome: ${JSON.stringify(r.body.data).slice(0, 300)}`);
  assert((ex.listed as any[]).some(l => l.label === `${AGENT}:sold` && l.kind === 'agent-work' && l.offeringId),
    `the listed offer is named: ${JSON.stringify(ex.listed)}`);
  const why = Object.fromEntries((ex.skipped as any[]).map(s => [s.label, s.reason]));
  assert(why[`${AGENT}:hidden`] === 'NOT_PUBLIC' && why[`${AGENT}:noout`] === 'SCHEMA_REQUIRED',
    `each skipped offer says why: ${JSON.stringify(ex.skipped)}`);
  // Another owner cannot rewrite this agent's offers: an empty list from them would delist what sold.
  // Addressed by the full GAII, because a bare name resolves under the caller's own account.
  const soldId = (ex.listed as any[]).find(l => l.label === `${AGENT}:sold`).offeringId;
  const other = await setupOwner('px');
  const agentGaii = `${AGENT}#${provider.name}@${NODE_ID}`;
  const denied = await json(`/v1/agents/${encodeURIComponent(agentGaii)}/offers`, { method: 'PUT', headers: auth(other.token), body: JSON.stringify({ offers: [] }) });
  assert(denied.status === 403 && denied.body.error?.code === 'ACCESS_DENIED',
    `another owner's PUT is refused with 403 ACCESS_DENIED, got ${denied.status}: ${JSON.stringify(denied.body?.error)}`);
  assert((await myOfferings(provider.token)).some(o => o.offeringId === soldId && o.state === 'listed'),
    'and the listing it would have removed is still on the market');
  // Leave the agent with no offers, so the task-shape tests below read only what they wrote.
  const clear = await json(`/v1/agents/${encodeURIComponent(AGENT)}/offers`, { method: 'PUT', headers: auth(provider.token), body: JSON.stringify({ offers: [] }) });
  assert(clear.status === 200 && (clear.body.data.exchange?.delisted as any[])?.some(d => d.offeringId),
    `clearing the offers delists the one that sold, and says so: ${JSON.stringify(clear.body.data.exchange)}`);
});

await test('PUT offers refuses ODPS_FIELD_TOO_LONG before the write, and another owner hears 403 before the length is read', async () => {
  const note = 'n'.repeat(200);
  const offer = { id: 'longnote', title: 'Long note', ask: 'Send an id.', deliverable: { format: 'document', sample: 'untested' },
    inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA, price: { morsels: 4 }, exchange: true, visibility: 'public', usageTerms: { ...TERMS, note } };
  const r = await json(`/v1/agents/${encodeURIComponent(AGENT)}/offers`, { method: 'PUT', headers: auth(provider.token), body: JSON.stringify({ offers: [offer] }) });
  const f = r.body.error?.details?.fields?.[0];
  assert(r.status === 422 && r.body.error?.code === 'ODPS_FIELD_TOO_LONG'
    && f?.entry === `${AGENT}:longnote` && f.source_field === 'offers[longnote].usageTerms.note' && f.length === 299 && f.max_length === 255 && f.room === 156,
    `PUT offers refuses with the numbers: ${r.status} ${JSON.stringify(r.body?.error)}`);
  const stored = await json(`/v1/agents/${encodeURIComponent(AGENT)}/offers`, { headers: auth(provider.token) });
  assert((stored.body.data.offers as any[]).length === 0, `nothing was written: ${JSON.stringify(stored.body.data.offers)}`);
  const stranger = await setupOwner('ol');
  const foreign = await json(`/v1/agents/${encodeURIComponent(`${AGENT}#${provider.name}@${NODE_ID}`)}/offers`, {
    method: 'PUT', headers: auth(stranger.token), body: JSON.stringify({ offers: [offer] }),
  });
  assert(foreign.status === 403 && foreign.body.error?.code === 'ACCESS_DENIED', `another owner hears 403, not the length rule: ${foreign.status} ${JSON.stringify(foreign.body?.error)}`);
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
