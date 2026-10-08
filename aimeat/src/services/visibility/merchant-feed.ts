/**
 * @file src/services/visibility/merchant-feed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's products as feeds for the AI shopping agents (layer E): a Microsoft
 *   Merchant Center product feed for Copilot Checkout, and a Stripe Agentic Commerce product catalog,
 *   both built from what the owner already sells here, at the moment they are fetched, so a price
 *   change reaches the next fetch without anybody re-exporting anything.
 *
 *   WHAT IS IN IT. The owner's public offers and priced app tools that carry a USD price: Copilot
 *   Checkout serves US buyers in USD only. A package is left out: it installs on an AIMEAT node, and
 *   a shopper in a chat has none. An item priced in fractions of a cent is left out too, because a
 *   feed price is dollars and cents. Every item left out is named with its reason.
 *
 *   THE FIELD NAMES COME FROM THE PUBLISHED SPECIFICATIONS, read on 2026-10-08:
 *   - Merchant Center: learn.microsoft.com/advertising/msa-help hlp_ba_conc_aboutbingmerchantcentercatalogfile
 *     (ms.date 2026-06-18, updated 2026-07-27) and help article 60282 (UCP readiness): a
 *     tab-separated file; id (50), title (150), description (10000, no HTML), link, image_link,
 *     price ("23.99 USD"), availability, condition, brand, identifier_exists, return_policy_labels.
 *     Microsoft names "native checkout eligibility" and "Merchant Item ID" in prose only, with no
 *     attribute; `id` is the merchant product id, so nothing else is invented here.
 *   - Stripe: docs.stripe.com/agentic-commerce/concepts/catalog-feed: a CSV; id, title, description,
 *     link, image_link, availability (in_stock), price ("15.00 USD"), brand, mpn (when no gtin),
 *     google_product_category, inventory_not_tracked (digital goods).
 *
 *   THE ID IS A HASH OF THE SKU, because a sku (`offer:<agent>:<offer>`) is longer than either feed
 *   allows and carries characters Stripe refuses. It is deterministic, so an order that names the id
 *   is resolved back to its sku by building the list again (resolveFeedId).
 * @structure FeedProduct · FeedSettings · listOwnerProducts · merchantCenterTsv · stripeCatalogCsv ·
 *   resolveFeedId · feedIdOf
 * @usage const { products } = await listOwnerProducts(storage, config, ownerGhii, settings);
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (layer E).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { Offer } from '../../models/offer-schemas.js';
import { listPricedAppTools } from '../../commerce/app-tool-catalog.js';
import { ownerGhiiOf, localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

/** The owner's choices for the feeds. Stored in `signals.visibility.feed` (merchant-feed-settings.ts). */
export interface FeedSettings {
  /** The feeds answer only when the owner switched them on. */
  enabled: boolean;
  /** Shown as `brand` and `seller_name`. Defaults to the owner's display name. */
  brand: string | null;
  /** The store's return policy label, as set in Merchant Center (Store settings > UCP settings). */
  returnPolicyLabel: string | null;
  /** A product page per sku, when the owner has one. Otherwise the app's own page, or `storeUrl`. */
  productLinks: Record<string, string>;
  /** Where a product without a page of its own links. Defaults to the place's front page. */
  storeUrl: string | null;
  /**
   * The owner's Stripe network profile (`profile_…`, Stripe Dashboard > Agentic commerce). With it
   * and a selling key, the place's own UCP checkout offers Stripe's `com.stripe.payments` handler.
   */
  stripeProfileId?: string | null;
}

export interface FeedProduct {
  /** The feed id: `aim` and 20 hex characters of the sku's hash. */
  id: string;
  sku: string;
  kind: 'offer' | 'app-tool';
  title: string;
  description: string;
  link: string;
  /** True when `link` is the store's front page rather than a page of this product. */
  linkIsStore: boolean;
  imageLink: string;
  /** In 6-decimal micro-units, USD. */
  priceMicros: number;
  brand: string;
}

export interface FeedListing {
  products: FeedProduct[];
  skipped: Array<{ sku: string; reason: string }>;
}

/** The deterministic feed id of a sku. */
export function feedIdOf(sku: string): string {
  return `aim${createHash('sha256').update(sku).digest('hex').slice(0, 20)}`;
}

/** One line of text a tab-separated or a comma-separated file can hold: no tab, no line break. */
function oneLine(text: string, max: number): string {
  return text.replace(/[\t\r\n]+/g, ' ').replace(/<[^>]*>/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

/** Micro-units to "12.34". Null when the amount is not whole cents. */
function dollars(micros: number): string | null {
  if (!Number.isInteger(micros) || micros <= 0 || micros % 10_000 !== 0) return null;
  return (micros / 1_000_000).toFixed(2);
}

const usdOf = (prices: Array<{ amount: number; currency: string }> | undefined | null): number | null =>
  prices?.find((p) => p.currency === 'USD')?.amount ?? null;

/** A URL a feed may carry: absolute https (or http on a local node). */
function safeUrl(raw: string | null | undefined, allowHttp: boolean): string | null {
  const u = raw ? URL.parse(raw) : null;
  if (!u) return null;
  if (u.protocol === 'https:' || (allowHttp && u.protocol === 'http:')) return u.toString();
  return null;
}

const FEED_CAP = 2_000;

/** The owner's products that can be sold to a US buyer in a chat, and what was left out. */
export async function listOwnerProducts(
  storage: Storage, config: AimeatConfig, ownerGhii: string, settings: FeedSettings,
): Promise<FeedListing> {
  const base = config.baseUrl.replace(/\/$/, '');
  const allowHttp = base.startsWith('http://');
  const owner = localAccountName(ownerGhii);
  const ownerRec = await storage.getOwner(owner).catch((e: unknown) => {
    logger.warn('merchant-feed: the owner could not be read', { owner, error: String(e) });
    return null;
  });
  const brand = oneLine(settings.brand || (ownerRec as { displayName?: string } | null)?.displayName || owner, 70);
  const store = safeUrl(settings.storeUrl, allowHttp) ?? `${base}/`;
  const fallbackImage = `${base}/og-image.png`;
  const products: FeedProduct[] = [];
  const skipped: FeedListing['skipped'] = [];
  const linkFor = (sku: string, own: string | null): { link: string; linkIsStore: boolean } => {
    const chosen = Object.hasOwn(settings.productLinks, sku) ? safeUrl(settings.productLinks[sku], allowHttp) : null;
    if (chosen) return { link: chosen, linkIsStore: false };
    if (own) return { link: own, linkIsStore: false };
    return { link: store, linkIsStore: true };
  };

  // Offers of the owner's agents: `agents.<name>.offers`, written under the agent's own GAII.
  const { items } = await storage.listAllMemory({ prefix: 'agents.', limit: 2000 });
  for (const rec of items) {
    if (!/^agents\.[^.]+\.offers$/.test(rec.key) || ownerGhiiOf(rec.ownerGaii) !== ownerGhii) continue;
    for (const offer of ((rec.value as { offers?: Offer[] } | undefined)?.offers) ?? []) {
      const sku = `offer:${rec.ownerGaii}:${offer.id}`;
      if ((offer.visibility ?? 'private') !== 'public') continue;
      const usd = usdOf([...(offer.priceMoney ? [offer.priceMoney] : []), ...(offer.pricesMoney ?? [])]);
      if (usd === null) { skipped.push({ sku, reason: 'no USD price' }); continue; }
      if (dollars(usd) === null) { skipped.push({ sku, reason: 'the USD price is not whole cents' }); continue; }
      products.push({
        id: feedIdOf(sku), sku, kind: 'offer',
        title: oneLine(offer.title, 150), description: oneLine(offer.ask, 5000),
        ...linkFor(sku, null), imageLink: fallbackImage, priceMicros: usd, brand,
      });
      if (products.length >= FEED_CAP) break;
    }
  }

  // Priced app tools on the owner's public apps.
  for (const t of await listPricedAppTools(storage, config, FEED_CAP)) {
    if (t.ownerName !== owner || products.length >= FEED_CAP) continue;
    const usd = usdOf(t.pricesMoney ?? (t.priceMoney ? [t.priceMoney] : []));
    if (usd === null) { skipped.push({ sku: t.sku, reason: 'no USD price' }); continue; }
    if (dollars(usd) === null) { skipped.push({ sku: t.sku, reason: 'the USD price is not whole cents' }); continue; }
    const appPage = `${base}/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(t.appId)}?mode=inline`;
    products.push({
      id: feedIdOf(t.sku), sku: t.sku, kind: 'app-tool',
      title: oneLine(`${t.appId.replace(/\.html?$/i, '')}: ${t.name}`, 150),
      description: oneLine(t.description || t.name, 5000),
      ...linkFor(t.sku, appPage), imageLink: fallbackImage, priceMicros: usd, brand,
    });
  }
  return { products, skipped };
}

/** The sku a feed id stands for, among the owner's current products. */
export function resolveFeedId(listing: FeedListing, id: string): FeedProduct | null {
  return listing.products.find((p) => p.id === id) ?? null;
}

/** The Merchant Center product feed: tab-separated, a header row, one row per product. */
export function merchantCenterTsv(listing: FeedListing, settings: FeedSettings): string {
  const cols = ['id', 'title', 'description', 'link', 'image_link', 'price', 'availability', 'condition', 'brand', 'identifier_exists', 'product_type', 'seller_name', 'return_policy_labels'];
  const rows = listing.products.map((p) => [
    p.id, p.title, oneLine(p.description, 10_000), p.link, p.imageLink, `${dollars(p.priceMicros)} USD`,
    'in stock', 'new', p.brand, 'no', p.kind === 'offer' ? 'Digital service' : 'Software > Digital tool',
    p.brand, settings.returnPolicyLabel ? oneLine(settings.returnPolicyLabel, 50) : '',
  ].map((v) => oneLine(String(v), 10_000)).join('\t'));
  return [cols.join('\t'), ...rows].join('\n') + '\n';
}

/** A value for a CSV cell (RFC 4180): quoted when it holds a comma, a quote or a line break. */
function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The Stripe Agentic Commerce product catalog: comma-separated, a header row, one row per product. */
export function stripeCatalogCsv(listing: FeedListing): string {
  const cols = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'mpn', 'google_product_category', 'inventory_not_tracked'];
  const rows = listing.products.map((p) => [
    p.id, p.title, p.description, p.link, p.imageLink, 'in_stock', `${dollars(p.priceMicros)} USD`,
    p.brand, p.id, 'Software', 'true',
  ].map((v) => csvCell(oneLine(String(v), 5000))).join(','));
  return [cols.join(','), ...rows].join('\n') + '\n';
}
