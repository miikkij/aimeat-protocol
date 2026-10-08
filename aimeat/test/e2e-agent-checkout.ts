/**
 * @file test/e2e-agent-checkout.ts
 * @description E2E for layer E of AI visibility: the owner's products as feeds for AI shopping
 *   agents (a Microsoft Merchant Center feed for Copilot Checkout and a Stripe Agentic Commerce
 *   catalog). What is listed and what is left out with its reason, the public files and their
 *   uniform 404, a price change reaching the next fetch, the owner's choices, the push to the
 *   owner's own Stripe refused without a selling key, the same answer over MCP, and the refusals:
 *   a second owner, a wrong scope, no token.
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial: the feeds.
 */

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-checkout

import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`✅ ${name}`); } catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any; text: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
    if (res.status === 429 && attempt < 6) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body, text };
  }
}

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => { const h = createHash('sha512'); for (const m of msgs) h.update(m); return new Uint8Array(h.digest()); };
const signMsg = async (privB64: string, msg: string): Promise<string> =>
  Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
  const owner = `${name}${Date.now().toString(36).slice(-6)}`;
  for (let attempt = 0; ; attempt++) {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: `Shop ${owner}`, password: 'CheckoutTest1234' }) });
    if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, owner + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
    assert(tok.status === 200, `token failed: ${tok.status}`);
    return { token: tok.body.data.token as string, owner };
  }
}

async function makeAgent(ctx: { token: string; owner: string }, name: string, scopes: string[]): Promise<{ token: string; gaii: string }> {
  const reg = await json('/v1/agents', { method: 'POST', headers: authed(ctx.token), body: JSON.stringify({ name, owner: ctx.owner, scopes }) });
  assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  const gaii = reg.body.data.agent.gaii as string;
  const timestamp = new Date().toISOString();
  const signature = await signMsg(reg.body.data.private_key, gaii + timestamp);
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
  assert(tok.status === 200, 'agent token failed');
  return { token: tok.body.data.token as string, gaii };
}

// ── MCP ───────────────────────────────────────────────────────────────────────────────────────
interface McpSession { token: string; sessionId?: string }
let rpcId = 0;
async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}): Promise<any> {
  const id = ++rpcId;
  const res = await fetch(`${BASE}/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${session.token}`,
      ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) session.sessionId = sid;
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const msgs = (await res.text()).split('\n').filter((l) => l.startsWith('data: '))
      .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
    return msgs.find((m: any) => m.id === id) ?? msgs[0] ?? {};
  }
  return await res.json();
}
async function callTool(token: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
  const session: McpSession = { token };
  await mcpRpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-agent-checkout', version: '1.0.0' } });
  const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
  const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
  let data: any;
  try { data = JSON.parse(text); } catch { data = { _text: text }; }
  return { isError: body?.result?.isError === true || body?.error !== undefined, data, text };
}

console.log('═══ E2E: agent checkout, layer E — product feeds for AI shopping agents ═══');
console.log(`Base: ${BASE}`);

// A neutral first owner: on a fresh database the first one becomes the operator.
await makeOwner('ckop');
const S = await makeOwner('ckseller');
const B = await makeOwner('ckother');
const vendorName = `vendor${Date.now().toString(36).slice(-4)}`;
const vendor = await makeAgent(S, vendorName, ['task:read', 'task:write']);
const feedAgent = await makeAgent(S, `feeder${Date.now().toString(36).slice(-4)}`, ['signals:read', 'signals:write']);
const readOnlyAgent = await makeAgent(S, `reader${Date.now().toString(36).slice(-4)}`, ['signals:read']);
const usdSku = `offer:${vendor.gaii}:audit`;

const offers = (usdAmount: number) => ({ offers: [
  { id: 'audit', title: 'Website accessibility audit', ask: 'Send a URL;\tI return a report.\nPlain text.', deliverable: { format: 'document', sample: 'untested' }, priceMoney: { amount: usdAmount, currency: 'USD' }, visibility: 'public' },
  { id: 'eur-only', title: 'Euro service', ask: 'EUR only.', deliverable: { format: 'document', sample: 'untested' }, priceMoney: { amount: 5_000_000, currency: 'EUR' }, visibility: 'public' },
  { id: 'morsels', title: 'Morsel service', ask: 'Morsels only.', deliverable: { format: 'document', sample: 'untested' }, price: { morsels: 10, unit: 'per-call' }, visibility: 'public' },
  { id: 'tiny', title: 'Sub-cent service', ask: 'Fractions of a cent.', deliverable: { format: 'document', sample: 'untested' }, priceMoney: { amount: 1_500, currency: 'USD' }, visibility: 'public' },
  { id: 'secret', title: 'Private service', ask: 'Not public.', deliverable: { format: 'document', sample: 'untested' }, priceMoney: { amount: 9_000_000, currency: 'USD' }, visibility: 'private' },
] });
const feedUrl = `/v1/visibility/feeds/${S.owner}/merchant-center.txt`;
const stripeUrl = `/v1/visibility/feeds/${S.owner}/stripe-catalog.csv`;
const feed = async (token = S.token): Promise<any> => {
  const r = await json('/v1/visibility/feed', { headers: authed(token) });
  assert(r.status === 200, `feed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};

console.log('\nPhase 1 — the feeds');

await test('0. the seller offers five services: one in USD, the rest not listable', async () => {
  const pub = await json(`/v1/agents/${vendorName}/offers`, { method: 'PUT', headers: authed(S.token), body: JSON.stringify(offers(19_990_000)) });
  assert(pub.status === 200, `offers ${pub.status} ${JSON.stringify(pub.body)}`);
});

await test('1. the feed starts off: the public files answer 404, and the owner sees what would be listed', async () => {
  const f = await feed();
  assert(f.enabled === false && f.node_enabled === true, `off by default: ${JSON.stringify({ e: f.enabled, n: f.node_enabled })}`);
  assert(f.products.length === 1 && f.products[0].sku === usdSku && f.products[0].price === '19.99 USD', `one USD product: ${JSON.stringify(f.products)}`);
  const reasons = Object.fromEntries(f.skipped.map((s: any) => [s.sku.split(':').pop(), s.reason]));
  assert(reasons['eur-only'] === 'no USD price' && reasons.morsels === 'no USD price' && reasons.tiny === 'the USD price is not whole cents', `left out with reasons: ${JSON.stringify(f.skipped)}`);
  assert(!JSON.stringify(f).includes('Private service'), 'a private offer is neither listed nor named');
  assert(f.todo.some((t: string) => t.includes('Switch the feed on')), 'the todo says to switch it on');
  const pub = await json(feedUrl);
  assert(pub.status === 404, `off answers 404, got ${pub.status}`);
});

await test('2. switched on, the Merchant Center feed is tab-separated with the documented columns', async () => {
  const on = await json('/v1/visibility/feed', { method: 'PUT', headers: authed(S.token), body: JSON.stringify({ enabled: true, return_policy_label: 'Digital, no returns' }) });
  assert(on.status === 200 && on.body.data.enabled === true, `on: ${on.status} ${JSON.stringify(on.body)}`);
  const res = await fetch(`${BASE}${feedUrl}`);
  assert(res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('text/plain'), `feed ${res.status} ${res.headers.get('content-type')}`);
  const lines = (await res.text()).trimEnd().split('\n');
  const head = lines[0]!.split('\t');
  assert(JSON.stringify(head) === JSON.stringify(['id', 'title', 'description', 'link', 'image_link', 'price', 'availability', 'condition', 'brand', 'identifier_exists', 'product_type', 'seller_name', 'return_policy_labels']), `header: ${lines[0]}`);
  assert(lines.length === 2, `one product row, got ${lines.length - 1}`);
  const row = Object.fromEntries(lines[1]!.split('\t').map((v, i) => [head[i], v]));
  assert(/^aim[0-9a-f]{20}$/.test(row.id!) && row.id!.length <= 50, `an id Merchant Center takes: ${row.id}`);
  assert(row.price === '19.99 USD' && row.availability === 'in stock' && row.condition === 'new' && row.identifier_exists === 'no', `price and state: ${lines[1]}`);
  assert(row.description === 'Send a URL; I return a report. Plain text.', `a description with no tab or line break: ${row.description}`);
  assert(row.brand === `Shop ${S.owner}` && row.return_policy_labels === 'Digital, no returns', `brand and return policy: ${row.brand} / ${row.return_policy_labels}`);
  assert(row.link!.startsWith('http') && row.image_link!.endsWith('/og-image.png'), `link and image: ${row.link} ${row.image_link}`);
});

await test('3. the Stripe catalog is a CSV for digital goods with the same product', async () => {
  const res = await fetch(`${BASE}${stripeUrl}`);
  assert(res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('text/csv'), `catalog ${res.status}`);
  const text = await res.text();
  const [head, row] = text.trimEnd().split('\n');
  assert(head === 'id,title,description,link,image_link,availability,price,brand,mpn,google_product_category,inventory_not_tracked', `header: ${head}`);
  assert(row!.includes(',in_stock,19.99 USD,') && row!.endsWith(',Software,true'), `row: ${row}`);
});

await test('4. a price change reaches the next fetch, with nothing re-exported', async () => {
  const pub = await json(`/v1/agents/${vendorName}/offers`, { method: 'PUT', headers: authed(S.token), body: JSON.stringify(offers(24_500_000)) });
  assert(pub.status === 200, 'price changed');
  const text = await (await fetch(`${BASE}${feedUrl}`)).text();
  assert(text.includes('\t24.50 USD\t') && !text.includes('19.99 USD'), `the new price only: ${text.split('\n')[1]}`);
});

await test('5. a product page per sku replaces the store front, and a bad address is refused', async () => {
  const before = await feed();
  assert(before.products[0].link_is_store_front === true && before.todo.some((t: string) => t.includes('link to the store')), 'the todo names the store-front links');
  const bad = await json('/v1/visibility/feed', { method: 'PUT', headers: authed(S.token), body: JSON.stringify({ product_links: { [usdSku]: 'javascript:alert(1)' } }) });
  assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `a javascript: link is refused: ${bad.status}`);
  const good = await json('/v1/visibility/feed', { method: 'PUT', headers: authed(S.token), body: JSON.stringify({ product_links: { [usdSku]: 'https://shop.example/audit' } }) });
  assert(good.status === 200 && good.body.data.products[0].link === 'https://shop.example/audit', `the link is used: ${JSON.stringify(good.body.data.products)}`);
  const text = await (await fetch(`${BASE}${feedUrl}`)).text();
  assert(text.includes('\thttps://shop.example/audit\t'), 'and the feed carries it');
});

await test('6. the push to Stripe is refused without a selling key, naming where to set it', async () => {
  const r = await json('/v1/visibility/feed/stripe-sync', { method: 'POST', headers: authed(S.token), body: JSON.stringify({}) });
  assert(r.status === 409 && r.body.error?.code === 'PSP_NOT_CONFIGURED' && /Wallet/.test(r.body.error.message), `${r.status} ${JSON.stringify(r.body)}`);
});

await test('7. an agent with signals:write reads and changes the feed over MCP; one with only signals:read has no such tool', async () => {
  const out = await callTool(feedAgent.token, 'aimeat_visibility_feed', { brand: 'Accessible Web Co' });
  assert(!out.isError && out.data.brand === 'Accessible Web Co' && out.data.products.length === 1, `MCP: ${out.text.slice(0, 300)}`);
  const text = await (await fetch(`${BASE}${feedUrl}`)).text();
  assert(text.includes('\tAccessible Web Co\t'), 'the brand reaches the feed');
  const refused = await callTool(readOnlyAgent.token, 'aimeat_visibility_feed', {});
  assert(refused.isError, 'a reader has no such tool');
  const sync = await callTool(feedAgent.token, 'aimeat_visibility_feed', { stripe_sync: 'send' });
  assert(sync.isError && sync.text.startsWith('PSP_NOT_CONFIGURED'), `the MCP push names the same refusal: ${sync.text.slice(0, 120)}`);
});

await test('8. a second owner sees only their own empty feed, a stranger\'s address answers like a feed that is off, and no token is 401', async () => {
  const other = await feed(B.token);
  assert(other.products.length === 0 && other.enabled === false, `the second owner's own feed: ${JSON.stringify(other.products)}`);
  const unknown = await json(`/v1/visibility/feeds/nobody${Date.now()}/merchant-center.txt`);
  const off = await json(`/v1/visibility/feeds/${B.owner}/merchant-center.txt`);
  assert(unknown.status === 404 && off.status === 404, `both 404: ${unknown.status} ${off.status}`);
  assert(unknown.body.error?.code === off.body.error?.code && unknown.body.error?.message === off.body.error?.message,
    `the same answer for both: ${JSON.stringify(unknown.body.error)} vs ${JSON.stringify(off.body.error)}`);
  const anon = await json('/v1/visibility/feed');
  assert(anon.status === 401, `no token: ${anon.status}`);
  const anonPut = await json('/v1/visibility/feed', { method: 'PUT', headers: authed(readOnlyAgent.token), body: JSON.stringify({ enabled: false }) });
  assert(anonPut.status === 403, `signals:read cannot change the feed: ${anonPut.status}`);
});

await test('9. switched off, both public files answer 404 again', async () => {
  const off = await json('/v1/visibility/feed', { method: 'PUT', headers: authed(S.token), body: JSON.stringify({ enabled: false }) });
  assert(off.status === 200 && off.body.data.enabled === false, 'off');
  assert((await json(feedUrl)).status === 404 && (await json(stripeUrl)).status === 404, 'both 404');
});

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
