/**
 * @file src/routes/docsign.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description REST endpoints for document signing and signature validation. Every decision is in
 *   services/docsign/ (records.ts for AIMEAT signing requests, validate.ts for signatures made
 *   elsewhere); the MCP tools call the same functions.
 *
 *   TWO PUBLIC ENDPOINTS, BOTH RATE-LIMITED. Looking a document up by its hash and validating a
 *   signed file need no account, because the person checking a contract is often the counterparty
 *   who has none. Validation reads a whole file and may reach trusted lists and OCSP responders, so
 *   it gets a tight limit; a lookup is a few reads.
 * @structure docsignRouter(config, storage)
 *   - POST /v1/docsign/requests                       create a signing request
 *   - GET  /v1/docsign/requests                       the caller's requests (?state=open|complete|cancelled|waiting-for-me)
 *   - GET  /v1/docsign/requests/:id                   one request, with each signature checked
 *   - POST /v1/docsign/requests/:id/passkey-options   start a passkey signature
 *   - POST /v1/docsign/requests/:id/sign              sign (passkey | key | session)
 *   - POST /v1/docsign/requests/:id/cancel            cancel an open request (its creator)
 *   - DELETE /v1/docsign/requests/:id                 delete a request nobody signed (its creator)
 *   - GET  /v1/docsign/lookup/:sha256                 public: who signed this document on this node
 *   - POST /v1/docsign/validate                       public: validate a signed PDF or CMS file
 *   - the wallet signing endpoints                    routes/docsign-wallet.ts, mounted here
 * @usage router.use(docsignRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 *   v1.1.0 — 2026-10-10 — Mounts docsignWalletRouter: signing with an EU Digital Identity Wallet
 *     (wish-allekirjoitus-eudi-lompakolla).
 *   v1.1.1 — 2026-10-10 — The raw file is taken with rawBodyBytes (code scanning alerts 1712-1719).
 *   v1.2.0 — 2026-10-10 — DELETE /v1/docsign/requests/:id: a request nobody signed.
 */
import { Router, raw, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope, optionalAuth } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { callerOf } from '../middleware/caller.js';
import {
  createRequest, getRequest, listRequests, beginPasskeySignature, signRequest, cancelRequest, deleteRequest,
  verifyRecordSignatures, lookupWithNodeKey, DocsignError,
} from '../services/docsign/records.js';
import { validateDocument } from '../services/docsign/validate-input.js';
import { ValidationInputError } from '../services/docsign/validate.js';
import { documentFromStorage } from '../services/docsign/files.js';
import { docsignMaxBytes } from '../config-docsign.js';
import { docsignWalletRouter } from './docsign-wallet.js';
import { rawBodyBytes } from '../utils/raw-body.js';

const CreateSchema = z.object({
  title: z.string().max(200).optional().default(''),
  message: z.string().max(2000).nullish(),
  document: z.object({
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
    name: z.string().min(1).max(255),
    size: z.number().int().min(0),
    media_type: z.string().max(120).nullish(),
  }).optional(),
  /** The document as a file in the caller's storage, instead of `document`. */
  storage_key: z.string().max(1024).optional(),
  parties: z.array(z.string().min(3).max(300)).min(1).max(10),
}).refine((v) => !!v.document !== !!v.storage_key, { message: 'Name the document once: document, or storage_key.' });

const SignSchema = z.object({
  method: z.enum(['passkey', 'key', 'session']),
  ceremony_id: z.string().max(100).optional(),
  response: z.record(z.string(), z.unknown()).optional(),
  signature: z.string().min(16).max(2000).optional(),
});

const ValidateJsonSchema = z.object({
  content_base64: z.string().optional(),
  signature_base64: z.string().optional(),
  document_base64: z.string().optional(),
  storage_key: z.string().max(1024).optional(),
  document_storage_key: z.string().max(1024).optional(),
  online: z.boolean().optional(),
});

export function docsignRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const ctx = { storage, config };
  const validateLimit = rateLimit({ windowMs: 60_000, max: 20, keyBy: 'ip' });
  const lookupLimit = rateLimit({ windowMs: 60_000, max: 120, keyBy: 'ip' });

  const enabled = (_req: Request, res: Response, next: () => void) => {
    if (!config.docsignEnabled) { res.status(404).json(error(config.nodeId, 'FEATURE_DISABLED', 'Document signing is switched off on this node.')); return; }
    next();
  };
  const fail = (res: Response, err: unknown) => {
    if (err instanceof DocsignError) { res.status(err.status).json(error(config.nodeId, err.code, err.message)); return; }
    if (err instanceof ValidationInputError) { res.status(400).json(error(config.nodeId, err.code, err.message)); return; }
    res.status(500).json(error(config.nodeId, 'DOCSIGN_ERROR', err instanceof Error ? err.message : String(err)));
  };

  router.post('/v1/docsign/requests', enabled, requireAuth(), requireScope('memory:write'), async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message)); return; }
    try {
      const d = parsed.data;
      const caller = callerOf(req, config.nodeId, storage);
      const document = d.storage_key
        ? await documentFromStorage(ctx, caller, d.storage_key)
        : { sha256: d.document!.sha256, name: d.document!.name, size: d.document!.size, mediaType: d.document!.media_type ?? null };
      const request = await createRequest(ctx, caller, { title: d.title, message: d.message ?? null, parties: d.parties, document });
      res.status(201).json(success(config.nodeId, { request }, [
        { description: 'Sign it', method: 'POST', url: `/v1/docsign/requests/${request.id}/sign` },
        { description: 'Who signed this document', method: 'GET', url: `/v1/docsign/lookup/${request.document.sha256}` },
      ]));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/docsign/requests', enabled, requireAuth(), requireScope('memory:read'), async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (state && !['open', 'complete', 'cancelled', 'waiting-for-me'].includes(state)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'state is open, complete, cancelled or waiting-for-me.')); return;
    }
    try {
      const requests = await listRequests(ctx, callerOf(req, config.nodeId, storage), { state: state as never, limit: Number(req.query.limit) || 50 });
      res.json(success(config.nodeId, { requests }));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/docsign/requests/:id', enabled, requireAuth(), requireScope('memory:read'), async (req, res) => {
    try {
      const request = await getRequest(ctx, callerOf(req, config.nodeId, storage), req.params.id as string);
      res.json(success(config.nodeId, { request, checks: await verifyRecordSignatures(ctx, request) }));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/docsign/requests/:id/passkey-options', enabled, requireAuth(), requireScope('memory:write'), async (req, res) => {
    try {
      res.json(success(config.nodeId, await beginPasskeySignature(ctx, callerOf(req, config.nodeId, storage), req.params.id as string)));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/docsign/requests/:id/sign', enabled, requireAuth(), requireScope('memory:write'), async (req, res) => {
    const parsed = SignSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message)); return; }
    try {
      const request = await signRequest(ctx, callerOf(req, config.nodeId, storage), req.params.id as string, parsed.data);
      res.json(success(config.nodeId, { request, checks: await verifyRecordSignatures(ctx, request) }));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/docsign/requests/:id/cancel', enabled, requireAuth(), requireScope('memory:write'), async (req, res) => {
    try {
      res.json(success(config.nodeId, { request: await cancelRequest(ctx, callerOf(req, config.nodeId, storage), req.params.id as string) }));
    } catch (err) { fail(res, err); }
  });

  router.delete('/v1/docsign/requests/:id', enabled, requireAuth(), requireScope('memory:write'), async (req, res) => {
    try {
      res.json(success(config.nodeId, await deleteRequest(ctx, callerOf(req, config.nodeId, storage), req.params.id as string)));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/docsign/lookup/:sha256', enabled, lookupLimit, async (req, res) => {
    try {
      res.json(success(config.nodeId, await lookupWithNodeKey(ctx, req.params.sha256 as string)));
    } catch (err) { fail(res, err); }
  });

  // The body is the file itself (application/pdf, application/octet-stream, application/pkcs7-mime),
  // or JSON naming base64 content or a stored file. JSON is parsed by the global parser; anything
  // else arrives here raw, capped at the configured size.
  // The limit is read per request, so an operator's change to the size takes effect without a restart.
  const rawBody = (req: Request, res: Response, next: (err?: unknown) => void) =>
    raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: docsignMaxBytes(config) })(req, res, next);
  router.post('/v1/docsign/validate', enabled, validateLimit, rawBody, optionalAuth(), async (req, res) => {
    try {
      let input: Parameters<typeof validateDocument>[2];
      const raw = rawBodyBytes(req.body);
      if (raw) {
        input = { content: raw, online: req.query.online !== 'false' };
      } else {
        const parsed = ValidateJsonSchema.safeParse(req.body ?? {});
        if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message)); return; }
        const d = parsed.data;
        const needsAuth = !!(d.storage_key || d.document_storage_key);
        if (needsAuth && (!req.auth || req.auth.anonymous)) {
          res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'A stored file is read as you: sign in, or send the file itself.')); return;
        }
        input = {
          content: d.content_base64 ? Buffer.from(d.content_base64, 'base64') : undefined,
          signature: d.signature_base64 ? Buffer.from(d.signature_base64, 'base64') : undefined,
          document: d.document_base64 ? Buffer.from(d.document_base64, 'base64') : undefined,
          storageKey: d.storage_key, documentStorageKey: d.document_storage_key,
          online: d.online !== false,
        };
      }
      const caller = req.auth && !req.auth.anonymous ? callerOf(req, config.nodeId, storage) : null;
      const result = await validateDocument(ctx, caller, input);
      res.json(success(config.nodeId, result, [
        { description: 'Who signed this document on this node', method: 'GET', url: `/v1/docsign/lookup/${result.report.document.sha256}` },
      ]));
    } catch (err) { fail(res, err); }
  });

  router.use(docsignWalletRouter(config, storage));

  return router;
}
