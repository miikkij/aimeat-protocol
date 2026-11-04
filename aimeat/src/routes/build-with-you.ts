/**
 * @file src/routes/build-with-you.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Build it with you" over REST, and the operator's view of the place ("Rakennamme
 *   kanssasi"; Jouni, 1.11 16.22). The owner, or the owner's own agent, sends the place's one build
 *   request and reads where it stands and what has been done on the place; the operator's fleet
 *   service takes the request to the build queue, reads the place's whole trail, and tells the owner
 *   once when something happened. Every operation is in services/build-with-you.ts,
 *   services/place-trail.ts and services/operator-notify-owner.ts, which the MCP tools call too.
 *
 *   THE OPERATOR'S CREDENTIAL. An operator JWT (isOperatorCaller: the operator in person, or the
 *   operator's agent holding operator:admin), or the node's admin password in X-Admin-Password, as
 *   /v1/admin/seed-examples takes it: the store's fleet service holds each sold place's admin password
 *   and no account on it. Wrong passwords are counted per address in the one count the admin setup
 *   pages and seed-examples share (services/admin-password.ts).
 * @structure buildWithYouRouter(config, storage)
 *   - GET  /v1/build-with-you/request       the offer and the request, as they stand (owner, memory:read)
 *   - POST /v1/build-with-you/request       send the place's one request (owner, memory:write)
 *   - GET  /v1/build-with-you/trail         the owner's account's trail, newest first (owner, memory:read)
 *   - GET  /v1/operator/activity            the whole node's trail (operator)
 *   - GET  /v1/operator/build-request       the request waiting for the operator, or its queue id (operator)
 *   - PUT  /v1/operator/build-request       the queue's answer to the operator's submit (operator)
 *   - POST /v1/operator/notify-owner        one notice to the owners, once per code (operator)
 * @usage app.use(buildWithYouRouter(config, storage));   // server-bootstrap/routes-loader.ts
 * @version-history
 *   v1.2.1 — 2026-11-04 — The wrong-password count is kept in the node's storage (checkAdminPasswordOnNode;
 *     codebase analysis 2026-11-03, HA stage 2).
 *   v1.2.0 — 2026-11-04 — The admin password is checked by checkAdminPassword (services/admin-password.ts),
 *     whose count of wrong passwords per address the admin setup pages and seed-examples share; this
 *     route's own counter and compare are gone, and the 429 says when to try again (codebase analysis
 *     2026-11-03, item A12).
 *   v1.1.0 — 2026-11-01 — POST /v1/build-with-you/request takes the four fields flat or under `spec`.
 *   v1.0.0 — 2026-11-01 — Initial ("Rakennamme kanssasi", parts B, C and D).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { z } from 'zod';
import { requireAuth, requireScope, requireOperator } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { validateBody } from '../models/schemas.js';
import { INPUT_LIMITS } from '../models/input-limits.js';
import { BuildError, operatorHandOp, operatorPendingOp, readOp, submitOp } from '../services/build-with-you.js';
import { readOwnTrail, readTrail, TrailError } from '../services/place-trail.js';
import { NotifyOwnerError, notifyOwnerOnce } from '../services/operator-notify-owner.js';
import { checkAdminPasswordOnNode, adminPasswordLimitedMessage } from '../services/admin-password.js';

const field = z.string().trim().min(1).max(INPUT_LIMITS.line);
// The four fields flat or under `spec` (the shape GET's `send` shows); submitOp names a missing one.
const BuildRequestBody = z.object({
  what: field.optional(), forWhom: field.optional(), use: field.optional(), readyWhen: field.optional(),
  spec: z.object({ what: field.optional(), forWhom: field.optional(), use: field.optional(), readyWhen: field.optional() }).optional(),
  lang: z.enum(['en', 'fi', 'es']).optional(),
  email: z.string().trim().max(INPUT_LIMITS.email).optional(),
});
const OperatorAnswerBody = z.object({
  requestId: z.string().trim().min(1).max(INPUT_LIMITS.id),
  statusToken: z.string().trim().min(1).max(INPUT_LIMITS.id),
  position: z.number().int().min(0).nullable().optional(),
  queueLength: z.number().int().min(0).nullable().optional(),
  state: z.string().trim().max(INPUT_LIMITS.name).optional(),
});
const NotifyOwnerBody = z.object({
  code: z.string().max(64).regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, 'lower-case letters, digits, dot, dash or underscore, at most 64'),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(1000).optional(),
  owner: z.string().trim().min(1).max(INPUT_LIMITS.name),
  link: z.string().trim().max(INPUT_LIMITS.url).optional(),
});

const iso = (v: unknown): string | undefined => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);
const int = (v: unknown): number | undefined => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);

export function buildWithYouRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };
  const who = (req: Request) => callerOf(req, config.nodeId, storage);
  /** A refusal an operation named answers with its own status and code; anything else is the node's fault. */
  const fail = (res: Response, err: unknown): void => {
    if (err instanceof BuildError || err instanceof NotifyOwnerError || err instanceof TrailError) {
      res.status(err.status).json(error(config.nodeId, err.code, err.message));
      return;
    }
    throw err;
  };
  const send = async (res: Response, work: () => Promise<unknown>, status = 200): Promise<void> => {
    try {
      res.status(status).json(success(config.nodeId, await work()));
    } catch (err) { fail(res, err); }
  };

  // WRONG PASSWORDS ARE COUNTED, per address, in the one count every admin-password route shares
  // (services/admin-password.ts). A right one is not, so the fleet service can read a place as often
  // as it needs; while an address is over the count every password is refused, the right one too, so
  // guessing gains nothing from the window.
  /** The node's admin password in X-Admin-Password, or else `gate`: the operator gate every operator route takes. */
  const passwordOr = (gate: (req: Request, res: Response, next: NextFunction) => unknown) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const check = await checkAdminPasswordOnNode(config, req.ip ?? '', req.headers['x-admin-password']);
    if (check.kind === 'missing') { void gate(req, res, next); return; }
    if (check.kind === 'ok') { next(); return; }
    if (check.kind === 'limited') {
      res.setHeader('Retry-After', String(check.retryAfterSec));
      res.status(429).json(error(config.nodeId, 'RATE_LIMITED', adminPasswordLimitedMessage(check), undefined,
        { setting: 'security.admin_auth_rate_limit_max', max_wrong: check.max, window_seconds: check.windowSec, retry_after_seconds: check.retryAfterSec }));
      return;
    }
    res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'The admin password is not right.'));
  };

  const fleetOrOperator = [passwordOr(requireOperator(storage))];

  // Each route hands its own (req, res) handler to the registration and calls its operation through
  // `send`, as routes/goals.ts does, so the field-reach measurement pairs it with the MCP tool that
  // calls the same operation. Fields are read one by one from the body validateBody checked.
  router.get('/v1/build-with-you/request', requireAuth(), requireScope('memory:read'), async (req: Request, res: Response) => {
    await send(res, () => readOp(deps, who(req)));
  });
  router.post('/v1/build-with-you/request', requireAuth(), requireScope('memory:write'), validateBody(BuildRequestBody, config.nodeId), async (req: Request, res: Response) => {
    const b = req.body as z.infer<typeof BuildRequestBody>;
    await send(res, () => submitOp(deps, who(req), {
      what: b.what, forWhom: b.forWhom, use: b.use, readyWhen: b.readyWhen, spec: b.spec, lang: b.lang, email: b.email,
    }), 201);
  });
  router.get('/v1/build-with-you/trail', requireAuth(), requireScope('memory:read'), async (req: Request, res: Response) => {
    await send(res, () => readOwnTrail(storage, who(req), { since: iso(req.query.since), before: iso(req.query.before), limit: int(req.query.limit) }));
  });

  router.get('/v1/operator/activity', fleetOrOperator, async (req: Request, res: Response) => {
    await send(res, () => readTrail(storage, { since: iso(req.query.since), before: iso(req.query.before), limit: int(req.query.limit) }));
  });
  router.get('/v1/operator/build-request', fleetOrOperator, async (_req: Request, res: Response) => {
    await send(res, () => operatorPendingOp(deps));
  });
  router.put('/v1/operator/build-request', fleetOrOperator, validateBody(OperatorAnswerBody, config.nodeId), async (req: Request, res: Response) => {
    const b = req.body as z.infer<typeof OperatorAnswerBody>;
    await send(res, () => operatorHandOp(deps, {
      requestId: b.requestId, statusToken: b.statusToken, position: b.position, queueLength: b.queueLength, state: b.state,
    }));
  });
  router.post('/v1/operator/notify-owner', fleetOrOperator, validateBody(NotifyOwnerBody, config.nodeId), async (req: Request, res: Response) => {
    const b = req.body as z.infer<typeof NotifyOwnerBody>;
    try {
      const r = await notifyOwnerOnce(deps, { code: b.code, title: b.title, body: b.body, owner: b.owner, link: b.link });
      // 201 when the owner was told now; 200 when this code was told before and nobody is told again.
      res.status(r.already ? 200 : 201).json(success(config.nodeId, r));
    } catch (err) { fail(res, err); }
  });

  return router;
}
