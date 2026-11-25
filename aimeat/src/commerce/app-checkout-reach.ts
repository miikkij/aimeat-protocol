/**
 * @file src/commerce/app-checkout-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an app may do with a checkout when the person did not allow it to spend for them.
 *
 *   An app grant cannot hold commerce:buy, and contract:spend lets the app buy anything on the
 *   person's behalf within its ceiling. An app that sells its own subscription needs neither: the
 *   person pays on Stripe's own card page, so they see the seller and the price and press pay
 *   themselves. So an app WITHOUT either word may open, read, change, pay on the card page and
 *   complete a checkout whose every line is a subscription plan of ITS OWN extension, and cancel the
 *   renewal of such a plan. Completion then takes the card page handler only (com.stripe.checkout):
 *   a saved card, x402 or the invoice rail would move money without that press.
 *
 *   ITS OWN. A plan belongs to the extension that offers it (commerce/subscriptions.ts), and an
 *   extension names the app it serves in its manifest, `config: { app: owner/file.html }`, which the
 *   node accepts only when the extension's installer owns that app (services/members-only.ts
 *   resolveGatedApp). The app grant names the app it was given to (`owner/file.html`). The two must be
 *   the same app. A plan of an extension that serves another app, or no app, is another app's
 *   product, refused NOT_THIS_APPS_PRODUCT: the app has to ask the person for contract:spend first.
 *   A line of any other kind still needs a checkout word, so it is refused SCOPE_DENIED as before.
 *
 *   An app holding contract:spend, an agent and the person in person are not changed here.
 * @structure CartLine · CartReach · cartReach (pure) · sameApp (pure) · appCheckoutReach · checkoutSpendRefusal ·
 *   NOT_OWN_CODE · notOwnMessage
 * @usage
 *   const reach = await appCheckoutReach(storage, req.auth!.app_grant, items); // { kind: 'own' } | ...
 *   const refused = await checkoutSpendRefusal(storage, caller, session, handlerId); if (refused) throw refused;
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-sovellus-saa-avata-oman-tilauksensa-maksun-commerce-buy-ei-o).
 */
import type { Storage } from '../storage/interface.js';
import type { CheckoutSessionRecord } from './types.js';
import { CommerceError } from './errors.js';
import { getPaymentHandler } from './payment-handlers.js';
import { STRIPE_CHECKOUT_HANDLER_ID } from './stripe-checkout.js';
import { appSpendRefusal } from '../services/metered/access.js';
import { resolveGatedAppRef } from '../services/members-only.js';

/** A checkout line as a request sends it and as a session stores it: only the two fields read here. */
export interface CartLine { kind?: string; app?: string }

/**
 * own: every line is a subscription plan of the extension that serves this app.
 * foreign: every line is a subscription, and `ext` serves another app (`servesApp`) or none.
 * other: a line of another kind, an empty cart, or no app grant: the checkout words decide.
 */
export type CartReach =
  | { kind: 'own' }
  | { kind: 'foreign'; ext: string; servesApp: string | null }
  | { kind: 'other' };

/** The code an app is refused with when it opens a checkout for a product that is not its own. */
export const NOT_OWN_CODE = 'NOT_THIS_APPS_PRODUCT';

/** `alice/shop.html` and `Alice/shop.html` are one app: the owner half is an account name. */
export function sameApp(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const split = (s: string) => { const i = s.indexOf('/'); return i < 0 ? null : [s.slice(0, i).toLowerCase(), s.slice(i + 1)] as const; };
  const x = split(a); const y = split(b);
  return !!x && !!y && x[0] === y[0] && x[1] === y[1];
}

/** Pure: the reach of a cart for the app `grantApp`, given the app each subscription line's extension serves. */
export function cartReach(grantApp: string | null, lines: CartLine[], servedAppOf: (ext: string) => string | null): CartReach {
  if (!grantApp || lines.length === 0) return { kind: 'other' };
  if (lines.some(l => l.kind !== 'subscription' || typeof l.app !== 'string' || !l.app)) return { kind: 'other' };
  for (const line of lines) {
    const served = servedAppOf(line.app!);
    if (!sameApp(served, grantApp)) return { kind: 'foreign', ext: line.app!, servesApp: served };
  }
  return { kind: 'own' };
}

/** The sentence a refused app shows the person. */
export function notOwnMessage(reach: { ext: string; servesApp: string | null }): string {
  const whose = reach.servesApp ? `the app ${reach.servesApp}` : 'no app';
  return `This app may open a payment without your permission to spend only for a subscription it sells itself. `
    + `"${reach.ext}" sells for ${whose}. Buy it there, or allow this app to spend for you (contract:spend).`;
}

/** The reach of `lines` for the app the grant `grantId` was given to, read from the grant and the extensions. */
export async function appCheckoutReach(
  storage: Pick<Storage, 'getAppGrant' | 'getExtension' | 'appFilenamesAmong'>,
  grantId: string | null | undefined,
  lines: CartLine[],
): Promise<CartReach> {
  if (!grantId || lines.length === 0 || lines.some(l => l.kind !== 'subscription')) return { kind: 'other' };
  const grant = await storage.getAppGrant(grantId);
  if (!grant || grant.revoked) return { kind: 'other' };
  const served = new Map<string, string | null>();
  for (const name of new Set(lines.map(l => l.app).filter((a): a is string => typeof a === 'string' && !!a))) {
    const ext = await storage.getExtension(name);
    served.set(name, ext && ext.status === 'active' ? await resolveGatedAppRef(storage, ext) : null);
  }
  return cartReach(grant.app, lines, (ext) => served.get(ext) ?? null);
}

type SpendCaller = { roles: string[]; scopes: string[]; appGrantId?: string | null } | null;

/**
 * The spend question at the card page and at completion (services/metered/access.ts appSpendRefusal),
 * with the one allowance above: an app without contract:spend paying its own subscription on the card
 * page is not refused. Answers the CommerceError to throw, or null.
 */
export async function checkoutSpendRefusal(
  storage: Storage,
  caller: SpendCaller,
  session: Pick<CheckoutSessionRecord, 'items'>,
  handlerId: string | undefined,
): Promise<CommerceError | null> {
  const refusal = await appSpendRefusal(storage, caller);
  if (!refusal) return null;
  if (refusal.kind === 'app_cap_reached') {
    return new CommerceError('APP_SPEND_CAP_REACHED', 403, `This app has reached the spending limit you set for it (${refusal.capMorsels} morsels).`);
  }
  const reach = await appCheckoutReach(storage, caller?.appGrantId, session.items);
  if (reach.kind === 'own') {
    // The handler that will collect, read the way completion reads it, never the raw field alone.
    if (handlerId && getPaymentHandler(handlerId)?.id === STRIPE_CHECKOUT_HANDLER_ID) return null;
    return new CommerceError('CARD_PAGE_ONLY', 403,
      `This app pays for its own subscription only with the card you type on Stripe's page (payment.handler ${STRIPE_CHECKOUT_HANDLER_ID}). `
      + 'To pay another way, allow this app to spend for you (contract:spend).');
  }
  if (reach.kind === 'foreign') return new CommerceError(NOT_OWN_CODE, 403, notOwnMessage(reach));
  return new CommerceError('SCOPE_REQUIRED', 403, `This app was not granted the "${refusal.scope}" permission, so it cannot spend on your behalf.`);
}
