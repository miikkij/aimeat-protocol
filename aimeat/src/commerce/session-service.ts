/**
 * @file src/commerce/session-service.ts
 * @description The checkout-session lifecycle of the commerce core (TARGET-033): resolve offers
 *   into priced Sellables, create/read/update/cancel sessions, and complete a session atomically
 *   (charge via the selected PaymentHandler → fulfill each line item as an agent TASK on the
 *   offer-ask path → write the seller's order copy → close the session; refund on fulfillment
 *   failure). Sessions are memory records — `commerce.session.{id}` under the buyer owner's GHII,
 *   `commerce.order.{id}` under the seller owner's GHII — no storage-schema changes.
 * @structure CommerceError · resolveSellable · createSession · getSession · updateSessionItems ·
 *   cancelSession · completeSession
 * @usage import { createSession, completeSession } from '../commerce/session-service.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Initial session service (TARGET-033 phase 1)
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord } from '../storage/interface.js';
import type { Offer } from '../models/offer-schemas.js';
import type { CheckoutSessionRecord, CheckoutLineItem, Sellable, PaymentContext } from './types.js';
import { getPaymentHandler, MORSEL_HANDLER_ID } from './payment-handlers.js';
import { emitChange, emitDelivery } from '../services/event-bus.js';

/** Lifetime of an open session (lazy expiry — checked on read and on complete). */
const sessionTtlMs = (config: AimeatConfig) => (config.commerceSessionTtlMinutes || 60) * 60 * 1000;

const sessionKey = (id: string) => `commerce.session.${id}`;
const orderKey = (id: string) => `commerce.order.${id}`;

export class CommerceError extends Error {
  constructor(public code: string, public statusCode: number, message: string) {
    super(message);
  }
}

/** Upsert one memory record (the same shape every service-side writer in the codebase uses). */
async function putRecord(storage: Storage, ownerGaii: string, key: string, value: unknown): Promise<void> {
  const existing = await storage.getMemory(ownerGaii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii, value: value as Record<string, unknown>, visibility: 'owner', tags: ['commerce'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/**
 * Resolve one offer reference into a priced Sellable, enforcing the same rules the offer-invoke
 * settlement enforces: private offers are owner-only; cross-owner purchase requires an explicit
 * `price` (absent price = not for sale); self-purchase is free.
 */
export async function resolveSellable(
  storage: Storage,
  config: AimeatConfig,
  agentIdentifier: string,
  offerId: string,
  buyerOwner: string,
): Promise<Sellable> {
  const agentGaii = agentIdentifier.includes('#')
    ? agentIdentifier
    : `${agentIdentifier}#${buyerOwner}@${config.nodeId}`;
  const agent = await storage.getAgent(agentGaii);
  if (!agent) throw new CommerceError('AGENT_NOT_FOUND', 404, `Agent not found: ${agentIdentifier}`);

  const agentName = agentGaii.split('#')[0] as string;
  const rec = await storage.getMemory(agentGaii, `agents.${agentName}.offers`);
  const offers = ((rec?.value as { offers?: Offer[] } | undefined)?.offers) ?? [];
  const offer = offers.find((o) => o.id === offerId);
  if (!offer) throw new CommerceError('OFFER_NOT_FOUND', 404, `Offer not found: ${offerId}`);

  const isSelf = agent.owner === buyerOwner;
  const visibility = offer.visibility ?? 'private';
  if (!isSelf && visibility === 'private') {
    throw new CommerceError('OFFER_PRIVATE', 403, 'This offer is private to its owner');
  }
  let priceMorsels = 0;
  if (!isSelf) {
    if (!offer.price) throw new CommerceError('OFFER_NOT_FOR_SALE', 422, 'This offer declares no price and cannot be purchased cross-owner');
    priceMorsels = Number(offer.price.morsels);
  }
  return {
    kind: 'offer', agentGaii, agentName, offerId,
    title: offer.title, sellerOwner: agent.owner,
    sellerGhii: `${agent.owner}@${config.nodeId}`, priceMorsels,
  };
}

/** Resolve raw items, enforce the single-seller rule, and price the lines. */
async function resolveItems(
  storage: Storage,
  config: AimeatConfig,
  rawItems: Array<{ agent: string; offer_id: string; quantity?: number }>,
  buyerOwner: string,
): Promise<{ items: CheckoutLineItem[]; sellerOwner: string; sellerGhii: string; total: number }> {
  if (!rawItems.length) throw new CommerceError('EMPTY_CART', 400, 'A checkout session needs at least one line item');
  const items: CheckoutLineItem[] = [];
  let sellerOwner = '';
  let sellerGhii = '';
  let total = 0;
  for (const raw of rawItems) {
    const quantity = Math.max(1, Math.trunc(raw.quantity ?? 1));
    const sellable = await resolveSellable(storage, config, raw.agent, raw.offer_id, buyerOwner);
    if (!sellerOwner) { sellerOwner = sellable.sellerOwner; sellerGhii = sellable.sellerGhii; }
    else if (sellerOwner !== sellable.sellerOwner) {
      throw new CommerceError('MULTI_SELLER_CART', 422, 'All line items in one checkout session must belong to the same seller');
    }
    items.push({ agent: sellable.agentGaii, offerId: sellable.offerId, quantity, title: sellable.title, unitPrice: sellable.priceMorsels });
    total += sellable.priceMorsels * quantity;
  }
  return { items, sellerOwner, sellerGhii, total };
}

export async function createSession(
  storage: Storage,
  config: AimeatConfig,
  args: {
    buyerOwner: string;
    buyerIdentity: string;
    items: Array<{ agent: string; offer_id: string; quantity?: number }>;
    note?: string;
  },
): Promise<CheckoutSessionRecord> {
  const { items, sellerOwner, sellerGhii, total } = await resolveItems(storage, config, args.items, args.buyerOwner);
  const now = new Date();
  const session: CheckoutSessionRecord = {
    id: `cs_${randomUUID()}`,
    status: 'open',
    buyerOwner: args.buyerOwner,
    buyerGhii: `${args.buyerOwner}@${config.nodeId}`,
    buyerIdentity: args.buyerIdentity,
    sellerOwner, sellerGhii,
    items, currency: 'morsel', total,
    note: args.note,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + sessionTtlMs(config)).toISOString(),
  };
  await putRecord(storage, session.buyerGhii, sessionKey(session.id), session);
  return session;
}

/** Read a session; lazily flip an overdue `open` session to `expired` (persisted). */
export async function getSession(
  storage: Storage,
  buyerGhii: string,
  id: string,
): Promise<CheckoutSessionRecord | null> {
  const rec = await storage.getMemory(buyerGhii, sessionKey(id));
  if (!rec) return null;
  const session = rec.value as unknown as CheckoutSessionRecord;
  if (session.status === 'open' && Date.now() > new Date(session.expiresAt).getTime()) {
    session.status = 'expired';
    session.updatedAt = new Date().toISOString();
    await putRecord(storage, buyerGhii, sessionKey(id), session);
  }
  return session;
}

/** The buyer's sessions, newest first (lazy expiry NOT applied here — status shown as stored). */
export async function listSessions(storage: Storage, buyerGhii: string, limit = 50): Promise<CheckoutSessionRecord[]> {
  const { items } = await storage.listAllMemory({ prefix: 'commerce.session.', ownerPrefix: buyerGhii, limit });
  return items
    .map((r) => r.value as unknown as CheckoutSessionRecord)
    .filter((s) => s && s.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The seller's received orders (completed sessions mirrored under their GHII), newest first. */
export async function listOrders(storage: Storage, sellerGhii: string, limit = 50): Promise<CheckoutSessionRecord[]> {
  const { items } = await storage.listAllMemory({ prefix: 'commerce.order.', ownerPrefix: sellerGhii, limit });
  return items
    .map((r) => r.value as unknown as CheckoutSessionRecord)
    .filter((s) => s && s.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function requireOpen(session: CheckoutSessionRecord): void {
  if (session.status !== 'open') {
    throw new CommerceError('SESSION_NOT_OPEN', 409, `Checkout session is ${session.status}; only open sessions can change`);
  }
}

export async function updateSessionItems(
  storage: Storage,
  config: AimeatConfig,
  session: CheckoutSessionRecord,
  rawItems: Array<{ agent: string; offer_id: string; quantity?: number }>,
): Promise<CheckoutSessionRecord> {
  requireOpen(session);
  const { items, sellerOwner, sellerGhii, total } = await resolveItems(storage, config, rawItems, session.buyerOwner);
  const updated: CheckoutSessionRecord = {
    ...session, items, sellerOwner, sellerGhii, total, updatedAt: new Date().toISOString(),
  };
  await putRecord(storage, session.buyerGhii, sessionKey(session.id), updated);
  return updated;
}

export async function cancelSession(
  storage: Storage,
  session: CheckoutSessionRecord,
): Promise<CheckoutSessionRecord> {
  requireOpen(session);
  const updated: CheckoutSessionRecord = { ...session, status: 'cancelled', updatedAt: new Date().toISOString() };
  await putRecord(storage, session.buyerGhii, sessionKey(session.id), updated);
  return updated;
}

/** Create the fulfillment TASK for one line item on the seller agent (the offer-ask path). */
async function createFulfillmentTask(
  storage: Storage,
  session: CheckoutSessionRecord,
  item: CheckoutLineItem,
): Promise<string> {
  const now = new Date().toISOString();
  const record: AgentTaskRecord = {
    id: randomUUID(),
    agentGaii: item.agent,
    ownerGaii: session.sellerGhii,
    title: `Order: ${item.title}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`,
    description: [
      `Commerce order from checkout session ${session.id}.`,
      `Buyer: ${session.buyerIdentity} (paid ${item.unitPrice * item.quantity} morsels).`,
      session.note ? `Buyer note: ${session.note}` : '',
      `Deliver the offer "${item.title}" (${item.offerId})${item.quantity > 1 ? ` ×${item.quantity}` : ''}.`,
    ].filter(Boolean).join('\n'),
    scope: [
      { name: 'kind', value: 'commerce-order', type: 'text' },
      { name: 'offer_id', value: item.offerId, type: 'text' },
      { name: 'commerce_session', value: session.id, type: 'text' },
      { name: 'buyer', value: session.buyerIdentity, type: 'text' },
    ],
    rules: [],
    verification: { userExpects: `The deliverable of offer ${item.offerId} reaches the buyer ${session.buyerIdentity}`, technicalChecks: [] },
    resources: {},
    todos: [],
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  const created = await storage.createAgentTask(record);
  // Realtime push to the seller agent (tunnel replays from backlog when offline; no-op otherwise).
  emitDelivery({ target: item.agent, kind: 'task_assigned', id: record.id, payload: created });
  return record.id;
}

/**
 * Complete a session atomically: charge → fulfill (TASK per line item) → seller order copy →
 * close. A fulfillment failure after a successful charge refunds through the same handler and
 * rethrows, leaving the session open for retry.
 */
export async function completeSession(
  storage: Storage,
  config: AimeatConfig,
  session: CheckoutSessionRecord,
  handlerId?: string,
): Promise<CheckoutSessionRecord> {
  requireOpen(session);
  if (Date.now() > new Date(session.expiresAt).getTime()) {
    session.status = 'expired';
    session.updatedAt = new Date().toISOString();
    await putRecord(storage, session.buyerGhii, sessionKey(session.id), session);
    throw new CommerceError('SESSION_EXPIRED', 409, 'Checkout session has expired; create a new one');
  }

  const handler = getPaymentHandler(handlerId ?? MORSEL_HANDLER_ID);
  if (!handler) throw new CommerceError('UNKNOWN_PAYMENT_HANDLER', 422, `Payment handler not available on this node: ${handlerId}`);
  if (!handler.currencies.includes(session.currency)) {
    throw new CommerceError('CURRENCY_MISMATCH', 422, `Handler ${handler.id} does not settle ${session.currency}`);
  }

  const ctx: PaymentContext = { config, storage };
  const result = session.total > 0
    ? await handler.charge(ctx, { buyerGhii: session.buyerGhii, sellerGhii: session.sellerGhii, amount: session.total, reference: session.id })
    : { charged: 0, earned: 0, fee: 0, trackingCode: `comtx_free_${session.id}` };

  const taskIds: string[] = [];
  try {
    for (const item of session.items) {
      taskIds.push(await createFulfillmentTask(storage, session, item));
    }
  } catch (err) {
    if (session.total > 0) {
      await handler.refund(ctx, { buyerGhii: session.buyerGhii, sellerGhii: session.sellerGhii, result });
    }
    const e = err as { message?: string };
    throw new CommerceError('FULFILLMENT_FAILED', 502, `Payment refunded — fulfillment task creation failed: ${e.message ?? 'unknown error'}`);
  }

  const completed: CheckoutSessionRecord = {
    ...session,
    status: 'completed',
    receipt: { handler: handler.id, ...result },
    fulfillment: { taskIds },
    updatedAt: new Date().toISOString(),
  };
  await putRecord(storage, session.buyerGhii, sessionKey(session.id), completed);
  // The seller's orders-received copy, under THEIR GHII (readable without touching buyer data).
  await putRecord(storage, session.sellerGhii, orderKey(session.id), completed);
  emitChange('agent-tasks');
  return completed;
}
