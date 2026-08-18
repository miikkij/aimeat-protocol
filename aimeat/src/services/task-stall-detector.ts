/**
 * @file task-stall-detector.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Background job that detects stalled agent tasks and agent-level
 *   connectivity issues (unreachable, webhook_down).
 * @structure
 *   - detectStalledTasks() -- marks active tasks with no events as stalled
 *   - detectAgentStallConditions() -- checks agent-level unreachable/webhook_down
 * @version-history
 *   v1.1.0 -- 2026-05-24 -- Add unreachable + webhook_down agent stall conditions
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';

const UNREACHABLE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const WEBHOOK_DOWN_THRESHOLD = 10;

export interface AgentStallCondition {
  gaii: string;
  condition: 'unreachable' | 'webhook_down';
}

/**
 * Find active tasks that have had no events for longer than the threshold
 * and mark them as stalled. Appends a 'failed' event explaining the reason.
 */
export async function detectStalledTasks(storage: Storage, config: AimeatConfig): Promise<number> {
  const stalled = await storage.findStalledTasks(config.taskStallThresholdMinutes);
  const now = new Date().toISOString();

  for (const task of stalled) {
    await storage.updateAgentTask(task.id, {
      status: 'stalled',
      updatedAt: now,
    });
    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: task.id,
      type: 'failed',
      message: `Task stalled: no events for ${config.taskStallThresholdMinutes} minutes`,
      timestamp: now,
    });
  }

  if (stalled.length > 0) {
    logger.info(`Stall detector: marked ${stalled.length} task(s) as stalled`);
  }

  return stalled.length;
}

/**
 * Check all agents for connectivity stall conditions:
 * - unreachable: no activity for 2h AND no webhook configured
 * - webhook_down: 10+ consecutive webhook delivery failures
 */
export async function detectAgentStallConditions(storage: Storage): Promise<AgentStallCondition[]> {
  const agents = await storage.listAgents();
  const now = Date.now();
  const conditions: AgentStallCondition[] = [];

  for (const agent of agents) {
    const lastSeenMs = new Date(agent.lastSeen).getTime();
    const hasWebhook = agent.webhookEnabled && agent.webhookUrl;

    if (!hasWebhook && (now - lastSeenMs) > UNREACHABLE_THRESHOLD_MS) {
      conditions.push({ gaii: agent.gaii, condition: 'unreachable' });
    }

    if ((agent.webhookFailCount ?? 0) >= WEBHOOK_DOWN_THRESHOLD) {
      conditions.push({ gaii: agent.gaii, condition: 'webhook_down' });
    }
  }

  if (conditions.length > 0) {
    const unreachable = conditions.filter(c => c.condition === 'unreachable').length;
    const webhookDown = conditions.filter(c => c.condition === 'webhook_down').length;
    logger.info(`Stall detector: ${unreachable} unreachable agent(s), ${webhookDown} webhook_down agent(s)`);
  }

  return conditions;
}
