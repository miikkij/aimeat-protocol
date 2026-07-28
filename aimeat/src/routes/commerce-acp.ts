/**
 * @file src/routes/commerce-acp.ts
 * @description ACP merchant surface (TARGET-033 phase 5): Agentic Commerce Protocol -shaped
 *   product feed + checkout endpoints over the same session service the native and UCP adapters
 *   use. The feed lists every PUBLIC, priced agent offer on the node as an ACP-ish product entry
 *   (sku = "offer:<agentGaii>:<offerId>"). Checkout completion settles through the node's
 *   registered payment handlers — real-money delegated payment (Stripe SPT) arrives with the EE
 *   phase-6 handler; until then Community callers settle in morsels. The ChatGPT Instant Checkout
 *   program itself is gated on OpenAI's side — this is the merchant-side implementation kept
 *   ready, discoverable at /.well-known/acp.json.
 * @structure
 *   - GET  /v1/commerce/feed                      public product feed (ACP-shaped entries)
 *   - GET  /v1/commerce/tools                     priced app-tool catalog (MCP card pointer target)
 *   - GET  /.well-known/acp.json                  discovery document
 *   - POST /acp/v1/checkout_sessions              create ({ items: [{ id, quantity }] })
 *   - GET  /acp/v1/checkout_sessions/:id          read (buyer only)
 *   - POST /acp/v1/checkout_sessions/:id/complete ({ payment_data: { provider?, handler?, token? } })
 * @version-history
 *   v1.3.0 — 2026-07-14 — Feed app-tool scan extracted to the shared app-tool-catalog enumerator +
 *     dedicated GET /v1/commerce/tools catalog endpoint (TARGET-034 phase D)
 *   v1.2.0 — 2026-07-14 — Feed lists unbound priced tools too (task path) + per-product
 *     `fulfillment: 'call' | 'task'` hint (TARGET-034 phase B)
 *   v1.1.0 — 2026-07-14 — app-tool products in the feed (sku "app-tool:<owner>/<appId>:<tool>")
 *     + app-tool sku checkout + caller JWT threaded into completeSession (TARGET-034 phase A)
 *   v1.0.0 — 2026-07-13 — Initial ACP merchant surface (TARGET-033 phase 5)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Offer } from '../models/offer-schemas.js';
import { listPricedAppTools } from '../commerce/app-tool-catalog.js';
import { requireAuth } from '../auth/middleware.js';
import { error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
  createSession, getSession, completeSession, CommerceError,
} from '../commerce/session-service.js';
import type { CheckoutSessionRecord } from '../commerce/types.js';
import { PaymentError } from '../commerce/payment-handlers.js';
import { paymentChallenge } from '../commerce/x402.js';

const FEED_CAP = 500;

const CreateSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1).max(500),
    quantity: z.number().int().positive().max(1000).optional(),
  })).min(1).max(20),
  note: z.string().max(2000).optional(),
});
const CompleteSchema = z.object({
  payment_data: z.object({
    provider: z.string().max(100).optional(),
    handler: z.string().max(100).optional(),
    token: z.unknown().optional(),
  }).optional(),
});

/** ACP payment providers map onto our handler registry ids. */
function handlerFor(paymentData?: { provider?: string; handler?: string }): string | undefined {
  if (paymentData?.handler) return paymentData.handler;
  if (paymentData?.provider === 'stripe') return 'com.stripe.spt';
  return undefined; // default handler (morsels)
}

function parseSku(id: string): { kind: 'offer'; agent: string; offer_id: string } | { kind: 'app-tool'; app: string; tool: string } {
  const parts = id.split(':');
  if (parts[0] === 'offer' && parts.length >= 3) {
    return { kind: 'offer', agent: parts[1] as string, offer_id: parts.slice(2).join(':') };
  }
  if (parts[0] === 'app-tool' && parts.length >= 3) {
    return { kind: 'app-tool', app: parts[1] as string, tool: parts.slice(2).join(':') };
  }
  throw new CommerceError('INVALID_ITEM', 400, `Unparseable sku: ${id} (use "offer:<agentGaii>:<offerId>" or "app-tool:<owner>/<appId>:<tool>")`);
}

/** ACP status vocabulary over our lifecycle. */
const ACP_STATUS: Record<CheckoutSessionRecord['status'], string> = {
  open: 'ready_for_payment', completed: 'completed', cancelled: 'canceled', expired: 'expired',
};

function toAcpSession(s: CheckoutSessionRecord) {
  return {
    id: s.id,
    status: ACP_STATUS[s.status] ?? s.status,
    currency: s.currency,
    line_items: s.items.map((i) => ({
      id: i.kind === 'app-tool' ? `app-tool:${i.app ?? i.agent}:${i.offerId}` : `offer:${i.agent}:${i.offerId}`,
      title: i.title, quantity: i.quantity,
      unit_price: i.unitPrice, total: i.unitPrice * i.quantity,
    })),
    totals: [{ type: 'total', amount: s.total }],
    ...(s.receipt ? { payment: { receipt: s.receipt } } : {}),
    ...(s.fulfillment ? { fulfillment: s.fulfillment } : {}),
    expires_at: s.expiresAt,
  };
}

function sendAcpError(res: Response, config: AimeatConfig, err: unknown): void {
  const e = (err instanceof CommerceError || err instanceof PaymentError)
    ? err
    : new CommerceError('COMMERCE_ERROR', 500, (err as { message?: string }).message ?? 'Unexpected commerce error');
  res.status(e.statusCode).json({
    ...error(config.nodeId, e.code, e.message),
    ...(e.statusCode === 402 ? paymentChallenge(config) : {}),
  });
}

export function commerceAcpRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── Discovery + feed (public, also served when commerce is disabled — they say so) ──

  router.get('/.well-known/acp.json', (_req, res) => {
    const b = config.baseUrl;
    res.json({
      version: 'draft',
      commerce_enabled: config.commerceEnabled,
      feed: { url: `${b}/v1/commerce/feed`, format: 'json' },
      checkout: { base_url: `${b}/acp/v1/checkout_sessions` },
      // App-tool products also surface IN-PAGE via the WebMCP bridge (TARGET-034 phase C).
      webmcp: { library: `${b}/v1/libs/aimeat-webmcp.js`, app_listing: `${b}/v1/apps/{owner}/{filename}/webmcp` },
      note: 'ACP merchant surface over the AIMEAT commerce core. Real-money payment settles on the SELLER\'s own Stripe account, or offline by invoice; morsel sales settle on this node\'s ledger with AIMEAT authentication.',
    });
  });

  // Every PUBLIC, priced agent offer on the node, as an ACP-shaped product entry.
  router.get('/v1/commerce/feed', async (_req, res) => {
    if (!config.commerceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Commerce is disabled on this node')); return;
    }
    const { items } = await storage.listAllMemory({ prefix: 'agents.', limit: 2000 });
    const products: Array<Record<string, unknown>> = [];
    for (const rec of items) {
      if (!/^agents\.[^.]+\.offers$/.test(rec.key)) continue;
      const offers = ((rec.value as { offers?: Offer[] } | undefined)?.offers) ?? [];
      for (const offer of offers) {
        if ((offer.visibility ?? 'private') !== 'public') continue;
        // Listable when priced in morsels OR money (a money-only offer belongs in the feed too).
        const hasMorsel = !!offer.price && offer.price.morsels > 0;
        if (!hasMorsel && !offer.priceMoney) continue;
        const price = hasMorsel
          ? { amount: offer.price!.morsels, currency: 'MORSEL', unit: offer.price!.unit ?? 'per-call' }
          : { amount: offer.priceMoney!.amount, currency: offer.priceMoney!.currency, unit: 'per-call', scale: 6 };
        products.push({
          id: `offer:${rec.ownerGaii}:${offer.id}`,
          title: offer.title,
          description: offer.ask,
          price,
          availability: 'in_stock',
          seller: { agent: rec.ownerGaii },
          ...(offer.tags?.length ? { tags: offer.tags } : {}),
        });
        if (products.length >= FEED_CAP) break;
      }
      if (products.length >= FEED_CAP) break;
    }
    // Priced app-tools (TARGET-034): every PUBLIC apps.{appId}.tools manifest contributes its
    // priced tools as products (sku "app-tool:<owner>/<appId>:<tool>"). `fulfillment` tells the
    // buyer what completion does: 'call' = the backing capability runs synchronously and the
    // result rides on the session; 'task' = an agent TASK is queued for the app owner (phase B).
    // One shared scanner (app-tool-catalog.ts) feeds this, /v1/commerce/tools, and the MCP card.
    if (products.length < FEED_CAP) {
      for (const t of await listPricedAppTools(storage, config, FEED_CAP - products.length)) {
        const appId = t.app.split('/').slice(1).join('/');
        products.push({
          id: t.sku,
          title: `${appId} · ${t.name}`,
          description: t.description,
          price: t.price
            ? { amount: t.price.morsels, currency: 'MORSEL', unit: t.price.unit }
            : { amount: t.priceMoney!.amount, currency: t.priceMoney!.currency, unit: 'per-call', scale: 6 },
          availability: 'in_stock',
          fulfillment: t.fulfillment,
          seller: { app: t.app },
        });
      }
    }
    res.json({ version: 'draft', updated_at: new Date().toISOString(), products, total: products.length });
  });

  // The dedicated priced-app-tool catalog (TARGET-034 phase D): the MCP Server Card's
  // commerce_tools target — full normalized entries (sku, schema, price, WebMCP invoke,
  // ready-made checkout item) from the same shared scanner the feed uses. Public.
  router.get('/v1/commerce/tools', async (_req, res) => {
    if (!config.commerceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Commerce is disabled on this node')); return;
    }
    const tools = await listPricedAppTools(storage, config, FEED_CAP);
    res.json({
      version: 'draft',
      updated_at: new Date().toISOString(),
      note: 'Priced app-tools sellable through the commerce checkout. Payment IS the invocation: open + complete a checkout session with checkout_item (+ your input); a callable tool returns its result on session.fulfillment.results, a task tool queues the order. Unpaid HTTP invokes answer 402 with x402 accepts.',
      checkout: { create: { method: 'POST', url: `${config.baseUrl}/v1/commerce/checkout-sessions` } },
      tools,
      total: tools.length,
    });
  });

  // ── Checkout (authenticated — morsel settlement needs an AIMEAT principal) ──

  router.use('/acp/v1', (_req, res, next) => {
    if (!config.commerceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Commerce checkout is disabled on this node')); return;
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

  router.post('/acp/v1/checkout_sessions', requireAuth(), async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_CHECKOUT', parsed.error.message)); return; }
    try {
      const session = await createSession(storage, config, {
        buyerOwner: req.auth!.owner as string,
        buyerIdentity: resolveIdentity(req.auth!, config.nodeId),
        items: parsed.data.items.map((i) => ({ ...parseSku(i.id), quantity: i.quantity ?? 1 })),
        note: parsed.data.note,
      });
      res.status(201).json(toAcpSession(session));
    } catch (err) { sendAcpError(res, config, err); }
  });

  router.get('/acp/v1/checkout_sessions/:id', requireAuth(), async (req, res) => {
    try { res.json(toAcpSession(await loadOwnSession(req))); }
    catch (err) { sendAcpError(res, config, err); }
  });

  router.post('/acp/v1/checkout_sessions/:id/complete', requireAuth(), async (req, res) => {
    const parsed = CompleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_CHECKOUT', parsed.error.message)); return; }
    try {
      const session = await loadOwnSession(req);
      const callerJwt = (req.headers.authorization || '').replace('Bearer ', '');
      const completed = await completeSession(
        storage, config, session,
        handlerFor(parsed.data.payment_data),
        parsed.data.payment_data?.token,
        callerJwt,
      );
      res.json(toAcpSession(completed));
    } catch (err) { sendAcpError(res, config, err); }
  });

  return router;
}
