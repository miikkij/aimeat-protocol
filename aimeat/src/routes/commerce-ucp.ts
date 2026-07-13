/**
 * @file src/routes/commerce-ucp.ts
 * @description UCP checkout adapter (TARGET-033 phase 4): Universal Commerce Protocol (2026-04-08)
 *   shaped endpoints over the protocol-agnostic session service. Implements the conformance
 *   basics — `ucp.version` + `ucp.capabilities` echoed in every response, capability intersection
 *   against the calling platform's profile from the `UCP-Agent` header (fetched via safeFetch,
 *   best-effort) — and the three checkout endpoints. Settlement uses the node's registered
 *   payment handlers (Community: io.aimeat.morsels, so callers authenticate as AIMEAT principals;
 *   EE money handlers appear automatically). Item ids: "offer:<agentGaii>:<offerId>" or
 *   "org-offering:<owner>/<slug>:<agentGaii>:<offerId>".
 * @structure
 *   - POST  /ucp/v1/checkout-sessions            create ({ line_items: [{ item:{id}|ref, quantity }] })
 *   - GET   /ucp/v1/checkout-sessions/:id        read (buyer only)
 *   - PATCH /ucp/v1/checkout-sessions/:id        update line_items OR { cancel: true }
 *   - POST  /ucp/v1/checkout-sessions/:id/complete  ({ payment: { handler?, instrument? } })
 * @version-history
 *   v1.0.0 — 2026-07-13 — Initial UCP adapter (TARGET-033 phase 4)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import {
  createSession, getSession, updateSessionItems, cancelSession, completeSession, CommerceError,
} from '../commerce/session-service.js';
import type { CheckoutSessionRecord } from '../commerce/types.js';
import type { SellableRef } from '../commerce/sellable-resolvers.js';
import { PaymentError, listPaymentHandlers } from '../commerce/payment-handlers.js';
import { paymentChallenge } from '../commerce/x402.js';

export const UCP_VERSION = '2026-04-08';
const UCP_CAPABILITIES = [{ name: 'dev.ucp.shopping.checkout', version: '1' }];

const LineItemSchema = z.object({
  item: z.union([
    z.object({ id: z.string().min(1).max(500) }),
    z.object({
      kind: z.enum(['offer', 'org-offering']).optional(),
      agent: z.string().max(300).optional(),
      offer_id: z.string().min(1).max(100),
      org: z.string().max(200).optional(),
    }),
  ]),
  quantity: z.number().int().positive().max(1000).optional(),
});
const CreateSchema = z.object({
  line_items: z.array(LineItemSchema).min(1).max(20),
  note: z.string().max(2000).optional(),
  currency: z.string().min(3).max(10).optional(),
});
const PatchSchema = z.object({
  line_items: z.array(LineItemSchema).optional(),
  cancel: z.boolean().optional(),
}).refine((b) => b.cancel === true || !!b.line_items, { message: 'Provide line_items to update or cancel:true' });
const CompleteSchema = z.object({
  payment: z.object({ handler: z.string().max(100).optional(), instrument: z.unknown().optional() }).optional(),
});

/** "offer:<agentGaii>:<offerId>" | "org-offering:<owner>/<slug>:<agentGaii>:<offerId>" → SellableRef */
function parseItemId(id: string): SellableRef {
  const parts = id.split(':');
  if (parts[0] === 'offer' && parts.length >= 3) {
    return { kind: 'offer', agent: parts[1] as string, offer_id: parts.slice(2).join(':') };
  }
  if (parts[0] === 'org-offering' && parts.length >= 4) {
    return { kind: 'org-offering', org: parts[1] as string, agent: parts[2] as string, offer_id: parts.slice(3).join(':') };
  }
  throw new CommerceError('INVALID_ITEM', 400, `Unparseable item id: ${id} (use "offer:<agentGaii>:<offerId>")`);
}

function toRefs(lineItems: z.infer<typeof CreateSchema>['line_items']): SellableRef[] {
  return lineItems.map((li) => {
    const ref: SellableRef = 'id' in li.item ? parseItemId(li.item.id) : { ...li.item };
    ref.quantity = li.quantity ?? 1;
    return ref;
  });
}

const itemId = (i: CheckoutSessionRecord['items'][number]) =>
  i.kind === 'org-offering' ? `org-offering:${i.org}:${i.agent}:${i.offerId}` : `offer:${i.agent}:${i.offerId}`;

/** Map our session record onto a UCP-shaped checkout_session. */
function toUcpSession(s: CheckoutSessionRecord) {
  return {
    id: s.id,
    status: s.status,
    currency: s.currency,
    line_items: s.items.map((i) => ({
      item: { id: itemId(i), title: i.title },
      quantity: i.quantity,
      unit_price: i.unitPrice,
      total: i.unitPrice * i.quantity,
    })),
    totals: { grand_total: s.total },
    payment: {
      handlers: listPaymentHandlers().map((h) => ({ id: h.id, currencies: h.currencies })),
      ...(s.receipt ? { receipt: s.receipt } : {}),
    },
    ...(s.fulfillment ? { fulfillment: s.fulfillment } : {}),
    expires_at: s.expiresAt,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

/**
 * Capability negotiation (best-effort): the platform advertises its profile URL in the UCP-Agent
 * header; we fetch it and intersect capabilities. A failed fetch never blocks checkout — the
 * response then carries only OUR capabilities.
 */
async function negotiate(req: Request): Promise<Array<{ name: string; version: string }>> {
  const profileUrl = req.headers['ucp-agent'];
  if (typeof profileUrl !== 'string' || !/^https?:\/\//.test(profileUrl)) return UCP_CAPABILITIES;
  try {
    const res = await safeFetch(profileUrl, { signal: AbortSignal.timeout(3000) });
    const profile = await res.json() as { ucp?: { capabilities?: Array<{ name?: string }> } };
    const theirs = new Set((profile.ucp?.capabilities ?? []).map((c) => c.name));
    const shared = UCP_CAPABILITIES.filter((c) => theirs.has(c.name));
    return shared.length ? shared : UCP_CAPABILITIES;
  } catch (err) {
    logger.warn(`[ucp] platform profile fetch failed (${profileUrl}): ${err instanceof Error ? err.message : String(err)}`);
    return UCP_CAPABILITIES;
  }
}

function ucpEnvelope(capabilities: Array<{ name: string; version: string }>, body: object) {
  return { ucp: { version: UCP_VERSION, capabilities }, ...body };
}

function sendUcpError(res: Response, config: AimeatConfig, err: unknown): void {
  const e = (err instanceof CommerceError || err instanceof PaymentError)
    ? err
    : new CommerceError('COMMERCE_ERROR', 500, (err as { message?: string }).message ?? 'Unexpected commerce error');
  res.status(e.statusCode).json(ucpEnvelope(UCP_CAPABILITIES, {
    ...error(config.nodeId, e.code, e.message),
    ...(e.statusCode === 402 ? paymentChallenge(config) : {}),
  }));
}

export function commerceUcpRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.use('/ucp/v1', (_req, res, next) => {
    if (!config.commerceEnabled) {
      res.status(503).json(ucpEnvelope(UCP_CAPABILITIES, error(config.nodeId, 'FEATURE_DISABLED', 'Commerce checkout is disabled on this node')));
      return;
    }
    next();
  });

  async function loadOwnSession(req: Request): Promise<CheckoutSessionRecord> {
    const buyerGhii = `${req.auth!.owner}@${config.nodeId}`;
    const id = decodeURIComponent(req.params.id as string);
    const session = await getSession(storage, buyerGhii, id);
    if (!session) throw new CommerceError('SESSION_NOT_FOUND', 404, `Checkout session not found: ${id}`);
    return session;
  }

  router.post('/ucp/v1/checkout-sessions', requireAuth(), async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(ucpEnvelope(UCP_CAPABILITIES, error(config.nodeId, 'INVALID_CHECKOUT', parsed.error.message))); return; }
    try {
      const capabilities = await negotiate(req);
      const session = await createSession(storage, config, {
        buyerOwner: req.auth!.owner as string,
        buyerIdentity: resolveIdentity(req.auth!, config.nodeId),
        items: toRefs(parsed.data.line_items),
        note: parsed.data.note,
        currency: parsed.data.currency,
      });
      res.status(201).json(ucpEnvelope(capabilities, { checkout_session: toUcpSession(session) }));
    } catch (err) { sendUcpError(res, config, err); }
  });

  router.get('/ucp/v1/checkout-sessions/:id', requireAuth(), async (req, res) => {
    try {
      const session = await loadOwnSession(req);
      res.json(ucpEnvelope(UCP_CAPABILITIES, { checkout_session: toUcpSession(session) }));
    } catch (err) { sendUcpError(res, config, err); }
  });

  router.patch('/ucp/v1/checkout-sessions/:id', requireAuth(), async (req, res) => {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(ucpEnvelope(UCP_CAPABILITIES, error(config.nodeId, 'INVALID_CHECKOUT', parsed.error.message))); return; }
    try {
      let session = await loadOwnSession(req);
      session = parsed.data.cancel === true
        ? await cancelSession(storage, session)
        : await updateSessionItems(storage, config, session, toRefs(parsed.data.line_items!));
      res.json(ucpEnvelope(UCP_CAPABILITIES, { checkout_session: toUcpSession(session) }));
    } catch (err) { sendUcpError(res, config, err); }
  });

  router.post('/ucp/v1/checkout-sessions/:id/complete', requireAuth(), async (req, res) => {
    const parsed = CompleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json(ucpEnvelope(UCP_CAPABILITIES, error(config.nodeId, 'INVALID_CHECKOUT', parsed.error.message))); return; }
    try {
      const session = await loadOwnSession(req);
      const completed = await completeSession(storage, config, session, parsed.data.payment?.handler, parsed.data.payment?.instrument);
      res.json(ucpEnvelope(UCP_CAPABILITIES, { checkout_session: toUcpSession(completed) }));
    } catch (err) { sendUcpError(res, config, err); }
  });

  return router;
}
