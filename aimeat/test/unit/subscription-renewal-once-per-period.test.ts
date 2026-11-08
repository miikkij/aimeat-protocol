/**
 * @file test/unit/subscription-renewal-once-per-period.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One renewal charge per subscription period, whatever runs the renewal for that period
 *   at the same moment: two daily runs (two processes), or the buyer's one-press allow of a raised
 *   price beside the daily run. The period is claimed before the card is charged (secaudit2026nov08
 *   round 14, subscriptions:renewal-deliver-not-bound-to-period).
 *
 *   An in-memory database and a stub payment handler whose charge of a kept card waits a moment and
 *   answers a new tracking code each call (as the test-money handler does), so both callers read the
 *   period before either writes it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/subscription-renewal-once-per-period.test.ts
 * @version-history
 *   2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { registerPaymentHandler, resetPaymentHandlers } from '../../src/commerce/payment-handlers.js';
import { PLANS_KEY, runSubscriptionRenewals, allowRaisedPrice } from '../../src/commerce/subscriptions.js';

const NODE = 'node';
const BUYER = `reader@${NODE}`;
const SELLER = `studio@${NODE}`;
const EXT = 'studiosubs';
const DAY = 86_400_000;
const config = { nodeId: NODE, commerceFeePercent: 0, baseUrl: 'https://node.test' } as unknown as AimeatConfig;
let storage: Storage;
let charges: string[] = [];
let decline = false;

const rec = (until: string) => ({
  ext: EXT, plan: 'monthly', title: 'Monthly', seller_ghii: SELLER, buyer_ghii: BUYER, amount: 3_990_000, currency: 'EUR',
  period_days: 30, started_at: new Date(Date.now() - 28 * DAY).toISOString(), active_until: until, auto_renew: true,
  kept_payment: { handler: 'test.slow', customer: 'cus_1', payment_method: 'pm_1' }, updated_at: new Date().toISOString(),
});
const write = async (owner: string, key: string, value: unknown) => storage.setMemory({
  key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
const subOf = async () => (await storage.getMemory(BUYER, `commerce.subscription.${EXT}.monthly`))?.value as Record<string, any>;

beforeEach(async () => {
  charges = [];
  decline = false;
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  (storage as unknown as { getExtension: (n: string) => Promise<unknown> }).getExtension = async (n: string) =>
    n === EXT ? { name: EXT, status: 'active', installedBy: 'studio', actions: [] } : null;
  resetPaymentHandlers();
  registerPaymentHandler({
    id: 'test.slow', title: 'slow test money', currencies: ['EUR'],
    async collect() { throw new Error('not used'); },
    async payout() { /* nothing */ },
    async refund() { return { outcome: 'refunded' }; },
    async chargeSaved(_ctx, args) {
      await new Promise(r => setTimeout(r, 50));
      if (decline) throw new Error('card declined');
      charges.push(args.reference);
      return { trackingCode: `slow_${charges.length}` };
    },
  } as never);
  await write(`ext:${EXT}`, PLANS_KEY, { plans: [{ id: 'monthly', title: 'Monthly', amount: 3_990_000, currency: 'EUR', period_days: 30 }] });
});

describe('a subscription period renews once', () => {
  it('two daily runs at the same moment charge the period once and extend it by one period', async () => {
    const until = new Date(Date.now() + DAY).toISOString();
    await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec(until));
    const [a, b] = await Promise.all([runSubscriptionRenewals(storage, config), runSubscriptionRenewals(storage, config)]);
    expect(charges.length).toBe(1);
    expect(Date.parse((await subOf()).active_until) - Date.parse(until)).toBe(30 * DAY);
    expect([a[0].result, b[0].result].sort()).toEqual(['renewed', 'skipped']);
  });

  it('the buyer\'s one-press allow beside the daily run charges the period once', async () => {
    const until = new Date(Date.now() + DAY).toISOString();
    await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec(until));
    const [allowed] = await Promise.all([
      allowRaisedPrice(storage, config, BUYER, { ext: EXT, plan: 'monthly', period: until, amount: 3_990_000, currency: 'EUR' }),
      runSubscriptionRenewals(storage, config),
    ]);
    expect(allowed.ok).toBe(true);
    expect(charges.length).toBe(1);
    expect(Date.parse((await subOf()).active_until) - Date.parse(until)).toBe(30 * DAY);
  });

  it('a declined charge leaves the period free, so the next day tries again and renews it', async () => {
    const until = new Date(Date.now() + DAY).toISOString();
    await write(BUYER, `commerce.subscription.${EXT}.monthly`, rec(until));
    decline = true;
    expect((await runSubscriptionRenewals(storage, config))[0].result).toBe('failed');
    expect((await subOf()).active_until).toBe(until);
    decline = false;
    expect((await runSubscriptionRenewals(storage, config))[0].result).toBe('renewed');
    expect(charges.length).toBe(1);
    expect(Date.parse((await subOf()).active_until) - Date.parse(until)).toBe(30 * DAY);
  });
});
