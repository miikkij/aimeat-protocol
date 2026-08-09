/**
 * @file src/routes/agent-tasks/helpers.ts
 * @description Shared helper-closure interface + shared types for the agent-tasks route modules. Extracted from agent-tasks.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from agent-tasks.ts (max-file-lines)
 *   v1.1.0 — 2026-08-09 — reclaimTaskLiveTrace(): drop the agent's live-progress record when a task
 *     completes, so a finished task stops holding a key forever (memory-key-shape audit).
 */

import type { AgentTaskRecord, Storage } from '../../storage/interface.js';
import type { createWebhookDispatcher } from '../../services/webhook-dispatcher.js';
import { logger } from '../../utils/logger.js';

export type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;
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

/**
 * Drop the agent's live-progress trace (`agents.{name}.tasks.{id}.*`) once the task is COMPLETE.
 *
 * The runner writes that record while the task runs, to show "which phase, how long so far" on the
 * task card. When the task is done the record says `state: "done"` next to a status the card already
 * displays from the task itself, so it is spent — but nothing ever removed it, and it stayed one key
 * per task forever. Measured on aimeat.io 2026-08-09: 991 such keys, every one of them under a
 * finished task, ~235 bytes each. DELETE /tasks/:id has always swept the same prefix (lifecycle.ts);
 * this just does it at completion instead of waiting for the owner to delete the task by hand.
 *
 * NOT called on `failed`. There, the last thing the agent said before it died is the diagnosis, and
 * the event log alone does not carry the phase/elapsed detail. Failures are rare and a deleted task
 * still sweeps them.
 *
 * Best-effort by design: the task is already complete and the caller has already responded, so a
 * cleanup failure must never surface as a completion failure. It is logged, and the record is picked
 * up by the delete path later.
 */
export async function reclaimTaskLiveTrace(storage: Storage, task: AgentTaskRecord): Promise<void> {
  const agentName = task.agentGaii.split('#')[0];
  if (!agentName) return;
  const prefix = `agents.${agentName}.tasks.${task.id}.`;
  try {
    const entries = await storage.listMemory(task.agentGaii, { prefix });
    for (const m of entries) await storage.deleteMemory(task.agentGaii, m.key);
  } catch (err) {
    logger.warn('task completion: best-effort live-trace reclaim failed', { taskId: task.id, error: String(err) });
  }
}
