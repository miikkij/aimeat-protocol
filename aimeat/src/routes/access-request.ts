/**
 * @file src/routes/access-request.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Asking for access to an app, a welcome page or a company front page that is opened to
 *   one organism's members, from the refusal the open route gave (routes/apps/open.ts,
 *   routes/page-open.ts). The three route files each find their own target and call here, as they
 *   call answerPageOpen, so this file imports none of them. The rules are
 *   services/organism-join-requests/requests.ts, which the MCP tool aimeat_access_request calls too.
 *
 *   - answerAccessRequest(): POST …/access-request, body `{ message? }`. Files a join request of the
 *     organism the target's `access` names, which the organism's owners and admins decide. The
 *     answer names no organism and no request id.
 *   - answerAccessRequestState(): GET …/access-request. What the refusal page shows this person:
 *     whether a request can be filed, and whether one waits or was declined.
 * @structure answerAccessRequest · answerAccessRequestState
 * @usage
 *   await answerAccessRequest(req, res, config, storage, { access: app.access, ownerName: app.ownerName, via });
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial.
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requestAccess, accessRequestState, type AccessRequestTarget } from '../services/organism-join-requests/requests.js';

export type { AccessRequestTarget };

/** POST …/access-request, after the route found its target. */
export async function answerAccessRequest(
  req: Request, res: Response, config: AimeatConfig, storage: Storage, target: AccessRequestTarget,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const result = await requestAccess({ storage, config }, req.auth, target, (req.body as { message?: unknown } | undefined)?.message);
  if (!result.ok) {
    res.status(result.status).json(error(config.nodeId, result.code, result.message, result.status,
      result.askAgainAt ? { ask_again_at: result.askAgainAt } : undefined));
    return;
  }
  res.status(202).json(success(config.nodeId, { status: 'pending', asked_at: result.joinRequest.createdAt }));
}

/** GET …/access-request, after the route found its target. */
export async function answerAccessRequestState(
  req: Request, res: Response, config: AimeatConfig, storage: Storage, target: AccessRequestTarget,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.json(success(config.nodeId, await accessRequestState({ storage, config }, req.auth, target)));
}
