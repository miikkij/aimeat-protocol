/**
 * @file src/commerce/hold-book.ts
 * @description The hold lifecycle of the commerce core (TINKI phase 1): a hold is money
 *   authorized on the BUYER's instrument toward one SELLER without moving — the covered bid and
 *   the escrow-by-deferred-capture primitive. Created through a payment handler's `authorize`,
 *   settled with `capture` (seller only, up to the held amount) or cancelled with `release`
 *   (either party). Holds are memory records — `commerce.hold.{id}` under the buyer owner's GHII
 *   (authoritative) and a full mirror `commerce.hold-in.{id}` under the seller owner's GHII (their
 *   inbound view) — no storage-schema changes, same pattern as checkout sessions/orders. Expiry is
 *   lazy and SAFELY INSIDE Stripe's ~7-day uncaptured-intent window: an expired hold read flips to
 *   'expired' after a best-effort rail release.
 * @structure HoldRecord · createHold · getHold · listHolds · captureHold · releaseHold
 * @usage import { createHold, captureHold, releaseHold } from '../commerce/hold-book.js';
 * @version-history
 *   v1.0.0 — 2026-08-06 — Initial hold book (TINKI phase 1)
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PaymentContext, PaymentHandler } from './types.js';
import { getPaymentHandler } from './payment-handlers.js';
import { CommerceError } from './errors.js';
import { isMoneyCurrency } from './money.js';
import { STRIPE_HANDLER_ID } from './stripe-handler.js';
import { TEST_MONEY_HANDLER_ID } from './test-money-handler.js';
import { logger } from '../utils/logger.js';

/** Holds expire safely inside Stripe's ~7-day uncaptured-card-intent window. */
const HOLD_TTL_MS = 6 * 24 * 60 * 60 * 1000;

export interface HoldRecord {
  id: string;
  status: 'held' | 'captured' | 'released' | 'expired';
  /** Free-form purpose the caller tracks ('bid', 'deposit', …) — the book does not interpret it. */
  purpose: string;
  buyerOwner: string;
  buyerGhii: string;
  /** The acting principal at creation (owner GHII or agent GAII) for attribution. */
  buyerIdentity: string;
  sellerOwner: string;
  sellerGhii: string;
  /** Held amount in the session currency's 6-decimal micro-units. */
  amount: number;
  currency: string;
  /** Set on capture; ≤ amount (partial capture = Vickrey second price). */
  capturedAmount?: number;
  handler: string;
  trackingCode: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

const holdKey = (id: string) => `commerce.hold.${id}`;
const holdInKey = (id: string) => `commerce.hold-in.${id}`;

/** Upsert one memory record (same shape as every service-side writer in the codebase). */
async function putRecord(storage: Storage, ownerGaii: string, key: string, value: unknown): Promise<void> {
  const existing = await storage.getMemory(ownerGaii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii, value: value as Record<string, unknown>, visibility: 'owner', tags: ['commerce'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/** Write the hold to both sides (buyer authoritative + seller mirror). */
async function saveHold(storage: Storage, hold: HoldRecord): Promise<void> {
  await putRecord(storage, hold.buyerGhii, holdKey(hold.id), hold);
  await putRecord(storage, hold.sellerGhii, holdInKey(hold.id), hold);
}

/** The seller's PSP credentials ride to the handler exactly like sellables load them. */
async function sellerFor(storage: Storage, hold: Pick<HoldRecord, 'sellerGhii' | 'sellerOwner'>): Promise<{ ghii: string; owner: string; psp?: unknown }> {
  const pspRec = await storage.getMemory(hold.sellerGhii, 'commerce.psp');
  return { ghii: hold.sellerGhii, owner: hold.sellerOwner, psp: pspRec?.value };
}

/** Resolve a handler that can back holds for this currency, or throw a 422 naming the gap. */
function holdHandler(config: AimeatConfig, currency: string, handlerId?: string): PaymentHandler {
  const id = handlerId
    ?? (isMoneyCurrency(currency)
      ? (config.testMoneyHandler ? TEST_MONEY_HANDLER_ID : STRIPE_HANDLER_ID)
      : undefined);
  const handler = id ? getPaymentHandler(id) : undefined;
  if (!handler || !handler.currencies.includes(currency) || !handler.authorize || !handler.capture || !handler.release) {
    throw new CommerceError('HOLD_UNSUPPORTED', 422,
      `No hold-capable payment handler for currency "${currency}" — holds need a money rail with authorize/capture/release`);
  }
  return handler;
}

export async function createHold(storage: Storage, config: AimeatConfig, args: {
  buyerOwner: string;
  buyerIdentity: string;
  sellerOwner: string;
  amount: number;
  currency: string;
  purpose: string;
  reference: string;
  handlerId?: string;
  instrument?: unknown;
}): Promise<HoldRecord> {
  if (!Number.isFinite(args.amount) || args.amount <= 0) {
    throw new CommerceError('INVALID_AMOUNT', 422, 'Hold amount must be a positive number of micro-units');
  }
  const sellerGhii = await resolveSellerGhii(storage, config, args.sellerOwner);
  const buyerGhii = `${args.buyerOwner}@${config.nodeId}`;
  if (sellerGhii === buyerGhii) {
    throw new CommerceError('SELF_HOLD', 422, 'A hold toward yourself has no meaning');
  }
  const handler = holdHandler(config, args.currency, args.handlerId);
  const ctx: PaymentContext = { config, storage };
  const id = `hold-${randomUUID()}`;
  const seller = await sellerFor(storage, { sellerGhii, sellerOwner: args.sellerOwner });
  const { trackingCode } = await handler.authorize!(ctx, {
    buyerGhii, amount: args.amount, currency: args.currency,
    reference: args.reference, instrument: args.instrument, seller,
  });
  const now = new Date().toISOString();
  const hold: HoldRecord = {
    id, status: 'held', purpose: args.purpose,
    buyerOwner: args.buyerOwner, buyerGhii, buyerIdentity: args.buyerIdentity,
    sellerOwner: args.sellerOwner, sellerGhii,
    amount: args.amount, currency: args.currency,
    handler: handler.id, trackingCode, reference: args.reference,
    createdAt: now, updatedAt: now,
    expiresAt: new Date(Date.now() + HOLD_TTL_MS).toISOString(),
  };
  await saveHold(storage, hold);
  return hold;
}

/** The seller must exist on this node — a hold toward a name typo would strand money authorizations. */
async function resolveSellerGhii(storage: Storage, config: AimeatConfig, sellerOwner: string): Promise<string> {
  const ghii = await storage.getGHIIByOwner(sellerOwner);
  if (!ghii) throw new CommerceError('SELLER_NOT_FOUND', 404, `No such owner on this node: ${sellerOwner}`);
  return `${sellerOwner}@${config.nodeId}`;
}

/**
 * Read a hold as one of its parties. Callers outside the hold get NOT_FOUND (no existence leak).
 * Lazy expiry happens here: an overdue 'held' hold is released on the rail (best effort) and
 * flipped to 'expired' before being returned.
 */
export async function getHold(storage: Storage, config: AimeatConfig, callerOwner: string, id: string): Promise<HoldRecord> {
  const callerGhii = `${callerOwner}@${config.nodeId}`;
  const rec = await storage.getMemory(callerGhii, holdKey(id)) ?? await storage.getMemory(callerGhii, holdInKey(id));
  if (!rec) throw new CommerceError('HOLD_NOT_FOUND', 404, `No hold ${id} for this owner`);
  let hold = rec.value as unknown as HoldRecord;
  if (hold.status === 'held' && new Date(hold.expiresAt).getTime() < Date.now()) {
    hold = await transition(storage, config, hold, 'expire');
  }
  return hold;
}

/** List holds where the caller is buyer (default) or seller (side='seller'), newest first. */
export async function listHolds(storage: Storage, config: AimeatConfig, callerOwner: string, side: 'buyer' | 'seller', limit: number): Promise<HoldRecord[]> {
  const callerGhii = `${callerOwner}@${config.nodeId}`;
  const prefix = side === 'seller' ? 'commerce.hold-in.' : 'commerce.hold.';
  const { items } = await storage.listAllMemory({ prefix, ownerPrefix: callerGhii, limit });
  return items
    .map((r) => r.value as unknown as HoldRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Rail call + state flip + both-side save, shared by capture/release/expire. */
async function transition(storage: Storage, config: AimeatConfig, hold: HoldRecord, kind: 'capture' | 'release' | 'expire', amount?: number): Promise<HoldRecord> {
  const handler = getPaymentHandler(hold.handler);
  if (!handler) throw new CommerceError('HOLD_RAIL_GONE', 500, `Payment handler ${hold.handler} is not registered`);
  const ctx: PaymentContext = { config, storage };
  const seller = await sellerFor(storage, hold);
  if (kind === 'capture') {
    await handler.capture!(ctx, {
      amount: amount!, currency: hold.currency, trackingCode: hold.trackingCode,
      reference: hold.reference, seller,
    });
    hold.status = 'captured';
    hold.capturedAmount = amount!;
  } else {
    try {
      await handler.release!(ctx, { trackingCode: hold.trackingCode, seller });
    } catch (err) {
      // An expiry sweep tolerates a rail that already voided the authorization; an explicit
      // release does not — the caller deserves to know the rail refused.
      if (kind === 'release') throw err;
      logger.warn(`[holds] expiry release failed for ${hold.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    hold.status = kind === 'release' ? 'released' : 'expired';
  }
  hold.updatedAt = new Date().toISOString();
  await saveHold(storage, hold);
  return hold;
}

/** Capture: SELLER only, up to the held amount (partial = second price). */
export async function captureHold(storage: Storage, config: AimeatConfig, callerOwner: string, id: string, amount?: number): Promise<HoldRecord> {
  const hold = await getHold(storage, config, callerOwner, id);
  if (`${callerOwner}@${config.nodeId}` !== hold.sellerGhii) {
    throw new CommerceError('NOT_SELLER', 403, 'Only the seller may capture a hold');
  }
  if (hold.status !== 'held') {
    throw new CommerceError('HOLD_NOT_CAPTURABLE', 409, `Hold is ${hold.status}, not held`);
  }
  const captureAmount = amount ?? hold.amount;
  if (!Number.isFinite(captureAmount) || captureAmount <= 0 || captureAmount > hold.amount) {
    throw new CommerceError('CAPTURE_OVER_HELD', 422, `Capture must be within (0, ${hold.amount}] micro-units`);
  }
  return transition(storage, config, hold, 'capture', captureAmount);
}

/** Release: buyer or seller may cancel an open hold. */
export async function releaseHold(storage: Storage, config: AimeatConfig, callerOwner: string, id: string): Promise<HoldRecord> {
  const hold = await getHold(storage, config, callerOwner, id);
  const callerGhii = `${callerOwner}@${config.nodeId}`;
  if (callerGhii !== hold.buyerGhii && callerGhii !== hold.sellerGhii) {
    // getHold already gates this, but a second guard keeps the invariant local and testable.
    throw new CommerceError('HOLD_NOT_FOUND', 404, `No hold ${id} for this owner`);
  }
  if (hold.status !== 'held') {
    throw new CommerceError('HOLD_NOT_RELEASABLE', 409, `Hold is ${hold.status}, not held`);
  }
  return transition(storage, config, hold, 'release');
}
