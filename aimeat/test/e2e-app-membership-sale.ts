/**
 * @file test/e2e-app-membership-sale.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's owner sells a role of the app's member plan (commerce/membership-sale.ts and
 *   the files beside it). The suite runs a node in this process on the run's backend, so it can drive
 *   the daily renewal with a clock and read the platform fee records; money moves on the test money
 *   rail, and the outside Stripe sale arrives as webhook deliveries signed with the seller's own secret.
 *
 *     1. The owner prices a role; the price is public; a priced role needs a period; the app's AI
 *        (a members-only tool) refuses a non-member.
 *     2. A buyer with an account buys: they are a member to the end of the paid period, the member row
 *        and the subscription hold one date, the app's AI serves them, no platform fee is recorded.
 *     3. The renewal extends both from the end of the period; the owner's roster shows paid until and
 *        renewal on; a cancel keeps the period and stops the renewal; the clock then ends the
 *        membership and the app refuses the lapsed member.
 *     4. A refund (charge.refunded on the seller's webhook) removes the membership.
 *     5. A buyer without an account pays with an email address; the address's new account is a
 *        member at once, and its renewal is kept; a closed node refuses such a purchase.
 *     6. The outside Stripe sale: invoice.paid makes the payer a member to the period's end, a
 *        redelivery does nothing, cancel_at_period_end stops the renewal, a refund removes it; seller
 *        B's webhook cannot make a member of seller A's app.
 *     7. Fixes of the same change: an invitation carries its term, and a re-approval continues from
 *        the end of the running term.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-membership-sale
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-).
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from '../src/server.js';
import { loadConfig, type AimeatConfig } from '../src/config.js';
import type { Storage } from '../src/storage/interface.js';
import { runSubscriptionRenewals } from '../src/commerce/subscriptions.js';
import { membershipExt } from '../src/commerce/membership-sale.js';
import { updateMemberRow } from '../src/services/app/members.js';
import { applyAppInvitesForVerifiedEmail } from '../src/services/app/member-invites.js';
import { emailHashOf } from '../src/services/owner/provisioning.js';
import { UNCHANGED } from '../src/services/record-cas.js';
import { runAsNode } from '../src/utils/gaii.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { registerOwner } from './helpers/owner-login.js';
import { BASE as RUNNER_BASE, assert, expectRefusal, finish, json as runnerJson, test } from './helpers/harness.js';

const PORT = Number(new URL(RUNNER_BASE).port || '40251') + 271;
const BASE = `http://127.0.0.1:${PORT}`;
const NODE_ID = `memsale-${PORT}`;
const DAY = 86_400_000;

async function bootNode(): Promise<{ server: Server; config: AimeatConfig; storage: Storage }> {
  const adminPw = randomBytes(16).toString('base64url');
  process.env.AIMEAT_PORT = String(PORT);
  process.env.AIMEAT_DEV_MODE = 'true';
  process.env.AIMEAT_TEST_MODE = 'true';
  process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
  process.env.AIMEAT_NODE_ID = NODE_ID;
  process.env.AIMEAT_BASE_URL = BASE;
  const { config } = loadConfig({});
  Object.assign(config, {
    port: PORT, nodeId: NODE_ID, baseUrl: BASE, devMode: true, testMode: true, adminPassword: adminPw,
    ...(await ownNodeDb(String(PORT), { memory: true })).config, testMoneyHandler: true,
  });
  const { app, storage } = await createServer(config);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, '127.0.0.1', () => resolve(s)); });
  return { server, config, storage };
}

const json = (path: string, opts: RequestInit = {}) => runnerJson(`${BASE}${path}`, opts);
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const near = (a: string | number, b: string | number, ms = 60_000) => Math.abs(Date.parse(String(a)) - (typeof b === 'number' ? b : Date.parse(b))) < ms;

console.log('\n=== Selling an app\'s membership ===\n');
const node = await bootNode();
const renew = (at: number) => runAsNode(NODE_ID, () => runSubscriptionRenewals(node.storage, node.config, at));

const stamp = Date.now().toString(36);
const APP = 'club.html';
const ROLE = 'member';
const PRICE = 4_900_000;       // 4.90 EUR
const STRIPE_PRICE = `price_club${stamp}`;
const WEBHOOK_SECRET = `whsec_${randomBytes(12).toString('hex')}`;
const TOOL = 'coach';
type Person = { name: string; ghii: string; token: string };
let operator!: Person, seller!: Person, sellerB!: Person, buyer!: Person, stranger!: Person, refunder!: Person;
let ext = '';
let offering = '';

const reg = async (n: string): Promise<Person> => { const o = await registerOwner(BASE, `${n}${stamp}`); return { name: o.name, ghii: o.ghii, token: o.token }; };
const plan = (body: Record<string, unknown>, token = seller.token) =>
  json(`/v1/apps/${seller.name}/${APP}/members/plan`, { method: 'PUT', headers: auth(token), body: JSON.stringify(body) });
const fullPlan = (extra: Record<string, unknown> = {}) => plan({
  roles: { [ROLE]: [offering] }, access: 'members-only', terms: { [ROLE]: { days: 30, renewal: 'self-serve' } },
  sale: { [ROLE]: { amount: PRICE, currency: 'EUR', renews: true, stripePrices: [STRIPE_PRICE] } }, ...extra,
});
/** The app's AI: a members-only tool of the app, as an app calls it. */
const coach = (token: string) => json(`/v1/apps/${seller.name}/${APP}/webmcp/tools/${TOOL}`, {
  method: 'POST', headers: auth(token), body: JSON.stringify({ input: { q: 'how do I start?' } }) });
async function buy(p: Person, input: Record<string, unknown> = { auto_renew: true }) {
  const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(p.token),
    body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'membership', app: `${seller.name}/${APP}`, tool: ROLE, input }] }) });
  if (open.status !== 201) return open;
  return json(`/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, {
    method: 'POST', headers: auth(p.token), body: JSON.stringify({ payment: { handler: 'test.money', instrument: 'testpm' } }) });
}
const memberRow = async (p: Person) => {
  const r = await json(`/v1/apps/${seller.name}/${APP}/members`, { headers: auth(seller.token) });
  return (r.body.data.members as any[]).find(m => m.owner === p.name.toLowerCase());
};
const subOf = async (p: Person) => {
  const r = await json('/v1/commerce/subscriptions', { headers: auth(p.token) });
  return (r.body.data.subscriptions as any[]).find(s => s.ext === membershipExt(`${seller.name}/${APP}`));
};
const feeRecords = async (trackingCode: string) => {
  const { items } = await node.storage.listAllMemory({ prefix: 'commerce.platform-fee.', limit: 1000 });
  return items.filter(r => r.key.includes(trackingCode));
};
/** A Stripe event, signed with the seller's webhook secret the way Stripe signs it. */
function stripeDelivery(owner: string, event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex');
  return json(`/v1/commerce/webhooks/stripe/${owner}`, { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body });
}
async function verifyEmail(p: Person, email: string) {
  const clean = email.toLowerCase();
  await node.storage.updateGHII(p.ghii, { emailHash: emailHashOf(clean), emailVerifiedAt: new Date().toISOString(), notificationEmail: clean, verificationLevel: 1, verificationMethod: 'email' });
  await runAsNode(NODE_ID, () => applyAppInvitesForVerifiedEmail(node.storage, NODE_ID, emailHashOf(clean), p.ghii));
}

try {
  console.log('Setup');
  await test('An app, its members-only tool (the app\'s AI), a seller, a second seller, a buyer and a stranger', async () => {
    operator = await reg('memop');   // the first account of a fresh node is its operator; the seller is somebody else
    seller = await reg('memseller');
    sellerB = await reg('memsellerb');
    buyer = await reg('membuyer');
    stranger = await reg('memstranger');
    refunder = await reg('memrefund');
    const pub = await json('/v1/apps', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({
      filename: APP, name: 'Club', description: 'membership sale e2e',
      content: Buffer.from('<!doctype html><title>club</title><p>club', 'utf8').toString('base64') }) });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const pubB = await json('/v1/apps', { method: 'POST', headers: auth(sellerB.token), body: JSON.stringify({
      filename: APP, name: 'Club B', description: 'membership sale e2e',
      content: Buffer.from('<!doctype html><title>club b</title><p>b', 'utf8').toString('base64') }) });
    assert(pubB.status === 200 || pubB.status === 201, `publish B ${pubB.status}`);
    ext = `memext${stamp}`;
    const manifest = [
      'metadata:', `  name: ${ext}`, '  version: 1.0.0', '  description: membership sale fixture', '  author: t',
      'config:', '  app:', '    type: string', `    default: ${seller.name}/${APP}`,
      'actions:', `  - id: ${TOOL}`, '    method: POST', `    path: /${TOOL}`,
      '    input: { type: object }', '    output: { type: object }', `    script: ${TOOL}.js`,
    ].join('\n');
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({
      manifest, scripts: { [`${TOOL}.js`]: 'export default async function () { return { ok: true, answer: "Start with ten minutes a day." }; }' } }) });
    assert(inst.status === 200 || inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    assert((await json(`/v1/extensions/${ext}/activate`, { method: 'POST', headers: auth(seller.token), body: '{}' })).status === 200, 'activate');
    // The operator's capability aggregation registers ext:<name>:<action>.
    const agg = await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: auth(operator.token) });
    assert(agg.status === 200, `aggregate ${agg.status}: ${JSON.stringify(agg.body?.error)}`);
    const schema = { type: 'object', properties: { q: { type: 'string' } } };
    const put = await json('/v1/memory', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({
      key: `apps.${APP}.tools`, visibility: 'public',
      value: { version: 1, tools: [{ name: TOOL, description: 'ask the coach', action_id: `ext:${ext}:${TOOL}`, inputSchema: schema, outputSchema: schema, tollMorsels: 1, exchange: true }] } }) });
    assert(put.status === 200 || put.status === 201, `tool manifest ${put.status}: ${JSON.stringify(put.body?.error)}`);
    const listed = await json('/v1/exchange/offerings', { headers: auth(seller.token) });
    offering = ((listed.body.data.offerings as any[]).find(o => o.providerOwner === seller.name && o.action === TOOL)?.offeringId) ?? '';
    assert(!!offering, 'the tool is listed');
  });

  console.log('\n1. The price');
  await test('1a. FAILURE: a role for sale with no period is refused, and nothing is stored', async () => {
    const r = await plan({ roles: { [ROLE]: [offering] }, sale: { [ROLE]: { amount: PRICE, currency: 'EUR' } } });
    expectRefusal(r, 400, 'SALE_NEEDS_TERM');
    const pub = await json(`/v1/apps/${seller.name}/${APP}/membership`);
    assert(pub.status === 200 && pub.body.data.for_sale.length === 0, `nothing for sale yet: ${JSON.stringify(pub.body?.data)}`);
  });

  await test('1b. FAILURE: a malformed price is refused with the field it is about', async () => {
    // The contract's validation answers first (VALIDATION_ERROR); the plan's own check says the same.
    const r = await plan({ roles: {}, terms: { [ROLE]: { days: 30 } }, sale: { [ROLE]: { amount: 4.9, currency: 'EUR' } } });
    assert(r.status === 400 && /amount/.test(JSON.stringify(r.body.error)), `refused naming the amount: ${r.status} ${JSON.stringify(r.body.error)}`);
    const pub = await json(`/v1/apps/${seller.name}/${APP}/membership`);
    assert(pub.body.data.for_sale.length === 0, 'and nothing was stored');
  });

  await test('1c. The owner prices the role; anyone reads the price, the period, the renewal and the seller', async () => {
    const r = await fullPlan();
    assert(r.status === 200, `plan ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const pub = await json(`/v1/apps/${seller.name}/${APP}/membership`);
    const row = pub.body.data.for_sale[0];
    assert(row?.role === ROLE && row.amount === PRICE && row.currency === 'EUR' && row.days === 30 && row.renews === true && row.buy_here === true,
      `the role for sale: ${JSON.stringify(pub.body.data)}`);
    assert(pub.body.data.seller.name === seller.name && pub.body.data.me === null && pub.body.data.guest.open === true, `seller, no caller, open to guests: ${JSON.stringify(pub.body.data)}`);
    assert(!('stripePrices' in row) && !JSON.stringify(pub.body.data).includes(STRIPE_PRICE), 'the Stripe price ids stay the owner\'s');
  });

  await test('1d. A save of the plan that leaves out `sale` keeps the price', async () => {
    const r = await plan({ roles: { [ROLE]: [offering] }, access: 'members-only', terms: { [ROLE]: { days: 30, renewal: 'self-serve' } } });
    assert(r.status === 200 && r.body.data.plan.sale?.[ROLE]?.amount === PRICE, `kept: ${JSON.stringify(r.body?.data?.plan?.sale ?? r.body?.error)}`);
  });

  await test('1e. FAILURE: the app\'s AI refuses a non-member before it charges', async () => {
    expectRefusal(await coach(stranger.token), 403, 'MEMBERS_ONLY');
  });

  await test('1f. FAILURE: seller B cannot sell a role of seller A\'s app, and the owner cannot buy their own', async () => {
    const r = await json(`/v1/apps/${seller.name}/${APP}/members/plan`, { method: 'PUT', headers: auth(sellerB.token),
      body: JSON.stringify({ roles: {}, terms: { [ROLE]: { days: 1 } }, sale: { [ROLE]: { amount: 1_000_000, currency: 'EUR' } } }) });
    assert(r.status === 403, `another owner set the price: ${r.status} ${JSON.stringify(r.body?.error)}`);
    expectRefusal(await buy(seller), 409, 'MEMBER_IS_OWNER');
  });

  console.log('\n2. A purchase');
  let firstEnd = '';
  let tracking = '';
  await test('2a. The buyer buys: a member to the end of the paid period, one date on the row and the subscription', async () => {
    const done = await buy(buyer);
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body?.error)}`);
    const m = done.body.data.session.fulfillment.results[0].result.membership;
    assert(m.role === ROLE && m.auto_renew === true && near(m.until, Date.now() + 30 * DAY), `the membership: ${JSON.stringify(m)}`);
    firstEnd = m.until;
    tracking = done.body.data.session.receipt.trackingCode;
    const row = await memberRow(buyer);
    assert(row?.role === ROLE && row.expiresAt === firstEnd && row.paid?.until === firstEnd && row.paid.renews === true, `the row: ${JSON.stringify(row)}`);
    const sub = await subOf(buyer);
    assert(sub?.active_until === firstEnd && sub.kind === 'membership' && sub.role === ROLE, `the subscription: ${JSON.stringify(sub)}`);
    const me = await json(`/v1/apps/${seller.name}/${APP}/membership`, { headers: auth(buyer.token) });
    assert(me.body.data.me.member.paid_until === firstEnd && me.body.data.me.member.renews === true, `the buyer's standing: ${JSON.stringify(me.body.data.me)}`);
  });

  await test('2b. The app\'s AI serves the member', async () => {
    const r = await coach(buyer.token);
    assert(r.status === 200, `the member is served: ${r.status} ${JSON.stringify(r.body?.error)}`);
  });

  await test('2c. No platform fee is recorded on the sale, and the receipt says so', async () => {
    assert((await feeRecords(tracking)).length === 0, 'a platform fee record was written');
    const s = await json('/v1/commerce/checkout-sessions', { headers: auth(buyer.token) });
    const done = (s.body.data.sessions as any[]).find(x => x.receipt?.trackingCode === tracking);
    assert(done?.receipt.fee === 0 && done.receipt.earned === PRICE, `fee 0, the seller earns the whole price: ${JSON.stringify(done?.receipt)}`);
  });

  await test('2d. FAILURE: the buyer cannot set their own end date: an input naming one changes nothing', async () => {
    const done = await buy(stranger, { auto_renew: false, expires_at: '2099-01-01T00:00:00Z', until: '2099-01-01T00:00:00Z', days: 9999 });
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body?.error)}`);
    const row = await memberRow(stranger);
    assert(near(row.expiresAt, Date.now() + 30 * DAY) && row.paid.renews === false, `one period, as sold: ${JSON.stringify(row)}`);
    const guest = await json(`/v1/apps/${seller.name}/${APP}/membership/guest/complete`, { method: 'POST',
      body: JSON.stringify({ purchase: 'gm_000000000000000000000000', until: '2099-01-01T00:00:00Z' }) });
    expectRefusal(guest, 400, 'INVALID_INPUT');
  });

  console.log('\n3. Renewal, cancel and the end');
  await test('3a. The renewal extends the row and the subscription by one period from the end', async () => {
    const outs = await renew(Date.parse(firstEnd) - 2 * DAY);
    const o = outs.find(x => x.buyer === buyer.ghii);
    assert(o?.result === 'renewed', `renewed: ${JSON.stringify(o)}`);
    const sub = await subOf(buyer);
    const row = await memberRow(buyer);
    assert(near(sub.active_until, Date.parse(firstEnd) + 30 * DAY, 1000), `the period: ${firstEnd} -> ${sub.active_until}`);
    assert(row.expiresAt === sub.active_until && row.paid.until === sub.active_until, `one date: ${row.expiresAt} / ${sub.active_until}`);
    const renewalCode = (await node.storage.getMemory(buyer.ghii, `commerce.subscription.${membershipExt(`${seller.name}/${APP}`)}.${ROLE}`))?.value as any;
    const last = renewalCode.charges[renewalCode.charges.length - 1];
    assert((await feeRecords(last)).length === 0, 'no platform fee on the renewal either');
  });

  await test('3b. The owner\'s roster shows paid until and renewal on', async () => {
    const row = await memberRow(buyer);
    assert(typeof row.paid?.until === 'string' && row.paid.renews === true && row.paid.via === 'checkout', `the owner sees: ${JSON.stringify(row.paid)}`);
  });

  await test('3c. A cancel keeps the paid period and stops the renewal', async () => {
    const sub = await subOf(buyer);
    const c = await json(`/v1/commerce/subscriptions/${sub.ext}/${ROLE}/cancel`, { method: 'POST', headers: auth(buyer.token) });
    assert(c.status === 200 && c.body.data.subscription.auto_renew === false, `cancel ${c.status}: ${JSON.stringify(c.body?.error)}`);
    const row = await memberRow(buyer);
    assert(row.expiresAt === sub.active_until && row.paid.renews === false, `the period stays, no renewal: ${JSON.stringify(row)}`);
    const outs = await renew(Date.parse(sub.active_until) - 2 * DAY);
    assert(!outs.some(x => x.buyer === buyer.ghii && x.result === 'renewed'), `not renewed: ${JSON.stringify(outs.filter(x => x.buyer === buyer.ghii))}`);
    assert((await subOf(buyer)).active_until === sub.active_until, 'and the period did not move');
  });

  await test('3d. FAILURE: when the paid period has ended, the app\'s AI refuses the lapsed member', async () => {
    // The clock: the end of the period, written where the period ends for this test.
    const past = new Date(Date.now() - 1000).toISOString();
    await updateMemberRow(node.storage, `${seller.name}/${APP}`, buyer.ghii, cur => (cur ? { ...cur, expiresAt: past } : UNCHANGED));
    expectRefusal(await coach(buyer.token), 403, 'MEMBERS_ONLY');
  });

  console.log('\n4. A refund');
  await test('4a. A full refund on the seller\'s webhook removes the membership it paid for', async () => {
    const done = await buy(refunder);
    assert(done.status === 200, `buy ${done.status}`);
    const code = done.body.data.session.receipt.trackingCode as string;
    assert((await coach(refunder.token)).status === 200, 'a member before the refund');
    const psp = await json('/v1/commerce/payout/stripe', { method: 'PUT', headers: auth(seller.token),
      body: JSON.stringify({ secret_key: 'sk_test_e2e_not_used_here', webhook_secret: WEBHOOK_SECRET }) });
    assert(psp.status === 200, `webhook secret ${psp.status}: ${JSON.stringify(psp.body?.error)}`);
    const r = await stripeDelivery(seller.name, { id: `evt_ref_${stamp}`, type: 'charge.refunded', data: { object: {
      id: `ch_${stamp}`, object: 'charge', amount_refunded: 490, currency: 'eur', refunded: true, payment_intent: code } } });
    assert(r.status === 200, `webhook ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(!(await memberRow(refunder)), 'the member row is gone');
    const sub = await subOf(refunder);
    assert(sub.auto_renew === false && sub.refunded_at && sub.active === false, `the subscription ended: ${JSON.stringify(sub)}`);
    expectRefusal(await coach(refunder.token), 403, 'MEMBERS_ONLY');
  });

  console.log('\n5. A buyer without an account');
  await test('5a. An email address pays, and the account that address then gets is a member at once, renewing', async () => {
    // The seller's Stripe key is set now; the guest sale needs a seller on the test rail, so seller B sells too.
    const planB = await json(`/v1/apps/${sellerB.name}/${APP}/members/plan`, { method: 'PUT', headers: auth(sellerB.token), body: JSON.stringify({
      roles: {}, terms: { [ROLE]: { days: 30 } }, sale: { [ROLE]: { amount: PRICE, currency: 'EUR', renews: true } } }) });
    assert(planB.status === 200, `plan B ${planB.status}: ${JSON.stringify(planB.body?.error)}`);
    const email = `guest.${stamp}@example.com`;
    const open = await json(`/v1/apps/${sellerB.name}/${APP}/membership/guest`, { method: 'POST',
      body: JSON.stringify({ role: ROLE, email, return_url: `${BASE}/v1/app-join?app=${sellerB.name}/${APP}` }) });
    assert(open.status === 201 && open.body.data.test_money === true, `open ${open.status}: ${JSON.stringify(open.body?.error ?? open.body.data)}`);
    const done = await json(`/v1/apps/${sellerB.name}/${APP}/membership/guest/complete`, { method: 'POST',
      body: JSON.stringify({ purchase: open.body.data.purchase, handler: 'test.money', instrument: 'testpm' }) });
    assert(done.status === 200 && done.body.data.next === 'email', `complete ${done.status}: ${JSON.stringify(done.body?.error ?? done.body.data)}`);
    const roster = await json(`/v1/apps/${sellerB.name}/${APP}/members`, { headers: auth(sellerB.token) });
    const inv = (roster.body.data.invites as any[]).find(i => i.emailShown === email);
    assert(inv?.paidUntil && near(inv.paidUntil, Date.now() + 30 * DAY), `a paid invitation: ${JSON.stringify(inv)}`);
    const again = await json(`/v1/apps/${sellerB.name}/${APP}/membership/guest/complete`, { method: 'POST',
      body: JSON.stringify({ purchase: open.body.data.purchase, handler: 'test.money', instrument: 'testpm' }) });
    assert(again.status === 200, 'a second completion answers as done, and charges nothing');
    const newcomer = await reg('memguest');
    await verifyEmail(newcomer, email);
    const after = await json(`/v1/apps/${sellerB.name}/${APP}/members`, { headers: auth(sellerB.token) });
    const row = (after.body.data.members as any[]).find(m => m.owner === newcomer.name.toLowerCase());
    assert(row?.role === ROLE && row.expiresAt === inv.paidUntil && row.paid?.renews === true, `a member to the paid end: ${JSON.stringify(row)}`);
    const subs = await json('/v1/commerce/subscriptions', { headers: auth(newcomer.token) });
    const sub = (subs.body.data.subscriptions as any[]).find(s => s.kind === 'membership');
    assert(sub?.active_until === row.expiresAt && sub.auto_renew === true, `its renewal is kept: ${JSON.stringify(sub)}`);
  });

  await test('5b. FAILURE: on a closed node a purchase without an account is refused, and the page says so', async () => {
    const before = node.config.registrationMode;
    node.config.registrationMode = 'closed';
    try {
      const pub = await json(`/v1/apps/${sellerB.name}/${APP}/membership`);
      assert(pub.body.data.guest.open === false, `not offered: ${JSON.stringify(pub.body.data.guest)}`);
      const open = await json(`/v1/apps/${sellerB.name}/${APP}/membership/guest`, { method: 'POST',
        body: JSON.stringify({ role: ROLE, email: `closed.${stamp}@example.com`, return_url: `${BASE}/v1/app-join` }) });
      expectRefusal(open, 403, 'REGISTRATION_CLOSED');
    } finally { node.config.registrationMode = before; }
  });

  console.log('\n6. Sold on the seller\'s own Stripe');
  let erin!: Person;
  const erinEmail = `erin.${stamp}@example.com`;
  const periodEnd = Math.floor((Date.now() + 31 * DAY) / 1000);
  const invoice = (id: string) => ({ id, type: 'invoice.paid', data: { object: {
    id: `in_${stamp}`, object: 'invoice', customer_email: erinEmail, subscription: `sub_${stamp}`, payment_intent: `pi_ext_${stamp}`,
    lines: { data: [{ price: { id: STRIPE_PRICE }, period: { start: Math.floor(Date.now() / 1000), end: periodEnd } }] } } } });
  await test('6a. invoice.paid makes the payer a member to the end of the paid period', async () => {
    erin = await reg('memerin');
    await verifyEmail(erin, erinEmail);
    const r = await stripeDelivery(seller.name, invoice(`evt_inv_${stamp}`));
    assert(r.status === 200 && r.body.data.action === 'membership_member', `webhook ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
    const row = await memberRow(erin);
    assert(row?.role === ROLE && near(row.expiresAt, periodEnd * 1000, 1000) && row.paid.via === 'stripe' && row.paid.renews === true, `the row: ${JSON.stringify(row)}`);
    assert((await coach(erin.token)).status === 200, 'the app\'s AI serves the payer');
  });

  await test('6b. A redelivery of the same event does nothing', async () => {
    const r = await stripeDelivery(seller.name, invoice(`evt_inv_${stamp}`));
    assert(r.body.data.action === 'membership_event_seen', `seen: ${JSON.stringify(r.body.data)}`);
  });

  await test('6c. FAILURE: seller B\'s webhook naming seller A\'s price makes nobody a member of A\'s app', async () => {
    const pspB = await json('/v1/commerce/payout/stripe', { method: 'PUT', headers: auth(sellerB.token),
      body: JSON.stringify({ secret_key: 'sk_test_e2e_not_used_here', webhook_secret: WEBHOOK_SECRET }) });
    assert(pspB.status === 200, `B webhook secret ${pspB.status}`);
    const mallory = await reg('memmallory');
    const mEmail = `mallory.${stamp}@example.com`;
    await verifyEmail(mallory, mEmail);
    const ev = invoice(`evt_b_${stamp}`);
    (ev.data.object as any).customer_email = mEmail;
    const r = await stripeDelivery(sellerB.name, ev);
    assert(r.status === 200 && !String(r.body.data.action).startsWith('membership_'), `B's webhook: ${JSON.stringify(r.body.data)}`);
    assert(!(await memberRow(mallory)), 'not a member of A\'s app');
    expectRefusal(await coach(mallory.token), 403, 'MEMBERS_ONLY');
  });

  await test('6d. cancel_at_period_end stops the renewal; the paid period stays', async () => {
    const before = await memberRow(erin);
    const r = await stripeDelivery(seller.name, { id: `evt_upd_${stamp}`, type: 'customer.subscription.updated', data: { object: {
      id: `sub_${stamp}`, object: 'subscription', cancel_at_period_end: true, status: 'active' } } });
    assert(r.body.data.action === 'membership_ends_at_period_end', `webhook: ${JSON.stringify(r.body.data)}`);
    const row = await memberRow(erin);
    assert(row.paid.renews === false && row.expiresAt === before.expiresAt, `ends at the period end: ${JSON.stringify(row)}`);
  });

  await test('6e. A refund of the invoice\'s payment removes the membership', async () => {
    const r = await stripeDelivery(seller.name, { id: `evt_ref2_${stamp}`, type: 'charge.refunded', data: { object: {
      id: `ch_ext_${stamp}`, object: 'charge', amount_refunded: 490, currency: 'eur', refunded: true, payment_intent: `pi_ext_${stamp}` } } });
    assert(r.status === 200, `webhook ${r.status}`);
    assert(!(await memberRow(erin)), 'the member row is gone');
    expectRefusal(await coach(erin.token), 403, 'MEMBERS_ONLY');
  });

  console.log('\n7. The term on an invitation and on a re-approval');
  await test('7a. An invitation by email carries the term the owner gave', async () => {
    const email = `term.${stamp}@example.com`;
    const inv = await json(`/v1/apps/${seller.name}/${APP}/members`, { method: 'POST', headers: auth(seller.token),
      body: JSON.stringify({ email, role: 'guest', days: 10 }) });
    assert(inv.status === 201 && inv.body.data.invited === true, `invite ${inv.status}: ${JSON.stringify(inv.body?.error)}`);
    const p = await reg('memterm');
    await verifyEmail(p, email);
    const row = await memberRow(p);
    assert(row?.role === 'guest' && near(row.expiresAt, Date.now() + 10 * DAY), `ten days: ${JSON.stringify(row)}`);
  });

  await test('7b. A re-approval into the role held continues from the end of the running term', async () => {
    const p = await reg('memreapp');
    const first = await json(`/v1/apps/${seller.name}/${APP}/members`, { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ account: p.name, role: 'guest', days: 10 }) });
    assert(first.status === 201, `approve ${first.status}`);
    const end = first.body.data.member.expiresAt;
    const again = await json(`/v1/apps/${seller.name}/${APP}/members`, { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ account: p.name, role: 'guest', days: 10 }) });
    assert(again.status === 200 && near(again.body.data.member.expiresAt, Date.parse(end) + 10 * DAY, 5000), `from the end: ${end} -> ${again.body.data.member.expiresAt}`);
  });
} finally {
  node.server.close();
}
finish();
