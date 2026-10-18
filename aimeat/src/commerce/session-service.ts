/**
 * @file src/commerce/session-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The checkout-session lifecycle of the commerce core (TARGET-033): resolve line
 *   items through the sellable-resolver registry (agent offers in core, org offerings in EE),
 *   create/read/update/cancel sessions, and complete a session — charge the pacing amount in
 *   morsels → collect the money total from the buyer through a money handler (none when free) →
 *   fulfill each line item as an agent TASK on the offer-ask path → pay out per item (default
 *   seller payout, or the sellable's custom distribute e.g. EE commission split) → record the
 *   operator's money fee → close. A fulfillment failure after collect asks the handler to refund
 *   and rethrows with a message that says what the refund did, leaving the session open for retry;
 *   a payment taken and not returned is recorded for the seller (undelivered-payment.ts). Sessions are memory records — `commerce.session.{id}`
 *   under the buyer owner's GHII, `commerce.order.{id}` under the seller owner's GHII — no
 *   storage-schema changes.
 * @structure CommerceError (re-export) · createSession · getSession · listSessions · listOrders ·
 *   updateSessionItems · cancelSession · completeSession
 * @usage import { createSession, completeSession } from '../commerce/session-service.js';
 * @version-history
 *   2026-10-16 — meteredCoordinateOf moved to commerce/metered-coordinate.ts, unchanged, to keep this file under 800 lines.
 *   2026-10-16 — A failed fulfilment after the collect words the buyer's message from the refund's outcome: only a refund the rail confirmed says "refunded"; a payment taken and not returned (x402, a failed Stripe refund) says so, names the checkout reference, and is stored as `commerce.undelivered.{id}` under the seller, logged and told to the operator (QA audit F5-01, F7e-01, S8-05).
 *   2026-10-16 — completeSession claims the session (open → completing, compare-and-swap) before the
 *     pacing and the collect, puts it back on a refusal, and records the collected tracking code
 *     before fulfilment (QA audit S8-04); the invoice rail is refused for a line delivered at once
 *     unless the seller gives that credit (INVOICE_NOT_ACCEPTED, QA audit S8-03). Both in session-claim.ts.
 *   2026-10-15 — A fulfilment that refuses on a limit (CommerceError 429, e.g. PACING_PACK_CAP) is refunded and answered with its own code and status, not 502 FULFILLMENT_FAILED (feature-list audit #137).
 *   v3.1.0 — 2026-10-14 — Completion compares each line's quote with the live price and the session
 *     total with the sum of its lines before charging, and refuses a difference with 409
 *     PRICE_CHANGED (the session stays open). The record itself is service-owned now
 *     (utils/reserved-keys.ts), so no memory route writes it (QA audit 2026-10-14, K4).
 *   v3.0.0 — 2026-10-11 — Money price and pacing amount (decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa): a session is always in a money currency (0 = free) and carries `pacingMorsels`; completion charges the pacing first (chargePacing: burn share, operator share, provider credit), needs a money handler only for a money total, and puts `pacing` on the receipt. No morsel handler; an open 'morsel' session from before is refused with SESSION_REPRICED.
 *   v2.10.0 — 2026-10-09 — The seller's order copy carries each line's sellerResult where a fulfilment
 *     gives one, so an ext-call's one-time pay token stays with the buyer (secrets audit 2026-10-09, S-3).
 *   v2.9.0 — 2026-10-08 — A session carries its attribution (where the checkout came from), and a
 *     completed one is counted for the seller under it (services/visibility/, AI visibility layer A).
 *   v2.8.0 — 2026-10-05 — An agent's amount is reserved against its daily limit in one compare-and-swap
 *     right before the collect, and released when the collect fails or the fulfilment is refunded
 *     (secaudit 2026-10, PKG-6).
 *   v2.7.0 — 2026-10-02 — A line whose buyer turned automatic renewal on asks the handler to keep the
 *     payment method (`saveForLater`), and the fulfilment sees what was kept (package sale design).
 *   v2.6.0 — 2026-10-02 — An agent pays money only within the daily purchase limit its owner set on
 *     its card (agent-purchase-limit.ts): refused before the collect, counted after the completion.
 *     The caller now carries `sub`, the principal the limit is about.
 *   v2.5.1 — 2026-09-26 — The buyer and seller names on the payment rows come from localAccountName
 *     (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local
 *     namesake (secaudit 2026-09, F-1).
 *   v2.5.0 — 2026-09-01 — `bookSessionlessSale`: the seller's fee and split legs for a MONEY sale
 *     with no checkout session behind it, which is what a buyer from another node makes over the
 *     A2A door. Same rate, same two functions, placed beside the leg it must stay in step with.
 *   v2.4.0 — 2026-08-29 — A money platform fee is always booked `receivable`. The Stripe branch wrote
 *     `connect`, which named the EE Connect platform removed on 2026-07-28: with the seller as
 *     merchant of record on their own key, nothing deducts the fee from the charge, so the label told
 *     the operator's dashboard the money had been collected when it had only been earned. Found while
 *     auditing the legal texts, where the same stale model had reached the operator's own
 *     understanding of where the 2 % goes. No stored record changes meaning: nothing reads `mode`.
 *   v2.3.0 — 2026-08-10 — Security audit H-3: completeSession asks appSpendRefusal before collecting.
 *     It is the one place money leaves the buyer, and all four completion doors (REST, UCP, ACP, MCP)
 *     reached handler.collect() without the spend scope or the per-app ceiling ever being checked.
 *   v2.2.0 — 2026-07-14 — createFulfillmentTask extracted to fulfillment.ts so the app-tool task
 *     path shares it (TARGET-034 phase B)
 *   v2.1.0 — 2026-07-14 — Fulfill seam: a sellable's custom fulfill() (app-tool capability invoke)
 *     replaces the default TASK path per item; caller JWT threaded from the completing adapter;
 *     app/input persisted on line items (TARGET-034 phase A)
 *   v2.0.1 — 2026-07-14 — Fee rounding through the money.ts chokepoint (percentFee)
 *   v2.0.0 — 2026-07-13 — Resolver registry + collect/payout orchestration + distribute seam (phase 4)
 *   v1.0.0 — 2026-07-13 — Initial session service (TARGET-033 phase 1)
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CheckoutSessionRecord, CheckoutLineItem, Sellable, PaymentContext, PaymentHandler, CheckoutAttribution, RefundOutcome } from './types.js';
import { meteredCoordinateOf } from './metered-coordinate.js';
import { refundCollected, refundSentence, recordUndeliveredPayment } from './undelivered-payment.js';
import { getPaymentHandler, listPaymentHandlers, LEGACY_MORSEL_HANDLER_ID } from './payment-handlers.js';
import { chargePacing, pacingReceipt } from '../services/metered-settlement.js';
import { insufficientMorselsMessage } from './pacing-pack.js';
import { putRecord, recordMoneyPlatformFee } from './platform-fee.js';
import { getSellableResolver, type SellableRef } from './sellable-resolvers.js';
import { CommerceError } from './errors.js';
import { createFulfillmentTask } from './fulfillment.js';
import { commerceFeePercent } from '../services/marketplace-fee.js';
import { appSpendRefusal } from '../services/metered-access.js';
import { isMoneyCurrency, percentFee, MONEY_CURRENCIES } from './money.js';
import { recordAccountEvent } from '../services/account-events.js';
import { logger } from '../utils/logger.js';
import { readSplit, computeSplit, type DynamicDesignation } from './beneficiary-split.js';
import { bookBeneficiaryShares } from './beneficiary-book.js';
import { takeDesignations } from './beneficiary-designation.js';
import { emitChange } from '../services/event-bus.js';
import { localAccountName } from '../utils/gaii.js';
import { agentPurchaseRefusal, reserveAgentPurchase, releaseAgentPurchase } from './agent-purchase-limit.js';
import { recordPurchase, recordCheckoutStage } from '../services/visibility/visibility-counter.js';
import { claimSessionForCompletion, releaseSessionClaim, recordCollected, invoiceRailRefusal } from './session-claim.js';

export { CommerceError } from './errors.js';
// Moved to platform-fee.ts (2026-10-11); re-exported for the callers that import it from here.
export { recordMoneyPlatformFee } from './platform-fee.js';

/** Lifetime of an open session (lazy expiry — checked on read and on complete). */
const sessionTtlMs = (config: AimeatConfig) => (config.commerceSessionTtlMinutes || 60) * 60 * 1000;

const sessionKey = (id: string) => `commerce.session.${id}`;
const orderKey = (id: string) => `commerce.order.${id}`;

/** Resolve one raw ref through the registry (kind defaults to 'offer'). */
async function resolveOne(storage: Storage, config: AimeatConfig, ref: SellableRef, buyerOwner: string): Promise<Sellable> {
  const kind = ref.kind ?? 'offer';
  const resolver = getSellableResolver(kind);
  if (!resolver) throw new CommerceError('UNKNOWN_ITEM_KIND', 422, `No sellable resolver for kind: ${kind}`);
  return resolver.resolve(storage, config, ref, buyerOwner);
}

/** Resolve raw items, enforce the single-seller rule, and price the lines. */
async function resolveItems(
  storage: Storage,
  config: AimeatConfig,
  rawItems: SellableRef[],
  buyerOwner: string,
  currency: string,
): Promise<{ items: CheckoutLineItem[]; sellerOwner: string; sellerGhii: string; total: number; pacing: number }> {
  if (!rawItems.length) throw new CommerceError('EMPTY_CART', 400, 'A checkout session needs at least one line item');
  const items: CheckoutLineItem[] = [];
  let sellerOwner = '';
  let sellerGhii = '';
  let total = 0;
  let pacing = 0;
  for (const raw of rawItems) {
    const quantity = Math.max(1, Math.trunc(raw.quantity ?? 1));
    const sellable = await resolveOne(storage, config, { ...raw, currency }, buyerOwner);
    if (!sellerOwner) { sellerOwner = sellable.sellerOwner; sellerGhii = sellable.sellerGhii; }
    else if (sellerOwner !== sellable.sellerOwner) {
      throw new CommerceError('MULTI_SELLER_CART', 422, 'All line items in one checkout session must belong to the same seller');
    }
    items.push({
      kind: sellable.kind, agent: sellable.agentGaii, offerId: sellable.offerId,
      app: raw.app, input: raw.input,
      quantity, title: sellable.title, unitPrice: sellable.unitPrice, tollMorsels: sellable.tollMorsels,
    });
    total += sellable.unitPrice * quantity;
    pacing += sellable.tollMorsels * quantity;
  }
  return { items, sellerOwner, sellerGhii, total, pacing };
}

/**
 * The amount as a feed row shows it. Money is 6-decimal micros here, and a row that said "24900000"
 * would be worse than no row. A free session says so, with its pacing.
 */
function formatCheckoutAmount(total: number, currency: string, pacing: number): string {
  const paced = pacing > 0 ? ` · pacing ${pacing} morsels` : '';
  if (total <= 0) return `free${paced}`;
  return `${(total / 1_000_000).toFixed(2)} ${currency.toUpperCase()}${paced}`;
}

/**
 * Price the cart in the requested money currency, or, when none was named (or the deprecated
 * 'morsel'), in the first money currency every line can be priced in. Free lines price at 0 in any.
 */
async function resolveInSomeCurrency(
  storage: Storage, config: AimeatConfig, rawItems: SellableRef[], buyerOwner: string, requested: string | undefined,
): Promise<Awaited<ReturnType<typeof resolveItems>> & { currency: string }> {
  if (requested && requested.toLowerCase() !== 'morsel') {
    return { ...await resolveItems(storage, config, rawItems, buyerOwner, requested), currency: requested };
  }
  let lastErr: unknown = null;
  for (const currency of MONEY_CURRENCIES) {
    try {
      return { ...await resolveItems(storage, config, rawItems, buyerOwner, currency), currency };
    } catch (err) {
      if (!(err instanceof CommerceError) || err.code !== 'CURRENCY_NOT_SUPPORTED') throw err;
      lastErr = err;
    }
  }
  throw lastErr ?? new CommerceError('CURRENCY_NOT_SUPPORTED', 422, 'These items share no money currency');
}

export async function createSession(
  storage: Storage,
  config: AimeatConfig,
  args: {
    buyerOwner: string;
    buyerIdentity: string;
    items: SellableRef[];
    note?: string;
    /**
     * A money code. Absent, or the 'morsel' a 3.x client may still send (deprecated until 4.0.0):
     * the first money currency every line can be priced in; a cart of free items is priced at 0 EUR.
     */
    currency?: string;
    /** Where the checkout came from (services/visibility/attribution.ts). */
    attribution?: CheckoutAttribution;
    /** Refuse, before anything is stored, a line with no money price (the ACP and UCP surfaces). */
    requireMoney?: boolean;
  },
): Promise<CheckoutSessionRecord> {
  const resolved = await resolveInSomeCurrency(storage, config, args.items, args.buyerOwner, args.currency);
  const { items, sellerOwner, sellerGhii, total, pacing, currency } = resolved;
  if (args.requireMoney && items.some(i => i.unitPrice <= 0)) {
    throw new CommerceError('MONEY_PRICE_REQUIRED', 422,
      'ACP and UCP sell in money, and a morsel is not a currency. These items have no money price, so they are not sold through this checkout.');
  }
  const now = new Date();
  const session: CheckoutSessionRecord = {
    id: `cs_${randomUUID()}`,
    status: 'open',
    buyerOwner: args.buyerOwner,
    buyerGhii: `${args.buyerOwner}@${config.nodeId}`,
    buyerIdentity: args.buyerIdentity,
    sellerOwner, sellerGhii,
    items, currency, total,
    ...(pacing > 0 ? { pacingMorsels: pacing } : {}),
    note: args.note,
    ...(args.attribution ? { attribution: args.attribution } : {}),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + sessionTtlMs(config)).toISOString(),
  };
  await putRecord(storage, session.buyerGhii, sessionKey(session.id), session);
  agentStage(storage, config, session, 'created');
  return session;
}

/**
 * Count one stage of an AI agent's checkout for the seller (AI visibility, layer C): where agents'
 * checkouts stop. A person's checkout is not counted here. Never throws.
 */
function agentStage(
  storage: Storage, config: AimeatConfig | undefined, session: CheckoutSessionRecord,
  stage: 'created' | 'updated' | 'completed' | 'canceled' | 'expired' | 'failed', code?: string,
): void {
  if (!config || session.attribution?.via !== 'agent') return;
  recordCheckoutStage(storage, config, { sellerGhii: session.sellerGhii, family: session.attribution.family, stage, code });
}

/**
 * Read a session; lazily flip an overdue `open` session to `expired` (persisted). With `config`, an
 * agent's checkout that expired is counted for the seller.
 */
export async function getSession(
  storage: Storage,
  buyerGhii: string,
  id: string,
  config?: AimeatConfig,
): Promise<CheckoutSessionRecord | null> {
  const rec = await storage.getMemory(buyerGhii, sessionKey(id));
  if (!rec) return null;
  const session = rec.value as unknown as CheckoutSessionRecord;
  if (session.status === 'open' && Date.now() > new Date(session.expiresAt).getTime()) {
    session.status = 'expired';
    session.updatedAt = new Date().toISOString();
    await putRecord(storage, buyerGhii, sessionKey(id), session);
    agentStage(storage, config, session, 'expired');
  }
  return session;
}

/** The buyer's sessions, newest first (lazy expiry NOT applied here — status shown as stored). */
export async function listSessions(storage: Storage, buyerGhii: string, limit = 50): Promise<CheckoutSessionRecord[]> {
  const { items } = await storage.listAllMemory({ prefix: 'commerce.session.', ownerPrefix: buyerGhii, limit });
  return items
    .map((r) => r.value as unknown as CheckoutSessionRecord)
    .filter((s) => s && s.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The seller's received orders (completed sessions mirrored under their GHII), newest first. */
export async function listOrders(storage: Storage, sellerGhii: string, limit = 50): Promise<CheckoutSessionRecord[]> {
  const { items } = await storage.listAllMemory({ prefix: 'commerce.order.', ownerPrefix: sellerGhii, limit });
  return items
    .map((r) => r.value as unknown as CheckoutSessionRecord)
    .filter((s) => s && s.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The seller's side of a MONEY sale that has no checkout session behind it.
 *
 * THE FEE IS A PROPERTY OF THE TRANSACTION, NOT OF THE BUYER'S ACCOUNT. The checkout session is
 * where the local path happens to book it; it is not what makes it legitimate. A sale over the A2A
 * door is made by a party with no account here and therefore no session, and charging it nothing
 * would turn "have no account here" into the cheapest way to buy — which is the incentive this
 * product least wants to create.
 *
 * SO IT IS THE SAME RATE, FROM THE SAME PLACE. `commerceFeePercent(config)` and `percentFee` are the
 * two the checkout path calls, called here for the same reason: a second formula is a second rate
 * the day somebody edits one of them. `test/unit/fee-parity.test.ts` asserts the two roads produce
 * the same number for the same amount.
 *
 * IT LIVES BESIDE `completeSession`'s fee leg on purpose. These two must stay in step, and the way
 * to make that likely is for a reader changing one to have the other on the screen.
 *
 * `buyerRef` is a GHII on every local path and a foreign agent's own identity on the A2A one. It is
 * RECORDED, never resolved: this function must not be the place that quietly invents a local
 * account for a party that does not have one.
 *
 * Never throws. The money has already moved and the buyer already has what they paid for; a
 * bookkeeping failure is logged, not turned into a failed sale.
 */
export async function bookSessionlessSale(
  storage: Storage,
  config: AimeatConfig,
  args: {
    gross: number; currency: string;
    sellerGhii: string; buyerRef: string;
    /** The metered coordinate the sale happened at — what the seller's split is keyed to. */
    ext: string; action: string;
    trackingCode: string; handler: string; reference: string;
  },
): Promise<{ fee: number; net: number }> {
  const fee = percentFee(args.gross, commerceFeePercent(config));
  const net = args.gross - fee;
  try {
    // MONEY ONLY, like the checkout leg beside it: morsels pace usage, they are not revenue, and a
    // fraction of them is not a share. A morsel-priced sale cannot reach this road anyway — the A2A
    // door refuses one outright — so this is the guard staying true rather than a live branch.
    if (!isMoneyCurrency(args.currency)) return { fee: 0, net: args.gross };
    if (fee > 0) {
      await recordMoneyPlatformFee(storage, config, {
        fee, currency: args.currency, sellerGhii: args.sellerGhii,
        buyerGhii: args.buyerRef, trackingCode: args.trackingCode, handler: args.handler,
      });
    }
    // Then whoever the seller owes a share of their cut. Out of the seller's NET, never added to
    // what the buyer paid — identical to both the checkout and the contracted paths.
    if (net > 0) {
      const split = await readSplit(storage, args.sellerGhii, args.ext, args.action);
      const result = computeSplit(net, split, []);
      if (result.lines.length) {
        await bookBeneficiaryShares(storage, {
          lines: result.lines,
          trackingCode: `a2a_${args.trackingCode}_${args.action}`,
          fromGhii: args.sellerGhii,
          currency: args.currency,
          buyerGhii: args.buyerRef,
          reference: args.reference,
        });
      }
    }
  } catch (err) {
    logger.error('[commerce] sessionless sale bookkeeping failed; the seller keeps the whole cut', {
      seller: args.sellerGhii, trackingCode: args.trackingCode, error: String(err),
    });
  }
  return { fee, net };
}

/** The money handler that completes a session with a money total: the one named, settling its currency. */
function moneyHandler(session: CheckoutSessionRecord, handlerId: string | undefined): PaymentHandler {
  if (!handlerId || handlerId === LEGACY_MORSEL_HANDLER_ID) {
    const choices = listPaymentHandlers().filter(h => h.currencies.includes(session.currency)).map(h => h.id);
    throw new CommerceError('PAYMENT_HANDLER_REQUIRED', 422,
      `Name the payment handler for this ${session.currency} session (payment.handler)${choices.length ? `: ${choices.join(', ')}` : ''}.`);
  }
  const handler = getPaymentHandler(handlerId);
  if (!handler) throw new CommerceError('UNKNOWN_PAYMENT_HANDLER', 422, `Payment handler not available on this node: ${handlerId}`);
  if (!handler.currencies.includes(session.currency)) {
    throw new CommerceError('CURRENCY_MISMATCH', 422, `Handler ${handler.id} does not settle ${session.currency}`);
  }
  return handler;
}

/**
 * An open session stored before 2026-10-11 in currency 'morsel' quotes a morsel PRICE, which no longer
 * exists. It cannot be completed or changed as it stands; the buyer opens a new one, priced as money
 * and pacing. Such a session lives an hour at most, so this is a short window, not a migration.
 */
function legacyMorselSessionRefusal(session: CheckoutSessionRecord): void {
  if (session.currency === 'morsel') {
    throw new CommerceError('SESSION_REPRICED', 409,
      'This checkout was opened when morsels were a price. A morsel is pacing now, not a price: open a new checkout for the same items.');
  }
}

function requireOpen(session: CheckoutSessionRecord): void {
  if (session.status !== 'open') {
    throw new CommerceError('SESSION_NOT_OPEN', 409, `Checkout session is ${session.status}; only open sessions can change`);
  }
}

export async function updateSessionItems(
  storage: Storage,
  config: AimeatConfig,
  session: CheckoutSessionRecord,
  rawItems: SellableRef[],
): Promise<CheckoutSessionRecord> {
  requireOpen(session);
  legacyMorselSessionRefusal(session);
  const { items, sellerOwner, sellerGhii, total, pacing } = await resolveItems(storage, config, rawItems, session.buyerOwner, session.currency);
  const updated: CheckoutSessionRecord = {
    ...session, items, sellerOwner, sellerGhii, total, pacingMorsels: pacing, updatedAt: new Date().toISOString(),
  };
  await putRecord(storage, session.buyerGhii, sessionKey(session.id), updated);
  agentStage(storage, config, updated, 'updated');
  return updated;
}

/** Cancel an open session. With `config`, an agent's cancel is counted for the seller as abandoned. */
export async function cancelSession(
  storage: Storage,
  session: CheckoutSessionRecord,
  config?: AimeatConfig,
): Promise<CheckoutSessionRecord> {
  requireOpen(session);
  const updated: CheckoutSessionRecord = { ...session, status: 'cancelled', updatedAt: new Date().toISOString() };
  // Only the buyer. A cancelled checkout never reached the seller as anything but an open session,
  // so telling them one was abandoned would report a non-event on somebody else's account.
  void recordAccountEvent(storage, {
    ownerGhii: session.buyerGhii, kind: 'checkout_cancelled', actorGaii: session.buyerGhii,
    subject: session.id,
    data: { what: session.items.map(i => i.title).filter(Boolean).join(', ').slice(0, 120) },
  });
  await putRecord(storage, session.buyerGhii, sessionKey(session.id), updated);
  agentStage(storage, config, updated, 'canceled');
  return updated;
}

/**
 * Complete a session: collect the gross → fulfill (TASK per line item) → per-item payouts
 * (default seller payout, or the sellable's custom distribute) → fee leg → seller order copy →
 * close. A fulfillment failure after a successful collect refunds through the same handler and
 * rethrows, leaving the session open for retry. Payout/fee legs run after fulfillment and are
 * best-effort ordered — the buyer's money moves exactly once.
 */
/**
 * Book the seller's beneficiary shares for one settled checkout line.
 *
 * THE SAME SPLIT AS A CONTRACTED CALL. A buyer can reach a priced capability two ways: by holding an
 * EXCHANGE contract, or by paying for it once through a checkout. Both are sales, both hand the
 * seller their cut, and a split declared on the coordinate has to apply to both — otherwise a
 * provider who promised a company a share of every lookup quietly stops paying it the moment
 * somebody buys the same lookup through the other route.
 *
 * `net` is what the seller actually received, after the platform fee, so the share is a percentage
 * of their real revenue rather than of the buyer's gross. Money only: morsels are the pacing meter
 * and are never shared.
 *
 * Never throws: the money has already moved and the buyer already has their answer. A bookkeeping
 * failure is logged, not turned into a failed purchase.
 */
async function bookCheckoutBeneficiaries(
  ctx: PaymentContext,
  args: {
    sellable: Sellable; session: CheckoutSessionRecord; net: number;
    trackingCode: string; designations: DynamicDesignation[];
  },
): Promise<void> {
  if (args.net <= 0) return;
  // MONEY ONLY. Morsels pace usage; they are not revenue and a fraction of them is not a share, so
  // a morsel-priced checkout line books nothing here, exactly as a morsel-priced contract does not.
  if (!isMoneyCurrency(args.session.currency)) return;
  const coord = meteredCoordinateOf(args.sellable);
  if (!coord || args.sellable.sharesAtUse) return;   // split when the paid call names its payees
  try {
    const split = await readSplit(ctx.storage, args.sellable.sellerGhii, coord.ext, coord.action);
    const result = computeSplit(args.net, split, args.designations);
    if (!result.lines.length) return;
    await bookBeneficiaryShares(ctx.storage, {
      lines: result.lines,
      trackingCode: `chk_${args.trackingCode}_${coord.action}`,
      fromGhii: args.sellable.sellerGhii,
      currency: args.session.currency,
      buyerGhii: args.session.buyerGhii,
      reference: `checkout:${args.session.id}:${coord.ext}:${coord.action}`,
    });
  } catch (err) {
    logger.error('[commerce] checkout beneficiary accrual failed; the seller keeps the whole cut for this line', {
      session: args.session.id, seller: args.sellable.sellerGhii, error: String(err),
    });
  }
}

type CompletingCaller = { sub?: string; roles: string[]; scopes: string[]; appGrantId?: string | null } | null;

/**
 * Complete a session: collect the payment, fulfil, settle. An agent's outcome is counted for each
 * seller (AI visibility, layer C): `completed`, or `failed` with the code the checkout answered, or
 * `expired` when it ran out of time. Only the code is kept, never the message or the input.
 */
export async function completeSession(
  storage: Storage,
  config: AimeatConfig,
  session: CheckoutSessionRecord,
  handlerId?: string,
  instrument?: unknown,
  /** The buyer's bearer token from the completing request — custom fulfillments (app-tool
   *  capability invokes) authenticate with it; the default TASK path ignores it. */
  callerJwt?: string,
  /** The completing principal. Present for every door that a granted app can reach; see the spend
   *  gate below. Omitted only where no external principal can be the caller. */
  caller?: CompletingCaller,
): Promise<CheckoutSessionRecord> {
  try {
    const done = await completeSessionInner(storage, config, session, handlerId, instrument, callerJwt, caller);
    agentStage(storage, config, done, 'completed');
    return done;
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    // A retry against a session that already closed is not a new outcome: the first one was counted.
    if (typeof code === 'string' && code !== 'SESSION_NOT_OPEN') {
      if (code === 'SESSION_EXPIRED') agentStage(storage, config, session, 'expired');
      else agentStage(storage, config, session, 'failed', code);
    }
    throw e;
  }
}

async function completeSessionInner(
  storage: Storage,
  config: AimeatConfig,
  session: CheckoutSessionRecord,
  handlerId: string | undefined,
  instrument: unknown,
  callerJwt: string | undefined,
  caller: CompletingCaller | undefined,
): Promise<CheckoutSessionRecord> {
  requireOpen(session);

  // SECURITY (audit H-3): this is the one place money leaves the buyer, so it is the one place the
  // spend permission has to be asked. `appSpendRefusal` enforces the `contract:spend` scope and the
  // per-app ceiling the owner set, and its own docblock says it must run "at EVERY place that
  // actually charges" — yet the four completion doors (REST, UCP, ACP, MCP) went straight to
  // handler.collect(), which debits the buyer GHII. Because an app-grant token resolves to the
  // owner's GHII, an app the owner approved for reading their notes could spend their balance.
  // Asking here rather than in each door is deliberate: a fifth door cannot forget it.
  const spendRefusal = await appSpendRefusal(storage, caller ?? null);
  if (spendRefusal) {
    throw spendRefusal.kind === 'scope_required'
      ? new CommerceError('SCOPE_REQUIRED', 403, `This app was not granted the "${spendRefusal.scope}" permission, so it cannot spend on your behalf.`)
      : new CommerceError('APP_SPEND_CAP_REACHED', 403, `This app has reached the spending limit you set for it (${spendRefusal.capMorsels} morsels).`);
  }
  // The same question for an AGENT: money only within the daily limit its owner set on its card.
  const agentRefusal = await agentPurchaseRefusal(storage, config, session, caller);
  if (agentRefusal) throw agentRefusal;
  if (Date.now() > new Date(session.expiresAt).getTime()) {
    session.status = 'expired';
    session.updatedAt = new Date().toISOString();
    await putRecord(storage, session.buyerGhii, sessionKey(session.id), session);
    throw new CommerceError('SESSION_EXPIRED', 409, 'Checkout session has expired; create a new one');
  }

  legacyMorselSessionRefusal(session);
  // A session with nothing to pay in money needs no handler. A money session names one: there is no
  // morsel handler to fall back to, because a morsel is not a payment (ruling decision-morseli-on-
  // tahdistus-ei-hinta-tarjouksen-kaksi-arvoa). The morsel handler id a 3.x client may still send is
  // accepted and ignored on a free session until 4.0.0 (config-pacing.ts).
  const handler = session.total > 0 ? moneyHandler(session, handlerId) : null;

  const ctx: PaymentContext = { config, storage };

  // Re-resolve every line through the registry: revalidates availability and restores the
  // per-kind distribution behavior (callbacks cannot live inside the persisted session record).
  const sellables: Sellable[] = [];
  for (const item of session.items) {
    sellables.push(await resolveOne(storage, config, {
      kind: item.kind, agent: item.agent, offer_id: item.offerId, app: item.app,
      currency: session.currency,
    }, session.buyerOwner));
  }
  // The quote is compared with the live price before anything is charged: a price the seller changed
  // since the quote, or a session total that is not the sum of its lines, is refused and the session
  // stays open for the buyer to re-quote (PATCH items). Completion charged whatever the record said
  // (QA audit 2026-10-14, K4).
  const quotedTotal = session.items.reduce((n, item) => n + item.unitPrice * item.quantity, 0);
  const changed = session.items.findIndex((item, i) =>
    sellables[i].unitPrice !== item.unitPrice || sellables[i].tollMorsels !== (item.tollMorsels ?? sellables[i].tollMorsels));
  if (changed >= 0 || quotedTotal !== session.total) {
    throw new CommerceError('PRICE_CHANGED', 409, changed >= 0
      ? `The price of "${session.items[changed].title}" changed after this checkout was opened. Update the items to get a new quote, then complete again.`
      : 'This checkout\'s total does not match its lines. Update the items to get a new quote, then complete again.');
  }

  // The invoice rail for a line delivered at once only where the seller gives that credit (QA audit S8-03).
  const invoiceRefusal = invoiceRailRefusal(handler?.id, sellables);
  if (invoiceRefusal) throw invoiceRefusal;
  // One completion claims the session before any money moves; a refusal below puts it back (QA audit S8-04).
  const key = sessionKey(session.id);
  await claimSessionForCompletion(storage, session, key);

  // Per-item money math on the QUOTED prices the session carries, which equal the live prices above.
  const feePct = commerceFeePercent(config);
  const lines = session.items.map((item) => {
    const gross = item.unitPrice * item.quantity;
    const fee = percentFee(gross, feePct);
    return { item, gross, fee, net: gross - fee };
  });
  const totalFee = lines.reduce((n, l) => n + l.fee, 0);
  const totalNet = lines.reduce((n, l) => n + l.net, 0);

  // 1) Collect the gross from the buyer.
  // The single-seller rule guarantees every sellable shares the seller; money handlers charge on
  // the SELLER's own PSP credentials (loaded by the resolver) — never on node-level keys.
  const seller = { ghii: session.sellerGhii, owner: session.sellerOwner, psp: sellables[0]?.psp };
  // A line whose buyer turned automatic renewal on asks the handler to keep the payment method.
  const saveForLater = session.items.some(i => (i.input as { auto_renew?: unknown } | undefined)?.auto_renew === true);
  // An agent's amount is counted against its daily limit in the same step that checks the limit, right
  // before the collect, so two completions in the same instant cannot both pass (secaudit 2026-10,
  // PKG-6). The early check above stays: it refuses before the session is read further.
  const reserved = await reserveAgentPurchase(storage, config, session, caller);
  if (reserved) { await releaseSessionClaim(storage, session, key); throw reserved; }
  // Pacing first, before any money moves: a buyer who cannot cover it is refused having paid nothing.
  // The quoted amount, like the quoted prices. Part burns, the checkout's existing operator share is
  // kept, the rest goes to the seller (services/metered-settlement.ts chargePacing).
  const paced = await chargePacing({
    config, storage, caller: session.buyerIdentity || session.buyerGhii, payer: session.buyerGhii,
    providerGhii: session.sellerGhii, amount: session.pacingMorsels ?? 0,
    label: `checkout:${session.id}`, feePercent: feePct,
  });
  if (!paced) {
    await releaseAgentPurchase(storage, session, caller);
    await releaseSessionClaim(storage, session, key);
    throw new CommerceError('INSUFFICIENT_MORSELS', 402, insufficientMorselsMessage(config, session.pacingMorsels ?? 0));
  }
  let collected: { trackingCode: string; saved?: import('./types.js').SavedPayment };
  try {
    collected = handler && session.total > 0
      ? await handler.collect(ctx, { buyerGhii: session.buyerGhii, amount: session.total, currency: session.currency, reference: session.id, fee: totalFee, instrument, seller, ...(saveForLater ? { saveForLater } : {}) })
      : { trackingCode: `comtx_free_${session.id}` };
  } catch (err) {
    await paced.reverse();
    await releaseAgentPurchase(storage, session, caller);
    await releaseSessionClaim(storage, session, key);
    throw err;
  }
  if (handler && session.total > 0) await recordCollected(storage, session, key, collected.trackingCode);

  // 2) Fulfillment — a failure here refunds the collect and leaves the session open.
  //    Default: an agent TASK per line item. A sellable's custom fulfill() replaces it
  //    (app-tool: synchronous capability invoke whose result rides on the session).
  const taskIds: string[] = [];
  const results: Array<{ sku: string; result: unknown }> = [];
  // The seller's copy of the same results: a line whose result belongs to the buyer alone (an
  // ext-call's one-time pay token) gives the seller its sellerResult instead.
  const sellerResults: Array<{ sku: string; result: unknown }> = [];
  // Per-line, because one session can carry several priced lines with different sellers.
  const lineDesignations: DynamicDesignation[][] = [];
  try {
    for (let i = 0; i < session.items.length; i++) {
      const item = session.items[i]!;
      const sellable = sellables[i]!;
      if (sellable.fulfill) {
        const outcome = await sellable.fulfill(ctx, { session, item, callerJwt, payment: { handler: handler?.id ?? 'none', ...(collected.saved ? { saved: collected.saved } : {}) } });
        if (outcome.taskId) taskIds.push(outcome.taskId);
        if (outcome.result !== undefined) {
          // The capability may name who shares this sale, the same way it does on a contracted
          // call. Captured here because fulfillment runs before the payouts below, and stripped so
          // the buyer's receipt never carries the seller's commercial arrangement.
          const shared = takeDesignations(outcome.result);
          lineDesignations[i] = shared.designations;
          const sku = `${item.kind}:${item.agent}:${item.offerId}`;
          results.push({ sku, result: shared.result });
          sellerResults.push({ sku, result: outcome.sellerResult !== undefined ? outcome.sellerResult : shared.result });
        }
      } else {
        taskIds.push(await createFulfillmentTask(storage, session, item));
      }
    }
  } catch (err) {
    // The message about the money is built from what the rail answered: only `refunded` may say the
    // payment came back. A payment taken and not returned is stored for the seller, logged and told
    // to the operator (commerce/undelivered-payment.ts; QA audit F5-01).
    const refund: RefundOutcome = handler && session.total > 0
      ? await refundCollected(ctx, handler, { buyerGhii: session.buyerGhii, amount: session.total, trackingCode: collected.trackingCode, seller })
      : { outcome: 'nothing_captured' };
    await paced.reverse();
    await releaseAgentPurchase(storage, session, caller);
    await releaseSessionClaim(storage, session, key);
    const e = err as { message?: string };
    if (handler && (refund.outcome === 'failed' || refund.outcome === 'not_possible')) {
      await recordUndeliveredPayment(ctx, {
        session, trackingCode: collected.trackingCode, rail: handler.id, refund, reason: e.message ?? 'unknown error',
      });
    }
    const said = refundSentence(refund, session.id);
    // A limit the fulfilment refuses on (429, e.g. the pacing pack's daily PACING_PACK_CAP) keeps its
    // own code and status, so the buyer learns which limit it was and that a later try can succeed.
    // Any other failure stays FULFILLMENT_FAILED 502.
    if (err instanceof CommerceError && err.statusCode === 429) {
      throw new CommerceError(err.code, err.statusCode, `${err.message} ${said}`);
    }
    const why = (e.message ?? 'unknown error').trim();
    throw new CommerceError('FULFILLMENT_FAILED', 502, `The order could not be delivered: ${why}${/[.!?]$/.test(why) ? '' : '.'} ${said}`);
  }

  // 3) Payouts: the sellable's custom distribution (EE commission splits) or the default
  //    seller payout. 4) Then the fee leg (operator | burn).
  if (handler && session.total > 0) {
    for (let i = 0; i < lines.length; i++) {
      const { item, gross, fee, net } = lines[i]!;
      const sellable = sellables[i]!;
      if (gross <= 0) continue;   // a free line in a money session: nothing to pay out
      if (sellable.distribute) {
        await sellable.distribute(ctx, { session, item, gross, fee, net, trackingCode: collected.trackingCode });
      } else {
        await handler.payout(ctx, { toGhii: sellable.sellerGhii, amount: net, currency: session.currency, buyerGhii: session.buyerGhii, trackingCode: collected.trackingCode, reference: session.id });
      }
      // The seller has their cut; now whoever they owe a share of it. Out of the seller's net,
      // never added to what the buyer paid — identical to the contracted path.
      await bookCheckoutBeneficiaries(ctx, {
        sellable, session, net, trackingCode: collected.trackingCode,
        designations: lineDesignations[i] ?? [],
      });
    }
    // Fee leg. No ledger movement — record the operator's platform-fee entry as a receivable, so the
    // cut is ACCOUNTED and shows in the dashboard as OWED. No rail collects it here: the seller charges
    // on their own account and the fee is invoiced out of band. (The pacing's operator share moved on
    // the morsel ledger above, in chargePacing.)
    if (totalFee > 0) {
      await recordMoneyPlatformFee(storage, config, {
        fee: totalFee, currency: session.currency, sellerGhii: session.sellerGhii,
        buyerGhii: session.buyerGhii, trackingCode: collected.trackingCode, handler: handler.id,
      });
    }
  }

  const completed: CheckoutSessionRecord = {
    ...session,
    status: 'completed',
    receipt: {
      handler: handler?.id ?? 'none', charged: session.total, earned: totalNet, fee: totalFee, trackingCode: collected.trackingCode,
      ...(paced.morsels > 0 ? { pacing: pacingReceipt(paced) } : {}),
    },
    fulfillment: { taskIds, ...(results.length ? { results } : {}) },
    updatedAt: new Date().toISOString(),
  };
  await putRecord(storage, session.buyerGhii, key, completed);
  // The seller's orders-received copy, under THEIR GHII (readable without touching buyer data). It
  // carries the seller's view of each result, never a buyer's one-time token (secrets audit
  // 2026-10-09, S-3).
  await putRecord(storage, session.sellerGhii, orderKey(session.id), {
    ...completed, fulfillment: { taskIds, ...(sellerResults.length ? { results: sellerResults } : {}) },
  });
  // Counted for the seller under the channel it came from. Without an attribution (the buyer opted
  // out, or the door gave nothing to go on) it counts as `none`: in the totals, under no channel.
  recordPurchase(storage, config, {
    sellerGhii: session.sellerGhii, channel: session.attribution?.channel ?? 'none',
    family: session.attribution?.family ?? null, via: session.attribution?.via ?? 'page',
    amount: session.total, currency: session.currency,
  });

  // BOTH sides get a row. Money moved in two directions and each party experienced a different
  // event: one paid, one was paid. A single row on the buyer's feed would leave the seller — the
  // person whose income it is — to find out by looking.
  const what = session.items.map(i => i.title).filter(Boolean).join(', ').slice(0, 120);
  const amount = formatCheckoutAmount(session.total, session.currency, paced.morsels);
  void recordAccountEvent(storage, {
    ownerGhii: session.buyerGhii, kind: 'payment_sent', actorGaii: session.buyerGhii,
    subject: session.id, link: `/v1/profile?tab=wallet&checkout=${encodeURIComponent(session.id)}`,
    data: { amount, what, who: localAccountName(session.sellerGhii) },
  }, config);
  void recordAccountEvent(storage, {
    ownerGhii: session.sellerGhii, kind: 'payment_received', actorGaii: session.buyerGhii,
    subject: session.id, link: `/v1/profile?tab=wallet&order=${encodeURIComponent(session.id)}`,
    data: { amount, what, who: session.buyerOwner ?? localAccountName(session.buyerGhii) },
  }, config);
  void recordAccountEvent(storage, {
    ownerGhii: session.buyerGhii, kind: 'checkout_completed', actorGaii: session.buyerGhii,
    subject: session.id, link: `/v1/profile?tab=wallet&checkout=${encodeURIComponent(session.id)}`,
    data: { amount, what },
  }, config);

  // Bookkeeping: a completed MONEY checkout books an income voucher (tosite) for the seller.
  // Best-effort — a voucher failure must never fail the checkout (the money already moved);
  // the books can be reconciled from the payable entries. Amounts here are 6-decimal micros,
  // vouchers are cents. No VAT breakdown is known at checkout level: the voucher lands on the
  // accountant's unclassified list (TILIT puutelista) for classification.
  if (isMoneyCurrency(session.currency) && session.total > 0) {
    try {
      const { bookVoucher } = await import('../services/finance/vouchers.js');
      await bookVoucher(storage, session.sellerGhii, {
        date: new Date().toISOString().slice(0, 10),
        description: `Checkout ${session.id}: ${session.items.map((i) => i.title).filter(Boolean).join(', ').slice(0, 200) || 'sale'}`,
        direction: 'income', source: 'checkout',
        amountMinor: Math.round(session.total / 10_000),
        currency: session.currency,
        counterparty: session.buyerOwner ?? null,
        trackingCode: collected.trackingCode,
        externalRef: `checkout:${session.id}`,
      });
      emitChange('finance', session.sellerGhii);
    } catch (e) {
      logger.error(`checkout voucher booking failed for session ${session.id}: ${(e as Error).message}`);
    }
  }

  emitChange('agent-tasks');
  return completed;
}
