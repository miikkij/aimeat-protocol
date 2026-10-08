/**
 * @file src/services/visibility/merchant-feed-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's product feeds (layer E): the switch and choices (`signals.visibility.feed`)
 *   and the push of the catalog into the owner's OWN Stripe for Stripe's Agentic Commerce Suite,
 *   which is the documented way Copilot Checkout reaches a Stripe merchant.
 *
 *   THE OWNER'S OWN ACCOUNTS ONLY. Merchant Center fetches the feed from the place's address with
 *   the owner's own Merchant Center account; the catalog goes into the owner's own Stripe with the
 *   secret key the owner set for selling (commerce.psp). The node holds no Merchant Center or Stripe
 *   account of its own and pushes nothing anywhere else.
 *
 *   THE STRIPE IMPORT, as docs.stripe.com/api/v2/commerce/product-catalog-imports describes it
 *   (read 2026-10-08): POST /v2/commerce/product_catalog/imports { feed_type: product, mode },
 *   then PUT the CSV to status_details.awaiting_upload.upload_url.url (valid five minutes), then
 *   GET the import for its status. The API is a preview: the version header is pinned here and the
 *   answer is kept on the record so the owner sees what Stripe said.
 * @structure FEED_KEY · getFeedSettings · setFeedSettings · syncStripeCatalog · FeedSettingsError
 * @usage const s = await setFeedSettings(storage, ownerGhii, { enabled: true });
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (layer E).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { FeedSettings } from './merchant-feed.js';
import { listOwnerProducts, stripeCatalogCsv } from './merchant-feed.js';
import { openPspSecret } from '../../commerce/psp-secrets.js';
import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import { readText } from '../../utils/read-capped.js';

/** The most of a Stripe answer this reads. An import object is a few kB. */
const STRIPE_BODY_MAX = 512 * 1024;

export const FEED_KEY = 'signals.visibility.feed';
/** The version header the Stripe catalog import is pinned to. */
export const STRIPE_CATALOG_VERSION = '2026-09-30.preview';

export interface StripeImportState {
  id: string | null;
  status: string;
  at: string;
  successCount: number | null;
  errorCount: number | null;
  /** Stripe's own words when it refused or failed, or the first row errors. */
  message: string | null;
}

export interface StoredFeed extends FeedSettings {
  lastStripeImport: StripeImportState | null;
  updatedAt: string;
}

export class FeedSettingsError extends Error {
  constructor(public code: string, public statusCode: number, message: string) {
    super(message);
    this.name = 'FeedSettingsError';
  }
}

const EMPTY: StoredFeed = {
  enabled: false, brand: null, returnPolicyLabel: null, productLinks: {}, storeUrl: null,
  lastStripeImport: null, updatedAt: '',
};

export async function getFeedSettings(storage: Storage, ownerGhii: string): Promise<StoredFeed> {
  const row = await storage.getMemory(ownerGhii, FEED_KEY);
  const v = (row?.value ?? {}) as Partial<StoredFeed>;
  return {
    ...EMPTY, ...v,
    enabled: v.enabled === true,
    productLinks: v.productLinks && typeof v.productLinks === 'object' ? { ...v.productLinks } : {},
  };
}

async function writeFeed(storage: Storage, ownerGhii: string, feed: StoredFeed): Promise<void> {
  const existing = await storage.getMemory(ownerGhii, FEED_KEY);
  const now = new Date().toISOString();
  await storage.setMemory({
    key: FEED_KEY, ownerGaii: ownerGhii, value: feed as unknown as Record<string, unknown>,
    visibility: 'owner', tags: ['signal-visibility'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  } as MemoryRecord);
}

export interface FeedSettingsInput {
  enabled?: boolean;
  brand?: string | null;
  returnPolicyLabel?: string | null;
  storeUrl?: string | null;
  /** Merged into the stored map; a null value removes that sku's link. */
  productLinks?: Record<string, string | null>;
}

const MAX_LINKS = 500;

/** Change the owner's feed settings. Only the fields given change; a bad value is refused before any write. */
export async function setFeedSettings(storage: Storage, ownerGhii: string, input: FeedSettingsInput): Promise<StoredFeed> {
  const url = (raw: string, field: string): string => {
    const u = URL.parse(raw);
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) {
      throw new FeedSettingsError('INVALID_INPUT', 400, `${field} must be an absolute https address.`);
    }
    return u.toString();
  };
  const feed = await getFeedSettings(storage, ownerGhii);
  if (input.enabled !== undefined) feed.enabled = input.enabled;
  if (input.brand !== undefined) feed.brand = input.brand ? input.brand.trim().slice(0, 70) || null : null;
  if (input.returnPolicyLabel !== undefined) {
    feed.returnPolicyLabel = input.returnPolicyLabel ? input.returnPolicyLabel.trim().slice(0, 50) || null : null;
  }
  if (input.storeUrl !== undefined) feed.storeUrl = input.storeUrl ? url(input.storeUrl, 'store_url') : null;
  if (input.productLinks) {
    for (const [sku, link] of Object.entries(input.productLinks)) {
      if (!sku || sku.length > 300 || ['__proto__', 'constructor', 'prototype'].includes(sku)) {
        throw new FeedSettingsError('INVALID_INPUT', 400, `product_links has a key that is not a sku: ${sku.slice(0, 40)}`);
      }
      if (link === null) delete feed.productLinks[sku];
      else feed.productLinks[sku] = url(link, `product_links["${sku}"]`);
    }
    if (Object.keys(feed.productLinks).length > MAX_LINKS) {
      throw new FeedSettingsError('INVALID_INPUT', 400, `At most ${MAX_LINKS} product links.`);
    }
  }
  feed.updatedAt = new Date().toISOString();
  await writeFeed(storage, ownerGhii, feed);
  return feed;
}

/** Whether the operator left this layer on for the node. On unless set to false. */
export const nodeAllowsFeeds = (config: AimeatConfig): boolean => config.merchantFeedEnabled !== false;

/** The public feed addresses of one owner. */
export function feedUrls(config: AimeatConfig, ownerName: string): { merchant_center: string; stripe_catalog: string } {
  const base = `${config.baseUrl.replace(/\/$/, '')}/v1/visibility/feeds/${encodeURIComponent(ownerName)}`;
  return { merchant_center: `${base}/merchant-center.txt`, stripe_catalog: `${base}/stripe-catalog.csv` };
}

/**
 * The feed as REST and MCP answer it: the settings, the public addresses, what is listed and what
 * was left out with the reason, the last Stripe import, and what the owner still has to do.
 */
export async function describeFeed(
  storage: Storage, config: AimeatConfig, ownerGhii: string, ownerName: string,
): Promise<Record<string, unknown>> {
  const feed = await getFeedSettings(storage, ownerGhii);
  const listing = await listOwnerProducts(storage, config, ownerGhii, feed);
  const todo: string[] = [];
  if (!feed.enabled) todo.push('Switch the feed on (enabled: true): until then both feed addresses answer 404.');
  if (listing.products.length === 0) todo.push('Give an offer or an app tool a public USD price: only those can be listed.');
  const toStore = listing.products.filter((p) => p.linkIsStore).length;
  if (toStore) todo.push(`${toStore} product(s) link to the store's front page. Merchant Center expects a page per product with the same price: set product_links for them.`);
  if (!feed.returnPolicyLabel) todo.push('Set the return policy in Merchant Center (Store settings > UCP settings) and give its label here (return_policy_label); Microsoft requires one for Copilot Checkout.');
  todo.push('In your own Merchant Center account, add a feed with "Automatically download file from URL" and the merchant_center address. Merchant Center fetches it once a day, so a price change reaches it by the next day.');
  return {
    enabled: feed.enabled,
    node_enabled: nodeAllowsFeeds(config),
    brand: feed.brand,
    return_policy_label: feed.returnPolicyLabel,
    store_url: feed.storeUrl,
    product_links: feed.productLinks,
    urls: feedUrls(config, ownerName),
    products: listing.products.map((p) => ({
      id: p.id, sku: p.sku, kind: p.kind, title: p.title, price: `${(p.priceMicros / 1_000_000).toFixed(2)} USD`,
      link: p.link, link_is_store_front: p.linkIsStore,
    })),
    skipped: listing.skipped,
    stripe: feed.lastStripeImport,
    todo,
    reading: 'Copilot Checkout serves US buyers in USD. Microsoft has not said whether digital products qualify; Merchant Center\'s own validation in your account is the answer. Packages are not listed: a package installs on an AIMEAT node, and a shopper in a chat has none.',
  };
}

/** One Stripe call with the owner's key, JSON in and out. Stripe's own message comes back on failure. */
async function stripeV2(key: string, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await safeFetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': STRIPE_CATALOG_VERSION,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await readText(res, STRIPE_BODY_MAX);
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch (e) {
    // A proxy or an outage answers HTML: keep the first words of it as the reason.
    logger.warn('merchant-feed: Stripe answered something that is not JSON', { status: res.status, error: String(e) });
    parsed = { error: { message: text.slice(0, 200) } };
  }
  if (!res.ok) {
    const msg = (parsed.error as { message?: string } | undefined)?.message ?? `Stripe answered ${res.status}`;
    throw new FeedSettingsError('STRIPE_REFUSED', res.status === 401 || res.status === 403 ? 403 : 502, msg);
  }
  return parsed;
}

function importState(obj: Record<string, unknown>): StripeImportState {
  const status = String(obj.status ?? 'unknown');
  const details = (obj.status_details ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const d = details[status] ?? {};
  const samples = Array.isArray(d.samples) ? (d.samples as Array<{ field?: string; error_message?: string }>) : [];
  return {
    id: typeof obj.id === 'string' ? obj.id : null,
    status,
    at: new Date().toISOString(),
    successCount: typeof d.success_count === 'number' ? d.success_count : null,
    errorCount: typeof d.error_count === 'number' ? d.error_count : null,
    message: typeof d.failure_message === 'string' ? d.failure_message
      : samples.length ? samples.slice(0, 3).map((s) => `${s.field ?? '?'}: ${s.error_message ?? ''}`).join('; ') : null,
  };
}

/**
 * Push the owner's catalog into their own Stripe, or, with `checkOnly`, read the last import's
 * status again. The result is kept on the feed record either way.
 */
export async function syncStripeCatalog(
  storage: Storage, config: AimeatConfig, ownerGhii: string, opts: { checkOnly?: boolean } = {},
): Promise<StripeImportState> {
  const feed = await getFeedSettings(storage, ownerGhii);
  const psp = (await storage.getMemory(ownerGhii, 'commerce.psp'))?.value as { secretKey?: unknown } | undefined;
  const key = openPspSecret(config, psp?.secretKey);
  if (!key) {
    throw new FeedSettingsError('PSP_NOT_CONFIGURED', 409, 'No Stripe key is set for selling. The owner sets it in the Wallet tab (Selling & payments), signed in themselves.');
  }
  let state: StripeImportState;
  if (opts.checkOnly) {
    if (!feed.lastStripeImport?.id) throw new FeedSettingsError('NOT_FOUND', 404, 'No catalog was sent to Stripe yet.');
    state = importState(await stripeV2(key, 'GET', `/v2/commerce/product_catalog/imports/${encodeURIComponent(feed.lastStripeImport.id)}`));
  } else {
    if (!feed.enabled) throw new FeedSettingsError('FEED_OFF', 409, 'The product feed is off. Switch it on first (enabled: true).');
    const listing = await listOwnerProducts(storage, config, ownerGhii, feed);
    if (listing.products.length === 0) {
      throw new FeedSettingsError('NOTHING_TO_SEND', 409, 'No product can be listed: an offer or a tool needs a public USD price in whole cents.');
    }
    const created = await stripeV2(key, 'POST', '/v2/commerce/product_catalog/imports', {
      feed_type: 'product', mode: 'replace', metadata: { file_name: 'aimeat-catalog.csv' },
    });
    const upload = ((created.status_details as Record<string, { upload_url?: { url?: string } }> | undefined)?.awaiting_upload?.upload_url?.url) ?? null;
    if (!upload) throw new FeedSettingsError('STRIPE_REFUSED', 502, 'Stripe gave no upload address for the catalog.');
    const put = await safeFetch(upload, {
      method: 'PUT', headers: { 'Content-Type': 'text/csv' }, body: stripeCatalogCsv(listing),
      signal: AbortSignal.timeout(30_000),
    });
    if (!put.ok) throw new FeedSettingsError('STRIPE_REFUSED', 502, `Stripe refused the catalog file (${put.status}).`);
    state = { ...importState(created), status: 'processing' };
  }
  feed.lastStripeImport = state;
  feed.updatedAt = new Date().toISOString();
  await writeFeed(storage, ownerGhii, feed);
  return state;
}
