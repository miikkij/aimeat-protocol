/**
 * @file src/commerce/types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared types for the protocol-agnostic commerce core (TARGET-033): the normalized
 *   Sellable (an agent offer priced in morsels), the CheckoutSession lifecycle record persisted as
 *   a memory record (no schema changes), and the PaymentHandler provider contract that payment
 *   methods implement (core ships morsels; EE registers real-money handlers via the
 *   registries). Protocol adapters (native REST, UCP, ACP, x402) are thin shells over
 *   these — see doc-t033-commerce-spec in the dev organism's design space.
 * @structure Sellable · FulfillArgs · FulfillOutcome · CheckoutLineItem · CheckoutReceipt ·
 *   CheckoutSessionRecord · PaymentContext · PaymentResult · PaymentHandler
 * @usage import type { CheckoutSessionRecord, PaymentHandler } from '../commerce/types.js';
 * @version-history
 *   v1.1.0 — 2026-07-14 — Fulfill seam (Sellable.fulfill) + app-tool line-item fields (app, input)
 *     + per-item fulfillment results on the session record (TARGET-034 phase A)
 *   v1.0.0 — 2026-07-13 — Initial commerce core types (TARGET-033 phase 1)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

/** Everything a custom distribution needs about one settled line item. */
export interface DistributeArgs {
  session: CheckoutSessionRecord;
  item: CheckoutLineItem;
  /** Gross line total the buyer paid, the fee taken from it, and what remains to distribute. */
  gross: number;
  fee: number;
  net: number;
  trackingCode: string;
}

/** A normalized "thing for sale" — an agent offer, a priced app-tool, a priced extension call. */
export interface Sellable {
  /** Resolver kind: 'offer' | 'app-tool' | 'ext-call' | future kinds. */
  kind: string;
  agentGaii: string;
  agentName: string;
  offerId: string;
  title: string;
  sellerOwner: string;
  sellerGhii: string;
  /**
   * Unit price in the session currency — morsels, or minor units for money currencies;
   * 0 for self-purchase (an owner "buying" from their own agent is free).
   */
  priceMorsels: number;
  /**
   * The SELLER's PSP credentials for money currencies (opaque to core; e.g. { provider:'stripe',
   * secretKey }). Loaded by the resolver from the seller's own records — money always settles on
   * the seller's account, never the node's.
   */
  psp?: unknown;
  /**
   * Custom revenue distribution replacing the default seller payout (e.g. EE: member cut +
   * org-wallet cut per commission %). Runs after the buyer charge; the fee leg is already routed.
   */
  distribute?: (ctx: PaymentContext, args: DistributeArgs) => Promise<void>;
  /**
   * Custom fulfillment replacing the default agent-TASK path (e.g. app-tool: invoke the backing
   * capability synchronously and return its result on the receipt). A throw here refunds the
   * collect and leaves the session open for retry — exactly like the default path.
   */
  fulfill?: (ctx: PaymentContext, args: FulfillArgs) => Promise<FulfillOutcome>;
}

/** What a custom fulfillment sees for one line item. */
export interface FulfillArgs {
  session: CheckoutSessionRecord;
  item: CheckoutLineItem;
  /** The buyer's bearer token, threaded from the completing request (capability invokes need it). */
  callerJwt?: string;
}

/** A custom fulfillment yields a TASK id and/or an inline result (surfaced on the session). */
export interface FulfillOutcome {
  taskId?: string;
  result?: unknown;
}

/** One line of a checkout session, resolved against the live offer at creation/update time. */
export interface CheckoutLineItem {
  /** Sellable kind — re-resolved through the same resolver at complete time. */
  kind: string;
  /** Provider agent — full GAII. */
  agent: string;
  offerId: string;
  /** app-tool: "ownerName/appId" so the resolver can find the tool manifest again. */
  app?: string;
  /** app-tool: the buyer's tool input, persisted with the quote and passed to the invoke. */
  input?: Record<string, unknown>;
  quantity: number;
  /** Snapshot fields resolved from the offer (price may change later; the session keeps its quote). */
  title: string;
  unitPrice: number;
}

export interface CheckoutReceipt {
  handler: string;
  charged: number;
  earned: number;
  fee: number;
  trackingCode: string;
}

/**
 * The checkout session lifecycle record. Persisted as a memory record `commerce.session.{id}`
 * under the BUYER owner's GHII; on completion a `commerce.order.{id}` copy is written under the
 * SELLER owner's GHII (their orders-received list). All state transitions go through
 * session-service.ts — `open → completed | cancelled | expired`.
 */
export interface CheckoutSessionRecord {
  id: string;
  status: 'open' | 'completed' | 'cancelled' | 'expired';
  /** Buyer: bare owner name + owner GHII (the balance holder) + the acting principal for attribution. */
  buyerOwner: string;
  buyerGhii: string;
  buyerIdentity: string;
  /** Seller: one session = one seller owner (all line items must share it). */
  sellerOwner: string;
  sellerGhii: string;
  items: CheckoutLineItem[];
  /** 'morsel' (default) or an ISO money code (amounts in 6-decimal micro-units). */
  currency: string;
  total: number;
  note?: string;
  receipt?: CheckoutReceipt;
  /** Fulfillment: agent tasks created on completion (offer-ask → TASK path) and/or inline
   *  results from custom fulfillments (app-tool capability invokes). */
  fulfillment?: { taskIds: string[]; results?: Array<{ sku: string; result: unknown }> };
  createdAt: string;
  updatedAt: string;
  /** Open sessions expire lazily after this instant (checked on read + on complete). */
  expiresAt: string;
}

/** Injected into payment handlers, so a handler never reaches for storage or config on its own. */
export interface PaymentContext {
  config: AimeatConfig;
  storage: Storage;
}

export interface PaymentResult {
  charged: number;
  earned: number;
  fee: number;
  trackingCode: string;
}

/**
 * A payment method provider. Core registers all of them: `io.aimeat.morsels` (this node's ledger),
 * `com.stripe.spt` (cards on the SELLER's own Stripe account), `io.aimeat.invoice` (settled
 * offline) and `com.coinbase.x402` (stablecoin, when enabled) — one registry, one contract.
 *
 * The money flow is split so custom distributions reuse the same handler:
 * `collect` takes the gross from the buyer, `payout` pays one recipient, `refund` reverses a
 * collect. The session service orchestrates: collect → fulfill → payouts/distribute → fee leg.
 */
export interface PaymentHandler {
  /** Reverse-DNS handler id advertised in the UCP profile (e.g. `io.aimeat.morsels`). */
  id: string;
  /** Human-readable name for discovery surfaces. */
  title: string;
  /** Currencies this handler settles (e.g. ['morsel'] or ['USD', 'EUR']). */
  currencies: string[];
  /**
   * Take the gross amount from the buyer (or their payment instrument).
   * Throws { code, statusCode, message } on failure (e.g. INSUFFICIENT_BALANCE → 402).
   */
  collect(ctx: PaymentContext, args: {
    buyerGhii: string;
    amount: number;
    currency: string;
    reference: string;
    /** The operator's platform fee on this sale (minor units) — booked separately, not deducted at the rail. */
    fee: number;
    /** Opaque payment instrument from the adapter (e.g. a Stripe SPT); unused by morsels. */
    instrument?: unknown;
    /** The session's seller — money handlers charge on the SELLER's own PSP credentials (psp). */
    seller?: { ghii: string; owner: string; psp?: unknown };
  }): Promise<{ trackingCode: string }>;
  /** Pay one recipient their share of an already-collected amount. */
  payout(ctx: PaymentContext, args: {
    toGhii: string;
    amount: number;
    currency: string;
    buyerGhii: string;
    trackingCode: string;
    reference: string;
  }): Promise<void>;
  /** Reverse a collect when fulfillment fails after payment (best effort, must not throw). */
  refund(ctx: PaymentContext, args: {
    buyerGhii: string;
    amount: number;
    trackingCode: string;
    seller?: { ghii: string; owner: string; psp?: unknown };
  }): Promise<void>;
  /**
   * OPTIONAL hold rail (the covered-bid / escrow-by-deferred-capture primitives). `authorize`
   * places a hold on the buyer's instrument WITHOUT moving money; `capture` settles up to the
   * held amount onto the seller; `release` cancels the hold. A handler without these three
   * cannot back holds — the hold book answers HOLD_UNSUPPORTED for its currencies.
   */
  authorize?(ctx: PaymentContext, args: {
    buyerGhii: string;
    amount: number;
    currency: string;
    reference: string;
    instrument?: unknown;
    seller?: { ghii: string; owner: string; psp?: unknown };
  }): Promise<{ trackingCode: string }>;
  /** Settle part or all of a held amount onto the seller. Throws on failure. */
  capture?(ctx: PaymentContext, args: {
    amount: number;
    currency: string;
    trackingCode: string;
    reference: string;
    seller?: { ghii: string; owner: string; psp?: unknown };
  }): Promise<void>;
  /** Cancel a hold without settling. Throws on failure (callers doing sweeps may tolerate). */
  release?(ctx: PaymentContext, args: {
    trackingCode: string;
    seller?: { ghii: string; owner: string; psp?: unknown };
  }): Promise<void>;
}
