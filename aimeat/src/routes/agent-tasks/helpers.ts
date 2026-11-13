/**
 * @file src/routes/agent-tasks/helpers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared helper-closure interface + shared types for the agent-tasks route modules. Extracted from agent-tasks.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from agent-tasks.ts (max-file-lines)
 *   v1.1.0 — 2026-08-09 — reclaimTaskLiveTrace(): drop the agent's live-progress record when a task
 *     completes, so a finished task stops holding a key forever (memory-key-shape audit).
 *   v1.2.0 — 2026-10-02 — startCallerOf(): the session as the start rules read it
 *     (services/agent-task-rules.ts mayLoosenStart / mayStartWaitingTask).
 *   2026-11-13 — reclaimTaskLiveTrace() moved unchanged to services/agent-tasks/live-trace.ts, so the
 *     task fan-out service no longer imports a route file (structure programme 2026-11, unit 4).
 *   2026-11-13 — refuseTaskAccess(): the 404 and 403 a taskToActOn refusal answers with
 *     (services/agent/task-access.ts; structure programme 2026-11, unit 2b).
 */

import type { Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { AgentTaskRecord } from '../../storage/interface.js';
import { error } from '../../middleware/envelope.js';
import { refuseNotYours } from '../../middleware/refusals.js';
import type { createWebhookDispatcher } from '../../services/webhook-dispatcher.js';
import { isOwnerInPerson, heldScopes } from '../../auth/effective-scopes.js';
import type { StartCaller } from '../../services/agent/task-rules.js';

export type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

/**
 * The session as the start rules read it. `principal` is the resolved identity (the route's
 * `resolve`), so an agent compares as its GAII and never as its owner's bare name.
 */
export function startCallerOf(
  auth: { roles: string[]; scopes?: string[]; federated?: boolean },
  principal: string,
): StartCaller {
  return {
    ownerInPerson: isOwnerInPerson(auth),
    app: auth.roles.includes('app'),
    principal,
    scopes: heldScopes(auth),
  };
}
/**
 * The answer to a taskToActOn refusal (services/agent/task-access.ts): 404 for a task that does not
 * exist, the not-yours 403 for one the caller may not act on. The bodies are the ones each route wrote.
 */
export function refuseTaskAccess(
  res: Response, config: AimeatConfig, code: 'NOT_FOUND' | 'NOT_YOURS',
): void {
  if (code === 'NOT_FOUND') {
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
    return;
  }
  res.status(403).json(refuseNotYours(config, { thing: 'task', action: 'open', listUrl: '/v1/agents' }));
}

export type TaskBucket = 'recent' | 'keep' | 'archive';

/**
 * The bundle of per-request helper closures (defined in agentTasksRouter, closing over `config`)
 * plus deriveTaskBucket and the webhook dispatcher, passed to each register* function so the
 * extracted handler bodies stay byte-identical. Each module destructures only what it uses.
 */
export interface TaskRouteHelpers {
  resolve: (req: Express.Request) => string;
  resolveAgentGaii: (req: Express.Request, agentName: string) => string;
  tokenHasScope: (req: Express.Request, scope: string) => boolean;
  canAccessTask: (req: Express.Request, task: AgentTaskRecord) => boolean;
  canReadTask: (req: Express.Request, task: AgentTaskRecord) => boolean;
  deriveTaskBucket: (task: AgentTaskRecord, nowMs: number, autoArchive: boolean, windowHours: number) => TaskBucket;
  webhookDispatcher?: WebhookDispatcher;
}
