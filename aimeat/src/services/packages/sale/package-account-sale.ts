/**
 * @file services/packages/sale/package-account-sale.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An author sells their own package to other accounts of this node (Jouni, 2026-10-31,
 *   "optio B"; wish-tekij-myy-oman-pakettinsa-toiselle-k-ytt-j-lle-samassa-solmu). The author sets a
 *   money price; a buyer pays through this node's checkout, the money settles on the author's own
 *   payment account, and the paid purchase lets the buyer's account read and install that one package.
 *   The record and the read check are package-account-entitlement.ts; the checkout line is
 *   package-account-checkout.ts.
 *
 *   WHO SETS A PRICE. The package's author only: the money lands on their account, so an operator does
 *   not price another person's work. The author must have a payment account (their own Stripe key,
 *   commerce.psp), or the price is refused with NO_PAYMENT_ACCOUNT, because a buyer could otherwise pay
 *   into nothing.
 *
 *   A PRICED PACKAGE IS PRIVATE. Every version must be private before a price is set, and while the
 *   sale is on or paused the group cannot be made members, organism or public (package-create.ts asks
 *   package-account-entitlement.ts saleVisibilityRefusal). So every route that serves a private package keeps it from a reader with
 *   no purchase (export, versions, install, federation, the repository listing), and only the reads
 *   that package-read.ts packageVisibleTo answers admit a buyer. What stays visible is the listing:
 *   name, description, category, tags, author, version, the component list without content, the
 *   price, and the content of the `memory` components the author names as `preview` (screenshots).
 *
 *   STATE. `on_sale` lists and sells; `paused` lists and does not sell; `ended` neither. A buyer keeps
 *   the purchase in every state. A price of null ends the sale.
 *
 *   REFUND. The author refunds one purchase on the rail that collected it, on their own payment
 *   account. The purchase is claimed (`refunding`) before the rail is asked, so two refunds at the same
 *   moment refund once; a rail that refused puts it back to `paid`. Copies the buyer already installed
 *   stay where they are; the buyer can no longer read, install or update the package.
 * @structure setAccountPrice() · saleView() · buyLine() · listingOf() · listingFor() · listForSale() · purchasesOf() · salesOf() ·
 *   refundPurchase() · refundByTrackingCode() · hasPaymentAccount()
 * @usage
 *   const out = await setAccountPrice({ storage, config }, { owner }, groupId, { price, state, preview });
 *   const rows = await listForSale(storage, { category: 'paneeli' });
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-tekij-myy-oman-pakettinsa-toiselle-k-ytt-j-lle-samassa-solmu).
 */
import type { Storage, PackageRecord } from '../../../storage/interface.js';
import type { AimeatConfig } from '../../../config.js';
import { MONEY_CURRENCIES, integerMicros } from '../../../commerce/money.js';
import { listPaymentHandlers } from '../../../commerce/payment-handlers.js';
import { readPsp } from '../../../commerce/psp-record.js';
import { refundCollected } from '../../../commerce/undelivered-payment.js';
import { updateRecord, UNCHANGED } from '../../record-cas.js';
import { notify } from '../../notify.js';
import { emitChange } from '../../event-bus.js';
import {
    NS_PACKAGE_ACCOUNT_SALES, saleKey, parseSale, readAccountSale, currentPrice, activePurchase,
    type AccountSale, type AccountSaleState, type AccountPurchase,
} from './package-account-entitlement.js';

type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });

/** The highest price an author may set: one million in micro-units of the currency. */
const MAX_PRICE_MICROS = 1_000_000 * 1_000_000;
const MAX_PREVIEW = 3;
const STATES: readonly AccountSaleState[] = ['on_sale', 'paused', 'ended'];

/** Whether this account has a payment account the money can settle on: its own Stripe key. */
export async function hasPaymentAccount(storage: Storage, ownerGhii: string): Promise<boolean> {
    const psp = await readPsp(storage, ownerGhii);
    return !!psp.secretKey;
}

/** The sale as anyone may read it: never the purchases. */
export function saleView(sale: AccountSale): Record<string, unknown> {
    const price = currentPrice(sale);
    return {
        group_id: sale.groupId, author: sale.author, state: sale.state,
        price: price ? { amount: price.amount, currency: price.currency, id: price.id } : null,
        buyable: sale.state === 'on_sale' && !!price,
        preview: sale.preview,
        updated_at: sale.updatedAt,
    };
}

/** The checkout line that buys the package (POST /v1/commerce/checkout-sessions `items`). */
export function buyLine(sale: AccountSale): Record<string, unknown> | null {
    const price = currentPrice(sale);
    return sale.state === 'on_sale' && price ? { kind: 'package-account', app: sale.groupId, currency: price.currency } : null;
}

/**
 * What a reader without a purchase sees of a priced package: the metadata, the component list
 * without content, the content of the preview components, the sale, and the line that buys it.
 */
export function listingOf(pkg: PackageRecord, sale: AccountSale): Record<string, unknown> {
    const preview = new Set(sale.preview);
    return {
        packageGroupId: pkg.packageGroupId, name: pkg.name, author: pkg.author, version: pkg.version,
        description: pkg.description, category: pkg.category, tags: pkg.tags, status: pkg.status,
        visibility: pkg.visibility, createdAt: pkg.createdAt, updatedAt: pkg.updatedAt,
        components: pkg.components.map(c => ({
            id: c.id, type: c.type, label: c.label, dependencies: c.dependencies,
            ...(preview.has(c.id) && c.type === 'memory' ? { content: c.content, contentHash: c.contentHash, preview: true } : {}),
        })),
        listing_only: true,
        entitled: false,
        sale: saleView(sale),
        buy: buyLine(sale),
    };
}

/**
 * The sale and listing of a group listed for sale (on sale or paused, with a price and a published
 * version), or null. What GET /v1/packages/:groupId and aimeat_package_get answer a reader with no
 * purchase, and what aimeat_package_buy reads before it opens a checkout.
 */
export async function listingFor(storage: Storage, groupId: string): Promise<{ sale: AccountSale; listing: Record<string, unknown> } | null> {
    const sale = await readAccountSale(storage, groupId);
    if (!sale || sale.state === 'ended' || !currentPrice(sale)) return null;
    const latest = await storage.getLatestPublished(groupId);
    return latest ? { sale, listing: listingOf(latest, sale) } : null;
}

function parsePrice(raw: unknown): { amount: number; currency: string } | Fail {
    const o = raw as { amount?: unknown; currency?: unknown } | null;
    if (!o || typeof o !== 'object') return fail(400, 'INVALID_INPUT', 'price is { amount, currency }, or null to end the sale.');
    const currency = typeof o.currency === 'string' ? o.currency.toUpperCase() : '';
    if (!(MONEY_CURRENCIES as readonly string[]).includes(currency)) {
        return fail(400, 'INVALID_INPUT', `price.currency is one of ${MONEY_CURRENCIES.join(', ')}. A morsel is pacing, never a price.`);
    }
    if (typeof o.amount !== 'number' || !Number.isFinite(o.amount) || o.amount <= 0 || o.amount > MAX_PRICE_MICROS) {
        return fail(400, 'INVALID_INPUT', 'price.amount is a positive number of micro-units (1 EUR = 1000000), at most one million.');
    }
    return { amount: integerMicros(o.amount), currency };
}

/**
 * Set the price of the caller's own package, its state, or which components show before purchase.
 * `price` null ends the sale. Refused before anything is written: not the author, a version that is
 * not private, no payment account, a currency no rail settles, a preview that is not a memory part.
 */
export async function setAccountPrice(
    deps: { storage: Storage; config: AimeatConfig },
    caller: { owner: string },
    groupId: string,
    input: { price?: unknown; state?: unknown; preview?: unknown },
): Promise<{ ok: true; sale: AccountSale } | Fail> {
    const { storage, config } = deps;
    const { versions } = await storage.listVersions(groupId, 1000, 0);
    const latest = versions[0];
    if (!latest) return fail(404, 'NOT_FOUND', `Package not found: ${groupId}`);
    if (latest.author !== caller.owner || caller.owner.includes('@')) {
        return fail(403, 'FORBIDDEN', 'Only the package\'s author sets its price: the money reaches the author\'s own payment account.');
    }
    if (input.state !== undefined && !STATES.includes(input.state as AccountSaleState)) {
        return fail(400, 'INVALID_INPUT', 'state is "on_sale", "paused" or "ended".');
    }
    const prev = await readAccountSale(storage, groupId);
    let price: { amount: number; currency: string } | null | undefined;
    if (input.price === null) price = null;
    else if (input.price !== undefined) {
        const p = parsePrice(input.price);
        if ('ok' in p) return p;
        price = p;
    }
    if (price === undefined && !prev) return fail(400, 'INVALID_INPUT', 'A package that is not on sale yet needs a price.');
    const state: AccountSaleState = price === null ? 'ended'
        : (input.state as AccountSaleState | undefined) ?? (price !== undefined ? 'on_sale' : prev!.state);
    let preview = prev?.preview ?? [];
    if (input.preview !== undefined) {
        if (!Array.isArray(input.preview) || input.preview.length > MAX_PREVIEW || input.preview.some(id => typeof id !== 'string')) {
            return fail(400, 'INVALID_INPUT', `preview is a list of at most ${MAX_PREVIEW} component ids.`);
        }
        const memoryIds = new Set(latest.components.filter(c => c.type === 'memory').map(c => c.id));
        const bad = (input.preview as string[]).filter(id => !memoryIds.has(id));
        if (bad.length) {
            return fail(400, 'INVALID_INPUT', `A preview is a memory part of the package that anyone may read before buying (screenshots, a description). Not one: ${bad.join(', ')}.`);
        }
        preview = [...new Set(input.preview as string[])];
    }
    const selling = state !== 'ended';
    const next = price ?? (price === null ? null : currentPrice(prev));
    if (selling) {
        const open = versions.filter(v => v.visibility !== 'private');
        if (open.length) {
            return fail(409, 'PRICE_NEEDS_PRIVATE', 'A priced package is read only by its buyers, so every version of it must be private first. Its listing stays visible while it is on sale.');
        }
        if (!(await hasPaymentAccount(storage, `${caller.owner}@${config.nodeId}`))) {
            return fail(409, 'NO_PAYMENT_ACCOUNT', 'Connect your own Stripe account first (Wallet page, or aimeat_commerce_psp_set), so the buyer\'s payment reaches you.');
        }
        if (next && !listPaymentHandlers().some(h => h.currencies.includes(next.currency))) {
            return fail(422, 'CURRENCY_NOT_SUPPORTED', `No payment method on this node settles ${next.currency}.`);
        }
    }
    const now = new Date().toISOString();
    const sale = await updateRecord<AccountSale | null>(storage, NS_PACKAGE_ACCOUNT_SALES, saleKey(groupId), parseSale, cur => {
        const base: AccountSale = cur ?? { groupId, author: latest.author, state, prices: [], preview: [], purchases: [], updatedAt: now };
        const prices = [...base.prices];
        const last = prices[prices.length - 1];
        if (price && (!last || last.amount !== price.amount || last.currency !== price.currency)) {
            prices.push({ id: `p${prices.length + 1}`, amount: price.amount, currency: price.currency, createdAt: now });
        }
        return { ...base, state, prices, preview, updatedAt: now };
    }, { tag: 'package-account-sale' });
    emitChange('packages');
    return { ok: true, sale: sale! };
}

export interface ForSaleQuery { category?: string; author?: string; search?: string; limit?: number; offset?: number }

/** The priced packages on sale or paused, newest first, as listings. */
export async function listForSale(storage: Storage, query: ForSaleQuery = {}): Promise<{ packages: Record<string, unknown>[]; total: number }> {
    const rows = await storage.listMemory(NS_PACKAGE_ACCOUNT_SALES, { prefix: 'sale.' });
    const q = (query.search ?? '').trim().toLowerCase();
    const out: Array<{ at: string; listing: Record<string, unknown> }> = [];
    for (const row of rows) {
        const sale = parseSale(row.value);
        if (!sale || sale.state === 'ended' || !currentPrice(sale)) continue;
        if (query.author && sale.author !== query.author) continue;
        const pkg = await storage.getLatestPublished(sale.groupId);
        if (!pkg || pkg.visibility !== 'private') continue;
        if (query.category && pkg.category !== query.category) continue;
        if (q && ![pkg.name, pkg.description, ...(pkg.tags ?? [])].some(f => String(f ?? '').toLowerCase().includes(q))) continue;
        out.push({ at: pkg.updatedAt || pkg.createdAt, listing: listingOf(pkg, sale) });
    }
    out.sort((a, b) => b.at.localeCompare(a.at));
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const offset = Math.max(0, query.offset ?? 0);
    return { packages: out.slice(offset, offset + limit).map(o => o.listing), total: out.length };
}

/** A purchase as its buyer or its author reads it. */
function purchaseRow(p: AccountPurchase, active: boolean): Record<string, unknown> {
    return {
        buyer: p.buyer, order: p.order, amount: p.amount, currency: p.currency, bought_at: p.boughtAt,
        // `pending`: paid while the checkout was completing, and the checkout did not complete (a later
        // line failed and the payment was refunded, or it is still running).
        state: p.state === 'paid' ? (active ? 'paid' : 'pending') : p.state,
        ...(p.refundedAt ? { refunded_at: p.refundedAt } : {}),
        covers: p.covers,
    };
}

/** What the caller bought: one row per package, its newest purchase. Only the caller's own. */
export async function purchasesOf(storage: Storage, buyer: string): Promise<Array<Record<string, unknown>>> {
    if (!buyer || buyer.includes('@')) return [];
    const rows = await storage.listMemory(NS_PACKAGE_ACCOUNT_SALES, { prefix: 'sale.' });
    const out: Array<Record<string, unknown>> = [];
    for (const row of rows) {
        const sale = parseSale(row.value);
        const mine = sale?.purchases.filter(p => p.buyer === buyer) ?? [];
        if (!sale || !mine.length) continue;
        const newest = mine[mine.length - 1]!;
        const active = await activePurchase(storage, sale, buyer);
        const pkg = await storage.getLatestPublished(sale.groupId);
        out.push({
            group_id: sale.groupId, name: pkg?.name ?? sale.groupId.split('::')[0], author: sale.author,
            ...purchaseRow(newest, !!active && active.order === newest.order),
            entitled: !!active,
            install: active ? `POST /v1/packages/${encodeURIComponent(sale.groupId)}/install` : null,
        });
    }
    return out;
}

/** The author's view of their sale: the sale, every price, and every purchase. */
export async function salesOf(
    storage: Storage, caller: { owner: string }, groupId: string,
): Promise<{ ok: true; view: Record<string, unknown> } | Fail> {
    const sale = await readAccountSale(storage, groupId);
    if (!sale) {
        const latest = (await storage.listVersions(groupId, 1, 0)).versions[0];
        if (!latest) return fail(404, 'NOT_FOUND', `Package not found: ${groupId}`);
        if (latest.author !== caller.owner) return fail(403, 'FORBIDDEN', 'Only the package\'s author reads its sales.');
        return { ok: true, view: { group_id: groupId, on_sale: false, sales: [], totals: {} } };
    }
    if (sale.author !== caller.owner) return fail(403, 'FORBIDDEN', 'Only the package\'s author reads its sales.');
    const rows: Array<Record<string, unknown>> = [];
    const totals: Record<string, number> = {};
    for (const p of sale.purchases) {
        const active = await activePurchase(storage, sale, p.buyer);
        const isActive = !!active && active.order === p.order;
        rows.push(purchaseRow(p, isActive));
        if (isActive) totals[p.currency] = (totals[p.currency] ?? 0) + p.amount;
    }
    return { ok: true, view: { ...saleView(sale), on_sale: sale.state === 'on_sale', prices: sale.prices, sales: rows.reverse(), totals } };
}

/** Set one purchase's state on the record's version, only when it is in `from`. Answers whether it moved. */
async function movePurchase(
    storage: Storage, groupId: string, order: string, from: AccountPurchase['state'], to: AccountPurchase['state'],
): Promise<boolean> {
    let moved = false;
    await updateRecord<AccountSale | null>(storage, NS_PACKAGE_ACCOUNT_SALES, saleKey(groupId), parseSale, cur => {
        moved = false;
        if (!cur) return UNCHANGED;
        const i = cur.purchases.findIndex(p => p.order === order);
        if (i < 0 || cur.purchases[i]!.state !== from) return UNCHANGED;
        const purchases = [...cur.purchases];
        purchases[i] = { ...purchases[i]!, state: to, ...(to === 'refunded' ? { refundedAt: new Date().toISOString() } : {}) };
        moved = true;
        return { ...cur, purchases, updatedAt: new Date().toISOString() };
    }, { tag: 'package-account-sale' });
    return moved;
}

async function tellBuyerRefunded(storage: Storage, config: AimeatConfig, sale: AccountSale, p: AccountPurchase): Promise<void> {
    await notify(storage, `${p.buyer}@${config.nodeId}`, {
        type: 'package_purchase_refunded', title: `Your purchase of ${sale.groupId.split('::')[0]} was refunded`,
        body: 'The author refunded the payment. The package can no longer be installed or updated from this account; copies you installed stay as they are.',
        link: '/v1/profile?tab=packages', i18n: { key: 'package_purchase_refunded', vars: { name: sale.groupId.split('::')[0] } },
    });
}

/**
 * The author refunds one completed purchase on the rail that collected it, on the author's own
 * payment account. The purchase stops counting once the rail says the money went back.
 */
export async function refundPurchase(
    deps: { storage: Storage; config: AimeatConfig }, caller: { owner: string }, groupId: string, order: string,
): Promise<{ ok: true; refund: Record<string, unknown> } | Fail> {
    const { storage, config } = deps;
    const sale = await readAccountSale(storage, groupId);
    if (!sale) return fail(404, 'NOT_FOUND', `${groupId} is not sold here.`);
    if (sale.author !== caller.owner) return fail(403, 'FORBIDDEN', 'Only the package\'s author refunds its sales.');
    const p = sale.purchases.find(x => x.order === order);
    if (!p) return fail(404, 'NOT_FOUND', `No purchase of ${groupId} with order ${order}.`);
    if (p.state === 'refunded') return fail(409, 'ALREADY_REFUNDED', 'This purchase was refunded already.');
    if (p.state === 'refunding') return fail(409, 'REFUND_RUNNING', 'A refund of this purchase is running now.');
    const active = await activePurchase(storage, sale, p.buyer);
    if (!active || active.order !== order) {
        return fail(409, 'NOT_COMPLETED', 'This checkout did not complete, so it holds no payment to refund.');
    }
    const handler = listPaymentHandlers().find(h => h.id === p.handler);
    if (!handler) return fail(409, 'RAIL_UNAVAILABLE', `The payment method that collected this purchase (${p.handler}) is not available on this node now. Refund it in your payment account directly.`);
    // Claimed before the rail is asked: of two refunds at the same moment, the second is REFUND_RUNNING.
    if (!(await movePurchase(storage, groupId, order, 'paid', 'refunding'))) {
        return fail(409, 'REFUND_RUNNING', 'A refund of this purchase is running now.');
    }
    const psp = await readPsp(storage, p.sellerGhii);
    const outcome = await refundCollected({ config, storage }, handler, {
        buyerGhii: `${p.buyer}@${config.nodeId}`, amount: p.amount, trackingCode: p.trackingCode ?? '',
        seller: { ghii: p.sellerGhii, owner: sale.author, psp },
    });
    if (outcome.outcome !== 'refunded' && outcome.outcome !== 'nothing_captured') {
        await movePurchase(storage, groupId, order, 'refunding', 'paid');
        return fail(502, 'REFUND_FAILED', `The payment method did not return the money (${outcome.outcome}), so the purchase stands. Try again, or refund it in your payment account directly.`);
    }
    await movePurchase(storage, groupId, order, 'refunding', 'refunded');
    await tellBuyerRefunded(storage, config, sale, p);
    emitChange('packages');
    return { ok: true, refund: { group_id: groupId, order, buyer: p.buyer, amount: p.amount, currency: p.currency, outcome: outcome.outcome, state: 'refunded' } };
}

/**
 * A full refund the author's own payment account reported (the Stripe webhook's charge.refunded):
 * the purchase it paid for stops counting. Answers the order it ended, or null when no purchase of
 * this author was paid with that charge.
 */
export async function refundByTrackingCode(
    storage: Storage, config: AimeatConfig, sellerGhii: string, trackingCode: string,
): Promise<string | null> {
    if (!trackingCode) return null;
    const rows = await storage.listMemory(NS_PACKAGE_ACCOUNT_SALES, { prefix: 'sale.' });
    for (const row of rows) {
        const sale = parseSale(row.value);
        const p = sale?.purchases.find(x => x.sellerGhii === sellerGhii && x.trackingCode === trackingCode && x.state !== 'refunded');
        if (!sale || !p) continue;
        if (await movePurchase(storage, sale.groupId, p.order, p.state, 'refunded')) {
            await tellBuyerRefunded(storage, config, sale, p);
            emitChange('packages');
            return p.order;
        }
    }
    return null;
}
