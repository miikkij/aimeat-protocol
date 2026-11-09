/**
 * @file test/unit/subscription-renewal-cancel-and-unrecorded.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two edges of the subscription renewal (secaudit2026nov08b round 15).
 *
 *   A cancel stored while the daily run is in progress: the run read every subscription once at its
 *   start, so a subscription later in the list still looked renewing. The claim on the period reads the
 *   stored record right before the charge, and it now refuses a subscription whose renewal was turned
 *   off (commerce/subscriptions.ts:claimPeriod:cancelled-subscription-still-claimed).
 *
 *   A renewal whose card was charged and whose period write failed: the charge is refunded through the
 *   payment method; when the refund does not go through, the seller and the operator get the
 *   undelivered-payment record and the period is marked so no later run charges it again
 *   (commerce/subscriptions.ts:renewOne:charged-renewal-failed-write-unrecorded).
 *
 *   An in-memory database and a stub payment handler (a new tracking code per charge, as the
 *   test-money handler gives), with hooks that cancel at the moment named and a write fault on the
 *   one write that records the renewed period.
 * @usage cd aimeat && pnpm exec vitest run test/unit/subscription-renewal-cancel-and-unrecorded.test.ts
 * @version-history
 *   2026-11-08 — Initial (secaudit2026nov08b round 15).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { RefundOutcome } from '../../src/commerce/types.js';
import { registerPaymentHandler, resetPaymentHandlers } from '../../src/commerce/payment-handlers.js';
import { PLANS_KEY, runSubscriptionRenewals, allowRaisedPrice, cancelSubscription } from '../../src/commerce/subscriptions.js';
import { UNDELIVERED_PREFIX } from '../../src/commerce/undelivered-payment.js';

const NODE = 'node';
const ALICE = `alice@${NODE}`;
const BOB = `bob@${NODE}`;
const SELLER = `studio@${NODE}`;
const EXT = 'studiosubs';
const DAY = 86_400_000;
const KEY = `commerce.subscription.${EXT}.monthly`;
const config = { nodeId: NODE, commerceFeePercent: 0, baseUrl: 'https://node.test' } as unknown as AimeatConfig;
let storage: Storage;
let charges: Array<{ reference: string; trackingCode: string }> = [];
let refunds: string[] = [];
let refundAnswer: RefundOutcome = { outcome: 'refunded' };
/** Runs inside the charge, before it answers: the moment a cancel lands during a run. */
let duringCharge: ((reference: string) => Promise<void>) | null = null;
/** Runs when the renewal reads the extension, after allowRaisedPrice tested auto_renew. */
let duringPlanRead: (() => Promise<void>) | null = null;
/** The renewal reference whose period write fails (a storage fault after the card was charged). */
let failWriteOf: string | null = null;

const rec = (buyer: string, until: string) => ({
  ext: EXT, plan: 'monthly', title: 'Monthly', seller_ghii: SELLER, buyer_ghii: buyer, amount: 3_990_000, currency: 'EUR',
  period_days: 30, started_at: new Date(Date.now() - 28 * DAY).toISOString(), active_until: until, auto_renew: true,
  kept_payment: { handler: 'test.subs', customer: 'cus_1', payment_method: 'pm_1' }, updated_at: new Date().toISOString(),
});
const write = async (owner: string, key: string, value: unknown) => storage.setMemory({
  key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
const subOf = async (buyer: string) => (await storage.getMemory(buyer, KEY))?.value as Record<string, any>;
const reference = (buyer: string, until: string) => `subrenew:${buyer}:${EXT}:monthly:${until}`;
/** A daily run an hour and a minute later: a renewal claim older than its hold no longer stops a claim. */
const ageClaim = async (buyer: string) => {
  const row = await storage.getMemory(buyer, KEY);
  const v = row!.value as Record<string, any>;
  if (!v.renewing) return;
  await storage.setMemory({ ...row!, value: { ...v, renewing: { ...v.renewing, at: new Date(Date.now() - 61 * 60_000).toISOString() } }, version: row!.version + 1 });
};

beforeEach(async () => {
  charges = [];
  refunds = [];
  refundAnswer = { outcome: 'refunded' };
  duringCharge = null;
  duringPlanRead = null;
  failWriteOf = null;
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  const s = storage as unknown as Record<string, any>;
  s.getExtension = async (n: string) => {
    if (duringPlanRead) { const hook = duringPlanRead; duringPlanRead = null; await hook(); }
    return n === EXT ? { name: EXT, status: 'active', installedBy: 'studio', actions: [] } : null;
  };
  const setIfVersion = s.setMemoryIfVersion.bind(storage);
  s.setMemoryIfVersion = async (r: MemoryRecord, v: number) => {
    if (failWriteOf && r.key === KEY && (r.value as Record<string, unknown>)?.last_order === failWriteOf) throw new Error('storage fault');
    return setIfVersion(r, v);
  };
  resetPaymentHandlers();
  registerPaymentHandler({
    id: 'test.subs', title: 'subscription test money', currencies: ['EUR'],
    async collect() { throw new Error('not used'); },
    async payout() { /* nothing */ },
    async refund(_ctx: unknown, args: { trackingCode: string }) { refunds.push(args.trackingCode); return refundAnswer; },
    async chargeSaved(_ctx: unknown, args: { reference: string }) {
      if (duringCharge) { const hook = duringCharge; duringCharge = null; await hook(args.reference); }
      const trackingCode = `subs_${charges.length + 1}`;
      charges.push({ reference: args.reference, trackingCode });
      return { trackingCode };
    },
  } as never);
  await write(`ext:${EXT}`, PLANS_KEY, { plans: [{ id: 'monthly', title: 'Monthly', amount: 3_990_000, currency: 'EUR', period_days: 30 }] });
});

describe('a cancel stored during the daily run', () => {
  it('stops the renewal of the cancelled subscription; the other one in the same run renews once', async () => {
    const until = new Date(Date.now() + DAY).toISOString();
    await write(ALICE, KEY, rec(ALICE, until));
    await write(BOB, KEY, rec(BOB, until));
    // Whoever is charged first, the other buyer cancels while that charge is in progress.
    duringCharge = async (ref) => {
      const other = ref.startsWith(`subrenew:${ALICE}:`) ? BOB : ALICE;
      expect(await cancelSubscription(storage, other, EXT, 'monthly')).not.toBeNull();
    };
    const out = await runSubscriptionRenewals(storage, config);
    expect(charges.length).toBe(1);
    const first = charges[0].reference.startsWith(`subrenew:${ALICE}:`) ? ALICE : BOB;
    const cancelled = first === ALICE ? BOB : ALICE;
    expect(out.find(o => o.buyer === first)?.result).toBe('renewed');
    expect(out.find(o => o.buyer === cancelled)?.result).toBe('skipped');
    const kept = await subOf(cancelled);
    expect(kept.active_until).toBe(until);
    expect(kept.auto_renew).toBe(false);
    expect(kept.last_order).toBeUndefined();
    expect(Date.parse((await subOf(first)).active_until) - Date.parse(until)).toBe(30 * DAY);
  });

  it('a cancel that lands after the buyer allowed a raised price, before the charge, charges nothing', async () => {
    const until = new Date(Date.now() + DAY).toISOString();
    await write(ALICE, KEY, rec(ALICE, until));
    duringPlanRead = async () => { await cancelSubscription(storage, ALICE, EXT, 'monthly'); };
    const allowed = await allowRaisedPrice(storage, config, ALICE, { ext: EXT, plan: 'monthly', period: until, amount: 3_990_000, currency: 'EUR' });
    expect(allowed.ok && allowed.result).toBe('skipped');
    expect(charges.length).toBe(0);
    expect((await subOf(ALICE)).active_until).toBe(until);
  });

  it('a subscription nobody cancelled renews once, as before', async () => {
    const until = new Date(Date.now() + DAY).toISOString();
    await write(ALICE, KEY, rec(ALICE, until));
    expect((await runSubscriptionRenewals(storage, config))[0].result).toBe('renewed');
    expect(charges.length).toBe(1);
    expect(Date.parse((await subOf(ALICE)).active_until) - Date.parse(until)).toBe(30 * DAY);
    // The next period is not due yet, so the next run charges nothing.
    await runSubscriptionRenewals(storage, config);
    expect(charges.length).toBe(1);
  });
});

describe('a renewal charged whose period write failed', () => {
  it('refunds the charge; the period is free again, and the next run renews it', async () => {
    const until = new Date(Date.now() + DAY).toISOString();
    await write(ALICE, KEY, rec(ALICE, until));
    failWriteOf = reference(ALICE, until);
    expect((await runSubscriptionRenewals(storage, config))[0].result).toBe('failed');
    expect(charges.length).toBe(1);
    expect(refunds).toEqual([charges[0].trackingCode]);
    const after = await subOf(ALICE);
    expect(after.active_until).toBe(until);
    expect(after.renewing).toBeUndefined();
    expect(after.last_failure?.reason).toContain(until);
    failWriteOf = null;
    expect((await runSubscriptionRenewals(storage, config))[0].result).toBe('renewed');
    expect(charges.length).toBe(2);
    expect(Date.parse((await subOf(ALICE)).active_until) - Date.parse(until)).toBe(30 * DAY);
  });

  it('a refund that does not go through is kept for the seller, and no later run charges the period again', async () => {
    const until = new Date(Date.now() + DAY).toISOString();
    await write(ALICE, KEY, rec(ALICE, until));
    failWriteOf = reference(ALICE, until);
    refundAnswer = { outcome: 'not_possible', detail: 'this rail cannot return it' };
    expect((await runSubscriptionRenewals(storage, config))[0].result).toBe('failed');
    expect(charges.length).toBe(1);
    const kept = await storage.getMemory(SELLER, `${UNDELIVERED_PREFIX}${reference(ALICE, until)}`);
    expect(kept?.value).toMatchObject({ status: 'open', trackingCode: charges[0].trackingCode, refund: { outcome: 'not_possible' } });
    await ageClaim(ALICE);
    failWriteOf = null;
    const again = await runSubscriptionRenewals(storage, config);
    expect(again[0].result).toBe('skipped');
    expect(charges.length).toBe(1);
    expect((await subOf(ALICE)).active_until).toBe(until);
  });
});
