/**
 * @file test/unit/subscription-renewals.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description runSubscriptionRenewals (commerce/subscriptions.ts) on an in-memory database with the
 *   test money handler: a period that ends within three days is charged once and extended by one
 *   period, the plan's payees are booked, a period further away or cancelled is left alone, and a
 *   declined card tells the buyer once and keeps the end date.
 * @version-history
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

  it('does not renew a plan the extension stopped offering', async () => {
    await write(`ext:${EXT}`, PLANS_KEY, { plans: [] });
    await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec());
    const r = await runSubscriptionRenewals(storage, config);
    expect(r[0]).toMatchObject({ result: 'skipped' });
  });
});
