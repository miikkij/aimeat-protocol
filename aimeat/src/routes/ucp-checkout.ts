/**
 * @file src/routes/ucp-checkout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST binding of the place's own UCP checkout, version 2026-08-25, for AI
 *   shopping platforms buying for a person with no account here (commerce/ucp-guest-checkout.ts).
 *   Base `/ucp/2026-08-25`, as the business profile at /.well-known/ucp names it:
 *     POST /checkout-sessions · GET /checkout-sessions/{id} · PUT /checkout-sessions/{id}
 *     POST /checkout-sessions/{id}/complete · POST /checkout-sessions/{id}/cancel · GET /orders/{id}
 *   The 2026-04-08 checkout for signed-in AIMEAT buyers stays at /ucp/v1 (routes/commerce-ucp.ts).
 *
 *   AS THE SPEC SAYS (docs/specification/shopping/checkout/rest.md, read 2026-10-08):
 *   - every request carries `UCP-Agent: profile="https://…"`; without it, 400 invalid_profile_url;
 *   - a signed request (RFC 9421) is verified against the keys of the profile it names, and a bad
 *     signature is 401; an unsigned one is taken, because UCP lets a business keep checkout open;
 *   - GET /orders/{id} MUST authenticate the platform, so it takes only a signed request from the
 *     platform that placed the order;
 *   - Idempotency-Key: a repeat with the same body answers the stored response, with another body
 *     409; keys are kept 48 hours;
 *   - a business outcome (an item not sold, a payment that failed) is HTTP 200 with `messages`; a
 *     protocol error is its HTTP status with `{ code, content }`.
 * @structure ucpCheckoutRouter
 * @usage router.use(ucpCheckoutRouter(config, storage)); // from commerceUcpRouter
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer E).
 */
import { Router, type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config-types.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { logger } from '../utils/logger.js';
import {
  UCP_VERSION, UcpError, createGuestCheckout, readGuestCheckout, updateGuestCheckout, cancelGuestCheckout,
  completeGuestCheckout, sellerPaymentHandlers, toUcpCheckout, toUcpOrder, readUcpOrder, sellerOfSessionId, sellerOfLines,
  type UcpGuestSession,
} from '../commerce/ucp-guest-checkout.js';
import { parseUcpAgent, platformProfile } from '../services/ucp/platform-profile.js';
import { verifyMessage } from '../services/ucp/http-signatures.js';

// Written out on every route, not built from UCP_VERSION, so the contract check (check:openapi-routes)
// sees each path; a version change edits them together with openapi.yaml.

export function ucpCheckoutRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const limit = rateLimit({ windowMs: 60_000, max: 120, keyBy: 'ip' });
  const allowHttp = config.baseUrl.startsWith('http://');

  const protocolError = (res: Response, status: number, code: string, content: string): void => {
    res.status(status).json({ code, content });
  };
  const outcome = (res: Response, e: UcpError): void => {
    res.status(200).json({
      ucp: { version: UCP_VERSION, status: 'error' },
      messages: [{ type: 'error', code: e.code, ...(e.path ? { path: e.path } : {}), content: e.message, severity: e.severity }],
    });
  };
  const fail = (res: Response, e: unknown): void => {
    if (e instanceof UcpError) {
      if (e.httpStatus === 200) outcome(res, e);
      else protocolError(res, e.httpStatus, e.code, e.message);
      return;
    }
    logger.error('ucp: a checkout call failed', { error: String(e) });
    protocolError(res, 500, 'internal_error', 'The checkout could not be handled.');
  };

  /** The raw body as it arrived, for the digest a signature covers. */
  const rawOf = (req: Request): Buffer | null => {
    const r = (req as Request & { rawBody?: Buffer }).rawBody;
    if (Buffer.isBuffer(r)) return r;
    return req.body && Object.keys(req.body as object).length ? Buffer.from(JSON.stringify(req.body)) : null;
  };

  /**
   * The platform profile a request names, after its signature (when it has one) checked out
   * against that profile's keys. `mustSign` refuses an unsigned request.
   */
  async function platformOf(req: Request, res: Response, mustSign: boolean): Promise<string | null> {
    if (!config.commerceEnabled) { protocolError(res, 503, 'unavailable', 'Checkout is switched off on this node.'); return null; }
    const profileUrl = parseUcpAgent(req.get('ucp-agent'), allowHttp);
    if (!profileUrl) { protocolError(res, 400, 'invalid_profile_url', 'UCP-Agent must name the platform profile: profile="https://…".'); return null; }
    const signed = req.get('signature-input') !== undefined || req.get('signature') !== undefined;
    if (!signed && mustSign) { protocolError(res, 401, 'signature_missing', 'This request must be signed by the platform (RFC 9421).'); return null; }
    if (signed) {
      const profile = await platformProfile(profileUrl);
      if (!profile) { protocolError(res, 424, 'profile_unreachable', 'The platform profile could not be fetched to check the signature.'); return null; }
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const r = verifyMessage({ method: req.method, url, headers }, rawOf(req), profile.keys);
      if (!r.ok) { protocolError(res, r.code === 'digest_mismatch' || r.code === 'algorithm_unsupported' ? 400 : 401, r.code, 'The request signature did not verify.'); return null; }
    }
    return profileUrl;
  }

  /** Idempotency: the stored answer to a repeated key, or a 409 for the same key with another body. */
  async function replay(req: Request, res: Response, sellerGhii: string | null, profileUrl: string): Promise<{ done: boolean; store: (status: number, body: unknown) => Promise<void> }> {
    const key = req.get('idempotency-key');
    const noop = { done: false, store: async () => undefined };
    if (!key || !sellerGhii) return noop;
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) { protocolError(res, 400, 'invalid_request', 'Idempotency-Key must be 16 to 128 letters, digits, dashes or underscores.'); return { done: true, store: noop.store }; }
    const memKey = `commerce.ucp.idem.${createHash('sha256').update(`${profileUrl}|${req.method}|${req.path}|${key}`).digest('hex').slice(0, 40)}`;
    const bodyHash = createHash('sha256').update(rawOf(req) ?? Buffer.alloc(0)).digest('hex');
    const prior = (await storage.getMemory(sellerGhii, memKey))?.value as { bodyHash: string; status: number; body: unknown } | undefined;
    if (prior) {
      if (prior.bodyHash !== bodyHash) protocolError(res, 409, 'idempotency_conflict', 'This Idempotency-Key was used with another body.');
      else res.status(prior.status).json(prior.body);
      return { done: true, store: noop.store };
    }
    return {
      done: false,
      store: async (status: number, body: unknown) => {
        const now = new Date().toISOString();
        await storage.setMemory({
          key: memKey, ownerGaii: sellerGhii, value: { bodyHash, status, body } as Record<string, unknown>,
          visibility: 'owner', tags: ['ucp'], ttlHours: 48, version: 1, createdAt: now, updatedAt: now,
        } as MemoryRecord);
      },
    };
  }

  async function answer(res: Response, status: number, session: UcpGuestSession, store: (s: number, b: unknown) => Promise<void>): Promise<void> {
    const body = toUcpCheckout(session, config, await sellerPaymentHandlers(storage, config, session.sellerGhii));
    await store(status, body);
    res.status(status).json(body);
  }

  router.post('/ucp/2026-08-25/checkout-sessions', limit, async (req, res) => {
    const profileUrl = await platformOf(req, res, false);
    if (!profileUrl) return;
    try {
      const body = (req.body ?? {}) as { line_items?: unknown; buyer?: unknown };
      // A create's replay record lives under the seller, who is known only once the lines are read.
      const r = await replay(req, res, await sellerOfLines(storage, config, body.line_items as never), profileUrl);
      if (r.done) return;
      const session = await createGuestCheckout(storage, config, { profileUrl, lineItems: body.line_items as never, buyer: body.buyer });
      await answer(res, 201, session, r.store);
    } catch (e) { fail(res, e); }
  });

  router.get('/ucp/2026-08-25/checkout-sessions/:id', limit, async (req, res) => {
    const profileUrl = await platformOf(req, res, false);
    if (!profileUrl) return;
    try {
      await answer(res, 200, await readGuestCheckout(storage, config, String(req.params.id), profileUrl), async () => undefined);
    } catch (e) { fail(res, e); }
  });

  router.put('/ucp/2026-08-25/checkout-sessions/:id', limit, async (req, res) => {
    const profileUrl = await platformOf(req, res, false);
    if (!profileUrl) return;
    const id = String(req.params.id);
    const r = await replay(req, res, sellerOfSessionId(id, config), profileUrl);
    if (r.done) return;
    try {
      const body = (req.body ?? {}) as { line_items?: unknown; buyer?: unknown };
      await answer(res, 200, await updateGuestCheckout(storage, config, id, profileUrl, { lineItems: body.line_items as never, buyer: body.buyer }), r.store);
    } catch (e) { fail(res, e); }
  });

  router.post('/ucp/2026-08-25/checkout-sessions/:id/complete', limit, async (req, res) => {
    const profileUrl = await platformOf(req, res, false);
    if (!profileUrl) return;
    const id = String(req.params.id);
    const r = await replay(req, res, sellerOfSessionId(id, config), profileUrl);
    if (r.done) return;
    try {
      await answer(res, 200, await completeGuestCheckout(storage, config, id, profileUrl, (req.body ?? {}).payment), r.store);
    } catch (e) { fail(res, e); }
  });

  router.post('/ucp/2026-08-25/checkout-sessions/:id/cancel', limit, async (req, res) => {
    const profileUrl = await platformOf(req, res, false);
    if (!profileUrl) return;
    const id = String(req.params.id);
    const r = await replay(req, res, sellerOfSessionId(id, config), profileUrl);
    if (r.done) return;
    try {
      await answer(res, 200, await cancelGuestCheckout(storage, config, id, profileUrl), r.store);
    } catch (e) { fail(res, e); }
  });

  router.get('/ucp/2026-08-25/orders/:id', limit, async (req, res) => {
    const profileUrl = await platformOf(req, res, true);
    if (!profileUrl) return;
    try {
      res.json(toUcpOrder(await readUcpOrder(storage, config, String(req.params.id), profileUrl), config));
    } catch (e) { fail(res, e); }
  });

  return router;
}
