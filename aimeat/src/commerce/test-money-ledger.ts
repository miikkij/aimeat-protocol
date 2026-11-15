/**
 * @file src/commerce/test-money-ledger.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The books the test money handler (`test.money`, commerce/test-money-handler.ts) keeps,
 *   the way a card provider keeps them for a real payment: per buyer instrument and currency the
 *   amounts CHARGED, HELD (authorized, not captured) and REFUNDED, and per payee (the seller's
 *   connected account) and currency the amount PAID OUT. With Stripe the provider keeps this account;
 *   without it no test could prove that a hold charged nothing, that a capture charged exactly the
 *   captured amount, that a release returned the hold, that a refund returned the payment or that a
 *   payout reached the seller.
 *
 *   THE ACCOUNT KEY. A buyer's account is the instrument string the payment names
 *   (`payment.instrument`, which authorize requires), and the buyer's GHII when a collect names none.
 *   A charge of a saved method is booked on the saved method's name, which collect sets to the
 *   instrument. A refund is booked on the account of the charge it reverses (found by tracking code),
 *   and on the buyer's GHII when no charge is booked for that code.
 *
 *   WHERE IT LIVES. In storage, as memory records under the node's own `system@<node>` owner, like the
 *   hold book keeps its holds (commerce/hold-book.ts), so every process over one database books and
 *   reads the same account, and each node of a suite that starts several nodes in one process keeps
 *   its own books (ctx.storage). Two kinds of record:
 *   - `commerce.test-money.entry.<id>`: one per movement, append-only, holding the signed change of
 *     each amount. A collect's entry id is derived from its tracking code, so a collect answered with
 *     the same tracking code again (the "replay" instrument, a hosted card page read back) books one
 *     charge, as the provider has one payment.
 *   - `commerce.test-money.hold.<tracking code>`: the state of one hold, written on its version, so two
 *     captures of one hold cannot both succeed.
 *   The ledger is the sum of the entries.
 *
 *   HOW IT GOES STALE. Every record carries a 30-day TTL and the memory TTL sweep removes it, so a node
 *   that runs test money for a while does not keep every test payment. A test reads the change across
 *   its own calls.
 * @structure LEDGER_OWNER · accountOf · bookCharge · bookHold · bookCapture · bookRelease · bookRefund ·
 *   bookPayout · readLedger
 * @usage const ledger = await readLedger(storage, config, { instrument: 'pm_test_hold' });
 * @version-history
 *   2026-11-15 — Initial (test money keeps the books a real payment provider keeps; audit M139).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { listAllMemoryPages } from '../storage/memory-pages.js';
import { updateRecord } from '../services/record-cas.js';
import { PaymentError } from './payment-handlers.js';

const ENTRY_PREFIX = 'commerce.test-money.entry.';
const HOLD_PREFIX = 'commerce.test-money.hold.';
const TTL_HOURS = 30 * 24;
const TAG = 'commerce';
/** The most entries one read sums; past it the answer says `complete: false`. */
const READ_CEILING = 50_000;

/** The node's own owner the books are kept under. */
export const LEDGER_OWNER = (config: Pick<AimeatConfig, 'nodeId'>): string => `system@${config.nodeId}`;

/** One movement: the signed change of each amount it touched. */
interface Entry {
  kind: 'charge' | 'hold' | 'capture' | 'release' | 'refund' | 'payout';
  /** The buyer's account (instrument or GHII); absent on a payout. */
  account?: string;
  /** The payee's GHII; only on a payout. */
  payee?: string;
  currency: string;
  charged?: number;
  held?: number;
  refunded?: number;
  paid_out?: number;
  tracking_code: string;
  at: string;
}

interface HoldState { amount: number; currency: string; account: string; state: 'held' | 'captured' | 'released'; captured?: number }

/** The buyer's account a collect or authorize books on. */
export function accountOf(instrument: unknown, buyerGhii: string): string {
  return typeof instrument === 'string' && instrument ? instrument : buyerGhii;
}

const chargeEntryKey = (trackingCode: string) =>
  `${ENTRY_PREFIX}charge-${createHash('sha256').update(trackingCode).digest('hex').slice(0, 32)}`;

function record(config: Pick<AimeatConfig, 'nodeId'>, key: string, value: unknown) {
  const now = new Date().toISOString();
  return {
    key, ownerGaii: LEDGER_OWNER(config), value: value as Record<string, unknown>, visibility: 'private' as const,
    tags: [TAG], ttlHours: TTL_HOURS, version: 1, createdAt: now, updatedAt: now,
  };
}

async function addEntry(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, entry: Omit<Entry, 'at'>): Promise<void> {
  await storage.setMemory(record(config, `${ENTRY_PREFIX}${randomUUID()}`, { ...entry, at: new Date().toISOString() }));
}

/** A collect or a saved-method charge: adds to charged, once per tracking code. */
export async function bookCharge(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, args: {
  account: string; amount: number; currency: string; trackingCode: string;
}): Promise<void> {
  const entry: Entry = {
    kind: 'charge', account: args.account, currency: args.currency, charged: args.amount,
    tracking_code: args.trackingCode, at: new Date().toISOString(),
  };
  await storage.createMemoryIfAbsent(record(config, chargeEntryKey(args.trackingCode), entry));
}

/** An authorize: the hold's state, and held grows; nothing is charged. */
export async function bookHold(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, args: {
  account: string; amount: number; currency: string; trackingCode: string;
}): Promise<void> {
  const hold: HoldState = { amount: args.amount, currency: args.currency, account: args.account, state: 'held' };
  await storage.setMemory(record(config, `${HOLD_PREFIX}${args.trackingCode}`, hold));
  await addEntry(storage, config, { kind: 'hold', account: args.account, currency: args.currency, held: args.amount, tracking_code: args.trackingCode });
}

/** Moves one hold out of `held`, or throws the PaymentError the rail answers. Answers the hold as it was. */
async function closeHold(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, trackingCode: string,
  close: (hold: HoldState | null) => HoldState,
): Promise<HoldState> {
  const seen: { hold?: HoldState } = {};
  await updateRecord<HoldState | null>(storage, LEDGER_OWNER(config), `${HOLD_PREFIX}${trackingCode}`,
    (v) => (v && typeof v === 'object' ? v as HoldState : null),
    (cur) => { const next = close(cur); seen.hold = cur!; return next; },
    { tag: TAG, ttlHours: TTL_HOURS });
  return seen.hold!;
}

/**
 * A capture: the whole hold leaves held and the captured amount is charged; a partial capture
 * releases the rest, as Stripe does. Throws HOLD_NOT_CAPTURABLE / CAPTURE_OVER_HELD.
 */
export async function bookCapture(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, args: { trackingCode: string; amount: number }): Promise<void> {
  const hold = await closeHold(storage, config, args.trackingCode, (cur) => {
    if (!cur || cur.state !== 'held') {
      throw new PaymentError('HOLD_NOT_CAPTURABLE', 409, `Hold ${args.trackingCode} is not in a capturable state`);
    }
    if (args.amount > cur.amount) {
      throw new PaymentError('CAPTURE_OVER_HELD', 422, `Capture ${args.amount} exceeds held ${cur.amount}`);
    }
    return { ...cur, state: 'captured', captured: args.amount };
  });
  await addEntry(storage, config, {
    kind: 'capture', account: hold.account, currency: hold.currency, held: -hold.amount, charged: args.amount, tracking_code: args.trackingCode,
  });
}

/** A release: the hold leaves held and nothing is charged. Throws HOLD_NOT_RELEASABLE. */
export async function bookRelease(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, args: { trackingCode: string }): Promise<void> {
  const hold = await closeHold(storage, config, args.trackingCode, (cur) => {
    if (!cur || cur.state !== 'held') {
      throw new PaymentError('HOLD_NOT_RELEASABLE', 409, `Hold ${args.trackingCode} is not in a releasable state`);
    }
    return { ...cur, state: 'released' };
  });
  await addEntry(storage, config, {
    kind: 'release', account: hold.account, currency: hold.currency, held: -hold.amount, tracking_code: args.trackingCode,
  });
}

/** A refund the rail made: refunded grows on the account of the charge it reverses. */
export async function bookRefund(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, args: {
  buyerGhii: string; amount: number; trackingCode: string;
}): Promise<void> {
  const charge = (await storage.getMemory(LEDGER_OWNER(config), chargeEntryKey(args.trackingCode)))?.value as Entry | undefined;
  await addEntry(storage, config, {
    kind: 'refund', account: charge?.account ?? args.buyerGhii, currency: charge?.currency ?? 'unknown',
    refunded: args.amount, tracking_code: args.trackingCode,
  });
}

/** A payout: paid out grows on the payee's account. */
export async function bookPayout(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, args: {
  toGhii: string; amount: number; currency: string; trackingCode: string;
}): Promise<void> {
  await addEntry(storage, config, { kind: 'payout', payee: args.toGhii, currency: args.currency, paid_out: args.amount, tracking_code: args.trackingCode });
}

export interface TestMoneyLedger {
  instruments: Array<{ instrument: string; currency: string; charged: number; held: number; refunded: number }>;
  sellers: Array<{ seller: string; currency: string; paid_out: number }>;
  /** False when the node holds more entries than one read sums. */
  complete: boolean;
}

/** The sum of the entries, optionally for one instrument and/or one seller. */
export async function readLedger(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, filter: { instrument?: string; seller?: string } = {}): Promise<TestMoneyLedger> {
  const { items, complete } = await listAllMemoryPages(storage, { prefix: ENTRY_PREFIX, ownerPrefix: LEDGER_OWNER(config) }, undefined, READ_CEILING);
  const buyers = new Map<string, TestMoneyLedger['instruments'][number]>();
  const payees = new Map<string, TestMoneyLedger['sellers'][number]>();
  for (const rec of items) {
    if (rec.ownerGaii !== LEDGER_OWNER(config)) continue;
    const e = rec.value as unknown as Entry;
    if (e.account !== undefined && (filter.instrument === undefined || e.account === filter.instrument)) {
      const k = `${e.account}\u0000${e.currency}`;
      const row = buyers.get(k) ?? { instrument: e.account, currency: e.currency, charged: 0, held: 0, refunded: 0 };
      row.charged += e.charged ?? 0;
      row.held += e.held ?? 0;
      row.refunded += e.refunded ?? 0;
      buyers.set(k, row);
    }
    if (e.payee !== undefined && (filter.seller === undefined || e.payee === filter.seller)) {
      const k = `${e.payee}\u0000${e.currency}`;
      const row = payees.get(k) ?? { seller: e.payee, currency: e.currency, paid_out: 0 };
      row.paid_out += e.paid_out ?? 0;
      payees.set(k, row);
    }
  }
  const byName = <T>(key: (t: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));
  return {
    instruments: filter.seller !== undefined && filter.instrument === undefined ? [] : [...buyers.values()].sort(byName(r => `${r.instrument} ${r.currency}`)),
    sellers: filter.instrument !== undefined && filter.seller === undefined ? [] : [...payees.values()].sort(byName(r => `${r.seller} ${r.currency}`)),
    complete,
  };
}
