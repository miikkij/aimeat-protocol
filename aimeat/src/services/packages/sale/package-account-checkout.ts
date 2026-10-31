/**
 * @file services/packages/sale/package-account-checkout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `package-account` sellable kind: one account of this node buys a package its author
 *   sells (package-account-sale.ts), through the node's ordinary checkout (commerce/session-service.ts).
 *
 *   THE LINE. `{ kind: 'package-account', app: <group id>, currency? }`. The seller is never read from
 *   the line: it is the author the sale record names, which is the package's author. The money settles
 *   on that author's own payment account (commerce.psp), as for every sale on this node, and the
 *   node's commerce fee is booked as on every other checkout.
 *
 *   RESOLVE (at opening, and again at completion before any money moves). Refused with a reason: no
 *   group id, a quantity above one, not on sale, nothing published, the buyer is the author, the
 *   buyer is not an account of this node, the buyer already holds an active purchase, the author has
 *   no payment account now, or no rail settles the currency.
 *
 *   FULFIL (after the money is collected; a throw refunds it). The purchase is appended to the sale
 *   record on its version, with the order, the price, the rail and the tracking code the collect
 *   wrote on the buyer's session. It counts only once the checkout completed
 *   (package-account-entitlement.ts activePurchase). Fulfilling the same order again changes nothing.
 * @structure packageAccountSellableResolver()
 * @usage registerSellableResolver(packageAccountSellableResolver());
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-tekij-myy-oman-pakettinsa-toiselle-k-ytt-j-lle-samassa-solmu).
 */
import type { SellableResolver } from '../../../commerce/sellable-resolvers.js';
import type { Sellable } from '../../../commerce/types.js';
import { CommerceError } from '../../../commerce/errors.js';
import { listPaymentHandlers } from '../../../commerce/payment-handlers.js';
import { readPsp } from '../../../commerce/psp-record.js';
import { updateRecord, UNCHANGED } from '../../record-cas.js';
import { ANONYMOUS_ACCOUNT } from '../../../auth/anonymous-principal.js';
import {
    NS_PACKAGE_ACCOUNT_SALES, saleKey, parseSale, readAccountSale, currentPrice, activePurchase,
    type AccountSale,
} from './package-account-entitlement.js';

export const PACKAGE_ACCOUNT_KIND = 'package-account';

export function packageAccountSellableResolver(): SellableResolver {
    return {
        kind: PACKAGE_ACCOUNT_KIND,
        async resolve(storage, config, ref, buyerOwner): Promise<Sellable> {
            const groupId = ref.app ?? '';
            if (!groupId) throw new CommerceError('INVALID_ITEM', 400, 'A package-account line names app: the package group id.');
            if ((ref.quantity ?? 1) > 1) throw new CommerceError('INVALID_ITEM', 400, 'A package is bought once per account; the quantity is 1.');
            const sale = await readAccountSale(storage, groupId);
            const price = currentPrice(sale);
            if (!sale || sale.state !== 'on_sale' || !price) {
                throw new CommerceError('NOT_FOR_SALE', 404, `${groupId} is not on sale now.`);
            }
            const pkg = await storage.getLatestPublished(groupId);
            if (!pkg || pkg.author !== sale.author) throw new CommerceError('NOT_FOR_SALE', 404, `${groupId} has no published version on sale.`);
            // The shared anonymous identity is everyone at once: a purchase by it would open the
            // package to every caller without a session.
            if (!buyerOwner || buyerOwner.includes('@') || buyerOwner === ANONYMOUS_ACCOUNT) {
                throw new CommerceError('NODE_ACCOUNT_ONLY', 403, 'A package is sold to an account of this node. Sign in with your account here to buy it.');
            }
            if (buyerOwner === sale.author) throw new CommerceError('OWN_PACKAGE', 409, 'This is your own package: you have it already.');
            if (await activePurchase(storage, sale, buyerOwner)) {
                throw new CommerceError('ALREADY_BOUGHT', 409, `You bought ${pkg.name} already. Install it from the Packages page or with aimeat_package_install.`);
            }
            // No currency, or the 'morsel' a 3.x client may still send, means the package's own currency.
            const asked = ref.currency && ref.currency !== 'morsel' ? ref.currency : price.currency;
            if (asked !== price.currency) {
                throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `${pkg.name} is sold in ${price.currency}; open the checkout with currency ${price.currency}.`);
            }
            if (!listPaymentHandlers().some(h => h.currencies.includes(price.currency))) {
                throw new CommerceError('CURRENCY_NOT_SUPPORTED', 422, `No payment method on this node settles ${price.currency}.`);
            }
            const sellerGhii = `${sale.author}@${config.nodeId}`;
            const psp = await readPsp(storage, sellerGhii);
            if (!psp.secretKey) {
                throw new CommerceError('NO_PAYMENT_ACCOUNT', 409, `The author of ${pkg.name} has no payment account connected now, so it cannot be bought. Ask them to connect one.`);
            }
            return {
                kind: PACKAGE_ACCOUNT_KIND, agentGaii: groupId, agentName: pkg.name, offerId: 'buy',
                title: pkg.name, sellerOwner: sale.author, sellerGhii, unitPrice: price.amount, tollMorsels: 0, psp,
                async fulfill(ctx, { session, item, payment }) {
                    // The collect wrote its tracking code on the buyer's session before this runs (session-claim.ts).
                    const stored = await ctx.storage.getMemory(session.buyerGhii, `commerce.session.${session.id}`);
                    const trackingCode = (stored?.value as { collectedTrackingCode?: string } | undefined)?.collectedTrackingCode;
                    const now = new Date().toISOString();
                    let refusal = null as CommerceError | null;
                    await updateRecord<AccountSale | null>(ctx.storage, NS_PACKAGE_ACCOUNT_SALES, saleKey(groupId), parseSale, async cur => {
                        refusal = null;
                        if (!cur) { refusal = new CommerceError('NOT_FOR_SALE', 404, `${groupId} is not on sale now.`); return UNCHANGED; }
                        if (cur.purchases.some(p => p.order === session.id)) return UNCHANGED;
                        const held = await activePurchase(ctx.storage, cur, session.buyerOwner);
                        if (held) { refusal = new CommerceError('ALREADY_BOUGHT', 409, `This account bought ${pkg.name} already.`); return UNCHANGED; }
                        return {
                            ...cur, updatedAt: now,
                            purchases: [...cur.purchases, {
                                buyer: session.buyerOwner, order: session.id, priceId: currentPrice(cur)?.id ?? price.id,
                                amount: item.unitPrice, currency: session.currency, handler: payment?.handler ?? 'none',
                                ...(trackingCode ? { trackingCode } : {}), sellerGhii, boughtBy: session.buyerIdentity,
                                boughtAt: now, state: 'paid', covers: 'line',
                            }],
                        };
                    }, { tag: 'package-account-sale' });
                    if (refusal) throw refusal;
                    return {
                        result: {
                            group_id: groupId, name: pkg.name, author: sale.author, entitled: true, covers: 'line',
                            install: `POST /v1/packages/${encodeURIComponent(groupId)}/install`,
                            next_step: `Install it with aimeat_package_install { group_id: "${groupId}" }, or from the Packages page. Every later version of it comes with this purchase.`,
                        },
                    };
                },
            };
        },
    };
}
