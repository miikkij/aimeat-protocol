/**
 * @file src/routes/help/help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Ask someone who knows over REST. Every handler calls services/help/, the same functions
 *   the MCP tools call, so the rules and refusals are written once. Bodies are checked for type and
 *   bounds by models/help-schemas.ts; what a value means is the service's to decide.
 *
 *   - GET    /v1/help/me                       — my choices, the node's defaults and my card's topics
 *   - PUT    /v1/help/me                       — change my choices
 *   - POST   /v1/help/find                     — kept answers and the helpers who could answer
 *   - POST   /v1/help/questions                — ask
 *   - GET    /v1/help/inbox                    — questions asked of me, my own questions, the shared list
 *   - GET    /v1/help/threads/:conversationId  — the question behind a message thread, as I may see it
 *   - POST   /v1/help/questions/:id/respond    — answer, approve a draft, pass, refer, take, confirm a kept answer
 *   - POST   /v1/help/questions/:id/close      — solved (with thanks), cancel, more time
 *
 *   Asking needs help:ask and answering help:answer for an agent; a person in person needs neither.
 *   Which of the two a read needs is decided in the service, because a member is both an asker and
 *   a helper.
 * @usage app.use(helpRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope, requireAnyScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { validateBody } from '../../models/schemas.js';
import { HelpProfileBody, HelpFindBody, HelpAskBody, HelpRespondBody, HelpCloseBody } from '../../models/help-schemas.js';
import { HELP_ASK_SCOPE, HELP_ANSWER_SCOPE } from '../../utils/scope-coverage.js';
import { getParticipation, setParticipation } from '../../services/help/participants.js';
import { findHelp, askQuestion, takeFromBoard, listInbox, threadView } from '../../services/help/questions.js';
import { respondToQuestion } from '../../services/help/respond.js';
import { closeQuestion } from '../../services/help/close.js';
import type { HelpResult } from '../../services/help/rules.js';

export function helpRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };
  const v = config.nodeId;
  const send = <T>(res: Response, r: HelpResult<T>, status = 200): void => {
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    res.status(status).json(success(config.nodeId, r.data));
  };
  const id = (req: Request): string => String(req.params.id ?? '');

  // A member is both an asker and a helper, so a read takes either word.
  const readGate = [requireAuth(), requireAnyScope(HELP_ASK_SCOPE, HELP_ANSWER_SCOPE)];

  router.get('/v1/help/me', ...readGate, async (req, res) => {
    send(res, await getParticipation(deps, callerOf(req, config.nodeId, storage)));
  });

  router.put('/v1/help/me', requireAuth(), requireScope(HELP_ANSWER_SCOPE), validateBody(HelpProfileBody, v), async (req, res) => {
    send(res, await setParticipation(deps, callerOf(req, config.nodeId, storage), req.body ?? {}));
  });

  router.post('/v1/help/find', requireAuth(), requireScope(HELP_ASK_SCOPE), validateBody(HelpFindBody, v), async (req, res) => {
    send(res, await findHelp(deps, callerOf(req, config.nodeId, storage), req.body ?? {}));
  });

  router.post('/v1/help/questions', requireAuth(), requireScope(HELP_ASK_SCOPE), validateBody(HelpAskBody, v), async (req, res) => {
    send(res, await askQuestion(deps, callerOf(req, config.nodeId, storage), req.body ?? {}), 201);
  });

  router.get('/v1/help/inbox', ...readGate, async (req, res) => {
    send(res, await listInbox(deps, callerOf(req, config.nodeId, storage), { include_closed: req.query.include_closed === 'true' }));
  });

  router.get('/v1/help/threads/:conversationId', ...readGate, async (req, res) => {
    send(res, await threadView(deps, callerOf(req, config.nodeId, storage), String(req.params.conversationId ?? '')));
  });

  router.post('/v1/help/questions/:id/respond', requireAuth(), requireScope(HELP_ANSWER_SCOPE), validateBody(HelpRespondBody, v), async (req, res) => {
    const caller = callerOf(req, config.nodeId, storage);
    const body = req.body ?? {};
    // Taking a question from the shared list is the one action on a question not yet sent to you.
    if (body.action === 'take') { send(res, await takeFromBoard(deps, caller, id(req))); return; }
    send(res, await respondToQuestion(deps, caller, id(req), body));
  });

  router.post('/v1/help/questions/:id/close', requireAuth(), requireScope(HELP_ASK_SCOPE), validateBody(HelpCloseBody, v), async (req, res) => {
    send(res, await closeQuestion(deps, callerOf(req, config.nodeId, storage), id(req), req.body ?? {}));
  });

  return router;
}
