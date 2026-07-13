/**
 * @file src/commerce/types.ts
 * @description Shared types for the protocol-agnostic commerce core (TARGET-033): the normalized
 *   Sellable (an agent offer priced in morsels), the CheckoutSession lifecycle record persisted as
 *   a memory record (no schema changes), and the PaymentHandler provider contract that payment
 *   methods implement (core ships morsels; EE registers real-money handlers via the
 *   EnterpriseProvider seam). Protocol adapters (native REST, UCP, ACP, x402) are thin shells over
 *   these — see doc-t033-commerce-spec in the dev organism's design space.
 * @structure Sellable · CheckoutLineItem · CheckoutReceipt · CheckoutSessionRecord ·
 *   PaymentContext · PaymentResult · PaymentHandler
 * @usage import type { CheckoutSessionRecord, PaymentHandler } from '../commerce/types.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Initial commerce core types (TARGET-033 phase 1)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

/** A normalized "thing for sale" — phase 1: an agent offer with a concrete morsel price. */
export interface Sellable {
  kind: 'offer';
  agentGaii: string;
  agentName: string;
  offerId: string;
  title: string;
  sellerOwner: string;
  sellerGhii: string;
  /** Unit price in morsels; 0 for self-purchase (an owner "buying" from their own agent is free). */
  priceMorsels: number;
}

/** One line of a checkout session, resolved against the live offer at creation/update time. */
export interface CheckoutLineItem {
  /** Provider agent — full GAII. */
  agent: string;
  offerId: string;
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
  currency: 'morsel';
  total: number;
  note?: string;
  receipt?: CheckoutReceipt;
  /** Fulfillment result: the agent tasks created on completion (offer-ask → TASK path). */
  fulfillment?: { taskIds: string[] };
  createdAt: string;
  updatedAt: string;
  /** Open sessions expire lazily after this instant (checked on read + on complete). */
  expiresAt: string;
}

/** Injected into payment handlers — handlers never import core internals by path (EE parity). */
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
 * A payment method provider. Core registers `io.aimeat.morsels`; the EE module contributes
 * real-money handlers (stripe-spt, wallet tokens, stablecoin) via
 * `EnterpriseProvider.getPaymentHandlers()` — same registry, same contract.
 */
export interface PaymentHandler {
  /** Reverse-DNS handler id advertised in the UCP profile (e.g. `io.aimeat.morsels`). */
  id: string;
  /** Human-readable name for discovery surfaces. */
  title: string;
  /** Currencies this handler settles (e.g. ['morsel'] or ['USD', 'EUR']). */
  currencies: string[];
  /**
   * Atomically charge the buyer and credit the seller (minus any marketplace fee).
   * Throws { code, statusCode, message } on failure (e.g. INSUFFICIENT_BALANCE → 402).
   */
  charge(ctx: PaymentContext, args: {
    buyerGhii: string;
    sellerGhii: string;
    amount: number;
    reference: string;
  }): Promise<PaymentResult>;
  /** Undo a charge when fulfillment fails after payment (best effort, must not throw). */
  refund(ctx: PaymentContext, args: {
    buyerGhii: string;
    sellerGhii: string;
    result: PaymentResult;
  }): Promise<void>;
}
