/**
 * @file task-stall-detector.ts
 * @description Background job that detects and marks stalled agent tasks.
 *   A task is considered stalled when it has been in 'active' status with no
 *   events for longer than the configured threshold (default 30 minutes).
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Find active tasks that have had no events for longer than the threshold
 * and mark them as stalled. Appends a 'failed' event explaining the reason.
 *
 * @returns Number of tasks marked as stalled
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
