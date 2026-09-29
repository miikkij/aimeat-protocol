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
 * @structure classificationRouter(config, storage)
 * @usage mounted in server-bootstrap/routes-loader.ts
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V2. Initial.
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import {
  ClassificationError, labelActorOf, readContentLabel, reviewLabel, setLabel, targetOf, type TargetInput,
} from '../services/classification/labels.js';
import { readPolicy, reviewPolicy, writePolicy } from '../services/classification/policy-admin.js';
import type { PolicyLevel } from '../services/classification/policy.js';

const LEVELS = new Set(['node', 'owner', 'organism']);

export function classificationRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };

  const levelOf = (v: unknown): PolicyLevel => {
    if (v === undefined) return 'owner';
    if (typeof v === 'string' && LEVELS.has(v)) return v as PolicyLevel;
    throw new ClassificationError('INVALID_INPUT', 400, 'level is node, owner or organism.');
  };
  const orgOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

  /** Run a handler; a ClassificationError becomes its own status and code. */
  const handle = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      res.json(success(config.nodeId, await fn(req)));
    } catch (err) {
      if (err instanceof ClassificationError) {
        res.status(err.status).json(error(config.nodeId, err.code, err.message));
        return;
      }
      throw err;
    }
  };
  const actor = (req: Request) => labelActorOf(req.auth!, config.nodeId);
  const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

  router.get('/v1/classification/policy', requireAuth(), requireScope('memory:read'),
    handle(req => readPolicy(deps, actor(req), levelOf(req.query.level), orgOf(req.query.organism_id))));

  router.put('/v1/classification/policy', requireAuth(), requireScope('memory:write'),
    handle(req => writePolicy(deps, actor(req), levelOf(body(req).level), orgOf(body(req).organism_id),
      body(req).policy, { humanSaid: body(req).humanSaid })));

  router.post('/v1/classification/policy/review', requireAuth(), requireScope('memory:write'), handle(req => {
    const decision = body(req).decision;
    if (decision !== 'accept' && decision !== 'reject') throw new ClassificationError('INVALID_INPUT', 400, 'decision is accept or reject.');
    return reviewPolicy(deps, actor(req), levelOf(body(req).level), orgOf(body(req).organism_id), decision);
  }));

  router.get('/v1/classification/label', requireAuth(), requireScope('memory:read'), handle(req => {
    const a = actor(req);
    return readContentLabel(deps, a, targetOf(a, req.query as TargetInput));
  }));

  router.put('/v1/classification/label', requireAuth(), requireScope('memory:write'), handle(req => {
    const a = actor(req);
    const b = body(req);
    if (typeof b.label !== 'string') throw new ClassificationError('INVALID_INPUT', 400, 'label is a label id.');
    return setLabel(deps, a, targetOf(a, b), {
      label: b.label, justification: b.justification as string | undefined, humanSaid: b.humanSaid as string | undefined,
      confidence: typeof b.confidence === 'number' ? b.confidence : undefined, reason: b.reason as string | undefined,
    });
  }));

  router.post('/v1/classification/label/review', requireAuth(), requireScope('memory:write'), handle(req => {
    const a = actor(req);
    const b = body(req);
    if (b.decision !== 'accept' && b.decision !== 'reject') throw new ClassificationError('INVALID_INPUT', 400, 'decision is accept or reject.');
    return reviewLabel(deps, a, targetOf(a, b), {
      decision: b.decision, justification: b.justification as string | undefined, humanSaid: b.humanSaid as string | undefined,
    });
  }));

  return router;
}
