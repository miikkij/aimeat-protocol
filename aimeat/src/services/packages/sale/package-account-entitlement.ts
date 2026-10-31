/**
 * @file services/packages/sale/package-account-entitlement.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record of a package an author sells to accounts of this node, and the one question
 *   every read, export, install and update of such a package asks: does this account hold a paid
 *   purchase of it? (Jouni, 2026-10-31, "optio B"; wish-tekij-myy-oman-pakettinsa-toiselle-k-ytt-j-lle-samassa-solmu.)
 *
 *   ONE RECORD PER PACKAGE GROUP, `sale.<groupId>`, in the system namespace `package-account-sales`: a
 *   literal with no `@`, so no principal can address it through the memory API. The author's price
 *   history, the state of the sale, the components shown before purchase, and every purchase. The
 *   price, the sale state and the preview are written by package-account-sale.ts on the author's
 *   request; a purchase is written only by the checkout's fulfilment, after the money was collected.
 *
 *   A PURCHASE COUNTS ONCE ITS CHECKOUT COMPLETED. The fulfilment runs while the checkout is still
 *   `completing`, and a later line of the same checkout can still fail and refund the payment. So a
 *   purchase is active only when the seller's own copy of the order (`commerce.order.<id>` under the
 *   author's GHII, written by session-service.ts on completion only) says `completed`. The first read
 *   that sees it marks the purchase `confirmed`, and later reads skip that lookup. The buyer cannot
 *   write the author's namespace, so the buyer cannot make a refunded checkout look completed.
 *
 *   A REFUNDED PURCHASE IS NOT ACTIVE. The author's refund (package-account-sale.ts) and a full Stripe
 *   refund reported by the author's webhook both set `state: 'refunded'`.
 *
 *   WHAT A PURCHASE COVERS: every version of the package group, including versions published later
 *   (`covers: 'line'`). Recorded on each purchase, so a later rule (updates for a period) reaches only
 *   the purchases made under it. A decision to confirm with Jouni (2026-10-31).
 * @structure NS_PACKAGE_ACCOUNT_SALES · AccountSale · AccountPrice · AccountPurchase · saleKey() ·
 *   readAccountSale() · currentPrice() · activePurchase() · accountEntitled() · saleVisibilityRefusal() ·
 *   purchaseRefusal()
 * @usage
 *   const sale = await readAccountSale(storage, groupId);
 *   if (sale && await activePurchase(storage, sale, 'bob')) { ... }
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-tekij-myy-oman-pakettinsa-toiselle-k-ytt-j-lle-samassa-solmu).
 */
import type { Storage } from '../../../storage/interface.js';
import { updateRecord, UNCHANGED } from '../../record-cas.js';
import { ANONYMOUS_ACCOUNT } from '../../../auth/anonymous-principal.js';

/** The system namespace of the account sales. No `@`, so no principal can address it. */
export const NS_PACKAGE_ACCOUNT_SALES = 'package-account-sales';

export type AccountSaleState = 'on_sale' | 'paused' | 'ended';

/** One price the author set. Appended, never rewritten; the last one is the current price. */
export interface AccountPrice { id: string; amount: number; currency: string; createdAt: string }

/** One purchase. A buyer who refunded and bought again has two entries; the newest one counts. */
export interface AccountPurchase {
    /** The buyer's bare account name on this node. */
    buyer: string;
    /** The checkout session id (`cs_…`). */
    order: string;
    priceId: string;
    amount: number;
    currency: string;
    /** The payment handler that collected, for the refund. */
    handler: string;
    trackingCode?: string;
    /** The author's GHII, where the seller's copy of the order lives. */
    sellerGhii: string;
    /** Who completed the checkout: the buyer's own GHII, or an agent's GAII acting for them. */
    boughtBy?: string;
    boughtAt: string;
    /** `refunding` while the author's refund runs: not active, and it goes back to `paid` if the rail refused. */
    state: 'paid' | 'refunding' | 'refunded';
    confirmed?: boolean;
    refundedAt?: string;
    covers: 'line';
}

export interface AccountSale {
    groupId: string;
    author: string;
    state: AccountSaleState;
    prices: AccountPrice[];
    /** Ids of the package's `memory` components whose content is shown before purchase (screenshots). */
    preview: string[];
    purchases: AccountPurchase[];
    updatedAt: string;
}

export const saleKey = (groupId: string): string => `sale.${groupId}`;

export function parseSale(v: unknown): AccountSale | null {
    const s = v as AccountSale | undefined;
    return s && typeof s === 'object' && Array.isArray(s.prices) && Array.isArray(s.purchases) ? s : null;
}

export async function readAccountSale(storage: Storage, groupId: string): Promise<AccountSale | null> {
    const rec = await storage.getMemory(NS_PACKAGE_ACCOUNT_SALES, saleKey(groupId));
    return parseSale(rec?.value);
}

/** The price a new purchase is made at, or null when the author set none. */
export function currentPrice(sale: AccountSale | null): AccountPrice | null {
    return sale && sale.prices.length ? sale.prices[sale.prices.length - 1]! : null;
}

/** The newest purchase entry of a buyer, whatever its state. */
export function latestPurchaseOf(sale: AccountSale, buyer: string): AccountPurchase | null {
    for (let i = sale.purchases.length - 1; i >= 0; i--) {
        if (sale.purchases[i]!.buyer === buyer) return sale.purchases[i]!;
    }
    return null;
}

/**
 * The buyer's active purchase of the package: paid, and its checkout completed. Null otherwise. The
 * first read after completion marks the purchase confirmed on the record's version.
 */
export async function activePurchase(storage: Storage, sale: AccountSale, buyer: string): Promise<AccountPurchase | null> {
    if (!buyer || buyer.includes('@') || buyer === ANONYMOUS_ACCOUNT) return null;
    const p = latestPurchaseOf(sale, buyer);
    if (!p || p.state !== 'paid') return null;
    if (p.confirmed) return p;
    const order = await storage.getMemory(p.sellerGhii, `commerce.order.${p.order}`);
    if ((order?.value as { status?: string } | undefined)?.status !== 'completed') return null;
    await updateRecord<AccountSale | null>(storage, NS_PACKAGE_ACCOUNT_SALES, saleKey(sale.groupId), parseSale, cur => {
        if (!cur) return UNCHANGED;
        const i = cur.purchases.findIndex(x => x.order === p.order && x.buyer === buyer);
        if (i < 0 || cur.purchases[i]!.confirmed || cur.purchases[i]!.state !== 'paid') return UNCHANGED;
        const purchases = [...cur.purchases];
        purchases[i] = { ...purchases[i]!, confirmed: true };
        return { ...cur, purchases };
    }, { tag: 'package-account-sale' });
    return { ...p, confirmed: true };
}

/** Whether `account` (a bare account name of this node) holds an active purchase of `groupId`. */
export async function accountEntitled(storage: Storage, groupId: string, account: string): Promise<boolean> {
    const sale = await readAccountSale(storage, groupId);
    return !!sale && !!(await activePurchase(storage, sale, account));
}

/**
 * Why a group may not take this visibility, or null: while a sale is on or paused, every version
 * stays private, or the content would reach readers who did not buy it (package-create.ts
 * updatePackageGroup asks it before any write).
 */
export async function saleVisibilityRefusal(
    storage: Storage, groupId: string, visibility: unknown,
): Promise<{ ok: false; status: number; code: string; message: string } | null> {
    if (visibility === undefined || visibility === 'private') return null;
    const sale = await readAccountSale(storage, groupId);
    if (!sale || sale.state === 'ended') return null;
    return {
        ok: false, status: 409, code: 'PACKAGE_PRICED',
        message: 'This package is on sale, so it stays private: only its buyers read it. End the sale first (price null) to share it another way.',
    };
}

/**
 * What a read that the visibility rule refused answers in place of 404 when the package is listed for
 * sale (on sale or paused): 402 PURCHASE_REQUIRED, since its listing is public anyway. Null for a
 * package that is not listed, which stays 404 so the route confirms nothing.
 */
export async function listedSaleRefusal(
    storage: Storage, groupId: string,
): Promise<{ ok: false; status: number; code: string; message: string } | null> {
    const sale = await readAccountSale(storage, groupId);
    if (!sale || sale.state === 'ended' || !currentPrice(sale)) return null;
    return {
        ok: false, status: 402, code: 'PURCHASE_REQUIRED',
        message: `${groupId} is sold by its author. Buy it first (aimeat_package_buy { group_id }, or Buy on the Packages page); the purchase lets this account read and install it.`,
    };
}

/**
 * Why `account` may not have the content of `groupId`, or null: the group is sold to accounts, the
 * account is not its author, and it holds no active purchase. Asked where a package is read past the
 * visibility rule (an update of a copy already installed, a migration prompt). A group that is not
 * sold answers null, so nothing changes for it.
 */
export async function purchaseRefusal(
    storage: Storage, groupId: string, account: string,
): Promise<{ status: number; code: string; message: string } | null> {
    const sale = await readAccountSale(storage, groupId);
    if (!sale || sale.author === account) return null;
    if (await activePurchase(storage, sale, account)) return null;
    return {
        status: 402, code: 'PURCHASE_REQUIRED',
        message: `${groupId} is sold by its author, and this account holds no paid purchase of it. Buy it first (aimeat_package_buy, or the Buy button on the Packages page).`,
    };
}
