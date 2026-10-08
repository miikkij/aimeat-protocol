/**
 * @file src/commerce/ucp-guest-checkout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The place's own Universal Commerce Protocol checkout for a buyer with no account
 *   here (UCP 2026-08-25, layer E): an AI shopping platform such as Copilot or Gemini creates a
 *   checkout for a person, pays it with a Stripe shared payment token charged on the SELLER's own
 *   Stripe, and receives the order and its fulfilment events as signed webhooks.
 *
 *   THE BUYER IS A GUEST. There is no AIMEAT account to debit or to notify, so this is not
 *   commerce/session-service.ts's buyer-centred checkout with a flag on it. It prices every line
 *   through the same sellable resolvers (the buyer is the marker GUEST_BUYER, which no account can
 *   have), charges through the same Stripe handler, books the seller's side with the same
 *   bookSessionlessSale every sale without an account uses, and creates the same fulfilment tasks.
 *
 *   WHERE IT LIVES. The checkout is kept under the SELLER's namespace (`commerce.ucp.session.<id>`)
 *   and expires on its own after 54 hours (six of them open, the UCP default, and two days for
 *   replays); the id carries the seller's account name, so a later call finds it without an index.
 *   An order is the seller's ordinary order record (`commerce.order.<id>`), so it shows wherever the
 *   seller's orders show, with `guest` and `ucpOrder` beside the usual fields.
 *
 *   WHAT IS SOLD. Offers and app tools with a USD price. A package installs on a node and is refused
 *   with item_unavailable. Every line is fulfilled by a task: an offer's goes to the seller's agent,
 *   an app tool's to the owner, because running a tool for a buyer needs the buyer's own token.
 *
 *   NOTHING IS TAKEN ON TRUST BUT THE TOKEN. The price is the seller's, re-read at completion. The
 *   shared payment token is bound by Stripe to an amount and the seller; a forged one fails at
 *   Stripe. A checkout is bound to the platform profile that created it, and every later call must
 *   name the same profile.
 * @structure UCP_VERSION · GUEST_BUYER · UcpGuestSession · UcpError · createGuestCheckout ·
 *   readGuestCheckout · updateGuestCheckout · cancelGuestCheckout · completeGuestCheckout ·
 *   sellerPaymentHandlers · toUcpCheckout · toUcpOrder · readUcpOrder · onUcpTaskDone ·
 *   deliverOrderWebhook · runUcpUpkeep
 * @usage const s = await createGuestCheckout(storage, config, { profileUrl, lineItems, buyer });
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer E).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Storage, MemoryRecord, AgentTaskRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { CheckoutSessionRecord, CheckoutLineItem, PaymentContext } from './types.js';
import { getSellableResolver, type SellableRef } from './sellable-resolvers.js';
import { getPaymentHandler } from './payment-handlers.js';
import { STRIPE_HANDLER_ID } from './stripe-handler.js';
import { bookSessionlessSale } from './session-service.js';
import { createFulfillmentTask } from './fulfillment.js';
import { CommerceError } from './errors.js';
import { PaymentError } from './payment-handlers.js';
import { openPspSecret } from './psp-secrets.js';
import { localAccountOf } from '../utils/gaii.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import { recordAccountEvent } from '../services/account-events.js';
import { recordPurchase, recordCheckoutStage, resolvePlaceOwner } from '../services/visibility/visibility-counter.js';
import { getFeedSettings } from '../services/visibility/merchant-feed-settings.js';
import { listOwnerProducts, resolveFeedId } from '../services/visibility/merchant-feed.js';
import { ucpAgentFamily } from '../services/visibility/attribution.js';
import { platformProfile } from '../services/ucp/platform-profile.js';
import { ucpSigningKey } from '../services/ucp/ucp-keys.js';
import { signMessage } from '../services/ucp/http-signatures.js';

export const UCP_VERSION = '2026-08-25';
/** The buyer every guest line is priced for. No account can be named this: it has a colon. */
export const GUEST_BUYER = 'ucp:guest';
/** UCP's default lifetime of an open checkout. */
const OPEN_MS = 6 * 3_600_000;
/** How long a checkout record is kept: open, then two days for idempotent replays. */
const KEEP_HOURS = 54;
const MAX_OPEN_PER_SELLER = 500;
const MAX_LINES = 20;
/** Webhook retries: a delivery that fails waits this long before the next try. Then it gives up. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];

const sessionKey = (id: string): string => `commerce.ucp.session.${id}`;
const orderKey = (id: string): string => `commerce.order.${id}`;
const pendingKey = (orderId: string): string => `commerce.ucp.pending.${orderId}`;

export type UcpStatus = 'incomplete' | 'requires_escalation' | 'ready_for_complete' | 'complete_in_progress' | 'completed' | 'canceled';

export interface UcpBuyer { first_name?: string; last_name?: string; email?: string; phone_number?: string }

export interface UcpLine {
  id: string;
  /** The item id as the platform sent it (a feed id or a sku). */
  itemId: string;
  sku: string;
  kind: 'offer' | 'app-tool';
  agent: string;
  offerId: string;
  app?: string;
  title: string;
  /** 6-decimal micro-units, USD. */
  unitPrice: number;
  quantity: number;
}

export interface UcpGuestSession {
  id: string;
  status: UcpStatus;
  platformProfile: string;
  platformFamily: string;
  sellerGhii: string;
  sellerOwner: string;
  currency: 'USD';
  lines: UcpLine[];
  buyer: UcpBuyer | null;
  orderId: string | null;
  lastError: { code: string; message: string; at: string } | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

/** A refusal, carrying what UCP's error vocabulary calls it. `httpStatus` 200 is a business outcome. */
export class UcpError extends Error {
  constructor(
    public httpStatus: number, public code: string, message: string,
    public severity: 'recoverable' | 'requires_buyer_input' | 'requires_buyer_review' | 'unrecoverable' = 'unrecoverable',
    public path?: string,
  ) {
    super(message);
    this.name = 'UcpError';
  }
}

const nowIso = (): string => new Date().toISOString();
const b64u = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');

function newSessionId(sellerOwner: string): string {
  return `ucs_${b64u(sellerOwner)}_${randomBytes(16).toString('hex')}`;
}

/** The seller's GHII a checkout id names, or null for an id this node did not mint. */
export function sellerOfSessionId(id: string, config: AimeatConfig): string | null {
  const m = /^ucs_([A-Za-z0-9_-]{1,120})_[0-9a-f]{32}$/.exec(id);
  if (!m) return null;
  const owner = Buffer.from(m[1]!, 'base64url').toString('utf8');
  return /^[a-z0-9_-]{1,60}$/i.test(owner) ? `${owner}@${config.nodeId}` : null;
}

/** The seller's GHII an order id names (`uco_<owner>_<hex>`), or null. */
export function sellerOfOrderId(id: string, config: AimeatConfig): string | null {
  return sellerOfSessionId(id.replace(/^uco_/, 'ucs_'), config);
}

async function putRecord(storage: Storage, ownerGhii: string, key: string, value: unknown, ttlHours: number | null): Promise<void> {
  const existing = await storage.getMemory(ownerGhii, key);
  const now = nowIso();
  await storage.setMemory({
    key, ownerGaii: ownerGhii, value: value as Record<string, unknown>, visibility: 'owner',
    tags: ['commerce', 'ucp'], ttlHours, version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  } as MemoryRecord);
}

// ── Pricing the lines ─────────────────────────────────────────────────────────────────────────

export interface UcpLineInput { item?: { id?: unknown }; quantity?: unknown; id?: unknown }

/** One platform item id to a sku: a feed id of the place's own products, or a sku itself. */
async function skuOf(storage: Storage, config: AimeatConfig, itemId: string): Promise<string | null> {
  if (/^(offer|app-tool):/.test(itemId)) return itemId;
  if (!/^aim[0-9a-f]{20}$/.test(itemId)) return null;
  const owner = await resolvePlaceOwner(storage, config);
  if (!owner) return null;
  const listing = await listOwnerProducts(storage, config, owner, await getFeedSettings(storage, owner));
  return resolveFeedId(listing, itemId)?.sku ?? null;
}

function refOf(sku: string): SellableRef | null {
  const parts = sku.split(':');
  if (parts[0] === 'offer' && parts.length >= 3) return { kind: 'offer', agent: parts[1], offer_id: parts.slice(2).join(':') };
  if (parts[0] === 'app-tool' && parts.length >= 3) return { kind: 'app-tool', app: parts[1], tool: parts.slice(2).join(':'), offer_id: parts.slice(2).join(':') };
  return null;
}

async function priceLines(storage: Storage, config: AimeatConfig, raw: UcpLineInput[]): Promise<{ lines: UcpLine[]; sellerGhii: string; sellerOwner: string }> {
  if (!Array.isArray(raw) || raw.length === 0) throw new UcpError(400, 'invalid_request', 'line_items needs at least one line.');
  if (raw.length > MAX_LINES) throw new UcpError(400, 'invalid_request', `At most ${MAX_LINES} lines in one checkout.`);
  const lines: UcpLine[] = [];
  let sellerGhii = '';
  let sellerOwner = '';
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]!;
    const itemId = typeof r.item?.id === 'string' ? r.item.id.slice(0, 500) : '';
    const quantity = Number.isInteger(r.quantity) && (r.quantity as number) > 0 && (r.quantity as number) <= 100 ? r.quantity as number : (r.quantity === undefined ? 1 : -1);
    if (quantity < 1) throw new UcpError(400, 'invalid_request', `line_items[${i}].quantity must be a whole number from 1 to 100.`);
    const sku = itemId ? await skuOf(storage, config, itemId) : null;
    const ref = sku ? refOf(sku) : null;
    if (!sku || !ref) throw new UcpError(200, 'item_unavailable', `Item ${itemId || '(none)'} is not sold here.`, 'unrecoverable', `$.line_items[${i}].item.id`);
    const resolver = getSellableResolver(ref.kind!);
    if (!resolver) throw new UcpError(200, 'item_unavailable', `Item ${itemId} is not sold here.`, 'unrecoverable', `$.line_items[${i}].item.id`);
    let sellable;
    try {
      sellable = await resolver.resolve(storage, config, { ...ref, currency: 'USD', quantity }, GUEST_BUYER);
    } catch (e) {
      const code = e instanceof CommerceError ? e.code : 'item_unavailable';
      throw new UcpError(200, 'item_unavailable', `Item ${itemId} cannot be bought here now (${code}).`, 'unrecoverable', `$.line_items[${i}].item.id`);
    }
    if (!sellerGhii) { sellerGhii = sellable.sellerGhii; sellerOwner = sellable.sellerOwner; }
    else if (sellerGhii !== sellable.sellerGhii) {
      throw new UcpError(200, 'item_unavailable', 'Every line of one checkout must be sold by the same seller.', 'unrecoverable', `$.line_items[${i}].item.id`);
    }
    lines.push({
      id: `li_${i + 1}`, itemId, sku, kind: ref.kind as 'offer' | 'app-tool', agent: sellable.agentGaii,
      offerId: sellable.offerId, ...(ref.app ? { app: ref.app } : {}), title: sellable.title,
      unitPrice: sellable.priceMorsels, quantity,
    });
  }
  return { lines, sellerGhii, sellerOwner };
}

function cleanBuyer(raw: unknown): UcpBuyer | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const s = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const email = s(b.email, 200);
  const out: UcpBuyer = {
    ...(s(b.first_name, 100) ? { first_name: s(b.first_name, 100) } : {}),
    ...(s(b.last_name, 100) ? { last_name: s(b.last_name, 100) } : {}),
    ...(email && /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/.test(email) ? { email } : {}),
    ...(s(b.phone_number, 40) ? { phone_number: s(b.phone_number, 40) } : {}),
  };
  return Object.keys(out).length ? out : null;
}

/** A digital product is delivered by email, so the buyer's email is the one field a checkout needs. */
function statusOf(session: Pick<UcpGuestSession, 'buyer'>): UcpStatus {
  return session.buyer?.email ? 'ready_for_complete' : 'incomplete';
}

/** The seller a create would go to, or null when the lines name nothing sold here. For the replay check. */
export async function sellerOfLines(storage: Storage, config: AimeatConfig, lineItems: UcpLineInput[]): Promise<string | null> {
  try {
    return (await priceLines(storage, config, lineItems)).sellerGhii;
  } catch (e) {
    // The create that follows refuses the same lines with the reason; here only the seller counts.
    logger.info('ucp: the lines of a create name no seller', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

// ── The lifecycle ─────────────────────────────────────────────────────────────────────────────

export async function createGuestCheckout(
  storage: Storage, config: AimeatConfig,
  args: { profileUrl: string; lineItems: UcpLineInput[]; buyer?: unknown },
): Promise<UcpGuestSession> {
  const { lines, sellerGhii, sellerOwner } = await priceLines(storage, config, args.lineItems);
  const open = storage.listMemoryKeysByPrefix
    ? (await storage.listMemoryKeysByPrefix('commerce.ucp.session.')).filter((r) => r.ownerGaii === sellerGhii).length
    : 0;
  if (open >= MAX_OPEN_PER_SELLER) throw new UcpError(429, 'rate_limited', 'This seller has too many open checkouts. Try again later.');
  const now = nowIso();
  const buyer = cleanBuyer(args.buyer);
  const session: UcpGuestSession = {
    id: newSessionId(sellerOwner), status: 'incomplete', platformProfile: args.profileUrl,
    platformFamily: ucpAgentFamily(`profile="${args.profileUrl}"`) ?? 'other',
    sellerGhii, sellerOwner, currency: 'USD', lines, buyer, orderId: null, lastError: null,
    createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + OPEN_MS).toISOString(),
  };
  session.status = statusOf(session);
  await putRecord(storage, sellerGhii, sessionKey(session.id), session, KEEP_HOURS);
  recordCheckoutStage(storage, config, { sellerGhii, family: session.platformFamily, stage: 'created' });
  return session;
}

/** The checkout, for the platform that created it. A checkout past its time reads as canceled. */
export async function readGuestCheckout(storage: Storage, config: AimeatConfig, id: string, profileUrl: string): Promise<UcpGuestSession> {
  const seller = sellerOfSessionId(id, config);
  const row = seller ? await storage.getMemory(seller, sessionKey(id)) : null;
  const session = row?.value as UcpGuestSession | undefined;
  // One answer for "no such checkout" and "not yours": the id is the only thing a stranger has.
  if (!session || session.platformProfile !== profileUrl) throw new UcpError(404, 'not_found', 'No such checkout.');
  if ((session.status === 'incomplete' || session.status === 'ready_for_complete') && Date.parse(session.expiresAt) < Date.now()) {
    session.status = 'canceled';
    session.updatedAt = nowIso();
    await putRecord(storage, session.sellerGhii, sessionKey(id), session, KEEP_HOURS);
    recordCheckoutStage(storage, config, { sellerGhii: session.sellerGhii, family: session.platformFamily, stage: 'expired' });
  }
  return session;
}

function requireChangeable(s: UcpGuestSession): void {
  if (s.status === 'complete_in_progress') throw new UcpError(200, 'checkout_locked', 'The checkout is being completed and cannot change now.', 'recoverable');
  if (s.status === 'completed' || s.status === 'canceled') throw new UcpError(200, 'checkout_closed', `The checkout is ${s.status}.`, 'unrecoverable');
}

/** PUT: a full replacement of the lines and the buyer. */
export async function updateGuestCheckout(
  storage: Storage, config: AimeatConfig, id: string, profileUrl: string, args: { lineItems: UcpLineInput[]; buyer?: unknown },
): Promise<UcpGuestSession> {
  const session = await readGuestCheckout(storage, config, id, profileUrl);
  requireChangeable(session);
  const priced = await priceLines(storage, config, args.lineItems);
  if (priced.sellerGhii !== session.sellerGhii) throw new UcpError(200, 'item_unavailable', 'A checkout keeps its seller; open a new one for another seller.', 'unrecoverable');
  session.lines = priced.lines;
  session.buyer = cleanBuyer(args.buyer);
  session.status = statusOf(session);
  session.updatedAt = nowIso();
  await putRecord(storage, session.sellerGhii, sessionKey(id), session, KEEP_HOURS);
  recordCheckoutStage(storage, config, { sellerGhii: session.sellerGhii, family: session.platformFamily, stage: 'updated' });
  return session;
}

export async function cancelGuestCheckout(storage: Storage, config: AimeatConfig, id: string, profileUrl: string): Promise<UcpGuestSession> {
  const session = await readGuestCheckout(storage, config, id, profileUrl);
  requireChangeable(session);
  session.status = 'canceled';
  session.updatedAt = nowIso();
  await putRecord(storage, session.sellerGhii, sessionKey(id), session, KEEP_HOURS);
  recordCheckoutStage(storage, config, { sellerGhii: session.sellerGhii, family: session.platformFamily, stage: 'canceled' });
  return session;
}

interface InstrumentInput { id?: unknown; handler_id?: unknown; type?: unknown; selected?: unknown; credential?: { type?: unknown; token?: unknown } }

async function failCompletion(storage: Storage, config: AimeatConfig, session: UcpGuestSession, code: string, message: string): Promise<never> {
  session.status = statusOf(session);
  session.lastError = { code, message, at: nowIso() };
  session.updatedAt = nowIso();
  await putRecord(storage, session.sellerGhii, sessionKey(session.id), session, KEEP_HOURS);
  recordCheckoutStage(storage, config, { sellerGhii: session.sellerGhii, family: session.platformFamily, stage: 'failed', code });
  throw new UcpError(200, code, message, code === 'payment_failed' ? 'recoverable' : 'requires_buyer_input');
}

/**
 * Place the order: re-price, charge the shared payment token on the seller's Stripe, write the
 * order and its tasks, book the seller's side, and send the first order webhook.
 */
export async function completeGuestCheckout(
  storage: Storage, config: AimeatConfig, id: string, profileUrl: string, payment: unknown,
): Promise<UcpGuestSession> {
  const session = await readGuestCheckout(storage, config, id, profileUrl);
  requireChangeable(session);
  if (!session.buyer?.email) {
    return failCompletion(storage, config, session, 'missing', 'buyer.email is required: a digital product is delivered by email.');
  }
  const instruments = Array.isArray((payment as { instruments?: unknown })?.instruments)
    ? (payment as { instruments: InstrumentInput[] }).instruments : [];
  const chosen = instruments.length === 1 ? instruments[0] : instruments.find((x) => x?.selected === true);
  const token = chosen?.credential?.type === 'stripe_payment_token' && typeof chosen.credential.token === 'string' ? chosen.credential.token : '';
  if (!/^spt_[A-Za-z0-9_]{4,200}$/.test(token)) {
    return failCompletion(storage, config, session, 'payment_failed', 'payment.instruments needs exactly one selected instrument whose credential is a stripe_payment_token.');
  }

  // Lock against a second complete arriving at the same time.
  session.status = 'complete_in_progress';
  session.updatedAt = nowIso();
  await putRecord(storage, session.sellerGhii, sessionKey(id), session, KEEP_HOURS);

  let repriced: UcpLine[];
  try {
    repriced = (await priceLines(storage, config, session.lines.map((l) => ({ item: { id: l.itemId }, quantity: l.quantity })))).lines;
  } catch (e) {
    return failCompletion(storage, config, session, e instanceof UcpError ? e.code : 'item_unavailable', e instanceof Error ? e.message : 'An item is no longer sold.');
  }
  const total = repriced.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
  const handler = getPaymentHandler(STRIPE_HANDLER_ID);
  const psp = (await storage.getMemory(session.sellerGhii, 'commerce.psp'))?.value;
  if (!handler || !openPspSecret(config, (psp as { secretKey?: unknown } | undefined)?.secretKey)) {
    return failCompletion(storage, config, session, 'payment_failed', 'This seller takes no card payment here yet.');
  }
  const ctx: PaymentContext = { config, storage };
  let trackingCode: string;
  try {
    trackingCode = (await handler.collect(ctx, {
      buyerGhii: '', amount: total, currency: 'USD', reference: session.id, fee: 0, instrument: token,
      seller: { ghii: session.sellerGhii, owner: session.sellerOwner, psp },
    })).trackingCode;
  } catch (e) {
    const msg = e instanceof PaymentError ? e.message : 'The payment did not go through.';
    return failCompletion(storage, config, session, 'payment_failed', msg);
  }

  // The order, under the seller, beside every other order they have.
  const orderId = `uco_${session.id.slice('ucs_'.length)}`;
  const now = nowIso();
  const buyerName = [session.buyer.first_name, session.buyer.last_name].filter(Boolean).join(' ') || null;
  const items: CheckoutLineItem[] = repriced.map((l) => ({
    kind: l.kind, agent: l.kind === 'offer' ? l.agent : session.sellerGhii, offerId: l.offerId,
    ...(l.app ? { app: l.app } : {}), quantity: l.quantity, title: l.title, unitPrice: l.unitPrice,
  }));
  const order: CheckoutSessionRecord = {
    id: orderId, status: 'completed', buyerOwner: '', buyerGhii: '',
    buyerIdentity: `${session.platformFamily === 'other' ? 'An AI shopping platform' : `A ${session.platformFamily} agent`} for ${buyerName ?? session.buyer.email} <${session.buyer.email}>`,
    sellerOwner: session.sellerOwner, sellerGhii: session.sellerGhii, items, currency: 'USD', total,
    receipt: { handler: STRIPE_HANDLER_ID, charged: total, earned: total, fee: 0, trackingCode },
    attribution: { channel: 'ai', family: session.platformFamily, via: 'agent' },
    guest: { source: 'ucp', platform: session.platformFamily, email: session.buyer.email, name: buyerName, profileUrl: session.platformProfile },
    ucpOrder: {
      checkoutId: session.id,
      lineIds: repriced.map((l) => l.id),
      itemIds: repriced.map((l) => l.itemId),
      events: [{ id: `ev_${randomUUID()}`, occurred_at: now, type: 'processing', line_items: repriced.map((l) => ({ id: l.id, quantity: l.quantity })) }],
      fulfilled: {},
    },
    createdAt: now, updatedAt: now, expiresAt: now,
  };
  const taskIds: string[] = [];
  for (const item of items) {
    try {
      taskIds.push(await createFulfillmentTask(storage, order, item, item.kind === 'app-tool' ? session.sellerGhii : undefined));
    } catch (e) {
      logger.error('ucp: a fulfilment task could not be created; the seller fulfils by hand', { order: orderId, error: String(e) });
    }
  }
  order.fulfillment = { taskIds };
  const { fee, net } = await bookSessionlessSale(storage, config, {
    gross: total, currency: 'USD', sellerGhii: session.sellerGhii, buyerRef: `ucp:${session.platformProfile}`,
    ext: 'ucp', action: 'checkout', trackingCode, handler: STRIPE_HANDLER_ID, reference: orderId,
  });
  order.receipt = { handler: STRIPE_HANDLER_ID, charged: total, earned: net, fee, trackingCode };
  await putRecord(storage, session.sellerGhii, orderKey(orderId), order, null);

  session.status = 'completed';
  session.lines = repriced;
  session.orderId = orderId;
  session.lastError = null;
  session.updatedAt = now;
  await putRecord(storage, session.sellerGhii, sessionKey(id), session, KEEP_HOURS);

  recordCheckoutStage(storage, config, { sellerGhii: session.sellerGhii, family: session.platformFamily, stage: 'completed' });
  recordPurchase(storage, config, { sellerGhii: session.sellerGhii, channel: 'ai', family: session.platformFamily, via: 'agent', amount: total, currency: 'USD' });
  void recordAccountEvent(storage, {
    ownerGhii: session.sellerGhii, kind: 'payment_received', actorGaii: session.sellerGhii, subject: orderId,
    link: `/v1/profile?tab=wallet&order=${encodeURIComponent(orderId)}`,
    data: { amount: `${(total / 1_000_000).toFixed(2)} USD`, what: items.map((i) => i.title).join(', ').slice(0, 120), who: order.buyerIdentity.slice(0, 120) },
  }, config);
  await queueOrderWebhook(storage, config, session.sellerGhii, orderId);
  return session;
}

// ── What the platform reads ───────────────────────────────────────────────────────────────────

/**
 * The payment handlers a checkout of this seller offers: Stripe's `com.stripe.payments` when the
 * seller gave their Stripe network profile (`profile_…`) and has a selling key. `environment`
 * follows the key: a test key is the sandbox.
 */
export async function sellerPaymentHandlers(storage: Storage, config: AimeatConfig, sellerGhii: string): Promise<Record<string, unknown[]>> {
  const feed = await getFeedSettings(storage, sellerGhii);
  const psp = (await storage.getMemory(sellerGhii, 'commerce.psp'))?.value as { secretKey?: unknown } | undefined;
  const key = openPspSecret(config, psp?.secretKey);
  if (!feed.stripeProfileId || !key) return {};
  return {
    'com.stripe.payments': [{
      id: 'stripe_payments',
      version: '2026-06-25',
      spec: 'https://docs.stripe.com/agentic-commerce/ucp/stripe-payments-handler',
      schema: 'https://ucp.stripe.com/payments/2026-06-25/schema.json',
      available_instruments: [{ type: 'card', constraints: { brands: ['visa', 'mastercard', 'amex', 'discover'], tokenization: 'required' } }],
      config: { environment: key.startsWith('sk_test_') || key.startsWith('rk_test_') ? 'sandbox' : 'production', business_profile: feed.stripeProfileId },
    }],
  };
}

const cents = (micros: number): number => Math.round(micros / 10_000);

function linksOf(config: AimeatConfig): Array<{ type: string; url: string }> {
  const b = config.baseUrl.replace(/\/$/, '');
  return [
    { type: 'terms_of_service', url: `${b}/terms` },
    { type: 'privacy_policy', url: `${b}/privacy` },
  ];
}

/** The checkout as UCP 2026-08-25 shapes it. Amounts in minor units (cents). */
export function toUcpCheckout(s: UcpGuestSession, config: AimeatConfig, handlers: Record<string, unknown[]>): Record<string, unknown> {
  const subtotal = s.lines.reduce((n, l) => n + cents(l.unitPrice) * l.quantity, 0);
  const messages: unknown[] = [];
  if (s.status === 'incomplete' && !s.buyer?.email) {
    messages.push({ type: 'error', code: 'missing', path: '$.buyer.email', content: 'The buyer\'s email is required: a digital product is delivered by email.', severity: 'recoverable' });
  }
  if (s.lastError && s.status !== 'completed') {
    messages.push({ type: 'error', code: s.lastError.code, content: s.lastError.message, severity: s.lastError.code === 'payment_failed' ? 'recoverable' : 'requires_buyer_input' });
  }
  if (Object.keys(handlers).length === 0 && s.status !== 'completed' && s.status !== 'canceled') {
    messages.push({ type: 'error', code: 'payment_failed', content: 'This seller takes no agent payment yet.', severity: 'unrecoverable' });
  }
  return {
    ucp: { version: UCP_VERSION, capabilities: { 'dev.ucp.shopping.checkout': [{ version: UCP_VERSION }] }, payment_handlers: handlers },
    id: s.id,
    status: s.status,
    currency: s.currency,
    line_items: s.lines.map((l) => ({
      id: l.id,
      item: { id: l.itemId, title: l.title, price: cents(l.unitPrice) },
      quantity: l.quantity,
      totals: [{ type: 'subtotal', amount: cents(l.unitPrice) * l.quantity }, { type: 'total', amount: cents(l.unitPrice) * l.quantity }],
    })),
    ...(s.buyer ? { buyer: s.buyer } : {}),
    totals: [{ type: 'subtotal', amount: subtotal }, { type: 'total', amount: subtotal }],
    links: linksOf(config),
    ...(messages.length ? { messages } : {}),
    expires_at: s.expiresAt,
    ...(s.status !== 'completed' && s.status !== 'canceled' ? { continue_url: `${config.baseUrl.replace(/\/$/, '')}/` } : {}),
    ...(s.orderId ? { order: { id: s.orderId, permalink_url: orderPermalink(config, s.orderId) } } : {}),
  };
}

const orderPermalink = (config: AimeatConfig, orderId: string): string =>
  `${config.baseUrl.replace(/\/$/, '')}/ucp/${UCP_VERSION}/orders/${encodeURIComponent(orderId)}`;

/** The order as UCP 2026-08-25 shapes it: the full snapshot a webhook sends. */
export function toUcpOrder(order: CheckoutSessionRecord, config: AimeatConfig): Record<string, unknown> {
  const u = order.ucpOrder!;
  const lines = order.items.map((item, i) => {
    const id = u.lineIds[i] ?? `li_${i + 1}`;
    const fulfilled = Math.min(item.quantity, u.fulfilled[id] ?? 0);
    const total = cents(item.unitPrice) * item.quantity;
    return {
      id,
      item: { id: u.itemIds?.[i] ?? `${item.kind}:${item.agent}:${item.offerId}`, title: item.title, price: cents(item.unitPrice) },
      quantity: { original: item.quantity, total: item.quantity, fulfilled },
      totals: [{ type: 'subtotal', amount: total }, { type: 'total', amount: total }],
      status: fulfilled >= item.quantity ? 'fulfilled' : (fulfilled > 0 ? 'partial' : 'processing'),
    };
  });
  const grand = lines.reduce((n, l) => n + (l.totals[1]!.amount as number), 0);
  return {
    ucp: { version: UCP_VERSION, capabilities: { 'dev.ucp.shopping.order': [{ version: UCP_VERSION }] } },
    id: order.id,
    checkout_id: u.checkoutId,
    permalink_url: orderPermalink(config, order.id),
    line_items: lines,
    fulfillment: {
      expectations: [{ id: 'exp_1', line_items: lines.map((l) => ({ id: l.id, quantity: l.quantity.total })), method_type: 'digital', destination: { email: order.guest?.email ?? undefined }, description: 'Delivered by the seller by email.' }],
      events: u.events,
    },
    adjustments: [],
    currency: order.currency,
    totals: [{ type: 'subtotal', amount: grand }, { type: 'total', amount: grand }],
  };
}

/** The order, for the platform that placed it. */
export async function readUcpOrder(storage: Storage, config: AimeatConfig, orderId: string, profileUrl: string): Promise<CheckoutSessionRecord> {
  const seller = sellerOfOrderId(orderId, config);
  const order = seller ? (await storage.getMemory(seller, orderKey(orderId)))?.value as CheckoutSessionRecord | undefined : undefined;
  if (!order?.ucpOrder || order.guest?.profileUrl !== profileUrl) throw new UcpError(200, 'not_found', 'No such order.');
  return order;
}

// ── Fulfilment and webhooks ───────────────────────────────────────────────────────────────────

/**
 * A fulfilment task of a UCP order finished: its line is delivered, the order gains a `delivered`
 * event and the platform hears about it. Called from the task completion fan-out for every task;
 * a task that is not a UCP order's returns at once. Never throws.
 */
export async function onUcpTaskDone(storage: Storage, config: AimeatConfig, task: AgentTaskRecord): Promise<void> {
  try {
    const orderId = task.scope?.find((s) => s.name === 'commerce_session')?.value;
    if (typeof orderId !== 'string' || !orderId.startsWith('uco_')) return;
    const seller = sellerOfOrderId(orderId, config);
    if (!seller || seller !== task.ownerGaii) return;
    const row = await storage.getMemory(seller, orderKey(orderId));
    const order = row?.value as CheckoutSessionRecord | undefined;
    if (!order?.ucpOrder) return;
    const idx = (order.fulfillment?.taskIds ?? []).indexOf(task.id);
    if (idx < 0) return;
    const lineId = order.ucpOrder.lineIds[idx] ?? `li_${idx + 1}`;
    const item = order.items[idx]!;
    if ((order.ucpOrder.fulfilled[lineId] ?? 0) >= item.quantity) return;
    order.ucpOrder.fulfilled[lineId] = item.quantity;
    order.ucpOrder.events.push({
      id: `ev_${randomUUID()}`, occurred_at: nowIso(), type: 'delivered',
      line_items: [{ id: lineId, quantity: item.quantity }],
      // UCP asks for tracking on every event past processing; a digital delivery's tracking is the
      // order itself and the task that delivered it.
      tracking_number: task.id, tracking_url: orderPermalink(config, orderId),
      description: 'Delivered by the seller.',
    });
    order.updatedAt = nowIso();
    await putRecord(storage, seller, orderKey(orderId), order, null);
    await queueOrderWebhook(storage, config, seller, orderId);
  } catch (e) {
    logger.error('ucp: a delivered task could not update its order', { task: task.id, error: String(e) });
  }
}

interface Pending { orderId: string; attempts: number; nextAt: string; lastStatus: number | null }

async function queueOrderWebhook(storage: Storage, config: AimeatConfig, sellerGhii: string, orderId: string): Promise<void> {
  await putRecord(storage, sellerGhii, pendingKey(orderId), { orderId, attempts: 0, nextAt: nowIso(), lastStatus: null } satisfies Pending, null);
  void deliverOrderWebhook(storage, config, sellerGhii, orderId);
}

/**
 * Send the order's current snapshot to the platform's webhook, signed with the node's UCP key. On
 * success the pending record goes; on failure it waits for the next try (BACKOFF_MS), and after
 * the last one it is dropped and the failure is logged. Never throws.
 */
export async function deliverOrderWebhook(storage: Storage, config: AimeatConfig, sellerGhii: string, orderId: string): Promise<boolean> {
  const pending = (await storage.getMemory(sellerGhii, pendingKey(orderId)))?.value as Pending | undefined;
  if (!pending) return true;
  try {
    const order = (await storage.getMemory(sellerGhii, orderKey(orderId)))?.value as CheckoutSessionRecord | undefined;
    const profileUrl = order?.guest?.profileUrl;
    const profile = profileUrl ? await platformProfile(profileUrl) : null;
    const key = await ucpSigningKey(storage);
    if (!order || !profile?.webhookUrl || !key) throw new Error(!order ? 'order gone' : !profile?.webhookUrl ? 'the platform names no webhook' : 'no signing key');
    const body = JSON.stringify(toUcpOrder(order, config));
    const base = config.baseUrl.replace(/\/$/, '');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
      'webhook-id': randomUUID(),
      'ucp-agent': `profile="${base}/.well-known/ucp"`,
    };
    const signed = signMessage({ method: 'POST', url: profile.webhookUrl, headers }, body, key);
    const res = await safeFetch(profile.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': headers['content-type']!, 'Webhook-Timestamp': headers['webhook-timestamp']!,
        'Webhook-Id': headers['webhook-id']!, 'UCP-Agent': headers['ucp-agent']!, ...signed,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      await storage.deleteMemory(sellerGhii, pendingKey(orderId));
      return true;
    }
    throw Object.assign(new Error(`the platform answered ${res.status}`), { status: res.status });
  } catch (e) {
    const attempts = pending.attempts + 1;
    if (attempts > BACKOFF_MS.length) {
      logger.error('ucp: an order webhook was given up after every retry', { orderId, error: String(e) });
      await storage.deleteMemory(sellerGhii, pendingKey(orderId));
      return false;
    }
    logger.warn('ucp: an order webhook will be tried again', { orderId, attempts, error: String(e) });
    await putRecord(storage, sellerGhii, pendingKey(orderId), {
      orderId, attempts, nextAt: new Date(Date.now() + BACKOFF_MS[attempts - 1]!).toISOString(),
      lastStatus: (e as { status?: number }).status ?? null,
    } satisfies Pending, null);
    return false;
  }
}

/** The scheduled upkeep: deliver every webhook whose next try is due. */
export async function runUcpUpkeep(storage: Storage, config: AimeatConfig): Promise<{ tried: number; delivered: number }> {
  if (!storage.listMemoryKeysByPrefix) return { tried: 0, delivered: 0 };
  let tried = 0;
  let delivered = 0;
  for (const { ownerGaii, key } of await storage.listMemoryKeysByPrefix('commerce.ucp.pending.')) {
    if (!localAccountOf(ownerGaii)) continue;
    const pending = (await storage.getMemory(ownerGaii, key))?.value as Pending | undefined;
    if (!pending || Date.parse(pending.nextAt) > Date.now()) continue;
    tried++;
    if (await deliverOrderWebhook(storage, config, ownerGaii, pending.orderId)) delivered++;
  }
  return { tried, delivered };
}
