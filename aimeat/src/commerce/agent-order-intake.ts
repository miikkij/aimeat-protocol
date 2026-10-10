/**
 * @file src/commerce/agent-order-intake.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An order an AI shopping agent placed through Stripe's Agentic Commerce Suite (the
 *   way Copilot Checkout reaches a Stripe merchant), turned into an order of the seller here and its
 *   fulfilment. Stripe hosts that checkout and charges on the seller's own Stripe; the seller's
 *   Stripe then sends `checkout.session.completed` to the seller's webhook on this node
 *   (routes/commerce-webhooks.ts), which calls intakeAgentOrder.
 *
 *   WHICH SESSIONS ARE OURS. A Stripe account sees every checkout its owner runs, most of them not
 *   from an agent. A session is taken here only when at least one line's
 *   `price.external_reference` is the feed id of one of the seller's listed products
 *   (services/visibility/merchant-feed.ts), because that id exists only in the catalog this node
 *   pushed. Anything else is acknowledged and left alone.
 *
 *   AS STRIPE DOCUMENTS IT (docs.stripe.com/agentic-commerce/sellers/use-cases/retail, read
 *   2026-10-08): retrieve the session with `expand[]=line_items.data.price.product` under
 *   `Stripe-Version: 2025-12-15.preview`; the sku is `line_items.data[].price.external_reference`,
 *   the quantity and unit amount are on the line, the buyer is `customer_details`, and the agent is
 *   `payment_intent.agent_details` (private preview, so read defensively).
 *
 *   ONCE PER SESSION. The order key is the Stripe session id: a redelivered event finds the order
 *   and does nothing more. The key is claimed with an atomic insert before any task is created, so
 *   two deliveries running at the same moment produce one set of tasks.
 * @structure ACS_STRIPE_VERSION · intakeAgentOrder · IntakeResult
 * @usage const r = await intakeAgentOrder(storage, config, ownerGhii, sessionObject, event.id);
 * @version-history
 *   v1.1.0 — 2026-10-10 — The order key is claimed with createMemoryIfAbsent before the fulfilment
 *     tasks are created; a concurrent delivery answers already_taken (secaudit 2026-10-10 I1).
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer E).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { CheckoutSessionRecord, CheckoutLineItem } from './types.js';
import { openPspSecret } from './psp-secrets.js';
import { createFulfillmentTask } from './fulfillment.js';
import { safeFetch } from '../utils/url-validator.js';
import { readText } from '../utils/read-capped.js';
import { localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { recordAccountEvent } from '../services/account-events.js';
import { getFeedSettings } from '../services/visibility/merchant-feed-settings.js';
import { listOwnerProducts, resolveFeedId } from '../services/visibility/merchant-feed.js';
import { recordPurchase } from '../services/visibility/visibility-counter.js';
import { aiFamilyOfHost } from '../services/visibility/channel.js';
import { AI_FAMILIES } from '../models/visibility-schemas.js';

/** The version header Stripe's agentic order guide retrieves a session with. */
export const ACS_STRIPE_VERSION = '2025-12-15.preview';
/** The handler id an intake order's receipt names. */
export const ACS_HANDLER_ID = 'com.stripe.acs';

const orderKey = (id: string): string => `commerce.order.${id}`;

export interface IntakeResult {
  action: 'agent_order' | 'already_taken' | 'not_an_agent_order';
  orderId?: string;
  taskIds?: string[];
}

/** The AI family an agent Stripe names, from whatever of its fields says who it is. */
function agentFamily(details: unknown): string {
  const d = (details ?? {}) as Record<string, unknown>;
  const words = [d.name, d.display_name, d.network_business_profile, d.url, d.domain]
    .filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase());
  for (const w of words) {
    const host = URL.parse(w.startsWith('http') ? w : `https://${w}`)?.hostname ?? '';
    const byHost = host ? aiFamilyOfHost(host) : null;
    if (byHost) return byHost;
    const named = (AI_FAMILIES as readonly string[]).find((f) => f !== 'other' && w.includes(f));
    if (named) return named;
    if (w.includes('microsoft') || w.includes('bing')) return 'copilot';
    if (w.includes('openai')) return 'chatgpt';
  }
  return 'other';
}

/**
 * Take one completed Stripe checkout session of the seller as an agent order, when it is one.
 * Throws only when Stripe cannot be read; the webhook then answers 500 and Stripe delivers again.
 */
export async function intakeAgentOrder(
  storage: Storage, config: AimeatConfig, sellerGhii: string, sessionObject: Record<string, unknown>, eventId: string,
): Promise<IntakeResult> {
  const stripeSessionId = typeof sessionObject.id === 'string' ? sessionObject.id : '';
  if (!/^cs_[A-Za-z0-9_]{4,200}$/.test(stripeSessionId)) return { action: 'not_an_agent_order' };
  if (await storage.getMemory(sellerGhii, orderKey(stripeSessionId))) return { action: 'already_taken', orderId: stripeSessionId };

  const feed = await getFeedSettings(storage, sellerGhii);
  const listing = await listOwnerProducts(storage, config, sellerGhii, feed);
  if (listing.products.length === 0) return { action: 'not_an_agent_order' };

  const psp = (await storage.getMemory(sellerGhii, 'commerce.psp'))?.value as { secretKey?: unknown } | undefined;
  const key = openPspSecret(config, psp?.secretKey);
  if (!key) return { action: 'not_an_agent_order' };
  const url = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(stripeSessionId)}`
    + '?expand[]=line_items.data.price.product&expand[]=payment_intent';
  const res = await safeFetch(url, {
    headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': ACS_STRIPE_VERSION },
    signal: AbortSignal.timeout(15_000),
  });
  // A session with its lines expanded is tens of kB; a megabyte is far past anything Stripe sends.
  const text = await readText(res, 1024 * 1024);
  if (!res.ok) throw new Error(`Stripe answered ${res.status} for the checkout session: ${text.slice(0, 200)}`);
  const full = JSON.parse(text) as Record<string, unknown>;

  const lines = (((full.line_items as { data?: unknown[] } | undefined)?.data) ?? []) as Array<Record<string, unknown>>;
  const items: Array<CheckoutLineItem & { sku: string }> = [];
  for (const line of lines) {
    const price = (line.price ?? {}) as Record<string, unknown>;
    const ref = typeof price.external_reference === 'string' ? price.external_reference : '';
    const product = ref ? resolveFeedId(listing, ref) : null;
    if (!product) continue;
    const quantity = Number.isInteger(line.quantity) && (line.quantity as number) > 0 ? line.quantity as number : 1;
    const unitMinor = typeof price.unit_amount === 'number' ? price.unit_amount : Math.round(product.priceMicros / 10_000);
    const [, a, b] = product.sku.split(':');
    items.push({
      sku: product.sku,
      kind: product.kind,
      // An offer's line names the seller's agent; an app tool's task goes to the owner's own space.
      agent: product.kind === 'offer' ? product.sku.slice('offer:'.length, product.sku.lastIndexOf(':')) : sellerGhii,
      offerId: product.kind === 'offer' ? product.sku.slice(product.sku.lastIndexOf(':') + 1) : (b ?? ''),
      ...(product.kind === 'app-tool' ? { app: a } : {}),
      quantity, title: product.title, unitPrice: unitMinor * 10_000,
    });
  }
  if (items.length === 0) return { action: 'not_an_agent_order' };

  const customer = (full.customer_details ?? {}) as Record<string, unknown>;
  const email = typeof customer.email === 'string' ? customer.email.slice(0, 200) : null;
  const name = typeof customer.name === 'string' ? customer.name.slice(0, 200) : null;
  const intent = (full.payment_intent ?? {}) as Record<string, unknown>;
  const family = agentFamily(intent.agent_details);
  const total = typeof full.amount_total === 'number' ? full.amount_total * 10_000 : items.reduce((n, i) => n + i.unitPrice * i.quantity, 0);
  const now = new Date().toISOString();
  const order: CheckoutSessionRecord = {
    id: stripeSessionId,
    status: 'completed',
    buyerOwner: '',
    buyerGhii: '',
    buyerIdentity: `${family === 'other' ? 'An AI shopping agent' : `A ${family} agent`} for ${name ?? email ?? 'a buyer'}${email && name ? ` <${email}>` : ''}`,
    sellerOwner: localAccountName(sellerGhii),
    sellerGhii,
    items: items.map(({ sku: _sku, ...item }) => item),
    currency: String(full.currency ?? 'usd').toUpperCase(),
    total,
    receipt: { handler: ACS_HANDLER_ID, charged: total, earned: total, fee: 0, trackingCode: typeof intent.id === 'string' ? intent.id : stripeSessionId },
    attribution: { channel: 'ai', family, via: 'agent' },
    guest: { source: 'stripe-acs', platform: family, email, name, eventId },
    createdAt: now, updatedAt: now, expiresAt: now,
  };

  // Claim the order key before any side effect (secaudit 2026-10-10 I1). Two parallel deliveries of
  // the same event, or a Stripe retry after a slow first attempt, both pass the getMemory check at the
  // top; only one of them wins this insert, and the other answers already_taken without creating
  // tasks, counting the purchase or writing payment_received a second time.
  if (!storage.createMemoryIfAbsent) throw new Error('Agent order intake requires atomic storage creation.');
  order.fulfillment = { taskIds: [] };
  const claimed = await storage.createMemoryIfAbsent({
    key: orderKey(stripeSessionId), ownerGaii: sellerGhii, value: { ...order } as unknown as Record<string, unknown>,
    visibility: 'owner', tags: ['commerce'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
  if (!claimed) return { action: 'already_taken', orderId: stripeSessionId };

  const taskIds: string[] = [];
  for (const item of order.items) {
    try {
      taskIds.push(await createFulfillmentTask(storage, order, item, item.kind === 'app-tool' ? sellerGhii : undefined));
    } catch (e) {
      // The money has moved at Stripe; a task that cannot be written is the seller's to fulfil by
      // hand, so the order is still kept and says so.
      logger.error('agent-order: a fulfilment task could not be created', { order: stripeSessionId, error: String(e) });
    }
  }
  order.fulfillment = { taskIds };
  try {
    await storage.setMemory({ ...claimed, value: order as unknown as Record<string, unknown>, updatedAt: new Date().toISOString() });
  } catch (e) {
    // The order is already claimed and its tasks exist; a retry would answer already_taken, so a
    // failed update is logged rather than thrown, and the purchase is still counted once.
    logger.error('agent-order: the task ids could not be written to the order', { order: stripeSessionId, taskIds, error: String(e) });
  }
  recordPurchase(storage, config, { sellerGhii, channel: 'ai', family, via: 'agent', amount: total, currency: order.currency });
  void recordAccountEvent(storage, {
    ownerGhii: sellerGhii, kind: 'payment_received', actorGaii: sellerGhii, subject: stripeSessionId,
    link: `/v1/profile?tab=wallet&order=${encodeURIComponent(stripeSessionId)}`,
    data: { amount: `${(total / 1_000_000).toFixed(2)} ${order.currency}`, what: order.items.map((i) => i.title).join(', ').slice(0, 120), who: order.buyerIdentity.slice(0, 120) },
  }, config);
  return { action: 'agent_order', orderId: stripeSessionId, taskIds };
}
