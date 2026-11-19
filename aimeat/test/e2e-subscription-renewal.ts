/**
 * @file test/e2e-subscription-renewal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The automatic renewal of a subscription to an extension's plan, and the buyer's
 *   one-press approval of a raised price (commerce/subscriptions.ts runSubscriptionRenewals and
 *   allowRaisedPrice, commerce/subscription-price-ask.ts). e2e-subscriptions.ts holds the purchase,
 *   the listing and the cancel; the renewal itself was held by unit tests only. This suite runs a
 *   node in this process on the run's backend, buys through the real checkout routes on the test
 *   money rail, and drives the daily renewal with a clock set three days before the end:
 *     1. a period not yet due renews nothing; a due one is charged once and extended by one period,
 *        and a second run in the same period charges nothing;
 *     2. a raised price is not charged: the buyer is asked once (a notice and a request), the period
 *        stays, a second run only waits; the buyer's "approve" makes the new price the agreed one
 *        and renews at once;
 *     3. a kept card that is declined fails the renewal, tells the buyer once per period, and the
 *        period stays as it was;
 *     4. a cancelled subscription is not renewed.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=subscription-renewal
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 4.5).
 */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from '../src/server.js';
import { loadConfig, type AimeatConfig } from '../src/config.js';
import type { Storage } from '../src/storage/interface.js';
import { runSubscriptionRenewals } from '../src/commerce/subscriptions.js';
import { runAsNode } from '../src/utils/gaii.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { registerOwner } from './helpers/owner-login.js';
import { BASE as RUNNER_BASE, assert, expectRefusal, finish, json as runnerJson, test } from './helpers/harness.js';

const PORT = Number(new URL(RUNNER_BASE).port || '40251') + 263;
const BASE = `http://127.0.0.1:${PORT}`;
const NODE_ID = `subrenew-${PORT}`;
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

console.log('\n=== Subscription renewal and the raised-price approval ===\n');
const node = await bootNode();
const renew = (at: number) => runAsNode(NODE_ID, () => runSubscriptionRenewals(node.storage, node.config, at));

const stamp = Date.now().toString(36);
const EXT = `renewsubs${stamp}`;
const PLAN = 'monthly';
const SCRIPTS = {
  plans: `export default async function(ctx, input){
    await ctx.memory.set('subscription.plans', { plans: [
      { id: 'monthly', title: 'Monthly reading', amount: input.amount || 2000000, currency: 'EUR', period_days: 30 },
    ] });
    return { ok: true };
  }`,
};
const manifest = JSON.stringify({
  metadata: { name: EXT, version: '1.0.0', description: 'subscription renewal e2e', author: 'e2e' },
  actions: [{ id: 'plans', method: 'POST', path: '/plans', script: 'plans' }],
  limits: { timeout_ms: 5000, max_api_calls: 5 },
});

type Person = { name: string; ghii: string; token: string };
let studio!: Person, reader!: Person, decliner!: Person;

async function subscribe(p: Person, instrument: string): Promise<string> {
  const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(p.token),
    body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'subscription', app: EXT, tool: PLAN, input: { auto_renew: true } }] }) });
  assert(open.status === 201, `open ${open.status}: ${JSON.stringify(open.body?.error)}`);
  const done = await json(`/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, {
    method: 'POST', headers: auth(p.token), body: JSON.stringify({ payment: { handler: 'test.money', instrument } }) });
  assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body?.error)}`);
  return done.body.data.session.fulfillment.results[0].result.subscription.active_until as string;
}
async function mine(p: Person): Promise<any> {
  const r = await json('/v1/commerce/subscriptions', { headers: auth(p.token) });
  assert(r.status === 200, `list ${r.status}`);
  return (r.body.data.subscriptions as any[]).find((s) => s.ext === EXT && s.plan === PLAN);
}
const outcomeFor = (outs: Array<{ buyer: string; result: string; detail?: string }>, p: Person) => outs.find((o) => o.buyer === p.ghii);
async function notices(p: Person, type: string): Promise<any[]> {
  const r = await json('/v1/notifications?limit=200', { headers: auth(p.token) });
  return (r.body?.data?.notifications ?? []).filter((n: any) => n.type === type);
}
const setPrice = (amount: number) => json(`/v1/ext/${EXT}/plans`, { method: 'POST', headers: auth(studio.token), body: JSON.stringify({ amount }) });

try {
  console.log('Setup');
  await test('A studio offers a monthly plan; a reader subscribes with automatic renewal', async () => {
    const reg = async (n: string): Promise<Person> => { const o = await registerOwner(BASE, `${n}${stamp}`); return { name: o.name, ghii: o.ghii, token: o.token }; };
    studio = await reg('renstudio');
    reader = await reg('renreader');
    decliner = await reg('rendecline');
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(studio.token), body: JSON.stringify({ manifest, scripts: SCRIPTS }) });
    assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(studio.token) });
    assert(act.status === 200, `activate ${act.status}`);
    const p = await setPrice(2_000_000);
    assert(p.status === 200, `plans ${p.status}: ${JSON.stringify(p.body?.error)}`);
    const until = await subscribe(reader, 'testpm');
    assert(Math.abs((Date.parse(until) - Date.now()) / DAY - 30) < 0.01, `one period of 30 days: ${until}`);
  });

  console.log('\n1. Renewal');
  let firstEnd = '';
  await test('1a. A period that ends in 30 days is not due: the daily run renews nothing for it', async () => {
    const outs = await renew(Date.now());
    assert(!outcomeFor(outs, reader), `nothing for the reader: ${JSON.stringify(outcomeFor(outs, reader))}`);
    firstEnd = (await mine(reader)).active_until;
  });

  await test('1b. Two days before the end the run charges the kept card once and extends by one period', async () => {
    const outs = await renew(Date.parse(firstEnd) - 2 * DAY);
    const o = outcomeFor(outs, reader);
    assert(o?.result === 'renewed', `renewed: ${JSON.stringify(o)}`);
    const sub = await mine(reader);
    assert(Math.abs((Date.parse(sub.active_until) - Date.parse(firstEnd)) / DAY - 30) < 0.01, `extended from the old end by 30 days: ${firstEnd} -> ${sub.active_until}`);
  });

  await test('1c. A second run at the same moment charges nothing more', async () => {
    const before = (await mine(reader)).active_until;
    const outs = await renew(Date.parse(firstEnd) - 2 * DAY);
    assert(outcomeFor(outs, reader)?.result !== 'renewed', `no second charge: ${JSON.stringify(outcomeFor(outs, reader))}`);
    assert((await mine(reader)).active_until === before, 'the period stays');
  });

  console.log('\n2. A raised price waits for the buyer');
  let requestId = '';
  await test('2a. The studio raises the price: the due renewal is not charged and the reader is asked once', async () => {
    const raised = await setPrice(3_000_000);
    assert(raised.status === 200, `raise ${raised.status}`);
    const end = (await mine(reader)).active_until;
    const outs = await renew(Date.parse(end) - 2 * DAY);
    const o = outcomeFor(outs, reader);
    assert(o?.result === 'skipped' && /asked the buyer \(request /.test(String(o.detail)), `asked: ${JSON.stringify(o)}`);
    requestId = /request ([^)\s]+)\)/.exec(String(o!.detail))?.[1] ?? '';
    assert(!!requestId, `a request id in ${o!.detail}`);
    assert((await mine(reader)).active_until === end, 'the card was not charged: the period stays');
    const req = await json(`/v1/publish-requests/${requestId}`, { headers: auth(reader.token) });
    assert(req.status === 200 && req.body.data?.request?.kind === 'subscription-price', `the request: ${req.status} ${JSON.stringify(req.body).slice(0, 300)}`);
  });

  await test('2b. A second run only waits for the answer and asks nothing new', async () => {
    const end = (await mine(reader)).active_until;
    const outs = await renew(Date.parse(end) - 2 * DAY);
    const o = outcomeFor(outs, reader);
    assert(o?.result === 'skipped' && /waiting for the buyer to allow the new price/.test(String(o.detail)), `waits: ${JSON.stringify(o)}`);
    assert((await mine(reader)).active_until === end, 'still not charged');
  });

  await test('2c. The reader allows the new price: it becomes the agreed one and the period renews at once', async () => {
    const end = (await mine(reader)).active_until;
    const d = await json(`/v1/publish-requests/${requestId}/decision`, { method: 'POST', headers: auth(reader.token), body: JSON.stringify({ decision: 'approve' }) });
    assert(d.status === 200, `approve ${d.status}: ${JSON.stringify(d.body?.error)}`);
    const sub = await mine(reader);
    assert(Math.abs((Date.parse(sub.active_until) - Date.parse(end)) / DAY - 30) < 0.01, `renewed on the yes: ${end} -> ${sub.active_until}`);
    assert(Number(sub.amount) === 3_000_000, `the agreed amount is the new price: ${sub.amount}`);
  });

  await test('2d. FAILURE: another account cannot answer the reader\'s question', async () => {
    const d = await json(`/v1/publish-requests/${requestId}/decision`, { method: 'POST', headers: auth(studio.token), body: JSON.stringify({ decision: 'approve' }) });
    // The request is the reader's: to anyone else it does not exist, as for an id nobody issued.
    expectRefusal(d, 404, 'NOT_FOUND');
    assert(Number((await mine(reader)).amount) === 3_000_000, 'the reader\'s subscription is as the reader left it');
  });

  console.log('\n3. A declined card');
  await test('3a. A kept card that is declined fails the renewal, keeps the period and tells the buyer', async () => {
    const until = await subscribe(decliner, 'decline');
    const outs = await renew(Date.parse(until) - 2 * DAY);
    const o = outcomeFor(outs, decliner);
    assert(o?.result === 'failed' && /declined/.test(String(o.detail)), `failed: ${JSON.stringify(o)}`);
    assert((await mine(decliner)).active_until === until, 'the period stays as paid');
    const told = await notices(decliner, 'subscription_renewal_failed');
    assert(told.length === 1, `one notice, got ${told.length}`);
  });

  await test('3b. The next day\'s try fails again and does not tell the buyer twice in one period', async () => {
    const until = (await mine(decliner)).active_until;
    const outs = await renew(Date.parse(until) - DAY);
    assert(outcomeFor(outs, decliner)?.result === 'failed', `tried again: ${JSON.stringify(outcomeFor(outs, decliner))}`);
    assert((await notices(decliner, 'subscription_renewal_failed')).length === 1, 'still one notice');
  });

  console.log('\n4. Cancelled');
  await test('4. A cancelled subscription is not renewed when its end comes near', async () => {
    const c = await json(`/v1/commerce/subscriptions/${EXT}/${PLAN}/cancel`, { method: 'POST', headers: auth(reader.token), body: '{}' });
    assert(c.status === 200, `cancel ${c.status}: ${JSON.stringify(c.body?.error)}`);
    const end = (await mine(reader)).active_until;
    const outs = await renew(Date.parse(end) - 2 * DAY);
    assert(!outcomeFor(outs, reader), `nothing for a cancelled subscription: ${JSON.stringify(outcomeFor(outs, reader))}`);
    assert((await mine(reader)).active_until === end, 'the paid period is kept, nothing added');
  });
} finally {
  node.server.closeAllConnections();
  await new Promise<void>((r) => node.server.close(() => r()));
}

finish();
