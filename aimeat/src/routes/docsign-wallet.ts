/**
 * @file src/routes/docsign-wallet.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description REST endpoints for signing a PDF with an EU Digital Identity Wallet. The protocol and
 *   every decision are in services/docsign/eudi.ts; the MCP tools call the same functions.
 *
 *   THREE PUBLIC ENDPOINTS, because the wallet carries no AIMEAT credentials: it fetches the
 *   request object, downloads the PDF and posts the signed PDF back. Each is addressed by a wallet
 *   session id of 128 random bits that only the person who started it was given; the document
 *   also needs its own token and the response its `state`. A session serves one signature.
 * @structure docsignWalletRouter(config, storage)
 *   - GET  /v1/docsign/wallet                                public: is wallet signing ready here
 *   - POST /v1/docsign/requests/:id/wallet                   start: the PDF (raw, base64 or storage_key)
 *   - GET  /v1/docsign/requests/:id/wallet/:session          how the started session stands
 *   - GET  /v1/docsign/requests/:id/signed-document          the newest wallet-signed PDF, for a party
 *   - GET  /v1/docsign/wallet/:session/request               wallet: the signed request object
 *   - GET  /v1/docsign/wallet/:session/document/:token       wallet: the PDF to sign
 *   - POST /v1/docsign/wallet/:session/response              wallet: the signed PDF, or an error
 *   - POST /v1/docsign/wallet/response                       the same, the session found by state
 *   - POST /                                                 the same, for a certificate naming the bare origin
 * @usage router.use(docsignWalletRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-allekirjoitus-eudi-lompakolla).
 *   v1.0.1 — 2026-10-10 — The raw PDF is taken with rawBodyBytes (code scanning alerts 1721-1725).
 *   v1.1.0 — 2026-10-10 — The fixed response addresses for an x509_san_uri access certificate.
 */
import { Router, raw, urlencoded, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { callerOf } from '../middleware/caller.js';
import { DocsignError, signedDocument } from '../services/docsign/records.js';
import { readOwnFile } from '../services/docsign/files.js';
import {
  walletStatus, startWalletSignature, walletSessionStatus, walletRequestObject, walletDocument, receiveWalletResponse,
  receiveWalletResponseByState,
} from '../services/docsign/eudi.js';
import { docsignMaxBytes } from '../config-docsign.js';
import { rawBodyBytes } from '../utils/raw-body.js';

const StartJsonSchema = z.object({
  content_base64: z.string().optional(),
  storage_key: z.string().max(1024).optional(),
  name: z.string().max(255).optional(),
}).refine((v) => !!v.content_base64 !== !!v.storage_key, { message: 'Send the PDF once: the body itself, content_base64, or storage_key.' });

export function docsignWalletRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const ctx = { storage, config };
  const walletLimit = rateLimit({ windowMs: 60_000, max: 60, keyBy: 'ip' });

  const enabled = (_req: Request, res: Response, next: () => void) => {
    if (!config.docsignEnabled) { res.status(404).json(error(config.nodeId, 'FEATURE_DISABLED', 'Document signing is switched off on this node.')); return; }
    next();
  };
  const fail = (res: Response, err: unknown) => {
    if (err instanceof DocsignError) { res.status(err.status).json(error(config.nodeId, err.code, err.message)); return; }
    res.status(500).json(error(config.nodeId, 'DOCSIGN_ERROR', err instanceof Error ? err.message : String(err)));
  };
  const rawPdf = (req: Request, res: Response, next: (err?: unknown) => void) =>
    raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: docsignMaxBytes(config) })(req, res, next);
  // Base64 makes the signed PDF a third larger, and the wallet adds its signature.
  const walletForm = (req: Request, res: Response, next: (err?: unknown) => void) =>
    urlencoded({ extended: false, limit: Math.ceil(docsignMaxBytes(config) * 1.5) + 1024 * 1024 })(req, res, next);

  router.get('/v1/docsign/wallet', enabled, (_req, res) => {
    res.json(success(config.nodeId, walletStatus(ctx)));
  });

  router.post('/v1/docsign/requests/:id/wallet', enabled, requireAuth(), requireScope('memory:write'), rawPdf, async (req, res) => {
    try {
      const caller = callerOf(req, config.nodeId, storage);
      let doc: { bytes: Buffer; name?: string };
      const raw = rawBodyBytes(req.body);
      if (raw) {
        doc = { bytes: raw, ...(typeof req.query.name === 'string' ? { name: req.query.name } : {}) };
      } else {
        const parsed = StartJsonSchema.safeParse(req.body ?? {});
        if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message)); return; }
        const d = parsed.data;
        if (d.storage_key) {
          const file = await readOwnFile(ctx, caller, d.storage_key);
          doc = { bytes: file.data, name: d.name ?? file.name };
        } else {
          doc = { bytes: Buffer.from(d.content_base64!, 'base64'), ...(d.name ? { name: d.name } : {}) };
        }
      }
      const started = await startWalletSignature(ctx, caller, req.params.id as string, doc);
      res.status(201).json(success(config.nodeId, started, [
        { description: 'How it stands', method: 'GET', url: `/v1/docsign/requests/${req.params.id}/wallet/${started.session_id}` },
      ]));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/docsign/requests/:id/wallet/:session', enabled, requireAuth(), requireScope('memory:read'), (req, res) => {
    try {
      res.json(success(config.nodeId, walletSessionStatus(callerOf(req, config.nodeId, storage), req.params.id as string, req.params.session as string)));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/docsign/requests/:id/signed-document', enabled, requireAuth(), requireScope('memory:read'), async (req, res) => {
    try {
      const doc = await signedDocument(ctx, callerOf(req, config.nodeId, storage), req.params.id as string);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.name)}"`);
      res.setHeader('X-Content-SHA256', doc.sha256);
      res.send(doc.data);
    } catch (err) { fail(res, err); }
  });

  // ── what the wallet calls ──

  router.get('/v1/docsign/wallet/:session/request', enabled, walletLimit, async (req, res) => {
    try {
      const jws = await walletRequestObject(ctx, req.params.session as string);
      res.setHeader('Content-Type', 'application/oauth-authz-req+jwt');
      res.setHeader('Cache-Control', 'no-store');
      res.send(jws);
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/docsign/wallet/:session/document/:token', enabled, walletLimit, (req, res) => {
    try {
      const doc = walletDocument(req.params.session as string, req.params.token as string);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`);
      res.send(doc.bytes);
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/docsign/wallet/:session/response', enabled, walletLimit, walletForm, async (req, res) => {
    try {
      const out = await receiveWalletResponse(ctx, req.params.session as string, (req.body ?? {}) as Record<string, unknown>);
      res.json(out);
    } catch (err) { fail(res, err); }
  });

  // An access certificate that names an address (x509_san_uri) makes the wallet answer at exactly
  // that address, so the session comes from the form's state. /v1/docsign/wallet/response is for a
  // certificate naming that path; "/" is for one naming the bare origin (https://aimeat.io), which is
  // what the EU test registrar issued. "/" takes only a form whose state belongs to an open session;
  // everything else passes on as if this route were not here.
  const isForm = (req: Request) => /application\/x-www-form-urlencoded/i.test(req.headers['content-type'] || '');
  router.post('/v1/docsign/wallet/response', enabled, walletLimit, walletForm, async (req, res) => {
    try {
      const out = await receiveWalletResponseByState(ctx, (req.body ?? {}) as Record<string, unknown>);
      if (!out) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No open wallet session has that state.')); return; }
      res.json(out);
    } catch (err) { fail(res, err); }
  });
  router.post('/', (req, res, next) => {
    if (!config.docsignEnabled || !config.docsignEudiEnabled || !isForm(req)) { next(); return; }
    walletLimit(req, res, () => walletForm(req, res, async (err?: unknown) => {
      if (err) { next(err); return; }
      try {
        const out = await receiveWalletResponseByState(ctx, (req.body ?? {}) as Record<string, unknown>);
        if (!out) { next(); return; }
        res.json(out);
      } catch (e) { fail(res, e); }
    }));
  });

  return router;
}
