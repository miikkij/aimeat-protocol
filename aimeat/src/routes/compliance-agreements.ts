/**
 * @file src/routes/compliance-agreements.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Data processing agreements (GDPR art. 28) over REST (plan doc-mvmr4i2wdk0p): the
 *   operator makes, sends, announces and ends them; the counterparty, when it has an account here,
 *   reads its own, sends a signed copy back and objects to a change. Every route names the caller and
 *   hands it to services/compliance-agreements-ops.ts or -sign.ts, which the MCP tool
 *   aimeat_compliance_agreement calls too.
 *
 *   THE WORDS. compliance:read to read and compliance:write to act, which no wildcard carries; an owner
 *   session passes requireScope as everywhere, and the service then asks whether this is the operator
 *   or the agreement's counterparty.
 * @structure complianceAgreementsRouter(config, storage)
 *   - GET    /v1/compliance/agreements                    every agreement, short (operator); fleet reads this
 *   - POST   /v1/compliance/agreements                    make one from the node's data (dry_run=true previews)
 *   - GET    /v1/compliance/agreements/mine               the agreements where the caller is the counterparty
 *   - GET    /v1/compliance/agreements/gaps               what the agreements leave open (operator)
 *   - POST   /v1/compliance/agreements/breach-notice      tell counterparties of a personal data breach
 *   - GET    /v1/compliance/agreements/:id                one, whole
 *   - PATCH  /v1/compliance/agreements/:id                change the newest draft
 *   - POST   /v1/compliance/agreements/:id/versions       a new draft from the newest version
 *   - POST   /v1/compliance/agreements/:id/send           send the newest draft for signature
 *   - POST   /v1/compliance/agreements/:id/notice         announce an Annex III or IV change
 *   - POST   /v1/compliance/agreements/:id/object         the counterparty objects to an announced change
 *   - POST   /v1/compliance/agreements/:id/signed-copy    a signed PDF or a scanned copy came back
 *   - POST   /v1/compliance/agreements/:id/confirm        the operator accepts or rejects that copy
 *   - POST   /v1/compliance/agreements/:id/end            end it; the deletion clock starts
 *   - POST   /v1/compliance/agreements/:id/deletion-done  the data was deleted or returned
 *   - GET    /v1/compliance/agreements/:id/document       a version's PDF (format=text: its canonical text; format=json: that text in the envelope)
 * @usage app.use(complianceAgreementsRouter(config, storage));   // server-bootstrap/routes-loader.ts
 * @version-history
 *   2026-10-27 — POST .../confirm takes uploaded_at, the copy the operator reviewed (secaudit2026oct26).
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D1–D4).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { COMPLIANCE_READ_SCOPE, COMPLIANCE_WRITE_SCOPE } from '../utils/scope-coverage.js';
import { callerOf } from '../middleware/caller.js';
import { AgreementError, operatorAccess } from '../services/compliance-agreements-access.js';
import {
  breachNoticeOp, createOp, deletionDoneOp, documentOp, endOp, getOp, listOp, mineOp, newVersionOp, noticeOp, objectOp, patchOp, sendOp,
} from '../services/compliance-agreements-ops.js';
import { confirmOp, signedCopyOp } from '../services/compliance-agreements-sign.js';
import { agreementGaps } from '../services/compliance-agreements-gaps.js';

export function complianceAgreementsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };
  const who = (req: Request) => callerOf(req, config.nodeId, storage);
  const fail = (res: Response, err: unknown): void => {
    if (!(err instanceof AgreementError)) throw err;
    res.status(err.status).json(error(config.nodeId, err.code, err.message));
  };

  router.get('/v1/compliance/agreements', requireAuth(), requireScope(COMPLIANCE_READ_SCOPE), async (req, res) => {
    try { res.json(success(config.nodeId, await listOp(deps, who(req)))); } catch (err) { fail(res, err); }
  });

  router.post('/v1/compliance/agreements', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try {
      res.json(success(config.nodeId, await createOp(deps, who(req), req.body ?? {}, { dryRun: req.query.dry_run === 'true' })));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/compliance/agreements/mine', requireAuth(), requireScope(COMPLIANCE_READ_SCOPE), async (req, res) => {
    try { res.json(success(config.nodeId, await mineOp(deps, who(req)))); } catch (err) { fail(res, err); }
  });

  router.get('/v1/compliance/agreements/gaps', requireAuth(), requireScope(COMPLIANCE_READ_SCOPE), async (req, res) => {
    try {
      await operatorAccess(deps, who(req).auth, 'read');
      const gaps = await agreementGaps(deps);
      res.json(success(config.nodeId, { gaps, total: gaps.length }));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/compliance/agreements/breach-notice', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try {
      const { agreements, title, discovered_at, summary, breach_id } = req.body ?? {};
      res.json(success(config.nodeId, await breachNoticeOp(deps, who(req), { agreements, title, discovered_at, summary, breach_id })));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/compliance/agreements/:id', requireAuth(), requireScope(COMPLIANCE_READ_SCOPE), async (req, res) => {
    try { res.json(success(config.nodeId, await getOp(deps, who(req), req.params.id as string))); } catch (err) { fail(res, err); }
  });

  router.patch('/v1/compliance/agreements/:id', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try { res.json(success(config.nodeId, await patchOp(deps, who(req), req.params.id as string, req.body ?? {}))); } catch (err) { fail(res, err); }
  });

  router.post('/v1/compliance/agreements/:id/versions', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try { res.json(success(config.nodeId, await newVersionOp(deps, who(req), req.params.id as string))); } catch (err) { fail(res, err); }
  });

  router.post('/v1/compliance/agreements/:id/send', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message as string : undefined;
      res.json(success(config.nodeId, await sendOp(deps, who(req), req.params.id as string, { message })));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/compliance/agreements/:id/notice', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try { res.json(success(config.nodeId, await noticeOp(deps, who(req), req.params.id as string))); } catch (err) { fail(res, err); }
  });

  router.post('/v1/compliance/agreements/:id/object', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try { res.json(success(config.nodeId, await objectOp(deps, who(req), req.params.id as string, { reason: req.body?.reason }))); } catch (err) { fail(res, err); }
  });

  router.post('/v1/compliance/agreements/:id/signed-copy', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try {
      const { storage_key, kind, party } = req.body ?? {};
      res.json(success(config.nodeId, await signedCopyOp(deps, who(req), req.params.id as string, { storage_key, kind, party })));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/compliance/agreements/:id/confirm', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try {
      res.json(success(config.nodeId, await confirmOp(deps, who(req), req.params.id as string, { accept: req.body?.accept, reason: req.body?.reason, uploaded_at: req.body?.uploaded_at })));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/compliance/agreements/:id/end', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try {
      res.json(success(config.nodeId, await endOp(deps, who(req), req.params.id as string, { choice: req.body?.choice, reason: req.body?.reason })));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/compliance/agreements/:id/deletion-done', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try { res.json(success(config.nodeId, await deletionDoneOp(deps, who(req), req.params.id as string, { note: req.body?.note }))); } catch (err) { fail(res, err); }
  });

  router.get('/v1/compliance/agreements/:id/document', requireAuth(), requireScope(COMPLIANCE_READ_SCOPE), async (req, res) => {
    try {
      const asJson = req.query.format === 'json';
      const doc = await documentOp(deps, who(req), req.params.id as string, { version: req.query.version, format: asJson ? 'text' : req.query.format });
      // format=json: the canonical text inside the envelope, for a client that reads only JSON (the CLI dispatch).
      if (asJson) { res.json(success(config.nodeId, { name: doc.name, text: doc.data.toString() })); return; }
      res.setHeader('Content-Type', doc.mediaType);
      res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(doc.data);
    } catch (err) { fail(res, err); }
  });

  return router;
}
