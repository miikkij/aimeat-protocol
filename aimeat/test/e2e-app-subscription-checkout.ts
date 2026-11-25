/**
 * @file test/e2e-app-subscription-checkout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app sells its own subscription without the permission to spend
 *   (commerce/app-checkout-reach.ts, routes/commerce.ts checkoutGate).
 *
 *   AIMEAT.commerce.subscribe(ext, plan) opens a checkout with the app's own token and sends the person
 *   to Stripe's card page. An app grant cannot hold commerce:buy, and contract:spend lets an app buy
 *   anything for the person, which is too much to ask of every app that sells a plan. So an app holding
 *   neither opens, reads, pays on the card page and completes a checkout whose lines are plans of the
 *   extension that serves this app (its manifest `config.app`), and cancels their renewal. A plan of
 *   another app's extension answers NOT_THIS_APPS_PRODUCT, a line of another kind SCOPE_DENIED, and
 *   completion takes only the card page handler (CARD_PAGE_ONLY otherwise).
 *
 *   No Stripe account is reachable from a test, so the card page and the completion are proven to the
 *   point where the seller's own Stripe setup answers: PSP_NOT_CONFIGURED at the card page and
 *   PAYMENT_INSTRUMENT_REQUIRED at completion without the Stripe session id. Before this change both
 *   answered SCOPE_DENIED at the scope gate.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-subscription-checkout
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-sovellus-saa-avata-oman-tilauksensa-maksun-commerce-buy-ei-o).
 */
import { createHash, randomBytes } from 'node:crypto';
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';

const TAG = Date.now().toString(36).slice(-6);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
type Owner = { name: string; token: string; ghii: string };

console.log('\nAn app sells its own subscription without the permission to spend');

await registerOwner(BASE, `opr${TAG}`);
const seller = await registerOwner(BASE, `subseller${TAG}`) as Owner;
const rival = await registerOwner(BASE, `subrival${TAG}`) as Owner;
const buyer = await registerOwner(BASE, `subbuyer${TAG}`) as Owner;
const APP = `plans${TAG}.html`;
const RIVAL_APP = `rival${TAG}.html`;
const EXT = `appplans${TAG}`;
const RIVAL_EXT = `rivalplans${TAG}`;
const PLAN = 'monthly';
const PRICE = 6_000_000;

const PLANS_SCRIPT = `export default async function(ctx){
  await ctx.memory.set('subscription.plans', { plans: [{ id: '${PLAN}', title: 'Monthly', amount: ${PRICE}, currency: 'EUR', period_days: 30 }] });
  return { ok: true };
}`;

/** The owner publishes an app and installs an extension that serves it and offers one plan. */
async function sellPlans(owner: Owner, app: string, ext: string): Promise<void> {
  const pub = await json('/v1/apps', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
    filename: app, content: Buffer.from('<html><body>plans</body></html>').toString('base64'), name: `Plans ${app}`, description: 'subscription e2e', category: 'utility' }) });
  assert(pub.status === 201, `publish ${app}: ${pub.status} ${JSON.stringify(pub.body?.error)}`);
  const manifest = {
    metadata: { name: ext, version: '1.0.0', description: 'subscription e2e', author: 'e2e' },
    actions: [{ id: 'plans', method: 'POST', path: '/plans', script: 'plans' }],
    config: { app: { default: `${owner.name}/${app.replace(/\.html$/, '')}` } },
    limits: { timeout_ms: 5000, max_api_calls: 5 },
  };
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest: JSON.stringify(manifest), scripts: { plans: PLANS_SCRIPT } }) });
  assert(inst.status === 201 || inst.status === 200, `install ${ext}: ${inst.status} ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${ext}/activate`, { method: 'POST', headers: auth(owner.token) });
  assert(act.status === 200, `activate ${ext}: ${act.status}`);
  const p = await json(`/v1/ext/${ext}/plans`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(p.status === 200, `plans ${ext}: ${p.status} ${JSON.stringify(p.body?.error)}`);
}

/** The buyer signs in to `appOwner`'s app through the browser's app-grant flow, granting `scope`. */
async function appToken(appOwner: Owner, app: string, scope: string): Promise<string> {
  const redirect = 'http://localhost:9913/subscription-callback';
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ app: `${appOwner.name}/${app}`, response_type: 'code', scope, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' });
  const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
  assert(!!m, `consent redirect expected for ${app}, got ${res.status}`);
  const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ request_id: decodeURIComponent(m![1]) }) });
  assert(con.status === 200, `consent ${app}: ${con.status} ${JSON.stringify(con.body?.error)}`);
  const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }) });
  assert(tok.body?.ok === true, `app token ${app}: ${JSON.stringify(tok.body?.error)}`);
  return tok.body.data.access_token as string;
}

const open = (token: string, items: unknown[]) => json('/v1/commerce/checkout-sessions', {
  method: 'POST', headers: auth(token), body: JSON.stringify({ currency: 'EUR', items }) });
const planLine = (ext: string) => ({ kind: 'subscription', app: ext, tool: PLAN, input: { auto_renew: true } });

let mine = '';
let rivals = '';
await test('setup: two sellers each sell a plan through the extension that serves their app; the buyer signs in to both apps without the spend permission', async () => {
  await sellPlans(seller, APP, EXT);
  await sellPlans(rival, RIVAL_APP, RIVAL_EXT);
  mine = await appToken(seller, APP, 'memory:read');
  rivals = await appToken(rival, RIVAL_APP, 'memory:read');
});

let sid = '';
await test('POSITIVE: the app opens a checkout for its own plan and reads it back (subscribe(): open)', async () => {
  const r = await open(mine, [planLine(EXT)]);
  assert(r.status === 201, `open ${r.status}: ${JSON.stringify(r.body.error)}`);
  sid = r.body.data.session.id as string;
  assert(r.body.data.session.total === PRICE && r.body.data.session.currency === 'EUR', `the plan's price: ${JSON.stringify(r.body.data.session)}`);
  const read = await json(`/v1/commerce/checkout-sessions/${sid}`, { headers: auth(mine) });
  assert(read.status === 200 && read.body.data.session.id === sid, `read ${read.status}: ${JSON.stringify(read.body.error)}`);
});

await test('POSITIVE: the card page passes the app and reaches the seller\'s own Stripe setup (subscribe(): payByCard)', async () => {
  const r = await json(`/v1/commerce/checkout-sessions/${sid}/card`, { method: 'POST', headers: auth(mine), body: JSON.stringify({ return_url: 'https://plans.test/back' }) });
  assert(r.status === 403 && r.body.error?.code === 'PSP_NOT_CONFIGURED', `expected the seller's PSP_NOT_CONFIGURED past the app gate, got ${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('POSITIVE: completion with the card page handler passes the app and asks for the Stripe session (finishCardPayment())', async () => {
  const r = await json(`/v1/commerce/checkout-sessions/${sid}/complete`, { method: 'POST', headers: auth(mine), body: JSON.stringify({ payment: { handler: 'com.stripe.checkout' } }) });
  assert(r.status === 402 && r.body.error?.code === 'PAYMENT_INSTRUMENT_REQUIRED', `expected PAYMENT_INSTRUMENT_REQUIRED past the spend gate, got ${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('REFUSAL: completion with any other handler is CARD_PAGE_ONLY, and the session stays open', async () => {
  const r = await json(`/v1/commerce/checkout-sessions/${sid}/complete`, { method: 'POST', headers: auth(mine), body: JSON.stringify({ payment: { handler: 'test.money', instrument: 'testpm' } }) });
  expectRefusal(r, 403, 'CARD_PAGE_ONLY');
  const read = await json(`/v1/commerce/checkout-sessions/${sid}`, { headers: auth(mine) });
  assert(read.body.data?.session?.status === 'open', `still open: ${JSON.stringify(read.body.data?.session?.status)}`);
  const subs = await json('/v1/commerce/subscriptions', { headers: auth(buyer.token) });
  assert(!subs.body.data.subscriptions.some((s: any) => s.ext === EXT), 'nothing was bought');
});

await test('REFUSAL: the same app opening a checkout for another app\'s plan is NOT_THIS_APPS_PRODUCT', async () => {
  const r = await open(mine, [planLine(RIVAL_EXT)]);
  expectRefusal(r, 403, 'NOT_THIS_APPS_PRODUCT');
  assert(JSON.stringify(r.body.error).includes(RIVAL_EXT), `the refusal names the plan's extension: ${JSON.stringify(r.body.error)}`);
  const both = await open(mine, [planLine(EXT), planLine(RIVAL_EXT)]);
  expectRefusal(both, 403, 'NOT_THIS_APPS_PRODUCT');
});

await test('REFUSAL: a line that is not a subscription, alone or beside its own plan, is SCOPE_DENIED', async () => {
  expectRefusal(await open(mine, [{ kind: 'pacing-pack', quantity: 1 }]), 403, 'SCOPE_DENIED');
  expectRefusal(await open(mine, [planLine(EXT), { kind: 'pacing-pack', quantity: 1 }]), 403, 'SCOPE_DENIED');
});

await test('REFUSAL: another app cannot read, pay or complete the checkout this app opened', async () => {
  expectRefusal(await json(`/v1/commerce/checkout-sessions/${sid}`, { headers: auth(rivals) }), 403, 'NOT_THIS_APPS_PRODUCT');
  expectRefusal(await json(`/v1/commerce/checkout-sessions/${sid}/card`, { method: 'POST', headers: auth(rivals), body: JSON.stringify({ return_url: 'https://rival.test/back' }) }), 403, 'NOT_THIS_APPS_PRODUCT');
  expectRefusal(await json(`/v1/commerce/checkout-sessions/${sid}/complete`, { method: 'POST', headers: auth(rivals), body: JSON.stringify({ payment: { handler: 'com.stripe.checkout' } }) }), 403, 'NOT_THIS_APPS_PRODUCT');
});

await test('REFUSAL: the buyer\'s agent without commerce:buy still cannot open the plan: the allowance is an app\'s, for its own product', async () => {
  const agent = await makeAgent(BASE, buyer, ['memory:read']);
  expectRefusal(await open(agent.token, [planLine(EXT)]), 403, 'SCOPE_DENIED');
});

await test('EDGE: the app cancels its open checkout and the renewal of its own plan; another app\'s renewal is NOT_THIS_APPS_PRODUCT', async () => {
  const cancel = await json(`/v1/commerce/checkout-sessions/${sid}`, { method: 'PATCH', headers: auth(mine), body: JSON.stringify({ cancel: true }) });
  assert(cancel.status === 200 && cancel.body.data.session.status !== 'open', `cancel ${cancel.status}: ${JSON.stringify(cancel.body.error ?? cancel.body.data?.session?.status)}`);
  const renewal = await json(`/v1/commerce/subscriptions/${EXT}/${PLAN}/cancel`, { method: 'POST', headers: auth(mine), body: '{}' });
  assert(renewal.status === 404 && renewal.body.error?.code === 'NOT_FOUND', `past the gate to "no such subscription": ${renewal.status} ${JSON.stringify(renewal.body.error)}`);
  expectRefusal(await json(`/v1/commerce/subscriptions/${RIVAL_EXT}/${PLAN}/cancel`, { method: 'POST', headers: auth(mine), body: '{}' }), 403, 'NOT_THIS_APPS_PRODUCT');
});

finish();
