/**
 * @file src/commerce/stripe-checkout-complete.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Finish an AIMEAT checkout from the Stripe webhook when the person paid on the hosted
 *   card page and never came back to the app (commerce/stripe-checkout.ts). Its own file so the
 *   webhook route does not reach into the session service, and the card page module stays free of it.
 *
 *   The delivery names the AIMEAT session and its buyer in the Stripe session's metadata, which the
 *   node itself wrote when it opened the page. The checkout must belong to the seller whose signed
 *   webhook this is, and completion then reads the payment back from Stripe (the handler's collect),
 *   so the delivery is a reason to look, never the proof. A checkout that is already complete is the
 *   normal case when the person did come back, and is answered as such.
 * @structure completeFromStripeCheckout
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-4).
 */
import type { AimeatConfig } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { getSession, completeSession } from './session-service.js';
import { STRIPE_CHECKOUT_HANDLER_ID } from './stripe-checkout.js';
import { logger } from '../utils/logger.js';

export async function completeFromStripeCheckout(
  storage: Storage, config: AimeatConfig, sellerGhii: string, object: Record<string, unknown>,
): Promise<'checkout_completed' | 'checkout_already_closed' | 'checkout_not_found' | 'checkout_not_completed'> {
  const meta = (object.metadata ?? {}) as Record<string, unknown>;
  const id = String(meta.aimeat_session ?? '');
  const buyer = String(meta.aimeat_buyer ?? '');
  const cs = typeof object.id === 'string' ? object.id : '';
  const session = id && buyer ? await getSession(storage, buyer, id, config) : null;
  if (!session || session.sellerGhii !== sellerGhii || !cs) return 'checkout_not_found';
  if (session.status !== 'open') return 'checkout_already_closed';
  try {
    // No caller: the person approved the payment on Stripe's page, and the card page route asked an
    // app's spend permission before opening it.
    await completeSession(storage, config, session, STRIPE_CHECKOUT_HANDLER_ID, cs, '', null);
    return 'checkout_completed';
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === 'SESSION_NOT_OPEN') return 'checkout_already_closed';
    logger.error('[stripe-checkout] a paid card page did not complete its checkout', { session: id, seller: sellerGhii, code: String(code ?? ''), error: String(err) });
    return 'checkout_not_completed';
  }
}
