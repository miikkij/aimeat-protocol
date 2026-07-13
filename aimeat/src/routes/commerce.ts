/**
 * @file src/routes/commerce.ts
 * @description Native REST adapter of the commerce core (TARGET-033): checkout sessions over the
 *   protocol-agnostic session service. Create → (update/cancel) → complete with a payment handler;
 *   completion fulfills each line item as an agent TASK on the offer-ask path. Auth mirrors the
 *   offer-invoke precedent (requireAuth, identity via resolveIdentity; sessions are readable and
 *   mutable only by the buyer owner). UCP/ACP/x402 adapters mount beside this later — same core.
 * @structure
 *   - POST   /v1/commerce/checkout-sessions            create (items: [{agent, offer_id, quantity?}])
 *   - GET    /v1/commerce/checkout-sessions/:id        read (buyer only; lazy expiry)
 *   - PATCH  /v1/commerce/checkout-sessions/:id        replace items OR { cancel: true }
 *   - POST   /v1/commerce/checkout-sessions/:id/complete  charge + fulfill (payment.handler optional)
 * @version-history
 *   v1.0.0 — 2026-07-13 — Initial native checkout adapter (TARGET-033 phase 1)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
  createSession, getSession, updateSessionItems, cancelSession, completeSession, CommerceError,
} from '../commerce/session-service.js';
import type { CheckoutSessionRecord } from '../commerce/types.js';
import { PaymentError } from '../commerce/payment-handlers.js';

const ItemsSchema = z.array(z.object({
  agent: z.string().min(1).max(300),
  offer_id: z.string().min(1).max(100),
  quantity: z.number().int().positive().max(1000).optional(),
})).min(1).max(20);

const CreateSchema = z.object({
  items: ItemsSchema,
  note: z.string().max(2000).optional(),
});

const PatchSchema = z.object({
  items: ItemsSchema.optional(),
  cancel: z.boolean().optional(),
}).refine((b) => b.cancel === true || !!b.items, { message: 'Provide items to update or cancel:true' });

const CompleteSchema = z.object({
  payment: z.object({ handler: z.string().max(100).optional() }).optional(),
});

function sendCommerceError(res: Response, nodeId: string, err: unknown): void {
  if (err instanceof CommerceError || err instanceof PaymentError) {
    res.status(err.statusCode).json(error(nodeId, err.code, err.message));
    return;
  }
  const e = err as { message?: string };
  res.status(500).json(error(nodeId, 'COMMERCE_ERROR', e.message ?? 'Unexpected commerce error'));
}

export function commerceRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Buyer-owner guard: load the caller's session or 404/403 (a foreign id is indistinguishable from missing). */
  async function loadOwnSession(req: Request): Promise<CheckoutSessionRecord> {
    const buyerGhii = `${req.auth!.owner}@${config.nodeId}`;
    const id = decodeURIComponent(req.params.id as string);
    const session = await getSession(storage, buyerGhii, id);
    if (!session) throw new CommerceError('SESSION_NOT_FOUND', 404, `Checkout session not found: ${id}`);
    return session;
  }

  // POST /v1/commerce/checkout-sessions — open a session against one seller's offers.
  router.post('/v1/commerce/checkout-sessions', requireAuth(), async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_CHECKOUT', parsed.error.message)); return; }
    try {
      const session = await createSession(storage, config, {
        buyerOwner: req.auth!.owner as string,
        buyerIdentity: resolveIdentity(req.auth!, config.nodeId),
        items: parsed.data.items,
        note: parsed.data.note,
      });
      res.status(201).json(success(config.nodeId, { session }, [
        { description: 'Complete checkout', method: 'POST', url: `/v1/commerce/checkout-sessions/${session.id}/complete` },
        { description: 'Update items', method: 'PATCH', url: `/v1/commerce/checkout-sessions/${session.id}` },
      ]));
    } catch (err) { sendCommerceError(res, config.nodeId, err); }
  });

  // GET /v1/commerce/checkout-sessions/:id — buyer reads their session (lazy expiry applies).
  router.get('/v1/commerce/checkout-sessions/:id', requireAuth(), async (req, res) => {
    try {
      const session = await loadOwnSession(req);
      res.json(success(config.nodeId, { session }));
    } catch (err) { sendCommerceError(res, config.nodeId, err); }
  });

  // PATCH /v1/commerce/checkout-sessions/:id — replace the cart, or cancel.
  router.patch('/v1/commerce/checkout-sessions/:id', requireAuth(), async (req, res) => {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_CHECKOUT', parsed.error.message)); return; }
    try {
      let session = await loadOwnSession(req);
      session = parsed.data.cancel === true
        ? await cancelSession(storage, session)
        : await updateSessionItems(storage, config, session, parsed.data.items!);
      res.json(success(config.nodeId, { session }));
    } catch (err) { sendCommerceError(res, config.nodeId, err); }
  });

  // POST /v1/commerce/checkout-sessions/:id/complete — charge + fulfill.
  router.post('/v1/commerce/checkout-sessions/:id/complete', requireAuth(), async (req, res) => {
    const parsed = CompleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_CHECKOUT', parsed.error.message)); return; }
    try {
      const session = await loadOwnSession(req);
      const completed = await completeSession(storage, config, session, parsed.data.payment?.handler);
      res.json(success(config.nodeId, { session: completed }, [
        { description: 'Wallet balance', method: 'GET', url: '/v1/wallet' },
      ]));
    } catch (err) { sendCommerceError(res, config.nodeId, err); }
  });

  return router;
}
