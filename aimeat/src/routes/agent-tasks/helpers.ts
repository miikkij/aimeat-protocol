/**
 * @file src/routes/agent-tasks/helpers.ts
 * @description Shared helper-closure interface + shared types for the agent-tasks route modules. Extracted from agent-tasks.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from agent-tasks.ts (max-file-lines)
 */

import type { AgentTaskRecord } from '../../storage/interface.js';
import type { createWebhookDispatcher } from '../../services/webhook-dispatcher.js';

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
