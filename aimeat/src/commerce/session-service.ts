/**
 * @file src/commerce/session-service.ts
 * @description The checkout-session lifecycle of the commerce core (TARGET-033): resolve line
 *   items through the sellable-resolver registry (agent offers in core, org offerings in EE),
 *   create/read/update/cancel sessions, and complete a session — collect the gross from the buyer
 *   → fulfill each line item as an agent TASK on the offer-ask path → pay out per item (default
 *   seller payout, or the sellable's custom distribute e.g. EE commission split) → route the fee
 *   leg (operator | burn) → close. A fulfillment failure after collect refunds and rethrows,
 *   leaving the session open for retry. Sessions are memory records — `commerce.session.{id}`
 *   under the buyer owner's GHII, `commerce.order.{id}` under the seller owner's GHII — no
 *   storage-schema changes.
 * @structure CommerceError (re-export) · createSession · getSession · listSessions · listOrders ·
 *   updateSessionItems · cancelSession · completeSession
 * @usage import { createSession, completeSession } from '../commerce/session-service.js';
 * @version-history
 *   v2.0.0 — 2026-07-13 — Resolver registry + collect/payout orchestration + distribute seam (phase 4)
 *   v1.0.0 — 2026-07-13 — Initial session service (TARGET-033 phase 1)
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord } from '../storage/interface.js';
import type { CheckoutSessionRecord, CheckoutLineItem, Sellable, PaymentContext } from './types.js';
import { getPaymentHandler, MORSEL_HANDLER_ID } from './payment-handlers.js';
import { getSellableResolver, type SellableRef } from './sellable-resolvers.js';
import { CommerceError } from './errors.js';
import { commerceFeePercent, settleMarketplaceFee, resolveOperatorFeeGhii } from '../services/marketplace-fee.js';
import { isMoneyCurrency } from './money.js';
import { emitChange, emitDelivery } from '../services/event-bus.js';

export { CommerceError } from './errors.js';

/** Lifetime of an open session (lazy expiry — checked on read and on complete). */
const sessionTtlMs = (config: AimeatConfig) => (config.commerceSessionTtlMinutes || 60) * 60 * 1000;

const sessionKey = (id: string) => `commerce.session.${id}`;
const orderKey = (id: string) => `commerce.order.${id}`;

/** Upsert one memory record (the same shape every service-side writer in the codebase uses). */
async function putRecord(storage: Storage, ownerGaii: string, key: string, value: unknown): Promise<void> {
  const existing = await storage.getMemory(ownerGaii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii, value: value as Record<string, unknown>, visibility: 'owner', tags: ['commerce'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/** Resolve one raw ref through the registry (kind defaults to 'offer'). */
async function resolveOne(storage: Storage, config: AimeatConfig, ref: SellableRef, buyerOwner: string): Promise<Sellable> {
  const kind = ref.kind ?? 'offer';
  const resolver = getSellableResolver(kind);
  if (!resolver) throw new CommerceError('UNKNOWN_ITEM_KIND', 422, `No sellable resolver for kind: ${kind}`);
  return resolver.resolve(storage, config, ref, buyerOwner);
}

/** Resolve raw items, enforce the single-seller rule, and price the lines. */
async function resolveItems(
  storage: Storage,
  config: AimeatConfig,
  rawItems: SellableRef[],
  buyerOwner: string,
  currency: string,
): Promise<{ items: CheckoutLineItem[]; sellerOwner: string; sellerGhii: string; total: number }> {
  if (!rawItems.length) throw new CommerceError('EMPTY_CART', 400, 'A checkout session needs at least one line item');
  const items: CheckoutLineItem[] = [];
  let sellerOwner = '';
  let sellerGhii = '';
  let total = 0;
  for (const raw of rawItems) {
    const quantity = Math.max(1, Math.trunc(raw.quantity ?? 1));
    const sellable = await resolveOne(storage, config, { ...raw, currency }, buyerOwner);
    if (!sellerOwner) { sellerOwner = sellable.sellerOwner; sellerGhii = sellable.sellerGhii; }
    else if (sellerOwner !== sellable.sellerOwner) {
      throw new CommerceError('MULTI_SELLER_CART', 422, 'All line items in one checkout session must belong to the same seller');
    }
    items.push({
      kind: sellable.kind, agent: sellable.agentGaii, offerId: sellable.offerId,
      org: raw.org, quantity, title: sellable.title, unitPrice: sellable.priceMorsels,
    });
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
    items: SellableRef[];
    note?: string;
    /** 'morsel' (default) or a money code an EE handler + KYB-verified seller supports. */
    currency?: string;
  },
): Promise<CheckoutSessionRecord> {
  const currency = args.currency ?? 'morsel';
  const { items, sellerOwner, sellerGhii, total } = await resolveItems(storage, config, args.items, args.buyerOwner, currency);
  const now = new Date();
  const session: CheckoutSessionRecord = {
    id: `cs_${randomUUID()}`,
    status: 'open',
    buyerOwner: args.buyerOwner,
    buyerGhii: `${args.buyerOwner}@${config.nodeId}`,
    buyerIdentity: args.buyerIdentity,
    sellerOwner, sellerGhii,
    items, currency, total,
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

/**
 * Record the operator's platform fee on a MONEY sale (never touches the morsel ledger). Stored as
 * a memory record under the operator's GHII (or the seller's, if no operator resolves) so the admin
 * dashboard can total the operator's real-money cut per currency. `mode` notes how it is collected:
 * `connect` when the Stripe handler routed an application-fee, otherwise `receivable` (invoice).
 */
async function recordMoneyPlatformFee(
  storage: Storage,
  config: AimeatConfig,
  args: { fee: number; currency: string; sellerGhii: string; buyerGhii: string; trackingCode: string; handler: string },
): Promise<void> {
  const operatorGhii = await resolveOperatorFeeGhii(storage, config);
  const ownerGhii = operatorGhii ?? args.sellerGhii;
  const mode = args.handler === 'com.stripe.spt' ? 'connect' : 'receivable';
  await putRecord(storage, ownerGhii, `commerce.platform-fee.${args.trackingCode}`, {
    fee: args.fee, currency: args.currency, mode, handler: args.handler,
    sellerGhii: args.sellerGhii, buyerGhii: args.buyerGhii, trackingCode: args.trackingCode,
    at: new Date().toISOString(),
  });
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
  rawItems: SellableRef[],
): Promise<CheckoutSessionRecord> {
  requireOpen(session);
  const { items, sellerOwner, sellerGhii, total } = await resolveItems(storage, config, rawItems, session.buyerOwner, session.currency);
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
 * Complete a session: collect the gross → fulfill (TASK per line item) → per-item payouts
 * (default seller payout, or the sellable's custom distribute) → fee leg → seller order copy →
 * close. A fulfillment failure after a successful collect refunds through the same handler and
 * rethrows, leaving the session open for retry. Payout/fee legs run after fulfillment and are
 * best-effort ordered — the buyer's money moves exactly once.
 */
export async function completeSession(
  storage: Storage,
  config: AimeatConfig,
  session: CheckoutSessionRecord,
  handlerId?: string,
  instrument?: unknown,
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

  // Re-resolve every line through the registry: revalidates availability and restores the
  // per-kind distribution behavior (callbacks cannot live inside the persisted session record).
  const sellables: Sellable[] = [];
  for (const item of session.items) {
    sellables.push(await resolveOne(storage, config, {
      kind: item.kind, agent: item.agent, offer_id: item.offerId, org: item.org, currency: session.currency,
    }, session.buyerOwner));
  }

  // Per-item money math on the QUOTED prices the session carries.
  const feePct = commerceFeePercent(config);
  const lines = session.items.map((item) => {
    const gross = item.unitPrice * item.quantity;
    const fee = Math.ceil(gross * feePct / 100);
    return { item, gross, fee, net: gross - fee };
  });
  const totalFee = lines.reduce((n, l) => n + l.fee, 0);
  const totalNet = lines.reduce((n, l) => n + l.net, 0);

  // 1) Collect the gross from the buyer.
  // The single-seller rule guarantees every sellable shares the seller; money handlers charge on
  // the SELLER's own PSP credentials (loaded by the resolver) — never on node-level keys.
  const seller = { ghii: session.sellerGhii, owner: session.sellerOwner, psp: sellables[0]?.psp };
  const collected = session.total > 0
    ? await handler.collect(ctx, { buyerGhii: session.buyerGhii, amount: session.total, currency: session.currency, reference: session.id, fee: totalFee, instrument, seller })
    : { trackingCode: `comtx_free_${session.id}` };

  // 2) Fulfillment — a failure here refunds the collect and leaves the session open.
  const taskIds: string[] = [];
  try {
    for (const item of session.items) {
      taskIds.push(await createFulfillmentTask(storage, session, item));
    }
  } catch (err) {
    if (session.total > 0) {
      await handler.refund(ctx, { buyerGhii: session.buyerGhii, amount: session.total, trackingCode: collected.trackingCode, seller });
    }
    const e = err as { message?: string };
    throw new CommerceError('FULFILLMENT_FAILED', 502, `Payment refunded — fulfillment task creation failed: ${e.message ?? 'unknown error'}`);
  }

  // 3) Payouts: the sellable's custom distribution (EE commission splits) or the default
  //    seller payout. 4) Then the fee leg (operator | burn).
  if (session.total > 0) {
    for (let i = 0; i < lines.length; i++) {
      const { item, gross, fee, net } = lines[i]!;
      const sellable = sellables[i]!;
      if (sellable.distribute) {
        await sellable.distribute(ctx, { session, item, gross, fee, net, trackingCode: collected.trackingCode });
      } else {
        await handler.payout(ctx, { toGhii: sellable.sellerGhii, amount: net, currency: session.currency, buyerGhii: session.buyerGhii, trackingCode: collected.trackingCode, reference: session.id });
      }
    }
    // Fee leg. Morsels: route to operator|burn on the ledger. Money: no ledger movement — record
    // the operator's platform-fee entry (collected live via Stripe Connect application-fee, or an
    // invoice receivable otherwise) so the operator's cut is ACCOUNTED and shows in the dashboard.
    if (!isMoneyCurrency(session.currency)) {
      await settleMarketplaceFee(storage, config, { fee: totalFee, payerGhii: session.buyerGhii, trackingCode: collected.trackingCode, source: 'commerce' });
    } else if (totalFee > 0) {
      await recordMoneyPlatformFee(storage, config, {
        fee: totalFee, currency: session.currency, sellerGhii: session.sellerGhii,
        buyerGhii: session.buyerGhii, trackingCode: collected.trackingCode, handler: handler.id,
      });
    }
  }

  const completed: CheckoutSessionRecord = {
    ...session,
    status: 'completed',
    receipt: { handler: handler.id, charged: session.total, earned: totalNet, fee: totalFee, trackingCode: collected.trackingCode },
    fulfillment: { taskIds },
    updatedAt: new Date().toISOString(),
  };
  await putRecord(storage, session.buyerGhii, sessionKey(session.id), completed);
  // The seller's orders-received copy, under THEIR GHII (readable without touching buyer data).
  await putRecord(storage, session.sellerGhii, orderKey(session.id), completed);
  emitChange('agent-tasks');
  return completed;
}
