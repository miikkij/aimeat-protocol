/**
 * @file src/mcp/goals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP surface for agent goals: aimeat_goal_get, aimeat_goal_set,
 *   aimeat_goal_work and aimeat_goal_answer. Each action calls the same function the REST route calls
 *   (services/goals/goals-ops.ts), so who may do what, the validation and the log exist once. Nothing
 *   is decided in this file.
 * @structure registerGoalTools(mcp, storage, config, caller)
 * @usage registerGoalTools(mcp, storage, config, caller);   // mcp/register-all.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { withCaughtError } from './tool-fault.js';
import { GoalError } from '../services/goals/goals-store.js';
import {
  answerOp, attachOp, createOp, getOp, goalActionOp, listOp, patchOp, waitingOp, workOp,
} from '../services/goals/goals-ops.js';

export function registerGoalTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
  const deps = { storage, config };
  const ok = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      return ok(await fn());
    } catch (err) {
      if (err instanceof GoalError) return toolError(err.code, err.message);
      return withCaughtError(toolError('GOAL_ERROR', err instanceof Error ? err.message : String(err)), err);
    }
  };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  mcp.registerTool('aimeat_goal_get', {
    description: descriptionFor('aimeat_goal_get'),
    inputSchema: zodShapeFor('aimeat_goal_get'),
    annotations: annotationsFor('aimeat_goal_get'),
  }, async (args) => guard(async () => {
    const a = args as Record<string, unknown>;
    if (a.waiting === true) return waitingOp(deps, caller());
    if (str(a.goal_id)) return getOp(deps, caller(), str(a.goal_id));
    return listOp(deps, caller(), { status: str(a.status) || undefined });
  }));

  mcp.registerTool('aimeat_goal_set', {
    description: descriptionFor('aimeat_goal_set'),
    inputSchema: zodShapeFor('aimeat_goal_set'),
    annotations: annotationsFor('aimeat_goal_set'),
  }, async (args) => guard(async () => {
    const a = args as Record<string, unknown>;
    const action = str(a.action);
    const id = str(a.goal_id);
    const input = a.input && typeof a.input === 'object' ? { ...(a.input as Record<string, unknown>) } : {};
    const reason = str(a.reason);
    if (reason && !input.reason) input.reason = reason;
    switch (action) {
      case 'create': return createOp(deps, caller(), input);
      case 'update': return patchOp(deps, caller(), id, input);
      case 'preview': return patchOp(deps, caller(), id, { ...input, preview: true });
      case 'attach': return attachOp(deps, caller(), id, input);
      case 'pause': case 'resume': case 'stop': case 'done': case 'renew': case 'start_round': case 'delete':
        return goalActionOp(deps, caller(), id, action, { reason });
      default: throw new GoalError(400, 'INVALID_INPUT', 'action is one of create, update, preview, pause, resume, stop, done, renew, start_round, attach, delete.');
    }
  }));

  mcp.registerTool('aimeat_goal_work', {
    description: descriptionFor('aimeat_goal_work'),
    inputSchema: zodShapeFor('aimeat_goal_work'),
    annotations: annotationsFor('aimeat_goal_work'),
  }, async (args) => guard(async () => {
    const a = args as Record<string, unknown>;
    return workOp(deps, caller(), str(a.action), a);
  }));

  mcp.registerTool('aimeat_goal_answer', {
    description: descriptionFor('aimeat_goal_answer'),
    inputSchema: zodShapeFor('aimeat_goal_answer'),
    annotations: annotationsFor('aimeat_goal_answer'),
  }, async (args) => guard(async () => {
    const a = args as Record<string, unknown>;
    return answerOp(deps, caller(), str(a.goal_id), str(a.work_id), a);
  }));
}
