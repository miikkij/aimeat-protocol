/**
 * @file src/routes/compliance-docs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The compliance documents over REST (plan doc-mvlftkh9zmc9): the records of processing,
 *   the processors, the data subject requests, the breaches, the impact assessments and the framework
 *   answers, of the node, of an organism and of an app. Each route names the caller and the scope and
 *   hands both to services/compliance-docs-ops.ts, which the MCP tools call too, so who may do what
 *   and what a valid document is are decided once.
 *
 *   THE WORDS. compliance:read to read and compliance:write to write, which no wildcard carries. An
 *   owner session passes requireScope as everywhere, and the service then asks the scope's own rule
 *   (the operator for the node, an organism's members and managers, an app's owner).
 * @structure complianceDocsRouter(config, storage)
 *   - GET  /v1/compliance/catalog           the data domains, the frameworks and the label packs
 *   - GET  /v1/compliance/docs/:kind        one document of a scope
 *   - PUT  /v1/compliance/docs/:kind        replace it (dry_run=true previews)
 *   - GET  /v1/compliance/draft             the node's draft of a scope's registers
 *   - GET  /v1/compliance/gaps              what a scope's documents leave open
 * @usage app.use(complianceDocsRouter(config, storage));   // server-bootstrap/routes-loader.ts
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C1–C7.1).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { COMPLIANCE_READ_SCOPE, COMPLIANCE_WRITE_SCOPE } from '../utils/scope-coverage.js';
import type { OperatorCaller } from '../services/operator-principal.js';
import { callerOf } from '../middleware/caller.js';
import {
  ComplianceDocError, catalogOp, draftOp, gapsOp, readDocOp, writeDocOp,
} from '../services/compliance-docs-ops.js';

export function complianceDocsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };

  /** The caller as the services ask it: { sub, owner, roles, scopes, federated }, built once per request. */
  const operatorCallerOf = (req: Request): OperatorCaller => callerOf(req, config.nodeId, storage).auth;
  const fail = (res: Response, err: unknown): void => {
    if (!(err instanceof ComplianceDocError)) throw err;
    res.status(err.status).json(error(config.nodeId, err.code, err.message));
  };

  router.get('/v1/compliance/catalog', requireAuth(), requireScope(COMPLIANCE_READ_SCOPE), async (_req, res) => {
    res.json(success(config.nodeId, await catalogOp(deps)));
  });

  router.get('/v1/compliance/docs/:kind', requireAuth(), requireScope(COMPLIANCE_READ_SCOPE), async (req, res) => {
    try {
      const out = await readDocOp(deps, operatorCallerOf(req), req.params.kind as string, {
        scope: req.query.scope, organism_id: req.query.organism_id, app: req.query.app, app_owner: req.query.app_owner,
      });
      res.json(success(config.nodeId, out, [
        { description: 'Replace it (send every entry you keep)', method: 'PUT', url: `/v1/compliance/docs/${req.params.kind as string}` },
        { description: 'What it leaves open', method: 'GET', url: '/v1/compliance/gaps' },
      ]));
    } catch (err) { fail(res, err); }
  });

  router.put('/v1/compliance/docs/:kind', requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE), async (req, res) => {
    try {
      // The body is the document itself, which aimeat_compliance_register_write carries as `value`.
      const out = await writeDocOp(deps, operatorCallerOf(req), req.params.kind as string, {
        scope: req.query.scope, organism_id: req.query.organism_id, app: req.query.app, app_owner: req.query.app_owner,
      }, req.body ?? {}, { dryRun: req.query.dry_run === 'true' });
      res.json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/compliance/draft', requireAuth(), requireScope(COMPLIANCE_READ_SCOPE), async (req, res) => {
    try {
      const out = await draftOp(deps, operatorCallerOf(req), {
        scope: req.query.scope, organism_id: req.query.organism_id, app: req.query.app, app_owner: req.query.app_owner,
      });
      res.json(success(config.nodeId, out, [
        { description: 'Save it, once you have looked at it', method: 'PUT', url: '/v1/compliance/docs/registers' },
      ]));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/compliance/gaps', requireAuth(), requireScope(COMPLIANCE_READ_SCOPE), async (req, res) => {
    try {
      const out = await gapsOp(deps, operatorCallerOf(req), {
        scope: req.query.scope, organism_id: req.query.organism_id, app: req.query.app, app_owner: req.query.app_owner,
      });
      res.json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  return router;
}
