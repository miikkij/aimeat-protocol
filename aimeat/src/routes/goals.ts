/**
 * @file src/routes/goals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent goals over REST: the owner (or the owner's own AI) gives the agents a goal, the
 *   agents take its open work, leave the next work for each other, and the person answers the steps
 *   that wait for them. Every route names the caller and hands it to services/goals/goals-ops.ts,
 *   which the MCP tools aimeat_goal_* call too, so who may do what exists once.
 *
 *   THE WORDS. task:read to read and task:write to act, the words of the tasks a goal's works become;
 *   the owner in person passes requireScope as everywhere, and the service then decides between the
 *   owner, the goal's coordinator and an agent working in the goal.
 * @structure goalsRouter(config, storage)
 *   - GET    /v1/goals                                              the owner's goals (?status=running|active|paused|done|stopped|expired)
 *   - POST   /v1/goals                                              make a goal (and its works, reactions, rounds)
 *   - GET    /v1/goals/waiting                                      every step that waits for the person, and work nobody took
 *   - GET    /v1/goals/available                                    open work the calling agent may take
 *   - GET    /v1/goals/:id                                          one goal, whole
 *   - PATCH  /v1/goals/:id                                          change it (preview=true answers what it would end)
 *   - DELETE /v1/goals/:id                                          remove a finished goal
 *   - POST   /v1/goals/:id/actions/:action                          pause, resume, stop, done, renew, start_round
 *   - POST   /v1/goals/:id/material                                 add material: a file, a record, a link or a text
 *   - POST   /v1/goals/:id/works                                    add a work (action add) or leave the next one (action leave)
 *   - POST   /v1/goals/:id/works/:workId/actions/:action            claim, release, reroute, reject
 *   - POST   /v1/goals/:id/works/:workId/answer                     answer a person's step
 * @usage app.use(goalsRouter(config, storage));   // server-bootstrap/routes-loader.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { GoalError } from '../services/goals/goals-store.js';
import {
  answerOp, attachOp, createOp, getOp, goalActionOp, listOp, patchOp, waitingOp, workOp,
} from '../services/goals/goals-ops.js';

const GOAL_ACTIONS = new Set(['pause', 'resume', 'stop', 'done', 'renew', 'start_round']);
const WORK_ACTIONS = new Set(['claim', 'release', 'reroute', 'reject']);

export function goalsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };
  const who = (req: Request) => callerOf(req, config.nodeId, storage);
  const p = (req: Request, name: string) => req.params[name] as string;
  const body = (req: Request) => (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const run = (fn: (req: Request) => Promise<unknown>, status = 200) => async (req: Request, res: Response) => {
    try {
      res.status(status).json(success(config.nodeId, await fn(req)));
    } catch (err) {
      if (!(err instanceof GoalError)) throw err;
      res.status(err.status).json(error(config.nodeId, err.code, err.message));
    }
  };
  const read = [requireAuth(), requireScope('task:read')];
  const write = [requireAuth(), requireScope('task:write')];

  router.get('/v1/goals', ...read, run(req => listOp(deps, who(req), { status: typeof req.query.status === 'string' ? req.query.status : undefined })));
  router.post('/v1/goals', ...write, run(req => createOp(deps, who(req), req.body), 201));
  router.get('/v1/goals/waiting', ...read, run(req => waitingOp(deps, who(req))));
  router.get('/v1/goals/available', ...read, run(req => workOp(deps, who(req), 'available', {})));
  router.get('/v1/goals/:id', ...read, run(req => getOp(deps, who(req), p(req, 'id'))));
  router.patch('/v1/goals/:id', ...write, run(req => patchOp(deps, who(req), p(req, 'id'), req.body)));
  router.delete('/v1/goals/:id', ...write, run(req => goalActionOp(deps, who(req), p(req, 'id'), 'delete', body(req))));
  router.post('/v1/goals/:id/actions/:action', ...write, run(req => {
    const action = p(req, 'action');
    if (!GOAL_ACTIONS.has(action)) throw new GoalError(404, 'NOT_FOUND', 'action is one of pause, resume, stop, done, renew, start_round.');
    return goalActionOp(deps, who(req), p(req, 'id'), action, body(req));
  }));
  router.post('/v1/goals/:id/material', ...write, run(req => attachOp(deps, who(req), p(req, 'id'), body(req))));
  router.post('/v1/goals/:id/works', ...write, run(req => {
    const b = body(req);
    const action = b.action === 'leave' ? 'leave' : 'add';
    return workOp(deps, who(req), action, { ...b, goal_id: p(req, 'id') });
  }, 201));
  router.post('/v1/goals/:id/works/:workId/actions/:action', ...write, run(req => {
    const action = p(req, 'action');
    if (!WORK_ACTIONS.has(action)) throw new GoalError(404, 'NOT_FOUND', 'action is one of claim, release, reroute, reject.');
    return workOp(deps, who(req), action, { ...body(req), goal_id: p(req, 'id'), work_id: p(req, 'workId') });
  }));
  router.post('/v1/goals/:id/works/:workId/answer', ...write, run(req => answerOp(deps, who(req), p(req, 'id'), p(req, 'workId'), body(req))));

  return router;
}
