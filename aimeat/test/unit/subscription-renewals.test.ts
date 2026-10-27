/**
 * @file test/unit/subscription-renewals.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description runSubscriptionRenewals (commerce/subscriptions.ts) on an in-memory database with the
 *   test money handler: a period that ends within three days is charged once and extended by one
 *   period, the plan's payees are booked, a period further away or cancelled is left alone, and a
 *   declined card tells the buyer once and keeps the end date.
 * @version-history
 *   v1.1.0 — 2026-10-25 — A raised plan price waits for the buyer's one-press answer; the same or a
 *     lower price renews as before (secaudit2026oct22).
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-5).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { registerPaymentHandler, resetPaymentHandlers } from '../../src/commerce/payment-handlers.js';
import { testMoneyPaymentHandler } from '../../src/commerce/test-money-handler.js';
import { PLANS_KEY, runSubscriptionRenewals } from '../../src/commerce/subscriptions.js';
import { putSplit } from '../../src/commerce/beneficiary-split.js';
import { setPurchaseLimit, spentToday } from '../../src/commerce/agent-purchase-limit.js';
import { decidePublishRequest } from '../../src/services/publish-requests/decide.js';
import { callerFromAuth } from '../../src/services/caller-context.js';

const NODE = 'node';
const BUYER = `reader@${NODE}`;
const SELLER = `studio@${NODE}`;
const ARTIST = `artist@${NODE}`;
const EXT = 'studiosubs';
const DAY = 86_400_000;
const config = { nodeId: NODE, commerceFeePercent: 0, baseUrl: 'https://node.test' } as unknown as AimeatConfig;
let storage: Storage;

const rec = (over: Record<string, unknown> = {}) => ({
  ext: EXT, plan: 'monthly', title: 'Monthly', seller_ghii: SELLER, buyer_ghii: BUYER, amount: 3_990_000, currency: 'EUR',
  period_days: 30, started_at: new Date(Date.now() - 28 * DAY).toISOString(),
  active_until: new Date(Date.now() + 2 * DAY).toISOString(), auto_renew: true,
  kept_payment: { handler: 'test.money', customer: 'testcus_1', payment_method: 'testpm' }, updated_at: new Date().toISOString(),
  ...over,
});
const write = async (owner: string, key: string, value: unknown) => storage.setMemory({
  key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
const subOf = async () => (await storage.getMemory(BUYER, `commerce.subscription.${EXT}.monthly`))?.value as Record<string, any>;

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  (storage as unknown as { getExtension: (n: string) => Promise<unknown> }).getExtension = async (n: string) =>
    n === EXT ? { name: EXT, status: 'active', installedBy: 'studio', actions: [] } : null;
  resetPaymentHandlers();
  registerPaymentHandler(testMoneyPaymentHandler());
  await write(`ext:${EXT}`, PLANS_KEY, { plans: [{ id: 'monthly', title: 'Monthly', amount: 3_990_000, currency: 'EUR', period_days: 30, beneficiaries: [{ ghii: ARTIST, weight: 1 }] }] });
});

describe('runSubscriptionRenewals', () => {
  it('charges a period ending within three days once, extends it by one period and pays the plan\'s payees', async () => {
    await putSplit(storage, { splitId: 's1', providerGhii: SELLER, ext: EXT, action: 'subscription', capabilityLabel: 'subs', mode: 'pool', poolPercent: 100, beneficiaries: [], roles: [], dynamic: true, state: 'active', createdAt: '', createdBy: SELLER, updatedAt: '' } as never);
    const before = await (async () => (await rec()).active_until)();
    await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec({ active_until: before }));
    const first = await runSubscriptionRenewals(storage, config);
    expect(first.map(o => o.result)).toEqual(['renewed']);
    const after = await subOf();
    expect(Date.parse(after.active_until) - Date.parse(before)).toBe(30 * DAY);
    const shares = await storage.listMemory(ARTIST, { prefix: 'commerce.benefit.' });
    expect(shares.length).toBe(1);
    // The next run finds the new period three days or more away and charges nothing.
    expect(await runSubscriptionRenewals(storage, config)).toEqual([]);
  });

  it('leaves a period further than three days away, and a cancelled one, alone', async () => {
    await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec({ active_until: new Date(Date.now() + 10 * DAY).toISOString() }));
    expect(await runSubscriptionRenewals(storage, config)).toEqual([]);
    await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec({ auto_renew: false }));
    expect(await runSubscriptionRenewals(storage, config)).toEqual([]);
  });

  it('a declined card keeps the end date, records why, and tells the buyer once per period', async () => {
    const until = new Date(Date.now() + DAY).toISOString();
    await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec({ active_until: until, kept_payment: { handler: 'test.money', customer: 'c', payment_method: 'decline' } }));
    const r = await runSubscriptionRenewals(storage, config);
    expect(r[0].result).toBe('failed');
    const after = await subOf();
    expect(after.active_until).toBe(until);
    expect(after.last_failure.reason).toContain('declined');
    const notes1 = (await storage.listMemory(BUYER, { prefix: 'notif.' })).length;
    await runSubscriptionRenewals(storage, config);
    expect((await storage.listMemory(BUYER, { prefix: 'notif.' })).length).toBe(notes1);
  });

  it('a renewal of a plan an agent bought is held to the agent\'s daily limit (secaudit2026oct22)', async () => {
    const AGENT = `shopper#reader@${NODE}`;
    const until = new Date(Date.now() + DAY).toISOString();
    // No limit set for the agent: an agent with no limit does not spend money, at renewal either.
    await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec({ active_until: until, bought_by: AGENT }));
    const refused = await runSubscriptionRenewals(storage, config);
    expect(refused[0]).toMatchObject({ result: 'failed' });
    expect(refused[0].detail).toContain('PURCHASE_LIMIT_NOT_SET');
    expect((await subOf()).active_until).toBe(until);
    const notes = await storage.listMemory(BUYER, { prefix: 'notif.' });
    expect(notes.length).toBe(1);
    expect(JSON.stringify(notes[0]!.value)).toContain('subscription_renewal_agent_limit');
    // Within a limit of 5 EUR a 3.99 EUR period renews, and is counted against the day.
    await setPurchaseLimit(storage, BUYER, AGENT, 'EUR', 5_000_000);
    expect((await runSubscriptionRenewals(storage, config))[0]).toMatchObject({ result: 'renewed' });
    expect((await spentToday(storage, BUYER))[AGENT]?.EUR).toBe(3_990_000);
  });

  describe('a raised plan price waits for the buyer (secaudit2026oct22)', () => {
    const raise = (amount: number) => write(`ext:${EXT}`, PLANS_KEY, { plans: [{ id: 'monthly', title: 'Monthly', amount, currency: 'EUR', period_days: 30 }] });
    const asks = async () => (await storage.listMemory(BUYER, { prefix: 'notif.' })).filter(n => JSON.stringify(n.value).includes('approval_subscription_price'));
    const buyer = () => callerFromAuth({ sub: BUYER, owner: 'reader', roles: ['owner'], scopes: ['*'] }, NODE, storage);
    const ctx = () => ({ storage, config });

    it('a higher price is not charged: the buyer is asked once, and the period keeps its end', async () => {
      const until = new Date(Date.now() + DAY).toISOString();
      await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec({ active_until: until }));
      await raise(4_990_000);
      const r = await runSubscriptionRenewals(storage, config);
      expect(r[0]).toMatchObject({ result: 'skipped' });
      expect(r[0].detail).toContain('3.99 EUR to 4.99 EUR');
      const sub = await subOf();
      expect(sub.active_until).toBe(until);
      expect(sub.amount).toBe(3_990_000);
      expect(sub.price_question).toMatchObject({ amount: 4_990_000, currency: 'EUR', period: until });
      expect((await asks()).length).toBe(1);
      // The next daily run neither charges nor asks again.
      expect((await runSubscriptionRenewals(storage, config))[0].detail).toContain('waiting for the buyer');
      expect((await asks()).length).toBe(1);
    });

    it('the buyer allows it with one press: the new price is the agreed one and the period renews at once', async () => {
      const until = new Date(Date.now() + DAY).toISOString();
      await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec({ active_until: until }));
      await raise(4_990_000);
      await runSubscriptionRenewals(storage, config);
      const id = (await subOf()).price_question.request_id as string;
      const out = await decidePublishRequest(ctx(), { caller: buyer() }, id, 'approve');
      expect(out).toMatchObject({ ok: true });
      const sub = await subOf();
      expect(sub.amount).toBe(4_990_000);
      expect(Date.parse(sub.active_until) - Date.parse(until)).toBe(30 * DAY);
      // The seller, for whom the renewal ran, hears the answer.
      const told = await storage.listMemory(SELLER, { prefix: 'notif.' });
      expect(JSON.stringify(told.map(n => n.value))).toContain('approval_answer_allowed');
    });

    it('the buyer does not allow it: nothing is charged, nobody asks again this period, and the seller hears it', async () => {
      const until = new Date(Date.now() + DAY).toISOString();
      await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec({ active_until: until }));
      await raise(4_990_000);
      await runSubscriptionRenewals(storage, config);
      const id = (await subOf()).price_question.request_id as string;
      expect(await decidePublishRequest(ctx(), { caller: buyer() }, id, 'decline')).toMatchObject({ ok: true });
      const again = await runSubscriptionRenewals(storage, config);
      expect(again[0].detail).toContain('did not allow');
      expect((await subOf()).active_until).toBe(until);
      expect((await asks()).length).toBe(1);
      expect(JSON.stringify((await storage.listMemory(SELLER, { prefix: 'notif.' })).map(n => n.value))).toContain('approval_answer_declined');
    });

    // secaudit2026oct26: a shorter period at the same amount is a higher price per day.
    const reperiod = (period_days: number, amount = 3_990_000) => write(`ext:${EXT}`, PLANS_KEY, { plans: [{ id: 'monthly', title: 'Monthly', amount, currency: 'EUR', period_days }] });
    const periodAsks = async () => (await storage.listMemory(BUYER, { prefix: 'notif.' })).filter(n => JSON.stringify(n.value).includes('approval_subscription_period'));

    it('a shorter period at the same amount is not charged: the buyer is asked once, and two daily runs charge nothing', async () => {
      const until = new Date(Date.now() + DAY).toISOString();
      await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec({ active_until: until }));
      await reperiod(1);
      const r = await runSubscriptionRenewals(storage, config);
      expect(r[0]).toMatchObject({ result: 'skipped' });
      const sub = await subOf();
      expect(sub.active_until).toBe(until);
      expect(sub.period_days).toBe(30);
      expect(sub.price_question).toMatchObject({ amount: 3_990_000, currency: 'EUR', period: until, period_days: 1 });
      expect((await periodAsks()).length).toBe(1);
      expect((await runSubscriptionRenewals(storage, config))[0].detail).toContain('waiting for the buyer');
      expect((await subOf()).active_until).toBe(until);
      expect((await periodAsks()).length).toBe(1);
    });

    it('the buyer allows the shorter period with one press: it is the agreed one and the period renews at once', async () => {
      const until = new Date(Date.now() + DAY).toISOString();
      await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec({ active_until: until }));
      await reperiod(7);
      await runSubscriptionRenewals(storage, config);
      const id = (await subOf()).price_question.request_id as string;
      expect(await decidePublishRequest(ctx(), { caller: buyer() }, id, 'approve')).toMatchObject({ ok: true });
      const sub = await subOf();
      expect(sub.period_days).toBe(7);
      expect(Date.parse(sub.active_until) - Date.parse(until)).toBe(7 * DAY);
    });

    it('designed use: a longer period, or a lower amount over a shorter period at no higher price per day, renews as before', async () => {
      await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec());
      await reperiod(60);
      expect((await runSubscriptionRenewals(storage, config))[0]).toMatchObject({ result: 'renewed' });
      expect((await subOf()).period_days).toBe(60);
      await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec());
      await reperiod(15, 1_995_000);
      expect((await runSubscriptionRenewals(storage, config))[0]).toMatchObject({ result: 'renewed' });
      expect((await periodAsks()).length + (await asks()).length).toBe(0);
    });

    it('designed use: the same or a lower price renews as before, at the plan\'s price', async () => {
      await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec());
      await raise(2_990_000);
      expect((await runSubscriptionRenewals(storage, config))[0]).toMatchObject({ result: 'renewed' });
      expect((await subOf()).amount).toBe(2_990_000);
      expect((await asks()).length).toBe(0);
    });
  });

  it('does not renew a plan the extension stopped offering', async () => {
    await write(`ext:${EXT}`, PLANS_KEY, { plans: [] });
    await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec());
    const r = await runSubscriptionRenewals(storage, config);
    expect(r[0]).toMatchObject({ result: 'skipped' });
  });
});
