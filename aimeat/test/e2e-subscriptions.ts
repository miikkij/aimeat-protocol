/**
 * @file test/e2e-subscriptions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A reader subscribes to a studio's plan, which an extension offers, and the extension
 *   sees the running subscription; the plan's payees are paid out of the seller's net; the reader
 *   lists and cancels it; nobody can write a subscription record through the memory routes. Also the
 *   refusals of the card page route (POST /v1/commerce/checkout-sessions/:id/card).
 *
 *   The money moves on the test money handler (AIMEAT_TEST_MONEY_HANDLER), which keeps a card the way
 *   the Stripe handlers do; without it the suite says it skipped.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=subscriptions
 * @version-history
 *   v1.1.0 — 2026-10-27 — A plan period shortened after the quote is refused PRICE_CHANGED at completion
 *     (secaudit2026oct26).
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-5, A-4).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0, skipped = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== Subscriptions to an extension\'s plans (Comicland v3 A-5) ===\n');

let moneyRail = false;
try {
  const ucp = await fetch(`${BASE}/.well-known/ucp/2026-04-08`).then((r) => r.json()) as any;
  moneyRail = (ucp.ucp?.payment_handlers || []).some((h: any) => String(h.id) === 'test.money');
} catch { /* leave false */ }

const stamp = Date.now().toString(36);
const EXT = `studiosubs${stamp}`;
const studio = await registerOwner(BASE, `substudio${stamp}`);
const reader = await registerOwner(BASE, `subreader${stamp}`);
const artist = await registerOwner(BASE, `subartist${stamp}`);

const SCRIPTS = {
  plans: `export default async function(ctx, input){
    await ctx.memory.set('subscription.plans', { plans: [
      { id: 'studio-harbour', title: 'Harbour Studio, monthly', amount: 3990000, currency: 'EUR', period_days: input.period_days || 30,
        beneficiaries: [{ ghii: input.artist, weight: 1, note: 'the studio artist' }] },
    ] });
    return { ok: true };
  }`,
  read: `export default async function(ctx, input){
    const subscribed = (ctx.caller.subscriptions || []).some(function(s){ return s.plan === 'studio-harbour'; });
    return { subscribed: subscribed, subscriptions: ctx.caller.subscriptions || [] };
  }`,
};
const manifest = JSON.stringify({
  metadata: { name: EXT, version: '1.0.0', description: 'subscriptions e2e', author: 'e2e' },
  actions: [
    { id: 'plans', method: 'POST', path: '/plans', script: 'plans' },
    { id: 'read', method: 'POST', path: '/read', script: 'read' },
  ],
  limits: { timeout_ms: 5000, max_api_calls: 5 },
}, null, 2);

const accrued = async (token: string): Promise<number> => {
  const r = await json('/v1/commerce/beneficiary/earnings', { headers: auth(token) });
  return Number(r.body?.data?.totals?.EUR?.accrued ?? 0);
};
const read = (token: string) => json(`/v1/ext/${EXT}/read`, { method: 'POST', headers: auth(token), body: '{}' });

await test('Setup: the studio installs the extension, publishes its plan and declares the split for its subscriptions', async () => {
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(studio.token), body: JSON.stringify({ manifest, scripts: SCRIPTS }) });
  assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(studio.token) });
  assert(act.status === 200, `activate ${act.status}`);
  const p = await json(`/v1/ext/${EXT}/plans`, { method: 'POST', headers: auth(studio.token), body: JSON.stringify({ artist: artist.ghii }) });
  assert(p.status === 200, `plans ${p.status}: ${JSON.stringify(p.body?.error)}`);
  const d = await json('/v1/commerce/beneficiary-splits', { method: 'POST', headers: auth(studio.token), body: JSON.stringify({ ext: EXT, action: 'subscription', pool_percent: 100, dynamic: true }) });
  assert(d.status === 200, `split ${d.status}: ${JSON.stringify(d.body?.error)}`);
});

await test('Before subscribing, the extension sees no subscription for the reader', async () => {
  const r = await read(reader.token);
  assert(r.status === 200 && r.body.data.subscribed === false, `${r.status}: ${JSON.stringify(r.body)}`);
});

await test('A plan the extension does not offer is refused at checkout', async () => {
  const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(reader.token),
    body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'subscription', app: EXT, tool: 'no-such-plan' }] }) });
  assert(open.status === 404 && open.body.error?.code === 'PLAN_NOT_FOUND', `${open.status}: ${JSON.stringify(open.body?.error)}`);
});

if (!moneyRail) {
  skipped++;
  console.log('  ⏭  the paid half skipped — no test.money handler (AIMEAT_TEST_MONEY_HANDLER=true)');
} else {
  let net = 0;
  await test('The reader subscribes: one period, the card kept for renewals, and the artist is paid out of the studio\'s net', async () => {
    const before = await accrued(artist.token);
    const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(reader.token),
      body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'subscription', app: EXT, tool: 'studio-harbour', input: { auto_renew: true } }] }) });
    assert(open.status === 201, `open ${open.status}: ${JSON.stringify(open.body?.error)}`);
    assert(open.body.data.session.total === 3_990_000, `the plan's price: ${open.body.data.session.total}`);
    const done = await json(`/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, {
      method: 'POST', headers: auth(reader.token), body: JSON.stringify({ payment: { handler: 'test.money', instrument: 'testpm' } }) });
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body?.error)}`);
    const sub = done.body.data.session.fulfillment?.results?.[0]?.result?.subscription;
    assert(sub?.plan === 'studio-harbour' && sub.auto_renew === true, `result ${JSON.stringify(done.body.data.session.fulfillment)}`);
    const days = (Date.parse(sub.active_until) - Date.now()) / 86_400_000;
    assert(days > 29.9 && days <= 30, `one period of 30 days, got ${days}`);
    assert(!JSON.stringify(done.body.data.session.fulfillment).includes('_revenue'), 'the payees never reach the buyer');
    net = Number(done.body.data.session.receipt.earned);
    assert(await accrued(artist.token) === before + net, `the artist is owed the studio's whole net (${net}), got ${await accrued(artist.token) - before}`);
  });

  await test('The extension sees the reader\'s running subscription on ctx.caller.subscriptions', async () => {
    const r = await read(reader.token);
    assert(r.body.data.subscribed === true, `subscriptions ${JSON.stringify(r.body.data)}`);
    const other = await read(artist.token);
    assert(other.body.data.subscribed === false, 'another account is not subscribed');
  });

  await test('The reader lists it, and a second period extends from the current end, not from today', async () => {
    const list = await json('/v1/commerce/subscriptions', { headers: auth(reader.token) });
    assert(list.status === 200, `${list.status}`);
    const first = list.body.data.subscriptions.find((s: any) => s.ext === EXT);
    assert(first?.active === true && first.auto_renew === true && !('kept_payment' in first) && !JSON.stringify(first).includes('testcus_'), `the listing carries no card ids: ${JSON.stringify(first)}`);
    const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(reader.token),
      body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'subscription', app: EXT, tool: 'studio-harbour', input: { auto_renew: true } }] }) });
    const done = await json(`/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, {
      method: 'POST', headers: auth(reader.token), body: JSON.stringify({ payment: { handler: 'test.money', instrument: 'testpm' } }) });
    assert(done.status === 200, `second period ${done.status}: ${JSON.stringify(done.body?.error)}`);
    const until = Date.parse(done.body.data.session.fulfillment.results[0].result.subscription.active_until);
    const gained = (until - Date.parse(first.active_until)) / 86_400_000;
    assert(Math.abs(gained - 30) < 0.01, `extended by 30 days from the old end, got ${gained}`);
  });

  await test('Over MCP: the reader\'s agent lists the subscription, and is refused cancelling one that does not exist', async () => {
    const agent = await makeAgent(BASE, reader, ['wallet:read', 'commerce:buy']);
    const s = await openSession(BASE, agent.token, 'subs-agent');
    const list = await callTool(s, 'aimeat_subscription_list', {});
    assert(!list.isError && list.data.subscriptions.some((x: any) => x.ext === EXT && x.active), `list: ${list.text.slice(0, 300)}`);
    const none = await callTool(s, 'aimeat_subscription_cancel', { ext: EXT, plan: 'nothing' });
    assert(none.isError && /NOT_FOUND/.test(none.text), `cancel nothing: ${none.text.slice(0, 200)}`);
  });

  // secaudit2026oct26: the period is part of the price, so a period shortened after the quote is a
  // changed price and the checkout stays open for a new quote.
  await test('FAILURE: a plan period shortened after the quote is refused PRICE_CHANGED at completion, and nothing is charged', async () => {
    const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(reader.token),
      body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'subscription', app: EXT, tool: 'studio-harbour', input: { auto_renew: true } }] }) });
    assert(open.status === 201, `open ${open.status}: ${JSON.stringify(open.body?.error)}`);
    const before = (await json('/v1/commerce/subscriptions', { headers: auth(reader.token) })).body.data.subscriptions.find((s: any) => s.ext === EXT);
    const shorten = await json(`/v1/ext/${EXT}/plans`, { method: 'POST', headers: auth(studio.token), body: JSON.stringify({ artist: artist.ghii, period_days: 1 }) });
    assert(shorten.status === 200, `plans ${shorten.status}`);
    try {
      const done = await json(`/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, {
        method: 'POST', headers: auth(reader.token), body: JSON.stringify({ payment: { handler: 'test.money', instrument: 'testpm' } }) });
      assert(done.status === 409 && done.body.error?.code === 'PRICE_CHANGED', `expected 409 PRICE_CHANGED, got ${done.status}: ${JSON.stringify(done.body?.error)}`);
      const after = (await json('/v1/commerce/subscriptions', { headers: auth(reader.token) })).body.data.subscriptions.find((s: any) => s.ext === EXT);
      assert(after?.active_until === before?.active_until, `the subscription is unchanged: ${before?.active_until} -> ${after?.active_until}`);
    } finally {
      await json(`/v1/ext/${EXT}/plans`, { method: 'POST', headers: auth(studio.token), body: JSON.stringify({ artist: artist.ghii }) });
    }
  });

  await test('Cancelling stops the renewal and keeps the paid period', async () => {
    const agent = await makeAgent(BASE, reader, ['commerce:buy']);
    const s = await openSession(BASE, agent.token, 'subs-cancel-agent');
    const c = await callTool(s, 'aimeat_subscription_cancel', { ext: EXT, plan: 'studio-harbour' });
    assert(!c.isError && c.data.subscription.auto_renew === false, `cancel: ${c.text.slice(0, 300)}`);
    const r = await read(reader.token);
    assert(r.body.data.subscribed === true, 'still subscribed until the end of the paid period');
    const none = await json(`/v1/commerce/subscriptions/${EXT}/nothing/cancel`, { method: 'POST', headers: auth(reader.token), body: '{}' });
    assert(none.status === 404, `no such subscription: ${none.status}`);
  });
}

await test('An agent without wallet:read cannot list, and one without commerce:buy cannot cancel', async () => {
  const narrow = await makeAgent(BASE, reader, ['memory:read']);
  const list = await json('/v1/commerce/subscriptions', { headers: auth(narrow.token) });
  assert(list.status === 403, `list without wallet:read: ${list.status}`);
  const cancel = await json(`/v1/commerce/subscriptions/${EXT}/studio-harbour/cancel`, { method: 'POST', headers: auth(narrow.token), body: '{}' });
  assert(cancel.status === 403, `cancel without commerce:buy: ${cancel.status}`);
});

await test('Nobody writes a subscription record through the memory routes, the account holder included', async () => {
  const w = await json('/v1/memory', { method: 'POST', headers: auth(artist.token), body: JSON.stringify({
    key: `commerce.subscription.${EXT}.studio-harbour`, visibility: 'private',
    value: { ext: EXT, plan: 'studio-harbour', active_until: '2099-01-01T00:00:00Z' },
  }) });
  assert(w.status === 403 || w.status === 400, `expected a refusal, got ${w.status}: ${JSON.stringify(w.body)}`);
  const r = await read(artist.token);
  assert(r.body.data.subscribed === false, 'the forged record gives no subscription');
});

// ── The card page route (Comicland v3 A-4) ──
await test('The card page refuses an agent, a return address that is not http(s), and a seller with no Stripe key', async () => {
  const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(reader.token),
    body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'subscription', app: EXT, tool: 'studio-harbour' }] }) });
  assert(open.status === 201, `open ${open.status}: ${JSON.stringify(open.body?.error)}`);
  const id = open.body.data.session.id;
  const bad = await json(`/v1/commerce/checkout-sessions/${id}/card`, { method: 'POST', headers: auth(reader.token), body: JSON.stringify({ return_url: 'javascript:alert(1)' }) });
  assert(bad.status === 400, `bad return_url: ${bad.status}`);
  const noKey = await json(`/v1/commerce/checkout-sessions/${id}/card`, { method: 'POST', headers: auth(reader.token), body: JSON.stringify({ return_url: 'https://comicland.test/read' }) });
  assert(noKey.status === 403 && noKey.body.error?.code === 'PSP_NOT_CONFIGURED', `no Stripe key: ${noKey.status} ${JSON.stringify(noKey.body?.error)}`);
  const agent = await makeAgent(BASE, reader, ['commerce:buy']);
  const byAgent = await json(`/v1/commerce/checkout-sessions/${id}/card`, { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ return_url: 'https://comicland.test/read' }) });
  assert(byAgent.status === 403, `an agent: ${byAgent.status} ${JSON.stringify(byAgent.body?.error)}`);
  const other = await json(`/v1/commerce/checkout-sessions/${id}/card`, { method: 'POST', headers: auth(artist.token), body: JSON.stringify({ return_url: 'https://comicland.test/read' }) });
  assert(other.status === 404, `another person's checkout: ${other.status}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped\n`);
process.exit(failed > 0 ? 1 : 0);
