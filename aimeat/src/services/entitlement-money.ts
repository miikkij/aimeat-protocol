/**
 * @file src/services/entitlement-money.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MONEY settlement rail for EXCHANGE entitlements (TARGET-045) — the "identical seam"
 *   the morsel gateway (entitlement-gate.ts) mirrors, but settling REAL money (EUR/USD) per call via the
 *   ACCRUAL model: each metered call records a real currency obligation (buyer → seller, minus the
 *   platform rake) through a registered money PaymentHandler, off the morsel ledger. No per-call PSP
 *   charge and no custodial escrow — amounts accrue and settle in a batch (the `io.aimeat.invoice`
 *   receivable rail in prod, or `com.stripe.spt` when activated; the OSS `test.money` double in E2E),
 *   which matches AIMEAT's non-custodial + aggregation design (see money.ts). The entitlement's budget
 *   (in currency micro-units) is the buyer's committed spend cap.
 * @structure resolveAccrualHandler · settleEntitlementMoney · refundEntitlementMoney
 * @usage
 *   const s = await settleEntitlementMoney(storage, config, { consumerGhii, providerGhii, priceMicros, currency, feePct, reference });
 *   if (!s.ok) // deny; else keep s.trackingCode for a later refund
 * @version-history
 *   v1.0.0 — 2026-07-20 — Initial money accrual rail for the entitlement gateway (EXCHANGE money unit).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PaymentContext, PaymentHandler } from '../commerce/types.js';
import { listPaymentHandlers, MORSEL_HANDLER_ID } from '../commerce/payment-handlers.js';
import { TEST_MONEY_HANDLER_ID } from '../commerce/test-money-handler.js';
import { percentFee } from '../commerce/money.js';
import { recordMoneyPlatformFee } from '../commerce/session-service.js';
import { logger } from '../utils/logger.js';

/** The invoice/receivable rail that accrues real money without a live per-call PSP charge (prod EE). */
const ACCRUAL_HANDLER_ID = 'io.aimeat.invoice';

/** Pick the money handler to accrue against for a currency: prefer the invoice receivable rail, then the
 *  OSS test double, then any other non-morsel handler. Null when no money handler is registered. */
export function resolveAccrualHandler(currency: string): PaymentHandler | null {
  const money = listPaymentHandlers().filter(h => h.id !== MORSEL_HANDLER_ID && h.currencies.includes(currency));
  return money.find(h => h.id === ACCRUAL_HANDLER_ID)
    ?? money.find(h => h.id === TEST_MONEY_HANDLER_ID)
    ?? money[0]
    ?? null;
}

const ownerOf = (ghii: string): string => ghii.split('@')[0].split('#').pop() ?? ghii;

/**
 * Settle ONE metered call in real money: collect the price from the consumer, pay the provider its net
 * (price − rake), and account the operator's rake — all through the resolved money handler (accrual).
 * Returns the tracking code so a post-payment script throw can refund. Never throws — a handler failure
 * comes back as `{ ok:false }` so the gateway denies the call cleanly (no partial settlement).
 */
export async function settleEntitlementMoney(
  storage: Storage,
  config: AimeatConfig,
  args: { consumerGhii: string; providerGhii: string; priceMicros: number; currency: string; feePct: number; reference: string },
): Promise<{ ok: true; handler: string; trackingCode: string; fee: number; net: number } | { ok: false; reason: string }> {
  const handler = resolveAccrualHandler(args.currency);
  if (!handler) return { ok: false, reason: 'no_money_handler' };
  const price = Math.max(0, Math.floor(args.priceMicros));
  const fee = percentFee(price, args.feePct);
  const net = price - fee;
  const ctx: PaymentContext = { config, storage };
  const seller = { ghii: args.providerGhii, owner: ownerOf(args.providerGhii) };
  try {
    const collected = await handler.collect(ctx, {
      buyerGhii: args.consumerGhii, amount: price, currency: args.currency, reference: args.reference, fee, seller,
    });
    if (net > 0) {
      await handler.payout(ctx, {
        toGhii: args.providerGhii, amount: net, currency: args.currency,
        buyerGhii: args.consumerGhii, trackingCode: collected.trackingCode, reference: args.reference,
      });
    }
    if (fee > 0) {
      await recordMoneyPlatformFee(storage, config, {
        fee, currency: args.currency, sellerGhii: args.providerGhii, buyerGhii: args.consumerGhii,
        trackingCode: collected.trackingCode, handler: handler.id,
      });
    }
    return { ok: true, handler: handler.id, trackingCode: collected.trackingCode, fee, net };
  } catch {
    return { ok: false, reason: 'settlement_failed' };
  }
}

/** Best-effort reverse of a money accrual (post-payment script throw), mirroring the handler's refund leg. */
export async function refundEntitlementMoney(
  storage: Storage,
  config: AimeatConfig,
  args: { consumerGhii: string; providerGhii: string; priceMicros: number; currency: string; trackingCode: string },
): Promise<void> {
  const handler = resolveAccrualHandler(args.currency);
  if (!handler) return;
  const ctx: PaymentContext = { config, storage };
  try {
    await handler.refund(ctx, {
      buyerGhii: args.consumerGhii, amount: Math.max(0, Math.floor(args.priceMicros)), trackingCode: args.trackingCode,
      seller: { ghii: args.providerGhii, owner: ownerOf(args.providerGhii) },
    });
  } catch (err) { logger.warn('refundEntitlementMoney: refund is best-effort; the handler contract says it must not throw, but guard anyway', { error: String(err) }); }
}
