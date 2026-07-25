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
 *   v1.3.0 — 2026-07-14 — app-tool line items ({kind:'app-tool', app:'owner/appId', tool, input})
 *     + caller JWT threaded into completeSession for callable fulfillment (TARGET-034 phase A)
 *   v1.2.0 — 2026-07-13 — Item kinds via the sellable-resolver registry (org-offering) + x402-style 402 accepts (phases 4–5)
 *   v1.1.0 — 2026-07-13 — List endpoints, commerceEnabled gate, config TTL (phase 2)
 *   v1.0.0 — 2026-07-13 — Initial native checkout adapter (TARGET-033 phase 1)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { isEvmAddressShape, toChecksumAddress, checksumIsWrong, settlementAssetMatch, probeIsContract } from '../commerce/evm-address.js';
import {
  createSession, getSession, updateSessionItems, cancelSession, completeSession, CommerceError,
  listSessions, listOrders,
} from '../commerce/session-service.js';
import type { CheckoutSessionRecord } from '../commerce/types.js';
import { PaymentError } from '../commerce/payment-handlers.js';
import { paymentChallenge, x402ExactAccepts } from '../commerce/x402.js';
import { decodeXPayment, getX402Network, getX402Asset, x402SettlementCurrencies } from '../commerce/x402-facilitator.js';
import { X402_HANDLER_ID } from '../commerce/x402-handler.js';

const ItemsSchema = z.array(z.object({
  kind: z.enum(['offer', 'org-offering', 'app-tool', 'ext-call']).optional(),
  agent: z.string().min(1).max(300).optional(),
  offer_id: z.string().min(1).max(100).optional(),
  /** app-tool: the tool name (alias for offer_id) — from the app's apps.{appId}.tools manifest. */
  tool: z.string().min(1).max(100).optional(),
  org: z.string().max(200).optional(),
  /** app-tool: "ownerName/appId" — locates the tool manifest. */
  app: z.string().min(3).max(300).optional(),
  /** app-tool: the buyer's tool input, forwarded to the capability invoke at completion. */
  input: z.record(z.string(), z.unknown()).optional(),
  quantity: z.number().int().positive().max(1000).optional(),
}).refine((i) => !!(i.offer_id || i.tool), { message: 'Each line item needs offer_id (offers) or tool (app-tools)' }))
  .min(1).max(20);

const CreateSchema = z.object({
  items: ItemsSchema,
  note: z.string().max(2000).optional(),
  currency: z.string().min(3).max(10).optional(),
});

const PatchSchema = z.object({
  items: ItemsSchema.optional(),
  cancel: z.boolean().optional(),
}).refine((b) => b.cancel === true || !!b.items, { message: 'Provide items to update or cancel:true' });

const CompleteSchema = z.object({
  payment: z.object({
    handler: z.string().max(100).optional(),
    instrument: z.unknown().optional(),
  }).optional(),
});

function sendCommerceError(res: Response, config: AimeatConfig, err: unknown, extraAccepts: Array<Record<string, unknown>> = []): void {
  if (err instanceof CommerceError || err instanceof PaymentError) {
    // 402 carries the `accepts` block: the AIMEAT-native schemes plus the real x402 `exact` scheme
    // (extraAccepts) when the session is a money one and the seller has a USDC address.
    res.status(err.statusCode).json({
      ...error(config.nodeId, err.code, err.message),
      ...(err.statusCode === 402 ? paymentChallenge(config, extraAccepts) : {}),
    });
    return;
  }
  const e = err as { message?: string };
  res.status(500).json(error(config.nodeId, 'COMMERCE_ERROR', e.message ?? 'Unexpected commerce error'));
}

/** The seller's opaque payment-settings record. Holds the Stripe credentials AND the x402 payout
 *  address side by side, so every write MERGES: one rail's settings must never delete the other's. */
const PSP_KEY = 'commerce.psp';
/** An EVM account address — the only shape an x402 stablecoin settlement can pay out to. */
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

type PspRecord = { provider?: string; secretKey?: unknown; payTo?: string; address?: string; x402?: { address?: string; payTo?: string } };

/** Read the seller's payment settings record (private, owner-scoped). */
async function readPsp(storage: Storage, ownerGhii: string): Promise<PspRecord> {
  const rec = await storage.getMemory(ownerGhii, PSP_KEY);
  return (rec?.value as PspRecord | undefined) ?? {};
}

/** The x402 payout address in any of the shapes the facilitator accepts (extractPayTo mirrors this). */
function payToOf(psp: PspRecord): string | null {
  const candidate = psp.payTo ?? psp.address ?? psp.x402?.address ?? psp.x402?.payTo;
  return typeof candidate === 'string' && EVM_ADDRESS.test(candidate.trim()) ? candidate.trim() : null;
}

export function commerceRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Kill-switch: AIMEAT_COMMERCE_ENABLED=false turns the whole surface off (503, machine-readable).
  router.use('/v1/commerce', (_req, res, next) => {
    if (!config.commerceEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Commerce checkout is disabled on this node (AIMEAT_COMMERCE_ENABLED=false)'));
      return;
    }
    next();
  });

  /** Buyer-owner guard: load the caller's session or 404/403 (a foreign id is indistinguishable from missing). */
  async function loadOwnSession(req: Request): Promise<CheckoutSessionRecord> {
    const buyerGhii = `${req.auth!.owner}@${config.nodeId}`;
    const id = decodeURIComponent(req.params.id as string);
    const session = await getSession(storage, buyerGhii, id);
    if (!session) throw new CommerceError('SESSION_NOT_FOUND', 404, `Checkout session not found: ${id}`);
    return session;
  }

  // POST /v1/commerce/checkout-sessions — open a session against one seller's offers.
  /* ── Seller payout settings ────────────────────────────────────────────────────────────────────
   * Which rails can actually pay this seller, and the one setting the seller owns for each. The two
   * rails are deliberately reported apart: Stripe moves fiat (EUR/USD) to a connected account, x402
   * moves a stablecoin on-chain to an address the seller controls. Reading tells you which of your money
   * listings can settle at all — an x402 sale without an address fails with SELLER_NO_X402_ADDRESS. */
  router.get('/v1/commerce/payout', requireAuth(), requireRole('owner'), async (req, res) => {
    const ownerGhii = resolveIdentity(req.auth!, config.nodeId);
    const psp = await readPsp(storage, ownerGhii);
    const address = payToOf(psp);
    // What the stablecoin rail can settle is READ FROM THE NETWORK REGISTRY, never hardcoded: the
    // seller is told the real currency list for the network this node runs on, and which token each
    // one settles in. One address receives them all, so a new currency asks for no new setting.
    const network = getX402Network(config.x402Network);
    const assets = x402SettlementCurrencies(network).map((currency) => {
      const asset = getX402Asset(network, currency)!;
      return { currency, symbol: asset.symbol, address: asset.address, decimals: asset.decimals };
    });
    return res.json(success(config.nodeId, {
      x402: {
        enabled: config.x402Enabled,
        network: config.x402Network,
        testnet: config.x402Network !== 'base',
        configured: !!address,
        address,
        currencies: assets.map((a) => a.currency),
        assets,
        note: config.x402Enabled
          ? `Stablecoin settlement: the buyer signs a payment in the token matching the price (${assets.map((a) => `${a.currency} → ${a.symbol}`).join(', ')}) and the facilitator settles it straight to this address. No key is held by the node.`
          : 'The node operator has not enabled x402 on this node (AIMEAT_X402_ENABLED).',
      },
      stripe: {
        configured: !!psp.secretKey,
        provider: psp.provider ?? null,
        currencies: ['EUR', 'USD'],
        note: 'Card and invoice settlement in real currency, paid out to your connected account.',
      },
    }));
  });

  /**
   * Set the x402 payout address. Guarded, because this is the one hand-typed value in the whole
   * stablecoin flow and a settlement to the wrong target is irreversible: the shape, then the EIP-55
   * checksum (catches a typo the eye cannot), then a check that it is not one of our own settlement
   * TOKEN contracts (the address most likely to be on a seller's clipboard while setting this up),
   * then — when the operator configured an RPC — whether the chain says it holds contract code.
   * Merges into the record, so the Stripe credentials survive.
   */
  router.put('/v1/commerce/payout/x402', requireAuth(), requireRole('owner'), async (req, res) => {
    const raw = (req.body ?? {}) as { address?: unknown };
    const address = typeof raw.address === 'string' ? raw.address.trim() : '';
    if (!isEvmAddressShape(address)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_ADDRESS',
        'address must be an EVM account address: 0x followed by 40 hex characters'));
    }
    if (checksumIsWrong(address)) {
      return res.status(400).json(error(config.nodeId, 'ADDRESS_CHECKSUM',
        'This address fails its EIP-55 checksum, which almost always means a character was mistyped or lost in copying. '
        + 'Paste it again from your wallet, or send it in all lowercase if your wallet does not use mixed case.'));
    }
    const token = settlementAssetMatch(address);
    if (token) {
      return res.status(400).json(error(config.nodeId, 'ADDRESS_IS_TOKEN_CONTRACT',
        `That is the ${token.currency === 'EUR' ? 'EURC' : 'USDC'} token contract on ${token.network}, not a wallet. `
        + 'Funds settled there cannot be recovered. Use the address of an account you hold the key for.'));
    }
    const isContract = await probeIsContract(config.x402RpcUrl, address);
    if (isContract === true) {
      return res.status(400).json(error(config.nodeId, 'ADDRESS_IS_CONTRACT',
        'The chain reports contract code at this address, so it is not a wallet you hold a key for. '
        + 'If this is a smart-contract wallet you control, ask the operator to allow it.'));
    }
    // Store the canonical EIP-55 form: mixed case is what a wallet shows, so the seller can compare.
    const canonical = toChecksumAddress(address);
    const ownerGhii = resolveIdentity(req.auth!, config.nodeId);
    const psp = await readPsp(storage, ownerGhii);
    const now = new Date().toISOString();
    await storage.setMemory({
      key: PSP_KEY, ownerGaii: ownerGhii, value: { ...psp, payTo: canonical },
      visibility: 'private', tags: ['commerce'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    return res.json(success(config.nodeId, {
      configured: true, address: canonical, network: config.x402Network,
      // One address receives every settlement asset this network carries — report them all, so the
      // seller sees that the same setting covers both a USD sale and a EUR one.
      currencies: x402SettlementCurrencies(getX402Network(config.x402Network)),
      enabled: config.x402Enabled,
      checked: { shape: true, checksum: true, notTokenContract: true, onChain: isContract === null ? 'skipped' : 'account' },
    }));
  });

  /** Remove the payout address only — Stripe credentials in the same record are untouched. */
  router.delete('/v1/commerce/payout/x402', requireAuth(), requireRole('owner'), async (req, res) => {
    const ownerGhii = resolveIdentity(req.auth!, config.nodeId);
    const psp = await readPsp(storage, ownerGhii);
    const next: PspRecord = { ...psp };
    delete next.payTo; delete next.address;
    if (next.x402) { const x = { ...next.x402 }; delete x.address; delete x.payTo; next.x402 = x; }
    const now = new Date().toISOString();
    await storage.setMemory({
      key: PSP_KEY, ownerGaii: ownerGhii, value: next,
      visibility: 'private', tags: ['commerce'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    return res.json(success(config.nodeId, { configured: false, note: 'Stablecoin sales now fail until an address is set again. Card/invoice settlement is unaffected.' }));
  });

  router.post('/v1/commerce/checkout-sessions', requireAuth(), async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_CHECKOUT', parsed.error.message)); return; }
    try {
      const session = await createSession(storage, config, {
        buyerOwner: req.auth!.owner as string,
        buyerIdentity: resolveIdentity(req.auth!, config.nodeId),
        items: parsed.data.items,
        note: parsed.data.note,
        currency: parsed.data.currency,
      });
      res.status(201).json(success(config.nodeId, { session }, [
        { description: 'Complete checkout', method: 'POST', url: `/v1/commerce/checkout-sessions/${session.id}/complete` },
        { description: 'Update items', method: 'PATCH', url: `/v1/commerce/checkout-sessions/${session.id}` },
      ]));
    } catch (err) { sendCommerceError(res, config, err); }
  });

  // GET /v1/commerce/checkout-sessions — the buyer's sessions (purchases), newest first.
  router.get('/v1/commerce/checkout-sessions', requireAuth(), async (req, res) => {
    const buyerGhii = `${req.auth!.owner}@${config.nodeId}`;
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
    const sessions = await listSessions(storage, buyerGhii, limit);
    res.json(success(config.nodeId, { sessions, total: sessions.length }));
  });

  // GET /v1/commerce/orders — the seller's received orders (completed sessions), newest first.
  router.get('/v1/commerce/orders', requireAuth(), async (req, res) => {
    const sellerGhii = `${req.auth!.owner}@${config.nodeId}`;
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
    const orders = await listOrders(storage, sellerGhii, limit);
    res.json(success(config.nodeId, { orders, total: orders.length }));
  });

  // GET /v1/commerce/checkout-sessions/:id — buyer reads their session (lazy expiry applies).
  router.get('/v1/commerce/checkout-sessions/:id', requireAuth(), async (req, res) => {
    try {
      const session = await loadOwnSession(req);
      res.json(success(config.nodeId, { session }));
    } catch (err) { sendCommerceError(res, config, err); }
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
    } catch (err) { sendCommerceError(res, config, err); }
  });

  // POST /v1/commerce/checkout-sessions/:id/complete — charge + fulfill.
  router.post('/v1/commerce/checkout-sessions/:id/complete', requireAuth(), async (req, res) => {
    const parsed = CompleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_CHECKOUT', parsed.error.message)); return; }
    let session: CheckoutSessionRecord | undefined;
    try {
      session = await loadOwnSession(req);
      const callerJwt = (req.headers.authorization || '').replace('Bearer ', '');
      // x402: a buyer settling in USDC returns the signed proof in the X-PAYMENT header. When present
      // it becomes the payment instrument and (unless another handler is named) selects the x402 handler.
      const xPayment = decodeXPayment(req.header('X-PAYMENT') ?? undefined);
      const handlerId = parsed.data.payment?.handler ?? (xPayment ? X402_HANDLER_ID : undefined);
      const instrument = xPayment ?? parsed.data.payment?.instrument;
      const completed = await completeSession(storage, config, session, handlerId, instrument, callerJwt);
      res.json(success(config.nodeId, { session: completed }, [
        { description: 'Wallet balance', method: 'GET', url: '/v1/wallet' },
      ]));
    } catch (err) {
      // On a 402 from an x402 (money) session, enrich the accepts with the exact scheme the buyer signs.
      sendCommerceError(res, config, err, session ? await x402ExactAccepts(config, storage, session) : []);
    }
  });

  return router;
}
