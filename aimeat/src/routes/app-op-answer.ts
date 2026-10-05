/**
 * @file src/routes/app-op-answer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a route answers an AppOpOutcome (services/app-op-outcome.ts): the data in the
 *   success envelope with its status, or the refusal with its status, code, message and details.
 *   The member, plan, audit, dev-grant and design-spec routes answer through this; the
 *   aimeat_app_manage MCP tool answers the same outcome through opAnswer (mcp/app-manage-answers.ts).
 * @structure sendAppOp
 * @usage return sendAppOp(res, config.nodeId, await listRoster(storage, config, req.auth!, ref, req.query));
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial; aimeat_app_manage calls the service in place of the route over
 *     loopback HTTP (secaudit 2026-10, M6).
 */
import type { Response } from 'express';
import { success, error } from '../middleware/envelope.js';
import type { AppOpOutcome } from '../services/app-op-outcome.js';

export function sendAppOp(res: Response, nodeId: string, out: AppOpOutcome): void {
  if (out.ok) {
    res.status(out.status ?? 200).json(success(nodeId, out.data));
    return;
  }
  res.status(out.status).json(error(nodeId, out.code, out.message, out.status, out.details));
}
