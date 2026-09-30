/**
 * @file src/routes/classification.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Classification over REST (TARGET-082 V2): the classification of one piece of
 *   content, and the policy at the node, owner or organism level. The same service functions as the
 *   MCP tool aimeat_classification; this file names the caller and shapes the envelope.
 *
 *   The review of a policy proposal is here and not on MCP on purpose: an AI's change that gives
 *   something away waits for a person, signed in themselves (decided 2026-09-29), and the service
 *   refuses the review from any credential that is not a person's own session.
 *
 *   EACH ROUTE IS A PLAIN HANDLER that reads its fields from req.body or req.query itself and hands
 *   the services plain values. check:field-reach ties a read to its route only when the read sits in
 *   a function registered on that route (or one wrapper deep, with (req, res)): a `handle(req => …)`
 *   factory and a `body(req)` helper made every read here "unrouted", so the gate could not compare
 *   what the route takes with what aimeat_classification declares.
 * @structure classificationRouter(config, storage)
 * @usage mounted in server-bootstrap/routes-loader.ts
 * @version-history
 *   v1.5.0 — 2026-09-30 — The exceptions list: POST, GET and DELETE /v1/classification/exceptions
 *     (services/classification/exception-admin.ts), decided by Jouni 2026-09-30.
 *   v1.4.0 — 2026-09-29 — GET /v1/classification/labels (the explorer: the classifications on the
 *     caller's own content and the items where a suggestion waits) and PUT /v1/classification/switch
 *     (the node's switch, set by an operator and kept in the audit log). The label routes pass
 *     `owner`, the agent or app of the caller's owner that holds the key (labels.ts targetOf).
 *   v1.3.0 — 2026-09-29 — V5: every route is a plain (req, res) handler reading its own fields, and
 *     only the ClassificationError-to-envelope mapping is shared (fail), so check:field-reach can
 *     pair each route with aimeat_classification.
 *   v1.2.0 — 2026-09-29 — V3: POST /v1/classification/scan.
 *   v1.1.0 — 2026-09-29 — V4: GET /v1/classification/audit.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V2. Initial.
 */
import { Router, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import {
  ClassificationError, labelActorOf, readContentLabel, reviewLabel, setLabel, targetOf,
} from '../services/classification/labels.js';
import { readAuditLog, readPolicy, reviewPolicy, writePolicy } from '../services/classification/policy-admin.js';
import type { PolicyLevel } from '../services/classification/policy.js';
import { scanContent } from '../services/classification/scan.js';
import { explorerQueryOf, listLabels } from '../services/classification/explorer.js';
import { setClassificationSwitch } from '../services/classification/switch.js';
import { makeException, readExceptions, removeException } from '../services/classification/exception-admin.js';

const LEVELS = new Set(['node', 'owner', 'organism']);

function levelOf(v: unknown): PolicyLevel {
  if (v === undefined) return 'owner';
  if (typeof v === 'string' && LEVELS.has(v)) return v as PolicyLevel;
  throw new ClassificationError('INVALID_INPUT', 400, 'level is node, owner or organism.');
}

const orgOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const textOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function classificationRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };

  /** A ClassificationError becomes its own status and code; anything else goes on to Express. */
  const fail = (res: Response, err: unknown): void => {
    if (!(err instanceof ClassificationError)) throw err;
    res.status(err.status).json(error(config.nodeId, err.code, err.message));
  };

  router.get('/v1/classification/policy', requireAuth(), requireScope('memory:read'), async (req, res) => {
    try {
      const actor = labelActorOf(req.auth!, config.nodeId);
      const out = await readPolicy(deps, actor, levelOf(req.query.level), orgOf(req.query.organism_id));
      res.json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  router.put('/v1/classification/policy', requireAuth(), requireScope('memory:write'), async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const actor = labelActorOf(req.auth!, config.nodeId);
      const out = await writePolicy(deps, actor, levelOf(body.level), orgOf(body.organism_id), body.policy,
        { humanSaid: body.humanSaid });
      res.json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/classification/policy/review', requireAuth(), requireScope('memory:write'), async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const decision = body.decision;
      if (decision !== 'accept' && decision !== 'reject') throw new ClassificationError('INVALID_INPUT', 400, 'decision is accept or reject.');
      const actor = labelActorOf(req.auth!, config.nodeId);
      const out = await reviewPolicy(deps, actor, levelOf(body.level), orgOf(body.organism_id), decision);
      res.json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/classification/scan', requireAuth(), requireScope('memory:write'), async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const actor = labelActorOf(req.auth!, config.nodeId);
      const out = await scanContent(deps, actor, { keys: body.keys, prefix: body.prefix });
      res.json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/classification/audit', requireAuth(), requireScope('memory:read'), async (req, res) => {
    try {
      const actor = labelActorOf(req.auth!, config.nodeId);
      const out = await readAuditLog(deps, actor, levelOf(req.query.level), orgOf(req.query.organism_id), {
        since: textOf(req.query.since),
        action: textOf(req.query.action),
        limit: Number(req.query.limit) || undefined,
      });
      res.json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/classification/labels', requireAuth(), requireScope('memory:read'), async (req, res) => {
    try {
      const actor = labelActorOf(req.auth!, config.nodeId);
      const q = explorerQueryOf({
        level: req.query.level, organism_id: req.query.organism_id, label: req.query.label,
        pending: req.query.pending, kind: req.query.kind, limit: req.query.limit, cursor: req.query.cursor,
      });
      res.json(success(config.nodeId, await listLabels(deps, actor, q)));
    } catch (err) { fail(res, err); }
  });

  // The switch is a node setting, so the operator test is the service's (operator-principal.ts);
  // memory:write is the word every classification write takes from an agent.
  router.put('/v1/classification/switch', requireAuth(), requireScope('memory:write'), async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // The whole credential goes to the service, which names the caller itself.
      const out = await setClassificationSwitch({ storage, config }, req.auth!, body.mode);
      res.json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  // The exceptions list (decided 2026-09-30): a person's own exception with its reason, made in
  // their own session or by an app; the service refuses an AI credential with PERSON_REQUIRED.
  router.post('/v1/classification/exceptions', requireAuth(), requireScope('memory:write'), async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const actor = labelActorOf(req.auth!, config.nodeId);
      const out = await makeException(deps, actor, {
        kind: body.kind, key: body.key, owner: body.owner, organism_id: body.organism_id,
        ws: body.ws, space: body.space, row_id: body.row_id, action: body.action, reason: body.reason, until: body.until,
      });
      res.status(201).json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/classification/exceptions', requireAuth(), requireScope('memory:read'), async (req, res) => {
    try {
      const actor = labelActorOf(req.auth!, config.nodeId);
      const out = await readExceptions(deps, actor, levelOf(req.query.level), orgOf(req.query.organism_id), {
        action: textOf(req.query.action),
        since: textOf(req.query.since),
        limit: Number(req.query.limit) || undefined,
      });
      res.json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  router.delete('/v1/classification/exceptions/:id', requireAuth(), requireScope('memory:write'), async (req, res) => {
    try {
      const actor = labelActorOf(req.auth!, config.nodeId);
      res.json(success(config.nodeId, await removeException(deps, actor, req.params.id as string)));
    } catch (err) { fail(res, err); }
  });

  router.get('/v1/classification/label', requireAuth(), requireScope('memory:read'), async (req, res) => {
    try {
      const actor = labelActorOf(req.auth!, config.nodeId);
      const target = targetOf(actor, {
        kind: req.query.kind, key: req.query.key, organism_id: req.query.organism_id,
        ws: req.query.ws, space: req.query.space, row_id: req.query.row_id, owner: req.query.owner,
      });
      res.json(success(config.nodeId, await readContentLabel(deps, actor, target)));
    } catch (err) { fail(res, err); }
  });

  router.put('/v1/classification/label', requireAuth(), requireScope('memory:write'), async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const actor = labelActorOf(req.auth!, config.nodeId);
      if (typeof body.label !== 'string') throw new ClassificationError('INVALID_INPUT', 400, 'label is a label id.');
      const target = targetOf(actor, {
        kind: body.kind, key: body.key, organism_id: body.organism_id,
        ws: body.ws, space: body.space, row_id: body.row_id, owner: body.owner,
      });
      const out = await setLabel(deps, actor, target, {
        // Passed as sent: the service answers 400 for a value that is not text.
        label: body.label, justification: body.justification as string | undefined, humanSaid: body.humanSaid as string | undefined,
        confidence: typeof body.confidence === 'number' ? body.confidence : undefined, reason: body.reason as string | undefined,
      });
      res.json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/classification/label/review', requireAuth(), requireScope('memory:write'), async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const actor = labelActorOf(req.auth!, config.nodeId);
      const decision = body.decision;
      if (decision !== 'accept' && decision !== 'reject') throw new ClassificationError('INVALID_INPUT', 400, 'decision is accept or reject.');
      const target = targetOf(actor, {
        kind: body.kind, key: body.key, organism_id: body.organism_id,
        ws: body.ws, space: body.space, row_id: body.row_id, owner: body.owner,
      });
      const out = await reviewLabel(deps, actor, target, {
        decision, justification: body.justification as string | undefined, humanSaid: body.humanSaid as string | undefined,
      });
      res.json(success(config.nodeId, out));
    } catch (err) { fail(res, err); }
  });

  return router;
}
