/**
 * @file test/e2e-money-audit.ts
 * @description The money-correctness grid for everything priced on the node: can an unpaying principal
 *   reach a priced capability, and when it IS paid for does the charge match what the source declares —
 *   exactly, once, in the right unit, to the right party?
 *
 *   The subject is the SHAPE that every priced app on this node is built in: an app-tool manifest puts a
 *   price on a tool whose `action_id` binds an extension action, and that action declares no `commercial`
 *   block of its own. Every door onto that capability is walked here by every principal that can reach it —
 *   the raw extension route, the WebMCP app-tool route, the MCP twin of that route, the commerce checkout,
 *   the capability-invoke route, and the scheduler — because a price that holds on one door and not the next
 *   is not a price.
 * @structure setup (provider ext + priced manifest + consumer contract) · one test per (surface × principal)
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=money-audit
 * @version-history
 *   v1.1.0 — 2026-07-27 — GRANTS: the third class of principal in the product rule — a member the provider
 *     approved, carried rather than billed. Proved on every door, plus the ceiling, the revocation, the
 *     "a gift never overwrites a purchase" case, and which wallet the pacing toll comes out of.
 *   v1.0.0 — 2026-07-27 — Initial: the surface × principal grid behind one declared price.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExchangeRunTools } from '../src/mcp/exchange-run.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = parseInt(process.env.E2E_MONEY_PORT ?? '40279', 10);
const BASE = `http://localhost:${PORT}`;
process.env.AIMEAT_PORT = String(PORT);
process.env.AIMEAT_DEV_MODE = 'true';
process.env.AIMEAT_TEST_MODE = 'true';
process.env.AIMEAT_EXTENSIONS_ENABLED = 'true';
// The grid needs a principal per cell (provider, consumer, their agents, a stranger per hole). The
// registration limiter would otherwise refuse the later owners and report a node defect as a test one.
process.env.AIMEAT_REGISTRATION_RATE_LIMIT_MAX = '200';
// A fake EUR/USD handler, so the money RAIL is exercised rather than skipped. Half the questions in
// this file ("right unit?", "does a ceiling hold?") are only answerable if money can actually settle.
process.env.AIMEAT_TEST_MONEY_HANDLER = 'true';
if (!process.env.AIMEAT_ADMIN_PASSWORD) process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');
const { config } = loadConfig({});
config.port = PORT;
const NODE_ID = config.nodeId;
const { app, storage } = await createServer(config);
const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, () => resolve(s)); });

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `ma${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'MoneyAudit', password: 'Exchange1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'MoneyAudit', password: 'Exchange1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string, gaii: `${name}@${NODE_ID}` };
}
/** Register an agent under an owner and return a signed agent session token (a GAII principal). */
async function setupAgent(owner: { name: string; token: string }, agentName: string) {
    const reg = await json('/v1/agents', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name: agentName, owner: owner.name, capabilities: ['actions'] }) });
    assert(reg.status === 201, `agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const gaii = (reg.body.data.agent?.gaii ?? reg.body.data.gaii) as string;
    const priv = reg.body.data.private_key as string;
    const ts = new Date().toISOString();
    const t = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(priv, gaii + ts) }) });
    assert(t.body.ok === true, `agent token: ${JSON.stringify(t.body?.error)}`);
    return { gaii, token: t.body.data.token as string };
}
async function balance(token: string): Promise<number> {
    const r = await json('/v1/wallet', { headers: auth(token) });
    return Number(r.body.data.balance ?? r.body.data.total ?? 0);
}
/** The consumer's live contract for a coordinate — spend meter and call count, as the node sees them. */
async function contract(token: string, ext: string, action: string) {
    const r = await json('/v1/exchange/entitlements', { headers: auth(token) });
    return (r.body.data.entitlements as any[]).find(e => e.ext === ext && e.action === action) ?? null;
}
/** Wallet transactions of a principal, newest first — the only proof a burn or a credit actually happened. */
async function txns(token: string): Promise<any[]> {
    const r = await json('/v1/wallet/transactions?limit=50', { headers: auth(token) });
    return (r.body.data.transactions ?? r.body.data.items ?? []) as any[];
}
function captureTools(gaii: string, token: string): Record<string, (a: any) => Promise<any>> {
    const handlers: Record<string, (a: any) => Promise<any>> = {};
    const mock = { tool: (name: string, _d: unknown, _s: unknown, _a: unknown, h: (a: any) => Promise<any>) => { handlers[name] = h; } } as unknown as McpServer;
    registerExchangeRunTools(mock, storage, config, () => gaii, () => token);
    return handlers;
}
function parse(res: { content: { text: string }[]; isError?: boolean }) {
    const text = res.content[0].text;
    if (res.isError) return { error: text } as any;
    try { return { data: JSON.parse(text) } as any; } catch { return { data: text } as any; }
}

console.log('\n=== AIMEAT MONEY AUDIT — every door onto one declared price ===\n');

const EXT = `mext${Date.now()}`;
const APP = `moneyaudit-${Date.now()}.html`;
const CAP = `ext:${EXT}:work`;                 // sold under THREE tools — the ambiguous binding
const SOLO = `ext:${EXT}:solo`;                // sold under exactly one tool — the unambiguous binding
const PACED = `ext:${EXT}:paced`;              // the same, but its product declares a pacing toll
const BOOM = `ext:${EXT}:boom`;                // one tool, and the script throws after payment
const SCRIPTS = {
    work: 'export default async function(ctx, input){ return { echo: input, caller: ctx.caller.owner }; }',
    paced: 'export default async function(ctx, input){ return { echo: input, paced: true }; }',
    boom: 'export default async function(ctx, input){ throw new Error("boom after payment"); }',
};
const IN_SCHEMA = { type: 'object', properties: { q: { type: 'string' } } };
const OUT_SCHEMA = { type: 'object', properties: { echo: {}, caller: { type: 'string' } } };
const TERMS = { derivatives: true, resale: false, attribution: true, note: 'money audit' };

let operator: Awaited<ReturnType<typeof setupOwner>>;
let provider: Awaited<ReturnType<typeof setupOwner>>;
let consumer: Awaited<ReturnType<typeof setupOwner>>;
let providerAgent: Awaited<ReturnType<typeof setupAgent>>;
let consumerAgent: Awaited<ReturnType<typeof setupAgent>>;
let offeringBrief = '';
let offeringSolo = '';
let offeringPaced = '';

const rawInvoke = (token: string | null, action = 'work') =>
    json(`/v1/ext/${EXT}/${action}`, { method: 'POST', headers: token ? auth(token) : {}, body: JSON.stringify({ q: 'hi' }) });
const toolInvoke = (token: string | null, tool = 'brief') =>
    json(`/v1/apps/${encodeURIComponent(provider.name)}/${encodeURIComponent(APP)}/webmcp/tools/${tool}`,
        { method: 'POST', headers: token ? auth(token) : {}, body: JSON.stringify({ input: { q: 'hi' } }) });

await test('Setup: provider installs an extension whose actions declare NO commercial block', async () => {
    operator = await setupOwner('seed');            // the first owner on a fresh DB self-heals to operator
    provider = await setupOwner('prov');
    consumer = await setupOwner('cons');
    const manifest = JSON.stringify({
        metadata: { name: EXT, version: '1.0.0', description: 'money audit', author: 'e2e' },
        actions: [
            { id: 'work', method: 'POST', path: '/work', script: 'work' },
            { id: 'paced', method: 'POST', path: '/paced', script: 'paced' },
            { id: 'solo', method: 'POST', path: '/solo', script: 'work' },
            { id: 'dual', method: 'POST', path: '/dual', script: 'work' },
            { id: 'boom', method: 'POST', path: '/boom', script: 'boom' },
        ],
        config: { public_access: { default: true } },
        limits: { timeout_ms: 5000, max_api_calls: 1 },
    }, null, 2);
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ manifest, scripts: SCRIPTS }) });
    assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(provider.token) });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
    // Capability aggregation (an operator action) registers ext:{name}:{action} in the capability registry —
    // that record is what an app-tool's `action_id` resolves to on every invoke door.
    const agg = await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: auth(operator.token) });
    assert(agg.status === 200, `aggregate ${agg.status}: ${JSON.stringify(agg.body?.error)}`);
    providerAgent = await setupAgent(provider, 'pbot');
    consumerAgent = await setupAgent(consumer, 'cbot');
});

await test('Setup: the manifest prices those actions — one action sold three ways, one sold once', async () => {
    const base = { action_id: CAP, inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA, usageTerms: TERMS };
    const tools = [
        // `ext:X:work` — the SHARED capability: three products at three prices in two units.
        { ...base, name: 'brief', description: 'The product', price: { morsels: 8 }, exchange: true },
        { ...base, name: 'cheap', description: 'Same capability, second listing', price: { morsels: 3 }, exchange: true },
        { ...base, name: 'open', description: 'Declares no price at all' },
        { ...base, name: 'usdonly', description: 'Priced ONLY through pricesMoney', pricesMoney: [{ amount: 250000, currency: 'USD' }] },
        // `ext:X:solo` — one capability, one product, so every door can name the price without asking.
        { ...base, name: 'solo', description: 'The only tool selling its action', action_id: SOLO, price: { morsels: 8 }, exchange: true },
        // ONE tool sold in TWO currencies. Two listings, but one metered coordinate — which is exactly
        // where a spend ceiling could be walked around by re-taking the other one.
        { ...base, name: 'dual', description: 'One tool, EUR and USD', action_id: `ext:${EXT}:dual`,
          priceMoney: { amount: 100000, currency: 'EUR' }, pricesMoney: [{ amount: 100000, currency: 'EUR' }, { amount: 120000, currency: 'USD' }], exchange: true },
        { ...base, name: 'throws', description: 'Priced; the script throws', action_id: BOOM, price: { morsels: 8 }, exchange: true },
        // The morsel half of a combined price: 4 morsels revenue AND a 2-morsel burn that credits nobody.
        { ...base, name: 'paced', description: 'Priced and paced', action_id: PACED, price: { morsels: 4 }, tollMorsels: 2, exchange: true },
    ];
    const put = await json('/v1/memory', {
        method: 'POST', headers: auth(provider.token),
        body: JSON.stringify({ key: `apps.${APP}.tools`, visibility: 'public', value: { version: 1, tools } }),
    });
    assert(put.status === 201 || put.status === 200, `manifest ${put.status}: ${JSON.stringify(put.body?.error)}`);
    const offs = await json('/v1/exchange/offerings', { headers: auth(consumer.token) });
    const listed = (offs.body.data.offerings as any[]).filter(o => o.providerOwner === provider.name);
    const mine = listed.filter(o => o.action === 'brief');
    assert(mine.length === 1, `one listing per declared price, got ${mine.length}: ${JSON.stringify(mine.map(o => [o.unit, o.pricePerCall]))}`);
    offeringBrief = mine[0].offeringId;
    offeringSolo = listed.find(o => o.action === 'solo')?.offeringId ?? '';
    assert(!!offeringSolo, `the unambiguous tool is listed: ${JSON.stringify(listed.map(o => o.action))}`);
    offeringPaced = listed.find(o => o.action === 'paced')?.offeringId ?? '';
    assert(!!offeringPaced, `the paced tool is listed: ${JSON.stringify(listed.map(o => o.action))}`);
});

// ── The raw door (POST /v1/ext/:name/:action) ────────────────────────────────────────────────────

await test('RAW · anonymous → 401, never a result', async () => {
    const r = await rawInvoke(null);
    assert(r.status === 401, `expected 401, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
});

await test('RAW · the provider calls their own capability free', async () => {
    const before = await balance(provider.token);
    const r = await rawInvoke(provider.token);
    assert(r.status === 200, `provider ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(await balance(provider.token) === before, 'provider must not be charged for their own capability');
});

await test("RAW · an AGENT of the provider is the provider, and calls free", async () => {
    const before = await balance(provider.token);
    const r = await rawInvoke(providerAgent.token);
    assert(r.status === 200, `provider agent ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(await balance(provider.token) === before, 'the provider’s own agent pays nothing');
});

await test('RAW · another owner with NO contract → 402 naming the listing to contract (no free door)', async () => {
    const before = await balance(consumer.token);
    const r = await rawInvoke(consumer.token);
    assert(r.status === 402, `expected 402, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert(!r.body.data, 'a 402 must carry no result');
    assert(JSON.stringify(r.body).includes(APP), `the 402 names the app-tool to contract: ${JSON.stringify(r.body?.error)}`);
    assert(await balance(consumer.token) === before, 'a refused call charges nothing');
});

await test("RAW · an AGENT of another owner is not the provider either → 402", async () => {
    const r = await rawInvoke(consumerAgent.token);
    assert(r.status === 402, `expected 402, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
});

await test('CONTRACT · the consumer takes both contracts at exactly the declared prices', async () => {
    for (const id of [offeringBrief, offeringSolo]) {
        const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ offering_id: id, cap_units: 400 }) });
        assert(acc.status === 201, `accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
        const e = acc.body.data.entitlement;
        assert(e.unit === 'morsels' && e.price_per_call === 8, `contract unit/price: ${e.unit}/${e.price_per_call} (source says 8 morsels)`);
        assert(e.provider === provider.gaii, `provider is the seller: ${e.provider}`);
    }
});

await test('RAW · with ONE product behind the action, a contract holder pays the declared price once', async () => {
    const cExt = `apptool:${provider.name}/${APP}`;
    const cb = await balance(consumer.token), pb = await balance(provider.token);
    const before = await contract(consumer.token, cExt, 'solo');
    const r = await rawInvoke(consumer.token, 'solo');
    assert(r.status === 200, `contracted raw call ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const after = await contract(consumer.token, cExt, 'solo');
    assert(after.budget.calls === before.budget.calls + 1, `exactly one settlement, got ${after.budget.calls - before.budget.calls}`);
    assert(after.budget.spent_units === before.budget.spent_units + 8, `spent +8, got +${after.budget.spent_units - before.budget.spent_units}`);
    assert(await balance(consumer.token) === cb - 8, `consumer debited 8 (was ${cb}, now ${await balance(consumer.token)})`);
    assert(await balance(provider.token) > pb, 'the provider is credited their cut, not just metered');
});

await test('RAW · with SEVERAL products behind one action, an uncontracted caller is told all of them', async () => {
    const stranger = await setupOwner('amb0');
    const sb = await balance(stranger.token);
    const r = await rawInvoke(stranger.token);
    assert(r.status === 402, `expected 402, got ${r.status}: ${JSON.stringify(r.body).slice(0, 250)}`);
    const names = (r.body.app_tools ?? []).map((t: any) => t.tool).sort();
    assert(names.length >= 3 && names.includes('brief') && names.includes('usdonly'),
        `the 402 names every product sharing the capability: ${JSON.stringify(names)}`);
    assert((r.body.app_tools ?? []).every((t: any) => typeof t.invoke === 'string'), 'and where to call each one by name');
    assert(await balance(stranger.token) === sb, 'a refusal costs the caller nothing');
});

await test('RAW · ambiguity settles the CHEAPEST right the caller holds, not the first one alphabetically', async () => {
    // `brief` (8) sorts before `cheap` (3). A buyer holding both means neither in particular, so the
    // resolution must be the least it could have meant rather than the one spelling happens to pick.
    const both = await setupOwner('amb3');
    const off = await json('/v1/exchange/offerings', { headers: auth(both.token) });
    const find = (a: string) => (off.body.data.offerings as any[]).find(o => o.providerOwner === provider.name && o.action === a);
    for (const a of ['brief', 'cheap']) {
        const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(both.token), body: JSON.stringify({ offering_id: find(a).offeringId, cap_units: 200 }) });
        assert(acc.status === 201, `accept ${a}: ${acc.status} ${JSON.stringify(acc.body?.error)}`);
    }
    const bb = await balance(both.token);
    const r = await rawInvoke(both.token);
    assert(r.status === 200, `a holder of two gets through, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(bb - await balance(both.token) === 3, `charged the cheaper 3, moved ${bb - await balance(both.token)}`);
    // And naming the dearer one is honoured — the caller may still say what they meant.
    const nb = await balance(both.token);
    const named = await json(`/v1/ext/${EXT}/work`, {
        method: 'POST', headers: { ...auth(both.token), 'x-aimeat-app-tool': `${APP}/brief` }, body: JSON.stringify({ q: 'hi' }),
    });
    assert(named.status === 200, `naming a held product works, got ${named.status}: ${JSON.stringify(named.body?.error)}`);
    assert(nb - await balance(both.token) === 8, `named product charged its own 8, moved ${nb - await balance(both.token)}`);
});

await test('RAW · a name is a request, not an instruction — no talking onto a product you never bought', async () => {
    const one = await setupOwner('amb4');
    const off = await json('/v1/exchange/offerings', { headers: auth(one.token) });
    const cheapOff = (off.body.data.offerings as any[]).find(o => o.providerOwner === provider.name && o.action === 'cheap');
    assert((await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(one.token), body: JSON.stringify({ offering_id: cheapOff.offeringId, cap_units: 60 }) })).status === 201, 'holds only `cheap`');
    const bb = await balance(one.token);
    // Naming `brief`, which they never contracted: they are neither served it nor billed for it.
    const r = await json(`/v1/ext/${EXT}/work`, {
        method: 'POST', headers: { ...auth(one.token), 'x-aimeat-app-tool': `${APP}/brief` }, body: JSON.stringify({ q: 'hi' }),
    });
    assert(r.status === 402, `an uncontracted name owes 402, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    assert(await balance(one.token) === bb, `and takes nothing — moved ${bb - await balance(one.token)}`);
});

// ── The app-tool door (POST /v1/apps/:owner/:app/webmcp/tools/:tool) ─────────────────────────────

await test('APP-TOOL · the same contract settles ONCE through the app-tool door (the loopback is not charged twice)', async () => {
    const cExt = `apptool:${provider.name}/${APP}`;
    const cb = await balance(consumer.token);
    const before = await contract(consumer.token, cExt, 'brief');
    const r = await toolInvoke(consumer.token);
    assert(r.status === 200, `app-tool invoke ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const after = await contract(consumer.token, cExt, 'brief');
    assert(after.budget.calls === before.budget.calls + 1, `ONE settlement per call, got ${after.budget.calls - before.budget.calls}`);
    assert(after.budget.spent_units === before.budget.spent_units + 8, `spent +8, got +${after.budget.spent_units - before.budget.spent_units}`);
    assert(await balance(consumer.token) === cb - 8, `consumer debited 8 once, moved ${cb - await balance(consumer.token)}`);
});

await test('APP-TOOL · MCP `aimeat_app_tool_invoke` settles the SAME contract, also exactly once', async () => {
    const cExt = `apptool:${provider.name}/${APP}`;
    const cb = await balance(consumer.token);
    const before = await contract(consumer.token, cExt, 'brief');
    const res = parse(await captureTools(consumer.gaii, consumer.token)['aimeat_app_tool_invoke']({ owner: provider.name, app: APP, tool: 'brief', input: { q: 'hi' } }));
    assert(!res.error, `mcp invoke failed: ${res.error}`);
    const after = await contract(consumer.token, cExt, 'brief');
    assert(after.budget.calls === before.budget.calls + 1, `ONE settlement per call, got ${after.budget.calls - before.budget.calls}`);
    assert(after.budget.spent_units === before.budget.spent_units + 8, `spent +8, got +${after.budget.spent_units - before.budget.spent_units}`);
    assert(await balance(consumer.token) === cb - 8, `consumer debited 8 once, moved ${cb - await balance(consumer.token)}`);
});

await test('APP-TOOL · a tool that declares NO price stays free — it must not bill a sibling tool’s contract', async () => {
    const cExt = `apptool:${provider.name}/${APP}`;
    const cb = await balance(consumer.token);
    const before = await contract(consumer.token, cExt, 'brief');
    const r = await toolInvoke(consumer.token, 'open');
    assert(r.status === 200, `an unpriced tool must invoke: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const moved = cb - await balance(consumer.token);
    const after = await contract(consumer.token, cExt, 'brief');
    assert(moved === 0, `an unpriced tool charges nothing — it moved ${moved} morsels`);
    assert(after.budget.calls === before.budget.calls,
        `and it must not consume the 'brief' contract — that meter advanced ${after.budget.calls - before.budget.calls} call(s), +${after.budget.spent_units - before.budget.spent_units} units`);
});

await test('APP-TOOL · a tool priced only through `pricesMoney` is a priced tool, and never billed in morsels', async () => {
    // A stranger holding no contract at all: a priced tool owes them a 402, not a result.
    const stranger = await setupOwner('usd');
    const sb = await balance(stranger.token);
    const s = await toolInvoke(stranger.token, 'usdonly');
    assert(s.status === 402, `a money-priced tool owes an uncontracted caller 402, got ${s.status}: ${JSON.stringify(s.body?.data ?? s.body?.error).slice(0, 200)}`);
    assert(await balance(stranger.token) === sb, 'no morsels move on a money 402');
    // And a caller holding the MORSEL contract for a DIFFERENT tool must not be billed on it either.
    const cb = await balance(consumer.token);
    await toolInvoke(consumer.token, 'usdonly');
    const moved = cb - await balance(consumer.token);
    assert(moved === 0, `a USD-priced tool must never settle in morsels against another tool's contract — moved ${moved}`);
});

// ── The commerce door (payment IS the invocation) ────────────────────────────────────────────────

const buyOnce = async (buyer: { token: string }) => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: `${provider.name}/${APP}`, tool: 'brief', input: { q: 'paid' } }] }),
    });
    assert(create.status === 201, `create ${create.status}: ${JSON.stringify(create.body?.error)}`);
    return json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
};

await test('CHECKOUT · a buyer with no contract can still buy the tool — payment IS the invocation', async () => {
    const buyer = await setupOwner('buy');
    const done = await buyOnce(buyer);
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body?.error)}`);
    const results = done.body.data.session?.fulfillment?.results ?? [];
    assert(results.length === 1 && !!results[0].result, `the paid call returns its result: ${JSON.stringify(done.body.data.session?.fulfillment)}`);
});

await test('CHECKOUT · a buyer who ALSO holds a contract pays the declared price once, not on both rails', async () => {
    const cExt = `apptool:${provider.name}/${APP}`;
    const cb = await balance(consumer.token);
    const before = await contract(consumer.token, cExt, 'brief');
    const done = await buyOnce(consumer);
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body?.error)}`);
    const moved = cb - await balance(consumer.token);
    const after = await contract(consumer.token, cExt, 'brief');
    assert(moved === 8, `one purchase of an 8-morsel tool costs 8 — it moved ${moved}`);
    assert(after.budget.calls === before.budget.calls,
        `and the checkout must not ALSO burn the contract — the meter advanced ${after.budget.calls - before.budget.calls} call(s)`);
});

// ── The capability door (POST /v1/capabilities/:id/invoke) ───────────────────────────────────────

await test('CAPABILITY · invoking the backing capability directly is charged like every other door', async () => {
    const cExt = `apptool:${provider.name}/${APP}`;
    const cb = await balance(consumer.token);
    const before = await contract(consumer.token, cExt, 'solo');
    const r = await json(`/v1/capabilities/${encodeURIComponent(SOLO)}/invoke`, { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ input: { q: 'hi' } }) });
    assert(r.status === 200, `capability invoke ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const after = await contract(consumer.token, cExt, 'solo');
    assert(after.budget.spent_units === before.budget.spent_units + 8, `spent +8, got +${after.budget.spent_units - before.budget.spent_units}`);
    assert(await balance(consumer.token) === cb - 8, `consumer debited 8, moved ${cb - await balance(consumer.token)}`);
});

await test('CAPABILITY · and an uncontracted caller gets no result there either', async () => {
    const stranger = await setupOwner('capx');
    const sb = await balance(stranger.token);
    const r = await json(`/v1/capabilities/${encodeURIComponent(SOLO)}/invoke`, { method: 'POST', headers: auth(stranger.token), body: JSON.stringify({ input: { q: 'hi' } }) });
    assert(r.status >= 400, `expected a refusal, got ${r.status}: ${JSON.stringify(r.body).slice(0, 250)}`);
    assert(await balance(stranger.token) === sb, 'a refused call moves nothing');
});

// ── The scheduler door (who pays for a cron call?) ───────────────────────────────────────────────

await test("SCHEDULER · a stranger cannot put another owner's priced action on a recurring schedule", async () => {
    const r = await json('/v1/schedules', {
        method: 'POST', headers: auth(consumer.token),
        body: JSON.stringify({ kind: 'extension', name: 'free-forever', extension_name: EXT, action_id: 'work', cron: '*/5 * * * *', input: { q: 'cron' } }),
    });
    assert(r.status === 403 || r.status === 404, `expected refusal, got ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error).slice(0, 250)}`);
});

// ── Charge correctness: ceiling, refund, ambiguity, pacing ───────────────────────────────────────

await test('APP GRANT · an app the consumer connected cannot spend a contract it was never given', async () => {
    // `metered-entitlements.ts:6` states the model: "app-grants deliberately do NOT provide [a priced
    // call-right] — a grant confers scopes (capability *classes*), never a priced call-right to a
    // specific provider." An app grant resolves to the OWNER's GHII, and the consumer holds a `solo`
    // contract under that GHII, so this asks whether the stated model is what the node does.
    const cExt = `apptool:${provider.name}/${APP}`;
    const APP_FILE = `grant-probe-${Date.now()}.html`;
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(consumer.token),
        body: JSON.stringify({
            filename: APP_FILE, content: Buffer.from('<!DOCTYPE html><html><body>probe</body></html>').toString('base64'),
            name: 'Grant Probe', description: 'money audit probe', category: 'utility',
        }),
    });
    assert(pub.status === 201 || pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);

    // A grant for the narrowest scope there is — nothing about money, nothing about extensions.
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const REDIRECT = 'http://localhost:9/cb';
    const q = new URLSearchParams({
        app: `${consumer.name}/${APP_FILE}`, response_type: 'code', scope: 'memory:read',
        redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256',
    });
    const authz = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const rid = decodeURIComponent(/req=([^&]+)/.exec(authz.headers.get('location') ?? '')?.[1] ?? '');
    assert(!!rid, `authorize returned a request id: ${authz.headers.get('location')}`);
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ request_id: rid }),
    });
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
    });
    const appToken = tok.body.data.access_token as string;
    assert(!!appToken, `grant token issued: ${JSON.stringify(tok.body?.error)}`);

    const before = await contract(consumer.token, cExt, 'solo');
    const cb = await balance(consumer.token);
    const r = await json(`/v1/ext/${EXT}/solo`, { method: 'POST', headers: auth(appToken), body: JSON.stringify({ q: 'hi' }) });
    const after = await contract(consumer.token, cExt, 'solo');
    const moved = cb - await balance(consumer.token);
    assert(r.status !== 200 || moved === 0,
        `an app holding only memory:read reached a priced capability and spent ${moved} morsels of its owner's `
        + `contract (meter ${before.budget.calls} → ${after.budget.calls}). A grant confers scopes, not a call-right.`);
    assert(after.budget.calls === before.budget.calls,
        `and the owner's meter must not move for it: ${before.budget.calls} → ${after.budget.calls}`);
});

await test('CEILING · switching currency on the same tool does not hand back a spent budget', async () => {
    // `dual` is ONE tool listed in EUR and USD. Two listings, but one metered coordinate — so taking the
    // second re-mints the first. A spend meter is denominated in its own rail and cannot carry across
    // one, which is correct; the question is whether that reset is a way to buy a fresh budget for free.
    const flipper = await setupOwner('flip');
    const cExt = `apptool:${provider.name}/${APP}`;
    const off = await json('/v1/exchange/offerings', { headers: auth(flipper.token) });
    const duals = (off.body.data.offerings as any[]).filter(o => o.providerOwner === provider.name && o.action === 'dual');
    assert(duals.length === 2, `one tool in two currencies is two listings: ${JSON.stringify(duals.map(d => [d.currency, d.basePrice]))}`);
    const eur = duals.find(d => d.currency === 'EUR'), usd = duals.find(d => d.currency === 'USD');
    assert(!!eur && !!usd, 'both currencies are listed');

    // Take the EUR contract with room for exactly two calls, and use them up.
    assert((await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(flipper.token), body: JSON.stringify({ offering_id: eur.offeringId, cap_units: 200000 }) })).status === 201, 'EUR contract taken');
    for (let i = 0; i < 2; i++) {
        const r = await rawInvoke(flipper.token, 'dual');
        assert(r.status === 200, `paid EUR call ${i + 1} settles: ${r.status} ${JSON.stringify(r.body?.error)}`);
    }
    const spent = await contract(flipper.token, cExt, 'dual');
    assert(spent.budget.spent_units === 200000 && spent.state !== 'active',
        `the EUR budget is used up: spent ${spent.budget.spent_units}/${spent.budget.cap_units}, state ${spent.state}`);
    assert((await rawInvoke(flipper.token, 'dual')).status === 402, 'and the next call is refused');

    // Now take the USD listing of the SAME tool. The meter legitimately resets (a EUR figure is not a
    // USD one), so the guard cannot be "spend carries" — it has to be that the provider still gets paid
    // per call on the new rail, and that the caller has not obtained anything they did not buy.
    const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(flipper.token), body: JSON.stringify({ offering_id: usd.offeringId, cap_units: 120000 }) });
    assert(acc.status === 201, `USD contract taken: ${acc.status} ${JSON.stringify(acc.body?.error)}`);
    const fresh = await contract(flipper.token, cExt, 'dual');
    assert(fresh.currency === 'USD' && fresh.price_per_call === 120000,
        `the contract is now the USD one at its own price: ${fresh.currency} ${fresh.price_per_call}`);
    // One call fits the new cap and is CHARGED — a rail switch buys a new budget, it does not grant free calls.
    const r = await rawInvoke(flipper.token, 'dual');
    assert(r.status === 200, `the USD call settles: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const after = await contract(flipper.token, cExt, 'dual');
    assert(after.budget.spent_units === 120000, `charged its full USD price, spent ${after.budget.spent_units}`);
    assert((await rawInvoke(flipper.token, 'dual')).status === 402, 'and the USD cap holds in its turn');
});

await test('CEILING · a contract stops at its spend cap and refuses the call that would exceed it', async () => {
    // A dedicated buyer on a 16-morsel cap: two calls fit, the third must not.
    const capped = await setupOwner('cap');
    const cExt = `apptool:${provider.name}/${APP}`;
    const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(capped.token), body: JSON.stringify({ offering_id: offeringSolo, cap_units: 16 }) });
    assert(acc.status === 201, `accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
    assert((await rawInvoke(capped.token, 'solo')).status === 200, 'first call fits the cap');
    assert((await rawInvoke(capped.token, 'solo')).status === 200, 'second call fits the cap');
    const cb = await balance(capped.token);
    const r = await rawInvoke(capped.token, 'solo');
    assert(r.status === 402, `past the cap the call is refused, got ${r.status}`);
    const e = await contract(capped.token, cExt, 'solo');
    assert(e.budget.spent_units <= e.budget.cap_units, `spend ${e.budget.spent_units} must not exceed cap ${e.budget.cap_units}`);
    assert(await balance(capped.token) === cb, 'a refused call moves no money');
});

await test('REFUND · a script that throws after payment restores both the wallet and the meter', async () => {
    const cExt = `apptool:${provider.name}/${APP}`;
    const off = await json('/v1/exchange/offerings', { headers: auth(consumer.token) });
    const o = (off.body.data.offerings as any[]).find(x => x.providerOwner === provider.name && x.action === 'throws');
    assert(!!o, 'the throwing tool is listed');
    const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ offering_id: o.offeringId, cap_units: 40 }) });
    assert(acc.status === 201, `accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
    const cb = await balance(consumer.token), pb = await balance(provider.token);
    const before = await contract(consumer.token, cExt, 'throws');
    const r = await rawInvoke(consumer.token, 'boom');
    assert(r.status >= 400, `a throwing script must not report success, got ${r.status}`);
    const after = await contract(consumer.token, cExt, 'throws');
    assert(await balance(consumer.token) === cb, `consumer refunded in full (moved ${cb - await balance(consumer.token)})`);
    assert(await balance(provider.token) === pb, 'the provider keeps nothing for undelivered work');
    assert(after.budget.spent_units === before.budget.spent_units, `the meter is rolled back too (moved ${after.budget.spent_units - before.budget.spent_units})`);
});

await test('AMBIGUITY · the buyer of the 3-morsel product is charged 3, and never the 8 next to it', async () => {
    const buyer = await setupOwner('amb');
    const off = await json('/v1/exchange/offerings', { headers: auth(buyer.token) });
    const cheapOff = (off.body.data.offerings as any[]).find(x => x.providerOwner === provider.name && x.action === 'cheap');
    assert(!!cheapOff && cheapOff.basePrice === 3, `the second listing is the source's 3: ${JSON.stringify(cheapOff?.basePrice)}`);
    const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ offering_id: cheapOff.offeringId, cap_units: 30 }) });
    assert(acc.status === 201, `accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
    const bb = await balance(buyer.token);
    const r = await toolInvoke(buyer.token, 'cheap');            // named the product they bought
    assert(r.status === 200, `the contracted app-tool serves them: ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(bb - await balance(buyer.token) === 3, `charged the 3-morsel product they bought, moved ${bb - await balance(buyer.token)}`);
});

await test('AMBIGUITY · and holding one product is never read as consent to be billed for another', async () => {
    const buyer = await setupOwner('amb2');
    const off = await json('/v1/exchange/offerings', { headers: auth(buyer.token) });
    const cheapOff = (off.body.data.offerings as any[]).find(x => x.providerOwner === provider.name && x.action === 'cheap');
    const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ offering_id: cheapOff.offeringId, cap_units: 30 }) });
    assert(acc.status === 201, `accept ${acc.status}`);
    const bb = await balance(buyer.token);
    // `brief` is a DIFFERENT product on the same capability. They never bought it.
    const r = await toolInvoke(buyer.token, 'brief');
    assert(r.status === 402, `an uncontracted product owes them 402, got ${r.status}`);
    assert(await balance(buyer.token) === bb, `and takes nothing — moved ${bb - await balance(buyer.token)}`);
});

await test('PACING · the toll a contract froze at accept is a BURN, never revenue (M1)', async () => {
    const all = await txns(consumer.token);
    const tolls = all.filter(t => t.type === 'extension_toll');
    const provTolls = (await txns(provider.token)).filter(t => t.type === 'extension_toll' && t.amount > 0);
    assert(provTolls.length === 0, `a toll never credits the provider, found ${provTolls.length}`);
    // With AIMEAT_PACING_TOLL_DEFAULT unset (the shipped default of 0) and no declared toll, nothing burns.
    assert(tolls.every(t => t.amount < 0), 'every toll transaction is a debit');
});

await test('PROJECTION · every listing carries the price its source declares, and only that', async () => {
    const r = await json('/v1/exchange/offerings', { headers: auth(consumer.token) });
    const mine = (r.body.data.offerings as any[]).filter(o => o.providerOwner === provider.name);
    const byTool = new Map(mine.map(o => [o.action, o]));
    // Straight from the manifest written in setup — the listing may not invent a figure of its own.
    for (const [tool, unit, price, currency] of [
        ['brief', 'morsels', 8, null], ['cheap', 'morsels', 3, null],
        ['solo', 'morsels', 8, null], ['throws', 'morsels', 8, null],
    ] as const) {
        const o = byTool.get(tool);
        assert(!!o, `${tool} is listed`);
        assert(o.unit === unit && o.basePrice === price && (o.currency ?? null) === currency,
            `${tool}: listing says ${o.basePrice} ${o.currency ?? o.unit}, the manifest says ${price} ${currency ?? unit}`);
    }
    // A tool the manifest never flagged for EXCHANGE has no listing to reprice.
    assert(!byTool.has('open') && !byTool.has('usdonly'), `unflagged tools stay off the market: ${JSON.stringify([...byTool.keys()])}`);
});

await test('PROJECTION · reconciling twice changes nothing — the source is the only writer', async () => {
    const snap = async () => {
        const r = await json('/v1/exchange/offerings', { headers: auth(consumer.token) });
        return (r.body.data.offerings as any[]).filter(o => o.providerOwner === provider.name)
            .map(o => `${o.ext}|${o.action}|${o.unit}|${o.currency ?? ''}|${o.basePrice}|${o.tollMorsels ?? ''}|${o.state}`).sort();
    };
    const first = await snap();
    assert(first.length > 0, 'there is something to reconcile');
    // Re-writing the identical manifest re-runs the projection.
    const rec = await json(`/v1/memory/${encodeURIComponent(`apps.${APP}.tools`)}`, { headers: auth(provider.token) });
    const put = await json('/v1/memory', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ key: `apps.${APP}.tools`, visibility: 'public', value: rec.body.data.value ?? rec.body.data.record?.value }) });
    assert(put.status === 201 || put.status === 200, `re-put ${put.status}`);
    const second = await snap();
    assert(JSON.stringify(first) === JSON.stringify(second), `idempotent:\n  before ${JSON.stringify(first)}\n  after  ${JSON.stringify(second)}`);
});

// ── GRANTS: the provider carries a member instead of billing them ────────────────────────────────
//
// The third class of principal in the product rule, and the one that had no implementation at all:
// the owner, anyone who bought a contract, and "the members I approved". Approving someone and then
// charging them is not an approval, and neither is approving someone whose next call gets a 402.

let member: Awaited<ReturnType<typeof setupOwner>>;
let memberAgent: Awaited<ReturnType<typeof setupAgent>>;

/** The grant the provider is carrying for a consumer, as the provider's own view reports it. */
async function grantRow(consumerGaii: string, action = 'solo') {
    const r = await json('/v1/exchange/grants', { headers: auth(provider.token) });
    return (r.body.data.grants as any[]).find(g => g.consumer_gaii === consumerGaii && g.action === action) ?? null;
}

await test('GRANT · before any approval, an uncontracted member is refused — this is the state being fixed', async () => {
    member = await setupOwner('mem');
    memberAgent = await setupAgent(member, 'mbot');
    const r = await rawInvoke(member.token, 'solo');
    assert(r.status === 402, `an approved-nowhere caller pays or is refused, got ${r.status}`);
});

await test('GRANT · only the provider may issue one, and only over their OWN listing', async () => {
    // Someone else's listing is not theirs to give away — and they are not told it exists.
    const theft = await json('/v1/exchange/grants', {
        method: 'POST', headers: auth(consumer.token),
        body: JSON.stringify({ consumer: member.name, offering_id: offeringSolo }),
    });
    assert(theft.status === 404, `a stranger cannot hand out someone else's capability, got ${theft.status}: ${JSON.stringify(theft.body?.error)}`);
    // And a grant nobody can ever read is a refusal, not a 201: the consumer must be a real shape.
    const nonsense = await json('/v1/exchange/grants', {
        method: 'POST', headers: auth(provider.token),
        body: JSON.stringify({ consumer: 'alice@some-other-node', offering_id: offeringSolo }),
    });
    assert(nonsense.status === 400, `an unreadable grant is refused rather than stored, got ${nonsense.status}`);
});

await test('GRANT · the provider approves the member, and the member is billed NOTHING', async () => {
    const g = await json('/v1/exchange/grants', {
        method: 'POST', headers: auth(provider.token),
        body: JSON.stringify({ consumer: member.name, offering_id: offeringSolo, note: 'approved in the app' }),
    });
    assert(g.status === 201, `grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
    assert(g.body.data.grant.price_per_call === 0, `a grant prices at nothing, got ${g.body.data.grant.price_per_call}`);
    assert(g.body.data.grant.list_price_per_call === 8, `and remembers what it is worth: ${g.body.data.grant.list_price_per_call}`);

    const mb = await balance(member.token), pb = await balance(provider.token);
    const r = await rawInvoke(member.token, 'solo');
    assert(r.status === 200, `the approved member is served: ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(await balance(member.token) === mb, `the member pays nothing — ${mb - await balance(member.token)} morsels moved`);
    assert(await balance(provider.token) === pb, 'and nothing is credited to the provider for their own gift');
});

await test('GRANT · it works through every door a paid contract works through', async () => {
    const mb = await balance(member.token);
    const viaTool = await toolInvoke(member.token, 'solo');
    assert(viaTool.status === 200, `app-tool door: ${viaTool.status} ${JSON.stringify(viaTool.body?.error)}`);

    const viaMcp = parse(await captureTools(member.gaii, member.token)['aimeat_app_tool_invoke']({ owner: provider.name, app: APP, tool: 'solo', input: { q: 'hi' } }));
    assert(!viaMcp.error, `MCP door: ${viaMcp.error}`);

    const viaCap = await json(`/v1/capabilities/${encodeURIComponent(SOLO)}/invoke`, { method: 'POST', headers: auth(member.token), body: JSON.stringify({ input: { q: 'hi' } }) });
    assert(viaCap.status === 200, `capability door: ${viaCap.status} ${JSON.stringify(viaCap.body?.error)}`);

    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(member.token),
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: `${provider.name}/${APP}`, tool: 'solo', input: { q: 'hi' } }] }),
    });
    assert(create.status === 201, `checkout create ${create.status}: ${JSON.stringify(create.body?.error)}`);
    const done = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, { method: 'POST', headers: auth(member.token), body: JSON.stringify({}) });
    assert(done.status === 200, `checkout door: ${done.status} ${JSON.stringify(done.body?.error)}`);

    assert(await balance(member.token) === mb,
        `not one door bills a carried member — ${mb - await balance(member.token)} morsels moved across four of them`);
});

await test('GRANT · the provider can SEE what carrying them costs, in the same place customers appear', async () => {
    const row = await grantRow(member.gaii);
    assert(!!row, 'the grant is listed for the provider who issued it');
    assert(row.carried_units > 0, `carried cost is counted, not lost to a zero meter: ${row.carried_units}`);
    assert(row.carried_units === row.budget.calls * 8, `carried = calls x list price (${row.budget.calls} x 8), got ${row.carried_units}`);

    const cons = await json(`/v1/exchange/offerings/${offeringSolo}/consumers`, { headers: auth(provider.token) });
    const mine = (cons.body.data.consumers as any[]).find(c => c.consumerGaii === member.gaii);
    assert(!!mine, 'a guest appears on the consumer list beside the paying customers');
    assert(mine.granted === true, 'and is marked as carried rather than passed off as revenue');
    assert(mine.settledUnits === 0 && mine.carriedUnits > 0, `settled ${mine.settledUnits} / carried ${mine.carriedUnits}`);
});

await test('GRANT · a ceiling on what the provider will carry actually holds', async () => {
    const capped = await setupOwner('cgr');
    const g = await json('/v1/exchange/grants', {
        method: 'POST', headers: auth(provider.token),
        body: JSON.stringify({ consumer: capped.name, offering_id: offeringSolo, cap_carried_units: 16 }),
    });
    assert(g.status === 201, `grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
    assert((await rawInvoke(capped.token, 'solo')).status === 200, 'first carried call fits');
    assert((await rawInvoke(capped.token, 'solo')).status === 200, 'second carried call fits');
    const third = await rawInvoke(capped.token, 'solo');
    assert(third.status === 402, `past the ceiling the call is refused, got ${third.status}`);
    const row = await grantRow(capped.gaii);
    assert(row.carried_units <= row.cap_carried_units, `carried ${row.carried_units} must not exceed the ${row.cap_carried_units} ceiling`);
});

await test('GRANT · revoking it takes access away immediately', async () => {
    const off = await json('/v1/exchange/grants/revoke', {
        method: 'POST', headers: auth(provider.token),
        body: JSON.stringify({ consumer: member.name, offering_id: offeringSolo }),
    });
    assert(off.status === 200 && off.body.data.revoked === 1, `revoke ${off.status}: ${JSON.stringify(off.body?.data ?? off.body?.error)}`);
    const r = await rawInvoke(member.token, 'solo');
    assert(r.status === 402, `a withdrawn approval is not access, got ${r.status}`);
});

await test('GRANT · a gift never overwrites a purchase, and withdrawing it returns the buyer to what they bought', async () => {
    // The consumer BOUGHT the solo product earlier in this run. Granting over it must not touch that.
    const cExt = `apptool:${provider.name}/${APP}`;
    const bought = await contract(consumer.token, cExt, 'solo');
    assert(bought && bought.price_per_call === 8, `the paid contract is in place first: ${JSON.stringify(bought?.price_per_call)}`);

    const g = await json('/v1/exchange/grants', {
        method: 'POST', headers: auth(provider.token),
        body: JSON.stringify({ consumer: consumer.name, offering_id: offeringSolo }),
    });
    assert(g.status === 201, `grant over a paying customer ${g.status}: ${JSON.stringify(g.body?.error)}`);

    // While it is live the customer stops being billed — an approval outranks their own contract.
    const cb = await balance(consumer.token);
    assert((await rawInvoke(consumer.token, 'solo')).status === 200, 'the carried call is served');
    assert(await balance(consumer.token) === cb, `a carried customer is not billed — ${cb - await balance(consumer.token)} moved`);

    // Withdraw it: they fall back to the contract they paid for, at the price they agreed, not to nothing.
    await json('/v1/exchange/grants/revoke', {
        method: 'POST', headers: auth(provider.token),
        body: JSON.stringify({ consumer: consumer.name, offering_id: offeringSolo }),
    });
    const after = await contract(consumer.token, cExt, 'solo');
    assert(after && after.price_per_call === 8, `the purchase survived the gift: ${JSON.stringify(after?.price_per_call)}`);
    const cb2 = await balance(consumer.token);
    assert((await rawInvoke(consumer.token, 'solo')).status === 200, 'and they are served again, as a customer');
    assert(cb2 - await balance(consumer.token) === 8, `at the price they bought — moved ${cb2 - await balance(consumer.token)}`);
});

await test('GRANT · an approval issued for an app role is withdrawn with that role, in one call', async () => {
    const a = await setupOwner('ra'), b2 = await setupOwner('rb');
    for (const who of [a, b2]) {
        const g = await json('/v1/exchange/grants', {
            method: 'POST', headers: auth(provider.token),
            body: JSON.stringify({ consumer: who.name, offering_id: offeringSolo, reason: { app_id: APP, role: 'analyst' } }),
        });
        assert(g.status === 201, `grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
    }
    assert((await rawInvoke(a.token, 'solo')).status === 200, 'both analysts are served');
    assert((await rawInvoke(b2.token, 'solo')).status === 200, 'both analysts are served');
    const off = await json('/v1/exchange/grants/revoke', {
        method: 'POST', headers: auth(provider.token),
        body: JSON.stringify({ app_id: APP, role: 'analyst' }),
    });
    assert(off.status === 200 && off.body.data.revoked === 2, `demoting the role withdraws both: ${JSON.stringify(off.body?.data)}`);
    assert((await rawInvoke(a.token, 'solo')).status === 402, 'and neither is served after it');
    assert((await rawInvoke(b2.token, 'solo')).status === 402, 'and neither is served after it');
});

await test('PACING · a paying consumer burns the toll themselves, and it credits nobody', async () => {
    const buyer = await setupOwner('pac');
    const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ offering_id: offeringPaced, cap_units: 40 }) });
    assert(acc.status === 201, `accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
    assert(acc.body.data.entitlement.toll_morsels === 2, `the contract froze the declared toll: ${acc.body.data.entitlement.toll_morsels}`);
    const bb = await balance(buyer.token), pb = await balance(provider.token);
    const r = await rawInvoke(buyer.token, 'paced');
    assert(r.status === 200, `paced call ${r.status}: ${JSON.stringify(r.body?.error)}`);
    // 4 morsels of price + 2 of burn: the buyer is out 6, the provider is up by their cut of 4 only.
    assert(bb - await balance(buyer.token) === 6, `price + toll leaves the buyer 6 down, moved ${bb - await balance(buyer.token)}`);
    const gained = await balance(provider.token) - pb;
    assert(gained > 0 && gained <= 4, `the provider is credited the price only, never the burn: +${gained}`);
});

await test('PACING · on a GRANT the burn comes out of the PROVIDER, because they carry the whole price', async () => {
    // The decision this records: a grant covers BOTH halves. The morsel is part of what a call costs
    // the consumer, so a "carried" member paying it would still be paying for approved access — and
    // dropping the burn entirely would hand them the one thing a money budget cannot bound, an
    // unthrottled loop against the provider's upstream. So the brake stays on and the provider feels it.
    const guest = await setupOwner('pgr');
    const g = await json('/v1/exchange/grants', {
        method: 'POST', headers: auth(provider.token),
        body: JSON.stringify({ consumer: guest.name, offering_id: offeringPaced }),
    });
    assert(g.status === 201, `grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
    const gb = await balance(guest.token), pb = await balance(provider.token);
    const r = await rawInvoke(guest.token, 'paced');
    assert(r.status === 200, `the carried call is served: ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(await balance(guest.token) === gb, `the guest pays neither half — ${gb - await balance(guest.token)} morsels moved`);
    assert(pb - await balance(provider.token) === 2, `the provider burns the 2-morsel toll, moved ${pb - await balance(provider.token)}`);
    const burns = (await txns(provider.token)).filter(t => t.type === 'extension_toll'
        && String(t.tracking_code ?? t.trackingCode ?? '').includes('granted'));
    assert(burns.length > 0 && burns.every(t => t.amount < 0), 'and it is recorded as a burn on the provider, not as revenue to anyone');
});

console.log(`\n═══ MONEY AUDIT: ${passed} passed, ${failed} failed (${passed + failed} total) ═══\n`);
server.close();
await storage.disconnect?.();
process.exit(failed > 0 ? 1 : 0);
