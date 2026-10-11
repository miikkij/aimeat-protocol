/**
 * @file src/commerce/protocol-money.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rule the outward commerce protocols (ACP and UCP) share: a price there is money.
 *   A morsel paces what is written into the store and is never a price, so these surfaces neither
 *   list a morsel amount as a price, nor open, show or settle a checkout session in morsels, nor
 *   advertise the morsel ledger as a payment handler (ruling D4, 2026-10-11). The node's own
 *   checkout at /v1/commerce is not one of these surfaces.
 *
 * @structure
 *   - moneyPaymentHandlers(): the registered handlers that settle money, with their money currencies only
 *   - createMoneySession(storage, config, args, requested?): createSession in a money currency, or MONEY_PRICE_REQUIRED
 *   - assertMoneySession(session): refuse a morsel session on a protocol surface
 *   - moneyHandlerFor(session, handlerId?): the handler a protocol completion uses, or PAYMENT_HANDLER_REQUIRED
 *
 * @version-history
 *   v1.0.0 — 2026-10-11 — The ACP feed listed morsel prices as currency "MORSEL", and ACP and UCP
 *     checkouts defaulted to morsel sessions (wish-acp-reitti-ei-k-yt-morseleita-valuuttana-morsel).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CheckoutSessionRecord } from './types.js';
import { createSession, CommerceError } from './session-service.js';
import { listPaymentHandlers } from './payment-handlers.js';
import { MONEY_CURRENCIES, isMoneyCurrency } from './money.js';

type CreateArgs = Omit<Parameters<typeof createSession>[2], 'currency'>;

const NOT_SOLD_HERE = 'ACP and UCP sell in money, and a morsel is not a currency.';

/** The registered handlers that settle money, each with its money currencies only. */
export function moneyPaymentHandlers(): Array<{ id: string; title: string; currencies: string[] }> {
  return listPaymentHandlers()
    .map((h) => ({ id: h.id, title: h.title, currencies: h.currencies.filter(isMoneyCurrency) }))
    .filter((h) => h.currencies.length > 0);
}

/**
 * Open a checkout session in a money currency. The requested currency when the caller names one;
 * otherwise the first money currency every line item is priced in. An item with no money price
 * this node can settle is refused with MONEY_PRICE_REQUIRED, never opened in morsels.
 */
export async function createMoneySession(
  storage: Storage, config: AimeatConfig, args: CreateArgs, requested?: string,
): Promise<CheckoutSessionRecord> {
  if (requested !== undefined) {
    if (!isMoneyCurrency(requested)) throw new CommerceError('MONEY_PRICE_REQUIRED', 422, `${NOT_SOLD_HERE} Name a money currency (${MONEY_CURRENCIES.join(' or ')}).`);
    return createSession(storage, config, { ...args, currency: requested });
  }
  for (const currency of MONEY_CURRENCIES) {
    try {
      return await createSession(storage, config, { ...args, currency });
    } catch (err) {
      if (!(err instanceof CommerceError) || err.code !== 'CURRENCY_NOT_SUPPORTED') throw err;
    }
  }
  throw new CommerceError('MONEY_PRICE_REQUIRED', 422,
    `${NOT_SOLD_HERE} These items have no money price this node can settle, so they are not sold through this checkout.`);
}

/** A session opened in morsels elsewhere is not shown or settled on a protocol surface. */
export function assertMoneySession(session: CheckoutSessionRecord): void {
  if (!isMoneyCurrency(session.currency)) {
    throw new CommerceError('MONEY_PRICE_REQUIRED', 422, `${NOT_SOLD_HERE} This session is not in money; read it at /v1/commerce/checkout-sessions/${session.id}.`);
  }
}

/** The handler that completes a money session on a protocol surface: the one named, or a refusal that lists the choices. */
export function moneyHandlerFor(session: CheckoutSessionRecord, handlerId: string | undefined): string {
  if (handlerId) return handlerId;
  const choices = moneyPaymentHandlers().filter((h) => h.currencies.includes(session.currency)).map((h) => h.id);
  throw new CommerceError('PAYMENT_HANDLER_REQUIRED', 422,
    `Name the payment handler for this ${session.currency} session${choices.length ? `: ${choices.join(', ')}` : ''}.`);
}
